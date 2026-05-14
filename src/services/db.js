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
            added_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

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

export function addWhitelist(jid) {
    if (!db) return;
    db.run('INSERT OR IGNORE INTO whitelist (jid) VALUES (?)', [jid]);
    saveDb();
}

export function removeWhitelist(jid) {
    if (!db) return;
    db.run('DELETE FROM whitelist WHERE jid = ?', [jid]);
    saveDb();
}

export function getAllWhitelist() {
    if (!db) return [];
    const result = db.exec('SELECT jid, added_at FROM whitelist');
    if (!result.length) return [];
    return result[0].values.map(row => ({
        jid: row[0],
        addedAt: row[1]
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