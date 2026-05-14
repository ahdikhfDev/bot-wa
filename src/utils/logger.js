import fs from 'fs';
import path from 'path';

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, `bot-${new Date().toISOString().slice(0, 10)}.log`);
const errorFile = path.join(logDir, `error-${new Date().toISOString().slice(0, 10)}.log`);

function timestamp() {
    return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

export function log(type, msg, data = null) {
    const line = `[${timestamp()}] [${type}] ${msg}${data ? ' | ' + (typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : data) : ''}`;
    console.log(line);
    try { fs.appendFileSync(logFile, line + '\n'); } catch {}
}

export function error(msg, err = null) {
    const line = `[${timestamp()}] [ERROR] ${msg}${err ? ' | ' + (err.message || err) : ''}`;
    console.error(line);
    try {
        fs.appendFileSync(errorFile, line + '\n');
        if (err?.stack) fs.appendFileSync(errorFile, err.stack + '\n');
    } catch {}
}

export function warn(msg) {
    const line = `[${timestamp()}] [WARN] ${msg}`;
    console.warn(line);
    try { fs.appendFileSync(logFile, line + '\n'); } catch {}
}
