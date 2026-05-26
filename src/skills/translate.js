import { translate } from '../services/translate.js';

export default {
    name: 'translate',
    title: 'Penerjemah',
    description: 'Terjemahkan teks ke bahasa lain (default: Indonesia)',
    commands: ['tr', 'translate'],

    async handler(sock, remoteJid, args, context) {
        let textToTranslate = '';
        let targetLang = 'Indonesia';

        // Check if user specified target lang like /tr en Hello
        if (args.length > 1 && args[0].length <= 3) {
            targetLang = args[0];
            textToTranslate = args.slice(1).join(' ');
        } else {
            textToTranslate = args.join(' ');
        }

        // If no text in args, check quoted message
        if (!textToTranslate.trim() && context.quotedText) {
            textToTranslate = context.quotedText;
        }

        if (!textToTranslate.trim()) {
            await sock.sendMessage(remoteJid, { 
                text: '❌ *Usage:*\n/tr [teks]\n/tr [bahasa] [teks]\nAtau reply pesan dengan /tr' 
            });
            return;
        }

        await sock.sendPresenceUpdate('composing', remoteJid);
        
        try {
            const result = await translate(textToTranslate, targetLang);
            await sock.sendMessage(remoteJid, { 
                text: `🌐 *Hasil Terjemahan (${targetLang}):*\n\n${result}` 
            }, { quoted: context.msg });
        } catch (err) {
            await sock.sendMessage(remoteJid, { text: `❌ Gagal menerjemahkan: ${err.message}` });
        }
    }
};
