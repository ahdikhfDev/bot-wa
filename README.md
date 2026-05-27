# THIRTY AI — WhatsApp Assistant

> **Thirty** adalah bot WhatsApp cerdas berbasis AI dengan memori jangka panjang, LLM function calling, multi-provider, web dashboard, RAG, dan banyak lagi.

Diciptakan oleh **Maha Raja Ahdi Khalida Fathir** 👑

---

## Fitur

### 🤖 AI Chat dengan Function Calling
- **Multi-provider:** Groq (Llama 3.3 70B) atau OpenAI-compatible (9Router, OpenAI, dll) — bisa pilih lewat dashboard
- **LLM Function Calling:** AI bisa otomatis panggil tool buat data real-time:
  - `search_web` — cari info di internet (Tavily + Wikipedia fallback)
  - `get_weather` — cek cuaca kota real-time via wttr.in
  - `translate_text` — terjemahkan teks asing ke Indonesia
  - `get_earthquake` — info gempa terbaru dari BMKG
  - `get_exchange_rate` — kurs mata uang asing
  - `get_latest_tech_news` — berita teknologi dari Hacker News
  - `add_reminder` — set reminder/pengingat (WIB)
- **7 mode kepribadian:** asik, bad, sopan, cewek, inggris + custom modes via dashboard
- **Auto fallback provider:** Groq gagal → OpenAI, OpenAI gagal → Groq
- **Auto retry tanpa tools:** kalau function calling error, retry tanpa tools

### 🧠 RAG & Long-Term Memory
- **Auto-learning:** tiap 8 interaksi, bot ekstrak fakta dari percakapan dan simpan sebagai memori
- **RAG retrieval:** sebelum jawab, bot cari memori relevan pakai BM25 scoring
- **Keyword extraction:** memori disimpan dengan kata kunci untuk pencarian lebih akurat
- **Vector index rebuild otomatis:** tiap startup, semua memori di-index ulang

### 🌐 Web Dashboard
- Dashboard web di port **6789**
- **Provider toggle:** pilih Groq atau OpenAI sebagai primary
- **Model selector:** dropdown model dari provider aktif
- **API Key management:** set Groq, OpenAI, Tavily API key dari UI
- **Custom modes:** buat mode kepribadian sendiri
- **Live stats:** uptime, pesan diproses, token usage

### 🔍 Web Search
- Tavily API + Wikipedia fallback
- Natural language trigger: "cari bitcoin", "berita politik", "apa itu blockchain"

### 🎙️ Voice & Multimedia
- Voice Note input via Whisper (Groq)
- Voice Note output via Google TTS → Opus
- Vision AI: analisis gambar via Llama 4 Scout / GPT-4o-mini
- Sticker maker: `/s` dari gambar
- TTS: `/say [teks]`

### 📄 Document Reader
- Kirim PDF / DOCX / teks → bot baca + jelaskan + simpen ke memori

### 📅 Productivity
- Auto Reminder: "ingetin gw 21:54 buat tugas" (WIB)
- Jadwal grup: `/jadwal list`, `/jadwal tambah`, `/jadwal hapus`

### 🛡️ Security
- Whitelist: `/allow [nomor]`, `/ban [nomor]`
- Anti-spam cooldown 1.5 detik
- Login rate limit: 5 attempts/min per IP

### ⚙️ Infrastructure
- Graceful shutdown: SIGTERM/SIGINT → flush DB + close WA + close HTTP
- Context token cap: 4000 token max per request
- Auto reconnect + PM2 restart
- Message dedup (3 detik window)
- DB flush on exit (debounce 2 detik)

---

## Web Dashboard

Akses `http://IP_BOT:6789` (password default: `12345678`).

| Tab | Fungsi |
|-----|--------|
| **Dashboard** | Status bot, uptime, message count, token usage |
| **Chat** | Chat langsung dengan AI |
| **Model** | Pilih provider (Groq/OpenAI) + model |
| **API Keys** | Set GROQ_API_KEY, OPENAI_API_KEY, TAVILY_API_KEY |
| **Modes** | Ganti mode kepribadian, buat custom mode |
| **Skills** | Enable/disable fitur |
| **Whitelist** | Kelola akses user |
| **Settings** | DB settings |

---

## Instalasi

### Prasyarat
- **Node.js** v20+
- **npm**
- **Groq API Key** ([daftar gratis](https://console.groq.com)) — untuk AI chat
- Atau **OpenAI-compatible endpoint** (9Router, dll)

### Langkah

```bash
git clone https://github.com/ahdikhfDev/bot-wa.git
cd bot-wa
npm install
cp .env.example .env
# Edit .env — isi setidaknya OWNER_NUMBER
npm start
```

Scan QR dengan WhatsApp → **Settings → Linked Devices → Link a Device**.

### PM2 (production)

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
| `OWNER_NUMBER` | ✅ | - | Nomor WhatsApp owner (628xxx) |
| `GROQ_API_KEY` | ❌ | - | API key Groq |
| `OPENAI_API_KEY` | ❌ | - | API key OpenAI/9Router |
| `OPENAI_BASE_URL` | ❌ | `https://api.openai.com/v1` | Base URL OpenAI-compatible |
| `GROQ_MODEL` | ❌ | `llama-3.3-70b-versatile` | Model Groq default |
| `OPENAI_MODEL` | ❌ | `gpt-4o-mini` | Model OpenAI/9Router default |
| `AI_PROVIDER` | ❌ | `groq` | Provider default (groq/openai) |
| `TAVILY_API_KEY` | ❌ | - | Web search (tavily.com) |
| `BOT_PREFIX` | ❌ | `/` | Prefix command |
| `SPAM_COOLDOWN_MS` | ❌ | `1500` | Anti-spam cooldown (ms) |
| `WEB_PORT` | ❌ | `6789` | Port web dashboard |

---

## Arsitektur

```
src/
├── index.js                    # Entry point, WA connection, reminders, shutdown
├── handlers/
│   └── message.js              # Message router, media processing, command dispatch
├── services/
│   ├── ai.js                   # AI core — callAI, callGroqInternal, callOpenAI, tool loop
│   ├── tools.js                # Tool definitions + executor (search, weather, translate, dll)
│   ├── db.js                   # SQLite — debounced writes, flushDb, semua CRUD
│   ├── contextBuilder.js       # Context assembly — history, memories, profile, token cap
│   ├── search.js               # Tavily + Wikipedia search
│   ├── weather.js              # wttr.in cuaca
│   ├── translate.js            # Groq-based translate
│   ├── publicapis.js           # Kurs, HN, TV, IP, QR
│   ├── userProfile.js          # Ekstraksi fakta user
│   ├── vectorSearch.js         # BM25 bag-of-words + Indonesian stemming
│   └── pronounResolver.js      # Indonesian pronoun resolution
├── skills/
│   ├── _loader.js              # Auto-load skills from directory
│   ├── ai.js                   # AI image gen / voice
│   ├── search.js               # /search, /cari
│   ├── weather.js              # /weather, /cuaca
│   ├── translate.js            # /translate, /tr
│   ├── bmkg.js                 # /gempa, /bmkg
│   ├── public.js               # /kurs, /hn, /tv, /ip, /qr
│   ├── media.js                # /s, /sticker, /say
│   ├── mode.js                 # /mode
│   ├── reminder.js             # Natural language reminder
│   ├── rangkum.js              # /rangkum
│   ├── jadwal.js               # /jadwal
│   ├── broadcast.js            # /broadcast (owner only)
│   ├── template.js             # /template
│   ├── admin.js                # /allow, /ban, /list, /reset
│   ├── help.js                 # /help
│   └── reset.js                # /reset
├── server/
│   └── index.js                # Express dashboard + auth + API
└── utils/
    └── logger.js               # File logging
```

### Flow Percakapan

```
User → message.js → classifyIntent → chatWithContext
  → buildContext (profile + summary + memories + history, capped at 4K tokens)
    → callAI (system prompt + history + user message)
      → callGroqInternal / callOpenAI (WITH tools)
        → LLM decides to call tool (search_web, get_weather, etc.)
          → executeTool → result → LLM final response
      → OR LLM answers directly (no tool needed)
    → Response → WA
```

---

## Tech Stack

| Komponen | Teknologi |
|----------|-----------|
| Runtime | Node.js (ESM) |
| WA Library | Baileys v7 |
| AI Provider | Groq / OpenAI-compatible |
| Database | SQLite (sql.js) + debounce |
| Web Search | Tavily API + Wikipedia |
| Voice | Whisper (Groq) + Google TTS |
| Vision | Llama 4 Scout (Groq) / GPT-4o-mini |
| Dashboard | Express.js |
| Process Manager | PM2 |

---

## Limit & Rate

| Service | Free Tier | Cadangan |
|---------|-----------|----------|
| **Groq** | 30 req/min, 500 req/day | OpenAI/9Router fallback |
| **OpenAI/9Router** | tergantung provider | Groq fallback |
| **Tavily** | 1000 search/bulan | Wikipedia |
| **wttr.in** | unlimited | - |
| **BMKG** | unlimited | - |
| **Hacker News** | unlimited | - |

---

<p align="center">
  <sub>© 2026 Maha Raja Ahdi Khalida Fathir</sub>
</p>
