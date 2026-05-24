export default {
    name: 'help',
    title: 'Bantuan',
    description: 'Tampilkan daftar perintah bot',
    commands: ['help'],

    async handler(sock, remoteJid) {
        const helpText = `✨ *THIRTY AI - Command Center* ✨

Halo! Saya adalah *Thirty*, asisten AI cerdas yang siap membantu kebutuhanmu. 🤖🦾

🤖 *PENGATURAN AI*
• 🎨 */mode* : Ganti kepribadian (asik, bad, formal, profesional)

🛠️ *FITUR MULTIMEDIA & SEARCH*
• 🔍 */search* atau "cari [query]" : Cari info di web
• 📰 */cari [berita]* atau "berita [query]" : Cari berita terbaru
• 🎙️ *Voice Note* : Kirim VN, saya dengerin & balas VN
• 👁️ *Vision AI* : Balas foto untuk saya analisis
• 🎨 */s* atau */sticker* : Ubah foto jadi stiker
• 🗣️ */say [teks]* : Suruh saya bicara (Voice Note)
• 📄 *Dokumen/PDF* : Kirim file, saya baca & jelaskan

🌍 *FITUR UTILITY*
• 🌤️ */cuaca [kota]* : Cek cuaca (atau */weather*)
• 🧠 *Auto Learning* : Bot belajar dari percakapan — makin ngobrol makin pinter
• 🧠 *RAG Memory* : Bot ingat topik lama & konten dokumen
• 📝 */rangkum [teks]* : Ringkas teks panjang

📅 *PRODUKTIVITAS*
• 🕒 *Auto Reminder* : "Ingatkan saya [jam] buat [acara]"
• 📅 */jadwal list* : Lihat jadwal grup

👑 *OWNER ONLY*
• 📢 */broadcast list* : Lihat daftar grup
• 📢 */broadcast kirim [pesan]* : Kirim ke SEMUA grup
• 📢 */broadcast kirim 1 3 [pesan]* : Kirim ke grup tertentu aja
• 📋 */template list* : Lihat template pesan siap pakai
• 📋 */template kirim [nama]* : Kirim template ke grup
• 📋 */template isi [nama] [field=nilai]* : Isi field & kirim template

💡 *TIPS:*
• Di *Grup*, saya respon jika dipanggil "Thirty", di-mention, atau reply pesan saya.
• Di *Private Chat*, ngobrol langsung kapan aja!

Ciptaan: *Maha Raja Ahdi Khalida Fathir* 👑`.trim();

        await sock.sendMessage(remoteJid, { text: helpText });
    }
};
