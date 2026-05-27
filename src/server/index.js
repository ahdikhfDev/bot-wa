import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getAllSkills, getSkill, setSkillEnabled, getSkillConfig, setSkillConfig, getAllSkillConfigs, getAllWhitelist, addWhitelist, removeWhitelist, getAllSettings, getSetting, setSetting, getTokenUsageSummary, resetTokenUsage, getAllCustomModes, getCustomMode, saveCustomMode, deleteCustomMode, getAllUserProfiles, getUserProfile, saveUserProfile, getStocks, getStockById, createStock, updateStock, deleteStock, getStockCount, getMemories, searchMemories, clearMemories, getChatReminders, deleteReminder, getJadwal, getGroupHistory, clearGroupContext } from '../services/db.js';
import { getSkillNames } from '../skills/_loader.js';
import { reloadAI, fetchAvailableModels, getGroqClient, invalidateModeCache, getModel } from '../services/ai.js';
import os from 'os';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.WEB_PORT || '6789');

const AUTH_TOKEN_KEY = 'dashboard_token';
const PASSWORD_KEY = 'dashboard_password';
const INIT_PASSWORD_ENV = process.env.WEB_DASHBOARD_INIT_PASSWORD || '';
const PUBLIC_STOCK_DOWNLOADS = process.env.PUBLIC_STOCK_DOWNLOADS === 'true';

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

function validateBearerToken(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return false;
    return auth.slice(7) === getAuthToken();
}

function requireAuth(req, res, next) {
    const p = req.originalUrl;
    if (p === '/api/auth/login' || p === '/api/auth/verify' || p === '/api/events') {
        return next();
    }
    // Allow public stock file downloads only when explicitly enabled
    if (PUBLIC_STOCK_DOWNLOADS && p.match(/^\/api\/stock\/\d+\/(video|thumbnail)$/)) {
        return next();
    }
    if (!validateBearerToken(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

let botStatus = { connected: false, startTime: Date.now(), messageCount: 0, totalCumulative: 0, sessionStartTime: Date.now(), accumulatedUptime: 0 };
let uptimeSaveTimer = null;
let sockRef = null;

// SSE (Server-Sent Events) clients
const sseClients = new Set();
function broadcastSSE(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try { client.write(msg); } catch { sseClients.delete(client); }
    }
}

function initBotStats() {
    if (!getSetting('stats_first_start')) {
        setSetting('stats_first_start', String(Date.now()));
    }
    setSetting('stats_last_start', String(Date.now()));
    const rc = parseInt(getSetting('stats_restart_count', '0')) + 1;
    setSetting('stats_restart_count', String(rc));
    return rc;
}

export function setBotStatus(connected) {
    botStatus.connected = connected;
    broadcastSSE('bot-status', { connected, uptime: getTotalUptime() });
}

export function incrementMessageCount() {
    botStatus.messageCount++;
    botStatus.totalCumulative++;
    // Persist every 10 messages
    if (botStatus.messageCount % 10 === 0) {
        setSetting('stats_total_messages', String(botStatus.messageCount));
        setSetting('stats_total_cumulative', String(botStatus.totalCumulative));
    }
    broadcastSSE('status', { messageCount: botStatus.messageCount, totalCumulative: botStatus.totalCumulative });
}

export function setSock(sock) {
    sockRef = sock;
}

// Known API keys for the dashboard
const KNOWN_API_KEYS = [
    { key: 'GROQ_API_KEY', label: 'Groq', provider: 'groq', docs: 'https://console.groq.com/keys' },
    { key: 'GEMINI_API_KEY', label: 'Gemini (Google)', provider: 'gemini', docs: 'https://aistudio.google.com/app/apikey' },
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', provider: 'anthropic', docs: 'https://console.anthropic.com/settings/keys' },
    { key: '9ROUTER_API_KEY', label: '9Router', provider: '9router', docs: 'https://ai.akf.biz.id/dashboard' },
    { key: 'TAVILY_API_KEY', label: 'Tavily (Search)', provider: 'tavily', docs: 'https://app.tavily.com/home' },
    { key: 'GNEWS_API_KEY', label: 'GNews', provider: 'gnews', docs: 'https://gnews.io/' },
];

const SENSITIVE_KEYS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', '9ROUTER_API_KEY', 'TAVILY_API_KEY', 'GNEWS_API_KEY', 'dashboard_token', 'dashboard_password'];

function getTotalUptime() {
    return botStatus.accumulatedUptime + Math.floor((Date.now() - botStatus.startTime) / 1000);
}

export function startServer() {
    // Set initial password on first run from env or random fallback
    if (!getSetting(PASSWORD_KEY)) {
        const generatedPassword = crypto.randomBytes(12).toString('base64url');
        const initialPassword = INIT_PASSWORD_ENV || generatedPassword;
        setSetting(PASSWORD_KEY, hashPassword(initialPassword));
        if (INIT_PASSWORD_ENV) {
            console.log('Dashboard password initialized from WEB_DASHBOARD_INIT_PASSWORD');
        } else {
            console.log(`Dashboard initial password (save this): ${initialPassword}`);
        }
    }

    // Init persistent stats
    const restartCount = initBotStats();
    botStatus.startTime = Date.now();
    botStatus.sessionStartTime = Date.now();
    botStatus.messageCount = parseInt(getSetting('stats_total_messages', '0'));
    botStatus.totalCumulative = parseInt(getSetting('stats_total_cumulative', '0'));
    botStatus.accumulatedUptime = parseInt(getSetting('stats_accumulated_uptime', '0'));
    // Save accumulated uptime every 60s
    if (uptimeSaveTimer) clearInterval(uptimeSaveTimer);
    uptimeSaveTimer = setInterval(() => {
        botStatus.accumulatedUptime = getTotalUptime();
        setSetting('stats_accumulated_uptime', String(botStatus.accumulatedUptime));
    }, 60000);

    // Seed env vars to DB so web dashboard can see/manage them
    const envToSeed = ['GROQ_API_KEY', 'GROQ_MODEL', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY', 'GNEWS_API_KEY', '9ROUTER_API_KEY'];
    for (const key of envToSeed) {
        if (process.env[key] && !getSetting(key)) {
            setSetting(key, process.env[key]);
            console.log(`🌱 Seeded ${key} from env to DB`);
        }
    }

    // Migrate old OPENAI_API_KEY to 9ROUTER_API_KEY
    const oldKey = getSetting('OPENAI_API_KEY');
    if (oldKey && !getSetting('9ROUTER_API_KEY')) {
        setSetting('9ROUTER_API_KEY', oldKey);
        console.log('🔄 Migrated OPENAI_API_KEY → 9ROUTER_API_KEY');
    }

    const app = express();
    app.use(express.json());

    // Rate limiting untuk endpoint API
    app.set("trust proxy", 1);
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 menit
        max: 300, // max 300 request per window
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Terlalu banyak request. Coba lagi nanti.' }
    });

    // Rate limiting lebih ketat untuk login
    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10, // max 10 percobaan login per 15 menit
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.' }
    });

    app.use('/api', (req, res, next) => {
        // Skip rate limiting untuk SSE endpoint (koneksi long-lived)
        if (req.path === '/events' && req.method === 'GET') return next();
        apiLimiter(req, res, next);
    });
    app.use('/api/auth/login', authLimiter);
    app.use('/api', requireAuth);
    app.use(express.static(path.join(__dirname, 'public')));

    // ==================== AUTH ====================
    app.post('/api/auth/login', (req, res) => {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password required' });
        const stored = getSetting(PASSWORD_KEY);
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
        const stored = getSetting(PASSWORD_KEY);
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
        const tokenUsage = getTokenUsageSummary();
        res.json({
            ...botStatus,
            uptime: getTotalUptime(),
            skillsCount: getSkillNames().length,
            whitelistCount: getAllWhitelist().length,
            firstStart: getSetting('stats_first_start'),
            lastStart: getSetting('stats_last_start'),
            restartCount: parseInt(getSetting('stats_restart_count', '0')),
            totalMessages: parseInt(getSetting('stats_total_cumulative', '0')) || botStatus.totalCumulative || parseInt(getSetting('stats_total_messages', '0')),
            videosGenerated: parseInt(getSetting('stats_videos_generated', '0')),
            tokenUsage: {
                total: tokenUsage.totalAll,
                count: tokenUsage.count
            }
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
        const aiKeys = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', '9ROUTER_API_KEY', 'TAVILY_API_KEY'];
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
            if (key === 'GEMINI_API_KEY') {
                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                if (!resp.ok) return res.json({ success: false, error: `Gemini: ${resp.status} ${resp.statusText}` });
                return res.json({ success: true, message: '✅ Gemini API key valid' });
            }
            if (key === 'ANTHROPIC_API_KEY') {
                const resp = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                    body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
                });
                if (resp.status === 400 || resp.ok) return res.json({ success: true, message: '✅ Anthropic API key valid' });
                return res.json({ success: false, error: `Anthropic: ${resp.status} ${resp.statusText}` });
            }
            if (key === '9ROUTER_API_KEY') {
                const resp = await fetch('https://ai.akf.biz.id/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (!resp.ok) return res.json({ success: false, error: `9Router: ${resp.status} ${resp.statusText}` });
                return res.json({ success: true, message: '✅ 9Router API key valid' });
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

    // ==================== API: AI PROVIDER TOGGLE ====================
app.get('/api/provider', (req, res) => {
    const provider = getSetting('AI_PROVIDER') || 'groq';
    res.json({ provider, options: ['groq', 'gemini', 'anthropic', '9router'] });
});

app.post('/api/provider', (req, res) => {
    const { provider } = req.body;
    if (!['groq', 'gemini', 'anthropic', '9router'].includes(provider)) {
        return res.status(400).json({ error: "Provider harus groq, gemini, anthropic, atau 9router" });
    }
    setSetting('AI_PROVIDER', provider);
    reloadAI();
    invalidateModeCache();
    console.log('🔄 AI provider changed to:', provider);
    res.json({ success: true, provider });
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

    // ==================== API: SYSTEM STATS ====================
    app.get('/api/system', (req, res) => {

        const cpus = os.cpus();
        let disk = {};
        try {
            const df = execSync('df -h /', { encoding: 'utf8' }).trim().split('\n')[1].split(/\s+/);
            disk = { total: df[1], used: df[2], free: df[3], usage: df[4] };
        } catch { disk = { total: '?', used: '?', free: '?', usage: '?' }; }

        const cpuModel = cpus[0]?.model || 'Unknown';
        const cpuCores = cpus.length;
        const loadAvg = os.loadavg();
        const cpuUsage = Math.min(100, Math.round((loadAvg[0] / cpuCores) * 100));

        res.json({
            cpu: {
                model: cpuModel,
                cores: cpuCores,
                load: loadAvg,
                usage: cpuUsage,
            },
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem(),
            },
            disk,
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            uptime: os.uptime(),
        });
    });

    // ==================== STOCK CONTENT ====================
    app.get('/api/stock', (req, res) => {
        const status = req.query.status || '';
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const stocks = getStocks(limit, offset, status);
        const total = getStockCount(status);
        res.json({ stocks, total, limit, offset });
    });

    app.post('/api/stock', (req, res) => {
        const { topic, caption, tags, videoPath, thumbnailPath, videoSize, trendSource } = req.body || {};
        if (!topic) return res.status(400).json({ error: 'topic required' });
        const id = createStock({ topic, caption, tags, videoPath, thumbnailPath, videoSize, trendSource });
        if (!id) return res.status(500).json({ error: 'Gagal membuat stock' });
        const vcount = parseInt(getSetting('stats_videos_generated', '0')) || 0;
        setSetting('stats_videos_generated', String(vcount + 1));
        res.json({ success: true, id });
    });

    app.get('/api/stock/:id', (req, res) => {
        const stock = getStockById(parseInt(req.params.id));
        if (!stock) return res.status(404).json({ error: 'Stock not found' });
        res.json(stock);
    });

    app.get('/api/stock/:id/video', (req, res) => {
        const stock = getStockById(parseInt(req.params.id));
        if (!stock || !stock.video_path) return res.status(404).json({ error: 'Video not found' });
        if (!fs.existsSync(stock.video_path)) return res.status(404).json({ error: 'File not found' });
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="stock-${stock.id}.mp4"`);
        fs.createReadStream(stock.video_path).pipe(res);
    });

    app.get('/api/stock/:id/thumbnail', (req, res) => {
        const stock = getStockById(parseInt(req.params.id));
        if (!stock || !stock.thumbnail_path) return res.status(404).json({ error: 'Thumbnail not found' });
        if (!fs.existsSync(stock.thumbnail_path)) return res.status(404).json({ error: 'File not found' });
        res.setHeader('Content-Type', 'image/jpeg');
        fs.createReadStream(stock.thumbnail_path).pipe(res);
    });

    app.delete('/api/stock/:id', (req, res) => {
        const stock = getStockById(parseInt(req.params.id));
        if (!stock) return res.status(404).json({ error: 'Stock not found' });
        deleteStock(parseInt(req.params.id));
        res.json({ success: true });
    });

    app.put('/api/stock/:id', (req, res) => {
        const { caption, tags, status } = req.body;
        const updates = {};
        if (caption !== undefined) updates.caption = caption;
        if (tags !== undefined) updates.tags = tags;
        if (status !== undefined) updates.status = status;
        const ok = updateStock(parseInt(req.params.id), updates);
        if (!ok) return res.status(404).json({ error: 'Stock not found or no changes' });
        res.json({ success: true });
    });


    // ==================== SSE: REAL-TIME EVENTS ====================
    app.get('/api/events', (req, res) => {
        // Validate token via query param (EventSource can't set custom headers)
        const tokenParam = req.query.token;
        if (!tokenParam || tokenParam !== getAuthToken()) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        // Kirim status awal
        const uptime = getTotalUptime();
        res.write(`event: initial\ndata: ${JSON.stringify({ ...botStatus, uptime })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
    });

    // ==================== API: MEMORIES ====================
    app.get('/api/memories', (req, res) => {
        try {
            const groupId = req.query.group_id || '';
            const limit = parseInt(req.query.limit) || 20;
            const category = req.query.category || null;
            const memories = getMemories(groupId, limit, category);
            res.json({ memories, count: memories.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/memories/search', (req, res) => {
        try {
            const { group_id, query } = req.body || {};
            if (!group_id || !query) return res.status(400).json({ error: 'group_id and query required' });
            const results = searchMemories(group_id, query, parseInt(req.body.limit) || 5);
            res.json({ results, count: results.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/memories', (req, res) => {
        try {
            const { group_id } = req.body || {};
            if (!group_id) return res.status(400).json({ error: 'group_id required' });
            clearMemories(group_id);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== API: REMINDERS ====================
    app.get('/api/reminders', (req, res) => {
        try {
            const chatId = req.query.chat_id || '';
            if (!chatId) return res.status(400).json({ error: 'chat_id required' });
            const reminders = getChatReminders(chatId);
            res.json({ reminders, count: reminders.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/reminders/:id', (req, res) => {
        try {
            deleteReminder(parseInt(req.params.id));
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== API: JADWAL ====================
    app.get('/api/jadwal', (req, res) => {
        try {
            const groupId = req.query.group_id || '';
            if (!groupId) return res.status(400).json({ error: 'group_id required' });
            const items = getJadwal(groupId);
            res.json({ jadwal: items, count: items.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== API: GROUP CONTEXT HISTORY ====================
    app.get('/api/context', (req, res) => {
        try {
            const groupId = req.query.group_id || '';
            const limit = parseInt(req.query.limit) || 20;
            if (!groupId) return res.status(400).json({ error: 'group_id required' });
            const messages = getGroupHistory(groupId, limit);
            res.json({ messages, count: messages.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/context', (req, res) => {
        try {
            const { group_id } = req.body || {};
            if (!group_id) return res.status(400).json({ error: 'group_id required' });
            clearGroupContext(group_id);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== OPENAI-COMPATIBLE API ====================
// Allows using this bot as an OpenAI-compatible endpoint for external tools

app.post('/v1/chat/completions', async (req, res) => {
    if (!validateBearerToken(req)) {
        return res.status(401).json({ error: { message: 'Unauthorized', type: 'auth_error' } });
    }
    try {
        const { model, messages, temperature, max_tokens, stream } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                error: { message: 'messages required', type: 'invalid_request_error' }
            });
        }
        const client = getGroqClient();
        const completion = await client.chat.completions.create({
            model: model || getModel(),
            messages,
            temperature: temperature ?? undefined,
            max_tokens: max_tokens ?? undefined,
            stream: stream ?? false,
        });
        res.json(completion);
    } catch (err) {
        console.error('AI API Error:', err.message);
        const status = err.status || 500;
        const body = {
            error: { message: err.message, type: 'server_error' }
        };
        if (err.response?.data) {
            body.error.details = err.response.data;
        }
        res.status(status).json(body);
    }
});

app.get('/v1/models', async (req, res) => {
    if (!validateBearerToken(req)) {
        return res.status(401).json({ error: { message: 'Unauthorized', type: 'auth_error' } });
    }
    try {
        const models = await fetchAvailableModels();
        res.json({
            object: 'list',
            data: models.map(m => ({
                id: m.id,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: m.owned || 'groq',
            }))
        });
    } catch (err) {
        res.json({ object: 'list', data: [] });
    }
});

app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Bot-WA Dashboard: http://0.0.0.0:${PORT}`);
    });
}

// Exported for shutdown hook
export { getTotalUptime, uptimeSaveTimer, botStatus };
