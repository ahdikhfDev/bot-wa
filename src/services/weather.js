import { formatKeyValue } from '../utils/waformat.js';
import { error as logError } from '../utils/logger.js';

const UA = 'ThirtyBot/1.0';

// wttr.in — gratis, no API key
const WTTR_URL = 'https://wttr.in';

const INDONESIAN_CITIES = {
    'jakarta': 'Jakarta',
    'bandung': 'Bandung',
    'surabaya': 'Surabaya',
    'medan': 'Medan',
    'yogyakarta': 'Yogyakarta',
    'semarang': 'Semarang',
    'makassar': 'Makassar',
    'palembang': 'Palembang',
    'denpasar': 'Denpasar',
    'batam': 'Batam',
    'bali': 'Bali',
    'malang': 'Malang',
    'bekasi': 'Bekasi',
    'tangerang': 'Tangerang',
    'depok': 'Depok',
    'solo': 'Surakarta',
    'manado': 'Manado',
    'padang': 'Padang',
    'aceh': 'Banda Aceh',
    'lombok': 'Mataram',
    'samarinda': 'Samarinda',
    'banjarmasin': 'Banjarmasin',
};

function normalizeCity(city) {
    const key = city.toLowerCase().trim();
    return INDONESIAN_CITIES[key] || city;
}

export async function getWeather(city) {
    if (!city) return { error: '❌ Gunakan: /cuaca [nama kota]' };

    const query = normalizeCity(city);

    try {
        const r = await fetch(`${WTTR_URL}/${encodeURIComponent(query)}?format=j1&lang=id`, {
            headers: { 'User-Agent': UA }
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();

        if (!d.current_condition?.[0]) {
            return { error: `Kota "${city}" gak ditemukan.` };
        }

        const cur = d.current_condition[0];
        const loc = d.nearest_area?.[0]?.areaName?.[0]?.value || query;

        return {
            city: loc,
            temp: cur.temp_C,
            feelsLike: cur.FeelsLikeC,
            humidity: cur.humidity,
            desc: cur.lang_id?.[0]?.value || cur.weatherDesc?.[0]?.value || '-',
            windSpeed: cur.windspeedKmph,
            windDir: cur.winddir16Point,
            visibility: cur.visibility,
            uvIndex: cur.uvIndex,
        };
    } catch (err) {
        logError('Weather error', err);
        return { error: `Gagal cek cuaca untuk "${city}".` };
    }
}

export function formatWeather(w) {
    if (w.error) return w.error;

    const items = formatKeyValue([
        { key: '🌡️ Suhu', val: `${w.temp}°C (terasa ${w.feelsLike}°C)` },
        { key: '☁️ Kondisi', val: w.desc },
        { key: '💧 Kelembaban', val: `${w.humidity}%` },
        { key: '💨 Angin', val: `${w.windSpeed} km/j (${w.windDir})` },
        { key: '👁️ Jarak Pandang', val: `${w.visibility} km` },
        { key: '☀️ UV Index', val: `${w.uvIndex}` },
    ]);

    return `🌤️ *Cuaca ${w.city}* 🌤️\n\n${items}`;
}
