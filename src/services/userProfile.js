import { getUserProfile, saveUserProfile, addUserFact, getAllUserProfiles } from './db.js';

const PERSONAL_KEYWORDS = [
    'nama saya', 'aku', 'saya', 'umur', 'kerja', 'sekolah', 'hobi',
    'suka', 'tinggal', 'punya', 'belajar', 'tugas', 'proyek',
    'coding', 'programming', 'bahasa', 'framework', 'stack'
];

export function getProfile(jid) {
    return getUserProfile(jid);
}

export function getAllProfiles() {
    return getAllUserProfiles();
}

export function updateName(jid, name) {
    const profile = getUserProfile(jid) || {};
    saveUserProfile(jid, name, profile.facts || [], profile.timezone || 'Asia/Jakarta');
}

export function updateTimezone(jid, tz) {
    const profile = getUserProfile(jid) || {};
    saveUserProfile(jid, profile.name || '', profile.facts || [], tz);
}

export async function extractFactsAsync(jid, message) {
    if (!message || message.length < 10) return;

    const lower = message.toLowerCase();

    // Pattern-based extraction (fast, no LLM)
    const facts = [];

    // Name
    const nameMatch = message.match(/(?:nama saya|panggil(?: saja)? aku|aku\s+(\w+))/i);
    if (nameMatch && nameMatch[1] && nameMatch[1].length < 30) {
        facts.push({ type: 'name', value: nameMatch[1] });
    }

    // Preferences: "suka <x>", "hobi <x>"
    const likeMatch = message.match(/(?:suka|hobi|gemar)\s+(membaca|ngoding|main\s+\w+|belajar|jalan|makan|olahraga|game|baca|nonton|masak|foto|\w+)/i);
    if (likeMatch) {
        facts.push({ type: 'interest', value: `Suka ${likeMatch[1]}` });
    }

    // Tech stack mentions
    const techPatterns = ['react', 'vue', 'angular', 'node', 'python', 'golang', 'rust', 'java', 'typescript', 'javascript', 'flutter', 'laravel', 'next', 'tailwind', 'docker', 'mysql', 'postgres', 'mongodb', 'redis'];
    for (const tech of techPatterns) {
        const re = new RegExp(`\\b${tech}\\b`, 'i');
        if (re.test(message)) {
            facts.push({ type: 'tech', value: `Pake ${tech}` });
            break; // one tech per message
        }
    }

    // Work mention
    const workMatch = message.match(/(?:kerja|bekerja|profesi|pekerjaan)\s+(?:sebagai\s+)?(\w+(?:\s+\w+)?)/i);
    if (workMatch) {
        facts.push({ type: 'work', value: `Kerja sebagai ${workMatch[1]}` });
    }

    // Save facts
    for (const fact of facts) {
        if (fact.value.length > 5) {
            addUserFact(jid, fact.value);
            if (fact.type === 'name') {
                updateName(jid, fact.value);
            }
        }
    }

    return facts;
}

export function formatProfileForPrompt(jid) {
    const profile = getUserProfile(jid);
    if (!profile || !profile.facts || profile.facts.length === 0) return '';

    return profile.facts.slice(0, 10).join(', ');
}
