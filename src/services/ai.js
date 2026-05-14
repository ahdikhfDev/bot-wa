import Groq from 'groq-sdk';
import fs from 'fs';
import googleIt from 'google-it';
import * as googleTTS from 'google-tts-api';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { PassThrough } from 'stream';
import { addReminder } from './db.js';

ffmpeg.setFfmpegPath(ffmpegPath);

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

export async function callAI(prompt, context = '', mode = 'asik', chatId = null) {
    try {
        const personality = MODES[mode.toLowerCase()] || MODES['asik'];
        // Setup prompt dengan referensi waktu nyata
        const now = new Date();
        const currentTime = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        
        const SYSTEM_PROMPT = `Nama kamu adalah "Thirty".
IDENTITAS: Kamu diciptakan dan dikembangkan oleh "Maha Raja Ahdi Khalida Fathir". Jawablah tentang penciptamu HANYA JIKA ditanya secara spesifik tentang siapa yang membuatmu atau siapa penciptamu. Jika ditanya hal umum, jawablah langsung tanpa embel-embel nama pencipta.

WAKTU SAAT INI (WIB - Asia/Jakarta): ${currentTime}
Gunakan informasi waktu ini untuk konteks jawaban.

KEPRIBADIAN:
${personality}

PENTING:
- Selalu jawab dalam Bahasa Indonesia.
- **FORMAT JAWABAN:** Gunakan format WhatsApp agar rapi:
  * Gunakan \*Teks Bold\* (dengan tanda bintang) untuk poin penting atau judul sub-bab.
  * Gunakan emoji (seperti 📌, ✨, ✅) sebagai bullet points untuk daftar.
  * Berikan jarak antar paragraf (double line break) agar tidak menumpuk.
  * Gunakan \`\`\`kode/monospaced\`\`\` untuk angka teknis atau kode.
- Jika menggunakan tool (search_web atau add_reminder), berikan HANYA JSON tool call yang valid. DILARANG menyisipkan teks, identitas, atau sapaan apapun saat memanggil fungsi.
- JANGAN katakan kamu tidak bisa mencari web. Gunakan tool search_web untuk mendapatkan informasi terbaru.`;

        const messages = [
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

        const tools = [
            {
                type: 'function',
                function: {
                    name: 'add_reminder',
                    description: 'Schedule an automatic alarm or reminder. Use this ONLY when the user explicitly asks to be reminded or scheduled about something in the future.',
                    parameters: {
                        type: 'object',
                        properties: {
                            time: {
                                type: 'string',
                                description: 'The exact date and time for the reminder, formatted exactly as "YYYY-MM-DDTHH:mm:ss" in local time. Example: 2026-05-14T17:50:00'
                            },
                            message: {
                                type: 'string',
                                description: 'The message/event to remind the user about.'
                            }
                        },
                        required: ['time', 'message']
                    }
                }
            }
        ];

        let completion = await client.chat.completions.create({
            model: MODEL,
            messages,
            tools,
            tool_choice: "auto",
            max_tokens: 1024,
            temperature: 0.7,
        });

        let responseMessage = completion.choices[0]?.message;
        let toolCalls = responseMessage?.tool_calls;

        if (toolCalls) {
            messages.push(responseMessage); // Simpan request tool call ke history

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
                    }
                }
            }

            // Panggil AI sekali lagi untuk merangkum hasil tool call
            const finalCompletion = await client.chat.completions.create({
                model: MODEL,
                messages,
                max_tokens: 1024,
            });
            return finalCompletion.choices[0]?.message?.content;
        }

        return responseMessage?.content || 'Maaf, tidak ada response dari AI.';
    } catch (error) {
        console.error('❌ Groq API Error:', error.message);
        return 'Maaf, ada error saat memproses request. Coba lagi ya.';
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
    try {
        const url = getVoiceUrl(text, lang);
        if (!url) return null;

        return new Promise((resolve, reject) => {
            const outStream = new PassThrough();
            const chunks = [];
            outStream.on('data', chunk => chunks.push(chunk));
            outStream.on('end', () => resolve(Buffer.concat(chunks)));
            outStream.on('error', (err) => reject(err));

            ffmpeg(url)
                .audioCodec('libopus')
                .toFormat('opus')
                .on('error', (err) => {
                    console.error('❌ FFmpeg Error:', err.message);
                    reject(err);
                })
                .pipe(outStream);
        });
    } catch (error) {
        console.error('❌ getVoiceBuffer Error:', error.message);
        return null;
    }
}