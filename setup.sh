#!/bin/bash

# =============================================================================
# WA Bot AI - Setup Script untuk STB (Armbian)
# =============================================================================

set -e

echo "=========================================="
echo "🚀 WA Bot AI - Setup Installer"
echo "=========================================="
echo ""

# Warna
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}📦 Node.js belum terinstall, installing...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo -e "${GREEN}✅ Node.js version: $(node --version)${NC}"
echo -e "${GREEN}✅ npm version: $(npm --version)${NC}"
echo ""

# Check SQLite
if ! command -v sqlite3 &> /dev/null; then
    echo -e "${YELLOW}📦 Installing SQLite3...${NC}"
    apt-get update && apt-get install -y sqlite3 build-essential python3
fi

echo -e "${GREEN}✅ SQLite version: $(sqlite3 --version)${NC}"
echo ""

# Buat folder project
PROJECT_DIR="/root/wa-bot"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

echo -e "${GREEN}📁 Project directory: $PROJECT_DIR${NC}"
echo ""

# Clone atau update repo (placeholder - sesuaikan dengan repo kamu)
# git clone https://github.com/username/wa-bot.git . 2>/dev/null || true

echo -e "${YELLOW}📋 Langkah selanjutnya:${NC}"
echo ""
echo "1. Salin semua file project ke $PROJECT_DIR"
echo "2. Copy .env.example ke .env dan sesuaikan API key"
echo "3. Jalankan: npm install"
echo "4. Jalankan: npm start"
echo ""
echo -e "${GREEN}Setup selesai!${NC}"
echo "=========================================="