import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import * as googleTTS from 'google-tts-api';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import os from 'os';
import { getMemories, searchMemoriesRAG, searchMemories, addMemory, getSetting, setSetting, getAllCustomModes, getGroupHistory } from './db.js';
import { recordTokenUsage } from './db.js';
export { recordTokenUsage };
import { buildContext, summarizeConversationAsync } from './contextBuilder.js';
import { extractFactsAsync } from './userProfile.js';
import { searchWeb } from './search.js';
import { warn, error as logError } from '../utils/logger.js';

// Use system ffmpeg on Linux (STB) for better compatibility, static on Windows
const actualFfmpegPath = os.platform() === 'win32' ? ffmpegPath : 'ffmpeg';
ffmpeg.setFfmpegPath(actualFfmpegPath);

let _client = null;
let _geminiClient = null;
let _anthropicClient = null;
let _activeModel = null;

// 9Router model cache for combo
let _9routerModelsCache = [];
let _9routerCacheTime = 0;
let _9routerFailedModels = new Set();
const _9ROUTER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const _9ROUTER_EXCLUDE = /asr|whisper|embedding|rerank|classification|tts|speech|glm4\.7|z-ai/i;

export function getGroqClient() {
    if (_client) return _client;
    const apiKey = getSetting('GROQ_API_KEY') || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY tidak dikonfigurasi.');
    _client = new Groq({ apiKey });
    return _client;
}

export function getGeminiClient() {
    if (_geminiClient) return _geminiClient;
    const apiKey = getSetting('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY tidak dikonfigurasi.');
    _geminiClient = new GoogleGenerativeAI(apiKey);
    return _geminiClient;
}

export function getAnthropicClient() {
    if (_anthropicClient) return _anthropicClient;
    const apiKey = getSetting('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY tidak dikonfigurasi.');
    _anthropicClient = new Anthropic({ apiKey });
    return _anthropicClient;
}

export function getModel() {
    if (_activeModel) return _activeModel;
    _activeModel = getSetting('GROQ_MODEL') || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    return _activeModel;
}

export function reloadAI() {
    _client = null;
    _geminiClient = null;
    _anthropicClient = null;
    _activeModel = null;
    console.log('🔄 AI service reloaded (key & model from DB)');
}

async function refresh9RouterModels() {
    try {
        const apiKey = getSetting('9ROUTER_API_KEY') || process.env['9ROUTER_API_KEY'];
        if (!apiKey) return;
        const resp = await fetch('https://ai.akf.biz.id/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const models = (data.data || data.models || [])
            .map(m => m.id || m)
            .filter(id => !_9ROUTER_EXCLUDE.test(id) && !id.startsWith('thirty/'))
            .sort(() => Math.random() - 0.5);
        if (models.length > 0) {
            _9routerModelsCache = models;
            _9routerCacheTime = Date.now();
        }
    } catch (err) {
        warn('9Router model refresh: ' + err.message);
    }
}

export async function fetchAvailableModels() {
    try {
        const apiKey = getSetting('GROQ_API_KEY') || process.env.GROQ_API_KEY;
        if (!apiKey) return [];
        const resp = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.data || [])
            .filter(m => m.active && m.id && !m.id.includes('whisper') && !m.id.startsWith('text-'))
            .map(m => ({ id: m.id, owned: m.owned_by || '' }))
            .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
        return [];
    }
}

export function getFallbackModels() {
    const primary = getModel();
    const known = [
        'llama-3.3-70b-versatile',
        'deepseek-r1-distill-llama-70b',
        'llama-3.1-70b-versatile',
        'gemma2-9b-it',
        'mixtral-8x7b-32768',
    ];
    return [primary, ...known.filter(m => m !== primary)];
}

const BASE_MODES = {
    asik: `IDENTITAS — Kamu adalah teman deket yang nyambung dan apa adanya.
CARA BICARA — lo/gw, singkatan natural, santai.`,
    bad: `IDENTITAS — Persona blak-blakan, sinis, brutal apa adanya.`,
    formal: `IDENTITAS — Asisten formal berbahasa Indonesia baku sesuai EYD.`,
    profesional: `IDENTITAS — Konsultan senior lintas bidang: bisnis, teknologi, strategi.`,
};

const BASE_TEMPS = { asik: 0.85, bad: 0.85, formal: 0.5, profesional: 0.6 };
let _modesCache = null;

export function invalidateModeCache() { _modesCache = null; }

function getModes() {
    if (_modesCache) return _modesCache;
    const modes = { ...BASE_MODES };
    getAllCustomModes().forEach(c => { modes[c.name] = c.system_prompt; });
    _modesCache = modes;
    return modes;
}

function getModeTemperatures() {
    const temps = { ...BASE_TEMPS };
    getAllCustomModes().forEach(c => { temps[c.name] = c.temperature; });
    return temps;
}

const GLOBAL_RULES = `ATURAN GLOBAL:
- Nama: Thirty. Ciptaan: Maha Raja Ahdi Khalida Fathir.
- JANGAN sebut model aslimu (Groq/Gemini/Llama).
- Gunakan bahasa Indonesia santai (kecuali mode formal).
- Singkat, padat, jangan bertele-tele.
- WhatsApp gak render LaTeX, pakai teks biasa.
- KAMU BISA MENCARI DI INTERNET (Web Search). Kamu punya akses ke tool web_search. Gunakan jika user menanyakan info real-time, berita, cuaca, atau data terbaru yang tidak kamu ketahui.
- KALAU USER GANTI TOPIK: langsung ikut. JANGAN sebut topik lama lagi.
- Konteks/referensi dari lampiran cuma latar belakang. JANGAN disebut di jawaban kalo gak relevan.
- Jangan tanya "tadi bahas X, sekarang Y?" — ikutin alur natural.`;

const AI_TOOLS = [
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Cari informasi terbaru di internet (berita, harga crypto, cuaca, fakta real-time).",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Query pencarian yang spesifik (misal: 'harga btc hari ini', 'presiden amerika 2026').",
                    },
                },
                required: ["query"],
            },
        },
    },
];


export async function callAI(prompt, history = [], mode = 'asik', chatId = null, contextBlock = '') {
    try {
        const modeKey = mode.toLowerCase();
        const personality = getModes()[modeKey] || getModes()['asik'];
        const temperature = getModeTemperatures()[modeKey] ?? 0.85;
        const SYSTEM_PROMPT = `${personality}\n\n${GLOBAL_RULES}\n\n${contextBlock ? `(lampiran - ${contextBlock})` : ''}`;

        let messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: prompt },
        ];

        const client = getGroqClient();
        const fbModels = getFallbackModels();
        
        for (const model of fbModels) {
            try {
                let response = await client.chat.completions.create({
                    model,
                    messages,
                    max_tokens: 1024,
                    temperature,
                    tools: AI_TOOLS,
                    tool_choice: "auto",
                });

                if (response.usage) recordTokenUsage(response.usage.prompt_tokens, response.usage.completion_tokens, model);

                let responseMessage = response.choices[0].message;
                const toolCalls = responseMessage.tool_calls;

                if (toolCalls) {
                    messages.push(responseMessage);

                    for (const toolCall of toolCalls) {
                        if (toolCall.function.name === 'web_search') {
                            const { query } = JSON.parse(toolCall.function.arguments);
                            console.log(`🔍 AI calling web_search: "${query}"`);
                            const searchResult = await searchWeb(query);
                            
                            let content;
                            if (searchResult && searchResult.items) {
                                content = searchResult.items.map(i => `Title: ${i.title}\nURL: ${i.url}\nSnippet: ${i.snippet}`).join('\n\n');
                            } else {
                                content = "Gak nemu apa-apa di internet.";
                            }

                            messages.push({
                                tool_call_id: toolCall.id,
                                role: "tool",
                                name: "web_search",
                                content: content,
                            });
                        }
                    }

                    const finalResponse = await client.chat.completions.create({
                        model,
                        messages,
                        max_tokens: 1024,
                        temperature,
                    });

                    if (finalResponse.usage) recordTokenUsage(finalResponse.usage.prompt_tokens, finalResponse.usage.completion_tokens, model);
                    return finalResponse.choices[0]?.message?.content || 'Gak ada jawaban setelah search.';
                }

                return responseMessage.content || 'Gak ada jawaban.';
            } catch (err) {
                if (err?.status === 401 || err?.status === 403) throw err;
                warn(`Model ${model} error/limit: ${err.message}`);
            }
        }
        return 'Semua model Groq lagi sibuk bos.';
    } catch (err) {
        logError('Groq callAI', err);
        return `Error: ${err.message}`;
    }
}

export async function callAIGemini(prompt, history = [], mode = 'asik', chatId = null, contextBlock = '') {
    try {
        const genAI = getGeminiClient();
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const personality = getModes()[mode.toLowerCase()] || getModes()['asik'];
        const SYSTEM_PROMPT = `${personality}\n\n${GLOBAL_RULES}\n\n${contextBlock ? `(lampiran - ${contextBlock})` : ''}`;

        const chat = model.startChat({
            history: history.map(h => ({
                role: h.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: h.content }]
            })),
            generationConfig: { maxOutputTokens: 1024, temperature: 0.85 },
        });

        const result = await chat.sendMessage(`${SYSTEM_PROMPT}\n\nUser: ${prompt}`);
        const response = await result.response;
        const text = response.text();
        recordTokenUsage(prompt.length / 4, text.length / 4, 'gemini-1.5-flash');
        return text;
    } catch (err) {
        logError('Gemini Error', err);
        return null;
    }
}

export async function callAIAnthropic(prompt, history = [], mode = 'asik', chatId = null, contextBlock = '') {
    try {
        const client = getAnthropicClient();
        const personality = getModes()[mode.toLowerCase()] || getModes()['asik'];
        const SYSTEM_PROMPT = `${personality}\n\n${GLOBAL_RULES}\n\n${contextBlock ? `(lampiran - ${contextBlock})` : ''}`;

        const msg = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: history.map(h => ({ role: h.role, content: h.content })).concat([{ role: 'user', content: prompt }])
        });

        recordTokenUsage(msg.usage.input_tokens, msg.usage.output_tokens, 'claude-3-haiku');
        return msg.content[0].text;
    } catch (err) {
        logError('Anthropic Error', err);
        return null;
    }
}

export async function callAI9Router(prompt, history = [], mode = 'asik', chatId = null, contextBlock = '') {
    const apiKey = getSetting('9ROUTER_API_KEY') || process.env['9ROUTER_API_KEY'];
    if (!apiKey) return null;

    if (Date.now() - _9routerCacheTime > _9ROUTER_CACHE_TTL) await refresh9RouterModels();
    const model = _9routerModelsCache.length > 0 
        ? _9routerModelsCache[Math.floor(Math.random() * _9routerModelsCache.length)]
        : 'openrouter/openrouter/free';

    try {
        const personality = getModes()[mode.toLowerCase()] || getModes()['asik'];
        const SYSTEM_PROMPT = `${personality}\n\n${GLOBAL_RULES}\n\n${contextBlock ? `(lampiran - ${contextBlock})` : ''}`;

        const resp = await fetch('https://ai.akf.biz.id/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: prompt }],
                max_tokens: 1024
            })
        });

        if (!resp.ok) return null;
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) recordTokenUsage(data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0, model);
        return text;
    } catch { return null; }
}

export async function chatWithProvider(prompt, history = [], mode = 'asik', chatId = null, contextBlock = '') {
    const provider = getSetting('AI_PROVIDER') || 'groq';
    let result = null;

    if (provider === 'gemini') result = await callAIGemini(prompt, history, mode, chatId, contextBlock);
    else if (provider === 'anthropic') result = await callAIAnthropic(prompt, history, mode, chatId, contextBlock);
    else if (provider === '9router') result = await callAI9Router(prompt, history, mode, chatId, contextBlock);

    if (result) return result;
    return callAI(prompt, history, mode, chatId, contextBlock);
}

export async function chatWithContext(userMessage, mode = 'asik', chatId = null) {
    const ctx = buildContext(chatId, userMessage, false);
    if (chatId) extractFactsAsync(chatId, userMessage).catch(() => {});

    const history = ctx.history.map(m => ({
        role: (m.sender === 'Thirty (Bot)' || m.sender === 'Thirty') ? 'assistant' : 'user',
        content: m.message,
    }));

    const result = await chatWithProvider(userMessage, history, mode, chatId, ctx.contextText || '');
    if (chatId && ctx.history.length > 8) summarizeConversationAsync(chatId).catch(() => {});
    return result;
}

// ... existing utility functions (transcribe, voice, etc.) ...
export async function transcribeAudio(filePath) {
    try {
        const transcription = await getGroqClient().audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-large-v3-turbo",
            language: "id"
        });
        return transcription.text;
    } catch { return null; }
}

export async function callAIVision(prompt, base64Image, mode = 'asik', chatId = null, contextBlock = '') {
    try {
        const modeKey = mode.toLowerCase();
        const personality = getModes()[modeKey] || getModes()['asik'];
        const SYSTEM_PROMPT = `${personality}\n\n${GLOBAL_RULES}\n\nKamu sedang melihat gambar yang dikirim user. Berikan analisis yang mendalam, detail, dan natural sesuai kepribadianmu.\n\n${contextBlock ? `(lampiran: ${contextBlock})` : ''}`;

        const completion = await getGroqClient().chat.completions.create({
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: [
                    { type: "text", text: prompt || "Jelaskan gambar ini sesantai mungkin namun tetap informatif." },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                ] }
            ],
            max_tokens: 1024,
            temperature: 0.8,
        });
        
        const response = completion.choices[0]?.message?.content || 'Gak kelihatan jelas.';
        if (completion.usage) recordTokenUsage(completion.usage.prompt_tokens, completion.usage.completion_tokens, 'meta-llama/llama-4-scout-17b-16e-instruct');
        
        return response;
    } catch (err) { 
        logError('Vision Error', err);
        return 'Maaf, mata AI saya lagi kelilipan (error vision).'; 
    }
}

export async function extractFromDocument(chatId, text, fileName) {
    try {
        const groq = getGroqClient();
        const prompt = `Ekstrak fakta penting, nama, atau informasi relevan dari dokumen "${fileName}" ini:\n\n"""\n${text}\n"""\n\nFormat: list poin-poin singkat.`;
        
        const completion = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 512,
        });
        
        const facts = completion.choices[0]?.message?.content;
        if (facts) {
            addMemory(chatId, `Fakta dari ${fileName}: ${facts}`, 'document_fact', 5, 'document');
        }
    } catch (err) {
        logError('Extract document', err);
    }
}

export function getVoiceUrl(text, lang = 'id') {
    try { return googleTTS.getAudioUrl(text.substring(0, 200), { lang, slow: false, host: 'https://translate.google.com' }); }
    catch { return null; }
}

export async function getVoiceBuffer(text, lang = 'id') {
    try {
        const url = getVoiceUrl(text, lang);
        if (!url) return null;
        const resp = await fetch(url);
        const arrayBuffer = await resp.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (err) {
        logError('getVoiceBuffer', err);
        return null;
    }
}

export async function summarizeText(text, mode = 'asik', chatId = null) {
    try {
        const modeKey = mode.toLowerCase();
        const allModes = getModes();
        const personality = allModes[modeKey] || allModes['asik'];
        const prompt = `Rangkum teks berikut secara informatif:\n\n"""\n${text}\n"""\n\nBuat ringkasan padat 3-5 kalimat.`;
        return await callAI(prompt, [], mode, chatId);
    } catch (err) {
        logError('Summarize', err);
        return 'Gagal merangkum.';
    }
}

const LEARNING_INTERVAL = 8;

export async function extractAndStoreMemories(chatId, recentHistory) {
    if (!chatId || !recentHistory || recentHistory.length < 3) return;

    const conversationText = recentHistory
        .map(m => `[${m.sender}]: ${m.message}`)
        .join('\n');

    try {
        const completion = await getGroqClient().chat.completions.create({
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
        if (completion.usage) {
            recordTokenUsage(completion.usage.prompt_tokens, completion.usage.completion_tokens, 'llama-3.1-8b-instant');
        }

        const raw = completion.choices[0]?.message?.content?.trim();
        if (!raw || raw === '[]') return;

        let facts;
        try {
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            facts = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
        } catch {
            warn('Memory extraction JSON parse failed: ' + raw.substring(0, 200));
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
        logError('Memory extraction', error);
    }
}

export function getLearningInterval() {
    return LEARNING_INTERVAL;
}
