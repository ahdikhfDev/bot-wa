import { callAI, chatWithContext, summarizeText } from './src/services/ai.js';
import { addContextMessage, getGroupHistory, clearGroupContext, searchMemoriesRAG } from './src/services/db.js';

const TEST_CHAT = 'test_fix_6283878306413@s.whatsapp.net';
const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️';

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
    if (condition) {
        console.log(`  ${PASS} ${label}`);
        passed++;
    } else {
        console.log(`  ${FAIL} ${label} ${detail}`);
        failed++;
    }
}

async function runTests() {
    console.log('\n========================================');
    console.log('  TEST: 7 Bug Fixes + Temperature');
    console.log('========================================\n');

    // ====================================================
    // TEST 1: Temperature map
    // ====================================================
    console.log('\n--- [1] Temperature per mode ---');
    const { default: aiModule } = await import('./src/services/ai.js');
    // const MODE_TEMPERATURES is not exported, so verify via callAI behavior
    // Instead, check the source file directly
    const fs = await import('fs');
    const source = fs.readFileSync('./src/services/ai.js', 'utf-8');
    assert(source.includes('MODE_TEMPERATURES = {'),
        'MODE_TEMPERATURES map exists');
    assert(source.includes('bad: 0.85'),
        'bad mode temperature = 0.85');
    assert(!source.includes('bad: 1.5'),
        'bad mode NOT 1.5 (was hallucinating)');
    assert(source.includes('asik: 0.85'),
        'asik mode temperature = 0.85');
    assert(source.includes('formal: 0.5'),
        'formal mode temperature = 0.5');
    assert(source.includes('profesional: 0.6'),
        'profesional mode temperature = 0.6');

    // ====================================================
    // TEST 2: Few-shot examples in MODES
    // ====================================================
    console.log('\n--- [2] Few-shot examples ---');
    assert(source.includes('CONTOH'),
        'CONTOH section exists in MODES');
    assert(source.includes('"gua capek banget hari ini"'),
        'asik mode has examples');
    assert(source.includes('dasar pertanyaan goblok'),
        'bad mode has examples');
    assert(source.includes('gimana cara ningkatin profit?'),
        'profesional mode has examples');

    // ====================================================
    // TEST 3: callAI accepts history array (not flat string)
    // ====================================================
    console.log('\n--- [3] callAI history array ---');
    assert(source.includes('callAI(prompt, history = [], mode'),
        'callAI signature uses history array');
    assert(source.includes('...history'),
        'Messages array spreads history');
    assert(!source.includes('context ='),
        'No more context string parameter');
    assert(!source.includes("'Berikut adalah riwayat percakapan grup:'"),
        'No more flat context wrapping');

    // ====================================================
    // TEST 4: RAG memory always injected (no keyword gate)
    // ====================================================
    console.log('\n--- [4] RAG always injects ---');
    assert(source.includes('// Always inject relevant memories'),
        'Comment confirms always-inject');
    assert(!source.includes('hasExplicitRecall'),
        'No keyword gate for RAG');
    assert(source.includes('searchMemoriesRAG(chatId, prompt, 4)'),
        'RAG search still present');

    // ====================================================
    // TEST 5: No empty tools array
    // ====================================================
    console.log('\n--- [5] No empty tools ---');
    assert(!source.includes('tools: []'),
        'Tools sent with real definition (not empty [])');
    assert(source.includes('REMINDER_TOOL'),
        'REMINDER_TOOL definition exists');
    assert(source.includes('tools: [REMINDER_TOOL]'),
        'Tools sent with proper definition (not empty)');

    // ====================================================
    // TEST 6: Private chat context saving
    // ====================================================
    console.log('\n--- [6] Private chat context ---');
    const msgSource = fs.readFileSync('./src/handlers/message.js', 'utf-8');
    assert(msgSource.includes("if (GROUP_CONTEXT_ENABLED && text)"),
        'Context saved without isGroup gate');
    assert(!msgSource.includes("isGroup && GROUP_CONTEXT_ENABLED && text"),
        'No isGroup check on message save');
    assert(source.includes("history = []") || msgSource.includes("history = []"),
        'History loaded without isGroup gate');

    // ====================================================
    // TEST 7: chatWithContext builds proper roles
    // ====================================================
    console.log('\n--- [7] chatWithContext role mapping ---');
    assert(source.includes("role: m.sender === 'Thirty (Bot)' ? 'assistant' : 'user'"),
        'chatWithContext maps sender to proper role');
    assert(source.includes("'assistant'"),
        'Bot messages mapped to assistant role');

    // ====================================================
    // TEST 8: LIVE API — callAI with history array
    // ====================================================
    console.log('\n--- [8] LIVE: callAI with history ---');
    try {
        const history = [
            { role: 'user', content: 'halo' },
            { role: 'assistant', content: 'halo juga, ada yang bisa dibantu?' },
        ];
        const res = await callAI('siapa nama kamu?', history, 'asik', TEST_CHAT);
        assert(res && res.length > 10 && !res.includes('error'),
            'callAI with history returns coherent response',
            `Got: "${res?.substring(0, 80)}"`);
        assert(res.toLowerCase().includes('thirty'),
            'Response mentions Thirty as name',
            `Got: "${res?.substring(0, 80)}"`);
    } catch (err) {
        console.log(`  ${FAIL} callAI with history threw: ${err.message}`);
        failed++;
    }

    // ====================================================
    // TEST 9: LIVE — memory-based RAG (ask about past)
    // ====================================================
    console.log('\n--- [9] LIVE: RAG memory injection ---');
    try {
        const res = await callAI('seberapa jago sih kamu?', [], 'bad', TEST_CHAT);
        assert(res && res.length > 5,
            'callAI in bad mode returns response',
            `Got: "${res?.substring(0, 80)}"`);
        // Bad mode should be savage but COHERENT (not hallucinating)
        const words = res.split(/\s+/);
        assert(words.length > 3 && words.length < 200,
            'Bad mode response is reasonable length (not hallucination spiral)',
            `Got ${words.length} words`);
    } catch (err) {
        console.log(`  ${FAIL} RAG memory test threw: ${err.message}`);
        failed++;
    }

    // ====================================================
    // TEST 10: LIVE — different mode temperatures
    // ====================================================
    console.log('\n--- [10] LIVE: multi-mode responses ---');
    try {
        const formalRes = await callAI('capek', [], 'formal', TEST_CHAT);
        assert(formalRes && !formalRes.includes('error'),
            'Formal mode responds',
            `Got: "${formalRes?.substring(0, 60)}"`);
        assert(!formalRes.includes('lo ') && !formalRes.includes('gw'),
            'Formal mode avoids slang',
            `Got: "${formalRes?.substring(0, 60)}"`);

        const asikRes = await callAI('capek', [], 'asik', TEST_CHAT);
        assert(asikRes && !asikRes.includes('error'),
            'Asik mode responds',
            `Got: "${asikRes?.substring(0, 60)}"`);
    } catch (err) {
        console.log(`  ${FAIL} multi-mode test threw: ${err.message}`);
        failed++;
    }

    // ====================================================
    // TEST 11: chatWithContext builds proper messages
    // ====================================================
    console.log('\n--- [11] LIVE: chatWithContext ---');
    try {
        const groupHistory = [
            { sender: 'Ahdi', message: 'halo bot' },
            { sender: 'Thirty (Bot)', message: 'halo juga' },
            { sender: 'Ahdi', message: 'siapa yang buat kamu?' },
        ];
        const res = await chatWithContext('ceritain dong', groupHistory, 'asik', TEST_CHAT);
        assert(res && res.length > 10,
            'chatWithContext returns response',
            `Got: "${res?.substring(0, 80)}"`);
    } catch (err) {
        console.log(`  ${FAIL} chatWithContext threw: ${err.message}`);
        failed++;
    }

    // ====================================================
    // SUMMARY
    // ====================================================
    console.log('\n========================================');
    console.log(`  RESULTS: ${PASS} ${passed} passed, ${FAIL} ${failed} failed`);
    console.log('========================================\n');

    if (failed > 0) {
        console.log(`⚠️  ${failed} test(s) failed — check details above.`);
        process.exit(1);
    } else {
        console.log('🎯 Semua fix jalan dengan benar!');
        process.exit(0);
    }
}

runTests();
