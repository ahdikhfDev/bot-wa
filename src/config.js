export const CONFIG = {
    prefix: process.env.BOT_PREFIX || '/',
    groupContextEnabled: process.env.GROUP_CONTEXT_ENABLED !== 'false',
    spamCooldownMs: parseInt(process.env.SPAM_COOLDOWN_MS || '1500', 10),
    maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH || '4096', 10),
    maxInboundMediaBytes: parseInt(process.env.MAX_INBOUND_MEDIA_BYTES || String(12 * 1024 * 1024), 10),
    maxStickerMediaBytes: parseInt(process.env.MAX_STICKER_MEDIA_BYTES || String(5 * 1024 * 1024), 10),
    maxStockVideoBytes: parseInt(process.env.MAX_STOCK_VIDEO_BYTES || String(80 * 1024 * 1024), 10),
    outboundMinDelayMs: parseInt(process.env.OUTBOUND_MIN_DELAY_MS || '1200', 10),
    outboundJitterMs: parseInt(process.env.OUTBOUND_JITTER_MS || '800', 10),
    reconnectDelayMs: parseInt(process.env.RECONNECT_DELAY_MS || '5000', 10),
};

function splitEnvList(value) {
    return String(value || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

export function normalizeJidId(jid = '') {
    if (typeof jid !== 'string') return '';
    // JID WhatsApp biasanya formatnya: nomor@s.whatsapp.net atau nomor:ad@s.whatsapp.net
    // Kita hanya mau ambil 'nomor'-nya saja.
    const part = jid.split('@')[0];
    if (!part) return '';
    return part.split(':')[0].trim();
}

export function getOwnerIds() {
    return [
        ...splitEnvList(process.env.OWNER_NUMBER),
        ...splitEnvList(process.env.OWNER_LID),
        ...splitEnvList(process.env.OWNER_IDS),
    ].map(normalizeJidId).filter(Boolean);
}

export function isOwnerId(senderJid = '') {
    const sender = normalizeJidId(senderJid);
    return !!sender && getOwnerIds().includes(sender);
}

export function assertTextLimit(text, label = 'Teks') {
    if (String(text || '').length > CONFIG.maxTextLength) {
        throw new Error(`${label} terlalu panjang. Maksimal ${CONFIG.maxTextLength} karakter.`);
    }
}

export function assertBufferLimit(buffer, limit, label = 'Media') {
    if (buffer && buffer.length > limit) {
        const mb = (limit / 1024 / 1024).toFixed(0);
        throw new Error(`${label} terlalu besar. Maksimal ${mb}MB.`);
    }
}
