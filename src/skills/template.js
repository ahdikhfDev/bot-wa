import { getTemplateList, getTemplate, fillTemplate, formatTemplateList } from '../services/templates.js';
import { broadcastTargets, savePendingBroadcast } from '../services/db.js';

export default {
    name: 'template',
    title: 'Template Pesan',
    description: 'Kirim template pesan siap pakai',
    commands: ['template', 'tpl'],
    ownerOnly: true,

    async handler(sock, remoteJid, args, context) {
        const { text } = context;

        function parseFields(raw) {
            const data = {};
            const regex = /(\w+)=(?:"([^"]*)"|(\S+))/g;
            let m;
            while ((m = regex.exec(raw)) !== null) {
                data[m[1]] = m[2] !== undefined ? m[2] : m[3];
            }
            return data;
        }

        const sub = args[0]?.toLowerCase();
        const tplName = args[1]?.toLowerCase();

        if (!sub || sub === 'list') {
            await sock.sendMessage(remoteJid, { text: formatTemplateList() });
            return;
        }

        if (sub === 'isi') {
            const tpl = getTemplate(tplName);
            if (!tpl) {
                await sock.sendMessage(remoteJid, { text: `❌ Template "${tplName}" gak ada.` });
                return;
            }
            const cmdPrefix = `/template isi ${tplName}`;
            const raw = text.slice(text.toLowerCase().indexOf(cmdPrefix) + cmdPrefix.length);
            const fillData = parseFields(raw);
            const result = fillTemplate(tplName, fillData);
            await sock.sendMessage(remoteJid, { text: `📋 *Preview: ${tpl.title}*\n\n${result}\n\n_Kirim? (y/n)_` });
            savePendingBroadcast(remoteJid, new Map([[remoteJid, 'Chat ini']]), result);
            return;
        }

        if (sub === 'kirim' || sub === 'send') {
            const tpl = getTemplate(tplName);
            if (!tpl) {
                await sock.sendMessage(remoteJid, { text: `❌ Template "${tplName}" gak ada.` });
                return;
            }
            const cmdPrefix = `/template kirim ${tplName}`;
            const raw = text.slice(text.toLowerCase().indexOf(cmdPrefix) + cmdPrefix.length);
            const fillData = parseFields(raw);

            const groupList = [...broadcastTargets];
            let targets = [];

            const beforeFields = raw.replace(/\w+=/g, '|||').split('|||')[0].trim();
            const nums = beforeFields.match(/\d+/g);
            if (nums) {
                for (const n of nums) {
                    const idx = parseInt(n) - 1;
                    if (idx >= 0 && idx < groupList.length) targets.push(groupList[idx]);
                }
            } else {
                targets = [[remoteJid, 'Chat ini']];
            }

            const result = fillTemplate(tplName, fillData);
            const targetNames = targets.map(([_, n]) => n).join(', ');
            savePendingBroadcast(remoteJid, new Map(targets), result);
            await sock.sendMessage(remoteJid, { text: `📋 *Template: ${tpl.title}*\n📋 Ke: ${targetNames}\n\n${result}\n\n_Kirim? (y/n)_` });
            return;
        }

        // Preview single template
        const tpl = getTemplate(sub);
        if (tpl) {
            const fields = getTemplateList().find(t => t.id === sub)?.fields || [];
            await sock.sendMessage(remoteJid, { text: `📋 *${tpl.title}*\n${tpl.desc}\n\nFields: ${fields.join(', ')}\n\nKirim: /template kirim ${sub} [field=nilai]` });
            return;
        }

        await sock.sendMessage(remoteJid, { text: `❌ Gak paham. Ketik /template list` });
    }
};
