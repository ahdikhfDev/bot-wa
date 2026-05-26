import { takeScreenshot } from '../services/browser.js';

export default {
    name: 'screenshot',
    title: 'Screenshot Web',
    description: 'Ambil tangkapan layar dari sebuah website',
    commands: ['ss', 'screenshot'],

    async handler(sock, remoteJid, args, context) {
        let url = args[0];
        if (!url) {
            await sock.sendMessage(remoteJid, { text: '❌ Usage: /ss [url]\nContoh: /ss google.com' });
            return;
        }

        // Add protocol if missing
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }

        // Basic URL validation
        try {
            new URL(url);
        } catch (err) {
            await sock.sendMessage(remoteJid, { text: '❌ URL tidak valid.' });
            return;
        }

        await sock.sendMessage(remoteJid, { text: `📸 _Sedang mengambil screenshot untuk:_ ${url}\n_Mohon tunggu..._` });
        
        try {
            const isFullPage = args.includes('--full') || args.includes('-f');
            const buffer = await takeScreenshot(url, { fullPage: isFullPage });
            
            await sock.sendMessage(remoteJid, { 
                image: buffer, 
                caption: `📸 Screenshot: ${url}${isFullPage ? ' (Full Page)' : ''}` 
            });
        } catch (err) {
            await sock.sendMessage(remoteJid, { text: `❌ Gagal mengambil screenshot.\nError: ${err.message}` });
        }
    }
};
