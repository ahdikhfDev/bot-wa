import { getGroupHistory, getConversationSummary, getUserProfile, searchMemoriesRAG } from './db.js';

const MAX_HISTORY_TOKENS = 2500;
const MAX_CONTEXT_TOKENS = 4000;

function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
}

function formatHistoryForContext(messages) {
    if (!messages || !messages.length) return '';
    return messages.map(m => `[${m.sender}]: ${m.message}`).join('\n');
}

export function buildContext(chatId, prompt) {
    const parts = [];
    let totalTokens = 0;

    // 1. User profile
    const profile = chatId ? getUserProfile(chatId) : null;
    if (profile && profile.facts && profile.facts.length > 0) {
        const factText = profile.facts.slice(0, 8).join('; ');
        const block = `📋 *Profil User:* ${factText}`;
        parts.push({ type: 'profile', text: block });
        totalTokens += estimateTokens(block);
    }

    // 2. Conversation summary
    let summary = '';
    if (chatId) {
        summary = getConversationSummary(chatId);
        if (summary) {
            const block = `📝 *Ringkasan percakapan:* ${summary}`;
            parts.push({ type: 'summary', text: block });
            totalTokens += estimateTokens(block);
        }
    }

    // 3. RAG memories
    let memories = [];
    if (chatId && prompt) {
        try {
            memories = searchMemoriesRAG(chatId, prompt, 4);
        } catch {}
    }
    if (memories.length > 0) {
        const memText = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
        const block = `🧠 *Yang kamu ingat:*\n${memText}`;
        parts.push({ type: 'memories', text: block });
        totalTokens += estimateTokens(block);
    }

    // 4. Recent history (load more, trim by token budget)
    let history = chatId ? getGroupHistory(chatId, 20) : [];
    const historyBudget = MAX_HISTORY_TOKENS - Math.min(totalTokens, 1000);

    // Format history reverse for display (newest last matches prompt flow)
    let formattedHistory = '';
    let trimmedCount = 0;

    if (history.length > 0) {
        formattedHistory = formatHistoryForContext(history);
        let histTokens = estimateTokens(formattedHistory);

        // Trim oldest messages if over budget
        while (histTokens > historyBudget && history.length > 3) {
            history.shift();
            formattedHistory = formatHistoryForContext(history);
            histTokens = estimateTokens(formattedHistory);
            trimmedCount++;
        }

        if (formattedHistory) {
            parts.push({ type: 'history', text: formattedHistory });
            totalTokens += histTokens;
        }
    }

    // Build final context string
    const contextText = parts.map(p => p.text).join('\n\n');

    return {
        contextText,
        history,
        parts: parts.map(p => p.type),
        totalTokens,
        trimmedCount,
        summaryUsed: !!summary,
        memoriesUsed: memories.length,
        profileUsed: !!(profile?.facts?.length)
    };
}

// Async: summarize conversation after response
export async function summarizeConversationAsync(chatId) {
    if (!chatId) return;
    const { default: Groq } = await import('groq-sdk');
    const { getSetting } = await import('./db.js');
    const apiKey = getSetting('GROQ_API_KEY') || process.env.GROQ_API_KEY;
    if (!apiKey || apiKey.startsWith('gsk_') && apiKey.length < 20) return;

    try {
        const history = getGroupHistory(chatId, 20);
        if (history.length < 6) return;

        const client = new Groq({ apiKey });
        const text = history.map(m => `[${m.sender}]: ${m.message}`).join('\n');

        const completion = await client.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{
                role: 'system',
                content: 'Buat ringkasan percakapan 2-3 kalimat dalam Bahasa Indonesia. Fokus pada topik utama, keputusan, dan hal penting. Output HANYA ringkasan, tanpa label.'
            }, {
                role: 'user',
                content: text
            }],
            max_tokens: 256,
            temperature: 0.3
        });

        const summary = completion.choices[0]?.message?.content?.trim();
        if (summary && summary.length > 20) {
            const { saveConversationSummary } = await import('./db.js');
            saveConversationSummary(chatId, summary, history.length);
            console.log(`📝 Summary saved for ${chatId}: ${summary.substring(0, 80)}...`);
        }
    } catch (err) {
        console.warn('⚠️ Summarize error:', err.message);
    }
}
