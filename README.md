# 🤖 THIRTY AI - WhatsApp Assistant

**Thirty AI** adalah bot WhatsApp cerdas berbasis AI yang dikembangkan untuk menjadi asisten serba bisa. Bot ini menggunakan otak **Llama 3.3 70B** dari Groq untuk percakapan yang natural, cerdas, dan responsif.

> Diciptakan dengan bangga oleh: **Maha Raja Ahdi Khalida Fathir** 👑

---

## ✨ Fitur Unggulan

### 🎙️ 1. AI Voice Note (Telinga & Mulut AI)
- **Mendengar:** Menggunakan `Whisper-large-v3-turbo` untuk merubah Voice Note kamu menjadi teks secara akurat.
- **Berbicara:** Membalas pesan suara kamu dengan Voice Note AI (Google TTS) yang sudah dikonversi ke format `.ogg` Opus sehingga lancar diputar di HP.

### 👁️ 2. Vision AI (Mata AI)
- Mampu menganalisis gambar atau foto yang dikirimkan. Cukup tag bot pada sebuah gambar, dan tanyakan apa saja tentang gambar tersebut.

### 🎨 3. HD Sticker Maker
- Ubah gambar apa saja menjadi stiker WhatsApp berkualitas tinggi secara instan.
- Cukup ketik perintah `/s` atau `/sticker` pada caption gambar atau melalui reply.

### 📅 4. AI Scheduler & Reminder
- **Otomatis:** Cukup katakan *"Thirty, ingatin besok jam 7 pagi ada meeting"*, bot akan otomatis mencatat jadwal tersebut.
- **Manual:** Gunakan perintah `/jadwal` untuk melihat atau menghapus daftar agenda.

### 🧠 5. Context-Aware Memory
- Bot memiliki ingatan percakapan singkat, sehingga kamu bisa ngobrol secara mengalir tanpa harus mengulang konteks dari awal.

### 🔐 6. Enterprise Security & Whitelist
- Bot dilengkapi sistem keamanan **LID-based Authentication**.
- Hanya pengguna yang di-*whitelist* oleh Owner (Maha Raja) yang bisa mengakses fitur AI.

---

## 🚀 Cara Instalasi

### Prasyarat
- Node.js (v24+)
- FFmpeg (Sudah termasuk dalam paket `ffmpeg-static`)
- Groq API Key (Dapatkan di [Groq Console](https://console.groq.com/))

### Langkah-langkah
1. **Clone Repository**
   ```bash
   git clone https://github.com/ahdikhfDev/bot-wa.git
   cd bot-wa
   ```

2. **Install Dependensi**
   ```bash
   npm install
   ```

3. **Konfigurasi Environment**
   Buat file `.env` dan isi dengan data berikut:
   ```env
   GROQ_API_KEY=your_groq_api_key
   OWNER_NUMBER=628xxx (Nomor WhatsApp Anda)
   PREFIX=/
   ```

4. **Jalankan Bot**
   ```bash
   npm start
   ```
   Scan QR Code yang muncul di terminal menggunakan WhatsApp Anda.

---

## 🛠️ Daftar Perintah (Commands)

| Perintah | Deskripsi |
| --- | --- |
| `/help` | Menampilkan menu bantuan lengkap |
| `/s` atau `/sticker` | Membuat stiker dari gambar |
| `/say [teks]` | Membuat bot berbicara (Voice Note) |
| `/mode [nama_mode]` | Ganti kepribadian (asik, bad, profesional, formal) |
| `/rangkum` | Meringkas riwayat chat yang panjang |
| `/jadwal list` | Melihat daftar agenda tersimpan |
| `/reset` | Menghapus memori bot di chat tersebut (Owner Only) |

---

## 🛡️ Admin & Owner Commands
- `/allow [nomor]` : Memberikan akses bot ke pengguna lain.
- `/ban [nomor]` : Mencabut akses bot.
- `/list` : Melihat daftar whitelist.

---

## 📦 Deployment Note
Bot ini dioptimalkan untuk berjalan pada hardware rendah seperti **STB HG680P** dengan RAM 2GB. Pastikan untuk menjalankan bot menggunakan `pm2` agar tetap online 24/7.

---

*© 2026 Maha Raja Ahdi Khalida Fathir. All Rights Reserved.*