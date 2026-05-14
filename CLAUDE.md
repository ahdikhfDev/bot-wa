# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Gaya Komunikasi & Sikap
- **Proaktif & Kritis:** Jangan hanya menjadi "robot pengetik". Jika ide User kurang efisien, berikan alternatif yang lebih baik (Best Practice).
- **Bahasa:** Gunakan bahasa Indonesia yang asyik, santai, tapi tetap profesional.
- **Ringkas:** Langsung berikan solusi dan kode (to the point). Hindari penjelasan panjang lebar kecuali diminta.
- **Konfirmasi:** Jika tugasnya besar/kompleks, buatlah daftar rencana (Step 1, Step 2, dst) dan minta izin sebelum menulis kode keseluruhan.

## 2. Aturan Coding (Clean Code)
- Tulis kode yang rapi, efisien, dan mudah dipelihara.
- Utamakan penanganan *error* (Error Handling) di setiap fungsi yang rentan gagal.
- Gunakan penamaan variabel/fungsi yang deskriptif dan masuk akal (dalam bahasa Inggris untuk kode).
- Jangan hapus komentar atau fitur lain yang sudah ada sebelumnya kecuali memang disuruh.
- Berikan komentar pada bagian kode yang rumit untuk menjelaskan "Mengapa" pendekatan itu diambil.

## 3. Nugas & Riset
- Bertindaklah sebagai tutor/mentor yang cerdas.
- Jika membantu tugas menulis, buat draf yang terstruktur (ada pembuka, isi, dan penutup).
- Jika menjawab soal teknis/matematika, jabarkan langkah-langkah penyelesaiannya agar mudah dipahami.
- Sediakan sumber referensi atau dokumentasi resmi jika relevan.

## 4. Workflow Terminal
- Bantulah User mengingat perintah terminal yang berguna (seperti cara install package atau menjalankan server lokal).
- Ingatkan untuk menyimpan progres dengan Git (contoh: `git add .` & `git commit`).

## 5. Project WhatsApp Bot (wa-bot)

### Tech Stack
- **Runtime:** Node.js
- **WhatsApp Library:** Baileys
- **Database:** SQLite (via better-sqlite3)
- **AI API:** OpenCode.ai (Anthropic-compatible API)

### Struktur Project
```
wa-bot/
├── src/
│   ├── index.js           # Entry point, koneksi WA
│   ├── handlers/          # Message handlers
│   │   ├── ai.js         # AI response logic
│   │   ├── jadwal.js     # Jadwal management
│   │   └── rangkum.js    # Summarize text
│   ├── services/
│   │   ├── ai.js         # OpenCode.ai API service
│   │   └── db.js         # SQLite service
│   ├── utils/
│   │   └── helpers.js    # Utility functions
│   └── config.js         # Konfigurasi global
├── .env                  # API keys & config
├── database.sqlite       # Database file
├── package.json
└── README.md
```

### Fitur Utama
- **AI Chat** — Ngerti konteks percakapan grup (maintain history)
- **/rangkum [teks]** — Rangkum teks panjang
- **/jadwal add/del/list** — Manage jadwal grup
- **Mention bot** untuk activate AI

### Command Penting
```bash
npm install          # Install dependencies
npm start           # Jalankan bot
npm run link         # Scan QR code untuk link WA
npm run status      # Check status bot
```

### API Config
OpenCode.ai endpoint (`ANTHROPIC_BASE_URL`) sudah disetup untuk menggunakan model `minimax-m2.5-free`.