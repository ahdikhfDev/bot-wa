# THIRTY AI — WhatsApp Assistant

> **Thirty** adalah bot WhatsApp cerdas berbasis AI dengan memori jangka panjang, web search, RAG, dokumen reader, dan banyak lagi. Ditenagai oleh Groq Llama 3.3 70B.

Diciptakan oleh **Maha Raja Ahdi Khalida Fathir** 👑

---

## Fitur

### 🤖 AI Chat
- Percakapan natural dengan **Groq Llama 3.3 70B**
- **4 mode kepribadian:** asik, bad, formal, profesional
- **Context-aware:** ingat 20 pesan terakhir per grup
- **Auto fallback model:** kena rate limit, otomatis pindah model cadangan

### 🧠 RAG & Long-Term Memory
- **Auto-learning:** tiap 8 interaksi, bot ekstrak fakta dari percakapan dan simpan sebagai memori jangka panjang
- **RAG retrieval:** sebelum jawab, bot cari memori relevan pakai BM25 scoring — makin sering ngobrol makin pinter
- **Keyword extraction:** memori disimpan dengan kata kunci untuk pencarian lebih akurat
- **Document learning:** kirim PDF → bot baca → ekstrak pengetahuan → simpen

### 🔍 Web Search
- **Tavily API:** hasil real dari web (kayak Google), 1000 gratis/bulan
- **Natural trigger:** "cari bitcoin", "apa itu blockchain", "berita politik", "search harga emas"
- **Manual:** `/search [query]`, `/cari [query]`
- **News:** "berita [topik]", `/cari [berita]`
- **Wikipedia fallback:** otomatis kalo Tavily limit abis

### 🎙️ Voice & Multimedia
- **Voice Note input:** Whisper transcribe → teks
- **Voice Note output:** Google TTS → Opus audio
- **Vision AI:** analisis gambar via Llama 4 Scout
- **Sticker maker:** `/s` atau `/sticker` dari gambar
- **TTS:** `/say [teks]` — bot bicara pake voice note

### 📄 Document Reader
- Kirim file **PDF** atau dokumen teks → bot baca → jelaskan isinya
- Otomatis simpen pengetahuan dari dokumen ke memori jangka panjang

### 📅 Productivity
- **Auto Reminder:** "ingetin gw 21:54 buat tugas" — bot catat + notifikasi pas waktunya (WIB)
- `/jadwal list` — lihat jadwal grup
- `/jadwal tambah [deskripsi]` — tambah jadwal
- `/jadwal hapus [id]` — hapus jadwal

### 🌤️ Utility
- **Translate:** `/translate [teks]` atau `/tr [teks]` — auto detect bahasa
- **Cuaca:** `/cuaca [kota]` atau `/weather [kota]` — realtime dari wttr.in
- **Rangkum:** `/rangkum [teks]` — ringkas teks panjang

### 📢 Broadcast & Template
- Kirim pesan ke semua grup atau grup tertentu
- `/broadcast list` — lihat daftar grup
- `/broadcast kirim [pesan]` — kirim ke semua grup
- `/broadcast kirim 1 3 [pesan]` — kirim ke grup nomor 1 & 3 aja
- Konfirmasi **y/n** sebelum dikirim

### 📋 Template Pesan
- Template siap pakai buat pengumuman, meeting, progress, absensi, dll
- `/template list` — lihat template
- `/template kirim [nama] [field=nilai]` — kirim dengan isian
- `/template isi [nama] [field=nilai]` — preview dulu
- Dukung list otomatis pake `|` (pipe)
- Dukung kutip `"..."` untuk nilai dengan spasi

### 🛡️ Security
- **Whitelist system:** hanya pengguna tertentu yang bisa akses bot
- `/allow [nomor]` — beri akses
- `/ban [nomor]` — cabut akses
- `/list` — lihat daftar whitelist
- **Anti-spam cooldown:** jeda 1.5 detik antar chat (owner bebas)

### ⚙️ Infrastructure
- **PM2 auto-restart:** tahan 24/7
- **Reconnect logic:** handle koneksi putus + conflict
- **Message dedup:** skip pesan duplikat dalam 3 detik
- **File logging:** log tersimpan di `logs/` directory
- **Graceful shutdown:** handle SIGINT/SIGTERM dengan bersih
- **STB-optimized:** jalan di RAM 2GB

---

## Instalasi

### Prasyarat
- **Node.js** v20+ ([install](https://nodejs.org))
- **npm** (bundled with Node.js)
- **Groq API Key** ([daftar gratis](https://console.groq.com)) — untuk AI chat
- **(Opsional) Tavily API Key** ([daftar gratis](https://tavily.com)) — untuk web search
- **(Opsional) GNews API Key** ([daftar gratis](https://gnews.io)) — untuk berita real-time

### Langkah

```bash
# 1. Clone repo
git clone https://github.com/ahdikhfDev/bot-wa.git
cd bot-wa

# 2. Install dependencies
npm install

# 3. Konfigurasi
cp .env.example .env
# Edit .env — isi GROQ_API_KEY dan OWNER_NUMBER

# 4. Jalankan
npm start
```

Scan QR code yang muncul di terminal dengan WhatsApp **(Settings → Linked Devices → Link a Device)**.

### Production (PM2)

```bash
npm install -g pm2
pm2 start src/index.js --name thirty-bot
pm2 save
pm2 startup
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROQ_API_KEY` | ✅ | - | API key dari Groq Console |
| `OWNER_NUMBER` | ✅ | - | Nomor WhatsApp owner (contoh: 628xxx) |
| `GROQ_MODEL` | ❌ | `llama-3.1-8b-instant` | Model Groq untuk AI |
| `TAVILY_API_KEY` | ❌ | - | Web search (dapatkan di tavily.com) |
| `GNEWS_API_KEY` | ❌ | - | Berita real-time (dapatkan di gnews.io) |
| `DB_PATH` | ❌ | `./src/database.sqlite` | Lokasi database |
| `BOT_NAME` | ❌ | `Thirty` | Nama bot |
| `BOT_PREFIX` | ❌ | `/` | Prefix untuk command |
| `GROUP_CONTEXT_ENABLED` | ❌ | `true` | Aktifkan context per grup |
| `MAX_CONTEXT_MESSAGES` | ❌ | `20` | Maksimal pesan yang diingat |
| `SPAM_COOLDOWN_MS` | ❌ | `1500` | Cooldown anti-spam (ms) |

---

## Command Reference

### AI & Chat

| Command | Deskripsi | Owner Only |
|---------|-----------|:----------:|
| `ngobrol biasa` | Chat bebas di DM atau panggil "Thirty" di grup | ❌ |
| `/mode [mode]` | Ganti kepribadian: `asik`, `bad`, `formal`, `profesional` | ❌ |
| `/rangkum [teks]` | Ringkas teks panjang | ❌ |

### Search & Info

| Command / Trigger | Deskripsi |
|------------------|-----------|
| `"cari [query]"` atau `/search [query]` | Cari di web via Tavily + Wikipedia |
| `"berita [query]"` | Cari berita terbaru |
| `/cuaca [kota]` atau `/weather [kota]` | Cek cuaca sekarang |

### Multimedia

| Command | Deskripsi |
|---------|-----------|
| Kirim **Voice Note** | Bot dengerin & balas pake VN |
| Reply/kirim **foto** | Bot analisis gambar (Vision AI) |
| `/s` atau `/sticker` | Ubah gambar jadi stiker |
| `/say [teks]` | Bot bicara pake voice note |
| Kirim **PDF/Dokumen** | Bot baca + jelaskan + simpen ilmunya |

### Productivitas

| Command / Trigger | Deskripsi |
|------------------|-----------|
| `"ingetin gw [jam] buat [acara]"` | Auto reminder (WIB) |
| `/jadwal list` | Lihat jadwal grup |
| `/jadwal tambah [deskripsi]` | Tambah jadwal |
| `/jadwal hapus [id]` | Hapus jadwal |
| `/translate [teks]` atau `/tr [teks]` | Terjemahkan bahasa asing |

### Owner Only

| Command | Deskripsi |
|---------|-----------|
| `/allow [nomor]` | Beri akses bot ke user |
| `/ban [nomor]` | Cabut akses bot |
| `/list` | Lihat whitelist |
| `/reset` | Reset konteks grup |
| `/broadcast list` | Lihat daftar grup |
| `/broadcast kirim [pesan]` | Kirim ke semua grup |
| `/broadcast kirim 1 3 [pesan]` | Kirim ke grup tertentu |
| `/template list` | Lihat template pesan |
| `/template kirim [nama] [field=nilai]` | Kirim template |
| `/template isi [nama] [field=nilai]` | Preview template |

### Template Fields

| Template | Fields |
|----------|--------|
| `meeting` | `tanggal`, `waktu`, `tempat`, `topik`, `agenda`, `tindakan`, `kesimpulan` |
| `progress` | `hari`, `tanggal`, `waktu`, `lokasi`, `divisi`, `agenda`, `catatan` |
| `pengingat` | `pesan`, `hari`, `tanggal`, `waktu`, `lokasi` |
| `pengumuman` | `isi`, `catatan` |
| `laporan` | `hari`, `tanggal`, `divisi`, `sudah`, `sedang`, `kendala`, `rencana` |
| `absensi` | `hari`, `tanggal`, `waktu` |

> Gunakan `|` untuk membuat list otomatis pada field agenda, tindakan, dll.
> Gunakan `"..."` untuk nilai yang mengandung spasi.

**Contoh:**
```
/template kirim meeting tanggal="15 Mei 2026" waktu="09.00 WIB" tempat="Ruang Rapat" topik="Project Review" agenda="Review progress|Diskusi kendala|Rencana selanjutnya"
```

---

## Arsitektur

```
wa-bot/
├── src/
│   ├── index.js              # Entry point, WA connection, reminders
│   ├── handlers/
│   │   ├── message.js        # Message router + media processing
│   │   └── commands.js       # All command handlers
│   └── services/
│       ├── ai.js             # Groq AI, vision, TTS, learning engine
│       ├── db.js             # SQLite database (memories, jadwal, whitelist)
│       ├── search.js         # Tavily + Wikipedia search
│       ├── templates.js      # Pesan templates
│       ├── translate.js      # Groq-based translation
│       └── weather.js        # wttr.in weather API
│   └── utils/
│       └── logger.js         # File logging
├── .env                      # Environment config
├── .env.example              # Template env
├── package.json
└── README.md
```

### Tech Stack

| Komponen | Teknologi |
|----------|-----------|
| **Runtime** | Node.js (ESM) |
| **WA Library** | Baileys v7 |
| **AI Model** | Groq (Llama 3.3 70B) |
| **Database** | SQLite (sql.js) |
| **Web Search** | Tavily API + Wikipedia |
| **Voice** | Whisper (Groq) + Google TTS |
| **Vision** | Llama 4 Scout (Groq) |
| **Sticker** | wa-sticker-formatter |
| **Process Manager** | PM2 |
| **TTS** | google-tts-api + ffmpeg |

---

## Limit & Rate

| Service | Free Tier | Cadangan |
|---------|-----------|----------|
| **Groq API** | 30 req/min, 500 req/day | Auto fallback model |
| **Tavily API** | 1.000 search/bulan | Wikipedia |
| **GNews API** | 100 req/hari (opsional) | Wikipedia |
| **MyMemory** | 1.000 req/hari (translate) | Groq fallback |

---

## Notes

- Bot dioptimalkan untuk hardware rendah (**STB HG680P, RAM 2GB**)
- Gunakan `pm2` untuk 24/7 operation
- Log error tersimpan di `logs/` directory
- Untuk keamanan, API key disimpan di `.env` (tidak di-commit)
- Pending broadcast menggunakan konfirmasi `y/n` sebelum dikirim

---

<p align="center">
  <sub>© 2026 Maha Raja Ahdi Khalida Fathir</sub>
</p>
