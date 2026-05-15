const UA = 'ThirtyBot/1.0';

// ==================== EXCHANGE RATE ====================

export async function getExchangeRate(from = 'USD', to = 'IDR') {
    try {
        const r = await fetch(`https://api.exchangerate-api.com/v4/latest/${from.toUpperCase()}`, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(8000)
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        const rate = d.rates?.[to.toUpperCase()];
        if (!rate) return { error: `Mata uang "${to}" gak ditemukan.` };
        return { from: from.toUpperCase(), to: to.toUpperCase(), rate, date: d.date };
    } catch (err) {
        return { error: `Gagal cek kurs. ${err.message}` };
    }
}

export function formatExchangeRate(data) {
    if (data.error) return data.error;
    return `💱 *Kurs Mata Uang*\n\n1 ${data.from} = *${data.rate.toLocaleString()} ${data.to}*\n📅 ${data.date}`;
}

// ==================== HACKERNEWS ====================

export async function getHackerNewsTop(limit = 5) {
    try {
        const r = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(8000)
        });
        const ids = await r.json();
        const topIds = ids.slice(0, limit);

        const items = await Promise.all(topIds.map(async id => {
            try {
                const s = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
                    headers: { 'User-Agent': UA },
                    signal: AbortSignal.timeout(5000)
                });
                const d = await s.json();
                return {
                    title: d.title || 'Untitled',
                    url: d.url || `https://news.ycombinator.com/item?id=${id}`,
                    score: d.score || 0,
                    by: d.by || 'anonymous',
                    comments: d.descendants || 0,
                };
            } catch { return null; }
        }));

        return items.filter(Boolean);
    } catch (err) {
        return { error: `Gagal ambil HackerNews. ${err.message}` };
    }
}

export function formatHackerNews(items) {
    if (items.error) return items.error;
    if (!items.length) return 'Tidak ada berita.';
    let text = `📰 *HackerNews — Top Stories*\n\n`;
    items.forEach((item, i) => {
        text += `${i + 1}. *${item.title}*\n   ⬆️ ${item.score} | 💬 ${item.comments} | 👤 ${item.by}\n`;
    });
    text += `\n_Sumber: news.ycombinator.com_`;
    return text;
}

// ==================== TVMAZE ====================

export async function searchTVShow(query) {
    if (!query) return { error: 'Masukkan judul acara TV.' };
    try {
        const r = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(8000)
        });
        const d = await r.json();
        if (!d || d.length === 0) return { error: `Acara "${query}" gak ditemukan.` };

        return d.slice(0, 5).map(item => ({
            title: item.show.name,
            status: item.show.status || 'Unknown',
            type: item.show.type || 'Unknown',
            language: item.show.language || 'Unknown',
            genres: item.show.genres?.join(', ') || '-',
            premiered: item.show.premiered || '-',
            rating: item.show.rating?.average || '-',
            summary: item.show.summary?.replace(/<[^>]*>/g, '').substring(0, 200) || '-',
            url: item.show.url || '',
        }));
    } catch (err) {
        return { error: `Gagal cari acara TV. ${err.message}` };
    }
}

export function formatTVShow(items) {
    if (items.error) return items.error;
    if (!items.length) return 'Tidak ada hasil.';
    let text = `📺 *Hasil Pencarian TV*\n\n`;
    items.forEach((item, i) => {
        text += `${i + 1}. *${item.title}*\n`;
        text += `   📺 ${item.status} | ${item.type} | ${item.language}\n`;
        text += `   🏷️ ${item.genres}\n`;
        text += `   ⭐ ${item.rating} | 📅 ${item.premiered}\n`;
        if (item.summary && item.summary !== '-') {
            text += `   ${item.summary.substring(0, 100)}...\n`;
        }
        text += '\n';
    });
    return text;
}

// ==================== IP LOOKUP ====================

export async function getIPInfo() {
    try {
        const r = await fetch('https://api.myip.com', { signal: AbortSignal.timeout(5000) });
        const d = await r.json();
        return { ip: d.ip, country: d.country || '-', cc: d.cc || '-' };
    } catch {
        try {
            const r = await fetch('https://httpbin.org/ip', { signal: AbortSignal.timeout(5000) });
            const d = await r.json();
            return { ip: d.origin, country: '?', cc: '?' };
        } catch { return null; }
    }
}

export function formatIPInfo(data) {
    if (!data) return '❌ Gagal cek IP.';
    return `🌐 *IP Info*\n\n• *IP*: ${data.ip}\n• *Negara*: ${data.country} (${data.cc})`;
}

// ==================== QR CODE ====================

export function getQRUrl(text, size = 300) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}
