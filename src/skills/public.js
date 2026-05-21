import { getExchangeRate, formatExchangeRate, getHackerNewsTop, formatHackerNews, searchTVShow, formatTVShow, getIPInfo, formatIPInfo, getQRUrl } from '../services/publicapis.js';

export default {
    name: 'public',
    title: 'Info Publik',
    description: 'Kurs, berita tech, TV, IP, QR code',
    commands: ['kurs', 'rate', 'hn', 'hackernews', 'tv', 'tvshow', 'ip', 'ipinfo', 'qr', 'qrcode'],

    async handler(sock, remoteJid, args, context) {
        const { command } = context;

        await sock.sendPresenceUpdate('composing', remoteJid);

        if (command === 'kurs' || command === 'rate') {
            const from = args[0]?.toUpperCase() || 'USD';
            const to = args[1]?.toUpperCase() || 'IDR';
            const data = await getExchangeRate(from, to);
            await sock.sendMessage(remoteJid, { text: formatExchangeRate(data) });
        }

        else if (command === 'hn' || command === 'hackernews') {
            const items = await getHackerNewsTop(5);
            await sock.sendMessage(remoteJid, { text: formatHackerNews(items) });
        }

        else if (command === 'tv' || command === 'tvshow') {
            const query = args.join(' ');
            if (!query) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /tv [judul]\nContoh: /tv breaking bad' });
                return;
            }
            const items = await searchTVShow(query);
            await sock.sendMessage(remoteJid, { text: formatTVShow(items) });
        }

        else if (command === 'ip' || command === 'ipinfo') {
            const data = await getIPInfo();
            await sock.sendMessage(remoteJid, { text: formatIPInfo(data) });
        }

        else if (command === 'qr' || command === 'qrcode') {
            const text = args.join(' ');
            if (!text) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /qr [teks]\nContoh: /qr https://example.com' });
                return;
            }
            const url = getQRUrl(text);
            await sock.sendMessage(remoteJid, { text: `🔳 *QR Code*\n\n${text}\n${url}` });
        }
    }
};
