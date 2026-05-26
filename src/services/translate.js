import { callAI } from './ai.js';

/**
 * Translate text using AI
 * @param {string} text 
 * @param {string} targetLang 
 * @returns {Promise<string>}
 */
export async function translate(text, targetLang = 'Indonesia') {
    const prompt = `Terjemahkan teks berikut ke dalam bahasa ${targetLang}. Deteksi bahasa asalnya secara otomatis. Berikan HANYA hasil terjemahannya saja tanpa penjelasan apapun.\n\nTeks: """${text}"""`;
    
    try {
        const result = await callAI(prompt, [], 'formal');
        return result.trim();
    } catch (err) {
        console.error('Translation error:', err.message);
        throw new Error('Gagal menerjemahkan teks.');
    }
}
