import fs from 'fs';
import { getStocks, getStockById } from '../services/db.js';

export default {
  name: 'stock',
  title: 'Stock Content',
  description: 'Lihat dan download stock content via /stock',
  commands: ['stock'],

  async handler(sock, remoteJid, args, context) {
    const stocks = getStocks(5, 0, '');
    if (stocks.length === 0) {
      await sock.sendMessage(remoteJid, { text: 'Belum ada stock content. Tunggu auto-generate berikutnya.' });
      return;
    }

    if (args[0]) {
      const id = parseInt(args[0]);
      const stock = getStockById(id);
      if (!stock || !fs.existsSync(stock.video_path)) {
        await sock.sendMessage(remoteJid, { text: 'Stock tidak ditemukan.' });
        return;
      }
      const caption = stock.caption + '\n\n' + (Array.isArray(stock.tags) ? stock.tags.join(' ') : '');
      await sock.sendMessage(remoteJid, {
        video: fs.readFileSync(stock.video_path),
        caption: caption,
      });
      return;
    }

    let text = '📦 *Stock Content*\n\n';
    stocks.forEach((s, i) => {
      const tags = Array.isArray(s.tags) ? s.tags.slice(0, 3).join(' ') : '';
      text += `${i + 1}. *${s.topic}*\n   ${tags}\n   /stock ${s.id}\n\n`;
    });
    text += 'Kirim /stock <nomor> untuk download video + caption';
    await sock.sendMessage(remoteJid, { text });
  }
};
