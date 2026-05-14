import { searchWeb, searchNews, formatSearchResults } from '../services/search.js';
import { translateText } from '../services/translate.js';
import { getWeather, formatWeather } from '../services/weather.js';
import { getTemplateList, getTemplate, fillTemplate, formatTemplateList } from '../services/templates.js';
import { callAI, summarizeText, getVoiceBuffer } from '../services/ai.js';
import { addJadwal, getJadwal, deleteJadwal, clearGroupContext, getMode, setMode, isWhitelisted, addWhitelist, removeWhitelist, getAllWhitelist, addReminder, broadcastTargets, pendingBroadcasts, savePendingBroadcast } from '../services/db.js';

// ==================== OWNER: WHITELIST ====================

export async function cmdAllow(sock, remoteJid, isOwner, mentionedJids, args) {
    if (!isOwner) return;
    let targetJid = remoteJid;
    if (mentionedJids.length > 0) targetJid = mentionedJids[0];
    else if (args[0]) {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num) targetJid = `${num}@s.whatsapp.net`;
    }
    addWhitelist(targetJid);
    await sock.sendMessage(remoteJid, { text: `✅ *Akses diberikan!*\n${targetJid} sekarang bisa menggunakan bot.` });
}

export async function cmdBan(sock, remoteJid, isOwner, mentionedJids, args) {
    if (!isOwner) return;
    let targetJid = remoteJid;
    if (mentionedJids.length > 0) targetJid = mentionedJids[0];
    else if (args[0]) {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num) targetJid = `${num}@s.whatsapp.net`;
    }
    removeWhitelist(targetJid);
    await sock.sendMessage(remoteJid, { text: `⛔ *Akses dicabut!*\n${targetJid} tidak bisa menggunakan bot lagi.` });
}

export async function cmdList(sock, remoteJid, isOwner) {
    if (!isOwner) return;
    const list = getAllWhitelist();
    if (list.length === 0) {
        await sock.sendMessage(remoteJid, { text: '📋 *Whitelist kosong.*' });
        return;
    }
    await sock.sendMessage(remoteJid, { text: `📋 *Whitelist (${list.length})*\n\n${list.join('\n')}` });
}

// ==================== MEDIA: SAY ====================

export async function cmdSay(sock, remoteJid, args) {
    const msgText = args.join(' ');
    if (!msgText) {
        await sock.sendMessage(remoteJid, { text: '❌ Usage: /say [teks]' });
        return;
    }
    const voiceBuffer = await getVoiceBuffer(msgText);
    if (voiceBuffer) {
        await sock.sendMessage(remoteJid, { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
    } else {
        await sock.sendMessage(remoteJid, { text: '❌ Gagal membuat voice.' });
    }
}

// ==================== MEDIA: STICKER ====================

export async function cmdSticker(sock, remoteJid, isGroup, sender, args, quotedMsg) {
    const { downloadMediaMessage } = await import('baileys');
    const { Sticker, StickerTypes } = await import('wa-sticker-formatter');

    const quoted = quotedMsg || (await getQuotedMessage(sock, remoteJid));

    if (!quoted) {
        await sock.sendMessage(remoteJid, { text: '❌ Reply atau kirim gambar dengan caption /s' });
        return;
    }

    await sock.sendPresenceUpdate('composing', remoteJid);
    const buffer = await downloadMediaMessage(quoted, 'buffer', {}, { logger: console });
    if (!buffer) {
        await sock.sendMessage(remoteJid, { text: '❌ Gagal download media.' });
        return;
    }

    const sticker = new Sticker(buffer, {
        pack: `Thirty AI`,
        author: sender || 'User',
        type: StickerTypes.FULL,
        quality: 80,
    });
    const stickerBuffer = await sticker.toBuffer();
    await sock.sendMessage(remoteJid, { sticker: stickerBuffer });
}

async function getQuotedMessage(sock, jid) {
    // Placeholder — actual implementation needs msg object
    return null;
}

// ==================== HELP ====================

export async function cmdHelp(sock, jid) {
    const helpText = `✨ *THIRTY AI - Command Center* ✨

Halo! Saya adalah *Thirty*, asisten AI cerdas yang siap membantu kebutuhanmu. 🤖🦾

🤖 *PENGATURAN AI*
• 🎨 */mode* : Ganti kepribadian (bad, formal, profesional, asik)

🛠️ *FITUR MULTIMEDIA & SEARCH*
• 🔍 */search* atau "cari [query]" : Cari info di web
• 📰 */cari [berita]* atau "berita [query]" : Cari berita terbaru
• 🎙️ *Voice Note* : Kirim VN, saya dengerin & balas VN
• 👁️ *Vision AI* : Balas foto untuk saya analisis
• 🎨 */s* atau */sticker* : Ubah foto jadi stiker
• 🗣️ */say [teks]* : Suruh saya bicara (Voice Note)
• 📄 *Dokumen/PDF* : Kirim file, saya baca & jelaskan

🌍 *FITUR UTILITY*
• 🌤️ */cuaca [kota]* : Cek cuaca (atau */weather*)
• 🌍 */translate [teks]* : Terjemahkan ke Indonesia
• 🧠 *Auto Learning* : Bot belajar dari percakapan — makin ngobrol makin pinter
• 🧠 *RAG Memory* : Bot ingat topik lama & konten dokumen
• 📝 */rangkum [teks]* : Ringkas teks panjang

📅 *PRODUKTIVITAS*
• 🕒 *Auto Reminder* : "Ingatkan saya [jam] buat [acara]"
• 📅 */jadwal list* : Lihat jadwal grup

👑 *OWNER ONLY*
• 📢 */broadcast list* : Lihat daftar grup
• 📢 */broadcast kirim [pesan]* : Kirim ke SEMUA grup
• 📢 */broadcast kirim 1 3 [pesan]* : Kirim ke grup tertentu aja
• 📋 */template list* : Lihat template pesan siap pakai
• 📋 */template kirim [nama]* : Kirim template ke grup
• 📋 */template isi [nama] [field=nilai]* : Isi field & kirim template

💡 *TIPS:*
• Di *Grup*, saya respon jika dipanggil "Thirty", di-mention, atau reply pesan saya.
• Di *Private Chat*, ngobrol langsung kapan aja!

Ciptaan: *Maha Raja Ahdi Khalida Fathir* 👑`.trim();
    await sock.sendMessage(jid, { text: helpText });
}

// ==================== MODE ====================

export async function cmdMode(sock, remoteJid, args) {
    const newMode = args[0]?.toLowerCase();
    const validModes = ['asik', 'bad', 'formal', 'profesional'];
    if (!newMode || !validModes.includes(newMode)) {
        await sock.sendMessage(remoteJid, { text: `❌ Pilih mode: ${validModes.join(', ')}\nContoh: /mode asik` });
        return;
    }
    setMode(remoteJid, newMode);
    await sock.sendMessage(remoteJid, { text: `✅ Mode AI berhasil diubah ke *${newMode}*! Coba ajak ngobrol sekarang.` });
}

// ==================== RANGKUM ====================

export async function cmdRangkum(sock, remoteJid, args) {
    const inputText = args.join(' ');
    if (!inputText) {
        await sock.sendMessage(remoteJid, { text: '❌ Usage: /rangkum [teks]' });
        return;
    }
    const mode = getMode(remoteJid);
    const summary = await summarizeText(inputText, mode);
    await sock.sendMessage(remoteJid, { text: `📝 *Rangkuman:*\n\n${summary}` });
}

// ==================== RESET ====================

export async function cmdReset(sock, remoteJid, isOwner, isGroup) {
    if (!isOwner) {
        await sock.sendMessage(remoteJid, { text: '⛔ Hanya owner yang bisa reset.' });
        return;
    }
    if (isGroup) {
        clearGroupContext(remoteJid);
        await sock.sendMessage(remoteJid, { text: '🧹 Konteks grup sudah di-reset!' });
    }
}

// ==================== SEARCH ====================

export async function cmdSearch(sock, remoteJid, args) {
    const query = args.join(' ');
    if (!query) {
        await sock.sendMessage(remoteJid, { text: '❌ Usage: /search [query]' });
        return;
    }
    await sock.sendPresenceUpdate('composing', remoteJid);
    await sock.sendMessage(remoteJid, { text: `🔍 *Mencari:* ${query}...` });
    const results = await searchWeb(query);
    await sock.sendMessage(remoteJid, { text: formatSearchResults(results) });
}

// ==================== TRANSLATE ====================

export async function cmdTranslate(sock, remoteJid, args) {
    const textToTranslate = args.join(' ');
    if (!textToTranslate) {
        await sock.sendMessage(remoteJid, { text: '❌ Usage: /translate [teks]' });
        return;
    }
    await sock.sendPresenceUpdate('composing', remoteJid);
    const result = await translateText(textToTranslate);
    if (result.error) {
        await sock.sendMessage(remoteJid, { text: result.error });
        return;
    }
    await sock.sendMessage(remoteJid, { text: `🌍 *Terjemahan*\n\n📝 ${result.from}\n\n➡️ ${result.result}` });
}

// ==================== WEATHER ====================

export async function cmdWeather(sock, remoteJid, args) {
    const city = args.join(' ');
    await sock.sendPresenceUpdate('composing', remoteJid);
    const weather = await getWeather(city || 'Jakarta');
    await sock.sendMessage(remoteJid, { text: formatWeather(weather) });
}

// ==================== JADWAL ====================

export async function cmdJadwal(sock, remoteJid, isGroup, args, sender) {
    if (!isGroup) {
        await sock.sendMessage(remoteJid, { text: '❌ Command jadwal hanya di grup.' });
        return;
    }
    const sub = args[0]?.toLowerCase();
    if (sub === 'add' || sub === 'tambah') {
        const text = args.slice(1).join(' ');
        if (!text) {
            await sock.sendMessage(remoteJid, { text: '❌ Usage: /jadwal tambah [deskripsi]' });
            return;
        }
        addJadwal(remoteJid, text, sender);
        await sock.sendMessage(remoteJid, { text: `✅ Jadwal ditambahkan oleh ${sender}` });
    } else if (sub === 'del' || sub === 'hapus') {
        const id = parseInt(args[1]);
        if (!id) {
            await sock.sendMessage(remoteJid, { text: '❌ Usage: /jadwal hapus [id]' });
            return;
        }
        deleteJadwal(id);
        await sock.sendMessage(remoteJid, { text: `✅ Jadwal #${id} dihapus.` });
    } else if (sub === 'list' || sub === 'ls' || !sub) {
        const items = getJadwal(remoteJid);
        if (items.length === 0) {
            await sock.sendMessage(remoteJid, { text: '📋 *Belum ada jadwal.*' });
            return;
        }
        let text = `📋 *Jadwal (${items.length})*\n\n`;
        items.forEach((item, i) => {
            text += `${i + 1}. ${item.message}\n   👤 ${item.creator} | 🕒 ${item.created_at}\n`;
        });
        await sock.sendMessage(remoteJid, { text: text });
    }
}

// ==================== BROADCAST ====================

export async function cmdBroadcast(sock, remoteJid, args, text) {
    const sub = args[0]?.toLowerCase();

    if (sub === 'list' || sub === 'ls') {
        if (broadcastTargets.size === 0) {
            await sock.sendMessage(remoteJid, { text: '📡 Belum ada grup.' });
            return;
        }
        let list = `📡 *Daftar Grup (${broadcastTargets.size})*\n\n`;
        let i = 1;
        for (const [jid, name] of broadcastTargets) {
            list += `${i}. ${name}\n`;
            i++;
        }
        await sock.sendMessage(remoteJid, { text: list });
        return;
    }

    if (sub === 'send' || sub === 'kirim') {
        const parts = args.slice(1);
        if (parts.length === 0) {
            await sock.sendMessage(remoteJid, { text: '❌ Usage: /broadcast kirim [pesan]' });
            return;
        }

        const groupList = [...broadcastTargets];
        let targets = [];
        let msgStartIdx = 0;

        const firstIsNum = /^\d+$/.test(parts[0]);
        if (firstIsNum) {
            const indices = [];
            for (const p of parts) {
                if (/^\d+$/.test(p)) {
                    const idx = parseInt(p) - 1;
                    if (idx >= 0 && idx < groupList.length && !indices.includes(idx)) {
                        indices.push(idx);
                    }
                } else break;
            }
            targets = indices.map(i => groupList[i]);
            msgStartIdx = indices.length;
        } else {
            targets = groupList;
            msgStartIdx = 0;
        }

        const msgText = parts.slice(msgStartIdx).join(' ').trim();
        if (!msgText || targets.length === 0) {
            await sock.sendMessage(remoteJid, { text: '❌ Gagal. Cek /broadcast list' });
            return;
        }

        const targetNames = targets.map(([_, n]) => n).join(', ');
        savePendingBroadcast(remoteJid, new Map(targets), msgText);
        await sock.sendMessage(remoteJid, { text: `📡 *Broadcast ke ${targets.length} grup*\n📋 ${targetNames}\n📝 ${msgText}\n\n_Kirim? (y/n)_` });
        return;
    }

    await sock.sendMessage(remoteJid, { text: `📡 *Broadcast*\n/broadcast list — lihat grup\n/broadcast kirim [pesan] — kirim ke semua\n/broadcast kirim 1 3 [pesan] — kirim ke grup tertentu` });
}

// ==================== TEMPLATE ====================

export async function cmdTemplate(sock, remoteJid, args, text) {
    function parseFields(raw) {
        const data = {};
        const regex = /(\w+)=(?:"([^"]*)"|(\S+))/g;
        let m;
        while ((m = regex.exec(raw)) !== null) {
            data[m[1]] = m[2] !== undefined ? m[2] : m[3];
        }
        return data;
    }

    const sub = args[0]?.toLowerCase();
    const tplName = args[1]?.toLowerCase();

    if (!sub || sub === 'list') {
        await sock.sendMessage(remoteJid, { text: formatTemplateList() });
        return;
    }

    if (sub === 'isi') {
        const name = tplName;
        const tpl = getTemplate(name);
        if (!tpl) {
            await sock.sendMessage(remoteJid, { text: `❌ Template "${name}" gak ada.` });
            return;
        }
        const cmdPrefix = `/template isi ${name}`;
        const raw = text.slice(text.toLowerCase().indexOf(cmdPrefix) + cmdPrefix.length);
        const fillData = parseFields(raw);
        const result = fillTemplate(name, fillData);
        await sock.sendMessage(remoteJid, { text: `📋 *Preview: ${tpl.title}*\n\n${result}\n\n_Kirim? (y/n)_` });
        savePendingBroadcast(remoteJid, new Map([[remoteJid, 'Chat ini']]), result);
        return;
    }

    if (sub === 'kirim' || sub === 'send') {
        const name = tplName;
        const tpl = getTemplate(name);
        if (!tpl) {
            await sock.sendMessage(remoteJid, { text: `❌ Template "${name}" gak ada.` });
            return;
        }
        const cmdPrefix = `/template kirim ${name}`;
        const raw = text.slice(text.toLowerCase().indexOf(cmdPrefix) + cmdPrefix.length);
        const fillData = parseFields(raw);

        const groupList = [...broadcastTargets];
        let targets = [];

        const beforeFields = raw.replace(/\w+=/g, '|||').split('|||')[0].trim();
        const nums = beforeFields.match(/\d+/g);
        if (nums) {
            for (const n of nums) {
                const idx = parseInt(n) - 1;
                if (idx >= 0 && idx < groupList.length) targets.push(groupList[idx]);
            }
        } else {
            targets = [[remoteJid, 'Chat ini']];
        }

        const result = fillTemplate(name, fillData);
        const targetNames = targets.map(([_, n]) => n).join(', ');
        savePendingBroadcast(remoteJid, new Map(targets), result);
        await sock.sendMessage(remoteJid, { text: `📋 *Template: ${tpl.title}*\n📋 Ke: ${targetNames}\n\n${result}\n\n_Kirim? (y/n)_` });
        return;
    }

    // Preview
    const tpl = getTemplate(sub);
    if (tpl) {
        const fields = getTemplateList().find(t => t.id === sub)?.fields || [];
        await sock.sendMessage(remoteJid, { text: `📋 *${tpl.title}*\n${tpl.desc}\n\nFields: ${fields.join(', ')}\n\nKirim: /template kirim ${sub} [field=nilai]` });
        return;
    }

    await sock.sendMessage(remoteJid, { text: `❌ Gak paham. Ketik /template list` });
}
