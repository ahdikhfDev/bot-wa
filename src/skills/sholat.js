/**
import { error as logError } from '../utils/logger.js';
 * Get jadwal sholat via Aladhan API with KEMENAG method
 * API: https://aladhan.com/prayer-times-api
 * Method 11 = Kementerian Agama Republik Indonesia
 */

// Common Indonesian cities with their data for faster lookup
const KNOWN_CITIES = {
    'jakarta': { city: 'Jakarta', province: 'Jakarta' },
    'bandung': { city: 'Bandung', province: 'Jawa Barat' },
    'surabaya': { city: 'Surabaya', province: 'Jawa Timur' },
    'yogyakarta': { city: 'Yogyakarta', province: 'DI Yogyakarta' },
    'semarang': { city: 'Semarang', province: 'Jawa Tengah' },
    'medan': { city: 'Medan', province: 'Sumatera Utara' },
    'makassar': { city: 'Makassar', province: 'Sulawesi Selatan' },
    'palembang': { city: 'Palembang', province: 'Sumatera Selatan' },
    'denpasar': { city: 'Denpasar', province: 'Bali' },
    'batam': { city: 'Batam', province: 'Kepulauan Riau' },
    'bogor': { city: 'Bogor', province: 'Jawa Barat' },
    'bekasi': { city: 'Bekasi', province: 'Jawa Barat' },
    'tangerang': { city: 'Tangerang', province: 'Banten' },
    'depok': { city: 'Depok', province: 'Jawa Barat' },
    'malang': { city: 'Malang', province: 'Jawa Timur' },
    'padang': { city: 'Padang', province: 'Sumatera Barat' },
    'samarinda': { city: 'Samarinda', province: 'Kalimantan Timur' },
    'banjarmasin': { city: 'Banjarmasin', province: 'Kalimantan Selatan' },
    'pontianak': { city: 'Pontianak', province: 'Kalimantan Barat' },
    'manado': { city: 'Manado', province: 'Sulawesi Utara' },
    'aceh': { city: 'Banda Aceh', province: 'Aceh' },
    'lombok': { city: 'Mataram', province: 'Nusa Tenggara Barat' },
    'ambon': { city: 'Ambon', province: 'Maluku' },
    'jayapura': { city: 'Jayapura', province: 'Papua' },
    'balikpapan': { city: 'Balikpapan', province: 'Kalimantan Timur' },
    'pekanbaru': { city: 'Pekanbaru', province: 'Riau' },
    'lampung': { city: 'Bandar Lampung', province: 'Lampung' },
    'kendari': { city: 'Kendari', province: 'Sulawesi Tenggara' },
    'palu': { city: 'Palu', province: 'Sulawesi Tengah' },
    'gorontalo': { city: 'Gorontalo', province: 'Gorontalo' },
    'mamuju': { city: 'Mamuju', province: 'Sulawesi Barat' },
};

export { KNOWN_CITIES };

/**
 * Calculate Dhuha time (15 minutes after sunrise)
 */
function calcDhuha(sunrise) {
    const [h, m] = sunrise.split(':').map(Number);
    const dhuhaMin = h * 60 + m + 15;
    const dhH = Math.floor(dhuhaMin / 60) % 24;
    const dhM = dhuhaMin % 60;
    return `${String(dhH).padStart(2, '0')}:${String(dhM).padStart(2, '0')}`;
}

/**
 * Get prayer times from Aladhan API
 */
async function getJadwal(city, province) {
    const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=11&adjustment=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const data = await r.json();
    if (data.code !== 200) throw new Error(data.status || 'API error');

    const t = data.data.timings;
    const dhuha = t.Dhuha || calcDhuha(t.Sunrise);

    return {
        date: data.data.date.readable,
        hijri: data.data.date.hijri.date,
        imsak: t.Imsak,
        subuh: t.Fajr,
        terbit: t.Sunrise,
        dhuha: dhuha,
        dzuhur: t.Dhuhr,
        ashar: t.Asr,
        maghrib: t.Maghrib,
        isya: t.Isha,
    };
}

/**
 * Format jadwal to readable text
 */
function formatJadwal(jadwal, city, province) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const times = [
        { name: 'Subuh', time: jadwal.subuh },
        { name: 'Terbit', time: jadwal.terbit },
        { name: 'Dhuha', time: jadwal.dhuha },
        { name: 'Dzuhur', time: jadwal.dzuhur },
        { name: 'Ashar', time: jadwal.ashar },
        { name: 'Maghrib', time: jadwal.maghrib },
        { name: 'Isya', time: jadwal.isya },
    ];

    const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    let nextPrayer = null;
    for (const t of times) {
        if (t.time > nowTimeStr) {
            nextPrayer = t;
            break;
        }
    }

    let nextText = '';
    if (nextPrayer) {
        nextText = `⏰ *Selanjutnya:* ${nextPrayer.name} pukul ${nextPrayer.time}`;
    } else {
        nextText = `🌙 Semua waktu sholat hari ini telah lewat. Besok Subuh ${jadwal.subuh}`;
    }

    const daerah = province ? `, ${province}` : '';
    return `🕌 *Jadwal Sholat*
📍 ${city}${daerah}
📅 ${jadwal.date} (${jadwal.hijri}H)

${nextText}

━━━━━━━━━━━━━━━━━
🌅 *Imsak:* ${jadwal.imsak}
🌅 *Subuh:* ${jadwal.subuh}
☀️ *Terbit:* ${jadwal.terbit}
🌤️ *Dhuha:* ${jadwal.dhuha}
🏙️ *Dzuhur:* ${jadwal.dzuhur}
🌇 *Ashar:* ${jadwal.ashar}
🌆 *Maghrib:* ${jadwal.maghrib}
🌃 *Isya:* ${jadwal.isya}
━━━━━━━━━━━━━━━━━

_Sumber: Aladhan API (Metode Kemenag RI)_`;
}

export default {
    name: 'sholat',
    title: 'Jadwal Sholat',
    description: 'Cek jadwal waktu sholat untuk kota di Indonesia',
    commands: ['sholat', 'imsak', 'jadwalsholat'],

    async handler(sock, remoteJid, args) {
        const query = (args.join(' ').trim().toLowerCase()) || 'jakarta';

        await sock.sendPresenceUpdate('composing', remoteJid);
        await sock.sendMessage(remoteJid, { text: `🕌 _Mencari jadwal sholat untuk "${query}"..._` });

        try {
            // Look up city in known cities or use as-is
            const known = KNOWN_CITIES[query];
            let city, province;

            if (known) {
                city = known.city;
                province = known.province;
            } else {
                // Try direct query to API with the given name
                city = args.join(' ').trim() || query;
                province = '';
            }

            const jadwal = await getJadwal(city, province);
            await sock.sendMessage(remoteJid, { text: formatJadwal(jadwal, city, province) });
        } catch (err) {
            logError('Sholat', err);

            // If city not found in API, try with just "Jakarta" as fallback
            if (!KNOWN_CITIES[query]) {
                try {
                    const jadwal = await getJadwal('Jakarta', 'DKI Jakarta');
                    await sock.sendMessage(remoteJid, {
                        text: `❌ Kota "${query}" tidak ditemukan. Tapi ini jadwal untuk Jakarta:\n\n${formatJadwal(jadwal, 'Jakarta', 'DKI Jakarta')}\n\n💡 Coba: /sholat bandung, /sholat surabaya, /sholat medan`
                    });
                    return;
                } catch { /* silent fallback */ }
            }

            await sock.sendMessage(remoteJid, {
                text: `❌ Gagal mendapatkan jadwal sholat.\nError: ${err.message}\nCoba /sholat [nama kota] (contoh: /sholat jakarta)`
            });
        }
    }
};
