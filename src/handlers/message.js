import { callAI, chatWithContext, transcribeAudio, callAIVision, extractFromDocument } from '../services/ai.js';
import { addContextMessage, getMode, isWhitelisted, addMemory, broadcastTargets, pendingBroadcasts, deletePendingBroadcast } from '../services/db.js';
import { log, error } from '../utils/logger.js';
import { downloadContentFromMessage } from 'baileys';
import fs from 'fs/promises';
import path from 'path';
import { findSkillByCommand, findSkillByNaturalLanguage } from '../skills/_loader.js';
import { formatSearchResults, searchWeb, searchNews } from '../services/search.js';
import { buildContext } from '../services/contextBuilder.js';
import { CONFIG, assertBufferLimit, isOwnerId } from '../config.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';
import {
    getModerationConfig, checkFlood, checkToxic, checkLinkSpam,
    issueWarning, getModerationAction, extractUrls
} from '../services/autoModerator.js';
const spamCooldowns = new Map();
setInterval(() => spamCooldowns.clear(), 60 * 60 * 1000);

// Per-user rate limiting: max N AI requests per minute
const userRateLimits = new Map();
const RATE_LIMIT_MAX = 10;    // max 10 requests
const RATE_LIMIT_WINDOW = 60 * 1000; // per 60 detik

function checkRateLimit(userJid) {
    const now = Date.now();
    if (!userRateLimits.has(userJid)) {
        userRateLimits.set(userJid, []);
    }
    const timestamps = userRateLimits.get(userJid);
    // Filter out old timestamps
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    recent.push(now);
    userRateLimits.set(userJid, recent);
    return recent.length <= RATE_LIMIT_MAX;
}

// Cleanup rate limit data every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW;
    for (const [jid, times] of userRateLimits) {
        const recent = times.filter(t => t > cutoff);
        if (recent.length === 0) userRateLimits.delete(jid);
        else userRateLimits.set(jid, recent);
    }
}, 5 * 60 * 1000);

// Cooldown untuk smart nimbrung (biar gak kebanyakan chat)
const nimbrungCooldowns = new Map();
setInterval(() => {
    const cutoff = Date.now() - 600000; // 10 menit
    for (const [jid, time] of nimbrungCooldowns) {
        if (time < cutoff) nimbrungCooldowns.delete(jid);
    }
}, 600000);

/**
 * Safe media downloader using streaming to prevent OOM
 */
async function safeDownloadMedia(msg, type, limit) {
    const stream = await downloadContentFromMessage(msg.message[type], type.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > limit) {
            const mb = (limit / 1024 / 1024).toFixed(0);
            throw new Error(`Media terlalu besar. Maksimal ${mb}MB.`);
        }
    }
    return buffer;
}

export async function handleMessage(sock, msg) {
    try {
        let messageContent = getMessageText(msg);
        if (!msg.message) {
            console.log('[DEBUG] Early return: !msg.message');
            return;
        }

        let remoteJid = msg.key.remoteJid;
        let senderJid = msg.key.participant || msg.key.remoteJid;
        let senderNumber = senderJid.split('@')[0];
        const isGroup = remoteJid.endsWith('@g.us');
        let isOwner = isOwnerId(senderJid) || isOwnerId(senderNumber);

        // Debug: log message type for ALL messages from Ahdi
        if (msg.pushName === 'Ahdi Khalida Fathir') {
            const msgKeys = Object.keys(msg.message || {});
            console.log('[DEBUG_MSG] msgType=' + JSON.stringify(msgKeys) + ' content=' + JSON.stringify(messageContent?.substring(0, 30)));
        }

        // ==================== ANTI-SPAM COOLDOWN ====================
        if (!isOwner) {
            const cooldownKey = isGroup ? senderJid : remoteJid;
            const now = Date.now();
            const lastTime = spamCooldowns.get(cooldownKey) || 0;
            if (now - lastTime < CONFIG.spamCooldownMs) return;
            spamCooldowns.set(cooldownKey, now);
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
        if (text.length > CONFIG.maxTextLength) {
            if (isPrivateChat || isMentioned || text.startsWith(CONFIG.prefix)) {
                await sock.sendMessage(remoteJid, { text: `Pesan terlalu panjang. Maksimal ${CONFIG.maxTextLength} karakter.` });
            }
            return;
        }
        let { command, args } = parseCommand(text);
        const quotedText = getQuotedText(msg);

        log('MSG', `[${isGroup ? 'GRUP' : 'DM'}] ${sender}: ${text.substring(0, 80)}`);
        if (command) log('CMD', command + ' dari ' + sender);

        // ==================== BROADCAST CONFIRMATION ====================
        if (isOwner && !command) {
            const pending = pendingBroadcasts.get(remoteJid);
            if (pending) {
                // Must reply to bot's confirmation message
                const isReplyToBot = quotedText && (quotedText.includes('_Kirim? (y/n)_') || quotedText.includes('Broadcast ke'));
                
                if (isReplyToBot) {
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
        }

        // ==================== SECURITY & WHITELIST ====================
        isOwner = isOwnerId(senderJid) || isOwnerId(senderNumber);

        // Debug log untuk tracking authorization
        const wlRemote = isWhitelisted(remoteJid);
        const wlSender = isWhitelisted(senderJid);
        const isAuthorized = isOwner || wlRemote || wlSender;

        if (command || isMentioned) {
            console.log(`[AUTH] senderJid=${senderJid} senderNumber=${senderNumber} isOwner=${isOwner} wlRemote=${wlRemote} wlSender=${wlSender} isAuthorized=${isAuthorized}`);
        }
        if (!isAuthorized) {
            if (command || isMentioned) {
                await sock.sendMessage(remoteJid, { text: '⛔ *Akses Ditolak*\nMaaf, Anda tidak memiliki izin untuk menggunakan bot ini. Silakan hubungi Maha Raja Ahdi Khalida Fathir.' });
            }
            return;
        }

        // ==================== AUTO-MODERATOR (Community) ====================
        if (isGroup && !isOwner) {
            const modCfg = getModerationConfig(remoteJid);
            
            if (modCfg.enabled && text && !command) {
                let shouldBlock = false;
                let blockReason = '';

                // 1. Flood check
                if (modCfg.floodProtection) {
                    const flood = checkFlood(senderJid);
                    if (flood.isFlood) {
                        log('MOD_FLOOD', `${sender} flood (${flood.messageCount} msg)`);
                        return; // Silent drop — jangan spam grup
                    }
                }

                // 2. Toxic content check
                if (modCfg.toxicFilter) {
                    const toxic = checkToxic(text);
                    
                    if (toxic.isToxic) {
                        const warnCount = issueWarning(senderJid, `Toxic content: ${toxic.matchedPattern}`);
                        const action = getModerationAction(warnCount, modCfg, sender);
                        
                        await sock.sendMessage(remoteJid, {
                            text: action.message,
                            mentions: [senderJid]
                        });

                        if (action.shouldKick) {
                            try {
                                await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove');
                                log('MOD_KICK', `${sender} kicked from ${remoteJid} (toxic)`);
                            } catch (err) {
                                log('MOD_KICK_FAIL', `Failed to kick ${sender}: ${err.message}`);
                            }
                        }
                        return; // Block message
                    }

                    if (toxic.isCapsAbuse) {
                        if (modCfg.capsFilter) {
                            await sock.sendMessage(remoteJid, {
                                text: `⚠️ @${sender} Mohon jangan gunakan huruf kapital berlebihan.`,
                                mentions: [senderJid]
                            });
                            return;
                        }
                    }

                    if (toxic.isLinkFlood) {
                        const warnCount = issueWarning(senderJid, 'Too many links in one message');
                        const action = getModerationAction(warnCount, modCfg, sender);
                        await sock.sendMessage(remoteJid, {
                            text: `⚠️ @${sender} Terlalu banyak link dalam satu pesan (${toxic.linkCount}).`,
                            mentions: [senderJid]
                        });
                        return;
                    }
                }

                // 3. Link spam protection
                if (modCfg.linkSpamProtection !== 'disabled' && modCfg.linkSpamProtection !== 'draft') {
                    const urls = extractUrls(text);
                    for (const url of urls) {
                        const linkSpam = checkLinkSpam(remoteJid, url);
                        if (linkSpam.isSpam) {
                            const warnCount = issueWarning(senderJid, `Link spam: ${url}`);
                            const action = getModerationAction(warnCount, modCfg, sender);
                            await sock.sendMessage(remoteJid, {
                                text: `⚠️ @${sender} Link ini sudah diposting ${linkSpam.count} kali. Mohon jangan spam.`,
                                mentions: [senderJid]
                            });
                            if (action.shouldKick) {
                                try {
                                    await sock.groupParticipantsUpdate(remoteJid, [senderJid], 'remove');
                                    log('MOD_KICK', `${sender} kicked from ${remoteJid} (link spam)`);
                                } catch (err) {}
                            }
                            return;
                        }
                    }
                }
            }
        }

        // ==================== AUDIO / VOICE NOTE ====================
        if (isAudio && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '⏳ _Mendengarkan Voice Note..._' });
            try {
                const buffer = await safeDownloadMedia(
                    audioMsgToDownload, 'audioMessage', CONFIG.maxInboundMediaBytes
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
                error('Audio processing', err);
                await sock.sendMessage(remoteJid, { text: '❌ Terjadi kesalahan saat memproses audio.' });
                return;
            }
        }

        // ==================== IMAGE / VISION ====================
        if (isImage && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '👁️ _Sedang melihat gambar..._' });
            try {
                const buffer = await safeDownloadMedia(
                    imageMsgToDownload, 'imageMessage', CONFIG.maxInboundMediaBytes
                );
                const base64Image = buffer.toString('base64');
                const mode = getMode(remoteJid);
                const prompt = (text && text !== '[Gambar]') ? text : null;
                const ctx = buildContext(remoteJid, prompt || '');
                const response = await callAIVision(prompt, base64Image, mode, remoteJid, ctx.contextText);
                await sock.sendMessage(remoteJid, { text: response });
                return;
            } catch (err) {
                error('Vision processing', err);
                await sock.sendMessage(remoteJid, { text: '❌ Terjadi kesalahan saat memproses gambar.' });
                return;
            }
        }

        // ==================== DOCUMENT / PDF ====================
        if (isDocument && (isPrivateChat || (isGroup && isMentioned))) {
            await sock.sendMessage(remoteJid, { text: '📄 _Membaca dokumen..._' });
            try {
                const buffer = await safeDownloadMedia(
                    documentMsgToDownload, 'documentMessage', CONFIG.maxInboundMediaBytes
                );

                const msgType = Object.keys(msg.message || {}).find(t => !t.startsWith('contextInfo'));
                const directDoc = msg.message?.documentMessage;
                const quotedDoc = msg.message?.[msgType]?.contextInfo?.quotedMessage?.documentMessage;
                const docInfo = directDoc || quotedDoc || {};
                const fileName = docInfo.fileName || 'file';
                const isPDF = fileName.toLowerCase().endsWith('.pdf');

                let docText = '';
                if (isPDF) {
                    const PDFParser = pdfParse.PDFParse || pdfParse;
                    const parser = new PDFParser(buffer);
                    const data = await parser.parse();
                    docText = (data?.text || '').substring(0, 3000);
                } else if (fileName.toLowerCase().endsWith('.docx')) {
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
                error('Document processing', err);
                await sock.sendMessage(remoteJid, { text: '❌ Gagal membaca dokumen.' });
                return;
            }
        }

        // Re-parse command & args in case text changed (transcript)
        ({ command, args } = parseCommand(text));

        // Simpan konteks hanya untuk user yang sudah terverifikasi whitelist
        if (CONFIG.groupContextEnabled && text) {
            addContextMessage(remoteJid, sender, text);
        }

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
                if (skill.adminOnly && isGroup && !isOwner) {
                    const allowed = await isGroupAdmin(sock, remoteJid, senderJid);
                    if (!allowed) {
                        await sock.sendMessage(remoteJid, { text: '⛔ Command ini hanya untuk admin grup.' });
                        return;
                    }
                }
                await skill.handler(sock, remoteJid, args, {
                    command, isOwner, isGroup, msg, sender, text,
                    mentionedJids, quotedText, GROUP_CONTEXT_ENABLED: CONFIG.groupContextEnabled, isAudio
                });
                return;
            }
        }

        // ==================== REMINDER NATURAL LANGUAGE ====================
        if (!command && (isPrivateChat || (isGroup && isMentioned))) {
            const rSkill = findSkillByNaturalLanguage(text);
            if (rSkill && rSkill.skill.name === 'reminder') {
                const handled = await rSkill.skill.execute(sock, remoteJid, text, isOwner);
                if (handled) return;
            }
        }

        // ==================== SEARCH KEYWORD DETECTION ====================
        if (!command && (isPrivateChat || (isGroup && isMentioned))) {
            const nlMatch = findSkillByNaturalLanguage(text);
            if (nlMatch && nlMatch.skill.name === 'search') {
                const result = nlMatch.result;
                await sock.sendPresenceUpdate('composing', remoteJid);
                await sock.sendMessage(remoteJid, { text: `🔍 *Mencari ${result.type === 'news' ? 'berita' : 'info'} tentang:* ${result.query}...` });
                const results = result.type === 'news'
                    ? await searchNews(result.query)
                    : await searchWeb(result.query);
                await sock.sendMessage(remoteJid, { text: formatSearchResults(results) });
                return;
            }
        }

        // ==================== RATE LIMIT CHECK ====================
        if (!isOwner && (isPrivateChat || (isGroup && isMentioned))) {
            if (!checkRateLimit(senderJid)) {
                await sock.sendMessage(remoteJid, { text: '⏳ Mohon tunggu sebentar. Ada terlalu banyak permintaan.' });
                return;
            }
        }

        // ==================== AI CHAT ====================
        if (isPrivateChat || (isGroup && isMentioned)) {
            const aiSkill = findSkillByCommand('__ai__');
            if (aiSkill) {
                await aiSkill.respond(sock, remoteJid, text, {
                    msg, isGroup, isMentioned, isPrivateChat, isAudio,
                    GROUP_CONTEXT_ENABLED: CONFIG.groupContextEnabled, quotedText
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
                if (CONFIG.groupContextEnabled) {
                    addContextMessage(remoteJid, 'Thirty (Bot)', response);
                }
            }
            return;
        }

        // ==================== SMART NIMBRUNG (Community Admin) ====================
        // Bot bisa nimbrung kyk admin beneran kalo ada yg minta tolong di grup
        if (isGroup && !command && text) {
            try {
                const cfg = getModerationConfig(remoteJid);
                if (cfg && cfg.enabled) {
                    const targetJid = cfg.announcementGroupJid || remoteJid;
                    const now = Date.now();
                    const lastChime = nimbrungCooldowns.get(remoteJid) || 0;
                    
                    // Deteksi minta tolong / bantuan
                    const helpPattern = /(tolong|bantuan|bantu|minta tolong|gimana cara|bagaimana|cara pakai|ada yang tau|siapa yang bisa|help|how to|what is|anyone know|ada masalah|error|gak bisa|ga bisa|tidak bisa|rusak)/i;
                    const isHelpRequest = helpPattern.test(text);
                    
                    // Chime in kalo ada yg minta tolong (cooldown 5 menit per grup)
                    if (isHelpRequest && (now - lastChime) > 300000) {
                        nimbrungCooldowns.set(remoteJid, now);
                        
                        console.log('[NIMBRUNG] Detected help request in', remoteJid, ':', text.substring(0, 50));
                        await sock.sendPresenceUpdate('composing', targetJid);
                        const mode = getMode(remoteJid);
                        const promptText = `(Seseorang di grup WhatsApp minta bantuan/bertanya: "${text.substring(0, 200)}")\n\nJawab dengan ramah dan membantu sebagai admin bot yang peduli. Berikan solusi atau bantuan yang relevan. Jika tidak tahu, arahkan ke admin grup.`;
                        const response = await chatWithContext(promptText, mode, remoteJid);
                        await sock.sendMessage(targetJid, { text: response });
                        log('NIMBRUNG', `Chimed in on help request in ${remoteJid}`);
                        return;
                    }
                }
            } catch (err) {
                error('Smart nimbrung', err);
            }
        }

    } catch (err) {
        error('Gagal handle message', err);
        try {
            await sock.sendMessage(msg.key.remoteJid, { text: '❌ Maaf, ada error. Coba lagi ya.' });
        } catch (e) {}
    }
}

// ==================== HELPER FUNCTIONS ====================

export function getMessageText(msg) {
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

function parseCommand(text) {
    if (!text.startsWith(CONFIG.prefix)) return { command: null, args: [] };
    const body = text.slice(CONFIG.prefix.length).trim();
    const parts = body.match(/"([^"]*)"|'([^']*)'|\S+/g) || [];
    const command = (parts.shift() || '').toLowerCase();
    const args = parts.map(p => p.replace(/^(['"])(.*)\1$/, '$2'));
    return { command, args };
}

async function isGroupAdmin(sock, groupJid, senderJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const senderId = senderJid.split('@')[0];
        const member = meta.participants.find(p => p.id?.split('@')[0] === senderId);
        return member?.admin === 'admin' || member?.admin === 'superadmin';
    } catch (err) {
        warn('Gagal cek admin grup: ' + err.message);
        return false;
    }
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
