import { broadcastTargets, savePendingBroadcast } from '../services/db.js';

export default {
    name: 'broadcast',
    title: 'Broadcast',
    description: 'Kirim pesan ke semua grup',
    commands: ['broadcast', 'bc'],
    ownerOnly: true,

    async handler(sock, remoteJid, args, context) {
        const { command } = context;
        const sub = args[0]?.toLowerCase();

        if (sub === 'list' || sub === 'ls') {
            if (broadcastTargets.size === 0) {
                await sock.sendMessage(remoteJid, { text: '📡 Belum ada grup.' });
                return;
            }
            let list = `📡 *Daftar Grup (${broadcastTargets.size})*\n\n`;
            let i = 1;
            for (const [jid, name] of broadcastTargets) {
                list += `${i}. ${name}\n`;
                i++;
            }
            await sock.sendMessage(remoteJid, { text: list });
            return;
        }

        if (sub === 'send' || sub === 'kirim') {
            const text = args.slice(1).join(' ').trim();
            if (!text) {
                await sock.sendMessage(remoteJid, { text: '❌ Usage: /broadcast kirim [pesan]' });
                return;
            }

            const groupList = [...broadcastTargets];
            let targets = [];

            const parts = args.slice(1);
            const firstIsNum = /^\d+$/.test(parts[0]);
            if (firstIsNum) {
                const indices = [];
                let i = 0;
                for (const p of parts) {
                    if (/^\d+$/.test(p)) {
                        const idx = parseInt(p) - 1;
                        if (idx >= 0 && idx < groupList.length && !indices.includes(idx)) {
                            indices.push(idx);
                        }
                    } else break;
                    i++;
                }
                targets = indices.map(i => groupList[i]);
                const msgText = parts.slice(i).join(' ').trim();
                if (!msgText || targets.length === 0) {
                    await sock.sendMessage(remoteJid, { text: '❌ Gagal. Cek /broadcast list' });
                    return;
                }
                const targetNames = targets.map(([_, n]) => n).join(', ');
                savePendingBroadcast(remoteJid, new Map(targets), msgText);
                await sock.sendMessage(remoteJid, { text: `📡 *Broadcast ke ${targets.length} grup*\n📋 ${targetNames}\n📝 ${msgText}\n\n_Kirim? (y/n)_` });
            } else {
                targets = groupList;
                const targetNames = targets.map(([_, n]) => n).join(', ');
                savePendingBroadcast(remoteJid, new Map(targets), text);
                await sock.sendMessage(remoteJid, { text: `📡 *Broadcast ke ${targets.length} grup*\n📋 ${targetNames}\n📝 ${text}\n\n_Kirim? (y/n)_` });
            }
            return;
        }

        await sock.sendMessage(remoteJid, { text: `📡 *Broadcast*\n/broadcast list — lihat grup\n/broadcast kirim [pesan] — kirim ke semua\n/broadcast kirim 1 3 [pesan] — kirim ke grup tertentu` });
    }
};
