import { searchWeb, searchNews, formatSearchResults, detectSearchQuery } from '../services/search.js';

export default {
    name: 'search',
    title: 'Cari Info',
    description: 'Cari informasi di web atau berita terbaru',
    commands: ['search', 'cari'],

    detect(text) {
        const result = detectSearchQuery(text);
        if (result) return result;
        return null;
    },

    async handler(sock, remoteJid, args, context) {
        const { command } = context;
        const query = args.join(' ');
        if (!query) {
            await sock.sendMessage(remoteJid, { text: '❌ Usage: /search [query]' });
            return;
        }
        await sock.sendPresenceUpdate('composing', remoteJid);
        await sock.sendMessage(remoteJid, { text: `🔍 *Mencari:* ${query}...` });
        const results = await searchWeb(query);
        await sock.sendMessage(remoteJid, { text: formatSearchResults(results) });
    }
};
