import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "child_process";
import { getAudioBase64, getAllAudioBase64 } from "google-tts-api";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { getSetting, setSetting } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPT_PROMPT = [
    "Kamu adalah script writer video edukatif. Buat script video tentang topik yang diminta.",
    "Output JSON dengan format:",
    "{ \"title\": \"judul video\", \"scenes\": [",
    "  { \"narasi\": \"Narasi Bahasa Indonesia santai\", \"visual_prompt\": \"English visual prompt\", \"durasi_detik\": 10 }",
    "] }",
    "Aturan:",
    "- Total: 60-90 detik (6 scene)",
    "- Scene 1: intro, 2-5: isi, 6: penutup (akhiri dengan Terimakasih sudah menonton)",
    "- narasi pake Bahasa Indonesia santai, kaya ngobrol, max 200 karakter per scene",
    "- visual_prompt: deskripsi gambar Bahasa Inggris untuk AI image generator",
    "- Output HANYA JSON, tanpa teks lain"
].join("\n");



const MIN_VIDEO_DURATION = 60;
const TARGET_DURATION = 65;

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

let activeJob = false;
let _genAI = null;

function getGenAI() {
    if (_genAI) return _genAI;
    const apiKey = getSetting("GEMINI_API_KEY") || process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    _genAI = new GoogleGenerativeAI(apiKey);
    return _genAI;
}

function getGroqClient() {
    const apiKey = getSetting("GROQ_API_KEY") || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY not configured");
    return new Groq({ apiKey });
}

export function isVideoJobRunning() { return activeJob; }

function runFF(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, { maxBuffer: 200 * 1024 * 1024 }, (err) => {
            if (err) reject(new Error(err.message));
            else resolve();
        });
    });
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function generateScript(topic) {
    const client = getGroqClient();
    const r = await client.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
            { role: "system", content: SCRIPT_PROMPT },
            { role: "user", content: "Buat script video tentang: " + topic }
        ],
        response_format: { type: "json_object" },
        max_tokens: 4096,
        temperature: 0.7
    });

    const text = r.choices[0]?.message?.content;
    if (!text) throw new Error("Gagal generate script");

    const parsed = JSON.parse(text);
    if (!parsed.scenes || !parsed.scenes.length) throw new Error("Scenes kosong");
    return parsed;
}

async function generateImageFromGemini(model, prompt) {
    const result = await model.generateContent({
        contents: [{
            role: "user",
            parts: [{
                text: "Buat gambar: " + prompt + ". Format: digital illustration, portrait 9:16, HD quality."
            }]
        }]
    });
    const parts = result.response.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
        if (p.inlineData?.mimeType?.startsWith("image/")) {
            return Buffer.from(p.inlineData.data, "base64");
        }
    }
    return null;
}

async function generateImageFromPollinations(prompt) {
    const url = "https://image.pollinations.ai/prompt/" +
        encodeURIComponent(prompt + ", digital illustration, 9:16") +
        "?width=720&height=1280";
    const resp = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.length > 1000 ? buf : null;
}

const FALLBACK_COLORS = [
    ["#1a1a2e", "#e94560"], ["#0f3460", "#533483"], ["#16213e", "#0f3460"],
    ["#23074d", "#cc5333"], ["#000428", "#004e92"], ["#004d7a", "#00bf72"],
    ["#0f0c29", "#302b63"], ["#1cb5e0", "#000046"], ["#a5cc82", "#004d7a"],
    ["#533483", "#e94560"], ["#24243e", "#1cb5e0"], ["#008793", "#a8eb12"]
];

async function generateFallbackImage(workDir, i) {
    const imgPath = path.join(workDir, "fb" + i + ".jpg");
    const [c0, c1] = FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    const mid = FALLBACK_COLORS[(i + 5) % FALLBACK_COLORS.length][0];
    await runFF([
        "-f", "lavfi", "-i",
        "gradients=s=720x1280:c0=" + c0 + ":c1=" + mid + ":c2=" + c1,
        "-frames:v", "1", "-q:v", "5",
        "-y", imgPath
    ]);
    return imgPath;
}

async function generateImages(scenes, workDir, onProgress) {
    const genAI = getGenAI();
    const total = scenes.length;
    const imagePaths = [];
    let useGemini = !!genAI;

    let geminiModel = null;
    if (genAI) {
        geminiModel = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-image",
            generationConfig: { temperature: 1, topK: 32, topP: 1, maxOutputTokens: 8192 }
        });
    }

    for (let i = 0; i < total; i++) {
        onProgress("Bikin gambar... (" + (i + 1) + "/" + total + ")");
        const prompt = scenes[i].visual_prompt || "Illustration about: " + scenes[i].narasi.slice(0, 100);
        const imgPath = path.join(workDir, "img" + i + ".jpg");
        let imgBuf = null;

        if (useGemini && geminiModel) {
            try {
                imgBuf = await generateImageFromGemini(geminiModel, prompt);
                if (imgBuf) {
                    fs.writeFileSync(imgPath, imgBuf);
                    imagePaths.push(imgPath);
                    if (i < total - 1) await sleep(6000);
                    continue;
                }
            } catch (e) {
                if (e.status === 429) {
                    onProgress("Gemini quota abis, pke Pollinations");
                    useGemini = false;
                } else {
                    onProgress("Gemini error: " + (e.message || "").slice(0, 40) + ", fallback Pollinations");
                }
            }
        }

        try {
            imgBuf = await generateImageFromPollinations(prompt);
            if (imgBuf) {
                fs.writeFileSync(imgPath, imgBuf);
                imagePaths.push(imgPath);
                continue;
            }
        } catch {}

        onProgress("Gambar " + (i + 1) + " gagal, pke gradien");
        const fallbackPath = await generateFallbackImage(workDir, i);
        imagePaths.push(fallbackPath);
    }

    return imagePaths;
}

export async function generateVideo(topic, onProgress) {
    if (activeJob) throw new Error("Video job sedang berjalan");
    activeJob = true;

    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const workDir = "/tmp/thirty-video-" + jobId;
    fs.mkdirSync(workDir, { recursive: true });

    try {
        onProgress("Nulis script...");
        const data = await generateScript(topic.trim());
        const total = data.scenes.length;
        onProgress("Script jadi: " + data.title + " (" + total + " scene)");
        enforceDuration(data.scenes);
        const enforcedTotal = data.scenes.reduce((s, c) => s + (c.durasi_detik || 10), 0);
        onProgress("Durasi: " + enforcedTotal + " detik");

        const imagePaths = await generateImages(data.scenes, workDir, onProgress);

        onProgress("Generate suara... (0/" + total + ")");
        const audioPaths = [];
        for (let i = 0; i < total; i++) {
            const text = data.scenes[i].narasi || "";
            const audioPath = path.join(workDir, "a" + i + ".mp3");

            if (text.length <= 200) {
                const b64 = await getAudioBase64(text, { lang: "id", slow: false });
                fs.writeFileSync(audioPath, Buffer.from(b64, "base64"));
            } else {
                const parts = await getAllAudioBase64(text, { lang: "id", slow: false });
                const combined = parts.map(p => p.base64).join("");
                fs.writeFileSync(audioPath, Buffer.from(combined, "base64"));
            }

            audioPaths.push(audioPath);
            onProgress("Generate suara... (" + (i + 1) + "/" + total + ")");
        }

        onProgress("Rakit video...");
        const outputPath = path.join(workDir, "output.mp4");
        await assembleVideo(data.scenes, imagePaths, audioPaths, workDir, outputPath);

        const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
        onProgress("Video siap! (" + sizeMB + "MB)");

        activeJob = false;
        return { outputPath, workDir, title: data.title };
    } catch (err) {
        cleanup(workDir);
        activeJob = false;
        throw err;
    }
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
            "subtitles=" + srtFile
        ].join(",");

        await runFF([
            "-loop", "1", "-i", img,
            "-i", audios[i],
            "-vf", vf,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
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

export function cleanup(workDir) {
    if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

export function cleanupAll() {
    try {
        const files = fs.readdirSync("/tmp");
        const dirs = files.filter(f => f.startsWith("thirty-video-"));
        for (const dir of dirs) {
            const fullPath = path.join("/tmp", dir);
            try {
                fs.rmSync(fullPath, { recursive: true, force: true });
                console.log("Cleaned up: " + fullPath);
            } catch {}
        }
    } catch (err) {
        console.warn("Warning: Failed to cleanup /tmp:", err.message);
    }
}
