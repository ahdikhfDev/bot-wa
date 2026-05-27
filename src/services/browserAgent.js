import { searchWeb } from './search.js';
import { getGroqClient, recordTokenUsage } from './ai.js';
import * as cheerio from 'cheerio';
import { log, error } from '../utils/logger.js';

/**
 * Run a lightweight browser agent using search + fetch (no Playwright/Chromium)
 * @param {string} task The user's request
 * @param {function} onUpdate Callback for progress updates
 * @returns {Promise<string>} The final result
 */
export async function runBrowserAgent(task, onUpdate = () => {}) {
    log(`Running search agent for: ${task}`);
    await onUpdate(`🔍 *Mencari informasi:* \"${task}\"...`);

    try {
        // Step 1: Search the web
        const searchResult = await searchWeb(task);
        if (!searchResult || !searchResult.items || searchResult.items.length === 0) {
            return `❌ Gak nemu hasil untuk \"${task}\". Coba dengan kata kunci lain.`;
        }

        log(`Found ${searchResult.items.length} results, fetching content...`);

        // Step 2: Fetch content from top results
        const results = [];
        const topItems = searchResult.items.slice(0, 3);

        for (const item of topItems) {
            await onUpdate(`📄 *Membaca:* ${item.title.substring(0, 50)}...`);
            try {
                const r = await fetch(item.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml',
                    },
                    signal: AbortSignal.timeout(10000),
                });
                const html = await r.text();
                const $ = cheerio.load(html);

                // Extract meaningful text
                const paragraphs = [];
                $('p, h1, h2, h3, h4, li:not(.b_ans li), td, th, article, .content, .article, main').each((i, el) => {
                    const text = $(el).text().trim();
                    if (text.length > 30) paragraphs.push(text);
                });

                const content = paragraphs.slice(0, 30).join('\n').substring(0, 3000);
                results.push({ title: item.title, url: item.url, content: content || item.snippet });
            } catch (e) {
                // Fallback to snippet if fetch fails
                results.push({ title: item.title, url: item.url, content: item.snippet });
            }
        }

        // Step 3: AI synthesis
        await onUpdate(`🧠 *Menganalisis hasil pencarian...*`);

        const groq = getGroqClient();
        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah asisten riset web. Tugasmu adalah menjawab pertanyaan user berdasarkan hasil pencarian web yang diberikan.

ATURAN:
- Jawab dengan bahasa Indonesia santai dan informatif
- Sertakan sumber URL agar user bisa klik sendiri
- Jika hasil tidak cukup, bilang aja dengan jujur
- Jangan menambahkan informasi yang tidak ada di sumber
- Format rapi dengan emoji secukupnya

Format jawaban:
📌 *[Kesimpulan singkat]*

[Penjelasan detail]

📚 *Sumber:* 
• [Judul 1](URL 1)
• [Judul 2](URL 2)`
                },
                {
                    role: 'user',
                    content: `Tugas user: "${task}"\n\nHasil pencarian dari web:\n\n${results.map((r, i) =>
                        `[${i + 1}] ${r.title}\nURL: ${r.url}\nKonten: ${r.content.substring(0, 1500)}`
                    ).join('\n\n---\n\n')}\n\nBuat jawaban berdasarkan hasil di atas.`
                }
            ],
            max_tokens: 1024,
            temperature: 0.4,
        });

        if (completion.usage) {
            recordTokenUsage(completion.usage.prompt_tokens, completion.usage.completion_tokens, 'llama-3.3-70b-versatile');
        }

        const answer = completion.choices[0]?.message?.content;
        if (!answer) {
            // Fallback: format as simple list
            return `📌 *Hasil Pencarian: ${task}*\n\n${results.map((r, i) =>
                `${i + 1}. *${r.title}*\n${r.content.substring(0, 200)}...\n🔗 ${r.url}`
            ).join('\n\n')}`;
        }

        return answer;
    } catch (err) {
        error('Browser Agent Error:', err.message);
        return `❌ *Browser Agent Error:* ${err.message}\n\nCoba lagi nanti atau pake /search aja dulu.`;
    }
}
