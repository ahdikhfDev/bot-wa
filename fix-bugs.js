import fs from 'fs';

let c = fs.readFileSync('src/services/db.js', 'utf8');

// Fix getJadwal - rows(row) -> rows.map(row) + remove columns pattern
c = c.replace(
  "export function getJadwal(groupId) {\n    if (!db) return [];\n    const rows = db.prepare('SELECT * FROM jadwal WHERE group_id = ? ORDER BY tanggal ASC').all(groupId);\n    return rows(row => {\n        const obj = {};\n        columns.forEach((col, i) => obj[col] = row[i]);\n        return obj;\n    });",
  "export function getJadwal(groupId) {\n    if (!db) return [];\n    return db.prepare('SELECT * FROM jadwal WHERE group_id = ? ORDER BY tanggal ASC').all(groupId);\n}"
);

// Fix getGroupHistory - result[0].columns + rows.map pattern
c = c.replace(
  "    const result = db.prepare(`\n        SELECT * FROM group_context\n        WHERE group_id = ?\n        ORDER BY timestamp DESC\n        LIMIT ?\n    `).all(groupId, limit);\n\n    if (!result.length) return [];\n\n    const columns = result[0].columns;\n    const messages = rows.map(row => {\n        const obj = {};\n        columns.forEach((col, i) => obj[col] = row[i]);\n        return obj;\n    });\n\n    return messages.reverse(); // Chronological order\n}",
  "    const rows = db.prepare('SELECT * FROM group_context WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?').all(groupId, limit);\n    if (!rows.length) return [];\n    return rows.reverse();\n}"
);

// Fix getAllSkillConfigs - rows(row) -> for...of
c = c.replace(
  "export function getAllSkillConfigs(skillName) {\n    if (!db) return {};\n    const rows = db.prepare('SELECT key, value FROM skill_configs WHERE skill_name = ?').all(skillName);\n    const config = {};\n    rows(row => { config[row[0]] = row[1]; });\n    return config;\n}",
  "export function getAllSkillConfigs(skillName) {\n    if (!db) return {};\n    const rows = db.prepare('SELECT key, value FROM skill_configs WHERE skill_name = ?').all(skillName);\n    const config = {};\n    for (const row of rows) { config[row.key] = row.value; }\n    return config;\n}"
);

// Fix loadPendingBroadcasts - row[2], row[3] -> row.target_jids, row.target_names (already partially fixed but check)
c = c.replace(
  "    db.exec(`\n        CREATE TABLE IF NOT EXISTS pending_broadcasts (",
  "    db.exec(`CREATE TABLE IF NOT EXISTS pending_broadcasts ("
);

fs.writeFileSync('src/services/db.js', c);
console.log('Fixed');
