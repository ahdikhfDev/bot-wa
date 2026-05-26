export default {
    name: 'help',
    title: 'Bantuan',
    description: 'Tampilkan daftar perintah bot',
    commands: ['help'],

    async handler(sock, remoteJid) {
        const helpText = `✨ *THIRTY AI - Daftar Perintah* ✨

🤖 *AI & CHAT*
• Ngobrol langsung di DM atau panggil "Thirty" di grup
• 🎨 */mode [nama]* : Ganti kepribadian (asik, bad, formal, profesional, galak, dll)
• 🗑️ */reset* : Hapus konteks percakapan grup
• 📝 */rangkum [teks]* : Ringkas teks panjang

🔍 *SEARCH & INFO*
• 🔍 */search [query]* atau */cari [query]* : Cari info di web
• 📰 */cari berita [query]* : Cari berita terbaru
• 🌤️ */weather [kota]* atau */cuaca [kota]* : Cek cuaca
• 📄 Kirim *PDF/DOCX* : Bot baca & jelaskan isinya
• 👁️ Kirim *foto* : Bot analisis gambar (Vision AI)
• 🎙️ Kirim *Voice Note* : Bot dengerin & balas
• 🌍 */kurs* : Kurs mata uang asing
• 🌍 */ip [domain]* : Cek info IP/domain
• 🌍 */qr [teks]* : Generate QR code

🎬 *VIDEO & MEDIA*
• 🎬 */buatvideo [topik]* : Generate video AI (edukatif/roasting)
• 🎨 */sticker* atau */s* : Balas foto → jadi stiker
• 🗣️ */say [teks]* : Bot bacain teks jadi Voice Note
• 📹 */tt [caption]* : Upload video ke TikTok

📅 *JADWAL & REMINDER*
• 📅 */jadwal add [hari] [jam] [kegiatan]* : Tambah jadwal grup
• 📅 */jadwal list* : Lihat jadwal grup
• 📅 */jadwal del [nomor]* : Hapus jadwal
• ⏰ */reminder [waktu] [pesan]* : Buat pengingat (alarm 3x)
• ⏰ */reminder list* : Lihat reminder
• ⏰ */reminder delete [nomor]* : Hapus reminder

📊 *INFO & STATS*
• 📊 */stats* atau */status* : Statistik bot
• 🌍 */hn* : Trending di Hacker News
• 🌍 */tv* atau */tvshow* : Info acara TV

👑 *OWNER ONLY*
• 👥 */allow [nomor]* : Izinkan user pakai bot
• 👥 */ban [nomor]* : Blokir user
• 👥 */list* : Lihat whitelist
• 📢 */broadcast [pesan]* : Kirim pesan ke semua grup
• 📋 */template list* : Lihat template pesan

💡 *TIPS:*
• Di *Grup*, bot respon kalo dipanggil "Thirty", di-mention @bot, atau reply pesan bot
• Di *Private Chat*, langsung ngobrol aja
• Roasting video: /buatvideo roasting [nama orang]

Ciptaan: *Maha Raja Ahdi Khalida Fathir* 👑

© 2026 Thirty AI`.trim();

        await sock.sendMessage(remoteJid, { text: helpText });
    }
};
