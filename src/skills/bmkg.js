const UA = 'ThirtyBot/1.0';

export default {
    name: 'bmkg',
    title: 'BMKG Gempa & Cuaca Ekstrem',
    description: 'Info gempa terbaru dan peringatan dini dari BMKG',
    commands: ['gempa', 'bmkg', 'gempabumi'],
    config: {},

    async handler(sock, remoteJid, args, context) {
        await sock.sendPresenceUpdate('composing', remoteJid);

        try {
            const r = await fetch('https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json', {
                headers: { 'User-Agent': UA },
                signal: AbortSignal.timeout(10000)
            });
            const data = await r.json();

            if (!data.Infogempa || !data.Infogempa.gempa || !data.Infogempa.gempa.length) {
                await sock.sendMessage(remoteJid, { text: '🌊 *Info Gempa*\n\nTidak ada data gempa terkini.' });
                return;
            }

            const quakes = data.Infogempa.gempa.slice(0, 5);
            let text = `🌊 *GEMPA BUMI TERKINI* 🌊\n\n`;

            quakes.forEach((q, i) => {
                text += `${i + 1}. ${q.Tanggal} ${q.Jam}\n`;
                text += `   📍 ${q.Wilayah}\n`;
                text += `   📊 ${q.Magnitude} SR\n`;
                text += `   🕐 ${q.Kedalaman}\n`;
                text += `   ${q.Potensi || '-'}\n\n`;
            });

            text += `_Sumber: BMKG | data.bmkg.go.id_`;
            await sock.sendMessage(remoteJid, { text: text.trim() });
        } catch (err) {
            await sock.sendMessage(remoteJid, { text: `❌ Gagal mengambil data gempa: ${err.message}` });
        }
    }
};
