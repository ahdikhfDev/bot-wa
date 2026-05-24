import { chromium } from 'playwright';
import { getSetting, setSetting } from './db.js';
import path from 'path';

const COOKIES_KEY = 'tiktok_cookies';
const BROWSER_PATH = '/home/thirty/.cache/ms-playwright/chromium-1091/chrome-linux/chrome';
const LAUNCH_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--no-first-run', '--no-zygote',
  '--disable-accelerated-2d-canvas', '--single-process',
];

let _loginPage = null;
let _loginBrowser = null;
let _loginQRBase64 = null;

async function launchBrowser(retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await chromium.launch({
        executablePath: BROWSER_PATH, headless: true, args: LAUNCH_ARGS, timeout: 60000,
      });
    } catch (err) {
      if (i === retries) throw err;
    }
  }
}

async function newPage(browser) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await page.addInitScript(() => { window.__ = window.__ || ((s) => s || ''); });
  return page;
}

export async function closeBrowser(browser) {
  if (browser) {
    try { await browser.close(); } catch {}
  }
}

export async function saveCookies(page) {
  const cookies = await page.context().cookies();
  setSetting(COOKIES_KEY, JSON.stringify(cookies));
}

export async function loadCookies(page) {
  const raw = getSetting(COOKIES_KEY);
  if (raw) {
    try {
      const cookies = JSON.parse(raw);
      await page.context().addCookies(cookies);
      return true;
    } catch { return false; }
  }
  return false;
}

export function hasCookies() {
  return !!getSetting(COOKIES_KEY);
}

export function importCookies(input) {
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      setSetting(COOKIES_KEY, input);
      return true;
    }
    return false;
  } catch {}

  try {
    const lines = input.trim().split('\n');
    if (lines.length < 2) return false;
    const cookies = [];
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 4) continue;
      const [name, value, domain, path, expires, size, httpOnly, secure, sameSite] = parts;
      const cookie = { name, value, domain, path };
      cookie.httpOnly = httpOnly === '\u2713';
      cookie.secure = secure === '\u2713';
      if (sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None') {
        cookie.sameSite = sameSite;
      }
      if (expires && expires !== 'Session') {
        cookie.expires = Math.floor(new Date(expires).getTime() / 1000);
      }
      cookies.push(cookie);
    }
    if (cookies.length === 0) return false;
    setSetting(COOKIES_KEY, JSON.stringify(cookies));
    return true;
  } catch {}
  return false;
}

export function deleteCookies() {
  setSetting(COOKIES_KEY, '');
}

export async function startWebLogin() {
  if (_loginPage) {
    try { await _loginPage.close(); } catch {}
    _loginPage = null;
  }
  if (_loginBrowser) {
    try { await _loginBrowser.close(); } catch {}
    _loginBrowser = null;
  }
  _loginQRBase64 = null;

  const browser = await launchBrowser();
  const page = await newPage(browser);

  try {
    await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('text=Use QR code', { timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.locator('text=Use QR code').first().click({ timeout: 10000 });
    await page.waitForTimeout(3000);
    if (!page.url().includes('qrcode')) {
      await page.locator('[role="link"], [role="button"]').filter({ hasText: /QR/i }).first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  } catch {}

  try {
    const dataUrl = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (c && c.width > 50) return c.toDataURL('image/png');
      return null;
    });
    if (dataUrl) {
      _loginQRBase64 = dataUrl;
    } else {
      const tmpPath = '/tmp/tiktok-qr-web.png';
      await page.screenshot({ path: tmpPath });
      const fs = await import('fs');
      const buf = fs.readFileSync(tmpPath);
      _loginQRBase64 = `data:image/png;base64,${buf.toString('base64')}`;
      fs.unlinkSync(tmpPath);
    }
  } catch {}

  _loginPage = page;
  _loginBrowser = browser;
  return { qrBase64: _loginQRBase64 };
}

export function getWebLoginStatus() {
  if (!_loginPage) return { status: 'not_started' };
  try {
    const url = _loginPage.url();
    if (!url.includes('login') && !url.includes('qrcode')) {
      return { status: 'completed' };
    }
    return { status: 'waiting' };
  } catch {
    return { status: 'error' };
  }
}

export function closeWebLogin() {
  if (_loginPage) {
    try { _loginPage.close(); } catch {}
    _loginPage = null;
  }
  if (_loginBrowser) {
    try { _loginBrowser.close(); } catch {}
    _loginBrowser = null;
  }
  _loginQRBase64 = null;
}

export async function waitForLogin(page) {
  for (let i = 0; i < 120; i++) {
    const url = page.url();
    if (!url.includes('login') && !url.includes('qrcode')) {
      await saveCookies(page);
      return true;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

export async function uploadVideo(filePath, caption = '') {
  let browser, page;
  try {
    browser = await launchBrowser();
    page = await newPage(browser);
    const cookiesLoaded = await loadCookies(page);
    if (!cookiesLoaded) {
      await page.close();
      return { error: 'Belum login TikTok. Kirim /logintiktok dulu.', browser };
    }

    await page.goto('https://www.tiktok.com/creator-center/upload?lang=en', {
      waitUntil: 'load', timeout: 60000
    });

    let rootLen = 0;
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(5000);
      try {
        rootLen = await page.evaluate(() => document.querySelector('#root')?.innerHTML?.length || 0);
        if (rootLen > 40000) break;
      } catch {}
    }

    if (rootLen < 1000) {
      await page.close();
      return { error: 'Gagal memuat halaman TikTok Studio.', browser };
    }

    if (page.url().includes('login')) {
      await page.close();
      return { error: 'Sesi TikTok expired. Kirim /logintiktok untuk login ulang.', browser };
    }

    let fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() === 0) {
      await page.evaluate(() => {
        const btn = document.querySelector("[data-tt*='UploadEntrance_WideButton'], [data-tt*='UploadEntrance_Button']");
        if (btn) btn.click();
      });
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(5000);
        fileInput = page.locator('input[type="file"]');
        if (await fileInput.count() > 0) break;
      }
    }

    if (await fileInput.count() === 0) {
      await page.close();
      return { error: 'Tidak dapat menemukan upload area.', browser };
    }

    const absolutePath = path.resolve(filePath);
    await fileInput.setInputFiles(absolutePath);
    await page.waitForTimeout(5000);

    try {
      await page.waitForFunction(() => {
        const p = document.querySelector('[class*="progress"], [class*="uploading"]');
        if (!p) return true;
        return p.getAttribute('data-percent') === '100' || !p.isConnected;
      }, { timeout: 120000 });
    } catch {}

    // Wait for video processing to finish
    await page.waitForTimeout(8000);

    // Dismiss ALL floating overlays/modals/tours
    for (let attempt = 0; attempt < 3; attempt++) {
      // Dismiss content check modal
      try {
        const cancelBtns = page.locator('button').filter({ hasText: /Cancel|Got it|Skip/i });
        if (await cancelBtns.count() > 0) await cancelBtns.first().click({ timeout: 2000 });
      } catch {}
      await page.waitForTimeout(1000);

      // Remove overlays via DOM
      try {
        await page.evaluate(() => {
          document.querySelectorAll('.react-joyride__overlay, .react-joyride__spotlight, [class*="common-modal"], [data-floating-ui-portal], [class*="TUXModal"]').forEach(el => el.remove());
        });
      } catch {}
      await page.waitForTimeout(500);

      // Escape
      try { await page.keyboard.press('Escape', { timeout: 1000 }); } catch {}
      await page.waitForTimeout(500);
    }

    await page.waitForTimeout(2000);

    // Type caption
    const captionArea = page.locator('[contenteditable="true"]').first();
    if (await captionArea.count() > 0) {
      await captionArea.click();
      await captionArea.evaluate(el => el.innerHTML = '');
      await page.waitForTimeout(300);
      await captionArea.fill(caption);
    }

    // Wait for video processing to complete (cover loaded)
    try {
      await page.waitForFunction(() => {
        const body = document.body.innerText;
        if (body.includes('We hit a snag') || body.includes('Your video failed') || body.includes('Something went wrong')) return true;
        const noCover = !body.includes('Cover');
        if (noCover) return !!document.querySelector('button[data-e2e="post_video_button"]');
        const stillLoading = body.includes('Loading...') || body.includes('Processing');
        return !stillLoading;
      }, { timeout: 120000 });
    } catch {}
    await page.waitForTimeout(3000);

    // Click Post button using data-e2e attribute
    const postBtn = page.locator('button[data-e2e="post_video_button"]');
    await postBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(1000);
    await postBtn.click({ timeout: 10000 }).catch(async () => {
      await postBtn.dispatchEvent('click');
    });

    // Wait for posting to complete  
    await page.waitForTimeout(8000);
    let success = false;

    // Check if Post button changed to non-clickable state or disappeared
    for (let i = 0; i < 60; i++) {
      const btnDisabled = await page.evaluate(() => {
        const btn = document.querySelector('button[data-e2e="post_video_button"]');
        if (!btn) return 'gone';
        if (btn.getAttribute('aria-disabled') === 'true') return 'disabled';
        if (btn.textContent?.includes('Processing') || btn.textContent?.includes('Posting')) return 'posting';
        return 'active';
      }).catch(() => 'error');
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (btnDisabled === 'gone') { success = true; break; }
      if (bodyText.includes('Video posted') || bodyText.includes('Posted successfully') || bodyText.includes('Scheduled')) { success = true; break; }
      if (bodyText.includes('We hit a snag') || bodyText.includes('Something went wrong') || bodyText.includes('Your video failed')) break;
      await page.waitForTimeout(2000);
    }

    await page.close();
    return { success, browser };
  } catch (err) {
    try { await page.close(); } catch {}
    return { error: err.message, browser };
  }
}

export async function loginWithPassword(email, password) {
  let browser, page;
  try {
    browser = await launchBrowser();
    page = await newPage(browser);

    await page.goto('https://www.tiktok.com/login', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    const hasPhoneEmail = await page.locator('text=Use phone / email / username').count();
    if (hasPhoneEmail > 0) {
      await page.locator('text=Use phone / email / username').first().click();
      await page.waitForTimeout(2000);
    }

    const emailInput = page.locator('input[name="username"], input[type="text"][placeholder*="email"], input[placeholder*="Username"], input[placeholder*="Phone"]');
    await emailInput.first().waitFor({ timeout: 10000 });
    await emailInput.first().click();
    await emailInput.first().fill(email);
    await page.waitForTimeout(1000);

    const passInput = page.locator('input[type="password"], input[name="password"]');
    await passInput.first().waitFor({ timeout: 5000 });
    await passInput.first().fill(password);
    await page.waitForTimeout(1500);

    const loginBtn = page.locator('button[type="submit"], button:has-text("Log in")').first();
    if (await loginBtn.count() > 0) {
      await loginBtn.evaluate(btn => btn.click());
      await page.waitForTimeout(3000);
      if (page.url().includes('/login')) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    }

    await page.waitForTimeout(5000);

    for (let i = 0; i < 30; i++) {
      const url = page.url();
      if (!url.includes('/login')) {
        await saveCookies(page);
        await page.close();
        return { success: true };
      }
      await page.waitForTimeout(2000);
    }

    await page.close();
    return { error: 'Gagal login. Cek email/password atau mungkin perlu verifikasi 2FA.' };
  } catch (err) {
    try { await page.close(); } catch {}
    return { error: err.message };
  }
}
