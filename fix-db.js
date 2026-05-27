import fs from 'fs';

let code = fs.readFileSync('src/services/db.js', 'utf8');

// Fix getMode
code = code.replace(
    "const result = db.prepare('SELECT ai_mode FROM chat_settings WHERE chat_id = ?').all(chatId);\n    if (result.length > 0 && rows.length > 0) {\n        return row;\n    }\n    return 'asik'; // default",
    "const row = db.prepare('SELECT ai_mode FROM chat_settings WHERE chat_id = ?').get(chatId);\n    return row?.ai_mode || 'asik';"
);

// Fix searchMemoriesRAG - db.exec with columns/values
code = code.replace(
    "const result = db.exec(\n        'SELECT *, julianday(\"now\") - julianday(last_accessed) as days_old FROM memories WHERE group_id = ?',\n        [groupId]\n    );\n    if (!result.length || !rows.length) return [];\n\n    const cols = result[0].columns;\n    const memories = rows.map(row => {\n        const obj = {};\n        cols.forEach((c, i) => obj[c] = row[i]);",
    "const memories = db.prepare('SELECT *, julianday(\"now\") - julianday(last_accessed) as days_old FROM memories WHERE group_id = ?').all(groupId);\n    if (!memories.length) return [];"
);

// Fix getInteractionCount
code = code.replace(
    "const result = db.prepare('SELECT message_count FROM learning_tracker WHERE group_id = ?').all(groupId);\n    if (result.length > 0 && rows.length > 0) {\n        return row;\n    }\n    return 0;",
    "const row = db.prepare('SELECT message_count FROM learning_tracker WHERE group_id = ?').get(groupId);\n    return row?.message_count || 0;"
);

// Fix isSkillEnabled
code = code.replace(
    "const result = db.prepare('SELECT enabled FROM skills WHERE name = ?').all(name);\n    if (result.length && rows.length) {\n        return row === 1;\n    }\n    return true;",
    "const row = db.prepare('SELECT enabled FROM skills WHERE name = ?').get(name);\n    return row ? row.enabled === 1 : true;"
);

// Fix getSkillConfig
code = code.replace(
    "const result = db.prepare('SELECT value FROM skill_configs WHERE skill_name = ? AND key = ?').all(skillName, key);\n    if (result.length && rows.length) {\n        return row || defaultValue;\n    }\n    return defaultValue;",
    "const row = db.prepare('SELECT value FROM skill_configs WHERE skill_name = ? AND key = ?').get(skillName, key);\n    return row?.value || defaultValue;"
);

// Fix getSetting
code = code.replace(
    "const result = db.prepare('SELECT value FROM bot_settings WHERE key = ?').all(key);\n    if (result.length && rows.length) {\n        return row || defaultValue;\n    }\n    return defaultValue;",
    "const row = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);\n    return row?.value || defaultValue;"
);

// Fix getTokenUsageSummary - db.exec pattern
code = code.replace(
    "const r = db.exec(`\n        SELECT COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0), COUNT(*)\n        FROM token_usage\n    `);\n    if (!r.length) return { totalPrompt: 0, totalCompletion: 0, totalAll: 0, count: 0 };\n    const row = r[0].values[0];\n    const totalPrompt = parseInt(row.total_p) || 0;\n    const totalCompletion = parseInt(row.total_c) || 0;\n    return { totalPrompt, totalCompletion, totalAll: totalPrompt + totalCompletion, count: parseInt(row.cnt) || 0 };",
    "const row = db.prepare('SELECT COALESCE(SUM(prompt_tokens),0) as total_p, COALESCE(SUM(completion_tokens),0) as total_c, COUNT(*) as cnt FROM token_usage').get();\n    if (!row) return { totalPrompt: 0, totalCompletion: 0, totalAll: 0, count: 0 };\n    const totalPrompt = parseInt(row.total_p) || 0;\n    const totalCompletion = parseInt(row.total_c) || 0;\n    return { totalPrompt, totalCompletion, totalAll: totalPrompt + totalCompletion, count: parseInt(row.cnt) || 0 };"
);

// Fix getConversationSummary - db.exec pattern
code = code.replace(
    "const r = db.exec(\n        'SELECT summary FROM conversation_summaries WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1',\n        [chatId]\n    );\n    if (r.length && r[0].values.length) return r[0].values[0][0] || '';\n    return '';",
    "const row = db.prepare('SELECT summary FROM conversation_summaries WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1').get(chatId);\n    return row?.summary || '';"
);

// Fix getAllSkillConfigs - result[0].values pattern
code = code.replace(
    "const result = db.prepare('SELECT key, value FROM skill_configs WHERE skill_name = ?').all(skillName);\n    if (!result.length) return {};\n    const config = {};\n    result\n\n    rows.forEach(row => { config[row.key] = row.value; });",
    "const rows = db.prepare('SELECT key, value FROM skill_configs WHERE skill_name = ?').all(skillName);\n    const config = {};\n    for (const row of rows) { config[row.key] = row.value; }"
);

// Fix getAllSettings - same pattern
code = code.replace(
    "const result = db.prepare('SELECT key, value FROM bot_settings').all();\n    if (!result.length) return {};\n    const settings = {};\n    result\n\n    rows.forEach(row => { settings[row.key] = row.value; });",
    "const rows = db.prepare('SELECT key, value FROM bot_settings').all();\n    const settings = {};\n    for (const row of rows) { settings[row.key] = row.value; }"
);

// Fix getSkill - result parsing
code = code.replace(
    "const result = db.prepare('SELECT * FROM skills WHERE name = ?').all(name);\n    if (!result.length || !rows.length) return null;\n    const cols = result[0].columns;\n    const row = rows[0];\n    const skill = {};\n    cols.forEach((c, i) => skill[c] = row[i]);",
    "const skill = db.prepare('SELECT * FROM skills WHERE name = ?').get(name);\n    if (!skill) return null;"
);

// Fix getUserProfile - r[0].values[0] pattern
code = code.replace(
    "const r = db.prepare('SELECT jid, name, facts, timezone FROM user_profiles WHERE jid = ?').all(jid);\n    if (!r.length || !rows.length) return null;\n    const row = rows[0];",
    "const row = db.prepare('SELECT jid, name, facts, timezone FROM user_profiles WHERE jid = ?').get(jid);\n    if (!row) return null;"
);

// Fix getAllUserProfiles - r[0].columns pattern
code = code.replace(
    "const result = db.prepare('SELECT jid, name, facts, timezone, updated_at FROM user_profiles ORDER BY updated_at DESC').all();\n    if (!result.length) return [];\n    const cols = result[0].columns;\n    return result\n\n    rows.map(row => {\n        if (row.facts) {\n            try { row.facts = JSON.parse(row.facts || '[]'); } catch { row.facts = []; }\n        }\n        return row;\n    });",
    "const rows = db.prepare('SELECT jid, name, facts, timezone, updated_at FROM user_profiles ORDER BY updated_at DESC').all();\n    for (const row of rows) {\n        if (row.facts) {\n            try { row.facts = JSON.parse(row.facts || '[]'); } catch { row.facts = []; }\n        }\n    }\n    return rows;"
);

// Fix getAllSkills - similar pattern
code = code.replace(
    "return skills = db.prepare('SELECT * FROM skills ORDER BY name').all();\n    for (const skill of skills) {",
    "const skills = db.prepare('SELECT * FROM skills ORDER BY name').all();\n    return skills;"
);

// Fix getAllCustomModes
code = code.replace(
    "const result = db.prepare('SELECT name, system_prompt, temperature, created_at FROM custom_modes ORDER BY name').all();\n    return rows.map(row => {\n        const obj = {};\n        cols.forEach((c, i) => obj[c] = row[i]);\n        return obj;\n    });",
    "const rows = db.prepare('SELECT name, system_prompt, temperature, created_at FROM custom_modes ORDER BY name').all();\n    return rows;"
);

// Fix getAllWhitelist
code = code.replace(
    "const result = db.prepare('SELECT jid, name, added_at FROM whitelist').all();\n    if (!result.length) return [];\n    return result\n\n    rows.map(row => ({\n        jid: row[0],\n        name: row[1] || '',\n        addedAt: row[2] || ''\n    }));",
    "const rows = db.prepare('SELECT jid, name, added_at FROM whitelist').all();\n    return rows;"
);

// Fix getCustomMode
code = code.replace(
    "const r = db.prepare('SELECT * FROM custom_modes WHERE name = ?').all(name);\n    if (!r.length || !rows.length) return null;\n    const cols = r[0].columns;\n    const row = rows[0];\n    const obj = {};\n    cols.forEach((c, i) => obj[c] = row[i]);",
    "const obj = db.prepare('SELECT * FROM custom_modes WHERE name = ?').get(name);\n    if (!obj) return null;"
);

fs.writeFileSync('src/services/db.js', code);
console.log('All broken patterns fixed');
