import { getMode, setMode, getAllCustomModes } from '../services/db.js';

export default {
    name: 'mode',
    title: 'Mode AI',
    description: 'Ganti kepribadian AI (asik, bad, formal, profesional, atau mode kustom)',
    commands: ['mode'],

    async handler(sock, remoteJid, args) {
        const newMode = args[0]?.toLowerCase();
        const defaults = ['asik', 'bad', 'formal', 'profesional'];
        const custom = getAllCustomModes().map(m => m.name);
        const allModes = [...defaults, ...custom];
        if (!newMode || !allModes.includes(newMode)) {
            const list = defaults.join(', ') + (custom.length ? ', ' + custom.join(', ') : '');
            await sock.sendMessage(remoteJid, { text: `❌ Pilih mode: ${list}\nContoh: /mode asik` });
            return;
        }
        setMode(remoteJid, newMode);
        await sock.sendMessage(remoteJid, { text: `✅ Mode AI berubah ke *${newMode}*! Coba ajak ngobrol.` });
    }
};
