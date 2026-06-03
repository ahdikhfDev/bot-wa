import { getSetting } from './db.js';
import * as cheerio from 'cheerio';
import { error as logError } from '../utils/logger.js';

const UA = 'ThirtyBot/1.0 (WhatsApp AI Assistant)';
const MAX_RESULTS = 5;
const SEARCH_TIMEOUT_MS = parseInt(process.env.SEARCH_TIMEOUT_MS || '12000', 10);

function hasApiKey(key) {
    const val = getSetting(key) || process.env[key];
    return val && val.length > 0 && !val.startsWith('YOUR_');
}

function getApiKey(key) {
    return getSetting(key) || process.env[key] || '';
}

function fetchWithTimeout(url, options = {}) {
    return fetch(url, { ...options, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
}

// ==================== TAVILY SEARCH (best for AI, real web results) ====================

export async function searchTavily(query) {
    try {
        const r = await fetchWithTimeout('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: getApiKey('TAVILY_API_KEY'),
                query,
                search_depth: 'basic',
                max_results: MAX_RESULTS,
                include_answer: false,
            })
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        if (!d.results || d.results.length === 0) {
            return { error: 'Tidak ada hasil.' };
        }
        const items = d.results.map(a => ({
            title: a.title || '',
            url: a.url || '',
            snippet: a.content || a.snippet || '',
        }));
        return { items, source: 'tavily' };
    } catch (err) {
        logError('Tavily search', err);
        return null;
    }
}



// ==================== BING SEARCH (Free scraping, real URLs via cite element, date sorting) ====================

export async function searchBing(query) {
    // Use sort=date for most recent results
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&hl=en&sort=date`;
    try {
        const r = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
            }
        });

        if (!r.ok) {
            logError('Bing search status: ' + r.status);
            return null;
        }

        const html = await r.text();
        const $ = cheerio.load(html);

        const items = [];
        $('li.b_algo, .b_algo').each((i, el) => {
            if (i >= MAX_RESULTS) return false;
            const title = $(el).find('h2 a').text().trim();
            const snippet = $(el).find('.b_caption p, .b_lineclamp2').text().trim();

            // Extract real URL from cite element (Bing uses client-side redirects)
            const citeText = $(el).find('cite').text().trim();
            let realUrl = '';
            if (citeText) {
                // Parse: "https://www.example.com › path › page" → "https://www.example.com/path/page"
                realUrl = citeText.replace(/\s*›\s*/g, '/').trim();
                if (!realUrl.startsWith('http')) {
                    realUrl = 'https://' + realUrl;
                }
            }

            if (title && realUrl) {
                items.push({ title, url: realUrl, snippet: snippet.substring(0, 250) });
            }
        });

        if (items.length === 0) {
            logError('Bing search: no results extracted');
            return null;
        }

        return { items, source: 'bing' };
    } catch (err) {
        logError('Bing search error', err);
        return null;
    }
}

// ==================== WIKIPEDIA SEARCH (fallback, no API key needed) ====================

export async function searchWikipedia(query) {
    try {
        const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${MAX_RESULTS}&namespace=0&format=json`;
        const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
        const d = await r.json();
        if (!d || !d[1] || d[1].length === 0) {
            return { error: 'Tidak ada hasil di Wikipedia.' };
        }

        const items = [];
        for (let i = 0; i < d[1].length; i++) {
            const title = d[1][i];
            const link = d[3]?.[i] || '';
            let snippet = '';
            try {
                const extUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
                const extR = await fetchWithTimeout(extUrl, { headers: { 'User-Agent': UA } });
                const extD = await extR.json();
                snippet = extD.extract?.substring(0, 200) || '';
            } catch (e) { logError("Wikipedia search empty", e); }
            items.push({ title, url: link, snippet });
        }

        return { items, source: 'wikipedia' };
    } catch (err) {
        logError('Wikipedia search error', err);
        return { error: 'Gagal mencari. Coba lagi nanti.' };
    }
}

// ==================== GENERAL SEARCH (auto-detect best backend) ====================

export async function searchWeb(query) {
    // 1. Tavily (Best)
    if (hasApiKey('TAVILY_API_KEY')) {
        const result = await searchTavily(query);
        if (result && !result.error) return result;
    }

    // 2. Bing scraping (real URLs via cite, sorted by date)
    const bingResult = await searchBing(query);
    if (bingResult) return bingResult;

    // 3. Wikipedia (Last resort)
    return await searchWikipedia(query);
}

// ==================== NEWS SEARCH ====================

export async function searchNews(query) {
    if (hasApiKey('GNEWS_API_KEY')) {
        try {
            const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=id&country=id&max=${MAX_RESULTS}&apikey=${getApiKey('GNEWS_API_KEY')}`;
            const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
            const d = await r.json();
            if (!d.errors && d.articles?.length > 0) {
                const items = d.articles.slice(0, MAX_RESULTS).map(a => ({
                    title: a.title || '',
                    url: a.url || '',
                    snippet: a.description || '',
                    source: a.source?.name || '',
                }));
                return { items, source: 'berita' };
            }
        } catch (err) {
            logError('GNews error', err);
        }
    }
    return await searchWikipedia(query + ' news');
}

// ==================== FORMATTER ====================

export function formatSearchResults(data) {
    if (data.error) return data.error;

    let icon, label;
    switch (data.source) {
        case 'berita': icon = '📰'; label = 'Berita'; break;
        case 'tavily': icon = '🔍'; label = 'Hasil Web'; break;
        case 'bing': icon = '🔍'; label = 'Hasil Web'; break;
        case 'wikipedia': icon = '📖'; label = 'Wikipedia'; break;
        default: icon = '🔍'; label = 'Hasil Pencarian';
    }

    let text = `${icon} *${label}*\n\n`;

    data.items.forEach((item, i) => {
        text += `${i + 1}. *${item.title}*\n`;
        if (item.snippet) text += `   ${item.snippet.replace(/\n/g, ' ').trim().substring(0, 250)}\n`;
        if (item.url && item.url.startsWith('http')) text += `   🔗 ${item.url.substring(0, 60)}...\n`;
        if (item.source) text += `   📰 ${item.source}\n`;
        text += '\n';
    });

    text += `_Sumber: ${data.source}_`;
    return text;
}

// ==================== PATTERN DETECTION ====================

const SEARCH_PATTERNS = [
    { regex: /(?:^|\s)cari+k?a?n?(?:\s+(?:saya|aku|gw|gue))?\s+(.+)/i, type: 'web' },
    { regex: /(?:^|\s)search(?:kan)?(?:\s+(?:saya|aku|gw|gue))?\s+(.+)/i, type: 'web' },
    { regex: /(?:^|\s)(?:berita|news)\s+(.+)/i, type: 'news' },
    { regex: /(?:^|\s)info\s+(?:tentang\s+)?(.+)/i, type: 'web' },
    { regex: /(?:^|\s)apa\s+itu\s+(.+)/i, type: 'web' },
    { regex: /(?:^|\s)siapakah\s+(.+)/i, type: 'web' },
    { regex: /(?:^|\s)jelaskan\s+(?:tentang\s+)?(.+)/i, type: 'web' },
    { regex: /(?:^|\s)googling\s+(.+)/i, type: 'web' },
    { regex: /(?:^|\s)(?:harga|kurs|cuaca|hasil|skor)\s+(.+)/i, type: 'web' },
    { regex: /(?:^|\s)bagaimana\s+(?:cara|kondisi|kabar)\s+(.+)/i, type: 'web' },
];

export function detectSearchQuery(text) {
    const trimmed = text.trim();
    for (const p of SEARCH_PATTERNS) {
        const match = trimmed.match(p.regex);
        if (match) {
            const query = match[1]?.trim();
            if (query && query.length > 1) return { query, type: p.type };
        }
    }
    return null;
}
