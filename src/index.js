import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from 'baileys';
import P from 'pino';
import QRCode from 'qrcode-terminal';
import { handleMessage } from './handlers/message.js';
import { initDatabase, getPendingReminders, markReminderDone, broadcastTargets, loadPendingBroadcasts, deletePendingBroadcast, pendingBroadcasts } from './services/db.js';
import { log, error } from './utils/logger.js';
import { loadSkills } from './skills/_loader.js';
import { startServer, setSock, incrementMessageCount, setBotStatus } from './server/index.js';

const msgDedup = new Set();
const DEDUP_WINDOW = 3000;

const logger = P({ level: 'info' }).child({ class: 'Main' });
let reconnectAttempts = 0;

async function startBot() {
    console.log('🚀 Starting WA Bot AI...\n');
    console.log(`🔄 Attempt: ${reconnectAttempts + 1}\n`);
    await initDatabase();
    await loadSkills();
    startServer();

    // Load session dari file auth
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session');

    const sock = makeWASocket({
        auth: state,
        logger,
        printQRInTerminal: false,
        generateHighQualityImage: true,
    });

    // Save credentials setiap ada perubahan
    sock.ev.on('creds.update', saveCreds);

    // Handle QR code untuk pertama kali login
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log('📱 Scan QR ini dengan WhatsApp:\n');
    console.log('================================\n');
            QRCode.generate(qr, { small: true });
            console.log('\n================================\n');
            console.log('WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat\n');
            reconnectAttempts = 0;
        }

        if (connection === 'close') {
            setBotStatus(false);
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const isConflict = lastDisconnect?.error?.message?.includes('conflict') ||
                               lastDisconnect?.error?.output?.payload?.error === 'replaced';

            if (isLoggedOut) {
                console.log('🔒 Bot di-logout dari WhatsApp. Hapus folder auth_session dan scan ulang QR.');
                process.exit(0);
            }

            if (isConflict) {
                console.log('⚠️  CONFLICT: Nomor ini sedang aktif di tempat lain (WA Web / HP lain).');
                console.log('💡 Tutup WhatsApp Web / perangkat lain yang pakai nomor ini, lalu restart bot.');
                process.exit(0);
            }

            reconnectAttempts++;
            if (reconnectAttempts < 10) {
                console.log(`⚡ Koneksi terputus (attempt ${reconnectAttempts}), retrying in 5s...`);
                setTimeout(startBot, 5000);
            } else {
                console.log('❌ Tidak bisa terhubung ke WhatsApp');
                console.log('💡 Tips:');
                console.log('   - Matikan VPN');
                console.log('   - Matikan Windows Firewall');
                console.log('   - Pastikan internet stabil');
                console.log('   - Hapus folder auth_session untuk reset\n');
                process.exit(0);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connected!\n');
            reconnectAttempts = 0;
            setSock(sock);
            setBotStatus(true);

            // Load all groups for broadcast
            try {
                const groups = await sock.groupFetchAllParticipating();
                broadcastTargets.clear();
                for (const [jid, info] of Object.entries(groups)) {
                    broadcastTargets.set(jid, info.subject || 'Tanpa nama');
                }
                console.log(`📡 Broadcast: ${broadcastTargets.size} grup terdaftar`);
                loadPendingBroadcasts();
            } catch (err) {
                console.warn('⚠️ Gagal load grup:', err.message);
            }

            // Start Auto-Reminder Polling
            setInterval(async () => {
                const pending = getPendingReminders();
                for (const r of pending) {
                    try {
                        await sock.sendMessage(r.chatId, { text: `⏰ *THIRTY REMINDER* ⏰\n\nHai bos! Sesuai jadwal, aku mau ngingetin kamu soal ini:\n\n👉 *${r.message}*` });
                        markReminderDone(r.id);
                        console.log(`🔔 Reminder terkirim ke ${r.chatId}: ${r.message}`);
                    } catch (err) {
                        console.error('❌ Gagal kirim reminder:', err.message);
                    }
                }
            }, 30000); // Cek setiap 30 detik
        }
    });

    // Handle semua pesan masuk
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            // Dedup: skip pesan yang sama dalam 3 detik
            const dedupKey = msg.key.id;
            if (msgDedup.has(dedupKey)) continue;
            msgDedup.add(dedupKey);
            setTimeout(() => msgDedup.delete(dedupKey), DEDUP_WINDOW);

            log('MSG', `Dari ${msg.pushName || 'Unknown'}`, { id: dedupKey });

            incrementMessageCount();
            await handleMessage(sock, msg).catch(err => {
                error('Gagal handle message', err);
            });
        }
    });

    // Cleanup on exit
    function shutdown(signal) {
        console.log(`\n👋 ${signal} diterima. Bot mati.`);
        for (const [jid] of pendingBroadcasts) {
            deletePendingBroadcast(jid);
        }
        process.exit(0);
    }
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startBot().catch(console.error);