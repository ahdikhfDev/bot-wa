import fs from 'fs';

let code = fs.readFileSync('src/services/db.js.sqljs-backup', 'utf8');

// 1. Import
code = code.replace("import initSqlJs from 'sql.js';", "import Database from 'better-sqlite3';");

// 2. Remove SQL variable
code = code.replace('\nlet SQL;\n', '\n');

// 3. Remove async from initDb
code = code.replace('async function initDb() {', 'function initDb() {');

// 4. Replace init block
code = code.replace(
    "    if (!SQL) {\n        SQL = await initSqlJs();\n    }\n\n    // Load existing database or create new\n    if (fs.existsSync(dbPath)) {\n        const fileBuffer = fs.readFileSync(dbPath);\n        db = new SQL.Database(fileBuffer);\n    } else {\n        db = new SQL.Database();\n    }",
    "    db = new Database(dbPath);\n    db.pragma('journal_mode = WAL');"
);

// 5. initDatabase no longer async
code = code.replace(
    'export function initDatabase() {\n    return initDb();\n}',
    'export function initDatabase() {\n    initDb();\n}'
);

// 6. DDL: CREATE/ALTER TABLE with db.run -> db.exec
code = code.replace(/db\.run\('(CREATE|ALTER) TABLE/g, "db.exec('$1 TABLE");
code = code.replace(/db\.run\(`(CREATE|ALTER) TABLE/g, 'db.exec(`$1 TABLE');

// 7. DML: db.run('INSERT/UPDATE/DELETE...', [params]) -> db.prepare('...').run(params)
// Single-quoted SQL
code = code.replace(/db\.run\('((?:[^'\\]|\\.)*?)',\s*\[([^\]]*?)\]\s*\)/g, (_, sql, params) => {
    const p = params.split(',').map(x => x.trim()).filter(Boolean).join(', ');
    return `db.prepare('${sql}').run(${p})`;
});
// Template literal SQL
code = code.replace(/db\.run\(`([^`]*)`,\s*\[([^\]]*?)\]\s*\)/g, (_, sql, params) => {
    const p = params.split(',').map(x => x.trim()).filter(Boolean).join(', ');
    return `db.prepare(\`${sql}\`).run(${p})`;
});

// 8. SELECT: db.exec('SELECT...', [params]) -> db.prepare('...').all(params)
code = code.replace(/db\.exec\('((?:[^'\\]|\\.)*?)',\s*\[([^\]]*?)\]\s*\)/g, (_, sql, params) => {
    const p = params.split(',').map(x => x.trim()).filter(Boolean).join(', ');
    return `db.prepare('${sql}').all(${p})`;
});
code = code.replace(/db\.exec\(`([^`]*)`,\s*\[([^\]]*?)\]\s*\)/g, (_, sql, params) => {
    const p = params.split(',').map(x => x.trim()).filter(Boolean).join(', ');
    return `db.prepare(\`${sql}\`).all(${p})`;
});

// 9. rebuildVectorIndex
code = code.replace(
    "const rows = db.exec(\"SELECT group_id, id, content FROM memories\");\n        if (rows[0]?.values) {\n            for (const [chatId, id, content] of rows[0].values) {",
    "const rows = db.prepare(\"SELECT group_id, id, content FROM memories\").all();\n        for (const row of rows) {\n            const chatId = row.group_id;\n            const id = row.id;\n            const content = row.content;"
);
code = code.replace(
    'console.log("🧠 Vector index rebuilt from " + (rows[0]?.values?.length || 0) + " memories");',
    'console.log("🧠 Vector index rebuilt from " + rows.length + " memories");'
);

// 10. saveDb -> no-op
code = code.replace(
    /let _saveTimer = null;\nfunction saveDb\(\) \{[\s\S]*?\n\}/,
    'function saveDb() {\n    // No-op: better-sqlite3 writes to disk automatically\n}'
);

// 11. flushDb -> no-op
code = code.replace(
    /export function flushDb\(\) \{[\s\S]*?\n\}/,
    'export function flushDb() {\n    if (!db) return;\n    // No-op: better-sqlite3 writes to disk automatically\n}'
);

// 12. Exit handler
code = code.replace(
    "process.on('exit', () => flushDb());",
    "process.on('exit', () => { try { db?.close(); } catch {} });"
);

// 13. getRowsModified
code = code.replace(
    "const changes = db.getRowsModified();\n",
    ""
);

// 14. addJadwal with last_insert_rowid
code = code.replace(
    "db.prepare('INSERT INTO jadwal (group_id, tanggal, event) VALUES (?, ?, ?)').run(groupId, tanggal, event);\n    const result = db.exec('SELECT last_insert_rowid() as id');\n    saveDb();\n    return result[0]?.values[0]?.[0] || null;",
    "const info = db.prepare('INSERT INTO jadwal (group_id, tanggal, event) VALUES (?, ?, ?)').run(groupId, tanggal, event);\n    saveDb();\n    return info.lastInsertRowid || null;"
);

// 15. savePendingBroadcast last_insert_rowid
code = code.replace(
    "const info = db.prepare('INSERT INTO pending_broadcasts (jid, target_jids, target_names, message) VALUES (?, ?, ?, ?)').run(jid, targetJids, targetNames, message);\n    saveDb();\n    // Get the id\n    const result = db.exec('SELECT last_insert_rowid() as id');\n    const id = result[0]?.values[0]?.[0];",
    "const info = db.prepare('INSERT INTO pending_broadcasts (jid, target_jids, target_names, message) VALUES (?, ?, ?, ?)').run(jid, targetJids, targetNames, message);\n    saveDb();\n    const id = info.lastInsertRowid;"
);

// 16. getJadwal - result parsing
code = code.replace(
    /const result = db\.prepare\('SELECT \* FROM jadwal WHERE group_id = \? ORDER BY tanggal ASC'\)\.all\(groupId\);\n    if \(!result\.length\) return \[\];\n\n    const columns = result\[0\]\.columns;\n    return result\[0\]\.values\.map/g,
    "const rows = db.prepare('SELECT * FROM jadwal WHERE group_id = ? ORDER BY tanggal ASC').all(groupId);\n    return rows"
);

// 17. getGroupHistory
code = code.replace(
    /const result = db\.prepare\('SELECT \* FROM group_context WHERE group_id = \? ORDER BY timestamp DESC LIMIT \?'\)\.all\(groupId, limit\);\n\n    if \(!result\.length\) return \[\];\n\n    const columns = result\[0\]\.columns;\n    const messages = result\[0\]\.values\.map/g,
    "const rows = db.prepare('SELECT * FROM group_context WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?').all(groupId, limit);\n    const messages = rows"
);

// 18. getAllWhitelist
code = code.replace(
    /const result = db\.prepare\('SELECT jid, name, added_at FROM whitelist'\)\.all\(\);\n    if \(!result\.length\) return \[\];\n    return result\[0\]\.values\.map/g,
    "const rows = db.prepare('SELECT jid, name, added_at FROM whitelist').all();\n    return rows"
);

// 19. getAllCustomModes
code = code.replace(
    /const r = db\.prepare\('SELECT name, system_prompt, temperature, created_at FROM custom_modes ORDER BY name'\)\.all\(\);\n    if \(!r\.length\) return \[\];\n    const cols = r\[0\]\.columns;\n    return r\[0\]\.values\.map/g,
    "const rows = db.prepare('SELECT name, system_prompt, temperature, created_at FROM custom_modes ORDER BY name').all();\n    return rows"
);

// 20. Remaining result[0].values[0][0] patterns
code = code.replace(/result\[0\]\?\.values\[0\]\?\.\[0\]/g, 'row');
code = code.replace(/result\[0\]\.values\[0\]\[0\]/g, 'row');

// 21. Remaining result[0]?.values[0]?.[0] plural
code = code.replace(/result\[0\]\?\.values\[0\]\?\.\[0\]/g, 'row');

// 22. Replace remaining result.length patterns from old SELECT queries
code = code.replace(
    /const result = db\.prepare\('SELECT ([^']+) FROM ([^']+) WHERE ([^']+) = \?'\)\.all\(([^)]+)\);\n    if \(!result\.length\) return \[\];/g,
    "const result = db.prepare('SELECT $1 FROM $2 WHERE $3 = ?').all($4);"
);

// 23. getMode - specific pattern
code = code.replace(
    /const result = db\.prepare\('SELECT ai_mode FROM chat_settings WHERE chat_id = \?'\)\.all\(chatId\);\n    if \(!result\.length && !result\[0\]\.values\.length\) \{\n        return result\[0\]\.values\[0\]\[0\];\n    \}\n    return 'asik';/,
    "const row = db.prepare('SELECT ai_mode FROM chat_settings WHERE chat_id = ?').get(chatId);\n    return row?.ai_mode || 'asik';"
);

// 24. isWhitelisted
code = code.replace(
    /const result = db\.prepare\('SELECT 1 FROM whitelist WHERE jid = \?'\)\.all\(jid\);\n    return result\.length > 0 && result\[0\]\.values\.length > 0;/,
    "const row = db.prepare('SELECT 1 FROM whitelist WHERE jid = ?').get(jid);\n    return !!row;"
);

// 25. getInteractionCount
code = code.replace(
    /const result = db\.prepare\('SELECT message_count FROM learning_tracker WHERE group_id = \?'\)\.all\(groupId\);\n    if \(!result\.length && !result\[0\]\.values\.length\) \{\n        return result\[0\]\.values\[0\]\[0\];\n    \}\n    return 0;/,
    "const row = db.prepare('SELECT message_count FROM learning_tracker WHERE group_id = ?').get(groupId);\n    return row?.message_count || 0;"
);

// 26. getSetting
code = code.replace(
    /const result = db\.prepare\('SELECT value FROM bot_settings WHERE key = \?'\)\.all\(key\);\n    if \(!result\.length && !result\[0\]\.values\.length\) \{\n        return result\[0\]\.values\[0\]\[0\] \|\| defaultValue;\n    \}\n    return defaultValue;/,
    "const row = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);\n    return row?.value || defaultValue;"
);

// 27. getConversationSummary
code = code.replace(
    /const r = db\.prepare\('SELECT summary FROM conversation_summaries WHERE chat_id = \? ORDER BY created_at DESC LIMIT 1'\)\.all\(chatId\);\n    if \(!r\.length && !r\[0\]\.values\.length\) return r\[0\]\.values\[0\]\[0\] \|\| '';\n    return '';/,
    "const row = db.prepare('SELECT summary FROM conversation_summaries WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1').get(chatId);\n    return row?.summary || '';"
);

// 28. getUserProfile
code = code.replace(
    /const r = db\.prepare\('SELECT jid, name, facts, timezone FROM user_profiles WHERE jid = \?'\)\.all\(jid\);\n    if \(!r\.length \|\| !r\[0\]\.values\.length\) return null;\n    const row = r\[0\]\.values\[0\];/,
    "const row = db.prepare('SELECT jid, name, facts, timezone FROM user_profiles WHERE jid = ?').get(jid);\n    if (!row) return null;"
);

// 29. getAllUserProfiles
code = code.replace(
    /const r = db\.prepare\('SELECT jid, name, facts, timezone, updated_at FROM user_profiles ORDER BY updated_at DESC'\)\.all\(\);\n    if \(!r\.length\) return \[\];\n    const cols = r\[0\]\.columns;\n    return r\[0\]\.values\.map/g,
    "const rows = db.prepare('SELECT jid, name, facts, timezone, updated_at FROM user_profiles ORDER BY updated_at DESC').all();\n    return rows"
);

// 30. isSkillEnabled
code = code.replace(
    /const result = db\.prepare\('SELECT enabled FROM skills WHERE name = \?'\)\.all\(name\);\n    if \(!result\.length && !result\[0\]\.values\.length\) \{\n        return result\[0\]\.values\[0\]\[0\] === 1;\n    \}\n    return true;/,
    "const row = db.prepare('SELECT enabled FROM skills WHERE name = ?').get(name);\n    return row ? row.enabled === 1 : true;"
);

// 31. getSkillConfig
code = code.replace(
    /const result = db\.prepare\('SELECT value FROM skill_configs WHERE skill_name = \? AND key = \?'\)\.all\(skillName, key\);\n    if \(!result\.length && !result\[0\]\.values\.length\) \{\n        return result\[0\]\.values\[0\]\[0\] \|\| defaultValue;\n    \}\n    return defaultValue;/,
    "const row = db.prepare('SELECT value FROM skill_configs WHERE skill_name = ? AND key = ?').get(skillName, key);\n    return row?.value || defaultValue;"
);

// 32. getAllSkillConfigs
code = code.replace(
    /const result = db\.prepare\('SELECT key, value FROM skill_configs WHERE skill_name = \?'\)\.all\(skillName\);\n    if \(!result\.length\) return \{\};\n    const config = \{\};\n    result\[0\]\.values\.forEach/g,
    "const rows = db.prepare('SELECT key, value FROM skill_configs WHERE skill_name = ?').all(skillName);\n    const config = {};\n    rows"
);

// 33. getAllSettings
code = code.replace(
    /const result = db\.prepare\('SELECT key, value FROM bot_settings'\)\.all\(\);\n    if \(!result\.length\) return \{\};\n    const settings = \{\};\n    result\[0\]\.values\.forEach/g,
    "const rows = db.prepare('SELECT key, value FROM bot_settings').all();\n    const settings = {};\n    rows"
);

// 34. getTokenUsageSummary
code = code.replace(
    /const r = db\.prepare\('SELECT COALESCE\(SUM\(prompt_tokens\),0\), COALESCE\(SUM\(completion_tokens\),0\), COUNT\(\*\) FROM token_usage'\)\.all\(\);\n    if \(!r\.length\) return/,
    "const row = db.prepare('SELECT COALESCE(SUM(prompt_tokens),0) as total_p, COALESCE(SUM(completion_tokens),0) as total_c, COUNT(*) as cnt FROM token_usage').get();\n    if (!row) return"
);

// 34b. getTokenUsageSummary - return block
code = code.replace(
    /const totalPrompt = parseInt\(row\[0\]\) \|\| 0;\n    const totalCompletion = parseInt\(row\[1\]\) \|\| 0;\n    return \{ totalPrompt, totalCompletion, totalAll: totalPrompt \+ totalCompletion, count: parseInt\(row\[2\]\) \|\| 0 \};/,
    "const totalPrompt = parseInt(row.total_p) || 0;\n    const totalCompletion = parseInt(row.total_c) || 0;\n    return { totalPrompt, totalCompletion, totalAll: totalPrompt + totalCompletion, count: parseInt(row.cnt) || 0 };"
);

// 35. getSkill
code = code.replace(
    /const result = db\.prepare\('SELECT \* FROM skills WHERE name = \?'\)\.all\(name\);\n    if \(!result\.length \|\| !result\[0\]\.values\.length\) return null;\n    const cols = result\[0\]\.columns;\n    const row = result\[0\]\.values\[0\];\n    const skill = \{\};\n    cols\.forEach\(\(c, i\) => skill\[c\] = row\[i\]\);/,
    "const skill = db.prepare('SELECT * FROM skills WHERE name = ?').get(name);\n    if (!skill) return null;"
);

// 36. getAllSkills
code = code.replace(
    /const result = db\.prepare\('SELECT \* FROM skills ORDER BY name'\)\.all\(\);\n    if \(!result\.length\) return \[\];\n    const cols = result\[0\]\.columns;\n    return result\[0\]\.values\.map\(row => \{\n        const skill = \{\};\n        cols\.forEach\(\(c, i\) => skill\[c\] = row\[i\]\);/,
    "const skills = db.prepare('SELECT * FROM skills ORDER BY name').all();\n    for (const skill of skills) {"
);

// 37. getCustomMode
code = code.replace(
    /const r = db\.prepare\('SELECT \* FROM custom_modes WHERE name = \?'\)\.all\(name\);\n    if \(!r\.length \|\| !r\[0\]\.values\.length\) return null;\n    const cols = r\[0\]\.columns;\n    const row = r\[0\]\.values\[0\];\n    const obj = \{\};\n    cols\.forEach\(\(c, i\) => obj\[c\] = row\[i\]\);/,
    "const obj = db.prepare('SELECT * FROM custom_modes WHERE name = ?').get(name);\n    if (!obj) return null;"
);

// 38. getAllSkills return block (after .map -> for loop)
// Fix: the for loop version still has .map -> change to direct return
code = code.replace(
    /return skills = db\.prepare\('SELECT \* FROM skills ORDER BY name'\)\.all\(\);\n    for \(const skill of skills\) \{/,
    "const skills = db.prepare('SELECT * FROM skills ORDER BY name').all();\n    return skills;"
);

// 39. Fix searchMemories (the LIKE search)
code = code.replace(
    /const memories = db\.prepare\('SELECT \* FROM memories WHERE group_id = \? AND \(content LIKE \? OR keywords LIKE \?\) ORDER BY confidence DESC, access_count DESC LIMIT \?'\)\.all\(groupId, "%" \+ keyword \+ "%", "%" \+ keyword \+ "%", limit\);\n    const updateStmt = db\.prepare\('UPDATE memories SET access_count = access_count \+ 1, last_accessed = CURRENT_TIMESTAMP WHERE id = \?'\);\n    for \(const m of memories\) \{\n        updateStmt\.run\(m\.id\);\n    \}\n    saveDb\(\);\n    return memories;/,
    "const memories = db.prepare('SELECT * FROM memories WHERE group_id = ? AND (content LIKE ? OR keywords LIKE ?) ORDER BY confidence DESC, access_count DESC LIMIT ?').all(groupId, `%${keyword}%`, `%${keyword}%`, limit);\n    const updateStmt = db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP WHERE id = ?');\n    for (const m of memories) {\n        updateStmt.run(m.id);\n    }\n    saveDb();\n    return memories;"
);

// 40. Fix old result parsing left over in a few places
code = code.replace(/result\[0\]\.values\.forEach/g, 'rows.forEach');
code = code.replace(/result\[0\]\.values/g, 'rows');

// 41. Fix loadPendingBroadcasts - already handled by regex above but verify
code = code.replace(
    "const rows = db.prepare('SELECT * FROM pending_broadcasts').all();\n        if (!rows.length) return;\n        const rows = db.prepare('SELECT * FROM pending_broadcasts').all();",
    "const rows = db.prepare('SELECT * FROM pending_broadcasts').all();\n        if (!rows.length) return;"
);

// 42. deleteJadwal - changes > 0
code = code.replace(
    'return info.changes > 0;',
    'return info.changes > 0;'
);

fs.writeFileSync('src/services/db.js', code);
console.log('Migration applied. Lines:', code.split('\n').length);
