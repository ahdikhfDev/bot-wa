import { addWhitelist, removeWhitelist, getAllWhitelist } from '../services/db.js';
import { formatList } from '../utils/waformat.js';

export default {
    name: 'admin',
    title: 'Admin Whitelist',
    description: 'Atur whitelist user yang bisa pakai bot',
    commands: ['allow', 'ban', 'list'],
    ownerOnly: true,

    async handler(sock, remoteJid, args, context) {
        const { command, mentionedJids } = context;

        if (command === 'allow') {
            let targetJid;
            let displayName = '';

            if (mentionedJids.length > 0) {
                targetJid = mentionedJids[0];
                displayName = args.slice(1).join(' ');
            } else if (args[0]) {
                const num = args[0].replace(/[^0-9]/g, '');
                if (num) {
                    targetJid = `${num}@s.whatsapp.net`;
                    displayName = args.slice(1).join(' ');
                }
            } else {
                // Default: whitelist sender (owner) instead of remoteJid (which could be a group)
                targetJid = context.msg?.key?.participant || context.msg?.key?.remoteJid;
                displayName = targetJid.split('@')[0];
            }

            if (!displayName) displayName = targetJid.split('@')[0];
            addWhitelist(targetJid, displayName.trim());
            await sock.sendMessage(remoteJid, { text: `✅ *${displayName.trim()}* sekarang bisa menggunakan bot.` });
        }

        else if (command === 'list') {
            const list = getAllWhitelist();
            if (list.length === 0) {
                await sock.sendMessage(remoteJid, { text: '📋 *Whitelist kosong.*' });
                return;
            }
            const formatted = list.map((item, i) => {
                const name = item.name || item.jid.split('@')[0];
                const icon = item.jid.endsWith('@lid') ? '👤' : item.jid.endsWith('@g.us') ? '👥' : '👤';
                return `${i + 1}. ${icon} ${name}`;
            }).join('\n');
            await sock.sendMessage(remoteJid, { text: `📋 *Whitelist (${list.length})*\n\n${formatted}\n\nHapus: /ban [nomor]` });
        }

        else if (command === 'ban') {
            const list = getAllWhitelist();

            if (args[0] && /^\d+$/.test(args[0])) {
                const idx = parseInt(args[0]) - 1;
                if (idx >= 0 && idx < list.length) {
                    const target = list[idx].jid;
                    removeWhitelist(target);
                    await sock.sendMessage(remoteJid, { text: `⛔ ${target} dihapus dari whitelist.` });
                    return;
                }
                await sock.sendMessage(remoteJid, { text: `❌ Nomor ${args[0]} gak valid. Cek /list` });
                return;
            }

            let targetJid = remoteJid;
            if (mentionedJids.length > 0) targetJid = mentionedJids[0];
            else if (args[0]) {
                const num = args[0].replace(/[^0-9]/g, '');
                if (num) targetJid = `${num}@s.whatsapp.net`;
            }
            removeWhitelist(targetJid);
            await sock.sendMessage(remoteJid, { text: `⛔ ${targetJid} dihapus dari whitelist.` });
        }
    }
};
