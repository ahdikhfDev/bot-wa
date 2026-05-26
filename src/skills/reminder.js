import { addReminder, getChatReminders, deleteReminder } from '../services/db.js';

const MONTHS = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];

function parseWib() {
    const now = Date.now();
    const offset = 7 * 3600000;
    return { now, offset, d: new Date(now + offset) };
}

function formatTime(ts) {
    const d = new Date(ts + 7 * 3600000);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}-${mo}-${dd} ${h}:${m}`;
}

function statusIcon(retryCount, status) {
    if (status === 'done') return '✅';
    if (status === 'expired') return '⌛';
    if (retryCount > 0) return '🔔';
    return '⏳';
}

function parseReminderInput(args) {
    const text = args.join(' ');
    if (!text) return null;
    const lower = text.toLowerCase();

    const { now, offset, d } = parseWib();
    let targetTs = null;
    let message = '';
    let dayOffset = 0;
    let hours = null, minutes = 0;

    // Relative: "X menit lagi", "X jam lagi"
    const relMatch = lower.match(/(\d+)\s*(menit|jam)\s*(lagi|ke depan|from now)?/i);
    if (relMatch) {
        const amount = parseInt(relMatch[1]);
        const unit = relMatch[2].toLowerCase();
        const ms = unit === 'jam' ? amount * 3600000 : amount * 60000;
        targetTs = now + ms;
        message = text.replace(relMatch[0], '').trim();
        if (targetTs && message) return { triggerTimeMs: targetTs, message };
        return null;
    }

    // Date keywords
    if (/lusa/i.test(lower)) dayOffset = 2;
    else if (/besok/i.test(lower)) dayOffset = 1;
    // "nanti" without date keyword means today

    // Specific date: "28 mei", "1 januari"
    const dateMatch = lower.match(/(\d{1,2})\s*(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)/i);
    let targetMonth = null, targetDay = null;
    if (dateMatch) {
        targetDay = parseInt(dateMatch[1]);
        targetMonth = MONTHS.indexOf(dateMatch[2].toLowerCase());
        // Remove date portion from text for message extraction
    }

    // Time patterns
    let timeStr = '';

    // "jam 5 sore", "jam 14:30", "jam 8 pagi"
    const jamMatch = lower.match(/(?:jam|pukul)\s*(\d{1,2})\s*[.:]?\s*(\d{2})?\s*(pagi|siang|sore|malam|tengah\s*malam)?/i);
    if (jamMatch) {
        hours = parseInt(jamMatch[1]);
        if (jamMatch[2]) minutes = parseInt(jamMatch[2]);
        const scope = (jamMatch[3] || '').toLowerCase().replace(/\s+/g, ' ');
        if (scope === 'pagi' && hours < 12) { /* ok */ }
        else if (scope === 'siang' && hours < 12) hours += 12;
        else if (scope === 'sore' && hours < 12) hours += 12;
        else if (scope === 'malam' && hours < 12) hours += 12;
        else if (scope === 'tengah malam') hours = 0;
        timeStr = jamMatch[0];
    } else {
        // bare "08:30" or "17.00"
        const timeMatch = lower.match(/\b(\d{1,2})[.:](\d{2})\b/);
        if (timeMatch) {
            const h = parseInt(timeMatch[1]), m = parseInt(timeMatch[2]);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                hours = h;
                minutes = m;
                timeStr = timeMatch[0];
            }
        }
    }

    if (hours === null) return null;

    if (hours > 23 || minutes > 59) return null;

    // Build target time
    const dNow = new Date(now + offset);
    let targetDate = Date.UTC(dNow.getUTCFullYear(), dNow.getUTCMonth(), dNow.getUTCDate() + dayOffset, hours, minutes, 0) - offset;

    // If specific date was given, override
    if (targetMonth !== null && targetDay !== null) {
        let y = dNow.getUTCFullYear();
        // If target month is earlier than current month, assume next year
        if (targetMonth < dNow.getUTCMonth() || (targetMonth === dNow.getUTCMonth() && targetDay < dNow.getUTCDate())) {
            y++;
        }
        targetDate = Date.UTC(y, targetMonth, targetDay, hours, minutes, 0) - offset;
    }

    // If time already passed, bump to next day (unless date was explicitly set)
    if (targetDate <= now && targetMonth === null) {
        targetDate += 86400000;
    }

    // Extract message
    let cleaned = text;
    if (dateMatch) cleaned = cleaned.replace(dateMatch[0], '');
    if (timeStr) cleaned = cleaned.replace(timeStr, '');
    cleaned = cleaned
        .replace(/\b(jam|pukul)\s*/i, '')
        .replace(/\b(besok|lusa|nanti)\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return null;

    return { triggerTimeMs: targetDate, message: cleaned };
}

export default {
    name: 'reminder',
    title: 'Pengingat',
    description: 'Buat / lihat / hapus reminder. Contoh: /reminder jam 5 sore beli beras',
    commands: ['reminder'],

    async handler(sock, remoteJid, args) {
        const sub = (args[0] || '').toLowerCase();

        // /reminder list
        if (sub === 'list' || sub === 'ls') {
            const list = getChatReminders(remoteJid);
            if (!list.length) {
                await sock.sendMessage(remoteJid, { text: '📋 *Reminder kosong.*\nBuat: /reminder jam 5 sore beli beras' });
                return;
            }
            const lines = list.map((r, i) => {
                const dateStr = formatTime(r.triggerTime);
                const icon = statusIcon(r.retryCount, r.status);
                return `${i + 1}. [${dateStr}] ${r.message} ${icon}`;
            });
            await sock.sendMessage(remoteJid, {
                text: `📋 *Reminder (${list.length})*\n\n${lines.join('\n')}\n\nHapus: /reminder delete [nomor]`
            });
            return;
        }

        // /reminder delete <id> or /reminder del <id>
        if (sub === 'delete' || sub === 'del' || sub === 'hapus') {
            const idStr = args[1];
            if (!idStr || !/^\d+$/.test(idStr)) {
                await sock.sendMessage(remoteJid, { text: 'Gunakan: /reminder delete [nomor]\nCek nomor: /reminder list' });
                return;
            }
            const idx = parseInt(idStr);
            const list = getChatReminders(remoteJid);
            if (idx < 1 || idx > list.length) {
                await sock.sendMessage(remoteJid, { text: `Nomor ${idx} gak ada. Cek /reminder list` });
                return;
            }
            deleteReminder(list[idx - 1].id);
            await sock.sendMessage(remoteJid, { text: `✅ Reminder #${idx} dihapus.` });
            return;
        }

        // /reminder help
        if (sub === 'help' || sub === 'bantuan') {
            await sock.sendMessage(remoteJid, {
                text: `📌 *Cara Pakai Reminder*

Buat: /reminder [waktu] [pesan]
Contoh:
• /reminder jam 5 sore beli beras
• /reminder besok jam 8 pagi meeting
• /reminder 28 mei jam 12 ultah
• /reminder 10 menit lagi matiin kompor

Lihat: /reminder list
Hapus: /reminder delete [nomor]`
            });
            return;
        }

        // /reminder [time] [message] (default)
        const parsed = parseReminderInput(args);
        if (!parsed) {
            await sock.sendMessage(remoteJid, {
                text: `Gunakan: /reminder [waktu] [pesan]\nContoh: /reminder jam 5 sore beli beras\n\nBantuan: /reminder help`
            });
            return;
        }

        addReminder(remoteJid, parsed.triggerTimeMs, parsed.message);
        const dateStr = formatTime(parsed.triggerTimeMs);
        await sock.sendMessage(remoteJid, {
            text: `✅ *Reminder disimpan!*\n📅 ${dateStr} WIB\n📝 ${parsed.message}`
        });
    },

    detect(text) {
        const lower = text.toLowerCase();
        const keywords = ['ingatkan', 'ingetin', 'remind', 'ingat', 'pengingat'];
        const hasKeyword = keywords.some(k => lower.includes(k));
        if (!hasKeyword) return null;

        // Strip keywords for cleaner parsing
        let cleanText = text;
        keywords.forEach(k => {
            const reg = new RegExp(`\\b${k}\\s*(saya|aku|donk|dong)?\\s*(untuk|buat)?\\s*`, 'i');
            cleanText = cleanText.replace(reg, '');
        });

        const parsed = parseReminderInput(cleanText.split(/\s+/));
        return parsed ? { type: 'reminder', ...parsed } : null;
    },

    async execute(sock, remoteJid, text, isOwner) {
        const parsed = this.detect(text);
        if (!parsed) return false;

        addReminder(remoteJid, parsed.triggerTimeMs, parsed.message);
        const dateStr = formatTime(parsed.triggerTimeMs);
        await sock.sendMessage(remoteJid, {
            text: `✅ *Reminder disimpan (via AI)!*\n📅 ${dateStr} WIB\n📝 ${parsed.message}`
        });
        return true;
    }
};
