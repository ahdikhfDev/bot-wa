import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { warn } from '../utils/logger.js';
import ffmpegPath from "ffmpeg-static";
import { execFile } from "child_process";
import Groq from "groq-sdk";
import { getSetting } from "./db.js";
import { getEdgeTtsBuffer, VOICES } from "./edgeTts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Script Style Prompts ───
const SCRIPT_STYLES = {
    edukasi: [
        "Kamu adalah script writer video edukatif. Buat script video tentang topik yang diminta.",
        "Output JSON dengan format:",
        '{ "title": "judul video", "scenes": [',
        '  { "narasi": "Narasi Bahasa Indonesia santai", "visual_prompt": "English visual prompt", "durasi_detik": 10 }',
        "] }",
        "Aturan:",
        "- Total: 60-90 detik (6 scene)",
        "- Scene 1: intro, 2-5: isi, 6: penutup (akhiri dengan Terimakasih sudah menonton)",
        "- narasi pake Bahasa Indonesia santai, kaya ngobrol, max 200 karakter per scene",
        "- visual_prompt: deskripsi gambar Bahasa Inggris untuk AI image generator",
        "- Output HANYA JSON, tanpa teks lain"
    ].join("\n"),

    fakta: [
        "Kamu adalah script writer video fakta unik dan menarik.",
        "Buat script video yang berisi fakta-fakta mengejutkan tentang topik yang diminta.",
        "Output JSON dengan format:",
        '{ "title": "judul video", "scenes": [',
        '  { "narasi": "Narasi Bahasa Indonesia", "visual_prompt": "English visual prompt", "durasi_detik": 10 }',
        "] }",
        "Aturan:",
        "- Total: 45-60 detik (4-5 scene)",
        "- Scene 1: intro dengan hook yang bikin penasaran, sisanya: fakta per scene",
        "- narasi pake Bahasa Indonesia santai, gaya kaya orang ngomong 'Lo tau gak sih...'",
        "- Setiap scene kasih 1-2 fakta unik yang bikin orang kaget",
        "- max 200 karakter per scene",
        "- visual_prompt: deskripsi gambar Bahasa Inggris yang mendukung fakta tersebut",
        "- Output HANYA JSON, tanpa teks lain"
    ].join("\n"),

    story: [
        "Kamu adalah penulis cerita pendek yang memukau.",
        "Buat script video story telling tentang topik yang diminta.",
        "Output JSON dengan format:",
        '{ "title": "judul cerita", "scenes": [',
        '  { "narasi": "Narasi Bahasa Indonesia", "visual_prompt": "English visual prompt", "durasi_detik": 12 }',
        "] }",
        "Aturan:",
        "- Total: 60-90 detik (5-6 scene)",
        "- Scene 1: pembukaan yang narik perhatian, 2-4: konflik/isi, 5-6: resolusi & pesan moral",
        "- narasi pake Bahasa Indonesia puitis, deskriptif, evocative — kaya dengerin storyteller",
        "- Bikin pembaca ngerasa terbawa suasana",
        "- max 250 karakter per scene",
        "- visual_prompt: deskripsi gambar Bahasa Inggris cinematic, moody, mendukung cerita",
        "- Output HANYA JSON, tanpa teks lain"
    ].join("\n"),

    quotes: [
        "Kamu adalah creative director konten quotes bijak yang viral.",
        "Buat script video quotes/kata-kata bijak tentang topik yang diminta.",
        "Output JSON dengan format:",
        '{ "title": "judul quotes", "scenes": [',
        '  { "narasi": "Kutipan bijak atau narasi inspirasional", "visual_prompt": "English visual prompt", "durasi_detik": 8 }',
        "] }",
        "Aturan:",
        "- Total: 30-45 detik (4-5 scene)",
        "- Setiap scene berisi 1 quotes bijak/poetic yang DALAM dan menyentuh",
        "- Quotes harus original, bukan kutipan terkenal",
        "- visual_prompt: deskripsi gambar Bahasa Inggris yang aesthetic, cinematic, cocok sama vibe quotes",
        "- Durasi per scene: 7-10 detik (biar orang sempet baca & resapi)",
        "- Output HANYA JSON, tanpa teks lain"
    ].join("\n"),

    // ─── KONTEN STYLES — multi-scene, viral, engaging ───
    kfakta: [
        "Kamu adalah creative content writer spesialis konten viral TikTok/Reels.",
        "Buat script konten fakta unik yang bikin orang BERHENTI SCROLL!",
        "Output JSON dengan format:",
        '{ "title": "judul video", "scenes": [',
        '  { "narasi": "Narasi Bahasa Indonesia engaging", "visual_prompt": "English visual prompt", "durasi_detik": 8 }',
        "] }",
        "Aturan:",
        "- Total: 60-90 detik (8-10 scene)",
        "- Scene 1: HOOK BESAR yang langsung narik perhatian ('Lo tau gak sih...', 'Fakta gila...', 'Yang jarang orang tau...')",
        "- Scene 2-7: 1-2 fakta unik per scene, SETIAP scene harus punya hook pembuka sendiri",
        "- Scene terakhir: OUTRO memorable, call-to-action kaya 'Follow buat konten keren lainnya!'",
        "- narasi pake Bahasa Indonesia santai BANGET, gaya ngobrol sehari-hari, pake 'lo', 'gue', 'wow', 'gila sih'",
        "- max 100-120 karakter per scene (padat, cepet, engaging)",
        "- visual_prompt: deskripsi gambar Bahasa Inggris colorful, vibrant, eye-catching, 9:16 portrait",
        "- Output HANYA JSON, tanpa teks lain"
    ].join("\n"),

    kedukasi: [
        "Kamu adalah content creator edukasi yang bikin belajar jadi SERU dan GAK MEMBOSANKAN.",
        "Buat script konten edukasi yang informatif TETAPI tetap engaging kaya konten viral.",
        "Output JSON dengan format:",
        '{ "title": "judul video", "scenes": [',
        '  { "narasi": "Narasi Bahasa Indonesia santai", "visual_prompt": "English visual prompt", "durasi_detik": 9 }',
        "] }",
        "Aturan:",
        "- Total: 60-90 detik (7-9 scene)",
        "- Scene 1: HOOK + fakta mengejutkan yang bikin orang penasaran",
        "- Scene 2-6: PUSAT INFO — jelasin konsep pake analogi seru, contoh nyata, perbandingan",
        "- Scene 7-8: KESIMPULAN — takeaway utama yang gampang diinget",
        "- Scene terakhir: OUTRO kaya 'Gimana? Mindblowing kan? Share biar temen lo pada tau!'",
        "- narasi pake Bahasa Indonesia santai, kaya guru muda yang asik ngajar",
        "- max 130 karakter per scene",
        "- visual_prompt: deskripsi gambar Bahasa Inggris yang informatif dan colorful, 9:16 portrait",
        "- Output HANYA JSON, tanpa teks lain"
    ].join("\n"),

    kstory: [
        "Kamu adalah storyteller yang bikin konten cerita pendek VIRAL.",
        "Buat script konten storytelling yang bikin orang BAWEK dan PENGEN TERUS NONTON.",
        "Output JSON dengan format:",
        '{ "title": "judul cerita", "scenes": [',
        '  { "narasi": "Narasi Bahasa Indonesia dramatis", "visual_prompt": "English visual prompt", "durasi_detik": 9 }',
        "] }",
        "Aturan:",
        "- Total: 60-90 detik (7-9 scene)",
        "- Scene 1-2: OPENING HOOK — langsung lempar konflik atau pertanyaan yang bikin penasaran",
        "- Scene 3-6: KONFLIK & KETEGANGAN — cerita naik, karakter menghadapi masalah",
        "- Scene 7-8: RESOLUSI — penyelesaian + PLOT TWIST kalo bisa",
        "- Scene terakhir: PESAN MORAL + OUTRO yang bikin orang mikir",
        "- narasi pake Bahasa Indonesia evocative, deskriptif, puitis — bikin terbawa suasana",
        "- max 150 karakter per scene",
        "- visual_prompt: deskripsi gambar Bahasa Inggris cinematic, moody, dramatic lighting, 9:16 portrait",
        "- Output HANYA JSON, tanpa teks lain"
    ].join("\n"),

    kquotes: [
        "Kamu adalah creative director konten quotes & kata-kata bijak yang VIRAL DI MEDSOS.",
        "Buat script konten quotes yang DALAM, aesthetic, dan bikin orang ngerasa.",
        "Output JSON dengan format:",
        '{ "title": "judul quotes", "scenes": [',
        '  { "narasi": "Quotes bijak Bahasa Indonesia", "visual_prompt": "English visual prompt", "durasi_detik": 8 }',
        "] }",
        "Aturan:",
        "- Total: 60-80 detik (8-10 scene)",
        "- SETIAP scene berisi 1 quotes original yang DALAM, puitis, dan menyentuh hati",
        "- Quotes HARUS ORIGINAL buatan sendiri, bukan kutipan terkenal atau platitude basi",
        "- Tema quotes sesuai topik yang diminta, variasikan dari berbagai sudut pandang",
        "- Setiap quotes harus: relatable, memorable, dan punya 'rasa'",
        "- narasi pake Bahasa Indonesia puitis, metaforis, evocative",
        "- max 80-100 karakter per scene (biar orang sempet baca & ngeresapi)",
        "- visual_prompt: deskripsi gambar Bahasa Inggris aesthetic, cinematic, minimalist atau natural, 9:16 portrait",
        "- Output HANYA JSON, tanpa teks lain"
    ].join("\n"),
};

const ROAST_PROMPT = [
    "Kamu adalah script writer video roasting yang brutal dan ngena banget.",
    "Buat script video roasting yang nyerang personalitas target secara lucu tapi sadis.",
    "Output JSON dengan format:",
    '{ "title": "judul video", "scenes": [',
    '  { "narasi": "Narasi Bahasa Indonesia", "visual_prompt": "English visual prompt", "durasi_detik": 10 }',
    "] }",
    "Aturan:",
    "- Total: 60-90 detik (6 scene)",
    "- Scene 1: intro roasting yang langsung ngena, 2-5: terusin roast makin dalem, 6: penutup yang sadis",
    "- narasi pake Bahasa Indonesia gaul, kasar, sinis, kayak standup comedy roasting on fire",
    "- GUNAKAN kata-kata kasar (anjing, bangsat, goblok, tai, dll) secara NATURAL, jangan dipaksain",
    "- max 200 karakter per scene",
    "- JANGAN nyerang fisik, ras, agama, keluarga. Roast personality, kebiasaan, sifat, tingkah laku",
    "- visual_prompt: deskripsi gambar Bahasa Inggris yang mendukung vibe roasting (karikatural, exaggerated)",
    "- Output HANYA JSON, tanpa teks lain"
].join("\n");

const MIN_VIDEO_DURATION = 60;
const TARGET_DURATION = 65;

const TMP_WORKDIR_PREFIX = "thirty-video-";
const CLEANUP_MAX_AGE_MS = parseInt(process.env.VIDEO_TMP_CLEANUP_MAX_AGE_MS || String(24 * 60 * 60 * 1000), 10);
const IMAGE_MAX_RETRIES_PER_SCENE = parseInt(process.env.VIDEO_IMAGE_MAX_RETRIES || "12", 10);
const IMAGE_RETRY_DELAY_MS = parseInt(process.env.VIDEO_IMAGE_RETRY_DELAY_MS || "2500", 10);

function enforceDuration(scenes) {
    const total = scenes.reduce((s, c) => s + (c.durasi_detik || 10), 0);
    if (total >= MIN_VIDEO_DURATION) return;

    const gap = TARGET_DURATION - total;
    const n = scenes.length;
    const extra = Math.floor(gap / n);
    const remainder = gap % n;

    for (let i = 0; i < n; i++) {
        scenes[i].durasi_detik = (scenes[i].durasi_detik || 10) + extra + (i < remainder ? 1 : 0);
    }
}

let videoQueue = Promise.resolve();
let queueLength = 0;

function getGroqClient() {
    const apiKey = getSetting("GROQ_API_KEY") || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY not configured");
    return new Groq({ apiKey });
}

export function isVideoJobRunning() { return queueLength > 0; }
export function getVideoQueueLength() { return queueLength; }

function runFF(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, { maxBuffer: 200 * 1024 * 1024 }, (err) => {
            if (err) reject(new Error(err.message));
            else resolve();
        });
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractJson(text) {
    const cleaned = text
        .replace(/,\s*}/g, '}')
        .replace(/,\s*\]/g, ']');
    try {
        return JSON.parse(cleaned);
    } catch (e) { warn('VideoGen: ' + e.message); }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch (e) { warn('VideoGen: ' + e.message); }
    }
    return null;
}

async function generateScript(topic, style = 'edukasi') {
    const client = getGroqClient();
    const safeTopic = topic.replace(/["\\\n\r]/g, (c) => {
        if (c === '"') return '\\"';
        if (c === '\\') return '\\\\';
        return ' ';
    });

    const isRoast = /roast/i.test(safeTopic);
    const prompt = isRoast ? ROAST_PROMPT : (SCRIPT_STYLES[style] || SCRIPT_STYLES.edukasi);

    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await client.chat.completions.create({
                model: "qwen/qwen3-32b",
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: "Buat script video tentang: " + safeTopic }
                ],
                response_format: { type: "json_object" },
                max_tokens: 4096,
                temperature: attempt === 0 ? 0.7 : 0.3
            });

            const text = r.choices[0]?.message?.content;
            if (!text) {
                lastError = new Error("Gagal generate script: empty response");
                continue;
            }

            const parsed = extractJson(text);
            if (!parsed || !parsed.scenes || !parsed.scenes.length) {
                lastError = new Error("Scenes kosong atau JSON tidak valid");
                continue;
            }
            return parsed;
        } catch (err) {
            lastError = err;
            const errMsg = typeof err.message === 'string' ? err.message : '';
            if (errMsg.includes('failed_generation') || errMsg.includes('json_validate_failed')) {
                const match = errMsg.match(/"failed_generation":"((?:[^"\\]|\\.)*)"/);
                if (match) {
                    try {
                        const failedText = match[1]
                            .replace(/\\n/g, '\n')
                            .replace(/\\"/g, '"')
                            .replace(/\\\\/g, '\\');
                        const parsed = extractJson(failedText);
                        if (parsed && parsed.scenes && parsed.scenes.length) {
                            return parsed;
                        }
                    } catch (e) { warn('VideoGen: ' + e.message); }
                }
            }
            if (attempt < 2) {
                await delay(1000 * (attempt + 1));
            }
        }
    }

    throw lastError || new Error("Gagal generate script setelah 3 percobaan");
}

async function generateImageFromPollinations(prompt, timeoutMs = 15000) {
    const url = "https://image.pollinations.ai/prompt/" +
        encodeURIComponent(prompt + ", digital illustration, 9:16") +
        "?width=720&height=1280";
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.length > 1000 ? buf : null;
}

function makePrompt(scene, style) {
    const base = scene.visual_prompt || scene.narasi.slice(0, 120);
    const styles = [
        base + ", digital illustration, cinematic lighting, 9:16",
        "Professional illustration of " + base + ", vibrant colors, 4k, 9:16",
        "Beautiful digital art, " + base + ", detailed, award winning, portrait 9:16",
    ];
    return styles[style % styles.length];
}

async function generateImages(scenes, workDir, onProgress) {
    const total = scenes.length;
    const imagePaths = [];

    onProgress("Bikin gambar via Pollinations...");

    for (let i = 0; i < total; i++) {
        const sceneNo = i + 1;
        let buf = null;

        for (let attempt = 1; attempt <= IMAGE_MAX_RETRIES_PER_SCENE; attempt++) {
            const style = (attempt - 1) % 3;
            const timeoutMs = attempt <= 3 ? 30000 : 60000;
            if (attempt === 1) {
                onProgress("Scene " + sceneNo + "/" + total + " - Lagi bikin gambar...");
            }

            buf = await generateImageFromPollinations(
                makePrompt(scenes[i], style),
                timeoutMs
            ).catch(() => null);

            if (buf) break;
            if (attempt < IMAGE_MAX_RETRIES_PER_SCENE) {
                await delay(IMAGE_RETRY_DELAY_MS);
            }
        }

        if (!buf) {
            throw new Error("Pollinations gagal untuk scene " + sceneNo + " setelah " + IMAGE_MAX_RETRIES_PER_SCENE + " percobaan");
        }

        const imgPath = path.join(workDir, "img" + i + ".jpg");
        fs.writeFileSync(imgPath, buf);
        imagePaths.push(imgPath);
    }

    return imagePaths;
}

export async function generateVideo(topic, onProgress, style = 'edukasi') {
    queueLength++;

    const task = videoQueue.then(async () => {
        const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const workDir = "/tmp/thirty-video-" + jobId;
        fs.mkdirSync(workDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, ".active"), String(Date.now()));

        try {
            onProgress("Nulis script...");
            const data = await generateScript(topic.trim(), style);
            const total = data.scenes.length;
            onProgress("Script jadi: " + data.title + " (" + total + " scene)");
            enforceDuration(data.scenes);
            const enforcedTotal = data.scenes.reduce((s, c) => s + (c.durasi_detik || 10), 0);
            onProgress("Durasi: " + enforcedTotal + " detik");

            const imagePaths = await generateImages(data.scenes, workDir, onProgress);

            onProgress("Generate suara natural via Edge-TTS... (0/" + total + ")");
            const audioPaths = [];
            for (let i = 0; i < total; i++) {
                const text = data.scenes[i].narasi || "";
                const audioPath = path.join(workDir, "a" + i + ".mp3");

                // Gunakan Edge-TTS — suara natural, bukan robot
                const buf = await getEdgeTtsBuffer(text, {
                    voice: VOICES.ardi,
                    rate: 0,
                });
                fs.writeFileSync(audioPath, buf);

                audioPaths.push(audioPath);
                onProgress("Generate suara cowok natural... (" + (i + 1) + "/" + total + ")");
            }

            onProgress("Rakit video...");
            const outputPath = path.join(workDir, "output.mp4");
            await assembleVideo(data.scenes, imagePaths, audioPaths, workDir, outputPath);

            const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
            onProgress("Video siap! (" + sizeMB + "MB)");

            try { fs.unlinkSync(path.join(workDir, ".active")); } catch (e) { warn('VideoGen: ' + e.message); }
            return { outputPath, workDir, title: data.title };
        } catch (err) {
            try { fs.unlinkSync(path.join(workDir, ".active")); } catch (e) { warn('VideoGen: ' + e.message); }
            cleanup(workDir);
            throw err;
        } finally {
            queueLength--;
        }
    });

    videoQueue = task.catch(() => {});
    return task;
}

function msToSrt(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const mil = ms % 1000;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "," + String(mil).padStart(3, "0");
}

function textToSrt(text, durSec) {
    const lines = [];
    const totalMs = durSec * 1000;
    const words = text.split(" ");
    const chunkSize = Math.ceil(words.length / 3);
    const parts = [];
    for (let i = 0; i < words.length; i += chunkSize) {
        parts.push(words.slice(i, i + chunkSize).join(" "));
    }
    const perMs = totalMs / parts.length;
    for (let i = 0; i < parts.length; i++) {
        const start = Math.floor(i * perMs);
        const end = Math.floor((i + 1) * perMs);
        lines.push((i + 1));
        lines.push(msToSrt(start) + " --> " + msToSrt(end));
        lines.push(parts[i]);
        lines.push("");
    }
    return lines.join("\n");
}

async function assembleVideo(scenes, imagePaths, audios, workDir, outputPath) {
    const segments = [];

    for (let i = 0; i < scenes.length; i++) {
        const segPath = path.join(workDir, "s" + i + ".mp4");
        segments.push(segPath);

        const dur = scenes[i].durasi_detik || 10;
        const fps = 25;
        const frameCount = dur * fps;
        const srtFile = path.join(workDir, "sr" + i + ".srt");
        fs.writeFileSync(srtFile, textToSrt(scenes[i].narasi || "", dur), "utf8");

        const img = imagePaths[i];
        const zoomEnd = 1.2;
        const zoomStep = (zoomEnd - 1) / frameCount;

        const vf = [
            "scale=720*1.1:1280*1.1:force_original_aspect_ratio=increase,crop=720:1280",
            "zoompan=z='min(1+" + zoomStep + "*on," + zoomEnd + ")':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=" + frameCount + ":s=720x1280:fps=" + fps,
            "subtitles=" + srtFile + ":force_style='FontSize=15,Alignment=2,MarginV=65'"
        ].join(",");

        await runFF([
            "-loop", "1", "-i", img,
            "-i", audios[i],
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
            "-t", String(dur), "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-shortest",
            "-y", segPath
        ]);
    }

    const filelist = path.join(workDir, "list.txt");
    fs.writeFileSync(filelist, segments.map(s => "file '" + s + "'").join("\n"));

    await runFF([
        "-f", "concat", "-safe", "0", "-i", filelist,
        "-c", "copy", "-movflags", "+faststart",
        "-y", outputPath
    ]);
}

// ─── Konten Multi-Scene (Viral Style, 1+ Menit) ───

/**
 * Generate konten multi-scene: mirip generateVideo tapi dengan script style
 * konten viral (lebih banyak scene, lebih pendek per scene, hook tiap scene).
 * Minimal 1 menit, ganti gambar tiap scene.
 */
export async function generateKonten(topic, onProgress, style = 'fakta') {
    queueLength++;

    const kontenStyle = 'k' + style; // kfakta, kedukasi, kstory, kquotes

    const task = videoQueue.then(async () => {
        const jobId = 'konten-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const workDir = "/tmp/thirty-konten-" + jobId;
        fs.mkdirSync(workDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, ".active"), String(Date.now()));

        try {
            onProgress("Nulis script konten viral...");
            const data = await generateScript(topic.trim(), kontenStyle);
            const total = data.scenes.length;
            onProgress("Script jadi: " + data.title + " (" + total + " scene)");
            enforceDuration(data.scenes);
            const enforcedTotal = data.scenes.reduce((s, c) => s + (c.durasi_detik || 10), 0);
            onProgress("Durasi: " + enforcedTotal + " detik");

            const imagePaths = await generateImages(data.scenes, workDir, onProgress);

            onProgress("Generate suara natural via Edge-TTS... (0/" + total + ")");
            const audioPaths = [];
            for (let i = 0; i < total; i++) {
                const text = data.scenes[i].narasi || "";
                const audioPath = path.join(workDir, "a" + i + ".mp3");
                const buf = await getEdgeTtsBuffer(text, {
                    voice: VOICES.ardi,
                    rate: 0,
                });
                fs.writeFileSync(audioPath, buf);
                audioPaths.push(audioPath);
                onProgress("Generate suara cowok natural... (" + (i + 1) + "/" + total + ")");
            }

            onProgress("Rakit video...");
            const outputPath = path.join(workDir, "output.mp4");
            await assembleVideo(data.scenes, imagePaths, audioPaths, workDir, outputPath);

            const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
            onProgress("Video siap! (" + sizeMB + "MB)");

            try { fs.unlinkSync(path.join(workDir, ".active")); } catch (e) { warn('VideoGen: ' + e.message); }
            return { outputPath, workDir, title: data.title };
        } catch (err) {
            try { fs.unlinkSync(path.join(workDir, ".active")); } catch (e) { warn('VideoGen: ' + e.message); }
            cleanup(workDir);
            throw err;
        } finally {
            queueLength--;
        }
    });

    videoQueue = task.catch(() => {});
    return task;
}

function getAudioDuration(audioPath) {
    return new Promise((resolve) => {
        execFile(ffmpegPath, ['-i', audioPath, '-f', 'null', '-'],
            { timeout: 10000 },
            (err, stdout, stderr) => {
                const match = stderr.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
                if (match) {
                    const h = parseInt(match[1]), m = parseInt(match[2]), s = parseInt(match[3]);
                    resolve(h * 3600 + m * 60 + s);
                } else {
                    resolve(5);
                }
            }
        );
    });
}

export function cleanup(workDir) {
    if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

export function cleanupAll() {
    try {
        const files = fs.readdirSync("/tmp");
        const now = Date.now();
        const dirs = files.filter(f => f.startsWith(TMP_WORKDIR_PREFIX));
        for (const dir of dirs) {
            const fullPath = path.join("/tmp", dir);
            try {
                const stat = fs.statSync(fullPath);
                const age = now - stat.mtimeMs;
                if (age < CLEANUP_MAX_AGE_MS) continue;
                if (fs.existsSync(path.join(fullPath, ".active"))) continue;
                fs.rmSync(fullPath, { recursive: true, force: true });
                console.log("Cleaned up: " + fullPath);
            } catch (e) { warn('VideoGen: ' + e.message); }
        }
    } catch (err) {
        warn('VideoGen cleanup: ' + err.message);
    }
}
