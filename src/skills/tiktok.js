import { hasCookies, uploadVideo, startWebLogin, loginWithPassword, closeBrowser, closeWebLogin } from '../services/tiktok.js';
import fs from 'fs';
import path from 'path';

export default {
  name: 'tiktok',
  title: 'TikTok Upload',
  description: 'Upload video ke TikTok via /tt [caption]',
  commands: ['tt', 'tiktok', 'logintiktok', 'login-tiktok', 'logintiktok-pass', 'login-tiktok-pass'],

  async handler(sock, remoteJid, args, context) {
    const cmd = context.command;

    // Login command
    if (['logintiktok', 'login-tiktok', 'login'].includes(cmd)) {
      console.log('[TIKTOK] Starting login flow...');
      await sock.sendMessage(remoteJid, { text: 'Buka halaman login TikTok...' });

      console.log('[TIKTOK] Calling startWebLogin...');
      const result = await startWebLogin();
      console.log('[TIKTOK] startWebLogin returned:', Object.keys(result));

      if (!result.qrBase64) {
        console.log('[TIKTOK] No QR code returned');
        await sock.sendMessage(remoteJid, { text: 'Gagal mendapatkan QR code.' });
        return;
      }

      // Convert base64 to file
      const tmpPath = '/tmp/tiktok-qr-skill.png';
      const base64 = result.qrBase64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'));

      await sock.sendMessage(remoteJid, {
        image: fs.readFileSync(tmpPath),
        caption: 'Scan QR ini pake kamera TikTok kamu',
      });
      try { fs.unlinkSync(tmpPath); } catch {}

      await sock.sendMessage(remoteJid, {
        text: 'Setelah scan, bot nunggu login (maks 2 menit)...',
      });

      // Check login status (injected via getWebLoginStatus)
      const loggedIn = await waitForLoginFromService();
      if (loggedIn) {
        await sock.sendMessage(remoteJid, { text: 'Login TikTok berhasil! Upload video via /tt [caption]' });
      } else {
        await sock.sendMessage(remoteJid, { text: 'Waktu habis. Kirim /logintiktok lagi.' });
      }

      closeWebLogin();
      return;
    }

    
    // Login with email/password
    if (['logintiktok-pass', 'login-tiktok-pass'].includes(cmd)) {
      const parts = args.join(' ').split(/' '/);
      const email = parts[0] || '';
      const password = parts.slice(1).join(' ') || '';
      if (!email || !password) {
        await sock.sendMessage(remoteJid, { text: 'Gunakan: /logintiktok-pass email@example.com password' });
        return;
      }
      await sock.sendMessage(remoteJid, { text: 'Login TikTok dengan email/password...' });
      const result = await loginWithPassword(email, password);
      if (result.error) {
        await sock.sendMessage(remoteJid, { text: `Gagal login: ${result.error}` });
      } else {
        await sock.sendMessage(remoteJid, { text: 'Login TikTok berhasil! Upload video via /tt [caption]' });
      }
      return;
    }
    
    // Upload command: /tt or /tiktok
    if (!hasCookies()) {
      await sock.sendMessage(remoteJid, { text: 'Belum login TikTok. Kirim /logintiktok dulu.' });
      return;
    }

    const caption = args.join(' ') || '';

    let videoPath = null;
    for (const arg of args) {
      if (fs.existsSync(arg)) {
        videoPath = arg;
        break;
      }
    }

    if (!videoPath) {
      const lastVideo = global.last_video_path;
      if (lastVideo && fs.existsSync(lastVideo)) {
        videoPath = lastVideo;
      } else {
        const tmpDir = '/tmp';
        const files = fs.readdirSync(tmpDir)
          .filter(f => f.endsWith('.mp4') && f.startsWith('thirty-video'))
          .sort()
          .reverse();
        if (files.length > 0) {
          videoPath = path.join(tmpDir, files[0]);
        }
      }
    }

    if (!videoPath || !fs.existsSync(videoPath)) {
      await sock.sendMessage(remoteJid, { text: 'Tidak ada video. Bikin dulu pake /buatvideo.' });
      return;
    }

    await sock.sendMessage(remoteJid, {
      text: `Upload video ke TikTok...\nFile: ${path.basename(videoPath)}\nCaption: ${caption || '(kosong)'}\nIni bisa sampai 2 menit...`,
    });

    const result = await uploadVideo(videoPath, caption);

    if (result.error) {
      await sock.sendMessage(remoteJid, { text: `Gagal upload: ${result.error}` });
    } else if (result.success) {
      await sock.sendMessage(remoteJid, { text: 'Video berhasil diupload ke TikTok!' });
    } else {
      await sock.sendMessage(remoteJid, { text: 'Upload selesai, cek TikTok kamu untuk status.' });
    }

    await closeBrowser(result.browser);
  },
};

async function waitForLoginFromService() {
  // Poll getWebLoginStatus until completed or timeout
  const { getWebLoginStatus } = await import('../services/tiktok.js');
  for (let i = 0; i < 120; i++) {
    const status = getWebLoginStatus();
    if (status.status === 'completed') return true;
    if (status.status === 'error' || status.status === 'not_started') return false;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}
