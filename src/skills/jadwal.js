import { addJadwal, getJadwal, deleteJadwal } from '../services/db.js';

export default {
    name: 'jadwal',
    title: 'Jadwal Grup',
    description: 'Atur jadwal kegiatan grup',
    commands: ['jadwal'],
    groupOnly: true,

    async handler(sock, remoteJid, args, context) {
        const { isGroup } = context;
        if (!isGroup) {
            await sock.sendMessage(remoteJid, { text: '❌ Command jadwal hanya di grup.' });
            return;
        }

        const sub = args[0]?.toLowerCase();
        if (sub === 'add' || sub === 'tambah') {
            const text = args.slice(1).join(' ');
            if (!text) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /jadwal tambah [deskripsi]' });
                return;
            }
            addJadwal(remoteJid, text, context.sender);
            await sock.sendMessage(remoteJid, { text: `✅ Jadwal ditambahkan oleh ${context.sender}` });
        } else if (sub === 'del' || sub === 'hapus') {
            const id = parseInt(args[1]);
            if (!id) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /jadwal hapus [id]' });
                return;
            }
            deleteJadwal(id, remoteJid);
            await sock.sendMessage(remoteJid, { text: `✅ Jadwal #${id} dihapus.` });
        } else if (sub === 'list' || sub === 'ls' || !sub) {
            const items = getJadwal(remoteJid);
            if (items.length === 0) {
                await sock.sendMessage(remoteJid, { text: '📋 *Belum ada jadwal.*' });
                return;
            }
            let text = `📋 *Jadwal (${items.length})*\n\n`;
            items.forEach((item, i) => {
                text += `${i + 1}. [${item.tanggal}] ${item.event}\n`;
            });
            await sock.sendMessage(remoteJid, { text: text });
        }
    }
};
