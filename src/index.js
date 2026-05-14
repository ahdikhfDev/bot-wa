import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from 'baileys';
import P from 'pino';
import QRCode from 'qrcode-terminal';
import { handleMessage } from './handlers/message.js';
import { initDatabase, getPendingReminders, markReminderDone } from './services/db.js';

const logger = P({ level: 'warn' }).child({ class: 'Main' });
let reconnectAttempts = 0;

async function startBot() {
    console.log('🚀 Starting WA Bot AI...\n');
    console.log(`🔄 Attempt: ${reconnectAttempts + 1}\n`);

    // Init database
    await initDatabase();

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
    sock.ev.on('connection.update', (update) => {
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
        // Hanya proses pesan baru (notify), bukan pesan lama dari sinkronisasi
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            await handleMessage(sock, msg);
        }
    });

    // Cleanup on exit
    process.on('SIGINT', async () => {
        console.log('\n👋 Bot dimatikan, goodbye!');
        process.exit(0);
    });
}

startBot().catch(console.error);