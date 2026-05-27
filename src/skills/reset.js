import { clearGroupContext } from '../services/db.js';

export default {
    name: 'reset',
    title: 'Reset Konteks',
    description: 'Hapus riwayat konteks percakapan grup',
    commands: ['reset', 'clear'],

    async handler(sock, remoteJid, args, context) {
        const { isGroup } = context;
        if (!isGroup) {
            await sock.sendMessage(remoteJid, { text: '❌ Reset hanya bisa dipakai di grup.' });
            return;
        }

        clearGroupContext(remoteJid);
        await sock.sendMessage(remoteJid, { text: '🗑️ *Konteks percakapan grup dihapus!*\nBot akan lupa percakapan sebelumnya di grup ini.' });
    }
};
