import { getStocks, getSetting } from './db.js';

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

const FALLBACK_TOPICS = [
  { topic: 'Fakta unik sehari-hari', hashtags: ['#faktaunik', '#fyp', '#viral', '#edukasi'] },
  { topic: 'Tips produktif di pagi hari', hashtags: ['#tips', '#produktif', '#fyp', '#motivasi'] },
  { topic: 'Kata kata bijak kehidupan', hashtags: ['#katabijak', '#fyp', '#viral', '#kehidupan'] },
  { topic: 'Makanan khas Indonesia', hashtags: ['#kuliner', '#indonesia', '#fyp', '#makanan'] },
  { topic: 'Teknologi AI terkini', hashtags: ['#AI', '#teknologi', '#fyp', '#viral'] },
  { topic: 'Fenomena alam unik', hashtags: ['#alam', '#fenomena', '#fyp', '#edukasi'] },
  { topic: 'Sejarah singkat Indonesia', hashtags: ['#sejarah', '#indonesia', '#fyp', '#edukasi'] },
  { topic: 'Cara menghemat uang', hashtags: ['#keuangan', '#tips', '#fyp', '#hemat'] },
  { topic: 'Manfaat minum air putih', hashtags: ['#kesehatan', '#tips', '#fyp', '#edukasi'] },
  { topic: 'Tempat wisata di Indonesia', hashtags: ['#wisata', '#indonesia', '#fyp', '#travel'] },
];

async function fetchGoogleTrends() {
  try {
    const resp = await fetch('https://trends.google.com/trending/rss?geo=ID', {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const topics = [];
    const titleRegex = /<title>(.+?)<\/title>/g;
    const trafficRegex = /<ht:approx_traffic>(.+?)<\/ht:approx_traffic>/g;
    const titles = [...xml.matchAll(titleRegex)].slice(1).map(m => m[1]);
    const traffics = [...xml.matchAll(trafficRegex)].map(m => m[1]);
    for (let i = 0; i < Math.min(titles.length, traffics.length); i++) {
      topics.push({
        topic: titles[i],
        hashtags: generateHashtags(titles[i]),
        source: 'google_trends',
        traffic: traffics[i],
      });
    }
    return topics.slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchTikTokTrending() {
  try {
    const resp = await fetch('https://www.tiktok.com/api/recommend/item/?aid=1988&app_language=en&device_platform=web&region=ID&count=20', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const topics = [];
    for (const item of (data.data || data.itemList || [])) {
      const desc = (item.desc || item.description || '').trim();
      if (!desc || desc.length < 5) continue;
      const hashtags = [...desc.matchAll(/#(\w+)/g)].map(m => '#' + m[1]);
      const cleanDesc = desc.replace(/#\w+/g, '').trim().substring(0, 100);
      if (cleanDesc.length > 5) {
        topics.push({
          topic: cleanDesc,
          hashtags: hashtags.length > 0 ? hashtags : generateHashtags(cleanDesc),
          source: 'tiktok',
        });
      }
    }
    return topics.slice(0, 10);
  } catch {
    return [];
  }
}

function generateHashtags(text) {
  const words = text.toLowerCase().split(/[\s,]+/).filter(w => w.length > 3).slice(0, 3);
  const tags = words.map(w => '#' + w.replace(/[^a-z0-9]/g, ''));
  tags.push('#fyp', '#viral');
  if (text.toLowerCase().includes('indonesia')) tags.push('#indonesia');
  if (text.toLowerCase().includes('unik') || text.toLowerCase().includes('fakta')) tags.push('#faktaunik');
  if (text.toLowerCase().includes('tips') || text.toLowerCase().includes('cara')) tags.push('#tips');
  return [...new Set(tags)];
}

function randomFromFallback() {
  const idx = Math.floor(Math.random() * FALLBACK_TOPICS.length);
  return { ...FALLBACK_TOPICS[idx], source: 'fallback' };
}

export async function getTrendingTopics(refresh = false) {
  if (!refresh && _cache && Date.now() - _cacheTime < CACHE_TTL) {
    return _cache;
  }

  const [googleTrends, tiktokTrends] = await Promise.all([
    fetchGoogleTrends(),
    fetchTikTokTrending(),
  ]);

  let topics = [...googleTrends, ...tiktokTrends];

  // Filter out already used topics (check last 20 stocks)
  try {
    const usedTopics = getStocks(20).map(s => s.topic.toLowerCase());
    topics = topics.filter(t => !usedTopics.some(u => t.topic.toLowerCase().includes(u) || u.includes(t.topic.toLowerCase())));
  } catch {}

  // If empty, add fallback
  if (topics.length === 0) {
    topics = [randomFromFallback()];
  }

  // Shuffle and deduplicate
  topics = topics.sort(() => Math.random() - 0.5)
    .filter((t, i, arr) => arr.findIndex(a => a.topic === t.topic) === i)
    .slice(0, 10);

  _cache = topics;
  _cacheTime = Date.now();
  return topics;
}

export async function pickBestTrending() {
  return randomFromFallback();
}
