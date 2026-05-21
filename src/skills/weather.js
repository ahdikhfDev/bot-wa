import { getWeather, formatWeather } from '../services/weather.js';

export default {
    name: 'weather',
    title: 'Cek Cuaca',
    description: 'Cek prakiraan cuaca via wttr.in',
    commands: ['weather', 'cuaca'],

    async handler(sock, remoteJid, args) {
        const city = args.join(' ');
        await sock.sendPresenceUpdate('composing', remoteJid);
        const weather = await getWeather(city || 'Jakarta');
        await sock.sendMessage(remoteJid, { text: formatWeather(weather) });
    }
};
