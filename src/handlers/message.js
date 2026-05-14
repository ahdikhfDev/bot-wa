import { callAI, chatWithContext, transcribeAudio, callAIVision, getVoiceBuffer, extractAndStoreMemories, extractFromDocument, getLearningInterval } from '../services/ai.js';
import { addContextMessage, getGroupHistory, getMode, isWhitelisted, addReminder, addMemory, getInteractionCount, incrementInteractionCount, resetInteractionCount, broadcastTargets, pendingBroadcasts, deletePendingBroadcast } from '../services/db.js';
import { searchWeb, searchNews, formatSearchResults, detectSearchQuery } from '../services/search.js';
import { downloadMediaMessage } from 'baileys';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import fs from 'fs/promises';
import path from 'path';
import * as cmd from './commands.js';

const PREFIX = process.env.BOT_PREFIX || '/';
const GROUP_CONTEXT_ENABLED = process.env.GROUP_CONTEXT_ENABLED !== 'false';

const spamCooldowns = new Map();
const SPAM_COOLDOWN_MS = parseInt(process.env.SPAM_COOLDOWN_MS) || 1500;

export async function handleMessage(sock, msg) {
    try {
        let messageContent = getMessageText(msg);
        if (!messageContent) return;

        let remoteJid = msg.key.remoteJid;
        let senderJid = msg.key.participant || msg.key.remoteJid;
        let senderNumber = senderJid.split('@')[0];
        let OWNER_NUMBER = process.env.OWNER_NUMBER;
        let OWNER_LID = '36722373091439';
        let isOwner = senderNumber === OWNER_NUMBER || senderNumber === OWNER_LID;

        // ==================== REMINDER DETECTION (FIRST! Sebelum apapun) ====================
        const reminderData = extractReminder(messageContent);
        if (reminderData && isOwner) {
            addReminder(remoteJid, reminderData.triggerTimeMs, reminderData.message);
            const timeStr = `${String(reminderData.hours).padStart(2, '0')}:${String(reminderData.minutes).padStart(2, '0')}`;
            console.log(`🔔 REMINDER SET: ${reminderData.message} at ${timeStr} WIB for ${remoteJid}`);
            await sock.sendMessage(remoteJid, {
                text: `✅ *Tugas sudah diingetin! Jangan lupa ngerjainnya, bro!* 📚✨\n\nAku bakal ngingetin kamu jam *${timeStr}* nanti.`
            });
            return;
        }

        // ==================== ANTI-SPAM COOLDOWN ====================
        if (!isOwner) {
            const now = Date.now();
            const lastTime = spamCooldowns.get(remoteJid) || 0;
            if (now - lastTime < SPAM_COOLDOWN_MS) return;
            spamCooldowns.set(remoteJid, now);
        }

        let isAudio = false;

        const msgType = Object.keys(msg.message || {}).find(
            type => !type.startsWith('contextInfo') && !type.endsWith('MessagePlaceholder')
        );

        let audioMsgToDownload = null;
        let isImage = false;
        let imageMsgToDownload = null;
        let isDocument = false;
        let documentMsgToDownload = null;

        if (msgType === 'audioMessage') {
            isAudio = true;
            messageContent = '[Voice Note]';
            audioMsgToDownload = msg;
        } else if (msgType === 'imageMessage') {
            isImage = true;
            messageContent = msg.message.imageMessage.caption || '[Gambar]';
            imageMsgToDownload = msg;
        } else if (msgType === 'documentMessage') {
            isDocument = true;
            const doc = msg.message.documentMessage;
            messageContent = doc?.caption || `[Dokumen: ${doc?.fileName || 'File'}]`;
            documentMsgToDownload = msg;
        } else {
            const contextInfo = msg.message?.[msgType]?.contextInfo || {};
            const quotedMsg = contextInfo.quotedMessage;
            
            if (quotedMsg && quotedMsg.audioMessage) {
                isAudio = true;
                audioMsgToDownload = { key: msg.key, message: quotedMsg };
            } else if (quotedMsg && quotedMsg.imageMessage) {
                isImage = true;
                imageMsgToDownload = { key: msg.key, message: quotedMsg };
            } else if (quotedMsg && quotedMsg.documentMessage) {
                isDocument = true;
                documentMsgToDownload = { key: msg.key, message: quotedMsg };
            }
        }

        if (!messageContent && !isAudio && !isImage && !isDocument) return;

        remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        if (isGroup) broadcastTargets.set(remoteJid, msg.pushName || 'Unknown');
        const sender = msg.pushName || 'Unknown';
        // Ambil nomor bot saja (tanpa @s.whatsapp.net dan tanpa :device)
        const botNumber = sock.user?.id?.split('@')[0]?.split(':')[0];
        const botLid = sock.user?.lid?.split('@')[0]?.split(':')[0];

        // Cek apakah pesan mention bot atau private chat
        const contextInfo = msg.message?.[msgType]?.contextInfo || {};
        const mentionedJids = contextInfo.mentionedJid || [];
        const isMentionedByReply = (contextInfo.participant?.split('@')[0] === botNumber || contextInfo.participant?.split('@')[0] === botLid);

        const rawText = messageContent.trim();
        const isMentionedByJid = mentionedJids.some(jid => {
            const mentionedNumber = jid.split('@')[0];
            return mentionedNumber === botNumber || mentionedNumber === botLid;
        });
        const isMentionedByText = rawText.includes(`@${botNumber}`) || rawText.toLowerCase().includes('thirty');
        const isMentioned = isMentionedByJid || isMentionedByText || isMentionedByReply;
        const isPrivateChat = !isGroup;
        const isBot = msg.key.fromMe;

        // Parse command atau chat message
        let text = messageContent.trim();
        let command = text.startsWith(PREFIX) ? text.slice(1).split(' ')[0].toLowerCase() : null;
        let args = text.split(' ').slice(1);
        
        // Ambil pesan yang di-reply (jika ada)
        const quotedText = getQuotedText(msg);

        // Opsi A: Simpan SEMUA pesan grup ke dalam memori secara pasif (meski bot tidak di-tag)
        if (isGroup && GROUP_CONTEXT_ENABLED && text) {
            addContextMessage(remoteJid, sender, text);
        }

        console.log(`📨 [${isGroup ? 'GRUP' : 'DM'}] ${sender}: ${text.substring(0, 80)}`);
        if (command) console.log(`   → Command: ${command}`);
        if (isGroup) console.log(`   → isMentioned: ${isMentioned}, botNumber: ${botNumber}`);

        // ==================== BROADCAST CONFIRMATION ====================
        if (isOwner && !command) {
            const pending = pendingBroadcasts.get(remoteJid);
            if (pending) {
                const answer = text.trim().toLowerCase();
                if (/^(y|yes|ya|yakin|send|kirim|gas|lanjut)$/.test(answer)) {
                    deletePendingBroadcast(remoteJid);
                    let sent = 0, failed = 0;
                    for (const [jid] of pending.targets) {
                        try {
                            await sock.sendMessage(jid, { text: `📢 *Broadcast dari Owner* 📢\n\n${pending.message}` });
                            sent++;
                        } catch { failed++; }
                    }
                    await sock.sendMessage(remoteJid, { text: `✅ Broadcast selesai!\n📨 Terkirim: ${sent}/${pending.targets.size}\n❌ Gagal: ${failed}` });
                    return;
                } else if (/^(n|no|gak|nggak|cancel|batal|jangan)$/.test(answer)) {
                    deletePendingBroadcast(remoteJid);
                    await sock.sendMessage(remoteJid, { text: '❌ Broadcast dibatalkan.' });
                    return;
                }
                // Kalau bukan y/n, lanjut ke handler normal (abaikan pending)
            }
        }

        // ==================== SECURITY & WHITELIST ====================
        
        // Owner bisa dikenali dari Nomor HP atau dari LID (Logical ID) jika di grup
        isOwner = senderNumber === OWNER_NUMBER || senderNumber === OWNER_LID;
        
        console.log(`   → senderJid: ${senderJid}, isOwner: ${isOwner} (owner in env: ${process.env.OWNER_NUMBER})`);

        // Cek apakah pengirim atau grup tersebut sudah di-whitelist
        const isAuthorized = isOwner || isWhitelisted(remoteJid) || isWhitelisted(senderJid);

        if (!isAuthorized) {
            // Hanya merespon jika ada yang mencoba command atau tag bot secara eksplisit
            if (command || isMentioned) {
                await sock.sendMessage(remoteJid, { text: '⛔ *Akses Ditolak*\nMaaf, Anda tidak memiliki izin untuk menggunakan bot ini. Silakan hubungi Maha Raja Ahdi Khalida Fathir.' });
            }
            return;
        }

        // ==================== AUDIO / VOICE NOTE HANDLING ====================
        if (isAudio && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '⏳ _Mendengarkan Voice Note..._' });
            try {
                const buffer = await downloadMediaMessage(
                    audioMsgToDownload,
                    'buffer',
                    {},
                    { logger: console, reuploadRequest: sock.updateMediaMessage }
                );
                
                const tempPath = path.join(process.cwd(), `temp_${Date.now()}.ogg`);
                await fs.writeFile(tempPath, buffer);
                
                const transcript = await transcribeAudio(tempPath);
                await fs.unlink(tempPath).catch(()=>{}); // clean up
                
                if (transcript) {
                    // Gabungkan transkrip dengan pesan asli (misal: user bilang "@Thirty apa ini?")
                    text = `(Teks dari Voice Note: "${transcript}")\n\nPesan User: ${text}`; 
                    await sock.sendMessage(remoteJid, { text: `🎙️ *(Transkrip VN):*\n"${transcript}"` });
                } else {
                    await sock.sendMessage(remoteJid, { text: '❌ Gagal mendengarkan Voice Note.' });
                    return;
                }
            } catch (err) {
                console.error('Audio processing error:', err);
                await sock.sendMessage(remoteJid, { text: '❌ Terjadi kesalahan saat memproses audio.' });
                return;
            }
        }

        // ==================== IMAGE / VISION HANDLING ====================
        if (isImage && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '👁️ _Sedang melihat gambar..._' });
            try {
                const buffer = await downloadMediaMessage(
                    imageMsgToDownload,
                    'buffer',
                    {},
                    { logger: console, reuploadRequest: sock.updateMediaMessage }
                );
                
                const base64Image = buffer.toString('base64');
                const mode = getMode(remoteJid);
                
                // Gunakan caption pesan (jika ada) sebagai prompt untuk Vision
                const prompt = (text && text !== '[Gambar]') ? text : null;
                const response = await callAIVision(prompt, base64Image, mode);
                
                await sock.sendMessage(remoteJid, { text: response });
                return; // Berhenti di sini untuk pesan gambar
            } catch (err) {
                console.error('Vision processing error:', err);
                await sock.sendMessage(remoteJid, { text: '❌ Terjadi kesalahan saat memproses gambar.' });
                return;
            }
        }

        // ==================== DOCUMENT / PDF HANDLING ====================
        if (isDocument && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '📄 _Membaca dokumen..._' });
            try {
                const buffer = await downloadMediaMessage(
                    documentMsgToDownload,
                    'buffer',
                    {},
                    { logger: console, reuploadRequest: sock.updateMediaMessage }
                );

                const msgType = Object.keys(msg.message || {}).find(t => !t.startsWith('contextInfo'));
                const directDoc = msg.message?.documentMessage;
                const quotedDoc = msg.message?.[msgType]?.contextInfo?.quotedMessage?.documentMessage;
                const docInfo = directDoc || quotedDoc || {};
                const fileName = docInfo.fileName || 'file';
                const isPDF = fileName.toLowerCase().endsWith('.pdf');

                let docText = '';
                if (isPDF) {
                    const { PDFParse } = await import('pdf-parse');
                    const u8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                    const parser = new PDFParse({ data: u8 });
                    await parser.load();
                    const allText = await parser.getText();
                    docText = (allText?.text || '').substring(0, 3000);
                } else {
                    docText = buffer.toString('utf-8').substring(0, 3000);
                }

                if (docText.trim().length < 10) {
                    await sock.sendMessage(remoteJid, { text: `📄 *${fileName}*\n\n_(Dokumen kosong atau tidak bisa dibaca)_` });
                    return;
                }

                const caption = text && text !== `[Dokumen: ${fileName}]` ? text : `Ini isi dari ${fileName}. Jelaskan secara singkat.`;
                const mode = getMode(remoteJid);
                const response = await callAI(`Isi dokumen: """${docText.substring(0, 2000)}"""\n\nPertanyaan: ${caption}`, '', mode, remoteJid);
                await sock.sendMessage(remoteJid, { text: `📄 *${fileName}*\n\n${response}` });

                // Simpan konten dokumen ke memori dengan confidence tinggi
                addMemory(remoteJid, `Isi dokumen "${fileName}": ${docText.substring(0, 500)}`, 'document', 10, 'document');
                addMemory(remoteJid, `Ringkasan "${fileName}": ${response.substring(0, 300)}`, 'document', 10, 'document');

                // Ekstrak pengetahuan tambahan (async)
                if (docText.length > 100) {
                    extractFromDocument(remoteJid, docText, fileName).catch(() => {});
                }
                return;
            } catch (err) {
                console.error('Document processing error:', err);
                await sock.sendMessage(remoteJid, { text: '❌ Gagal membaca dokumen.' });
                return;
            }
        }

        // Hitung ulang command & args jika teks berubah (hasil transkrip)
        command = text.startsWith(PREFIX) ? text.slice(1).split(' ')[0].toLowerCase() : null;
        args = text.split(' ').slice(1);

        // ==================== COMMAND DISPATCH ====================
        const dispatch = {
            'allow': () => cmd.cmdAllow(sock, remoteJid, isOwner, mentionedJids, args),
            'ban': () => cmd.cmdBan(sock, remoteJid, isOwner, mentionedJids, args),
            'list': () => cmd.cmdList(sock, remoteJid, isOwner),
            'say': () => cmd.cmdSay(sock, remoteJid, args),
            's': () => cmdSticker(sock, remoteJid, isGroup, sender, args, null),
            'sticker': () => cmdSticker(sock, remoteJid, isGroup, sender, args, null),
            'help': () => cmd.cmdHelp(sock, remoteJid),
            'mode': () => cmd.cmdMode(sock, remoteJid, args),
            'rangkum': () => cmd.cmdRangkum(sock, remoteJid, args),
            'jadwal': () => cmd.cmdJadwal(sock, remoteJid, isGroup, args, sender),
            'reset': () => cmd.cmdReset(sock, remoteJid, isOwner, isGroup),
            'search': () => cmd.cmdSearch(sock, remoteJid, args),
            'cari': () => cmd.cmdSearch(sock, remoteJid, args),
            'translate': () => cmd.cmdTranslate(sock, remoteJid, args),
            'tr': () => cmd.cmdTranslate(sock, remoteJid, args),
            'terjemahkan': () => cmd.cmdTranslate(sock, remoteJid, args),
            'weather': () => cmd.cmdWeather(sock, remoteJid, args),
            'cuaca': () => cmd.cmdWeather(sock, remoteJid, args),
            'broadcast': () => cmd.cmdBroadcast(sock, remoteJid, args, text),
            'bc': () => cmd.cmdBroadcast(sock, remoteJid, args, text),
            'template': () => cmd.cmdTemplate(sock, remoteJid, args, text),
            'tpl': () => cmd.cmdTemplate(sock, remoteJid, args, text),
        };

        if (command && dispatch[command]) {
            // Owner-only check for sensitive commands
            if (['allow', 'ban', 'list', 'broadcast', 'bc', 'template', 'tpl', 'reset'].includes(command) && !isOwner) {
                await sock.sendMessage(remoteJid, { text: '⛔ *Akses Ditolak*\nHanya Maha Raja yang bisa.' });
                return;
            }
            await dispatch[command]();
            return;
        }

        // ==================== SEARCH KEYWORD DETECTION ====================
        if (!command && (isPrivateChat || (isGroup && isMentioned))) {
            const searchDetect = detectSearchQuery(text);
            if (searchDetect) {
                await sock.sendPresenceUpdate('composing', remoteJid);
                await sock.sendMessage(remoteJid, { text: `🔍 *Mencari ${searchDetect.type === 'news' ? 'berita' : 'info'} tentang:* ${searchDetect.query}...` });
                const results = searchDetect.type === 'news'
                    ? await searchNews(searchDetect.query)
                    : await searchWeb(searchDetect.query);
                await sock.sendMessage(remoteJid, { text: formatSearchResults(results) });
                return;
            }
        }

        // ==================== AI CHAT (Context-aware) ====================

        if (isPrivateChat || (isGroup && isMentioned)) {
            // Kirim typing indicator
            await sock.sendPresenceUpdate('composing', remoteJid);

            // Ambil mode AI untuk chat ini
            const mode = getMode(remoteJid);

            // Panggil AI dengan context (yang sudah tersimpan secara pasif)
            let history = [];
            if (isGroup && GROUP_CONTEXT_ENABLED) {
                history = getGroupHistory(remoteJid);
            }

            // Gabungkan pesan yang di-reply (jika ada) ke dalam prompt agar bot paham
            let promptText = text;
            if (quotedText) {
                promptText = `(Membalas pesan: "${quotedText}")\n\n${text}`;
            }

            const response = history.length > 0
                ? await chatWithContext(promptText, history, mode, remoteJid)
                : await callAI(promptText, '', mode, remoteJid);

            // Jika user mengirim VN, balas dengan VN juga (PTT)
            if (isAudio) {
                const voiceBuffer = await getVoiceBuffer(response);
                if (voiceBuffer) {
                    await sock.sendMessage(remoteJid, { 
                        audio: voiceBuffer, 
                        mimetype: 'audio/ogg; codecs=opus', 
                        ptt: true 
                    }, { quoted: msg });
                    
                    if (isGroup && GROUP_CONTEXT_ENABLED) {
                        addContextMessage(remoteJid, 'Thirty (Bot)', response);
                    }
                    return;
                }
            }

            console.log('DEBUG: Sending response to WhatsApp:', response);
            try {
                // Coba kirim dengan me-reply pesan user
                await sock.sendMessage(remoteJid, { text: response }, { quoted: msg });
                console.log('DEBUG: Send promise resolved (with quote)!');
            } catch (sendErr) {
                console.warn('⚠️ Gagal mengirim dengan quote, mencoba tanpa quote...', sendErr.message);
                // Jika gagal karena struktur quote error, kirim tanpa quote
                await sock.sendMessage(remoteJid, { text: response });
                console.log('DEBUG: Send promise resolved (without quote)!');
            }
            
            // Opsional: Simpan jawaban bot ke dalam memori grup agar bot ingat apa yang dia katakan
            if (isGroup && GROUP_CONTEXT_ENABLED) {
                addContextMessage(remoteJid, 'Thirty (Bot)', response);
            }

            // LEARNING ENGINE: Track interactions & extract memories periodically
            if (isGroup && GROUP_CONTEXT_ENABLED) {
                incrementInteractionCount(remoteJid);
                const count = getInteractionCount(remoteJid);
                const interval = getLearningInterval();
                if (count >= interval) {
                    console.log(`🧠 Learning trigger hit for ${remoteJid} (${count} interactions), extracting memories...`);
                    const history = getGroupHistory(remoteJid, 20);
                    extractAndStoreMemories(remoteJid, history);
                    resetInteractionCount(remoteJid);
                }
            }

            return;
        }

        // ==================== AUTO REPLY (Optional) ====================
        // Jika di grup dan Auto Reply enabled, bisa aktifkan ini:
        /*
        if (isGroup && process.env.AUTO_REPLY === 'true') {
            addContextMessage(remoteJid, sender, text);
            // ... logic auto reply
        }
        */

    } catch (error) {
        console.error('❌ Error handling message:', error.message);
        try {
            await sock.sendMessage(msg.key.remoteJid, { text: '❌ Maaf, ada error. Coba lagi ya.' });
        } catch (e) {}
    }
}

// ==================== REMINDER EXTRACTOR ====================

function extractReminder(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    const hasReminderKeyword = /(?:ng)?ing(?:at|et)|reminder/i.test(lower);
    if (!hasReminderKeyword) return null;

    const timePattern = /(\d{1,2})[.:](\d{2})/;
    const timeMatch = text.match(timePattern);
    if (!timeMatch) return null;

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours > 23 || minutes > 59) return null;

    let message = text
        .replace(/\d{1,2}[.:]\d{2}/, '')
        .replace(/thirty\s*/i, '')
        .replace(/(?:jam|pukul)\s*/i, '')
        .replace(/(?:ng)?ing(?:at|et)(?:kan|in|inin)?(?:\s+(?:saya|aku|gw|gue|lo|lu|elu))?\s*/i, '')
        .replace(/\breminder\s*/i, '')
        .replace(/\s+(buat|untuk|supaya|biar)\s+/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!message) message = 'Ada tugas/pekerjaan';

    // WIB timezone fix: server UTC, user WIB (UTC+7)
    const WIB_MS = 7 * 3600000;
    const nowUtc = Date.now();
    const d = new Date(nowUtc + WIB_MS); // date components in WIB
    let targetWib = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hours, minutes, 0) - WIB_MS;
    if (targetWib <= nowUtc) targetWib += 86400000;

    console.log(`🧠 extractReminder: \"${text}\" → \"${message}\" at ${hours}:${minutes} WIB`);
    return { triggerTimeMs: targetWib, message, hours, minutes };
}

// ==================== HELPER FUNCTIONS ====================

function getMessageText(msg) {
    const msgType = Object.keys(msg.message || {}).find(
        type => !type.startsWith('contextInfo') && !type.endsWith('MessagePlaceholder')
    );

    if (!msgType) return null;

    const messageObj = msg.message[msgType];

    // Handle different message types
    if (messageObj?.text) return messageObj.text;
    if (messageObj?.caption) return messageObj.caption;
    if (typeof messageObj === 'string') return messageObj;

    return null;
}

function getQuotedText(msg) {
    const msgType = Object.keys(msg.message || {}).find(
        type => !type.startsWith('contextInfo') && !type.endsWith('MessagePlaceholder')
    );
    if (!msgType) return null;

    const contextInfo = msg.message?.[msgType]?.contextInfo;
    const quotedMsg = contextInfo?.quotedMessage;
    
    if (!quotedMsg) return null;

    const quotedType = Object.keys(quotedMsg).find(
        type => !type.startsWith('contextInfo') && !type.endsWith('MessagePlaceholder')
    );

    if (!quotedType) return null;

    const messageObj = quotedMsg[quotedType];

    if (messageObj?.text) return messageObj.text;
    if (messageObj?.caption) return messageObj.caption;
    if (typeof messageObj === 'string') return messageObj;
    
    // Return placeholders untuk tipe media/file agar AI tahu apa yang sedang di-reply
    if (quotedType === 'imageMessage') return '[Gambar]';
    if (quotedType === 'videoMessage') return '[Video]';
    if (quotedType === 'audioMessage') return '[Voice Note / Audio]';
    if (quotedType === 'stickerMessage') return '[Stiker]';
    if (quotedType === 'documentMessage') return `[Dokumen: ${messageObj.title || messageObj.fileName || 'File'}]`;

    return '[Pesan/Media Tidak Dikenal]';
}

async function sendHelp(sock, jid) {
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

async function handleJadwalCommand(sock, jid, isGroup, args, sender) {
    if (!isGroup) {
        await sock.sendMessage(jid, { text: '❌ Command jadwal hanya bisa dipakai di grup.' });
        return;
    }

    const subCommand = args[0]?.toLowerCase();

    if (!subCommand || subCommand === 'list') {
        const jadwal = getJadwal(jid);
        if (jadwal.length === 0) {
            await sock.sendMessage(jid, { text: '📅 Belum ada jadwal di grup ini.\nTambah dengan: /jadwal add [tanggal] [event]' });
            return;
        }

        const listText = '📅 *Daftar Jadwal:*\n' +
            jadwal.map(j => `${j.id}. [${j.tanggal}] ${j.event}`).join('\n');

        await sock.sendMessage(jid, { text: listText });
        return;
    }

    if (subCommand === 'add') {
        const tanggal = args[1];
        const event = args.slice(2).join(' ');

        if (!tanggal || !event) {
            await sock.sendMessage(jid, { text: '❌ Usage: /jadwal add [tanggal] [event]\nContoh: /jadwal add 2025-05-20 Meeting tim' });
            return;
        }

        addJadwal(jid, tanggal, event);
        await sock.sendMessage(jid, { text: `✅ Jadwal ditambahkan!\n📅 ${tanggal}: ${event}` });
        return;
    }

    if (subCommand === 'del') {
        const id = parseInt(args[1]);
        if (!id) {
            await sock.sendMessage(jid, { text: '❌ Usage: /jadwal del [id]' });
            return;
        }

        const deleted = deleteJadwal(id, jid);
        if (deleted) {
            await sock.sendMessage(jid, { text: `✅ Jadwal #${id} dihapus.` });
        } else {
            await sock.sendMessage(jid, { text: '❌ Jadwal tidak ditemukan.' });
        }
        return;
    }

    await sock.sendMessage(jid, { text: '❌ Command tidak valid. Ketik /help untuk bantuan.' });
}