import { getVoiceBuffer } from '../services/ai.js';
import { CONFIG, assertBufferLimit, assertTextLimit } from '../config.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const ffmpegBin = process.env.FFMPEG_PATH || ffmpegPath || 'ffmpeg';

async function makeStickerBuffer(buffer) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thirty-sticker-'));
    const inputPath = path.join(dir, 'input');
    const outputPath = path.join(dir, 'sticker.webp');

    try {
        await fs.writeFile(inputPath, buffer);
        await execFileAsync(ffmpegBin, [
            '-y',
            '-i', inputPath,
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15',
            '-loop', '0',
            '-an',
            '-vsync', '0',
            outputPath,
        ], { timeout: 30000 });
        return await fs.readFile(outputPath);
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

export default {
    name: 'media',
    title: 'Media Maker',
    description: 'Buat stiker dan voice note',
    commands: ['s', 'sticker', 'say'],

    async handler(sock, remoteJid, args, context) {
        const { command, msg } = context;

        if (command === 'say') {
            const msgText = args.join(' ');
            if (!msgText) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /say [teks]' });
                return;
            }
            assertTextLimit(msgText, 'Teks voice');
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
            assertBufferLimit(buffer, CONFIG.maxStickerMediaBytes, 'Media stiker');

            const stickerBuffer = await makeStickerBuffer(buffer);
            await sock.sendMessage(remoteJid, { sticker: stickerBuffer });
        }
    }
};
