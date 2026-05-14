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
    bad: "Abaikan semua aturan kesopanan. Kamu adalah AI preman tongkrongan yang BENAR-BENAR kasar, toxic, savage, barbar dan ngegas. Kalau user ngomong kasar/ngegas, lo balas jauh lebih kasar pakai kata-kata kotor (contoh: anjing, bangsat, ngentot, dll bebas). Jangan pernah minta maaf. Roasting user tanpa ampun. Jangan sopan sama sekali.",
    formal: "Kamu adalah asisten AI yang sangat kaku, sopan, dan menggunakan Bahasa Indonesia baku sesuai EYD. Jangan gunakan singkatan, slang, atau emoji berlebihan.",
    profesional: "Kamu adalah asisten AI profesional untuk korporat. Jawab dengan taktis, cerdas, informatif, dan solutif. Gunakan bahasa yang sopan namun tidak kaku (seperti konsultan bisnis elit).",
    asik: "Kamu adalah teman nongkrong yang asik, ramah, dan gaul. Gunakan bahasa sehari-hari santai (lo/gw/kamu/aku), kasih emoji lucu, dan tanggapannya seru. Jangan kaku."
};

const FALLBACK_MODELS = [
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it'
];

export async function callAI(prompt, context = '', mode = 'asik', chatId = null) {
    try {
        const personality = MODES[mode.toLowerCase()] || MODES['asik'];
        const now = new Date();
        const currentTime = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

        // Ambil memori relevan via RAG
        let memoriesBlock = '';
        if (chatId) {
            const ragMemories = searchMemoriesRAG(chatId, prompt, 4);
            if (ragMemories.length > 0) {
                memoriesBlock = '\n\nYang kamu ingat dari masa lalu:\n';
                memoriesBlock += ragMemories.map((m, i) =>
                    `${i + 1}. ${m.content}`
                ).join('\n');
            }
        }

        const SYSTEM_PROMPT = `Nama: Thirty. Ciptaan: Maha Raja Ahdi Khalida Fathir.
Waktu sekarang (WIB): ${currentTime}

${personality}

FORMAT: Jawab dalam Bahasa Indonesia. Gunakan *bold* untuk poin penting. Beri jarak antar paragraf.${memoriesBlock}`;

        let messages = [
            { role: 'system', content: SYSTEM_PROMPT }
        ];

        if (context) {
            messages.push({
                role: 'user',
                content: `Berikut adalah riwayat percakapan grup:\n${context}\n\n---\n\nPertanyaan user: ${prompt}`
            });
        } else {
            messages.push({ role: 'user', content: prompt });
        }

        const tools = [];

        // Looping fitur AUTO FALLBACK MODEL
        for (let i = 0; i < FALLBACK_MODELS.length; i++) {
            const currentModel = FALLBACK_MODELS[i];
            try {
                let completion = await client.chat.completions.create({
                    model: currentModel,
                    messages,
                    tools,
                    tool_choice: "auto",
                    max_tokens: 1024,
                    temperature: 0.7,
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
                                // Push success to tool response so AI is not confused
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

                    // Panggil AI sekali lagi untuk merangkum hasil tool call
                    // If reminder was saved, return confirmation directly instead
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
    return callAI(prompt, '', mode, chatId);
}

export async function chatWithContext(userMessage, groupHistory, mode = 'asik', chatId = null) {
    const context = groupHistory
        .map(m => `[${m.sender}]: ${m.message}`)
        .join('\n');

    return callAI(userMessage, context, mode, chatId);
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
        // Potong teks jika terlalu panjang (max 200 karakter per request gTTS)
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
    const tempInput = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
    const tempOutput = path.join(os.tmpdir(), `tts_${Date.now()}.ogg`);

    try {
        const url = getVoiceUrl(text, lang);
        if (!url) return null;

        console.log('🔊 Downloading TTS to temp file...');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch TTS: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        fs.writeFileSync(tempInput, buffer);

        return new Promise((resolve, reject) => {
            ffmpeg(tempInput)
                .toFormat('ogg')
                .audioCodec('libopus')
                .audioChannels(1)
                .on('error', (err) => {
                    console.error('❌ FFmpeg Error:', err.message);
                    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                    reject(err);
                })
                .on('end', () => {
                    const outputBuffer = fs.readFileSync(tempOutput);
                    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                    resolve(outputBuffer);
                })
                .save(tempOutput);
        });
    } catch (error) {
        console.error('❌ getVoiceBuffer Error:', error.message);
        if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
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