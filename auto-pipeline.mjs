import { initDatabase, getSetting } from './src/services/db.js';
import { pickBestTrending } from './src/services/trending.js';
import { generateVideo, cleanup } from './src/services/videoGenerator.js';
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

const STOCK_DIR = '/home/thirty/bot-wa/stock-videos';
const LOCK_FILE = '/tmp/auto-pipeline.lock';
const LOG_FILE = '/tmp/auto-pipeline.log';
const API_URL = 'http://localhost:6789';
const STALE_LOCK_MS = parseInt(process.env.AUTO_PIPELINE_STALE_LOCK_MS || String(2 * 60 * 60 * 1000), 10);

function readLockMeta() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  const now = Date.now();
  const lockMeta = { pid: process.pid, startedAt: now };

  try {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeFileSync(fd, JSON.stringify(lockMeta));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  const current = readLockMeta();
  const startedAt = current?.startedAt || 0;
  const age = now - startedAt;
  const running = isProcessAlive(current?.pid);

  if (running && age < STALE_LOCK_MS) {
    console.log('Pipeline still running by PID ' + current.pid + ', skipping');
    return false;
  }

  try { fs.unlinkSync(LOCK_FILE); } catch {}

  try {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeFileSync(fd, JSON.stringify(lockMeta));
    fs.closeSync(fd);
    return true;
  } catch {
    console.log('Lock race detected, skipping');
    return false;
  }
}

if (!acquireLock()) {
  process.exit(0);
}

function log(msg) {
  const line = '[' + new Date().toISOString().slice(11, 19) + '] ' + msg;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function runFF(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 200 * 1024 * 1024 }, (err) => {
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function genThumbnail(videoPath, thumbPath) {
  await runFF([
    '-i', videoPath,
    '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
    '-frames:v', '1', '-q:v', '5',
    '-y', thumbPath
  ]);
  return fs.existsSync(thumbPath);
}

async function main() {
  const start = Date.now();
  log('Pipeline started');
  fs.mkdirSync(STOCK_DIR, { recursive: true });

  try {
    await initDatabase();

    const trending = await pickBestTrending();
    const topic = trending.topic;
    const tags = trending.hashtags || [];
    log('Picked: ' + topic + ' (source: ' + trending.source + ')');

    log('Generating video...');
    const genResult = await generateVideo(topic, (msg) => {
      log(msg);
    });

    if (!genResult || !genResult.outputPath || !fs.existsSync(genResult.outputPath)) {
      throw new Error('Video generation failed - no output file');
    }

    log('Generated: ' + genResult.title);
    const sourceSize = fs.statSync(genResult.outputPath).size;

    const safeName = topic.replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '_' + Date.now().toString(36);
    const finalVideoPath = path.join(STOCK_DIR, safeName + '.mp4');
    const thumbnailPath = path.join(STOCK_DIR, safeName + '.jpg');

    fs.copyFileSync(genResult.outputPath, finalVideoPath);
    log('Copied to: ' + finalVideoPath);

    log('Generating thumbnail...');
    const thumbOk = await genThumbnail(finalVideoPath, thumbnailPath);
    log('Thumbnail ' + (thumbOk ? 'OK' : 'failed') + ': ' + thumbnailPath);

    // Create via bot API so in-memory DB stays in sync
    const token = getSetting('dashboard_token');
    const resp = await fetch(API_URL + '/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        topic: genResult.title || topic,
        caption: genResult.title || topic,
        tags: tags,
        videoPath: finalVideoPath,
        thumbnailPath: thumbOk ? thumbnailPath : '',
        videoSize: sourceSize,
        trendSource: trending.source || 'auto',
      })
    });
    const result = resp.ok ? await resp.json() : null;

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    if (result && result.id) {
      log('SUCCESS! Stock #' + result.id + ' saved (' + elapsed + 's, ' + (sourceSize / 1024 / 1024).toFixed(1) + 'MB)');
    } else {
      throw new Error('Failed to save stock via API');
    }

    if (genResult.workDir) cleanup(genResult.workDir);

  } catch (err) {
    log('FAILED: ' + (err.message || err));
    console.error(err);
    process.exit(1);
  } finally {
    if (fs.existsSync(LOCK_FILE)) {
      const current = readLockMeta();
      if (!current || current.pid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  }
}

main();
