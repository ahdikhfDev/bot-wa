import { clearGroupContext } from '../services/db.js';

export default {
    name: 'reset',
    title: 'Reset Konteks',
    description: 'Hapus konteks percakapan grup',
    commands: ['reset'],
    ownerOnly: true,

    async handler(sock, remoteJid, args, context) {
        const { isGroup } = context;
        if (isGroup) {
            clearGroupContext(remoteJid);
            await sock.sendMessage(remoteJid, { text: '🧹 Konteks grup sudah di-reset!' });
        }
    }
};
