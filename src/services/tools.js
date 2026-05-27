import { searchWeb, formatSearchResults } from './search.js';
import { getWeather, formatWeather } from './weather.js';
import { translateText } from './translate.js';
import { getExchangeRate, getHackerNewsTop } from './publicapis.js';
import { addReminder } from './db.js';

const SEARCH_WEB_TOOL = {
    type: 'function',
    function: {
        name: 'search_web',
        description: 'Cari informasi terbaru di web/internet. Gunakan ini saat user menanyakan berita terkini, fakta yang mungkin tidak Anda ketahui, info real-time, atau hal yang membutuhkan update terbaru. Untuk pertanyaan umum/pengetahuan umum, langsung jawab dari pengetahuan sendiri tanpa search.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Kata kunci pencarian, spesifik dan jelas' }
            },
            required: ['query']
        }
    }
};

const GET_WEATHER_TOOL = {
    type: 'function',
    function: {
        name: 'get_weather',
        description: 'Cek prakiraan cuaca untuk suatu kota. Panggil JUGA untuk follow-up implicit dalam konteks cuaca, contoh: "kalo bogor?", "di bandung gimana?", "yang lebih dingin mana?", "kalau yang di surabaya?". Jangan jawab pake pengetahuan sendiri — selalu panggil tool buat data cuaca real-time.',
        parameters: {
            type: 'object',
            properties: {
                city: { type: 'string', description: 'Nama kota. Wajib diisi dari konteks percakapan atau pertanyaan user. Default: Jakarta' }
            },
            required: ['city']
        }
    }
};

const TRANSLATE_TOOL = {
    type: 'function',
    function: {
        name: 'translate_text',
        description: 'Terjemahkan teks dari bahasa asing ke Bahasa Indonesia. Panggil KALAU user kirim teks asing (Inggris, Jepang, dll) dan minta artiin. Contoh: "artikan ini: hello", "apa artinya good morning", "terjemahkan: I love you". Panggil JUGA kalau user ngirim teks asing tanpa minta translate — tawarin untuk translate.',
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Teks yang akan diterjemahkan ke Bahasa Indonesia. Ambil dari teks asing yang dikirim user.' }
            },
            required: ['text']
        }
    }
};

const EARTHQUAKE_TOOL = {
    type: 'function',
    function: {
        name: 'get_earthquake',
        description: 'Cek info gempa bumi terbaru dari BMKG. Gunakan ini jika user bertanya "ada gempa", "gempa barusan", info gempa terkini, atau gempa terbaru.',
        parameters: {
            type: 'object',
            properties: {}
        }
    }
};

const NEWS_TOOL = {
    type: 'function',
    function: {
        name: 'get_latest_tech_news',
        description: 'Ambil berita teknologi terbaru dari Hacker News. Gunakan saat user meminta "berita tech", "kabar IT", "news teknologi", atau info teknologi terkini.',
        parameters: {
            type: 'object',
            properties: {}
        }
    }
};

const RATE_TOOL = {
    type: 'function',
    function: {
        name: 'get_exchange_rate',
        description: 'Cek kurs / nilai tukar mata uang asing. Contoh: "kurs USD ke IDR", "berapa yen ke rupiah", "nilai ringgit ke rupiah"',
        parameters: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Mata uang asal (default: USD). Kode 3 huruf: USD, EUR, JPY, SGD, MYR dll' },
                to: { type: 'string', description: 'Mata uang tujuan (default: IDR)' }
            },
            required: []
        }
    }
};

const REMINDER_TOOL = {
    type: 'function',
    function: {
        name: 'add_reminder',
        description: 'Set reminder/pengingat untuk user. Wajib pakai waktu WIB (UTC+7). Contoh: "ingetin aku jam 3 sore rapat", "reminder beli sabun jam 7 malam"',
        parameters: {
            type: 'object',
            properties: {
                time: { type: 'string', description: 'ISO 8601 waktu trigger dalam WIB. Contoh: "2025-05-15T14:30:00+07:00"' },
                message: { type: 'string', description: 'Pesan reminder/pengingatnya apa' },
            },
            required: ['time', 'message']
        }
    }
};

const ALL_TOOLS = [
    SEARCH_WEB_TOOL,
    GET_WEATHER_TOOL,
    TRANSLATE_TOOL,
    EARTHQUAKE_TOOL,
    NEWS_TOOL,
    RATE_TOOL,
    REMINDER_TOOL,
];

export function getToolDefinitions() {
    return ALL_TOOLS;
}

async function fetchBMKG() {
    const r = await fetch('https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json', {
        headers: { 'User-Agent': 'ThirtyBot/1.0' },
        signal: AbortSignal.timeout(10000)
    });
    const data = await r.json();
    if (!data.Infogempa?.gempa?.length) return 'Tidak ada data gempa terkini.';
    const quakes = data.Infogempa.gempa.slice(0, 5);
    let result = '🔥 GEMPA BUMI TERKINI:\n\n';
    quakes.forEach((q, i) => {
        result += `${i + 1}. ${q.Tanggal} ${q.Jam}\n   Lokasi: ${q.Wilayah}\n   Magnitude: ${q.Magnitude} SR\n   Kedalaman: ${q.Kedalaman}\n   ${q.Potensi || '-'}\n\n`;
    });
    return result.trim();
}

function _trySaveReminderFallback(prompt, chatId) {
    const timeFallback = prompt.match(/(?:jam|pukul)?\s*(\d{1,2})[.:](\d{2})/i);
    if (!timeFallback) return null;
    let h = parseInt(timeFallback[1]), m = parseInt(timeFallback[2]);
    if (h > 23 || m > 59) return null;
    const WIB_MS = 7 * 3600000;
    const nowUtc = Date.now();
    const d = new Date(nowUtc + WIB_MS);
    let targetWib = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0) - WIB_MS;
    if (targetWib <= nowUtc) targetWib += 86400000;
    let msg = prompt
        .replace(/(?:jam|pukul)?\s*\d{1,2}[.:]\d{2}/i, '')
        .replace(/(?:ng)?ing(?:at|et)(?:kan|in|inin)?(?:\s+(?:saya|aku|gw|gue|lo|lu|elu))?\s*/i, '')
        .replace(/\breminder\s*/i, '')
        .replace(/\s+(buat|untuk)\s+/i, ' ')
        .trim() || 'Ada tugas/pekerjaan';
    addReminder(chatId, targetWib, msg);
    return { h, m, msg };
}

export async function executeTool(name, args, chatId) {
    try {
        switch (name) {
            case 'search_web': {
                const results = await searchWeb(args.query);
                return formatSearchResults(results);
            }
            case 'get_weather': {
                const data = await getWeather(args.city || 'Jakarta');
                return formatWeather(data);
            }
            case 'translate_text': {
                const result = await translateText(args.text);
                if (result.error) return `Error: ${result.error}`;
                return `Hasil terjemahan:\nTeks asli: "${result.from}"\nTerjemahan Indonesia: "${result.result}"`;
            }
            case 'get_earthquake': {
                return await fetchBMKG();
            }
            case 'get_latest_tech_news': {
                const items = await getHackerNewsTop(5);
                if (items.error) return items.error;
                let result = '📰 BERITA TEKNOLOGI TERKINI:\n\n';
                items.forEach((item, i) => {
                    result += `${i + 1}. ${item.title}\n   ⬆️ ${item.score} poin | 👤 ${item.by}\n   🔗 ${item.url.substring(0, 80)}\n\n`;
                });
                return result.trim();
            }
            case 'get_exchange_rate': {
                const from = args.from || 'USD';
                const to = args.to || 'IDR';
                const data = await getExchangeRate(from, to);
                if (data.error) return `Error: ${data.error}`;
                return `💱 KURS ${from} → ${to}\n1 ${from} = ${data.rate.toLocaleString()} ${to}\nTanggal: ${data.date}`;
            }
            case 'add_reminder': {
                let triggerTimeMs = new Date(args.time).getTime();
                let reminderMessage = args.message;
                let fallback = null;

                if (!triggerTimeMs || isNaN(triggerTimeMs)) {
                    fallback = _trySaveReminderFallback(args.message || '', chatId);
                    if (fallback) {
                        return `✅ Reminder berhasil disimpan! Akan diingatkan pada jam ${String(fallback.h).padStart(2, '0')}:${String(fallback.m).padStart(2, '0')}: "${fallback.msg}"`;
                    }
                    return 'Error: Format waktu tidak valid. Gunakan format ISO 8601, contoh: 2025-05-15T14:30:00+07:00';
                }

                addReminder(chatId || 'system', triggerTimeMs, reminderMessage);
                const d = new Date(triggerTimeMs);
                return `✅ Reminder berhasil disimpan! Akan diingatkan pada ${d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}: "${reminderMessage}"`;
            }
            default:
                return `Error: Tool "${name}" tidak dikenal.`;
        }
    } catch (err) {
        console.error(`❌ Tool error (${name}):`, err.message);
        return `Error saat menjalankan ${name}: ${err.message}`;
    }
}
