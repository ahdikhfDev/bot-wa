const UA = 'ThirtyBot/1.0 (WhatsApp AI Assistant)';
const MAX_RESULTS = 5;

function hasApiKey(key) {
    const val = process.env[key];
    return val && val.length > 0 && !val.startsWith('YOUR_');
}

// ==================== TAVILY SEARCH (best for AI, real web results) ====================

export async function searchTavily(query) {
    try {
        const r = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: process.env.TAVILY_API_KEY,
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
        console.error('❌ Tavily error:', err.message);
        return null;
    }
}

// ==================== WIKIPEDIA SEARCH (fallback, no API key needed) ====================

export async function searchWikipedia(query) {
    try {
        const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${MAX_RESULTS}&namespace=0&format=json`;
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
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
                const extR = await fetch(extUrl, { headers: { 'User-Agent': UA } });
                const extD = await extR.json();
                snippet = extD.extract?.substring(0, 200) || '';
            } catch {}
            items.push({ title, url: link, snippet });
        }

        return { items, source: 'wikipedia' };
    } catch (err) {
        console.error('❌ Wikipedia search error:', err.message);
        return { error: 'Gagal mencari. Coba lagi nanti.' };
    }
}

// ==================== GENERAL SEARCH (auto-detect best backend) ====================

export async function searchWeb(query) {
    if (hasApiKey('TAVILY_API_KEY')) {
        const result = await searchTavily(query);
        if (result) return result;
    }
    return await searchWikipedia(query);
}

// ==================== NEWS SEARCH ====================

export async function searchNews(query) {
    if (hasApiKey('GNEWS_API_KEY')) {
        try {
            const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=id&country=id&max=${MAX_RESULTS}&apikey=${process.env.GNEWS_API_KEY}`;
            const r = await fetch(url, { headers: { 'User-Agent': UA } });
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
            console.error('❌ GNews error:', err.message);
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
    { regex: /^cari(?:kan)?(?:\s+(?:saya|aku|gw|gue))?\s+(.+)/i, type: 'web' },
    { regex: /^search(?:kan)?(?:\s+(?:saya|aku|gw|gue))?\s+(.+)/i, type: 'web' },
    { regex: /^(?:berita|news)\s+(.+)/i, type: 'news' },
    { regex: /^info\s+(?:tentang\s+)?(.+)/i, type: 'web' },
    { regex: /^apa\s+itu\s+(.+)/i, type: 'web' },
    { regex: /^carikan\s+(?:saya|aku|gw|gue)?\s*(.+)/i, type: 'web' },
    { regex: /^siapakah\s+(.+)/i, type: 'web' },
    { regex: /^jelaskan\s+(?:tentang\s+)?(.+)/i, type: 'web' },
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
