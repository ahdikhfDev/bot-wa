import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllSkills, getSkill, setSkillEnabled, getSkillConfig, setSkillConfig, getAllSkillConfigs, getAllWhitelist, addWhitelist, removeWhitelist, getAllSettings, getSetting, setSetting } from '../services/db.js';
import { getSkillNames } from '../skills/_loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.WEB_PORT || '6789');

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

export function startServer() {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

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
        res.json(getAllSettings());
    });

    app.put('/api/settings', (req, res) => {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key required' });
        setSetting(key, value);
        res.json({ success: true, key, value });
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

    // ==================== START ====================
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Bot-WA Dashboard: http://0.0.0.0:${PORT}`);
    });
}
