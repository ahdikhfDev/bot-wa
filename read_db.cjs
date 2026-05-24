const Database = require('better-sqlite3');
const db = new Database('src/database.sqlite');
db.pragma('journal_mode = DELETE');
const r = db.prepare('SELECT key, value FROM bot_settings').all();
console.log('Current DB (DELETE mode):', JSON.stringify(r, null, 2));
db.close();
