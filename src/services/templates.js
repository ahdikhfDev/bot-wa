function formatValue(val) {
    if (!val || val === '-') return '-';
    if (val.includes('|')) {
        return val.split('|').map((item, i) => {
            const trimmed = item.trim();
            if (/^\d+\./.test(trimmed)) return trimmed;
            return `${i + 1}. ${trimmed}`;
        }).join('\n');
    }
    return val;
}

const TEMPLATES = {
    'meeting': {
        title: '📋 Info Meeting',
        desc: 'Undangan rapat formal + agenda detail',
        content: `*INFO MEETING*

🗓️ *Tanggal:* {tanggal}
⏰ *Waktu:* {waktu}
📍 *Tempat:* {tempat}
📌 *Topik:* {topik}

*Agenda:*
{agenda}

*Tindakan Selanjutnya:*
{tindakan}

*Kesimpulan:*
{kesimpulan}

— Thirty 👑`
    },

    'progress': {
        title: '📣 Info Running Progress',
        desc: 'Pengingat progress harian di lapangan',
        content: `*INFO RUNNING PROGRESS*

🗓️ *{hari}, {tanggal}*
⏰ *{waktu}*
📍 *{lokasi}*
👥 *Divisi:* {divisi}

*Agenda:*
{agenda}

*Catatan:*
{catatan}

*Himbauan:*
• Gunakan APD dengan baik
• Ikuti arahan pimpinan
• Isi absensi basah

— Thirty 👑`
    },

    'pengingat': {
        title: '⏰ Pengingat',
        desc: 'Pengingat umum untuk grup',
        content: `*PENGINGAT*

{pesan}

🗓️ *{hari}, {tanggal}*
⏰ *{waktu}*
📍 *{lokasi}*

— Thirty 👑`
    },

    'pengumuman': {
        title: '📢 Pengumuman',
        desc: 'Pengumuman resmi ke grup',
        content: `*PENGUMUMAN*

{isi}

📌 *{catatan}*

— Thirty 👑`
    },

    'laporan': {
        title: '📊 Laporan Progress',
        desc: 'Laporan perkembangan pekerjaan',
        content: `*LAPORAN PROGRESS*

📅 *{hari}, {tanggal}*
👥 *Divisi:* {divisi}

✅ *Selesai:*
{sudah}

🔄 *Proses:*
{sedang}

❌ *Kendala:*
{kendala}

📌 *Rencana:* {rencana}

— Thirty 👑`
    },

    'absensi': {
        title: '📋 Absensi',
        desc: 'Pengingat isi absensi',
        content: `*INFO ABSENSI*

Diingatkan untuk mengisi absensi hari ini:

🗓️ *{hari}, {tanggal}*
⏰ *Batas:* {waktu}

— Thirty 👑`
    },
};

export function getTemplateList() {
    return Object.entries(TEMPLATES).map(([key, tpl]) => ({
        id: key,
        title: tpl.title,
        desc: tpl.desc,
        fields: getPlaceholders(tpl.content)
    }));
}

export function getTemplate(id) {
    return TEMPLATES[id] || null;
}

export function fillTemplate(id, data) {
    const tpl = TEMPLATES[id];
    if (!tpl) return null;

    let result = tpl.content;
    for (const [key, val] of Object.entries(data)) {
        const formatted = formatValue(val || '-');
        result = result.replaceAll(`{${key}}`, formatted);
    }
    // Replace remaining unfilled placeholders
    result = result.replace(/\{[a-z_]+\}/g, '-');
    return result;
}

function getPlaceholders(text) {
    const matches = text.match(/\{[a-z_]+\}/g);
    return [...new Set(matches || [])].map(m => m.slice(1, -1));
}

export function formatTemplateList() {
    const list = getTemplateList();
    let text = `📋 *Daftar Template*\n\n`;
    list.forEach((tpl, i) => {
        text += `${i + 1}. *${tpl.title}*\n   ${tpl.desc}\n   Fields: ${tpl.fields.join(', ')}\n\n`;
    });
    text += `Kirim:\n/template kirim [nama] [field=nilai]\n\nPake | buat list:\n/template kirim meeting agenda="item 1|item 2|item 3"`;
    return text;
}
