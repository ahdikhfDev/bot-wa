import { getMode, setMode } from '../services/db.js';

export default {
    name: 'mode',
    title: 'Mode AI',
    description: 'Ganti kepribadian AI (asik, bad, formal, profesional)',
    commands: ['mode'],

    async handler(sock, remoteJid, args) {
        const newMode = args[0]?.toLowerCase();
        const validModes = ['asik', 'bad', 'formal', 'profesional'];
        if (!newMode || !validModes.includes(newMode)) {
            await sock.sendMessage(remoteJid, { text: `❌ Pilih mode: ${validModes.join(', ')}\nContoh: /mode asik` });
            return;
        }
        setMode(remoteJid, newMode);
        await sock.sendMessage(remoteJid, { text: `✅ Mode AI berhasil diubah ke *${newMode}*! Coba ajak ngobrol sekarang.` });
    }
};
