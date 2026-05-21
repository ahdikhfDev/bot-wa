import { callAI, chatWithContext, transcribeAudio, callAIVision, getVoiceBuffer, extractAndStoreMemories, extractFromDocument } from '../services/ai.js';
import { addContextMessage, getMode, isWhitelisted, addMemory, getInteractionCount, incrementInteractionCount, resetInteractionCount, broadcastTargets, pendingBroadcasts, deletePendingBroadcast } from '../services/db.js';
import { downloadMediaMessage } from 'baileys';
import fs from 'fs/promises';
import path from 'path';
import { findSkillByCommand, findSkillByNaturalLanguage, isSkillEnabled } from '../skills/_loader.js';
import { formatSearchResults } from '../services/search.js';

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

        // ==================== BUILD CONTEXT OBJECT ====================
        const context = { sock, msg, remoteJid, senderJid, senderNumber, isOwner };

        // ==================== REMINDER DETECTION (sebelum apapun) ====================
        const reminderSkill = findSkillByNaturalLanguage(messageContent);
        if (reminderSkill && reminderSkill.skill.name === 'reminder') {
            const handled = await reminderSkill.skill.execute(sock, remoteJid, messageContent, isOwner);
            if (handled) return;
        }

        // ==================== ANTI-SPAM COOLDOWN ====================
        if (!isOwner) {
            const now = Date.now();
            const lastTime = spamCooldowns.get(remoteJid) || 0;
            if (now - lastTime < SPAM_COOLDOWN_MS) return;
            spamCooldowns.set(remoteJid, now);
        }

        // ==================== MEDIA TYPE DETECTION ====================
        let isAudio = false, isImage = false, isDocument = false;
        let audioMsgToDownload = null, imageMsgToDownload = null, documentMsgToDownload = null;

        const msgType = Object.keys(msg.message || {}).find(
            type => !type.startsWith('contextInfo') && !type.endsWith('MessagePlaceholder')
        );

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
        const botNumber = sock.user?.id?.split('@')[0]?.split(':')[0];
        const botLid = sock.user?.lid?.split('@')[0]?.split(':')[0];

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

        let text = messageContent.trim();
        let command = text.startsWith(PREFIX) ? text.slice(1).split(' ')[0].toLowerCase() : null;
        let args = text.split(' ').slice(1);
        const quotedText = getQuotedText(msg);

        if (GROUP_CONTEXT_ENABLED && text) {
            addContextMessage(remoteJid, sender, text);
        }

        console.log(`📨 [${isGroup ? 'GRUP' : 'DM'}] ${sender}: ${text.substring(0, 80)}`);
        if (command) console.log(`   → Command: ${command}`);

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
            }
        }

        // ==================== SECURITY & WHITELIST ====================
        isOwner = senderNumber === OWNER_NUMBER || senderNumber === OWNER_LID;
        console.log(`   → senderJid: ${senderJid}, isOwner: ${isOwner}`);

        const isAuthorized = isOwner || isWhitelisted(remoteJid) || isWhitelisted(senderJid);
        if (!isAuthorized) {
            if (command || isMentioned) {
                await sock.sendMessage(remoteJid, { text: '⛔ *Akses Ditolak*\nMaaf, Anda tidak memiliki izin untuk menggunakan bot ini. Silakan hubungi Maha Raja Ahdi Khalida Fathir.' });
            }
            return;
        }

        // ==================== AUDIO / VOICE NOTE ====================
        if (isAudio && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '⏳ _Mendengarkan Voice Note..._' });
            try {
                const buffer = await downloadMediaMessage(
                    audioMsgToDownload, 'buffer', {},
                    { logger: console, reuploadRequest: sock.updateMediaMessage }
                );
                const tempPath = path.join(process.cwd(), `temp_${Date.now()}.ogg`);
                await fs.writeFile(tempPath, buffer);
                const transcript = await transcribeAudio(tempPath);
                await fs.unlink(tempPath).catch(() => {});
                if (transcript) {
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

        // ==================== IMAGE / VISION ====================
        if (isImage && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '👁️ _Sedang melihat gambar..._' });
            try {
                const buffer = await downloadMediaMessage(
                    imageMsgToDownload, 'buffer', {},
                    { logger: console, reuploadRequest: sock.updateMediaMessage }
                );
                const base64Image = buffer.toString('base64');
                const mode = getMode(remoteJid);
                const prompt = (text && text !== '[Gambar]') ? text : null;
                const { buildContext } = await import('../services/contextBuilder.js');
                const ctx = buildContext(remoteJid, prompt || '');
                const response = await callAIVision(prompt, base64Image, mode, remoteJid, ctx.contextText);
                await sock.sendMessage(remoteJid, { text: response });
                return;
            } catch (err) {
                console.error('Vision processing error:', err);
                await sock.sendMessage(remoteJid, { text: '❌ Terjadi kesalahan saat memproses gambar.' });
                return;
            }
        }

        // ==================== DOCUMENT / PDF ====================
        if (isDocument && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '📄 _Membaca dokumen..._' });
            try {
                const buffer = await downloadMediaMessage(
                    documentMsgToDownload, 'buffer', {},
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
                } else if (fileName.toLowerCase().endsWith('.docx')) {
                    const mammoth = await import('mammoth');
                    const result = await mammoth.extractRawText({ buffer });
                    docText = (result.value || '').substring(0, 3000);
                } else {
                    docText = buffer.toString('utf-8').substring(0, 3000);
                }

                if (docText.trim().length < 10) {
                    await sock.sendMessage(remoteJid, { text: `📄 *${fileName}*\n\n_(Dokumen kosong atau tidak bisa dibaca)_` });
                    return;
                }

                const caption = text && text !== `[Dokumen: ${fileName}]` ? text : `Ini isi dari ${fileName}. Jelaskan secara singkat.`;
                const mode = getMode(remoteJid);
                const response = await callAI(`Isi dokumen: """${docText.substring(0, 2000)}"""\n\nPertanyaan: ${caption}`, [], mode, remoteJid);
                await sock.sendMessage(remoteJid, { text: `📄 *${fileName}*\n\n${response}` });

                addMemory(remoteJid, `Isi dokumen "${fileName}": ${docText.substring(0, 500)}`, 'document', 10, 'document');
                addMemory(remoteJid, `Ringkasan "${fileName}": ${response.substring(0, 300)}`, 'document', 10, 'document');

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

        // Re-parse command & args in case text changed (transcript)
        command = text.startsWith(PREFIX) ? text.slice(1).split(' ')[0].toLowerCase() : null;
        args = text.split(' ').slice(1);

        // ==================== SKILL COMMAND DISPATCH ====================
        if (command) {
            const skill = findSkillByCommand(command);
            if (skill) {
                // Check owner-only
                if (skill.ownerOnly && !isOwner) {
                    await sock.sendMessage(remoteJid, { text: '⛔ *Akses Ditolak*\nHanya Maha Raja yang bisa.' });
                    return;
                }
                // Check group-only
                if (skill.groupOnly && !isGroup) {
                    await sock.sendMessage(remoteJid, { text: '❌ Command ini hanya bisa dipakai di grup.' });
                    return;
                }
                await skill.handler(sock, remoteJid, args, {
                    command, isOwner, isGroup, msg, sender, text,
                    mentionedJids, quotedText, GROUP_CONTEXT_ENABLED, isAudio
                });
                return;
            }
        }

        // ==================== SEARCH KEYWORD DETECTION ====================
        if (!command && (isPrivateChat || (isGroup && isMentioned))) {
            const nlMatch = findSkillByNaturalLanguage(text);
            if (nlMatch && nlMatch.skill.name === 'search') {
                const result = nlMatch.result;
                await sock.sendPresenceUpdate('composing', remoteJid);
                const { searchWeb, searchNews } = await import('../services/search.js');
                await sock.sendMessage(remoteJid, { text: `🔍 *Mencari ${result.type === 'news' ? 'berita' : 'info'} tentang:* ${result.query}...` });
                const results = result.type === 'news'
                    ? await searchNews(result.query)
                    : await searchWeb(result.query);
                await sock.sendMessage(remoteJid, { text: formatSearchResults(results) });
                return;
            }
        }

        // ==================== AI CHAT ====================
        if (isPrivateChat || (isGroup && isMentioned)) {
            const aiSkill = findSkillByCommand('__ai__');
            if (aiSkill) {
                await aiSkill.respond(sock, remoteJid, text, {
                    msg, isGroup, isMentioned, isPrivateChat, isAudio,
                    GROUP_CONTEXT_ENABLED, quotedText
                });
            } else {
                // Fallback: direct AI call
                await sock.sendPresenceUpdate('composing', remoteJid);
                const mode = getMode(remoteJid);
                let promptText = text;
                if (quotedText) {
                    promptText = `(Membalas pesan: "${quotedText}")\n\n${text}`;
                }
                const response = await chatWithContext(promptText, mode, remoteJid);
                await sock.sendMessage(remoteJid, { text: response }, { quoted: msg }).catch(() => {
                    sock.sendMessage(remoteJid, { text: response });
                });
                if (GROUP_CONTEXT_ENABLED) {
                    addContextMessage(remoteJid, 'Thirty (Bot)', response);
                }
            }
            return;
        }

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

    if (quotedType === 'imageMessage') return '[Gambar]';
    if (quotedType === 'videoMessage') return '[Video]';
    if (quotedType === 'audioMessage') return '[Voice Note / Audio]';
    if (quotedType === 'stickerMessage') return '[Stiker]';
    if (quotedType === 'documentMessage') return `[Dokumen: ${messageObj.title || messageObj.fileName || 'File'}]`;

    return '[Pesan/Media Tidak Dikenal]';
}
