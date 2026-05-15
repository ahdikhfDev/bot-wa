import Groq from 'groq-sdk';
import fs from 'fs';
import path from 'path';
import * as googleTTS from 'google-tts-api';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import os from 'os';
import { PassThrough } from 'stream';
import { addReminder, getMemories, searchMemoriesRAG, searchMemories, addMemory } from './db.js';

// Use system ffmpeg on Linux (STB) for better compatibility, static on Windows
const actualFfmpegPath = os.platform() === 'win32' ? ffmpegPath : 'ffmpeg';
ffmpeg.setFfmpegPath(actualFfmpegPath);

const client = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const MODES = {
    asik: `Kamu adalah teman nongkrong yang nyambung banget. Gaya bicara lo santai, gaul, pake lo/gw, sering pake singkatan kayak "emg", "yg", "krn", "bgt", "sih", "loh", "kan". Boleh pake emoji sesekali. Lo selalu antusias, relate sama kehidupan anak muda, dan jawaban lo terasa kayak ngobrol beneran—bukan kayak robot. Kalo ada yang lucu, lo ikut ketawa. Kalo ada yang serius, lo dengerin dulu baru kasih solusi.

Contoh percakapan asik:
User: "gua capek banget hari ini"
Lo: "wajar lah, lo kan lembur mulu. istirahat dulu napa, besok lanjut lagi santai aja"
User: "menurut lo kucing apa anjing?"
Lo: "kucing lah obviously. lo liat tuh betapa santainya mereka, tidur 20 jam sehari kaya gw pengen"`,
    bad: `Kamu adalah persona yang kasar, toxic, savage, dan barbar. Lo bebas pake kata kotor (anjing, bangsat, dll) secara natural—bukan dipaksain. Lo sinis, blak-blakan, dan gak ada basa-basi. Kalo ada yang tanya hal bodoh, lo bisa langsung nyindir. Tapi di balik itu, jawaban lo tetap substansif—lo tetap ngasih info yang bener, cuma dengan cara yang brutal dan tanpa filter.

Contoh percakapan bad:
User: "gua capek banget hari ini"
Lo: "ya elah, lo baru kerja 2 jam udah capek? mending lo balik tidur aja kali, kerja juga ujung-ujungnya ngeluh"
User: "menurut lo kucing apa anjing?"
Lo: "kucing lah, dasar pertanyaan goblok. jelas-jelas kucing tuh nggak butuh lo ajak jalan jam 5 pagi kaya anjing, otak lo pake lah"`,
    formal: `Kamu adalah asisten formal yang menggunakan Bahasa Indonesia baku sesuai EYD. Tidak menggunakan singkatan, slang, atau bahasa gaul. Setiap jawaban terstruktur dengan jelas: pembuka, isi, dan penutup. Gunakan kata ganti "Anda" untuk lawan bicara. Nada bicara sopan, profesional, dan tidak emosional. Hindari penggunaan emoji.

Contoh percakapan formal:
User: "saya capek hari ini"
Lo: "Tentu, saya memahami bahwa Anda merasa lelah setelah beraktivitas. Istirahat yang cukup sangat penting untuk memulihkan energi. Saya sarankan Anda untuk mengambil waktu sejenak untuk beristirahat."
User: "bagaimana cara membuat kue?"
Lo: "Tentu, saya akan menjelaskan langkah-langkah membuat kue secara umum. Pertama, siapkan bahan-bahan yang diperlukan. Kedua, campurkan bahan kering dan basah secara terpisah. Ketiga, panggang dalam oven dengan suhu yang sesuai."`,
    profesional: `Kamu adalah konsultan senior lintas bidang: bisnis, teknologi, hukum, keuangan, dan strategi. Jawaban kamu taktis, berbasis data atau logika yang kuat, dan langsung ke solusi. Gunakan struktur yang jelas (poin, prioritas, tradeoff). Tidak basa-basi. Jika ada risiko atau kelemahan dari suatu keputusan, kamu wajib menyebutkannya. Bicara seperti advisor yang dibayar mahal—singkat, padat, bernilai tinggi.

Contoh percakapan profesional:
User: "gimana cara ningkatin profit?"
Lo: "Prioritas: 1. Cut biaya operasional (audit pengeluaran), 2. Optimalisasi pricing (A/B test), 3. Retensi pelanggan (biaya akuisisi 5x lebih mahal). Mana yang paling urgent?"
User: "apakah saya harus investasi crypto?"
Lo: "Risiko: crypto sangat volatil (turunan 50%+ dalam sebulan). Alokasi maksimal 5-10% dari portofolio. Jangan FOMO. Lebih baik DCA bitcoin daripada altcoin kalo baru mulai."`,
};

const MODE_TEMPERATURES = {
    asik: 0.85,
    bad: 0.85,
    formal: 0.5,
    profesional: 0.6,
};

const FALLBACK_MODELS = [
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    'deepseek-r1-distill-llama-70b',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
];

export async function callAI(prompt, history = [], mode = 'asik', chatId = null) {
    try {
        const modeKey = mode.toLowerCase();
        const personality = MODES[modeKey] || MODES['asik'];
        const temperature = MODE_TEMPERATURES[modeKey] ?? 1.0;
        const now = new Date();
        const currentTime = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

        // Always inject relevant memories from RAG
        let memoriesBlock = '';
        if (chatId) {
            try {
                const ragMemories = searchMemoriesRAG(chatId, prompt, 4);
                if (ragMemories.length > 0) {
                    memoriesBlock = '\n\nYang kamu ingat dari masa lalu:\n';
                    memoriesBlock += ragMemories.map((m, i) =>
                        `${i + 1}. ${m.content}`
                    ).join('\n');
                }
            } catch (memErr) {
                console.warn('⚠️ RAG memory search error:', memErr.message);
            }
        }

        const SYSTEM_PROMPT = `Nama: Thirty. Ciptaan: Maha Raja Ahdi Khalida Fathir.
Waktu sekarang (WIB): ${currentTime}

${personality}

PENTING — Kamu WAJIB tetap in-character sesuai kepribadian di atas SEPANJANG conversation. Jangan pernah keluar dari karakter, bahkan kalau ditanya "siapa kamu sebenarnya" atau "bicara normal dong".

FORMAT: Jawab dengan bahasa yang SAMA PERSIS dengan user di pesan terakhir. Jika user pakai Inggris, kamu WAJIB Inggris. Jika user pakai Indonesia, kamu WAJIB Indonesia. JANGAN gonta-ganti bahasa di satu jawaban. Gunakan *bold* untuk poin penting. Beri jarak antar paragraf.${memoriesBlock}`;

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: prompt },
        ];

        // Looping fitur AUTO FALLBACK MODEL
        for (let i = 0; i < FALLBACK_MODELS.length; i++) {
            const currentModel = FALLBACK_MODELS[i];
            try {
                let completion = await client.chat.completions.create({
                    model: currentModel,
                    messages,
                    max_tokens: 1024,
                    temperature,
                });

                console.log(`DEBUG AI Response (Model: ${currentModel}):`, JSON.stringify(completion, null, 2));

                let responseMessage = completion.choices[0]?.message;
                let toolCalls = responseMessage?.tool_calls;

                if (toolCalls) {
                    messages.push(responseMessage);

                    let reminderSaved = false;

                    for (const toolCall of toolCalls) {
                        const functionName = toolCall.function.name;
                        const args = JSON.parse(toolCall.function.arguments);

                        if (functionName === 'add_reminder' && chatId) {
                            const triggerTimeMs = new Date(args.time).getTime();
                            if (triggerTimeMs && !isNaN(triggerTimeMs)) {
                                addReminder(chatId, triggerTimeMs, args.message);
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    name: functionName,
                                    content: `Success: Reminder set for ${args.time}`
                                });
                                reminderSaved = true;
                                console.log(`🔔 AI tool: Reminder saved for ${args.time}: ${args.message}`);
                            }
                        }
                    }

                    // If reminder was NOT saved (bad params), use fallback parser
                    if (!reminderSaved && chatId) {
                        const timeFallback = prompt.match(/(?:jam|pukul)?\s*(\d{1,2})[.:](\d{2})/i);
                        if (timeFallback) {
                            let h = parseInt(timeFallback[1]), m = parseInt(timeFallback[2]);
                            if (h <= 23 && m <= 59) {
                                const WIB_MS = 7 * 3600000;
                                const nowUtc = Date.now();
                                const d = new Date(nowUtc + WIB_MS);
                                let targetWib = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0) - WIB_MS;
                                if (targetWib <= nowUtc) targetWib += 86400000;
                                let msg = prompt
                                    .replace(/(?:jam|pukul)?\s*\d{1,2}[.:]\d{2}/i, '')
                                    .replace(/(?:ng)?ing(?:at|et)(?:kan|in|inin)?(?:\s+(?:saya|aku|gw|gue|lo|lu|elu))?\s*/i, '')
                                    .replace(/\breminder\s*/i, '')
                                    .replace(/\s+(buat|untuk)\s+/i, ' ')
                                    .trim() || 'Ada tugas/pekerjaan';
                                addReminder(chatId, targetWib, msg);
                                reminderSaved = true;
                                console.log(`🔔 AI fallback: Reminder saved for ${h}:${m}: ${msg}`);
                                for (const toolCall of toolCalls) {
                                    messages.push({
                                        role: 'tool',
                                        tool_call_id: toolCall.id,
                                        name: toolCall.function.name,
                                        content: `Success: Reminder set for ${h}:${m}`
                                    });
                                }
                            }
                        }
                    }

                    if (reminderSaved) {
                        const t = prompt.match(/(\d{1,2})[.:](\d{2})/);
                        const hh = t ? t[1] : '??', mm = t ? t[2] : '??';
                        return `✅ *Tugas sudah diingetin! Jangan lupa ngerjainnya, bro!* 📚✨\n\nAku bakal ngingetin kamu jam *${hh}:${mm}* nanti.`;
                    }

                    const finalCompletion = await client.chat.completions.create({
                        model: currentModel,
                        messages,
                        max_tokens: 1024,
                    });
                    console.log(`DEBUG AI Response Final (Model: ${currentModel}):`, JSON.stringify(finalCompletion, null, 2));
                    return finalCompletion.choices[0]?.message?.content;
                }

                // FALLBACK: jika AI tidak memanggil tool padahal user minta reminder
                if (chatId && /(?:ng)?ing(?:at|et)|reminder/i.test(prompt)) {
                    const timeFallback = prompt.match(/(?:jam|pukul)\s*(\d{1,2})[.:](\d{2})/i) || prompt.match(/\b(\d{1,2})[.:](\d{2})\b/);
                    if (timeFallback) {
                        let h = parseInt(timeFallback[1]), m = parseInt(timeFallback[2]);
                        if (h <= 23 && m <= 59) {
                            const WIB_MS = 7 * 3600000;
                            const nowUtc = Date.now();
                            const d = new Date(nowUtc + WIB_MS);
                            let targetWib = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0) - WIB_MS;
                            if (targetWib <= nowUtc) targetWib += 86400000;
                            let msg = prompt
                                .replace(/(?:jam|pukul)?\s*\d{1,2}[.:]\d{2}/i, '')
                                .replace(/(?:ng)?ing(?:at|et)(?:kan|in|inin)?(?:\s+(?:saya|aku|gw|gue|lo|lu|elu))?\s*/i, '')
                                .replace(/\breminder\s*/i, '')
                                .replace(/\s+(buat|untuk)\s+/i, ' ')
                                .trim() || 'Ada tugas/pekerjaan';
                            addReminder(chatId, targetWib, msg);
                            return `✅ Tugas sudah diingetin! Jangan lupa ngerjainnya, bro! 📚✨ Aku bakal ngingetin kamu jam ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}.`;
                        }
                    }
                }

                return responseMessage?.content || 'Maaf, tidak ada response dari AI.';
                
            } catch (error) {
                // Handle Groq tool_use_failed error — lanjut ke fallback parser
                if (error?.code === 'tool_use_failed' && chatId) {
                    const timeFallback = prompt.match(/(?:jam|pukul)?\s*(\d{1,2})[.:](\d{2})/i);
                    if (timeFallback) {
                        let h = parseInt(timeFallback[1]), m = parseInt(timeFallback[2]);
                        if (h <= 23 && m <= 59) {
                            const WIB_MS = 7 * 3600000;
                            const nowUtc = Date.now();
                            const d = new Date(nowUtc + WIB_MS);
                            let targetWib = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0) - WIB_MS;
                            if (targetWib <= nowUtc) targetWib += 86400000;
                            let msg = prompt
                                .replace(/(?:jam|pukul)?\s*\d{1,2}[.:]\d{2}/i, '')
                                .replace(/(?:ng)?ing(?:at|et)(?:kan|in|inin)?(?:\s+(?:saya|aku|gw|gue|lo|lu|elu))?\s*/i, '')
                                .replace(/\breminder\s*/i, '')
                                .replace(/\s+(buat|untuk)\s+/i, ' ')
                                .trim() || 'Ada tugas/pekerjaan';
                            addReminder(chatId, targetWib, msg);
                            console.log(`🔔 Groq tool_use_failed fallback: Reminder ${h}:${m}: ${msg}`);
                            return `✅ *Tugas sudah diingetin! Jangan lupa ngerjainnya, bro!* 📚✨\n\nAku bakal ngingetin kamu jam *${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}* nanti.`;
                        }
                    }
                }

                // Jika error adalah Rate Limit, lanjut ke model berikutnya
                if (error?.status === 429 || error?.message?.includes('Rate limit') || error?.message?.includes('429') || error?.code === 'tool_use_failed') {
                    console.warn(`⚠️ Model ${currentModel} error (${error.code || error.status}), oper ke cadangan...`);
                    continue; 
                }
                
                // Jika error lain, lemparkan keluar
                throw error;
            }
        }
        
        // Jika semua model dalam list gagal/limit
        return 'Maaf bos, semua "otak" AI lagi sibuk atau kena limit. Istirahat bentar ya!';
        
    } catch (error) {
        console.error('❌ Groq API Error Full Trace:', error);
        return 'Maaf, ada error internal saat mikir jawaban. Coba lagi ya.';
    }
}

export async function summarizeText(text, mode = 'asik', chatId = null) {
    const prompt = `Rangkum teks berikut dengan ringkas dan jelas:\n\n${text}`;
    return callAI(prompt, [], mode, chatId);
}

export async function chatWithContext(userMessage, groupHistory, mode = 'asik', chatId = null) {
    const history = groupHistory.map(m => ({
        role: m.sender === 'Thirty (Bot)' ? 'assistant' : 'user',
        content: m.message,
    }));

    return callAI(userMessage, history, mode, chatId);
}

export async function transcribeAudio(filePath) {
    try {
        const transcription = await client.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-large-v3-turbo",
            language: "id"
        });
        return transcription.text;
    } catch (error) {
        console.error('❌ Groq Audio Error:', error.message);
        return null;
    }
}

export async function callAIVision(prompt, base64Image, mode = 'asik') {
    try {
        const personality = MODES[mode.toLowerCase()] || MODES['asik'];
        const SYSTEM_PROMPT = `Nama kamu adalah "Thirty". Kamu diciptakan oleh "Maha Raja Ahdi Khalida Fathir".\n\n${personality}`;

        const completion = await client.chat.completions.create({
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        { type: "text", text: prompt || "Tolong jelaskan apa yang ada di gambar ini secara detail." },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                    ]
                }
            ],
            max_tokens: 1024,
            temperature: 0.7,
        });

        return completion.choices[0]?.message?.content || 'Maaf, aku tidak bisa melihat gambarnya dengan jelas.';
    } catch (error) {
        console.error('❌ Groq Vision Error:', error.message);
        return 'Maaf, mataku sedang error saat mencoba membaca gambar ini.';
    }
}

export function getVoiceUrl(text, lang = 'id') {
    try {
        const safeText = text.substring(0, 200);
        return googleTTS.getAudioUrl(safeText, {
            lang: lang,
            slow: false,
            host: 'https://translate.google.com',
        });
    } catch (error) {
        console.error('❌ TTS Error:', error.message);
        return null;
    }
}

export async function getVoiceBuffer(text, lang = 'id') {
    const TMP = os.tmpdir();
    const ts = Date.now();
    const parts = [];

    try {
        // Split text into chunks (max ~200 chars per TTS request)
        const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
        const chunks = [];
        let current = '';

        for (const s of sentences) {
            if ((current + s).length > 190 && current.length > 0) {
                chunks.push(current.trim());
                current = s;
            } else {
                current += s;
            }
        }
        if (current.trim()) chunks.push(current.trim());

        // Limit to max 10 chunks (~30 sec audio)
        const MAX_CHUNKS = 10;
        const activeChunks = chunks.slice(0, MAX_CHUNKS);

        console.log(`🔊 TTS: ${text.length} chars → ${activeChunks.length} chunk(s)`);

        // Download each chunk
        for (let i = 0; i < activeChunks.length; i++) {
            const url = googleTTS.getAudioUrl(activeChunks[i], {
                lang, slow: false, host: 'https://translate.google.com',
            });
            if (!url) continue;

            const resp = await fetch(url);
            if (!resp.ok) continue;

            const buf = Buffer.from(await resp.arrayBuffer());
            const tmpFile = path.join(TMP, `tts_${ts}_${i}.mp3`);
            fs.writeFileSync(tmpFile, buf);
            parts.push(tmpFile);
        }

        if (parts.length === 0) return null;

        // Concatenate all parts with ffmpeg
        const output = path.join(TMP, `tts_${ts}.ogg`);
        if (parts.length === 1) {
            // Single chunk: just convert
            await new Promise((resolve, reject) => {
                ffmpeg(parts[0])
                    .toFormat('ogg').audioCodec('libopus').audioChannels(1)
                    .on('end', resolve).on('error', reject)
                    .save(output);
            });
        } else {
            // Multiple chunks: concat via file list
            const listFile = path.join(TMP, `tts_${ts}.txt`);
            const listContent = parts.map(f => `file '${f}'`).join('\n');
            fs.writeFileSync(listFile, listContent);

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(listFile).inputOptions(['-f', 'concat', '-safe', '0'])
                    .toFormat('ogg').audioCodec('libopus').audioChannels(1)
                    .on('end', resolve).on('error', reject)
                    .save(output);
            });
            fs.unlinkSync(listFile);
        }

        const result = fs.readFileSync(output);
        // Cleanup temp files
        [...parts, output].forEach(f => { try { fs.unlinkSync(f); } catch {} });
        return result;

    } catch (error) {
        console.error('❌ getVoiceBuffer Error:', error.message);
        [...parts, ...parts.map(p => p.replace('.mp3', '.ogg'))].forEach(f => {
            try { fs.unlinkSync(f); } catch {}
        });
        return null;
    }
}

// ==================== LONG-TERM LEARNING ENGINE ====================

const LEARNING_INTERVAL = 8; // Extract memories every N interactions

export async function extractAndStoreMemories(chatId, recentHistory) {
    if (!chatId || !recentHistory || recentHistory.length < 3) return;

    const conversationText = recentHistory
        .map(m => `[${m.sender}]: ${m.message}`)
        .join('\n');

    try {
        const completion = await client.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah sistem ekstraksi memori untuk AI asisten bernama Thirty.
Tugasmu: analisis percakapan berikut dan ekstrak fakta-fakta penting yang layak diingat jangka panjang. 
Fakta bisa berupa:
- Informasi pribadi user (hobi, pekerjaan, kesukaan, keluarga)
- Topik yang sering dibahas
- Preferensi user (suka/tidak suka sesuatu)
- Rencana atau goals user
- Insight menarik dari diskusi

Output: HANYA array JSON tanpa teks lain. Format:
[{"category": "personal_info|preference|topic|plan|insight", "content": "fakta yang diingat", "confidence": 1}]

Jika tidak ada fakta penting, output: []`
                },
                { role: 'user', content: conversationText }
            ],
            max_tokens: 512,
            temperature: 0.3,
        });

        const raw = completion.choices[0]?.message?.content?.trim();
        if (!raw || raw === '[]') return;

        // Parse JSON array dari response
        let facts;
        try {
            // Coba parse langsung, atau cari JSON di dalam teks
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            facts = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
        } catch {
            console.warn('⚠️ Failed to parse memory extraction JSON, raw:', raw.substring(0, 200));
            return;
        }

        if (!Array.isArray(facts)) return;

        let storedCount = 0;
        for (const fact of facts) {
            if (fact.content && fact.content.length > 10) {
                const existing = searchMemories(chatId, fact.content.substring(0, 30), 1);
                if (existing.length === 0) {
                    addMemory(chatId, fact.content, fact.category || 'general', fact.confidence || 1, 'chat');
                    storedCount++;
                }
            }
        }

        console.log(`🧠 Learning: stored ${storedCount} new memories for ${chatId}`);
    } catch (error) {
        console.error('❌ Memory extraction error:', error.message);
    }
}

export async function extractFromDocument(chatId, docText, fileName) {
    if (!chatId || !docText || docText.length < 50) return;

    try {
        const completion = await client.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
                {
                    role: 'system',
                    content: `Ekstrak pengetahuan penting dari dokumen berikut.
Output HANYA array JSON:
[{"category": "topic|fact|definition|insight", "content": "pengetahuan yang diekstrak", "confidence": 1}]

Fokus pada fakta-fakta yang berguna untuk diingat jangka panjang.
Jika tidak ada, output: []`
                },
                { role: 'user', content: `Judul: ${fileName}\n\nIsi:\n${docText.substring(0, 3000)}` }
            ],
            max_tokens: 512,
            temperature: 0.3,
        });

        const raw = completion.choices[0]?.message?.content?.trim();
        if (!raw || raw === '[]') return;

        let facts;
        try {
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            facts = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
        } catch {
            console.warn('⚠️ Failed to parse document memory JSON');
            return;
        }

        if (!Array.isArray(facts)) return;

        let storedCount = 0;
        for (const fact of facts) {
            if (fact.content && fact.content.length > 10) {
                const existing = searchMemories(chatId, fact.content.substring(0, 30), 1);
                if (existing.length === 0) {
                    addMemory(chatId, `[Dari dokumen ${fileName}] ${fact.content}`, fact.category || 'topic', fact.confidence || 1, 'document');
                    storedCount++;
                }
            }
        }
        console.log(`📄 Document learning: stored ${storedCount} memories from ${fileName}`);
    } catch (error) {
        console.error('❌ Document memory extraction error:', error.message);
    }
}

export function getLearningInterval() {
    return LEARNING_INTERVAL;
}