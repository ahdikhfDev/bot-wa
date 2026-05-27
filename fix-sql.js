import fs from 'fs';

let c = fs.readFileSync('src/services/db.js', 'utf8');

// Fix getPendingReminders: change outer quotes to template literal
// Old: ...db.prepare('...status = 'pending'...')...
// New: ...db.prepare(`...status = 'pending'...`)...
const old1 = `reminders WHERE status = 'pending'`;
const new1 = `reminders WHERE status = 'pending'`;
// The issue: the file already has 'pending' breaking the JS string
// Let me find the exact text and fix it

// Actually, let me read the file as buffer and find the broken parts
// The broken line looks like:
//   db.prepare('SELECT ... WHERE status = 'pending' AND trigger_time <= ?').all(now);
// We need to change the first two ' to ` and the last ' before ).all to `

// Strategy: find lines containing both "WHERE status = 'pending'" and "reminders"
const lines = c.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes("reminders") && line.includes("status = 'pending'")) {
    // Change the outer single quotes to backticks
    // The format is: db.prepare('...pending...').all(now);
    // We want:        db.prepare(`...pending...`).all(now);
    const idx = line.indexOf("db.prepare('");
    if (idx !== -1) {
      const before = line.substring(0, idx + 11); // "db.prepare("
      const after = line.substring(idx + 11);     // rest after db.prepare('
      // Find the closing ')
      const closeIdx = after.lastIndexOf("').all");
      if (closeIdx !== -1) {
        const sqlContent = after.substring(0, closeIdx);
        // Remove the single quote at start and end, replace with backticks
        lines[i] = before + '`' + sqlContent + '`' + after.substring(closeIdx + 1);
      }
    }
  }
  if (line.includes("reminders") && line.includes("SET status = 'done'")) {
    const idx = line.indexOf("db.prepare('");
    if (idx !== -1) {
      const before = line.substring(0, idx + 11);
      const after = line.substring(idx + 11);
      const closeIdx = after.lastIndexOf("').run");
      if (closeIdx !== -1) {
        const sqlContent = after.substring(0, closeIdx);
        lines[i] = before + '`' + sqlContent + '`' + after.substring(closeIdx + 1);
      }
    }
  }
}
c = lines.join('\n');

fs.writeFileSync('src/services/db.js', c);
console.log('Fixed SQL quoting via template literals');
