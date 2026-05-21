import { addReminder } from '../services/db.js';

export default {
    name: 'reminder',
    title: 'Pengingat',
    description: 'Buat pengingat otomatis (deteksi: "ingetin saya jam 7 buat minum obat")',
    commands: [],

    detect(text) {
        if (!text) return null;
        const lower = text.toLowerCase();
        const hasReminderKeyword = /(?:ng)?ing(?:at|et)|reminder/i.test(lower);
        if (!hasReminderKeyword) return null;
        return { type: 'reminder' };
    },

    async execute(sock, remoteJid, text, isOwner) {
        if (!isOwner) return null;

        const data = extractReminder(text);
        if (!data) return null;

        addReminder(remoteJid, data.triggerTimeMs, data.message);
        const timeStr = `${String(data.hours).padStart(2, '0')}:${String(data.minutes).padStart(2, '0')}`;
        console.log(`🔔 REMINDER SET: ${data.message} at ${timeStr} WIB for ${remoteJid}`);
        await sock.sendMessage(remoteJid, {
            text: `✅ *Tugas sudah diingetin! Jangan lupa ngerjainnya, bro!* 📚✨\n\nAku bakal ngingetin kamu jam *${timeStr}* nanti.`
        });
        return true;
    }
};

function extractReminder(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const hasReminderKeyword = /(?:ng)?ing(?:at|et)|reminder/i.test(lower);
    if (!hasReminderKeyword) return null;

    const nowUtc = Date.now();
    const WIB_MS = 7 * 3600000;

    function cleanMsg(t, timeStr) {
        return t
            .replace(timeStr, '')
            .replace(/thirty\s*/i, '')
            .replace(/(?:jam|pukul)\s*/i, '')
            .replace(/(?:ng)?ing(?:at|et)(?:kan|in|inin)?(?:\s+(?:saya|aku|gw|gue|lo|lu|elu))?\s*/i, '')
            .replace(/\breminder\s*/i, '')
            .replace(/\s+(buat|untuk|supaya|biar)\s+/i, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'Ada tugas/pekerjaan';
    }

    const relMatch = lower.match(/(\d+)\s*(menit|jam)\s*(lagi|ke depan|from now)?/i);
    if (relMatch) {
        const amount = parseInt(relMatch[1]);
        const unit = relMatch[2].toLowerCase();
        const ms = unit === 'jam' ? amount * 3600000 : amount * 60000;
        const triggerTimeMs = nowUtc + ms;
        const message = cleanMsg(text, relMatch[0]);
        const d = new Date(triggerTimeMs + WIB_MS);
        const hours = d.getUTCHours();
        const minutes = d.getUTCMinutes();
        return { triggerTimeMs, message, hours, minutes };
    }

    const dayKeywords = { besok: 1, lusa: 2, 'nanti': 0 };
    let dayOffset = 0;
    for (const [word, offset] of Object.entries(dayKeywords)) {
        if (lower.includes(word)) {
            dayOffset = offset;
            break;
        }
    }

    const timePattern = /(\d{1,2})[.:](\d{2})/;
    const timeMatch = text.match(timePattern);
    if (!timeMatch) return null;

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours > 23 || minutes > 59) return null;

    const d = new Date(nowUtc + WIB_MS);
    let targetWib = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset, hours, minutes, 0) - WIB_MS;
    if (targetWib <= nowUtc && dayOffset === 0) targetWib += 86400000;

    const message = cleanMsg(text, timeMatch[0]);
    return { triggerTimeMs: targetWib, message, hours, minutes };
}
