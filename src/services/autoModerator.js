/**
 * Auto-Moderator Service — Second Admin Intelligence
 * 
 * Features:
 * - Spam detection (flood, repeated links, caps abuse)
 * - Toxic language detection (keyword + AI-assisted)
 * - Auto-warn system (3 warnings → auto action)
 * - Per-group configurable moderation level
 * - Flood protection (rate limiting per user)
 */

import { getSetting, setSetting, getDb, getAllSettings } from './db.js';
import { log, warn } from '../utils/logger.js';

// ─── In-Memory Tracking ───

const userMessageTimestamps = new Map(); // jid → [timestamp, ...]
const userWarningCount = new Map();      // jid → count
const userWarnHistory = new Map();       // jid → [{reason, timestamp}, ...]
const recentGroupLinks = new Map();      // groupJid → Map<link, count>

// ─── Constants ───

const FLOOD_WINDOW_MS = 5000;            // 5 detik
const FLOOD_MAX_MESSAGES = 6;             // max 6 pesan dalam 5 detik
const LINK_SPAM_THRESHOLD = 5;            // max link yang sama dalam 1 jam
const WARN_THRESHOLD = 3;                 // 3 warnings → action
const TRACKING_WINDOW_MS = 60000;         // bersihin data lama tiap 60 detik
const MAX_CAPS_RATIO = 0.7;               // 70%+ huruf kapital = abuse
const MAX_LINKS_PER_MESSAGE = 3;          // max 3 link per pesan

// ─── Toxic Keywords (multilingual Indonesia + English) ───

const TOXIC_PATTERNS = [
    // SARA & extreme
    /\b(anjing|bangsat|kontol|memek|pantek|jancok|ngentod|goblok|tolol|bego|kampret|setan)\b/i,
    // Personal attacks
    /\b(bodoh|dungu|idiot|beban|sampah|mampus|mati\s*aja|bacot)\b/i,
    // Racism / religion / ethnicity
    /\b(kafir|murtad|sesat|penista|china\s*sial|cina\s*loceng|pribumi|non\s*pribumi)\b/i,
    // Sexual harassment
    /(?:anjing|bangsat)\s*(?:lo|kau|kamu|lu)/i,
    // Spammy patterns
    /(?:╋|━|┃|┗|┏|┓|┛|┣|┳|┻|╺|╻|╼|╽|╾|╿|█|▓|▒|░|▄|▀|■|□|▪|▫)/,
];

// ─── Cleanup Interval ───

setInterval(() => {
    const now = Date.now();

    // Cleanup message timestamps
    for (const [jid, timestamps] of userMessageTimestamps) {
        const filtered = timestamps.filter(t => now - t < TRACKING_WINDOW_MS);
        if (filtered.length === 0) userMessageTimestamps.delete(jid);
        else userMessageTimestamps.set(jid, filtered);
    }

    // Cleanup warn history (expire after 24 hours)
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    for (const [jid, history] of userWarnHistory) {
        const filtered = history.filter(h => h.timestamp > oneDayAgo);
        if (filtered.length === 0) {
            userWarnHistory.delete(jid);
            userWarningCount.delete(jid);
        } else {
            userWarnHistory.set(jid, filtered);
            userWarningCount.set(jid, filtered.length);
        }
    }

    // Cleanup link tracking (expire after 1 hour)
    const oneHourAgo = now - 60 * 60 * 1000;
    for (const [gJid, linkMap] of recentGroupLinks) {
        for (const [link, data] of linkMap) {
            if (data.lastSeen < oneHourAgo) linkMap.delete(link);
        }
        if (linkMap.size === 0) recentGroupLinks.delete(gJid);
    }
}, TRACKING_WINDOW_MS);

// ─── Configuration ───

// All config keys are stored lowercase to ensure case-insensitive lookups

const CONFIG_KEYS = [
    'enabled', 'level', 'autowarn', 'toxicfilter', 'floodprotection',
    'linkspamprotection', 'capsfilter', 'autokickatwarn',
    'itcontentsharing', 'itcontentschedule', 'language',
    'announcementgroupjid'
];

export function getModerationConfig(chatId) {
    const prefix = `mod_config_${chatId}_`;
    const val = (key, def) => getSetting(prefix + key, def);
    const rawLinkSpam = val('linkspamprotection', 'draft');
    return {
        enabled: val('enabled', 'true') === 'true',
        level: parseInt(val('level', '2')),  // 1=light, 2=normal, 3=strict
        autoWarn: val('autowarn', 'true') === 'true',
        toxicFilter: val('toxicfilter', 'true') === 'true',
        floodProtection: val('floodprotection', 'true') === 'true',
        linkSpamProtection: rawLinkSpam, // 'draft', 'warn', 'block'
        capsFilter: val('capsfilter', 'false') === 'true',
        autoKickAtWarn: parseInt(val('autokickatwarn', '3')),
        itContentSharing: val('itcontentsharing', 'true') === 'true',
        itContentSchedule: val('itcontentschedule', '08:00,12:00,18:00'),
        language: val('language', 'id'),
        announcementGroupJid: val('announcementgroupjid', ''),
    };
}

export function setModerationConfig(chatId, key, value) {
    const normalizedKey = key.toLowerCase();
    if (!CONFIG_KEYS.includes(normalizedKey)) {
        warn(`Invalid moderation config key: ${key}`);
        return;
    }
    const settingKey = `mod_config_${chatId}_${normalizedKey}`;
    setSetting(settingKey, String(value));
    log('MOD_CONFIG', `${chatId}: ${normalizedKey} = ${value}`);
}

export function setDefaultModerationConfig(chatId) {
    const prefix = `mod_config_${chatId}_`;
    setSetting(prefix + 'enabled', 'true');
    setSetting(prefix + 'level', '2');
    setSetting(prefix + 'autowarn', 'true');
    setSetting(prefix + 'toxicfilter', 'true');
    setSetting(prefix + 'floodprotection', 'true');
    setSetting(prefix + 'linkspamprotection', 'warn');
    setSetting(prefix + 'capsfilter', 'false');
    setSetting(prefix + 'autokickatwarn', '3');
    setSetting(prefix + 'itcontentsharing', 'true');
    setSetting(prefix + 'itcontentschedule', '08:00,12:00,18:00');
    setSetting(prefix + 'language', 'id');
    setSetting(prefix + 'announcementgroupjid', '');
    log('MOD_CONFIG', `Default config set for ${chatId}`);
}

// ─── Core Detection ───

/**
 * Check if a message is potential spam/flood
 */
export function checkFlood(senderJid) {
    const now = Date.now();
    const timestamps = userMessageTimestamps.get(senderJid) || [];
    
    // Add current timestamp
    timestamps.push(now);
    userMessageTimestamps.set(senderJid, timestamps);

    // Check if within window
    const recentMessages = timestamps.filter(t => now - t < FLOOD_WINDOW_MS);
    
    if (recentMessages.length > FLOOD_MAX_MESSAGES) {
        return {
            isFlood: true,
            messageCount: recentMessages.length,
            windowMs: FLOOD_WINDOW_MS,
        };
    }

    return { isFlood: false, messageCount: recentMessages.length };
}

/**
 * Check for link spam (same link posted many times)
 */
export function checkLinkSpam(groupJid, url) {
    if (!groupJid || !url) return { isSpam: false };

    if (!recentGroupLinks.has(groupJid)) {
        recentGroupLinks.set(groupJid, new Map());
    }

    const linkMap = recentGroupLinks.get(groupJid);
    const now = Date.now();
    
    if (linkMap.has(url)) {
        const data = linkMap.get(url);
        data.count++;
        data.lastSeen = now;

        if (data.count >= LINK_SPAM_THRESHOLD) {
            return { isSpam: true, count: data.count };
        }
    } else {
        linkMap.set(url, { count: 1, lastSeen: now });
    }

    return { isSpam: false, count: linkMap.get(url)?.count || 1 };
}

/**
 * Check for toxic/hateful content
 */
export function checkToxic(text) {
    if (!text) return { isToxic: false };

    for (const pattern of TOXIC_PATTERNS) {
        if (pattern.test(text)) {
            return { isToxic: true, matchedPattern: pattern.source };
        }
    }

    // Caps abuse check
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 10) {
        const capsCount = (text.match(/[A-Z]/g) || []).length;
        const totalLetters = (text.match(/[a-zA-Z]/g) || []).length;
        if (totalLetters > 0 && capsCount / totalLetters > MAX_CAPS_RATIO) {
            return { isToxic: false, isCapsAbuse: true, ratio: capsCount / totalLetters };
        }
    }

    // Too many links in one message
    const urlCount = (text.match(/https?:\/\/[^\s]+/gi) || []).length;
    if (urlCount > MAX_LINKS_PER_MESSAGE) {
        return { isToxic: false, isLinkFlood: true, linkCount: urlCount };
    }

    return { isToxic: false };
}

/**
 * Extract URLs from text
 */
export function extractUrls(text) {
    return text.match(/https?:\/\/[^\s<>{}\[\]|"\\'`^]+/gi) || [];
}

// ─── Warn System ───

/**
 * Issue a warning to a user and return the current warning count
 */
export function issueWarning(senderJid, reason) {
    const history = userWarnHistory.get(senderJid) || [];
    history.push({ reason, timestamp: Date.now() });
    userWarnHistory.set(senderJid, history);
    
    const count = history.length;
    userWarningCount.set(senderJid, count);
    
    log('MOD_WARN', `${senderJid}: warn #${count} - ${reason}`);
    return count;
}

export function getWarningCount(senderJid) {
    return userWarningCount.get(senderJid) || 0;
}

export function clearWarnings(senderJid) {
    userWarningCount.delete(senderJid);
    userWarnHistory.delete(senderJid);
    log('MOD_CLEAR', `Warnings cleared for ${senderJid}`);
}

export function getWarnHistory(senderJid) {
    return userWarnHistory.get(senderJid) || [];
}

// ─── Moderation Actions ───

export function getModerationAction(warnCount, config, senderName) {
    const threshold = config.autoKickAtWarn || WARN_THRESHOLD;

    if (warnCount >= threshold) {
        return {
            action: 'kick',
            message: `⛔ *${senderName}* telah menerima ${warnCount} peringatan. Bot akan melakukan tindakan.\n\n_Mohon hubungi admin grup untuk klarifikasi._`,
            shouldKick: true,
        };
    }

    const remaining = threshold - warnCount;
    const warnMessages = [
        `⚠️ *Peringatan #${warnCount}* untuk @${senderName}\n\nHati-hati dalam berkirim pesan ya. ${
            remaining > 0 ? `Sisa ${remaining} peringatan sebelum tindakan lebih lanjut.` : ''
        }`,
        `⚠️ *Peringatan #${warnCount}* untuk @${senderName}\n\nKami ingin menjaga grup tetap nyaman untuk semua anggota. Mohon patuhi aturan grup.`,
        `⚠️ *Peringatan #${warnCount}* untuk @${senderName}\n\n_Terakhir:_ ${
            remaining === 1 ? 'Ini peringatan terakhir!' : `Sisa ${remaining} peringatan.`
        }`,
    ];

    return {
        action: 'warn',
        message: warnMessages[Math.min(warnCount - 1, warnMessages.length - 1)],
        shouldKick: false,
        remaining,
    };
}

// ─── IT Content Config ───

export function getItContentSchedule(chatId) {
    const config = getModerationConfig(chatId);
    return config.itContentSchedule.split(',').map(t => t.trim()).filter(Boolean);
}

// ─── Stats ───

export function getModerationStats() {
    return {
        activeTrackedUsers: userMessageTimestamps.size,
        warnedUsers: userWarningCount.size,
        totalWarnHistory: userWarnHistory.size,
        trackedLinks: [...recentGroupLinks.values()].reduce((acc, m) => acc + m.size, 0),
        floodWindowMs: FLOOD_WINDOW_MS,
        floodMaxMessages: FLOOD_MAX_MESSAGES,
        warnThreshold: WARN_THRESHOLD,
    };
}

/**
 * Get all groups that have announcement groups configured
 * Returns array of { groupJid, announcementGroupJid }
 */
export function getAllAnnouncementGroups() {
    const settings = getAllSettings();
    const result = [];
    for (const [key, value] of Object.entries(settings)) {
        if (key.endsWith('_announcementgroupjid') && value) {
            const chatId = key.replace('mod_config_', '').replace('_announcementgroupjid', '');
            result.push({
                groupJid: chatId,
                announcementGroupJid: value
            });
        }
    }
    return result;
}

/**
 * Get all groups that have community enabled
 * Returns array of { groupJid, announcementGroupJid }
 */
export function getAllCommunityGroups() {
    const settings = getAllSettings();
    const result = [];
    const enabledGroups = new Map(); // groupJid → isEnabled
    const annJids = new Map(); // groupJid → announcementGroupJid

    for (const [key, value] of Object.entries(settings)) {
        if (key.startsWith('mod_config_')) {
            const suffix = key.replace('mod_config_', '');
            const chatId = suffix.replace(/_.+$/, '');
            const settingKey = suffix.replace(/^[^_]+_/, '');
            
            if (settingKey === 'enabled' && value === 'true') {
                enabledGroups.set(chatId, true);
            }
            if (settingKey === 'announcementgroupjid' && value) {
                annJids.set(chatId, value);
            }
        }
    }

    for (const [groupJid] of enabledGroups) {
        result.push({
            groupJid,
            announcementGroupJid: annJids.get(groupJid) || null
        });
    }
    return result;
}
