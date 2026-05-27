/**
 * Skill: Scheduler Management
 * - /schedule list — lihat semua job
 * - /schedule add [name] [HH:MM] [message] — tambah job custom message
 * - /schedule remove [name] — hapus job
 * - /schedule toggle [name] — enable/disable job
 * - /schedule news [HH:MM] [query] — auto berita harian
 * - /setjadwalsholat [kota] — aktifkan notif sholat otomatis
 * - /unsetjadwalsholat — matikan notif sholat
 */

import { getAllJobs, removeJob, addJob, setJobEnabled, getJob } from '../services/scheduler.js';

function formatTime(h, m) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default {
    name: 'schedule',
    title: 'Scheduler',
    description: 'Atur job otomatis (berita, pengingat, dll)',
    commands: ['schedule', 'scheduler', 'setjadwalsholat', 'unsetjadwalsholat'],
    ownerOnly: true,

    async handler(sock, remoteJid, args, context) {
        const { command } = context;

        // ==================== SHOLAT COMMANDS ====================
        if (command === 'setjadwalsholat') {
            const { registerPrayerTracking } = await import('../services/scheduler.js');
            const city = args.join(' ').trim() || 'Jakarta';
            
            // Check known cities
            const { KNOWN_CITIES } = await import('./sholat.js');
            const known = KNOWN_CITIES[city.toLowerCase()];
            const cityName = known?.city || city;
            const province = known?.province || '';
            
            await sock.sendMessage(remoteJid, { text: `🕌 _Mendaftarkan notifikasi sholat untuk ${cityName}..._` });
            
            registerPrayerTracking(remoteJid, cityName, province);
            
            await sock.sendMessage(remoteJid, { 
                text: `✅ *Notifikasi Sholat Aktif!* 🕌\n📍 ${cityName}${province ? `, ${province}` : ''}\n⏰ Bot cek setiap 8 menit\n\nBot akan otomatis ngirim notif 5 menit sebelum setiap waktu sholat tiba.\n\n💡 *Nonaktifkan:* /unsetjadwalsholat` 
            });
            return;
        }

        if (command === 'unsetjadwalsholat') {
            const { unregisterPrayerTracking } = await import('../services/scheduler.js');
            const removed = unregisterPrayerTracking(remoteJid);
            
            if (removed > 0) {
                await sock.sendMessage(remoteJid, { 
                    text: `✅ Notifikasi sholat untuk chat ini telah dinonaktifkan (${removed} job dihapus).` 
                });
            } else {
                await sock.sendMessage(remoteJid, { 
                    text: `ℹ️ Tidak ada notifikasi sholat aktif untuk chat ini.\nAktifkan dengan: /setjadwalsholat [kota]` 
                });
            }
            return;
        }

        // ==================== SCHEDULE COMMANDS ====================
        const subcommand = args[0]?.toLowerCase();

        if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
            const jobs = getAllJobs();
            
            if (jobs.length === 0) {
                await sock.sendMessage(remoteJid, { 
                    text: `📋 *Daftar Schedule*\n\nTidak ada job terjadwal.\n\n*Cara pakai:*\n• /schedule add [nama] [HH:MM] [pesan]\n• /schedule news [HH:MM] [topik berita]\n• /schedule remove [nama]\n• /schedule toggle [nama]\n• /setjadwalsholat [kota] — notif sholat` 
                });
                return;
            }

            let text = `📋 *Daftar Schedule (${jobs.length} job)*\n━━━━━━━━━━━━━━━━━\n\n`;
            for (const job of jobs) {
                const time = formatTime(job.trigger_hour, job.trigger_minute);
                const status = job.enabled ? '✅' : '⛔';
                let info = '';
                
                switch (job.action_type) {
                    case 'message':
                        info = `💬 ${(job.action_params?.text || '').substring(0, 50)}`;
                        break;
                    case 'search_news':
                        info = `📰 ${job.action_params?.query || 'berita'}`;
                        break;
                    case 'prayer_tracker':
                        info = `🕌 Sholat: ${job.action_params?.city || '?'}`;
                        break;
                    case 'sholat_notif':
                        info = `🕌 ${job.action_params?.prayer || '?'} ${job.action_params?.time || ''}`;
                        break;
                    case 'custom':
                        info = `⚡ /${job.action_params?.command || '?'}`;
                        break;
                    default:
                        info = `❓ ${job.action_type}`;
                }
                
                text += `${status} ${time} | ${info}\n   _${job.name}_\n\n`;
            }
            
            text += `━━━━━━━━━━━━━━━━━\n💡 /schedule remove [nama] — hapus\n💡 /schedule toggle [nama] — aktif/nonaktif`;
            
            await sock.sendMessage(remoteJid, { text });
            return;
        }

        if (subcommand === 'remove' || subcommand === 'rm' || subcommand === 'delete') {
            const name = args.slice(1).join(' ');
            if (!name) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /schedule remove [nama_job]' });
                return;
            }
            
            if (removeJob(name)) {
                await sock.sendMessage(remoteJid, { text: `✅ Job "${name}" telah dihapus.` });
            } else {
                await sock.sendMessage(remoteJid, { text: `❌ Job "${name}" tidak ditemukan.` });
            }
            return;
        }

        if (subcommand === 'toggle' || subcommand === 't') {
            const name = args.slice(1).join(' ');
            if (!name) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /schedule toggle [nama_job]' });
                return;
            }
            
            const job = getJob(name);
            if (!job) {
                await sock.sendMessage(remoteJid, { text: `❌ Job "${name}" tidak ditemukan.` });
                return;
            }
            
            const newState = !job.enabled;
            setJobEnabled(name, newState);
            await sock.sendMessage(remoteJid, { text: `✅ Job "${name}" ${newState ? '✅ diaktifkan' : '⛔ dinonaktifkan'}.` });
            return;
        }

        if (subcommand === 'add') {
            // /schedule add [name] [HH:MM] [message]
            const parts = args.slice(1);
            const name = parts[0];
            const timeStr = parts[1];
            const message = parts.slice(2).join(' ');
            
            if (!name || !timeStr || !message) {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ Usage: /schedule add [nama] [HH:MM] [pesan]\n\nContoh:\n/schedule add selamatpagi 06:00 Selamat pagi semuanya! 🌅\n/schedule add jadwalngoding 20:00 Waktunya ngoding! 💻` 
                });
                return;
            }
            
            const [h, m] = timeStr.split(':').map(Number);
            if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
                await sock.sendMessage(remoteJid, { text: '❌ Format waktu salah. Gunakan HH:MM (contoh: 06:00, 18:30)' });
                return;
            }
            
            const jobName = `${name}_${remoteJid.replace(/[^a-zA-Z0-9]/g, '_')}`;
            addJob(jobName, remoteJid, h, m, 'message', { text: message });
            await sock.sendMessage(remoteJid, { 
                text: `✅ *Job "${name}" dibuat!*\n⏰ ${formatTime(h, m)}\n💬 ${message}\n\nSetiap hari jam ${formatTime(h, m)} WIB bot akan kirim pesan ini.` 
            });
            return;
        }

        if (subcommand === 'news' || subcommand === 'berita') {
            // /schedule news [HH:MM] [query]
            const timeStr = args[1];
            const query = args.slice(2).join(' ') || 'berita terkini indonesia';
            
            if (!timeStr) {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ Usage: /schedule news [HH:MM] [topik]\n\nContoh:\n/schedule news 06:00 berita terkini indonesia\n/schedule news 07:30 teknologi terbaru` 
                });
                return;
            }
            
            const [h, m] = timeStr.split(':').map(Number);
            if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
                await sock.sendMessage(remoteJid, { text: '❌ Format waktu salah. Gunakan HH:MM (contoh: 06:00)' });
                return;
            }
            
            const jobName = `berita_${remoteJid.replace(/[^a-zA-Z0-9]/g, '_')}_${h}_${m}`;
            addJob(jobName, remoteJid, h, m, 'search_news', { query });
            await sock.sendMessage(remoteJid, { 
                text: `✅ *Auto-Berita Harian Aktif!* 📰\n⏰ Setiap hari jam ${formatTime(h, m)} WIB\n📰 Topik: ${query}\n\nBot akan otomatis cari berita & kirim ke sini.` 
            });
            return;
        }

        // Help fallback
        await sock.sendMessage(remoteJid, { 
            text: `📋 *Schedule Commands* 📋\n\n• /schedule list — lihat semua job\n• /schedule add [nama] [HH:MM] [pesan]\n  Contoh: /schedule add pagi 06:00 Selamat pagi\n• /schedule news [HH:MM] [topik]\n  Contoh: /schedule news 06:00 berita terkini\n• /schedule remove [nama] — hapus job\n• /schedule toggle [nama] — hidup/matiin job\n• /setjadwalsholat [kota] — notif sholat otomatis\n• /unsetjadwalsholat — matiin notif sholat` 
        });
    }
};
