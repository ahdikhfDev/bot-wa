import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getAllSkills, getSkill, setSkillEnabled, getSkillConfig, setSkillConfig, getAllSkillConfigs, getAllWhitelist, addWhitelist, removeWhitelist, getAllSettings, getSetting, setSetting, getTokenUsageSummary, resetTokenUsage, getAllCustomModes, getCustomMode, saveCustomMode, deleteCustomMode, getAllUserProfiles, getUserProfile, saveUserProfile } from '../services/db.js';
import { getSkillNames } from '../skills/_loader.js';
import { reloadAI, fetchAvailableModels, getGroqClient, invalidateModeCache } from '../services/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.WEB_PORT || '6789');

const AUTH_TOKEN_KEY = 'dashboard_token';
const PASSWORD_KEY = 'dashboard_password';
const DEFAULT_PASSWORD = '12345678';

function hashPassword(pw) {
    return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function getAuthToken() {
    let token = getSetting(AUTH_TOKEN_KEY);
    if (!token) {
        token = generateToken();
        setSetting(AUTH_TOKEN_KEY, token);
    }
    return token;
}

function requireAuth(req, res, next) {
    const p = req.originalUrl;
    if (p === '/api/auth/login' || p === '/api/auth/verify') {
        return next();
    }
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (auth.slice(7) !== getAuthToken()) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    next();
}

let botStatus = { connected: false, startTime: Date.now(), messageCount: 0 };
let sockRef = null;

export function setBotStatus(connected) {
    botStatus.connected = connected;
}

export function incrementMessageCount() {
    botStatus.messageCount++;
}

export function setSock(sock) {
    sockRef = sock;
}

// Known API keys for the dashboard
const KNOWN_API_KEYS = [
    { key: 'GROQ_API_KEY', label: 'Groq', provider: 'groq', docs: 'https://console.groq.com/keys' },
    { key: 'OPENAI_API_KEY', label: 'OpenAI', provider: 'openai', docs: 'https://platform.openai.com/api-keys' },
    { key: 'TAVILY_API_KEY', label: 'Tavily (Search)', provider: 'tavily', docs: 'https://app.tavily.com/home' },
];

const SENSITIVE_KEYS = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY', 'dashboard_token', 'dashboard_password'];

export function startServer() {
    // Set default password on first run
    if (!getSetting(PASSWORD_KEY)) {
        setSetting(PASSWORD_KEY, hashPassword(DEFAULT_PASSWORD));
        console.log('🔑 Dashboard password default: 12345678');
    }

    // Seed env vars to DB so web dashboard can see/manage them
    const envToSeed = ['GROQ_API_KEY', 'GROQ_MODEL', 'TAVILY_API_KEY', 'OPENAI_API_KEY'];
    for (const key of envToSeed) {
        if (process.env[key] && !getSetting(key)) {
            setSetting(key, process.env[key]);
            console.log(`🌱 Seeded ${key} from env to DB`);
        }
    }

    const app = express();
    app.use(express.json());
    app.use('/api', requireAuth);
    app.use(express.static(path.join(__dirname, 'public')));

    // ==================== AUTH ====================
    app.post('/api/auth/login', (req, res) => {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password required' });
        const stored = getSetting(PASSWORD_KEY, hashPassword(DEFAULT_PASSWORD));
        if (hashPassword(password) !== stored) {
            return res.status(401).json({ error: 'Password salah' });
        }
        const token = getAuthToken();
        res.json({ success: true, token });
    });

    app.get('/api/auth/verify', (req, res) => {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.json({ authenticated: false });
        }
        res.json({ authenticated: auth.slice(7) === getAuthToken() });
    });

    app.post('/api/auth/change-password', (req, res) => {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'oldPassword and newPassword required' });
        }
        const stored = getSetting(PASSWORD_KEY, hashPassword(DEFAULT_PASSWORD));
        if (hashPassword(oldPassword) !== stored) {
            return res.status(401).json({ error: 'Password saat ini salah' });
        }
        if (newPassword.length < 4) {
            return res.status(400).json({ error: 'Password minimal 4 karakter' });
        }
        setSetting(PASSWORD_KEY, hashPassword(newPassword));
        const newToken = generateToken();
        setSetting(AUTH_TOKEN_KEY, newToken);
        res.json({ success: true, token: newToken });
    });

    // ==================== API: STATUS ====================
    app.get('/api/status', (req, res) => {
        res.json({
            ...botStatus,
            uptime: Math.floor((Date.now() - botStatus.startTime) / 1000),
            skillsCount: getSkillNames().length,
            whitelistCount: getAllWhitelist().length
        });
    });

    // ==================== API: SKILLS ====================
    app.get('/api/skills', (req, res) => {
        const skills = getAllSkills().map(s => ({
            ...s,
            loaded: getSkillNames().includes(s.name)
        }));
        res.json(skills);
    });

    app.get('/api/skills/:name', (req, res) => {
        const skill = getSkill(req.params.name);
        if (!skill) return res.status(404).json({ error: 'Skill not found' });
        const config = getAllSkillConfigs(req.params.name);
        res.json({ ...skill, config });
    });

    app.put('/api/skills/:name/toggle', (req, res) => {
        const { enabled } = req.body;
        setSkillEnabled(req.params.name, enabled);
        res.json({ success: true, name: req.params.name, enabled });
    });

    app.get('/api/skills/:name/config', (req, res) => {
        res.json(getAllSkillConfigs(req.params.name));
    });

    app.put('/api/skills/:name/config', (req, res) => {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key required' });
        setSkillConfig(req.params.name, key, value);
        res.json({ success: true, key, value });
    });

    // ==================== API: WHITELIST ====================
    app.get('/api/whitelist', (req, res) => {
        res.json(getAllWhitelist());
    });

    app.post('/api/whitelist', (req, res) => {
        const { jid, name } = req.body;
        if (!jid) return res.status(400).json({ error: 'jid required' });
        addWhitelist(jid, name || '');
        res.json({ success: true, jid });
    });

    app.delete('/api/whitelist/:jid', (req, res) => {
        removeWhitelist(req.params.jid);
        res.json({ success: true });
    });

    // ==================== API: SETTINGS ====================
    app.get('/api/settings', (req, res) => {
        const all = getAllSettings();
        // Filter out sensitive keys from settings endpoint
        const safe = {};
        for (const [k, v] of Object.entries(all)) {
            if (!SENSITIVE_KEYS.includes(k)) safe[k] = v;
        }
        res.json(safe);
    });

    app.put('/api/settings', (req, res) => {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key required' });
        if (SENSITIVE_KEYS.includes(key)) {
            return res.status(403).json({ error: 'Gunakan endpoint /api/keys untuk mengubah API key' });
        }
        setSetting(key, value);
        res.json({ success: true, key, value });
    });

    // ==================== API: KEYS (Dedicated) ====================
    app.get('/api/keys', (req, res) => {
        const all = getAllSettings();
        const result = KNOWN_API_KEYS.map(k => {
            const val = all[k.key] || '';
            const masked = val.length > 8
                ? val.substring(0, 4) + '*'.repeat(8) + val.substring(val.length - 4)
                : val ? '*'.repeat(8) : '';
            return {
                key: k.key,
                label: k.label,
                provider: k.provider,
                docs: k.docs,
                masked,
                isSet: !!val,
            };
        });
        res.json(result);
    });

    app.put('/api/keys', (req, res) => {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key required' });
        const known = KNOWN_API_KEYS.find(k => k.key === key);
        if (!known) return res.status(400).json({ error: 'Unknown API key' });
        if (value && value.length < 8) return res.status(400).json({ error: 'API key terlalu pendek' });
        setSetting(key, value || '');
        const aiKeys = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];
        if (aiKeys.includes(key)) {
            reloadAI();
        }
        res.json({ success: true, key, provider: known.provider });
    });

    app.post('/api/keys/test', async (req, res) => {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'key required' });
        const apiKey = getSetting(key) || process.env[key] || '';
        if (!apiKey) return res.json({ success: false, error: 'API key belum diset' });

        try {
            if (key === 'GROQ_API_KEY') {
                const resp = await fetch('https://api.groq.com/openai/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (!resp.ok) return res.json({ success: false, error: `Groq: ${resp.status} ${resp.statusText}` });
                const data = await resp.json();
                const count = (data.data || []).filter(m => m.active).length;
                return res.json({ success: true, message: `✅ Groq: ${count} model aktif tersedia` });
            }
            if (key === 'OPENAI_API_KEY') {
                const resp = await fetch('https://api.openai.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (!resp.ok) return res.json({ success: false, error: `OpenAI: ${resp.status} ${resp.statusText}` });
                return res.json({ success: true, message: '✅ OpenAI API key valid' });
            }
            if (key === 'TAVILY_API_KEY') {
                const resp = await fetch('https://api.tavily.com', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: apiKey, query: 'test', max_results: 1 })
                });
                if (!resp.ok) return res.json({ success: false, error: `Tavily: ${resp.status} ${resp.statusText}` });
                return res.json({ success: true, message: '✅ Tavily API key valid' });
            }
            res.json({ success: false, error: 'Unknown provider' });
        } catch (err) {
            res.json({ success: false, error: err.message });
        }
    });

    // ==================== API: BOT ====================
    app.post('/api/bot/reconnect', async (req, res) => {
        if (!sockRef) return res.status(503).json({ error: 'Bot not connected' });
        try {
            await sockRef.logout();
            res.json({ success: true, message: '🔄 Bot logout, akan reconnect otomatis...' });
        } catch (err) {
            res.json({ success: false, error: err.message });
        }
    });

    // ==================== API: MODELS ====================
    app.get('/api/models', async (req, res) => {
        try {
            const models = await fetchAvailableModels();
            const current = getSetting('GROQ_MODEL') || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
            res.json({ models, current });
        } catch (err) {
            res.json({ models: [], current: '', error: err.message });
        }
    });

    app.post('/api/models/refresh', async (req, res) => {
        try {
            reloadAI();
            const models = await fetchAvailableModels();
            const current = getSetting('GROQ_MODEL') || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
            res.json({ success: true, models, current });
        } catch (err) {
            res.json({ success: false, error: err.message });
        }
    });

    // ==================== API: BOT COMMANDS ====================
    app.post('/api/bot/send', async (req, res) => {
        const { jid, text } = req.body;
        if (!jid || !text) return res.status(400).json({ error: 'jid and text required' });
        if (!sockRef) return res.status(503).json({ error: 'Bot not connected' });
        try {
            await sockRef.sendMessage(jid, { text });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== API: TOKEN USAGE ====================
    app.get('/api/tokens', (req, res) => {
        res.json(getTokenUsageSummary());
    });

    app.delete('/api/tokens', (req, res) => {
        resetTokenUsage();
        res.json({ success: true });
    });

    // ==================== API: CUSTOM MODES (PERSONA) ====================
    app.get('/api/modes/custom', (req, res) => {
        const modes = getAllCustomModes();
        const defaultModes = [
            { name: 'asik', isDefault: true },
            { name: 'bad', isDefault: true },
            { name: 'formal', isDefault: true },
            { name: 'profesional', isDefault: true },
        ];
        res.json({ defaults: defaultModes, custom: modes });
    });

    app.get('/api/modes/custom/:name', (req, res) => {
        const mode = getCustomMode(req.params.name);
        if (!mode) return res.status(404).json({ error: 'Mode not found' });
        res.json(mode);
    });

    app.post('/api/modes/custom', (req, res) => {
        const { name, system_prompt, temperature } = req.body;
        if (!name || !system_prompt) return res.status(400).json({ error: 'name and system_prompt required' });
        const safeName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (['asik', 'bad', 'formal', 'profesional'].includes(safeName)) {
            return res.status(400).json({ error: 'Nama mode sudah dipakai oleh mode default' });
        }
        saveCustomMode(safeName, system_prompt, parseFloat(temperature) || 0.85);
        invalidateModeCache();
        res.json({ success: true, name: safeName });
    });

    app.put('/api/modes/custom/:name', (req, res) => {
        const { system_prompt, temperature } = req.body;
        if (!system_prompt) return res.status(400).json({ error: 'system_prompt required' });
        saveCustomMode(req.params.name, system_prompt, parseFloat(temperature) || 0.85);
        invalidateModeCache();
        res.json({ success: true });
    });

    app.delete('/api/modes/custom/:name', (req, res) => {
        deleteCustomMode(req.params.name);
        invalidateModeCache();
        res.json({ success: true });
    });

    // ==================== USER PROFILES ====================
    app.get('/api/profiles', (req, res) => {
        res.json(getAllUserProfiles());
    });

    app.get('/api/profiles/:jid', (req, res) => {
        const profile = getUserProfile(req.params.jid);
        res.json(profile || { jid: req.params.jid, name: '', facts: [], timezone: 'Asia/Jakarta' });
    });

    app.put('/api/profiles/:jid', (req, res) => {
        const { name, facts, timezone } = req.body;
        const profile = getUserProfile(req.params.jid) || {};
        saveUserProfile(req.params.jid, name || profile.name || '', facts || profile.facts || [], timezone || profile.timezone || 'Asia/Jakarta');
        res.json({ success: true });
    });

    // ==================== START ====================
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Bot-WA Dashboard: http://0.0.0.0:${PORT}`);
    });
}
