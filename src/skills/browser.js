import { runBrowserAgent } from '../services/browserAgent.js';
import { error as logError } from '../utils/logger.js';

export default {
    name: 'browser',
    title: 'Browser Agent',
    description: 'Jalankan AI Agent untuk melakukan tugas di web secara visual',
    commands: ['browser', 'web', 'cariin'],

    async handler(sock, remoteJid, args, context) {
        const { text } = context;
        
        // Use full text if started with /cariin, otherwise use args
        let task = args.join(' ');
        if (context.command === 'cariin') {
            task = text.replace(/^\/cariin\s+/i, '');
        }

        if (!task) {
            await sock.sendMessage(remoteJid, { 
                text: '❌ *Tentukan tugas untuk Browser Agent*\n\n' +
                      'Contoh:\n' +
                      '• `/browser cariin laptop gaming di tokopedia dibawah 10jt`\n' +
                      '• `/web buka porto.ahdi.my.id terus kasih tau isinya`\n' +
                      '• `/cariin harga tiket konser coldplay`'
            });
            return;
        }

        await sock.sendMessage(remoteJid, { text: `🤖 *Browser Agent Aktif*\nTugas: _"${task}"_\n\n_Sedang menyiapkan browser..._` });

        const onUpdate = async (updateText) => {
            // We'll just send a new message for each major step to keep user informed
            // In the future, we could implement message editing if the library supports it
            await sock.sendMessage(remoteJid, { text: updateText });
        };

        try {
            const result = await runBrowserAgent(task, onUpdate);
            
            await sock.sendMessage(remoteJid, { 
                text: `✅ *Browser Agent Selesai*\n\n${result}` 
            });
        } catch (err) {
            logError('Browser Skill', err);
            await sock.sendMessage(remoteJid, { 
                text: `❌ *Browser Agent Gagal*\nError: ${err.message}` 
            });
        }
    }
};
