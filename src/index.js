import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "baileys";
import P from "pino";
import QRCode from "qrcode-terminal";
import { handleMessage, getMessageText } from "./handlers/message.js";
import { initDatabase, flushDb, broadcastTargets, loadPendingBroadcasts, deletePendingBroadcast, pendingBroadcasts, getPendingReminders, incrementReminderRetry, expireOldReminders } from "./services/db.js";
import { log, error, warn } from "./utils/logger.js";
import { loadSkills } from "./skills/_loader.js";
import { startServer, setSock, incrementMessageCount, setBotStatus } from "./server/index.js";
import { cleanupAll } from "./services/videoGenerator.js";
import { createQueuedSock } from "./services/whatsappQueue.js";
import { CONFIG } from "./config.js";
import { getModerationConfig } from "./services/autoModerator.js";
import { startScheduler } from "./services/scheduler.js";
import { getLinkPreview } from 'link-preview-js';

const msgDedup = new Set();
const DEDUP_WINDOW = 3000;
const MSG_DEDUP_MAX_SIZE = 500;
// Bersihin msgDedup tiap 5 menit biar gak bocor memory
setInterval(() => {
    if (msgDedup.size > MSG_DEDUP_MAX_SIZE) {
        msgDedup.clear();
        log("MSG_DEDUP", "Cleared dedup set (was > " + MSG_DEDUP_MAX_SIZE + ")");
    }
}, 5 * 60 * 1000);

const logger = P({ level: "info" }).child({ class: "Main" });
let reconnectAttempts = 0;
let appInitialized = false;
let cleanupInterval = null;
let reminderInterval = null;

let signalHandlersRegistered = false;

async function exitBot(code = 0) {
    await flushDb().catch(() => {});
    process.exit(code);
}

async function initializeApp() {
    if (appInitialized) return;
    await initDatabase();
    await loadSkills();
    startServer();
    cleanupAll();
    cleanupInterval = setInterval(cleanupAll, 6 * 60 * 60 * 1000);
    registerSignalHandlers();
    appInitialized = true;
}

function registerSignalHandlers() {
    if (signalHandlersRegistered) return;
    signalHandlersRegistered = true;
    const shutdown = async (signal) => {
        log("SHUTDOWN", signal + " diterima. Bot mati.");
        if (cleanupInterval) clearInterval(cleanupInterval);
        if (reminderInterval) clearInterval(reminderInterval);
        for (const [jid] of pendingBroadcasts) {
            deletePendingBroadcast(jid);
        }
        // Save accumulated uptime before exit
        try {
            const mod = await import('./server/index.js');
            if (mod.uptimeSaveTimer) clearInterval(mod.uptimeSaveTimer);
            const uptime = mod.getTotalUptime ? mod.getTotalUptime() : 0;
            const { setSetting } = await import('./services/db.js');
            setSetting('stats_accumulated_uptime', String(uptime));
        } catch(e) { /* non-critical */ }
        exitBot(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function startBot() {
    log("START", "Starting WA Bot AI... Attempt: " + (reconnectAttempts + 1));
    await initializeApp();

    // Load session dari file auth
    const { state, saveCreds } = await useMultiFileAuthState("./auth_session");

    const sock = makeWASocket({
        auth: state,
        logger,
        printQRInTerminal: false,
        generateHighQualityImage: true,
    });
    const queuedSock = createQueuedSock(sock);

    // Save credentials setiap ada perubahan
    sock.ev.on("creds.update", saveCreds);

    // Handle QR code untuk pertama kali login
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log("📱 Scan QR ini dengan WhatsApp:\n");
            console.log("================================\n");
            QRCode.generate(qr, { small: true });
            console.log("\n================================\n");
            console.log("WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat\n");
            reconnectAttempts = 0;
        }

        if (connection === "close") {
            setBotStatus(false);
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const isConflict = lastDisconnect?.error?.message?.includes("conflict") ||
                               lastDisconnect?.error?.output?.payload?.error === "replaced";

            if (isLoggedOut) {
                log("AUTH", "Bot di-logout dari WhatsApp.");
                exitBot(0);
            }

            if (isConflict) {
                warn("CONFLICT: Nomor ini aktif di tempat lain.");
                exitBot(0);
            }

            reconnectAttempts++;
            if (reconnectAttempts < 10) {
                log("RECONNECT", "Attempt " + reconnectAttempts + ", retrying in " + Math.round(CONFIG.reconnectDelayMs / 1000) + "s");
                setTimeout(startBot, CONFIG.reconnectDelayMs);
            } else {
                error("Gagal konek WA setelah 10 percobaan");
                exitBot(0);
            }
        } else if (connection === "open") {
            log("WA", "WhatsApp connected!");
            reconnectAttempts = 0;
            setSock(queuedSock);
            setBotStatus(true);

            // Load all groups for broadcast
            try {
                const groups = await sock.groupFetchAllParticipating();
                broadcastTargets.clear();
                for (const [jid, info] of Object.entries(groups)) {
                    broadcastTargets.set(jid, info.subject || "Tanpa nama");
                }
                log("BROADCAST", broadcastTargets.size + " grup terdaftar");
                loadPendingBroadcasts();
            } catch (err) {
                warn("Gagal load grup: " + err.message);
            }

            // Start scheduler engine
            startScheduler(queuedSock).catch(err => {
                warn('Gagal start scheduler: ' + err.message);
            });

            // Bot online notification ke grup pengumuman
            (async () => {
                try {
                    // Cari grup yang ada announcement group-nya
                    const groups = await sock.groupFetchAllParticipating();
                    const notified = new Set();
                    for (const [gJid] of Object.entries(groups)) {
                        try {
                            const cfg = getModerationConfig(gJid);
                            const annJid = cfg.announcementGroupJid;
                            if (annJid && !notified.has(annJid)) {
                                notified.add(annJid);
                                await queuedSock.sendMessage(annJid, {
                                    text: `🤖 *Thirty Bot Online!* 🟢\n\nBot aktif dan siap membantu!\n\n📌 *Fitur Aktif:*\n• 🛡️ Moderasi Community\n• 📰 IT Digest otomatis\n• 🔗 Auto Link Preview\n• 👋 Auto Welcome\n\nAda yang bisa dibantu? Ketik /help`
                                });
                            }
                        } catch { warn('Auto link preview gagal'); }
                    }
                } catch (err) {
                    warn('Gagal kirim notifikasi online: ' + err.message);
                }
            })();

            // Reminder polling tiap 15 detik
            if (reminderInterval) clearInterval(reminderInterval);
            reminderInterval = setInterval(async () => {
                try {
                    const pending = getPendingReminders();
                    for (const r of pending) {
                        try {
                            const retryLabel = r.retryCount > 0 ? ` (${r.retryCount + 1}/3)` : '';
                            await queuedSock.sendMessage(r.chatId, {
                                text: `⏰ *REMINDER* ⏰${retryLabel}\n\n${r.message}`
                            });
                            incrementReminderRetry(r.id);
                        } catch (err) {
                            error('Reminder gagal', err);
                        }
                    }
                    expireOldReminders();
                } catch (err) {
                    error('Reminder polling', err);
                }
            }, 30000);
        }
    });

    // Auto-Welcome & Member Notifications: Handle member join/leave
    sock.ev.on("group-participants.update", async (update) => {
        try {
            const { id: groupJid, participants, action } = update;
            if (!groupJid) return;
            
            // Check if this group has an announcement group configured
            const cfg = getModerationConfig(groupJid);
            const annJid = cfg.announcementGroupJid || null;
            
            if (action === 'add') {
                for (const participantJid of participants) {
                    try {
                        const meta = await sock.groupMetadata(groupJid);
                        const groupName = meta.subject || 'Grup';
                        const shortJid = participantJid.split('@')[0];
                        
                        // Get member count
                        const memberCount = meta.participants?.length || 0;
                        
                        // Send welcome — to announcement group if configured, otherwise main group
                        const targetJid = annJid || groupJid;
                        await queuedSock.sendMessage(targetJid, {
                            text: `👋 *Anggota Baru Bergabung!*

Hai @${shortJid}! Selamat datang di *${groupName}* 🎉
━━━━━━━━━━━━━━━━━
📌 *Info Grup:*
• Jaga sopan santun & saling menghargai
• Dilarang spam, SARA, atau konten 18+
• Gunakan /help untuk bantuan bot

👥 Total Anggota: *${memberCount}*
━━━━━━━━━━━━━━━━━
Semoga betah ya! 🥳`,
                            mentions: [participantJid]
                        });
                    } catch (err) {
                        error('Auto-welcome', err);
                    }
                }
            } else if (action === 'remove') {
                for (const participantJid of participants) {
                    try {
                        const meta = await sock.groupMetadata(groupJid);
                        const groupName = meta.subject || 'Grup';
                        const shortId = participantJid.split('@')[0];
                        const memberCount = meta.participants?.length || 0;
                        
                        // Send leave notification to announcement group if configured
                        const targetJid = annJid || groupJid;
                        await queuedSock.sendMessage(targetJid, {
                            text: `🚪 *Anggota Keluar*
@${shortId} telah meninggalkan *${groupName}*

👥 Total Anggota: *${memberCount}*`,
                            mentions: [participantJid]
                        });
                    } catch (err) {
                        error('Auto-leave notification', err);
                    }
                }
            }
        } catch (err) {
            error('Group participants handler', err);
        }
    });

    // Handle semua pesan masuk
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            // Dedup: skip pesan yang sama dalam 3 detik
            const dedupKey = msg.key.id;
            if (msgDedup.has(dedupKey)) continue;
            msgDedup.add(dedupKey);
            setTimeout(() => msgDedup.delete(dedupKey), DEDUP_WINDOW);

            log("MSG", "Dari " + (msg.pushName || "Unknown"), { id: dedupKey });

            incrementMessageCount();

            // Auto-Link Preview (fire & forget — don't block message processing)
            const messageText = getMessageText(msg);
            const remoteJid = msg.key.remoteJid;
            if (messageText && remoteJid && remoteJid.endsWith('@g.us') && !messageText.trim().startsWith('/')) {
                const urlRegex = /https?:\/\/[^\s<>{}\[\]|"\'`^]+/gi;
                const urls = messageText.match(urlRegex);
                const previewUrl = urls?.[0];
                if (previewUrl) {
                    // Fire asynchronously — don't await
                    (async () => {
                        try {
                            const preview = await getLinkPreview(previewUrl, {
                                headers: {
                                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                                },
                                timeout: 6000,
                                followRedirects: 'follow',
                            });

                            if (preview.title || preview.description) {
                                const domain = new URL(previewUrl).hostname.replace('www.', '');
                                let text = `🔗 *${domain}*`;
                                if (preview.title) text += `\n📌 ${preview.title.substring(0, 100)}`;
                                if (preview.description) text += `\n\n${preview.description.substring(0, 200)}`;
                                
                                // Try to send image if available
                                if (preview.images && preview.images.length > 0) {
                                    try {
                                        const imgResp = await fetch(preview.images[0], { signal: AbortSignal.timeout(5000) });
                                        if (imgResp.ok) {
                                            const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                                            await queuedSock.sendMessage(remoteJid, { image: imgBuffer, caption: text });
                                            return;
                                        }
                                    } catch { warn('Auto link preview gagal'); }
                                }
                                await queuedSock.sendMessage(remoteJid, { text });
                            }
                        } catch {
                            // Silent fail auto-preview
                        }
                    })();
                }
            }

            await handleMessage(queuedSock, msg).catch(err => {
                error("Gagal handle message", err);
            });
        }
    });

}

startBot().catch(err => { error('Startup fatal', err); });
