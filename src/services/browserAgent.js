import { chromium } from 'playwright';
import { getGroqClient, recordTokenUsage } from './ai.js';
import { log, error } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const LAUNCH_ARGS = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--no-first-run', '--no-zygote',
    '--disable-accelerated-2d-canvas', '--single-process',
];

const MAX_STEPS = 10;

async function launchBrowser(retries = 2) {
    const executablePath = process.env.CHROME_PATH || undefined;
    for (let i = 0; i <= retries; i++) {
        try {
            return await chromium.launch({
                executablePath,
                headless: true,
                args: LAUNCH_ARGS,
                timeout: 60000,
            });
        } catch (err) {
            if (i === retries) throw err;
            log(`Retrying browser launch (${i + 1}/${retries})...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

/**
 * Run a browser agent to perform a task
 * @param {string} task The user's request
 * @param {function} onUpdate Callback for progress updates
 * @returns {Promise<string>} The final result
 */
export async function runBrowserAgent(task, onUpdate = () => {}) {
    log(`Starting browser agent for task: ${task}`);
    
    let browser;
    try {
        browser = await launchBrowser();

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            deviceScaleFactor: 1,
            hasTouch: false,
            isMobile: false,
            javaScriptEnabled: true,
            locale: 'id-ID',
            timezoneId: 'Asia/Jakarta',
            extraHTTPHeaders: {
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Upgrade-Insecure-Requests': '1',
            }
        });

        const page = await context.newPage();
        let currentStep = 0;
        let history = [];
        let lastResult = null;

        // Default to google if no URL is detected in task
        try {
            await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (err) {
            log(`Initial navigation warning: ${err.message}`);
        }

        let extractedData = null;

        while (currentStep < MAX_STEPS) {
            currentStep++;
            await onUpdate(`🔍 *Langkah ${currentStep}/${MAX_STEPS}*: Menganalisis tampilan...`);

            // Wait for any animations to settle
            await page.waitForTimeout(1500);

            // Take screenshot
            const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 90 });
            const base64Image = screenshotBuffer.toString('base64');

            // Call Vision AI
            const action = await getNextAction(task, base64Image, history, extractedData);
            log(`Agent Action: ${JSON.stringify(action)}`);

            if (!action || !action.action) {
                throw new Error("AI tidak memberikan aksi yang valid.");
            }

            history.push({ step: currentStep, action });

            if (action.action === 'done') {
                lastResult = action.params.answer || action.params.result || action.reason;
                break;
            }

            // Execute action
            if (action.action === 'extract') {
                onUpdate(`⚙️ Mengeksekusi: ${action.reason}`);
                extractedData = await page.evaluate(() => document.body.innerText.substring(0, 5000));
                log(`Extracted ${extractedData.length} chars`);
            } else {
                await executeAction(page, action, onUpdate);
                extractedData = null; // Reset extraction after other actions
            }
            
            // Wait for navigation or content load
            try {
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            } catch {}
        }

        if (currentStep >= MAX_STEPS && !lastResult) {
            lastResult = "Maaf, tugas terlalu kompleks dan mencapai batas langkah maksimal (10 langkah).";
        }

        return lastResult;
    } catch (err) {
        error(`Browser Agent Error:`, err);
        return `Terjadi kesalahan saat menjalankan browser agent: ${err.message}`;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

async function getNextAction(task, base64Image, history, extractedData) {
    const groq = getGroqClient();
    
    const systemPrompt = `Kamu adalah Browser Agent yang bertugas membantu user melakukan tugas di web.
Kamu melihat screenshot halaman browser (1280x720).

TUGAS USER: "${task}"

RIWAYAT AKSI:
${history.map(h => `- Langkah ${h.step}: ${h.action.reason}`).join('\n') || 'Belum ada aksi.'}

${extractedData ? `DATA TEKS YANG DIEKSTRAK DARI HALAMAN INI:\n"""\n${extractedData}\n"""\n` : ''}

AKSI YANG BISA KAMU LAKUKAN:
1. {"action": "navigate", "params": {"url": "https://..."}, "reason": "..."}
2. {"action": "click", "params": {"x": 100, "y": 200}, "reason": "..."}
3. {"action": "type", "params": {"text": "...", "enter": true}, "reason": "..."}
4. {"action": "scroll", "params": {"direction": "down/up"}, "reason": "..."}
5. {"action": "extract", "params": {"description": "apa yang mau diambil"}, "reason": "..."}
6. {"action": "done", "params": {"answer": "..."}, "reason": "..."}

PENTING:
- Gunakan koordinat (x, y) yang tepat dari screenshot. x: 0-1280, y: 0-720.
- Berikan respon HANYA dalam format JSON.
- Jika sudah mendapatkan hasil akhir, gunakan aksi "done".`;

    const completion = await groq.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [
                { type: "text", text: "Apa aksi selanjutnya untuk menyelesaikan tugas?" },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ] }
        ],
        temperature: 0.1, // Low temperature for consistent JSON
        response_format: { type: "json_object" }
    });

    const response = completion.choices[0]?.message?.content;
    if (completion.usage) recordTokenUsage(completion.usage.prompt_tokens, completion.usage.completion_tokens, 'meta-llama/llama-4-scout-17b-16e-instruct');

    try {
        return JSON.parse(response);
    } catch (err) {
        error("Failed to parse agent response:", response);
        // Fallback or retry logic could go here
        throw new Error("AI memberikan format respon yang tidak valid.");
    }
}

async function executeAction(page, action, onUpdate) {
    const { action: type, params, reason } = action;
    onUpdate(`⚙️ Mengeksekusi: ${reason}`);

    switch (type) {
        case 'navigate':
            let url = params.url;
            if (!url.startsWith('http')) url = 'https://' + url;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000); // Wait a bit for JS to render
            break;
        case 'click':
            await page.mouse.click(params.x, params.y);
            break;
        case 'type':
            await page.keyboard.type(params.text);
            if (params.enter !== false) {
                await page.keyboard.press('Enter');
            }
            break;
        case 'scroll':
            const amount = params.direction === 'up' ? -500 : 500;
            await page.mouse.wheel(0, amount);
            break;
        case 'extract':
            // Logic for extraction could be more complex, but for now we just let the AI "see" it in the next step
            // or we could try to extract text from the whole page and feed it back.
            log(`Extraction requested: ${params.description}`);
            break;
        default:
            throw new Error(`Aksi tidak dikenal: ${type}`);
    }
}
