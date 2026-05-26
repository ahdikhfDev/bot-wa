import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { log, error } from '../utils/logger.js';

/**
 * Take a screenshot of a URL
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<Buffer>}
 */
export async function takeScreenshot(url, options = {}) {
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }

    log(`Browsing to ${url} for screenshot...`);
    
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Critical for some Linux environments
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // Navigate with a reasonable timeout
        await page.goto(url, { 
            waitUntil: 'networkidle', 
            timeout: 60000 
        });

        // Optional: Wait for a bit more if it's a heavy JS site
        await page.waitForTimeout(2000);
        
        const tempPath = path.join(process.cwd(), `temp_ss_${Date.now()}.png`);
        await page.screenshot({ 
            path: tempPath, 
            fullPage: !!options.fullPage 
        });
        
        const buffer = await fs.readFile(tempPath);
        await fs.unlink(tempPath).catch(() => {});
        
        return buffer;
    } catch (err) {
        error(`Screenshot error for ${url}:`, err.message);
        throw err;
    } finally {
        await browser.close();
    }
}
