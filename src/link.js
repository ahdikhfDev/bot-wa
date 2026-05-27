import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from 'baileys';
import QRCode from 'qrcode-terminal';
import pino from 'pino';

const logger = pino({ level: 'info' }).child({ class: 'Link' });

async function linkDevice() {
    console.log('📱 WA Bot Link Mode');
    console.log('====================\n');
    console.log('Menunggu QR Code...\n');

    const { state, saveCreds } = await useMultiFileAuthState('./auth_session_link');

    const sock = makeWASocket({
        auth: state,
        logger,
        printQRInTerminal: false,
        generateHighQualityImage: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log('📱 Scan QR Code ini dengan WhatsApp:\n');
            console.log('================================\n');
            QRCode.generate(qr, { small: true });
            console.log('\n================================\n');
            console.log('atau buka WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat\n');
        }

        if (connection === 'open') {
            console.log('\n✅ Perangkat berhasil ditautkan!');
            console.log('📁 Session disimpan di ./auth_session_link');
            process.exit(0);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (!shouldReconnect) {
                console.log('❌ Tautan dibatalkan.');
                process.exit(1);
            }
        }
    });
}

linkDevice().catch(err => { console.error('Link device error:', err); process.exit(1); });