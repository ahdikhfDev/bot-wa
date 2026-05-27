export default {
    name: 'help',
    title: 'Bantuan',
    description: 'Tampilkan daftar perintah bot',
    commands: ['help', 'menu'],

    async handler(sock, remoteJid) {
        const helpText = `✨ *THIRTY AI — Daftar Perintah* ✨

🤖 *AI & CHAT*
• Ngobrol langsung di DM atau panggil "Thirty" di grup
• 🎨 */mode [nama]* : Ganti kepribadian AI
• 🗑️ */reset* : Reset konteks percakapan
• 📝 */rangkum [teks]* : Ringkas teks panjang

🔍 *SEARCH & INFO*
• 🔍 */search [query]* atau */cari* : Cari info di web
• 🌤️ */cuaca [kota]* atau */weather* : Cek cuaca
• 💱 */kurs [USD/IDR]* : Kurs mata uang
• 🌐 */ip* : Cek IP publik
• 🔳 */qr [teks]* : Generate QR code
• 📰 */hn* : Trending Hacker News
• 📺 */tv [judul]* : Cari info acara TV

🕌 *ISLAMI*
• 🕌 */sholat [kota]* : Jadwal sholat (Aladhan/Kemenag)
• 🌅 */imsak [kota]* : Jadwal imsak

🎨 *KREATIF*
• 🎨 */gambar [deskripsi]* : Generate gambar AI (Pollinations)
• 🎬 */buatvideo [style] [topik]* : Video AI + suara natural
   Styles: edukasi, fakta, story, quotes
   Contoh: /buatvideo fakta kenapa langit biru
• 📱 */konten [style] [topik]* : Konten cepet (lebih cepat)
   • /konten fakta [...]   • /konten quotes [...]
   • /konten edukasi [...]   • /konten story [...]
• 😂 */buatvideo roast [target]* : Video roasting brutal

🎮 *GAME*
• 🎮 */tebak* : Game tebak kata (Hangman)
• 🛑 */tebak stop* : Berhenti main

🎬 *MEDIA*
• 🖼️ */sticker* atau */s* : Balas foto → stiker
• 🗣️ */say [teks]* : Bot bacain teks (suara natural)
• 📸 */ss [url]* : Screenshot website
• 🔗 */preview [url]* atau */priview* : Preview link

📅 *JADWAL & REMINDER*
• 📅 */jadwal add/hapus/list* : Atur jadwal grup
• ⏰ */reminder [waktu] [pesan]* : Buat pengingat
• 🕌 */setjadwalsholat [kota]* : Notif sholat otomatis
• 🚫 */unsetjadwalsholat* : Matiin notif sholat

⏰ *AUTOMATION*
• 📋 */schedule list* : Lihat semua job otomatis
• ➕ */schedule add [nama] [HH:MM] [pesan]* : Pesan auto
• 📰 */schedule news [HH:MM] [topik]* : Auto-berita harian
• ❌ */schedule remove [nama]* : Hapus job
• 🔄 */schedule toggle [nama]* : Hidup/matiin job
• 👋 **Auto-Welcome** • Sambut anggota baru otomatis
• 🔗 **Auto-Preview** • Preview link otomatis di grup

📄 *DOKUMEN & MEDIA*
• Kirim *PDF/DOCX* : Bot baca & jelaskan
• Kirim *foto* : Analisis gambar (Vision AI)
• Kirim *Voice Note* : Bot dengerin & balas

🛡️ *COMMUNITY (Second Admin)*
• 🛡️ */community on* : Aktifkan second admin bot
• ⚙️ */community config* : Atur detail moderasi
• ⚠️ */community warn @user* : Beri peringatan
• 📊 */community stats* : Statistik moderasi
• 📰 */it [github|devto|hackernews|arxiv]* : Konten IT manual
• 🌅 */digest* : Daily digest IT
• /community off : Nonaktifkan

📊 *STATS*
• 📊 */stats* atau */status* : Statistik bot
• 🌍 */gempa* : Info gempa dari BMKG

👑 *OWNER ONLY*
• 👥 */allow [nomor]* : Izinkan user
• 👥 */ban [nomor]* : Blokir user
• 👥 */list* : Lihat whitelist
• 📢 */broadcast [pesan]* : Broadcast ke grup
• 📋 */template* : Template pesan siap pakai

💡 *TIPS:*
• Di *Grup*: panggil "Thirty", @mention, atau reply pesan bot
• Di *Private*: langsung ngobrol aja
• /browser [tugas] - Cari info lengkap + analisis AI
• /stock - Lihat stock content

Ciptaan: *Maha Raja Ahdi Khalida Fathir* 👑

© 2026 Thirty AI`.trim();

        await sock.sendMessage(remoteJid, { text: helpText });
    }
};
