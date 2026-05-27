/**
 * IT Content Aggregator Service
 * 
 * Auto-fetch konten IT dari berbagai sumber untuk di-share ke grup komunitas.
 * 
 * Sumber:
 * - GitHub Trending Repos
 * - HackerNews Top Stories
 * - Dev.to Latest Articles
 * - ProductHunt (via scraping)
 * - arXiv CS Papers (daily)
 */

import { getSetting } from './db.js';
import * as cheerio from 'cheerio';
import { log, warn } from '../utils/logger.js';

const UA = 'ThirtyBot/2.0 (IT Community Assistant)';
const SEARCH_TIMEOUT_MS = 15000;

function fetchWithTimeout(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: { 'User-Agent': UA, ...options.headers },
        signal: AbortSignal.timeout(options.timeout || SEARCH_TIMEOUT_MS),
    });
}

// ─── GITHUB TRENDING ───

export async function fetchGitHubTrending(language = '', since = 'daily') {
    try {
        const url = `https://github.com/trending${language ? `/${encodeURIComponent(language)}` : ''}?since=${since}`;
        const r = await fetchWithTimeout(url, {
            headers: { 'Accept': 'text/html' },
            timeout: 15000,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        
        const html = await r.text();
        const $ = cheerio.load(html);
        const repos = [];

        $('article.Box-row').each((i, el) => {
            if (i >= 5) return false; // max 5 repos
            
            const nameEl = $(el).find('h2 a');
            const fullName = nameEl.text().trim().replace(/\s+/g, '');
            const description = $(el).find('p').text().trim();
            const stars = $(el).find('.d-inline-block.float-sm-right').text().trim();
            const forks = $(el).find('a[href$="/forks"]').text().trim();
            const lang = $(el).find('[itemprop="programmingLanguage"]').text().trim();
            const todayStars = $(el).find('.float-sm-right .d-inline-block').text().trim() || 
                               $(el).find('.d-inline-block.float-sm-right').text().trim();
            
            if (fullName) {
                repos.push({
                    name: fullName,
                    url: `https://github.com/${fullName}`,
                    description: description || 'No description',
                    language: lang || 'Unknown',
                    stars: stars || '0',
                    forks: forks || '0',
                    todayStars: todayStars || '0',
                });
            }
        });

        return repos;
    } catch (err) {
        warn(`GitHub Trending error: ${err.message}`);
        return [];
    }
}

export function formatGitHubTrending(repos, since = 'hari ini') {
    if (!repos.length) return 'Belum ada repositori trending.';
    
    let text = `🔥 *GitHub Trending* (${since})\n━━━━━━━━━━━━━━━━━\n\n`;
    repos.forEach((r, i) => {
        text += `${i + 1}. *${r.name}*\n`;
        text += `   ${r.description.substring(0, 100)}\n`;
        if (r.language !== 'Unknown') text += `   🟦 ${r.language}`;
        text += `   ⭐ ${r.stars}  🍴 ${r.forks}`;
        if (r.todayStars && r.todayStars !== '0') text += `  📈 ${r.todayStars} today`;
        text += `\n   🔗 ${r.url}\n\n`;
    });
    text += '_Sumber: github.com/trending_';
    return text;
}

// ─── DEV.TO ARTICLES ───

export async function fetchDevToArticles(tag = '', limit = 5) {
    try {
        let url = `https://dev.to/api/articles?per_page=${limit}`;
        if (tag) url += `&tag=${encodeURIComponent(tag)}`;
        // Popular articles
        url += '&state=rising';
        
        const r = await fetchWithTimeout(url, {
            headers: { 'Accept': 'application/json' },
            timeout: 10000,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        
        const articles = await r.json();
        return articles.map(a => ({
            title: a.title,
            url: a.url,
            description: a.description || '',
            tags: a.tag_list || [],
            user: a.user?.name || 'Unknown',
            readingTime: a.reading_time_minutes || 0,
            positiveReactions: a.positive_reactions_count || 0,
            comments: a.comments_count || 0,
            publishedAt: a.readable_publish_date || '',
        }));
    } catch (err) {
        warn(`Dev.to error: ${err.message}`);
        return [];
    }
}

export function formatDevToArticles(articles, tag = '') {
    if (!articles.length) return 'Belum ada artikel Dev.to.';
    
    const tagStr = tag ? ` #${tag}` : '';
    let text = `📝 *Dev.to Articles${tagStr}*\n━━━━━━━━━━━━━━━━━\n\n`;
    articles.forEach((a, i) => {
        text += `${i + 1}. *${a.title}*\n`;
        text += `   👤 ${a.user}  ⏱ ${a.readingTime} min  ❤️ ${a.positiveReactions}\n`;
        if (a.tags.length) text += `   🏷️ ${a.tags.slice(0, 4).map(t => '#' + t).join(' ')}\n`;
        text += `   🔗 ${a.url}\n\n`;
    });
    text += '_Sumber: dev.to_';
    return text;
}

// ─── HACKERNEWS (using existing API) ───

export async function fetchHackerNewsTop(limit = 5) {
    try {
        const r = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/topstories.json', {
            timeout: 8000,
        });
        const ids = await r.json();
        const topIds = ids.slice(0, limit);

        const items = await Promise.all(topIds.map(async id => {
            try {
                const s = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
                    timeout: 5000,
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
        warn(`HackerNews error: ${err.message}`);
        return [];
    }
}

export function formatHackerNews(items) {
    if (!items.length) return 'Belum ada berita HackerNews.';
    let text = `📰 *HackerNews — Top Stories*\n━━━━━━━━━━━━━━━━━\n\n`;
    items.forEach((item, i) => {
        text += `${i + 1}. *${item.title}*\n`;
        text += `   ⬆️ ${item.score}  💬 ${item.comments}  👤 ${item.by}\n`;
        if (item.url.startsWith('http')) text += `   🔗 ${item.url.substring(0, 80)}...\n`;
        text += '\n';
    });
    text += '_Sumber: news.ycombinator.com_';
    return text;
}

// ─── HACKERNEWS SHOW/ASK ───

export async function fetchHackerNewsShow(limit = 3) {
    try {
        const r = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/showstories.json', {
            timeout: 8000,
        });
        const ids = await r.json();
        const topIds = ids.slice(0, limit);

        const items = await Promise.all(topIds.map(async id => {
            try {
                const s = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
                    timeout: 5000,
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
        warn(`HN Show error: ${err.message}`);
        return [];
    }
}

// ─── ArXiv CS PAPERS (daily) ───

export async function fetchArxivPapers(category = 'cs.AI', limit = 3) {
    try {
        const url = `https://export.arxiv.org/api/query?search_query=cat:${category}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;
        const r = await fetchWithTimeout(url, {
            headers: { 'Accept': 'application/atom+xml' },
            timeout: 15000,
        });
        const xml = await r.text();
        
        // Simple XML parsing without heavy dependencies
        const entries = xml.split('<entry>').slice(1);
        
        return entries.map(entry => {
            const title = entry.match(/<title>(.*?)<\/title>/s)?.[1]?.trim() || '';
            const summary = entry.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || '';
            const id = entry.match(/<id>(.*?)<\/id>/s)?.[1]?.trim() || '';
            const authors = [...entry.matchAll(/<author>.*?<name>(.*?)<\/name>.*?<\/author>/gs)]
                .map(m => m[1])
                .slice(0, 3)
                .join(', ');
            
            return {
                title: title.replace(/\s+/g, ' ').trim(),
                url: id,
                summary: summary.replace(/\s+/g, ' ').substring(0, 200).trim(),
                authors: authors || 'Unknown',
                category,
            };
        }).filter(e => e.title);
    } catch (err) {
        warn(`ArXiv error: ${err.message}`);
        return [];
    }
}

export function formatArxivPapers(papers) {
    if (!papers.length) return 'Belum ada paper baru.';
    
    let text = `📄 *ArXiv Papers — ${papers[0]?.category || 'CS'}*\n━━━━━━━━━━━━━━━━━\n\n`;
    papers.forEach((p, i) => {
        text += `${i + 1}. *${p.title.substring(0, 80)}*\n`;
        text += `   👤 ${p.authors.substring(0, 60)}\n`;
        if (p.summary) text += `   ${p.summary.substring(0, 120)}...\n`;
        text += `   🔗 ${p.url}\n\n`;
    });
    text += '_Sumber: arxiv.org_';
    return text;
}

// ─── MASTER AGGREGATOR ───

/**
 * Fetch all IT content for a complete morning digest
 */
export async function fetchMorningDigest(options = {}) {
    const {
        githubLang = '',
        devToTag = 'programming',
        hnLimit = 5,
        arxivCategory = 'cs.AI',
        includeArxiv = false,
    } = options;

    const results = await Promise.all([
        fetchGitHubTrending(githubLang),
        fetchDevToArticles(devToTag, 3),
        fetchHackerNewsTop(hnLimit),
        includeArxiv ? fetchArxivPapers(arxivCategory, 2) : Promise.resolve([]),
    ]);

    return {
        github: results[0],
        devto: results[1],
        hackernews: results[2],
        arxiv: results[3],
        fetchedAt: new Date().toISOString(),
    };
}

export function formatMorningDigest(digest) {
    const dateStr = new Date().toLocaleDateString('id-ID', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    let text = `🌅 *IT Daily Digest — ${dateStr}*\n`;
    text += `━━━━━━━━━━━━━━━━━\n\n`;

    if (digest.github.length > 0) {
        text += `🔥 *GitHub Trending*\n`;
        digest.github.slice(0, 3).forEach((r, i) => {
            text += `${i + 1}. *${r.name}*`;
            if (r.language !== 'Unknown') text += ` (${r.language})`;
            text += ` ⭐${r.stars}\n   ${r.description.substring(0, 80)}\n`;
        });
        text += '\n';
    }

    if (digest.hackernews.length > 0) {
        text += `📰 *HackerNews Top*\n`;
        digest.hackernews.slice(0, 3).forEach((r, i) => {
            text += `${i + 1}. *${r.title.substring(0, 60)}*\n`;
            text += `   ⬆️${r.score} 💬${r.comments}\n`;
        });
        text += '\n';
    }

    if (digest.devto.length > 0) {
        text += `📝 *Dev.to*\n`;
        digest.devto.slice(0, 2).forEach((r, i) => {
            text += `${i + 1}. *${r.title.substring(0, 60)}*\n`;
            text += `   ❤️${r.positiveReactions} ⏱${r.readingTime}min\n`;
        });
        text += '\n';
    }

    if (digest.arxiv.length > 0) {
        text += `📄 *ArXiv Papers*\n`;
        digest.arxiv.forEach((r, i) => {
            text += `${i + 1}. ${r.title.substring(0, 60)}...\n`;
        });
        text += '\n';
    }

    text += `━━━━━━━━━━━━━━━━━\n`;
    text += `_Ketik /it hari ini untuk lihat selengkapnya_`;
    return text;
}

/**
 * Fetch a specific IT content type
 */
export async function fetchContentByType(type, options = {}) {
    switch (type) {
        case 'github':
            return fetchGitHubTrending(options.lang, options.since);
        case 'devto':
            return fetchDevToArticles(options.tag, options.limit);
        case 'hackernews':
            return fetchHackerNewsTop(options.limit || 5);
        case 'hnshow':
            return fetchHackerNewsShow(options.limit || 3);
        case 'arxiv':
            return fetchArxivPapers(options.category || 'cs.AI', options.limit || 3);
        default:
            return [];
    }
}

export function formatContentByType(type, data) {
    switch (type) {
        case 'github':
            return formatGitHubTrending(data);
        case 'devto':
            return formatDevToArticles(data);
        case 'hackernews':
            return formatHackerNews(data);
        case 'arxiv':
            return formatArxivPapers(data);
        default:
            return JSON.stringify(data, null, 2);
    }
}

// ─── SOURCE INFO ───

export const CONTENT_SOURCES = {
    github: {
        name: 'GitHub Trending',
        emoji: '🔥',
        description: 'Repositori populer di GitHub',
        schedules: ['08:00', '18:00'],
    },
    hackernews: {
        name: 'HackerNews',
        emoji: '📰',
        description: 'Tech news global dari Y Combinator',
        schedules: ['09:00', '15:00'],
    },
    devto: {
        name: 'Dev.to',
        emoji: '📝',
        description: 'Artikel dari developer community',
        schedules: ['10:00', '20:00'],
    },
    arxiv: {
        name: 'arXiv Papers',
        emoji: '📄',
        description: 'Paper CS/AI terbaru',
        schedules: ['07:00'],
    },
};
