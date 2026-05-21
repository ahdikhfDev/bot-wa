import { translateText } from '../services/translate.js';

export default {
    name: 'translate',
    title: 'Terjemahan',
    description: 'Terjemahkan teks ke Bahasa Indonesia',
    commands: ['translate', 'tr', 'terjemahkan'],

    async handler(sock, remoteJid, args, context) {
        const { quotedText } = context;
        const textToTranslate = args.join(' ') || quotedText;
        if (!textToTranslate) {
            await sock.sendMessage(remoteJid, { text: '❌ Reply pesan dengan /translate atau ketik /translate [teks]' });
            return;
        }
        await sock.sendPresenceUpdate('composing', remoteJid);
        const result = await translateText(textToTranslate);
        if (result.error) {
            await sock.sendMessage(remoteJid, { text: result.error });
            return;
        }
        await sock.sendMessage(remoteJid, { text: `🌍 *Terjemahan*\n\n📝 ${result.from}\n\n➡️ ${result.result}` });
    }
};
