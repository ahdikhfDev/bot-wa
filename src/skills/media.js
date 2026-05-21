import { getVoiceBuffer } from '../services/ai.js';

export default {
    name: 'media',
    title: 'Media Maker',
    description: 'Buat stiker dan voice note',
    commands: ['s', 'sticker', 'say'],

    async handler(sock, remoteJid, args, context) {
        const { command, msg, sender, isGroup } = context;

        if (command === 'say') {
            const msgText = args.join(' ');
            if (!msgText) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /say [teks]' });
                return;
            }
            const voiceBuffer = await getVoiceBuffer(msgText);
            if (voiceBuffer) {
                await sock.sendMessage(remoteJid, { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
            } else {
                await sock.sendMessage(remoteJid, { text: '❌ Gagal membuat voice.' });
            }
            return;
        }

        if (command === 's' || command === 'sticker') {
            const { downloadMediaMessage } = await import('baileys');
            const { Sticker, StickerTypes } = await import('wa-sticker-formatter');

            await sock.sendPresenceUpdate('composing', remoteJid);

            let mediaMsg = msg;
            const msgType = Object.keys(msg.message || {}).find(t => !t.startsWith('contextInfo') && !t.endsWith('MessagePlaceholder'));
            const contextInfo = msg.message?.[msgType]?.contextInfo || {};
            if (contextInfo.quotedMessage) {
                mediaMsg = { key: msg.key, message: contextInfo.quotedMessage };
            }

            const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}, { logger: console });
            if (!buffer) {
                await sock.sendMessage(remoteJid, { text: '❌ Reply ke gambar dulu dengan /s' });
                return;
            }

            const sticker = new Sticker(buffer, {
                pack: 'Thirty AI',
                author: sender || 'User',
                type: StickerTypes.FULL,
                quality: 80,
            });
            const stickerBuffer = await sticker.toBuffer();
            await sock.sendMessage(remoteJid, { sticker: stickerBuffer });
        }
    }
};
