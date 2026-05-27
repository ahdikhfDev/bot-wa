import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { log, error } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Find Chromium binary from Playwright cache or env
 */
async function findChromiumPath() {
    const envPath = process.env.CHROME_PATH;
    if (envPath) return envPath;

    const home = os.homedir();
    const cacheDir = path.join(home, '.cache', 'ms-playwright');

    // Known chromium paths
    const candidates = [
        path.join(cacheDir, 'chromium-1223', 'chrome-linux', 'chrome'),
        path.join(cacheDir, 'chromium_headless_shell-1223', 'chrome-linux', 'chrome'),
    ];

    for (const p of candidates) {
        try {
            await fs.access(p, fs.constants.X_OK);
            return p;
        } catch { /* not found */ }
    }

    // Fallback: scan cache directory
    try {
        const entries = await fs.readdir(cacheDir);
        for (const entry of entries) {
            if (entry.startsWith('chromium-')) {
                const chromePath = path.join(cacheDir, entry, 'chrome-linux', 'chrome');
                try {
                    await fs.access(chromePath, fs.constants.X_OK);
                    return chromePath;
                } catch { /* not executable */ }
            }
        }
    } catch { /* cache dir not found */ }

    // Last resort fallback
    return 'chromium-browser';
}

/**
 * Take a screenshot of a URL using headless Chromium binary (no Playwright)
 * @param {string} url
 * @param {object} options
 * @returns {Promise<Buffer>}
 */
export async function takeScreenshot(url, options = {}) {
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }

    log(`Taking screenshot of ${url} via Chromium binary...`);

    const chromePath = await findChromiumPath();
    const outputPath = path.join(os.tmpdir(), `ss_${Date.now()}.png`);

    const args = [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--hide-scrollbars',
        `--screenshot=${outputPath}`,
        `--window-size=${options.width || 1280},${options.height || 720}`,
        url,
    ];

    try {
        await execFileAsync(chromePath, args, {
            timeout: 30000,
            maxBuffer: 50 * 1024 * 1024,
        });

        const buffer = await fs.readFile(outputPath);
        await fs.unlink(outputPath).catch(() => {});
        log(`Screenshot done: ${buffer.length} bytes`);
        return buffer;
    } catch (err) {
        error(`Screenshot error for ${url}:`, err.message);
        // Cleanup on error
        await fs.unlink(outputPath).catch(() => {});
        throw new Error(`Gagal screenshot: ${err.message}`);
    }
}
