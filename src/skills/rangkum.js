import { callAI, summarizeText } from '../services/ai.js';
import { getMode } from '../services/db.js';

export default {
    name: 'rangkum',
    title: 'Rangkum Teks',
    description: 'Ringkas teks panjang jadi poin-poin penting',
    commands: ['rangkum'],

    async handler(sock, remoteJid, args) {
        const inputText = args.join(' ');
        if (!inputText) {
            await sock.sendMessage(remoteJid, { text: '❌ Usage: /rangkum [teks]' });
            return;
        }
        const mode = getMode(remoteJid);
        const summary = await summarizeText(inputText, mode);
        await sock.sendMessage(remoteJid, { text: `📝 *Rangkuman:*\n\n${summary}` });
    }
};
