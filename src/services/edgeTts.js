import { EdgeTTS } from 'node-edge-tts';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const TTS_TIMEOUT_MS = parseInt(process.env.EDGE_TTS_TIMEOUT_MS || '30000', 10);

/**
 * Generate natural-sounding speech using Microsoft Edge TTS (free, neural voices)
 * @param {string} text - Text to speak (max 1000 chars per call)
 * @param {object} opts - Options
 * @param {string} opts.voice - Voice ID (default: id-ID-GadisNeural)
 * @param {string} opts.lang - Language code (default: id-ID)
 * @param {number} opts.rate - Speech rate percentage (default: 0, range: -50 to +50)
 * @param {number} opts.pitch - Pitch percentage (default: 0, range: -50 to +50)
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
export async function getEdgeTtsBuffer(text, opts = {}) {
    const {
        voice = 'id-ID-ArdiNeural',
        lang = 'id-ID',
        rate = 0,
        pitch = 0,
    } = opts;

    const safeText = String(text || '').substring(0, 1000);
    if (!safeText.trim()) throw new Error('Text is empty');

    const tmpFile = path.join(os.tmpdir(), `thirty-tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`);

    try {
        const tts = new EdgeTTS({
            voice,
            lang,
            rate: rate >= 0 ? `+${rate}%` : `${rate}%`,
            pitch: pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`,
            timeout: TTS_TIMEOUT_MS,
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        });

        await tts.ttsPromise(safeText, tmpFile);
        const buffer = await fs.readFile(tmpFile);
        return buffer;
    } finally {
        await fs.unlink(tmpFile).catch(() => {});
    }
}

/**
 * Split long text into chunks and generate TTS for each
 * @param {string} text - Long text
 * @param {object} opts - TTS options (same as getEdgeTtsBuffer)
 * @returns {Promise<Buffer[]>} Array of audio buffers
 */
export async function getAllEdgeTtsBuffers(text, opts = {}) {
    const chunks = splitText(text, 500);
    const buffers = [];

    for (const chunk of chunks) {
        const buf = await getEdgeTtsBuffer(chunk, opts);
        buffers.push(buf);
    }

    return buffers;
}

/**
 * Split text into chunks at sentence boundaries
 */
function splitText(text, maxLength = 500) {
    const sentences = String(text || '').match(/[^.!?\n]+[.!?\n]*/g) || [String(text || '')];
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
        if ((current + sentence).length > maxLength && current.length > 0) {
            chunks.push(current.trim());
            current = sentence;
        } else {
            current += sentence;
        }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

// Indonesian voice presets
export const VOICES = {
    gadis: 'id-ID-GadisNeural',   // Female, natural
    ardi: 'id-ID-ArdiNeural',     // Male, natural
};
