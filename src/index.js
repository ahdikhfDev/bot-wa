import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "baileys";
import P from "pino";
import QRCode from "qrcode-terminal";
import { handleMessage } from "./handlers/message.js";
import { initDatabase, flushDb, broadcastTargets, loadPendingBroadcasts, deletePendingBroadcast, pendingBroadcasts, getPendingReminders, incrementReminderRetry, expireOldReminders } from "./services/db.js";
import { log, error } from "./utils/logger.js";
import { loadSkills } from "./skills/_loader.js";
import { startServer, setSock, incrementMessageCount, setBotStatus } from "./server/index.js";
import { cleanupAll } from "./services/videoGenerator.js";
import { createQueuedSock } from "./services/whatsappQueue.js";
import { CONFIG } from "./config.js";

const msgDedup = new Set();
const DEDUP_WINDOW = 3000;

const logger = P({ level: "info" }).child({ class: "Main" });
let reconnectAttempts = 0;
let appInitialized = false;
let cleanupInterval = null;
let reminderInterval = null;

let signalHandlersRegistered = false;

function exitBot(code = 0) {
    flushDb();
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
    const shutdown = (signal) => {
        console.log("\n👋 " + signal + " diterima. Bot mati.");
        if (cleanupInterval) clearInterval(cleanupInterval);
        if (reminderInterval) clearInterval(reminderInterval);
        for (const [jid] of pendingBroadcasts) {
            deletePendingBroadcast(jid);
        }
        exitBot(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function startBot() {
    console.log("🚀 Starting WA Bot AI...\n");
    console.log("🔄 Attempt: " + (reconnectAttempts + 1) + "\n");
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
                console.log("🔐 Bot di-logout dari WhatsApp. Hapus folder auth_session dan scan ulang QR.");
                exitBot(0);
            }

            if (isConflict) {
                console.log("⚠️  CONFLICT: Nomor ini sedang aktif di tempat lain (WA Web / HP lain).");
                console.log("💡 Tutup WhatsApp Web / perangkat lain yang pakai nomor ini, lalu restart bot.");
                exitBot(0);
            }

            reconnectAttempts++;
            if (reconnectAttempts < 10) {
                console.log("⚡ Koneksi terputus (attempt " + reconnectAttempts + "), retrying in " + Math.round(CONFIG.reconnectDelayMs / 1000) + "s...");
                setTimeout(startBot, CONFIG.reconnectDelayMs);
            } else {
                console.log("❌ Tidak bisa terhubung ke WhatsApp");
                console.log("💡 Tips:");
                console.log("   - Matikan VPN");
                console.log("   - Matikan Windows Firewall");
                console.log("   - Pastikan internet stabil");
                console.log("   - Hapus folder auth_session untuk reset\n");
                exitBot(0);
            }
        } else if (connection === "open") {
            console.log("✅ WhatsApp connected!\n");
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
                console.log("📢 Broadcast: " + broadcastTargets.size + " grup terdaftar");
                loadPendingBroadcasts();
            } catch (err) {
                console.warn("⚠️ Gagal load grup:", err.message);
            }

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
                            console.error('❌ Gagal kirim reminder:', err.message);
                        }
                    }
                    expireOldReminders();
                } catch (err) {
                    console.error('❌ Reminder polling error:', err.message);
                }
            }, 15000);
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
            await handleMessage(queuedSock, msg).catch(err => {
                error("Gagal handle message", err);
            });
        }
    });
}

startBot().catch(console.error);
