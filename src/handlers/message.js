import { callAI, summarizeText, chatWithContext, transcribeAudio, callAIVision, getVoiceBuffer } from '../services/ai.js';
import { addJadwal, getJadwal, deleteJadwal, addContextMessage, getGroupHistory, clearGroupContext, getMode, setMode, isWhitelisted, addWhitelist, removeWhitelist, getAllWhitelist } from '../services/db.js';
import { downloadMediaMessage } from 'baileys';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import fs from 'fs/promises';
import path from 'path';

const PREFIX = process.env.BOT_PREFIX || '/';
const BOT_NAME = process.env.BOT_NAME || 'WA Bot AI';
const GROUP_CONTEXT_ENABLED = process.env.GROUP_CONTEXT_ENABLED !== 'false';

export async function handleMessage(sock, msg) {
    try {
        let messageContent = getMessageText(msg);
        let isAudio = false;

        const msgType = Object.keys(msg.message || {}).find(
            type => !type.startsWith('contextInfo') && !type.endsWith('MessagePlaceholder')
        );

        let audioMsgToDownload = null;
        let isImage = false;
        let imageMsgToDownload = null;

        if (msgType === 'audioMessage') {
            isAudio = true;
            messageContent = '[Voice Note]'; // Placeholder agar tidak di-return awal
            audioMsgToDownload = msg;
        } else if (msgType === 'imageMessage') {
            isImage = true;
            messageContent = msg.message.imageMessage.caption || '[Gambar]';
            imageMsgToDownload = msg;
        } else {
            // Cek apakah pesan meng-quote (me-reply) sebuah media
            const contextInfo = msg.message?.[msgType]?.contextInfo || {};
            const quotedMsg = contextInfo.quotedMessage;
            
            if (quotedMsg && quotedMsg.audioMessage) {
                isAudio = true;
                audioMsgToDownload = { key: msg.key, message: quotedMsg };
            } else if (quotedMsg && quotedMsg.imageMessage) {
                isImage = true;
                imageMsgToDownload = { key: msg.key, message: quotedMsg };
            }
        }

        if (!messageContent && !isAudio && !isImage) return;

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
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

        // ==================== SECURITY & WHITELIST ====================
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const senderNumber = senderJid.split('@')[0];
        
        // Owner bisa dikenali dari Nomor HP atau dari LID (Logical ID) jika di grup
        const OWNER_NUMBER = process.env.OWNER_NUMBER;
        const OWNER_LID = '36722373091439'; // LID dari hasil debug log
        const isOwner = senderNumber === OWNER_NUMBER || senderNumber === OWNER_LID;
        
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

        // Hitung ulang command & args jika teks berubah (hasil transkrip)
        command = text.startsWith(PREFIX) ? text.slice(1).split(' ')[0].toLowerCase() : null;
        args = text.split(' ').slice(1);

        // ==================== OWNER COMMANDS ====================
        if (command === 'allow' && isOwner) {
            let targetJid = remoteJid; // Default: allow chat saat ini (grup atau DM)
            
            if (mentionedJids.length > 0) {
                targetJid = mentionedJids[0]; // Allow user yang di-tag
            } else if (args[0]) {
                const num = args[0].replace(/[^0-9]/g, '');
                if (num) targetJid = `${num}@s.whatsapp.net`; // Allow via nomor HP
            }

            addWhitelist(targetJid);
            await sock.sendMessage(remoteJid, { text: `✅ *Akses Diberikan*\nTarget: ${targetJid}\nSekarang diizinkan menggunakan bot.` });
            return;
        }

        if (command === 'say') {
            const voiceBuffer = await getVoiceBuffer(args.join(' '));
            if (voiceBuffer) {
                await sock.sendMessage(remoteJid, { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
                return;
            }
        }

        if (command === 's' || command === 'sticker') {
            let mediaToSticker = null;
            if (isImage) {
                mediaToSticker = imageMsgToDownload;
            } else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                mediaToSticker = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
            }

            if (mediaToSticker) {
                try {
                    const buffer = await downloadMediaMessage(mediaToSticker, 'buffer', {}, { logger: console });
                    const sticker = new Sticker(buffer, {
                        pack: 'Thirty AI Sticker',
                        author: 'Maha Raja Ahdi Khalida Fathir',
                        type: StickerTypes.FULL,
                        categories: ['🤩', '🎉'],
                        id: 'thirty-ai',
                        quality: 70,
                    });
                    const stickerBuffer = await sticker.toBuffer();
                    await sock.sendMessage(remoteJid, { sticker: stickerBuffer }, { quoted: msg });
                    return;
                } catch (err) {
                    console.error('Sticker Error:', err);
                    await sock.sendMessage(remoteJid, { text: '❌ Gagal membuat stiker. Pastikan file adalah gambar yang valid.' });
                    return;
                }
            } else {
                await sock.sendMessage(remoteJid, { text: '📸 *Cara Pakai:* Kirim gambar dengan caption */s* atau balas (reply) gambar dengan */s*.' });
                return;
            }
        }

        if (command === 'ban' && isOwner) {
            let targetJid = remoteJid; 
            
            if (mentionedJids.length > 0) {
                targetJid = mentionedJids[0]; 
            } else if (args[0]) {
                const num = args[0].replace(/[^0-9]/g, '');
                if (num) targetJid = `${num}@s.whatsapp.net`;
            }

            removeWhitelist(targetJid);
            await sock.sendMessage(remoteJid, { text: `❌ *Akses Dicabut*\nTarget: ${targetJid}\nSekarang dilarang menggunakan bot.` });
            return;
        }

        if (command === 'list' && isOwner) {
            const list = getAllWhitelist();
            if (list.length === 0) {
                await sock.sendMessage(remoteJid, { text: '📭 Daftar whitelist masih kosong.' });
                return;
            }
            const textList = list.map((item, index) => `${index + 1}. ${item.jid}`).join('\n');
            await sock.sendMessage(remoteJid, { text: `📋 *Daftar Whitelist (Akses)*\n\n${textList}` });
            return;
        }

        // ==================== COMMAND HANDLERS ====================

        if (command === 'help') {
            await sendHelp(sock, remoteJid);
            return;
        }

        if (command === 'mode') {
            const newMode = args[0]?.toLowerCase();
            const validModes = ['bad', 'formal', 'profesional', 'asik'];
            
            if (!newMode || !validModes.includes(newMode)) {
                await sock.sendMessage(remoteJid, { 
                    text: `⚙️ *Setting Mode AI*\n\nPilih gaya bicara bot:\n• \`/mode asik\` (Santai & gaul)\n• \`/mode formal\` (Baku & sopan)\n• \`/mode profesional\` (Solutif & elegan)\n• \`/mode bad\` (Sarkas & pedas)\n\n_Mode saat ini: *${getMode(remoteJid)}*_` 
                });
                return;
            }

            setMode(remoteJid, newMode);
            await sock.sendMessage(remoteJid, { text: `✅ Mode AI berhasil diubah ke *${newMode}*! Coba ajak ngobrol sekarang.` });
            return;
        }

        if (command === 'rangkum') {
            const inputText = args.join(' ');
            if (!inputText) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /rangkum [teks yang mau dirangkum]' });
                return;
            }
            const mode = getMode(remoteJid);
            const summary = await summarizeText(inputText, mode);
            await sock.sendMessage(remoteJid, { text: `📝 *Rangkuman:*\n\n${summary}` });
            return;
        }

        if (command === 'jadwal') {
            await handleJadwalCommand(sock, remoteJid, isGroup, args, sender);
            return;
        }

        if (command === 'reset') {
            if (!isOwner) {
                await sock.sendMessage(remoteJid, { text: '⛔ *Akses Ditolak*\nHanya Maha Raja yang bisa mereset ingatan saya.' });
                return;
            }
            if (isGroup) {
                clearGroupContext(remoteJid);
                await sock.sendMessage(remoteJid, { text: '🧹 Konteks grup sudah di-reset oleh Maha Raja!' });
            }
            return;
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

            await sock.sendMessage(remoteJid, { text: response });
            
            // Opsional: Simpan jawaban bot ke dalam memori grup agar bot ingat apa yang dia katakan
            if (isGroup && GROUP_CONTEXT_ENABLED) {
                addContextMessage(remoteJid, 'Thirty (Bot)', response);
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
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || 
                        msg.message?.imageMessage?.contextInfo || 
                        msg.message?.videoMessage?.contextInfo;
    
    const quotedMsg = contextInfo?.quotedMessage;
    if (!quotedMsg) return null;

    const msgType = Object.keys(quotedMsg).find(
        type => !type.startsWith('contextInfo') && !type.endsWith('MessagePlaceholder')
    );

    if (!msgType) return null;

    const messageObj = quotedMsg[msgType];

    if (messageObj?.text) return messageObj.text;
    if (messageObj?.caption) return messageObj.caption;
    if (typeof messageObj === 'string') return messageObj;

    return null;
}

async function sendHelp(sock, jid) {
    const helpText = `✨ *THIRTY AI - Command Center* ✨

Halo! Saya adalah *Thirty*, asisten AI cerdas yang siap membantu kebutuhanmu. 🤖🦾

🤖 *PENGATURAN AI*
• 🎨 */mode* : Ganti kepribadian (bad, formal, profesional, asik)

🛠️ *FITUR MULTIMEDIA*
• 🎙️ *Voice Note* : Kirim VN, saya akan dengerin & balas pakai VN juga!
• 👁️ *Vision AI* : Kirim/balas foto untuk saya analisis isinya.
• 🎨 */s* atau */sticker* : Ubah foto jadi stiker secara instan.
• 🗣️ */say [teks]* : Suruh saya bicara dalam bentuk pesan suara.

📅 *MANAGEMENT & PRODUCTIVITY*
• 📝 */rangkum [teks]* : Ringkas pesan yang panjang jadi pendek.
• 🕒 *Auto Reminder* : Cukup ketik "Ingatkan saya [jam] buat [acara]", saya akan catat otomatis!
• 📅 */jadwal list* : Lihat semua daftar jadwal di grup.

💡 *TIPS:*
- Di *Grup*, saya merespon jika dipanggil "Thirty", di-mention, atau membalas pesan saya.
- Di *Private Chat*, kita bisa ngobrol langsung kapan saja!

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