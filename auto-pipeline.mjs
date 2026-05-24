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

if (fs.existsSync(LOCK_FILE)) {
  const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
  if (age < 7200000) {
    console.log('Pipeline still running, skipping');
    process.exit(0);
  }
  fs.unlinkSync(LOCK_FILE);
}
fs.writeFileSync(LOCK_FILE, String(Date.now()));

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
    log('Picked:   + topic +   (source: ' + trending.source + ')');

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
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  }
}

main();
