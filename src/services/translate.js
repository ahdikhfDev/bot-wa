import Groq from 'groq-sdk';

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const INDO_WORDS = /\b(aku|gw|gue|kamu|yang|dengan|untuk|dari|tidak|akan|bisa|telah|sudah|saya|kami|mereka|dia|ini|itu|dan|atau|di|ke|ada|kenapa|karena|oleh|pada|dalam|antara|seperti|tentang|banget|dong|sih|deh|yah|kok|bro|kak|pak|bu|mas|mbak|nggak|gak|enggak|udah|belum|bukan|jangan|selalu|sering|jarang|paling|sangat|agak|kurang|makin|semakin)\b/i;

export async function translateText(text, targetLang) {
    if (!text) return { error: 'Teks kosong.' };
    const clean = text.trim().substring(0, 1000);

    const isIndo = INDO_WORDS.test(clean);
    const target = targetLang || (isIndo ? 'English' : 'Indonesian');

    try {
        const completion = await client.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: `Terjemahkan teks berikut ke ${target}. Output HANYA teks terjemahan, tanpa kata lain, tanpa tanda kutip, tanpa penjelasan.` },
                { role: 'user', content: clean }
            ],
            max_tokens: 512,
            temperature: 0.1,
        });

        const result = completion.choices[0]?.message?.content?.trim() || clean;
        return { result, from: clean };
    } catch (err) {
        console.error('❌ Translate error:', err.message);
        return { error: 'Gagal translate. Coba lagi.' };
    }
}
