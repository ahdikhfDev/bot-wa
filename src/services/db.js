import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '../database.sqlite');

let db;
let SQL;

async function initDb() {
    if (!SQL) {
        SQL = await initSqlJs();
    }

    // Load existing database or create new
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Tabel untuk menyimpan jadwal
    db.run(`
        CREATE TABLE IF NOT EXISTS jadwal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            tanggal TEXT NOT NULL,
            event TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tabel untuk menyimpan konteks percakapan grup
    db.run(`
        CREATE TABLE IF NOT EXISTS group_context (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tabel untuk menyimpan pengaturan chat (seperti mode AI)
    db.run(`
        CREATE TABLE IF NOT EXISTS chat_settings (
            chat_id TEXT PRIMARY KEY,
            ai_mode TEXT NOT NULL DEFAULT 'asik'
        )
    `);

    // Tabel untuk whitelist akses bot
    db.run(`
        CREATE TABLE IF NOT EXISTS whitelist (
            jid TEXT PRIMARY KEY,
            name TEXT DEFAULT '',
            added_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // Add name column if missing (migrate old DB)
    try { db.run('ALTER TABLE whitelist ADD COLUMN name TEXT DEFAULT ""'); } catch {}

    // Tabel untuk Auto Reminder / Alarm
    db.run(`
        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            trigger_time INTEGER NOT NULL,
            message TEXT NOT NULL,
            status TEXT DEFAULT 'pending'
        )
    `);

    // Tabel untuk Long-Term Memory / Learning
    db.run(`
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            confidence INTEGER DEFAULT 1,
            access_count INTEGER DEFAULT 0,
            keywords TEXT DEFAULT '',
            source TEXT DEFAULT 'chat',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_accessed TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Add keywords/source columns if missing (migrate old DB)
    try { db.run('ALTER TABLE memories ADD COLUMN keywords TEXT DEFAULT ""'); } catch {}
    try { db.run('ALTER TABLE memories ADD COLUMN source TEXT DEFAULT "chat"'); } catch {}

    // Tabel untuk tracking interaction count per grup (learning trigger)
    db.run(`
        CREATE TABLE IF NOT EXISTS learning_tracker (
            group_id TEXT PRIMARY KEY,
            message_count INTEGER DEFAULT 0,
            last_learn_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tabel untuk pending broadcast (survive restart)
    db.run(`
        CREATE TABLE IF NOT EXISTS pending_broadcasts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jid TEXT NOT NULL,
            target_jids TEXT NOT NULL,
            target_names TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    initSkillsTable();
    initSettingsTable();
    saveDb();
    console.log('💾 Database initialized');
}

function saveDb() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

export function initDatabase() {
    return initDb();
}

export function getDb() {
    return db;
}

// ==================== JADWAL FUNCTIONS ====================

export function addJadwal(groupId, tanggal, event) {
    if (!db) return null;
    db.run('INSERT INTO jadwal (group_id, tanggal, event) VALUES (?, ?, ?)', [groupId, tanggal, event]);
    const result = db.exec('SELECT last_insert_rowid() as id');
    saveDb();
    return result[0]?.values[0]?.[0] || null;
}

export function getJadwal(groupId) {
    if (!db) return [];
    const result = db.exec('SELECT * FROM jadwal WHERE group_id = ? ORDER BY tanggal ASC', [groupId]);
    if (!result.length) return [];

    const columns = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });
}

export function deleteJadwal(id, groupId) {
    if (!db) return false;
    db.run('DELETE FROM jadwal WHERE id = ? AND group_id = ?', [id, groupId]);
    const changes = db.getRowsModified();
    saveDb();
    return changes > 0;
}

// ==================== GROUP CONTEXT FUNCTIONS ====================

export function addContextMessage(groupId, sender, message) {
    if (!db) return;
    const maxMessages = parseInt(process.env.MAX_CONTEXT_MESSAGES) || 20;

    db.run('INSERT INTO group_context (group_id, sender, message) VALUES (?, ?, ?)', [groupId, sender, message]);

    // Cleanup: keep only last N messages per group
    db.run(`
        DELETE FROM group_context WHERE id IN (
            SELECT id FROM group_context
            WHERE group_id = ?
            ORDER BY timestamp DESC
            LIMIT -1 OFFSET ${maxMessages}
        )
    `, [groupId]);

    saveDb();
}

export function getGroupHistory(groupId, limit = 20) {
    if (!db) return [];
    const result = db.exec(`
        SELECT * FROM group_context
        WHERE group_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `, [groupId, limit]);

    if (!result.length) return [];

    const columns = result[0].columns;
    const messages = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });

    return messages.reverse(); // Chronological order
}

export function clearGroupContext(groupId) {
    if (!db) return;
    db.run('DELETE FROM group_context WHERE group_id = ?', [groupId]);
    saveDb();
}

// ==================== SETTINGS FUNCTIONS ====================

export function setMode(chatId, mode) {
    if (!db) return;
    db.run('INSERT OR REPLACE INTO chat_settings (chat_id, ai_mode) VALUES (?, ?)', [chatId, mode]);
    saveDb();
}

export function getMode(chatId) {
    if (!db) return 'asik'; // default mode
    const result = db.exec('SELECT ai_mode FROM chat_settings WHERE chat_id = ?', [chatId]);
    if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0];
    }
    return 'asik'; // default
}

// ==================== WHITELIST FUNCTIONS ====================

export function isWhitelisted(jid) {
    if (!db) return false;
    const result = db.exec('SELECT 1 FROM whitelist WHERE jid = ?', [jid]);
    return result.length > 0 && result[0].values.length > 0;
}

export function addWhitelist(jid, name = '') {
    if (!db) return;
    if (name) {
        db.run('INSERT OR REPLACE INTO whitelist (jid, name) VALUES (?, ?)', [jid, name]);
    } else {
        db.run('INSERT OR IGNORE INTO whitelist (jid) VALUES (?)', [jid]);
    }
    saveDb();
}

export function removeWhitelist(jid) {
    if (!db) return;
    db.run('DELETE FROM whitelist WHERE jid = ?', [jid]);
    saveDb();
}

export function getAllWhitelist() {
    if (!db) return [];
    const result = db.exec('SELECT jid, name, added_at FROM whitelist');
    if (!result.length) return [];
    return result[0].values.map(row => ({
        jid: row[0],
        name: row[1] || '',
        addedAt: row[2] || ''
    }));
}

// ==================== REMINDERS FUNCTIONS ====================

export function addReminder(chatId, triggerTimeMs, message) {
    if (!db) return;
    db.run('INSERT INTO reminders (chat_id, trigger_time, message, status) VALUES (?, ?, ?, ?)', [chatId, triggerTimeMs, message, 'pending']);
    saveDb();
}

export function getPendingReminders() {
    if (!db) return [];
    const now = Date.now();
    const result = db.exec('SELECT id, chat_id, message FROM reminders WHERE status = "pending" AND trigger_time <= ?', [now]);
    if (!result.length) return [];
    return result[0].values.map(row => ({
        id: row[0],
        chatId: row[1],
        message: row[2]
    }));
}

export function markReminderDone(id) {
    if (!db) return;
    db.run('UPDATE reminders SET status = "done" WHERE id = ?', [id]);
    saveDb();
}

// ==================== LONG-TERM MEMORY / LEARNING FUNCTIONS ====================

// Extract keywords from text (simple: unique words 3+ chars, lowercased)
function extractKeywords(text) {
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    return [...new Set(words)].slice(0, 20).join(' ');
}

export function addMemory(groupId, content, category = 'general', confidence = 1, source = 'chat') {
    if (!db || !content) return;
    const keywords = extractKeywords(content);
    db.run('INSERT INTO memories (group_id, content, category, confidence, keywords, source) VALUES (?, ?, ?, ?, ?, ?)',
        [groupId, content, category, confidence, keywords, source]);
    saveDb();
}

export function getMemories(groupId, limit = 10, category = null) {
    if (!db) return [];
    let query = 'SELECT * FROM memories WHERE group_id = ?';
    const params = [groupId];
    if (category) {
        query += ' AND category = ?';
        params.push(category);
    }
    query += ' ORDER BY confidence DESC, access_count DESC, last_accessed DESC LIMIT ?';
    params.push(limit);

    const result = db.exec(query, params);
    if (!result.length) return [];

    const columns = result[0].columns;
    const memories = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });

    for (const m of memories) {
        db.run('UPDATE memories SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP WHERE id = ?', [m.id]);
    }
    saveDb();

    return memories;
}

// RAG Search: BM25-like scoring with term frequency analysis
export function searchMemoriesRAG(groupId, query, limit = 5) {
    if (!db || !query) return [];

    const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return [];

    // Get all memories for this group
    const result = db.exec(
        'SELECT *, julianday("now") - julianday(last_accessed) as days_old FROM memories WHERE group_id = ?',
        [groupId]
    );
    if (!result.length || !result[0].values.length) return [];

    const cols = result[0].columns;
    const memories = result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
    });

    // Score each memory using term frequency matching
    const scored = memories.map(m => {
        const content = (m.content || '').toLowerCase();
        const keywords = (m.keywords || '').toLowerCase();
        const combined = `${content} ${keywords}`;
        const contentWords = combined.split(/\W+/).filter(w => w.length > 2);

        let score = 0;
        const matchedTerms = new Set();

        for (const qw of queryWords) {
            // Exact match in content
            if (contentWords.includes(qw)) {
                score += 3;
                matchedTerms.add(qw);
                // Count frequency
                const freq = contentWords.filter(w => w === qw).length;
                score += Math.min(freq - 1, 2) * 0.5;
                continue;
            }
            // Partial match: word starts with query or vice versa
            const partialMatch = contentWords.some(w =>
                w.startsWith(qw) || qw.startsWith(w) ||
                w.includes(qw) || qw.includes(w)
            );
            if (partialMatch) {
                score += 1.5;
                matchedTerms.add(qw);
                continue;
            }
            // Check in keywords
            if (keywords.includes(qw)) {
                score += 2;
                matchedTerms.add(qw);
            }
        }

        // If no match at all, skip
        if (matchedTerms.size === 0) return null;

        // Boost by number of matched terms vs query length
        const matchRatio = matchedTerms.size / Math.max(queryWords.length, 1);
        score *= (0.5 + matchRatio * 0.5);

        // Confidence boost
        score += (m.confidence || 1) * 1.5;

        // Recency boost (memories accessed recently get a small bonus)
        const daysOld = m.days_old || 999;
        if (daysOld < 1) score += 2;
        else if (daysOld < 7) score += 1;

        // Access count boost (capped)
        score += Math.min((m.access_count || 0), 10) * 0.3;

        return { memory: m, score };
    }).filter(Boolean);

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Take top results
    const top = scored.slice(0, limit).map(s => {
        const m = s.memory;
        // Attach score for AI to determine injection threshold
        m._ragScore = s.score;
        // Update access stats
        db.run('UPDATE memories SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP WHERE id = ?', [m.id]);
        return m;
    });

    saveDb();
    return top;
}

// Fallback: simple keyword search
export function searchMemories(groupId, keyword, limit = 5) {
    if (!db) return [];
    const result = db.exec(
        'SELECT * FROM memories WHERE group_id = ? AND (content LIKE ? OR keywords LIKE ?) ORDER BY confidence DESC, access_count DESC LIMIT ?',
        [groupId, `%${keyword}%`, `%${keyword}%`, limit]
    );
    if (!result.length) return [];

    const columns = result[0].columns;
    const memories = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });

    for (const m of memories) {
        db.run('UPDATE memories SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP WHERE id = ?', [m.id]);
    }
    saveDb();

    return memories;
}

export function clearMemories(groupId) {
    if (!db) return;
    db.run('DELETE FROM memories WHERE group_id = ?', [groupId]);
    saveDb();
}

// ==================== LEARNING TRACKER ====================

export function getInteractionCount(groupId) {
    if (!db) return 0;
    const result = db.exec('SELECT message_count FROM learning_tracker WHERE group_id = ?', [groupId]);
    if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0];
    }
    return 0;
}

export function incrementInteractionCount(groupId) {
    if (!db) return;
    db.run(`
        INSERT INTO learning_tracker (group_id, message_count) VALUES (?, 1)
        ON CONFLICT(group_id) DO UPDATE SET message_count = message_count + 1
    `, [groupId]);
    saveDb();
}

export function resetInteractionCount(groupId) {
    if (!db) return;
    db.run('INSERT OR REPLACE INTO learning_tracker (group_id, message_count) VALUES (?, 0)', [groupId]);
    saveDb();
}

// ==================== BROADCAST SHARED STATE ====================

export const broadcastTargets = new Map();

// Pending broadcast: in-memory + DB persistence
export const pendingBroadcasts = new Map();

export function savePendingBroadcast(jid, targets, message) {
    if (!db) return;
    const targetJids = JSON.stringify([...targets.keys()]);
    const targetNames = JSON.stringify([...targets.values()]);
    db.run('INSERT INTO pending_broadcasts (jid, target_jids, target_names, message) VALUES (?, ?, ?, ?)',
        [jid, targetJids, targetNames, message]);
    saveDb();
    // Get the id
    const result = db.exec('SELECT last_insert_rowid() as id');
    const id = result[0]?.values[0]?.[0];
    pendingBroadcasts.set(jid, { targets, message, id });
    return id;
}

export function deletePendingBroadcast(jid) {
    if (!db) return;
    const pending = pendingBroadcasts.get(jid);
    if (pending?.id) {
        db.run('DELETE FROM pending_broadcasts WHERE id = ?', [pending.id]);
        saveDb();
    }
    pendingBroadcasts.delete(jid);
}

export function loadPendingBroadcasts() {
    if (!db) return;
    try {
        const result = db.exec('SELECT * FROM pending_broadcasts');
        if (!result.length) return;
        const rows = result[0].values;
        for (const row of rows) {
            try {
                const jids = JSON.parse(row[2]);
                const names = JSON.parse(row[3]);
                const targets = new Map();
                jids.forEach((j, i) => targets.set(j, names[i] || 'Unknown'));
                pendingBroadcasts.set(row[1], { targets, message: row[4], id: row[0] });
            } catch {}
        }
        console.log(`📡 Loaded ${rows.length} pending broadcasts from DB`);
    } catch (err) {
        console.warn('⚠️ Gagal load pending broadcasts:', err.message);
    }
}

// ==================== SKILL SYSTEM ====================

export function initSkillsTable() {
    if (!db) return;
    db.run(`
        CREATE TABLE IF NOT EXISTS skills (
            name TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            enabled INTEGER DEFAULT 1,
            owner_only INTEGER DEFAULT 0,
            group_only INTEGER DEFAULT 0,
            has_config INTEGER DEFAULT 0,
            commands TEXT DEFAULT '[]'
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS skill_configs (
            skill_name TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT DEFAULT '',
            PRIMARY KEY (skill_name, key)
        )
    `);
    saveDb();
}

export function registerSkill(name, title, description, commands, opts = {}) {
    if (!db) return;
    commands = JSON.stringify(commands || []);
    const ownerOnly = opts.ownerOnly ? 1 : 0;
    const groupOnly = opts.groupOnly ? 1 : 0;
    const hasConfig = opts.hasConfig ? 1 : 0;
    db.run(`
        INSERT OR IGNORE INTO skills (name, title, description, enabled, owner_only, group_only, has_config, commands)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `, [name, title, description, ownerOnly, groupOnly, hasConfig, commands]);
    saveDb();
}

export function getSkill(name) {
    if (!db) return null;
    const result = db.exec('SELECT * FROM skills WHERE name = ?', [name]);
    if (!result.length || !result[0].values.length) return null;
    const cols = result[0].columns;
    const row = result[0].values[0];
    const skill = {};
    cols.forEach((c, i) => skill[c] = row[i]);
    if (typeof skill.commands === 'string') {
        try { skill.commands = JSON.parse(skill.commands); } catch { skill.commands = []; }
    }
    return skill;
}

export function getAllSkills() {
    if (!db) return [];
    const result = db.exec('SELECT * FROM skills ORDER BY name');
    if (!result.length) return [];
    const cols = result[0].columns;
    return result[0].values.map(row => {
        const skill = {};
        cols.forEach((c, i) => skill[c] = row[i]);
        if (typeof skill.commands === 'string') {
            try { skill.commands = JSON.parse(skill.commands); } catch { skill.commands = []; }
        }
        return skill;
    });
}

export function isSkillEnabled(name) {
    if (!db) return true;
    const result = db.exec('SELECT enabled FROM skills WHERE name = ?', [name]);
    if (result.length && result[0].values.length) {
        return result[0].values[0][0] === 1;
    }
    return true;
}

export function setSkillEnabled(name, enabled) {
    if (!db) return;
    db.run('UPDATE skills SET enabled = ? WHERE name = ?', [enabled ? 1 : 0, name]);
    saveDb();
}

export function getSkillConfig(skillName, key, defaultValue = '') {
    if (!db) return defaultValue;
    const result = db.exec('SELECT value FROM skill_configs WHERE skill_name = ? AND key = ?', [skillName, key]);
    if (result.length && result[0].values.length) {
        return result[0].values[0][0] || defaultValue;
    }
    return defaultValue;
}

export function setSkillConfig(skillName, key, value) {
    if (!db) return;
    db.run('INSERT OR REPLACE INTO skill_configs (skill_name, key, value) VALUES (?, ?, ?)', [skillName, key, value]);
    saveDb();
}

export function getAllSkillConfigs(skillName) {
    if (!db) return {};
    const result = db.exec('SELECT key, value FROM skill_configs WHERE skill_name = ?', [skillName]);
    if (!result.length) return {};
    const config = {};
    result[0].values.forEach(row => { config[row[0]] = row[1]; });
    return config;
}

// ==================== BOT SETTINGS (key-value) ====================

export function initSettingsTable() {
    if (!db) return;
    db.run(`
        CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        )
    `);
    saveDb();
}

export function getSetting(key, defaultValue = '') {
    if (!db) return defaultValue;
    const result = db.exec('SELECT value FROM bot_settings WHERE key = ?', [key]);
    if (result.length && result[0].values.length) {
        return result[0].values[0][0] || defaultValue;
    }
    return defaultValue;
}

export function setSetting(key, value) {
    if (!db) return;
    db.run('INSERT OR REPLACE INTO bot_settings (key, value) VALUES (?, ?)', [key, value]);
    saveDb();
}

export function getAllSettings() {
    if (!db) return {};
    const result = db.exec('SELECT key, value FROM bot_settings');
    if (!result.length) return {};
    const settings = {};
    result[0].values.forEach(row => { settings[row[0]] = row[1]; });
    return settings;
}