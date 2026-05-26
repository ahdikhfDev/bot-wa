const TTS_HOST = 'https://translate.google.com';
const TTS_USER_AGENT = 'Mozilla/5.0 ThirtyBot/1.0';
const TTS_TIMEOUT_MS = parseInt(process.env.TTS_TIMEOUT_MS || '15000', 10);

function splitText(text, maxLength = 190) {
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

export function getGoogleTtsUrl(text, lang = 'id') {
    const safeText = String(text || '').substring(0, 200);
    const params = new URLSearchParams({
        ie: 'UTF-8',
        q: safeText,
        tl: lang,
        client: 'tw-ob',
    });
    return `${TTS_HOST}/translate_tts?${params.toString()}`;
}

export async function getGoogleTtsBuffer(text, lang = 'id') {
    const resp = await fetch(getGoogleTtsUrl(text, lang), {
        headers: { 'User-Agent': TTS_USER_AGENT },
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });

    if (!resp.ok) {
        throw new Error(`TTS request failed: ${resp.status}`);
    }

    return Buffer.from(await resp.arrayBuffer());
}

export async function getGoogleTtsBase64(text, opts = {}) {
    const buffer = await getGoogleTtsBuffer(text, opts.lang || 'id');
    return buffer.toString('base64');
}

export async function getAllGoogleTtsBase64(text, opts = {}) {
    const chunks = splitText(text, 190).slice(0, 10);
    const result = [];
    for (const chunk of chunks) {
        result.push({ base64: await getGoogleTtsBase64(chunk, opts) });
    }
    return result;
}
