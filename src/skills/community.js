/**
 * Community Admin Skill — Second Admin untuk Grup Komunitas
 * 
 * Fitur:
 * - /community status → lihat status moderasi & konfigurasi
 * - /community config → atur level moderasi (light/normal/strict)
 * - /community warn @user → manual warn user
 * - /community unwarn @user → hapus warning
 * - /community it [on/off/schedule] → atur IT content sharing
 * - /it [github|devto|hackernews|arxiv] → fetch content manual
 * - /digest → morning digest lengkap
 * - /community stats → statistik moderasi
 */

import {
    getModerationConfig, setModerationConfig,
    setDefaultModerationConfig, getModerationStats,
    clearWarnings, issueWarning
} from '../services/autoModerator.js';
import { getSetting } from '../services/db.js';
import {
    fetchContentByType, formatContentByType,
    fetchMorningDigest, formatMorningDigest,
    CONTENT_SOURCES
} from '../services/itContentAggregator.js';
import { log } from '../utils/logger.js';
import { addJob, removeJob, getJob } from '../services/scheduler.js';
import { chatWithContext } from '../services/ai.js';

export default {
    name: 'community',
    title: 'Community Admin',
    description: 'Second admin — manage community, moderation, and IT content sharing',
    commands: ['community', 'mod', 'it', 'digest', 'morning'],
    groupOnly: true,

    async handler(sock, remoteJid, args, context) {
        const { command, isOwner, text, sender, msg } = context;
        const senderJid = msg?.key?.participant || msg?.key?.remoteJid || '';

        // Check if user is group admin or owner
        const isGroupAdmin = await isGroupAdminCheck(sock, remoteJid, senderJid);

        if (command === 'community' || command === 'mod') {
            const subCmd = args[0]?.toLowerCase();

            if (!subCmd || subCmd === 'status') {
                await showStatus(sock, remoteJid);
                return;
            }

            if (subCmd === 'on' || subCmd === 'enable') {
                if (!isOwner && !isGroupAdmin) {
                    await sock.sendMessage(remoteJid, { text: '⛔ Hanya admin grup yang bisa mengaktifkan moderasi.' });
                    return;
                }
                
                // Cek apakah ini re-activation (setting enabled udah pernah diset di DB)
                const existingEnabled = getSetting(`mod_config_${remoteJid}_enabled`, null);
                const isReactivation = existingEnabled !== null && existingEnabled !== '';
                
                setDefaultModerationConfig(remoteJid);
                // Auto-schedule IT content
                await autoScheduleITContent(sock, remoteJid);
                
                const targetJid = getTargetJid(remoteJid);
                
                let msg = '🛡️ *Moderasi Community Aktif!*\n\nBot akan:\n• 🚫 Filter spam & toxic\n• 📰 Share konten IT otomatis (08:00, 12:00, 18:00)\n• ⚠️ Beri peringatan ke pelanggar\n\nKetik */community config* untuk atur detail.';
                
                if (isReactivation) {
                    msg += '\n\n🙏 *Maaf* jika sebelumnya ada spam notifikasi. Sekarang semua notifikasi akan dikirim rapi ke grup pengumuman (jika sudah diset).';
                }
                
                await sock.sendMessage(targetJid, { text: msg });
                return;
            }

            if (subCmd === 'off' || subCmd === 'disable') {
                if (!isOwner && !isGroupAdmin) {
                    await sock.sendMessage(remoteJid, { text: '⛔ Hanya admin grup yang bisa menonaktifkan moderasi.' });
                    return;
                }
                setModerationConfig(remoteJid, 'enabled', 'false');
                // Remove all scheduled jobs for this group
                const jobNames = [
                    `it_digest_${remoteJid}_morning`, `it_digest_${remoteJid}_noon`, `it_digest_${remoteJid}_evening`,
                    `morning_greeting_${remoteJid}`
                ];
                jobNames.forEach(n => removeJob(n));
                await sock.sendMessage(getTargetJid(remoteJid), { text: '🛡️ *Moderasi Community Dimatikan.*\nBot tidak akan melakukan moderasi otomatis.' });
                return;
            }

            if (subCmd === 'config') {
                if (!isOwner && !isGroupAdmin) {
                    await sock.sendMessage(remoteJid, { text: '⛔ Hanya admin grup yang bisa mengatur konfigurasi.' });
                    return;
                }

                const configKey = args[1]?.toLowerCase();
                const configValue = args.slice(2).join(' ');

                if (!configKey) {
                    // Show current config
                    const cfg = getModerationConfig(remoteJid);
                    const levelNames = { 1: '🟢 Light', 2: '🟡 Normal', 3: '🔴 Strict' };
                    const linkNames = { 'draft': '🚫 Draft Only', 'warn': '⚠️ Warn', 'block': '🚫 Block' };
                    const textBlock = `⚙️ *Konfigurasi Community* ⚙️

🛡️ Status: ${cfg.enabled ? '✅ Aktif' : '❌ Nonaktif'}
📊 Level: ${levelNames[cfg.level] || 'Normal'}
🔞 Filter Toxic: ${cfg.toxicFilter ? '✅' : '❌'}
🌊 Anti-Flood: ${cfg.floodProtection ? '✅' : '❌'}
🔗 Anti-Link Spam: ${linkNames[cfg.linkSpamProtection] || '⚠️ Warn'}
🔠 Filter Caps: ${cfg.capsFilter ? '✅' : '❌'}
⚠️ Auto-Kick: ${cfg.autoKickAtWarn} warnings
📰 IT Content: ${cfg.itContentSharing ? '✅' : '❌'}
⏰ IT Schedule: ${cfg.itContentSchedule}
🌐 Bahasa: ${cfg.language === 'id' ? '🇮🇩 Indonesia' : '🇬🇧 English'}

*Atur:*
/community config [key] [value]
Contoh:
/community config level 3
/community config autoKickAtWarn 5
/community config itContentSchedule 07:00,12:00,18:00,21:00
/community config toxicFilter false`;
                    await sock.sendMessage(getTargetJid(remoteJid), { text: textBlock });
                    return;
                }

                // Validate & set config (all lowercase for case-insensitive matching)
                const validKeys = ['level', 'toxicfilter', 'floodprotection', 'linkspamprotection',
                    'capsfilter', 'autokickatwarn', 'itcontentsharing', 'itcontentschedule', 'language',
                    'autowarn', 'announcementgroupjid'];

                if (!validKeys.includes(configKey)) {
                    await sock.sendMessage(remoteJid, { text: `❌ Key tidak valid. Valid keys: ${validKeys.join(', ')}` });
                    return;
                }

                setModerationConfig(remoteJid, configKey, configValue);

                // If it content sharing toggled, update schedule
                if (configKey === 'itcontentsharing' && configValue === 'true') {
                    await autoScheduleITContent(sock, remoteJid);
                } else if (configKey === 'itcontentsharing' && configValue === 'false') {
                    [`it_digest_${remoteJid}_morning`, `it_digest_${remoteJid}_noon`, `it_digest_${remoteJid}_evening`]
                        .forEach(n => removeJob(n));
                } else if (configKey === 'itcontentschedule') {
                    // Re-schedule with new times
                    await autoScheduleITContent(sock, remoteJid);
                }

                await sock.sendMessage(getTargetJid(remoteJid), { text: `✅ *Config updated:* \`${configKey}\` → \`${configValue}\`` });
                return;
            }

            if (subCmd === 'warn') {
                if (!isOwner && !isGroupAdmin) {
                    await sock.sendMessage(remoteJid, { text: '⛔ Hanya admin yang bisa memberi peringatan.' });
                    return;
                }
                const mentioned = context.mentionedJids;
                const reason = args.slice(1).join(' ') || 'Melanggar aturan grup';
                if (mentioned.length === 0) {
                    await sock.sendMessage(remoteJid, { text: '❌ Tag user yang ingin diperingatkan.\nContoh: /community warn @user Spam' });
                    return;
                }
                const target = mentioned[0];
                const targetName = args[1] || target.split('@')[0];
                const warnCount = issueWarning(target, `[Manual] ${reason}`);
                const cfg = getModerationConfig(remoteJid);
                const threshold = cfg.autoKickAtWarn || 3;

                let msg = `⚠️ *Peringatan untuk @${targetName}*\n📋 Alasan: ${reason}\n📊 Peringatan ke-${warnCount}/${threshold}`;
                if (warnCount >= threshold) {
                    msg += '\n\n⛔ *Telah mencapai batas peringatan!*';
                }
                await sock.sendMessage(remoteJid, { text: msg, mentions: [target] });
                return;
            }

            if (subCmd === 'unwarn' || subCmd === 'clearwarn') {
                if (!isOwner && !isGroupAdmin) {
                    await sock.sendMessage(remoteJid, { text: '⛔ Hanya admin yang bisa menghapus peringatan.' });
                    return;
                }
                const mentioned = context.mentionedJids;
                if (mentioned.length === 0) {
                    await sock.sendMessage(remoteJid, { text: '❌ Tag user yang ingin dihapus peringatannya.' });
                    return;
                }
                const target = mentioned[0];
                clearWarnings(target);
                await sock.sendMessage(remoteJid, { text: `✅ Peringatan untuk @${target.split('@')[0]} telah dihapus.`, mentions: [target] });
                return;
            }

            if (subCmd === 'stats') {
                const modStats = getModerationStats();
                const cfg = getModerationConfig(remoteJid);
                const textBlock = `📊 *Statistik Moderasi* 📊

👤 User terlacak: ${modStats.activeTrackedUsers}
⚠️ User diperingatkan: ${modStats.warnedUsers}
🔗 Link terpantau: ${modStats.trackedLinks}

⚙️ *Konfigurasi Grup Ini:*
🛡️ Status: ${cfg.enabled ? '✅' : '❌'}
📊 Level: ${cfg.level === 1 ? 'Light' : cfg.level === 2 ? 'Normal' : 'Strict'}
📰 IT Content: ${cfg.itContentSharing ? '✅' : '❌'}
⏰ Schedule: ${cfg.itContentSchedule}`;
                await sock.sendMessage(getTargetJid(remoteJid), { text: textBlock });
                return;
            }

            if (subCmd === 'sorry' || subCmd === 'maaf') {
                if (!isOwner && !isGroupAdmin) {
                    await sock.sendMessage(remoteJid, { text: '⛔ Hanya admin grup yang bisa menggunakan ini.' });
                    return;
                }
                
                const reason = args.slice(1).join(' ') || 'spam notifikasi yang mengganggu';
                await sock.sendPresenceUpdate('composing', getTargetJid(remoteJid));
                await sock.sendMessage(getTargetJid(remoteJid), { text: '⏳ _AI sedang menulis permintaan maaf..._' });
                
                try {
                    const cfg = getModerationConfig(remoteJid);
                    const apology = await chatWithContext(
                        `Buat permintaan maaf yang ramah, sopan, dan natural sebagai admin bot WhatsApp.\n\nAlasan minta maaf: ${reason}\n\nTulis dengan gaya santai Indonesia, pake emoji secukupnya, dan akhiri dengan semangat.\n\nContoh: \"Maaf banget ya semuanya, tadi agak spam soalnya...\"\n\nLANGSUNG TULIS PERMINTAAN MAAFNYA, tanpa kata pengantar.`,
                        cfg.language === 'en' ? 'formal' : 'asik',
                        remoteJid
                    );
                    await sock.sendMessage(getTargetJid(remoteJid), { text: apology.substring(0, 1000) });
                    log('SORRY', `AI apologized in ${remoteJid} for: ${reason}`);
                } catch (err) {
                    await sock.sendMessage(remoteJid, { text: `🙏 Maaf banget ya semuanya kalo ada spam atau notifikasi yang ganggu. Makasih pengertiannya! 🫶` });
                    console.error('❌ AI apology error:', err.message);
                }
                return;
            }

            if (subCmd === 'setannounce' || subCmd === 'announce') {
                if (!isOwner && !isGroupAdmin) {
                    await sock.sendMessage(remoteJid, { text: '⛔ Hanya admin grup yang bisa mengatur grup pengumuman.' });
                    return;
                }

                const inviteLink = args[1];
                if (!inviteLink) {
                    const cfg = getModerationConfig(remoteJid);
                    if (cfg.announcementGroupJid) {
                        await sock.sendMessage(remoteJid, {
                            text: `📢 *Grup Pengumuman* sudah diset ke:\n\`${cfg.announcementGroupJid}\`\n\nUntuk menghapus, ketik:\n/community config announcementGroupJid hapus\n\nUntuk mengganti, kirim:\n/community setannounce <link_undangan>`
                        });
                    } else {
                        await sock.sendMessage(remoteJid, {
                            text: '📢 *Atur Grup Pengumuman* 📢\n\nBot akan kirim semua notifikasi (IT digest, status, dll) ke grup khusus biar gak spam di chat utama.\n\n*Cara:*\n1. Buat grup baru\n2. Add bot ke grup itu\n3. Copy link undangan grup\n4. Kirim: `/community setannounce https://chat.whatsapp.com/xxx`\n\n_Link undangan bisa diambil dari Info Grup > Undang via Link_' 
                        });
                    }
                    return;
                }

                // Extract invite code
                const inviteCode = extractInviteCode(inviteLink);
                if (!inviteCode) {
                    await sock.sendMessage(remoteJid, { text: '❌ Link undangan tidak valid.\nGunakan format: https://chat.whatsapp.com/xxx' });
                    return;
                }

                // Accept invite & get group JID
                try {
                    await sock.sendMessage(remoteJid, { text: '⏳ _Mencoba bergabung ke grup pengumuman..._' });
                    const annJid = await sock.groupAcceptInvite(inviteCode);
                    
                    if (!annJid) {
                        await sock.sendMessage(remoteJid, { text: '❌ Gagal bergabung. Bot mungkin sudah di grup itu.\nCoba kirim link grup dengan cara:\n/community config announcementGroupJid <JID>' });
                        return;
                    }

                    // Save to config
                    setModerationConfig(remoteJid, 'announcementgroupjid', annJid);
                    
                    await sock.sendMessage(remoteJid, {
                        text: `✅ *Grup Pengumuman berhasil diset!*\n\n📢 Semua notifikasi bot akan dikirim ke grup pengumuman.\n🔗 JID: \`${annJid}\`\n\n_Untuk menonaktifkan, ketik:_\n/community config announcementGroupJid hapus`
                    });
                } catch (err) {
                    await sock.sendMessage(remoteJid, {
                        text: `❌ Gagal bergabung ke grup: ${err.message}\n\nPastikan:\n1. Link undangan masih berlaku\n2. Bot belum ada di grup itu\n\nAtau set manual:\n/community config announcementGroupJid <JID>`
                    });
                }
                return;
            }

            // Fallback: show help
            await showHelp(sock, remoteJid);
            return;
        }

        // ─── /IT COMMAND ───
        if (command === 'it') {
            const contentType = args[0]?.toLowerCase();
            const validTypes = ['github', 'devto', 'hackernews', 'hn', 'arxiv', 'all'];

            if (!contentType || !validTypes.includes(contentType)) {
                let text = '📰 *IT Content Commands* 📰\n\n';
                text += '• `/it github [lang]` — GitHub Trending\n';
                text += '  Contoh: `/it github javascript`, `/it github`\n';
                text += '• `/it devto [tag]` — Dev.to Articles\n';
                text += '  Contoh: `/it devto react`, `/it devto`\n';
                text += '• `/it hackernews` — HackerNews Top Stories\n';
                text += '• `/it hn` — HackerNews Show\n';
                text += '• `/it arxiv [category]` — ArXiv Papers\n';
                text += '  Contoh: `/it arxiv cs.AI`, `/it arxiv cs.SE`\n';
                text += '• `/it all` — Semua sumber sekaligus\n\n';
                text += '📅 *Daily Digest:* `/digest` atau `/morning`\n';
                text += '_Sumber: GitHub, Dev.to, HackerNews, ArXiv_';
                await sock.sendMessage(getTargetJid(remoteJid), { text });
                return;
            }

            await sock.sendPresenceUpdate('composing', getTargetJid(remoteJid));
            await sock.sendMessage(getTargetJid(remoteJid), { text: `⏳ _Mengambil ${CONTENT_SOURCES[contentType]?.name || contentType}..._` });

            try {
                let data, formatted;

                if (contentType === 'all') {
                    const digest = await fetchMorningDigest({ includeArxiv: true });
                    formatted = formatMorningDigest(digest);
                } else if (contentType === 'hn') {
                    data = await fetchContentByType('hnshow', { limit: 5 });
                    formatted = formatContentByType('hackernews', data);
                } else {
                    const options = {};
                    if (contentType === 'github' && args[1]) options.lang = args[1];
                    if (contentType === 'devto' && args[1]) options.tag = args[1];
                    if (contentType === 'arxiv' && args[1]) options.category = args[1];
                    data = await fetchContentByType(contentType, options);
                    formatted = formatContentByType(contentType, data);
                }

                await sock.sendMessage(getTargetJid(remoteJid), { text: formatted.substring(0, 4000) });
            } catch (err) {
                await sock.sendMessage(getTargetJid(remoteJid), { text: `❌ Gagal mengambil ${contentType}: ${err.message}` });
            }
            return;
        }

        // ─── /DIGEST / MORNING ───
        if (command === 'digest' || command === 'morning') {
            await sock.sendPresenceUpdate('composing', getTargetJid(remoteJid));
            await sock.sendMessage(getTargetJid(remoteJid), { text: '🌅 _Menyusun IT Daily Digest..._' });

            try {
                const digest = await fetchMorningDigest({
                    githubLang: args[0] || '',
                    devToTag: 'programming',
                    hnLimit: 5,
                    includeArxiv: true,
                });
                const formatted = formatMorningDigest(digest);
                await sock.sendMessage(getTargetJid(remoteJid), { text: formatted.substring(0, 4000) });
            } catch (err) {
                await sock.sendMessage(getTargetJid(remoteJid), { text: `❌ Gagal membuat digest: ${err.message}` });
            }
            return;
        }
    }
};

// ─── HELP ───

async function showHelp(sock, remoteJid) {
    const cfg = getModerationConfig(remoteJid);
    const target = getTargetJid(remoteJid, cfg);
    const annStatus = cfg.announcementGroupJid ? `📢 Notifikasi dikirim ke grup pengumuman ✅` : '';
    const text = `🛡️ *Community Admin — Second Admin* 🛡️

Bot bisa jadi *second admin* grup lo! Otomatis:
• 🚫 Filter spam & toxic content
• ⚠️ Beri peringatan ke pelanggar
• 📰 Share konten IT otomatis
${annStatus ? `\n${annStatus}\n` : ''}
*Perintah:*
/community on — Aktifkan moderasi
/community off — Nonaktifkan
/community status — Status saat ini
/community config — Atur detail
/community warn @user — Warn user
/community unwarn @user — Hapus warn
/community stats — Statistik moderasi
/community setannounce — Atur grup pengumuman
/community sorry [alasan] — Minta maaf via AI (kalo ada spam notif)

/it — Lihat konten IT manual
/digest — Daily digest IT

🔥 *Recommended:* /community on`;
    await sock.sendMessage(target, { text });
}

async function showStatus(sock, remoteJid) {
    const cfg = getModerationConfig(remoteJid);
    const target = getTargetJid(remoteJid, cfg);
    const levelNames = { 1: '🟢 Light', 2: '🟡 Normal', 3: '🔴 Strict' };

    let text = `🛡️ *Status Community* 🛡️
━━━━━━━━━━━━━━━━━

${cfg.enabled ? '✅ *Moderasi Aktif*' : '❌ *Moderasi Nonaktif*'}
📊 Level: ${levelNames[cfg.level] || 'Normal'}
📰 IT Content: ${cfg.itContentSharing ? '✅ Aktif' : '❌ Nonaktif'}
⏰ Schedule: ${cfg.itContentSchedule}
${cfg.announcementGroupJid ? `📢 Grup Pengumuman: ✅ Terhubung\n` : ''}
🔞 Toxic Filter: ${cfg.toxicFilter ? '✅' : '❌'}
🌊 Anti-Flood: ${cfg.floodProtection ? '✅' : '❌'}
🔗 Link Spam: ${cfg.linkSpamProtection}
⚠️ Auto-Kick: ${cfg.autoKickAtWarn} warnings

━━━━━━━━━━━━━━━━━
/community setannounce — Atur grup pengumuman
/community config — Atur detail
/community on/off — Aktif/nonaktifkan`;

    if (!cfg.enabled) {
        text += '\n\n💡 *Tips:* Ketik `/community on` untuk aktivasi!';
    }

    await sock.sendMessage(target, { text });
}

// ─── AUTO SCHEDULE IT CONTENT ───

async function autoScheduleITContent(sock, remoteJid) {
    const cfg = getModerationConfig(remoteJid);
    if (!cfg.itContentSharing) return;

    const scheduleTimes = cfg.itContentSchedule.split(',').map(t => t.trim()).filter(Boolean);
    const timeLabels = ['morning', 'noon', 'evening'];

    // Remove existing jobs
    timeLabels.forEach(label => removeJob(`it_digest_${remoteJid}_${label}`));

    // Create new jobs
    for (let i = 0; i < Math.min(scheduleTimes.length, 3); i++) {
        const [h, m] = scheduleTimes[i].split(':').map(Number);
        if (isNaN(h) || isNaN(m)) continue;

        const label = timeLabels[i] || `custom_${i}`;
        const result = addJob(
            `it_digest_${remoteJid}_${label}`,
            remoteJid,
            h, m,
            'it_digest',
            { chatId: remoteJid },
            '*'
        );

        if (result) {
            log('SCHEDULE_IT', `IT Digest scheduled at ${h}:${String(m).padStart(2, '0')} for ${remoteJid}`);
        }
    }
    
    // Also schedule morning greeting at 6:00 AM
    scheduleMorningGreeting(remoteJid);
}

/**
 * Schedule daily morning greeting
 */
function scheduleMorningGreeting(remoteJid) {
    const existing = getJob(`morning_greeting_${remoteJid}`);
    if (existing) return;
    
    const result = addJob(
        `morning_greeting_${remoteJid}`,
        remoteJid,
        6, 0, // 06:00 AM
        'morning_greeting',
        {},
        '*'
    );
    
    if (result) {
        log('SCHEDULE_GREETING', `Morning greeting scheduled at 06:00 for ${remoteJid}`);
    }
}

// ─── ANNOUNCEMENT GROUP ───

/**
 * Get the target JID for sending automated messages.
 * If announcement group is configured, use that instead of the main group.
 */
function getTargetJid(remoteJid, cfg = null) {
    if (!cfg) cfg = getModerationConfig(remoteJid);
    return cfg.announcementGroupJid || remoteJid;
}

/**
 * Extract invite code from a WhatsApp group invite link.
 * Format: https://chat.whatsapp.com/XXX
 */
function extractInviteCode(url) {
    if (!url) return null;
    const match = url.match(/(?:chat\.whatsapp\.com|wa\.me)\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

// ─── HELPER ───

async function isGroupAdminCheck(sock, groupJid, senderJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const senderId = senderJid.split('@')[0];
        for (const p of meta.participants) {
            const pid = p.id?.split('@')[0];
            if (pid === senderId && (p.admin === 'admin' || p.admin === 'superadmin')) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}
