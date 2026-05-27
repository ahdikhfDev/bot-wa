/**
 * Scheduler Engine — Cron job system with DB persistence
 * 
 * Supported action types:
 * - 'message'       → send custom text to chat_id
 * - 'search_news'   → auto-search berita & send results
 * - 'prayer_tracker'→ cek jadwal sholat & notifikasi
 * - 'sholat_notif'  → langsung kirim notif sholat (triggered by tracker)
 * - 'custom'        → execute a skill command
 */

import { saveDb } from './db.js';
import { getDb } from './db.js';

let schedulerRunning = false;
let pollInterval = null;

// In-memory prayer tracker registrations (instead of 108 DB jobs)
const prayerRegistrations = new Map(); // chatId → { city, province }
let prayerTimer = null;

// In-memory cache for prayer times to avoid hitting API every 10min
const prayerCache = new Map(); // "city_province" → { times, fetchedAt, date }

// Notified prayers today to avoid duplicate notifications
const notifiedPrayers = new Map(); // "chatId_city_prayer" → date string

// ==================== DB SCHEMA ====================

// ==================== JOB MANAGEMENT ====================

export function addJob(name, chatId, hour, minute, actionType, actionParams = {}, days = '*') {
    const db = getDb();
    if (!db) return null;
    try {
        db.run(`
            INSERT OR REPLACE INTO cron_jobs (name, chat_id, trigger_hour, trigger_minute, action_type, action_params, days, enabled, last_run_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, '')
        `, [name, chatId, hour, minute, actionType, JSON.stringify(actionParams), days]);
        saveDb();
        return name;
    } catch (err) {
        console.error('❌ Scheduler addJob error:', err.message);
        return null;
    }
}

export function removeJob(name) {
    const db = getDb();
    if (!db) return false;
    db.run('DELETE FROM cron_jobs WHERE name = ?', [name]);
    saveDb();
    return db.getRowsModified() > 0;
}

export function getJob(name) {
    const db = getDb();
    if (!db) return null;
    const r = db.exec('SELECT * FROM cron_jobs WHERE name = ?', [name]);
    if (!r.length || !r[0].values.length) return null;
    return rowToJob(r[0], 0);
}

export function getAllJobs() {
    const db = getDb();
    if (!db) return [];
    const r = db.exec('SELECT * FROM cron_jobs ORDER BY trigger_hour, trigger_minute');
    if (!r.length) return [];
    return r[0].values.map((row, i) => rowToJob(r[0], i));
}

export function getEnabledJobs() {
    const db = getDb();
    if (!db) return [];
    const r = db.exec('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY trigger_hour, trigger_minute');
    if (!r.length) return [];
    return r[0].values.map((row, i) => rowToJob(r[0], i));
}

export function getJobsByType(actionType) {
    const db = getDb();
    if (!db) return [];
    const r = db.exec('SELECT * FROM cron_jobs WHERE action_type = ? AND enabled = 1 ORDER BY trigger_hour, trigger_minute', [actionType]);
    if (!r.length) return [];
    return r[0].values.map((row, i) => rowToJob(r[0], i));
}

function rowToJob(result, index) {
    const cols = result.columns;
    const row = result.values[index];
    const job = {};
    cols.forEach((c, i) => {
        if (c === 'action_params') {
            try { job[c] = JSON.parse(row[i] || '{}'); } catch { job[c] = {}; }
        } else {
            job[c] = row[i];
        }
    });
    return job;
}

export function updateJobRunDate(name, dateStr) {
    const db = getDb();
    if (!db) return;
    db.run('UPDATE cron_jobs SET last_run_date = ? WHERE name = ?', [dateStr, name]);
    saveDb();
}

export function setJobEnabled(name, enabled) {
    const db = getDb();
    if (!db) return;
    db.run('UPDATE cron_jobs SET enabled = ? WHERE name = ?', [enabled ? 1 : 0, name]);
    saveDb();
}

// ==================== SCHEDULER ENGINE ====================

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getCurrentHHMM() {
    const d = new Date();
    return { h: d.getHours(), m: d.getMinutes() };
}

function daysMatch(jobDays) {
    if (jobDays === '*') return true;
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const today = dayNames[new Date().getDay()];
    return jobDays.split(',').map(d => d.trim().toLowerCase()).includes(today);
}

/**
 * Check if a job should run now
 */
function shouldRunNow(job) {
    if (!job.enabled) return false;
    if (!daysMatch(job.days)) return false;
    
    const { h, m } = getCurrentHHMM();
    if (job.trigger_hour !== h || job.trigger_minute !== m) return false;
    
    // Already ran today?
    const today = getTodayStr();
    return job.last_run_date !== today;
}

// ==================== PRAYER TRACKER ====================

/**
 * Fetch today's prayer times (with caching)
 */
async function getCachedPrayerTimes(city, province) {
    const cacheKey = `${city.toLowerCase()}_${(province || '').toLowerCase()}`;
    const cached = prayerCache.get(cacheKey);
    const today = getTodayStr();
    
    if (cached && cached.date === today && (Date.now() - cached.fetchedAt) < 3600000) {
        return cached.times;
    }
    
    try {
        const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=11&adjustment=1`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return null;
        const data = await r.json();
        if (data.code !== 200) return null;
        
        const t = data.data.timings;
        const times = {
            imsak: t.Imsak,
            subuh: t.Fajr,
            terbit: t.Sunrise,
            dhuha: t.Dhuha,
            dzuhur: t.Dhuhr,
            ashar: t.Asr,
            maghrib: t.Maghrib,
            isya: t.Isha,
        };
        
        prayerCache.set(cacheKey, { times, fetchedAt: Date.now(), date: today });
        return times;
    } catch (err) {
        console.error('❌ Prayer API error:', err.message);
        return cached?.times || null;
    }
}

function isWithinWindow(prayerTimeStr, windowMinutes = 5) {
    const now = new Date();
    const [ph, pm] = prayerTimeStr.split(':').map(Number);
    const prayerDate = new Date();
    prayerDate.setHours(ph, pm, 0, 0);
    
    const diffMs = prayerDate.getTime() - now.getTime();
    const diffMinutes = diffMs / 60000;
    
    return diffMinutes > -2 && diffMinutes <= windowMinutes;
}

// ==================== ACTION HANDLERS ====================

const actionHandlers = {
    /**
     * Send a custom message to chat
     */
    async message(sock, job) {
        const { text } = job.action_params;
        if (!text || !sock) return;
        try {
            await sock.sendMessage(job.chat_id, { text });
        } catch (err) {
            console.error('❌ Scheduler message error:', err.message);
        }
    },

    /**
     * Auto-search daily news
     */
    async search_news(sock, job) {
        const { query, source } = job.action_params;
        const searchQuery = query || 'berita terkini indonesia';
        if (!sock) return;
        
        try {
            const { searchWeb, searchNews, formatSearchResults } = await import('./search.js');
            
            await sock.sendMessage(job.chat_id, { text: `📰 _Auto-Berita: mencari ${searchQuery}..._` });
            
            const results = source === 'news' 
                ? await searchNews(searchQuery)
                : await searchWeb(searchQuery);
                
            if (results && !results.error) {
                const formatted = formatSearchResults(results);
                await sock.sendMessage(job.chat_id, { text: `📰 *Auto-Berita Harian* 📰\n\n${formatted}` });
            } else {
                await sock.sendMessage(job.chat_id, { text: `❌ Gagal mendapatkan berita untuk "${searchQuery}".` });
            }
        } catch (err) {
            console.error('❌ Scheduler news error:', err.message);
        }
    },

    /**
     * Direct prayer notification (triggered externally)
     */
    async sholat_notif(sock, job) {
        const { city, province, prayer, time } = job.action_params;
        if (!sock) return;
        
        const daerah = province ? `, ${province}` : '';
        const emojiMap = {
            'Imsak': '🌙', 'Subuh': '🌅', 'Dhuha': '🌤️',
            'Dzuhur': '🏙️', 'Ashar': '🌇', 'Maghrib': '🌆', 'Isya': '🌃'
        };
        const emoji = emojiMap[prayer] || '🕌';
        
        try {
            await sock.sendMessage(job.chat_id, {
                text: `⏰ *Waktu ${prayer}* ⏰\n${emoji} *${prayer}*: ${time}\n📍 ${city}${daerah}\n━━━━━━━━━━━━━━━━━\n_Sumber: Aladhan API (Kemenag RI)_`
            });
        } catch (err) {
            console.error('❌ Scheduler sholat_notif error:', err.message);
        }
    },

    /**
     * Auto-share IT Content Digest
     */
    async it_digest(sock, job) {
        if (!sock) return;
        try {
            const { getModerationConfig } = await import('./autoModerator.js');
            const { fetchMorningDigest, formatMorningDigest } = await import('./itContentAggregator.js');
            
            // Check if main group has an announcement group configured
            const cfg = getModerationConfig(job.chat_id);
            const targetJid = (cfg && cfg.announcementGroupJid) || job.chat_id;
            
            const digest = await fetchMorningDigest({
                githubLang: '',
                devToTag: 'programming',
                hnLimit: 5,
                includeArxiv: true,
            });
            const formatted = formatMorningDigest(digest);
            await sock.sendMessage(targetJid, { text: formatted.substring(0, 4000) });
        } catch (err) {
            console.error('❌ Scheduler it_digest error:', err.message);
        }
    },

    /**
     * Morning greeting — sapaan pagi otomatis ke grup
     */
    async morning_greeting(sock, job) {
        if (!sock) return;
        try {
            const { getModerationConfig, log } = await import('./autoModerator.js');
            const cfg = getModerationConfig(job.chat_id);
            if (!cfg.enabled) return;
            
            const targetJid = cfg.announcementGroupJid || job.chat_id;
            
            const greetings = [
                `🌅 *Selamat Pagi!* ☀️\n\nSemoga hari ini penuh semangat dan produktif! Jangan lupa sarapan dan minum air putih yang cukup ya! 🥞☕💧\n\n📌 *Thirty Bot Aktif & Siap Membantu!* Ada yang bisa dibantu hari ini?`,
                `☀️ *Good Morning!* 🌅\n\nSelamat memulai hari baru! Tetap semangat, tetap produktif! 💪🔥\n\n📌 *Reminder:* Bot selalu siap membantu kapan aja! Ketik /help untuk lihat command.`,
                `🌄 *Pagi-pagi!* 🌞\n\nHari baru, semangat baru! Jangan lupa bersyukur dan nikmati hari ini! 😊\n\n📌 *Tips:* Coba ketik /digest untuk lihat IT trending hari ini!`,
                `☕ *Selamat Pagi!* 🥐\n\nKopi udah di tangan? Laptop udah nyala? Saatnya produktif! 🚀\n\n📌 *Bot siap bantu:* /community status buat cek status, /it github buat liat trending!`,
            ];
            
            const greeting = greetings[Math.floor(Math.random() * greetings.length)];
            await sock.sendMessage(targetJid, { text: greeting });
            log('MORNING_GREETING', `Sent morning greeting to ${targetJid}`);
        } catch (err) {
            console.error('❌ Morning greeting error:', err.message);
        }
    },

    /**
     * Execute a custom skill command
     */
    async custom(sock, job) {
        const { command, args } = job.action_params;
        if (!command || !sock) return;
        
        try {
            const { findSkillByCommand } = await import('../skills/_loader.js');
            const skill = findSkillByCommand(command);
            if (skill) {
                await skill.handler(sock, job.chat_id, args || [], {
                    command,
                    isOwner: false,
                    isGroup: job.chat_id.endsWith('@g.us'),
                    msg: null,
                    sender: 'Scheduler',
                    text: `/${command} ${(args || []).join(' ')}`,
                    mentionedJids: [],
                    isAudio: false,
                    GROUP_CONTEXT_ENABLED: false,
                });
            }
        } catch (err) {
            console.error('❌ Scheduler custom error:', err.message);
        }
    }
};

// ==================== POLL LOOP ====================

export async function startScheduler(sock) {
    if (schedulerRunning) return;
    schedulerRunning = true;
    
    console.log('⏰ Scheduler engine started');
    
    if (pollInterval) clearInterval(pollInterval);
    
    // Initial run
    await tick(sock);
    
    // Poll every 30 seconds
    pollInterval = setInterval(() => tick(sock), 30000);
    
    // Start in-memory prayer timer
    startPrayerTimer(sock);
}

function stopScheduler() {
    schedulerRunning = false;
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    stopPrayerTimer();
    console.log('⏰ Scheduler engine stopped');
}

async function tick(sock) {
    try {
        const jobs = getEnabledJobs();
        const today = getTodayStr();
        
        for (const job of jobs) {
            if (shouldRunNow(job)) {
                const handler = actionHandlers[job.action_type];
                if (handler) {
                    // Run async but don't await (parallel execution)
                    handler(sock, job).catch(err => {
                        console.error(`❌ Scheduler job "${job.name}" error:`, err.message);
                    });
                }
                updateJobRunDate(job.name, today);
            }
        }
    } catch (err) {
        console.error('❌ Scheduler tick error:', err.message);
    }
}

// ==================== PRAYER TRACKER (IN-MEMORY) ====================

/**
 * Register prayer tracking for a chat.
 * Uses in-memory Map + single timer instead of 108 DB jobs.
 */
export function registerPrayerTracking(chatId, city, province) {
    prayerRegistrations.set(chatId, { city, province: province || '' });
    return 1;
}

/**
 * Remove prayer tracking for a chat
 */
export function unregisterPrayerTracking(chatId) {
    return prayerRegistrations.delete(chatId) ? 1 : 0;
}

/**
 * Start the in-memory prayer check timer
 */
function startPrayerTimer(sock) {
    if (prayerTimer) return;
    
    // Run every 8 minutes to check all registered prayer trackers
    prayerTimer = setInterval(async () => {
        if (prayerRegistrations.size === 0 || !sock) return;
        
        const today = getTodayStr();
        
        for (const [chatId, config] of prayerRegistrations) {
            try {
                const times = await getCachedPrayerTimes(config.city, config.province);
                if (!times) continue;
                
                const prayers = [
                    { name: 'Imsak', time: times.imsak },
                    { name: 'Subuh', time: times.subuh },
                    { name: 'Dhuha', time: times.dhuha },
                    { name: 'Dzuhur', time: times.dzuhur },
                    { name: 'Ashar', time: times.ashar },
                    { name: 'Maghrib', time: times.maghrib },
                    { name: 'Isya', time: times.isya },
                ];
                
                for (const p of prayers) {
                    const notifKey = `${chatId}_${config.city}_${p.name}`;
                    const alreadyNotified = notifiedPrayers.get(notifKey) === today;
                    
                    if (!alreadyNotified && isWithinWindow(p.time, 5)) {
                        const daerah = config.province ? `, ${config.province}` : '';
                        const emojiMap = {
                            'Imsak': '🌙', 'Subuh': '🌅', 'Dhuha': '🌤️',
                            'Dzuhur': '🏙️', 'Ashar': '🌇', 'Maghrib': '🌆', 'Isya': '🌃'
                        };
                        const emoji = emojiMap[p.name] || '🕌';
                        
                        await sock.sendMessage(chatId, {
                            text: `⏰ *Waktu ${p.name}* ⏰\n${emoji} *${p.name}*: ${p.time}\n📍 ${config.city}${daerah}\n━━━━━━━━━━━━━━━━━\n_Sumber: Aladhan API (Kemenag RI)_`
                        });
                        
                        notifiedPrayers.set(notifKey, today);
                    }
                }
            } catch (err) {
                console.error('❌ Prayer tracker error for', chatId, ':', err.message);
            }
        }
    }, 8 * 60 * 1000); // Every 8 minutes
    

}

function stopPrayerTimer() {
    if (prayerTimer) {
        clearInterval(prayerTimer);
        prayerTimer = null;
    }
    prayerRegistrations.clear();
    prayerCache.clear();
    notifiedPrayers.clear();
}

// ==================== CLEANUP ====================

export function cleanupScheduler() {
    stopScheduler();
    prayerCache.clear();
    notifiedPrayers.clear();
}

export { getTodayStr };
