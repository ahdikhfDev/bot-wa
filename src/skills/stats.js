import { getSetting, getTokenUsageSummary, getAllWhitelist } from "../services/db.js";
import { getSkillNames } from "./_loader.js";

export default {
    name: "stats",
    title: "Statistik Bot",
    description: "Menampilkan statistik penggunaan dan status bot",
    commands: ["stats", "status", "botstat"],

    async handler(sock, remoteJid, args, context) {
        const firstStart = parseInt(getSetting("stats_first_start", "0"));
        const lastStart = parseInt(getSetting("stats_last_start", "0"));
        const restartCount = getSetting("stats_restart_count", "0");
        const totalMessages = getSetting("stats_total_messages", "0");
        const videosGenerated = getSetting("stats_videos_generated", "0");
        const tokenUsage = getTokenUsageSummary();

        const uptime = lastStart ? Math.floor((Date.now() - lastStart) / 1000) : 0;
        const uptimeStr = formatUptime(uptime);
        
        const firstStartDate = firstStart ? new Date(firstStart).toLocaleString("id-ID") : "Unknown";

        let text = "📊 *STATISTIK THIRTY AI*\n\n";
        text += "🚀 *Uptime:* " + uptimeStr + "\n";
        text += "🔄 *Restart:* " + restartCount + " kali\n";
        text += "💬 *Pesan:* " + totalMessages + "\n";
        text += "🎬 *Video:* " + videosGenerated + " video\n";
        text += "🧠 *Tokens:* " + (tokenUsage.totalAll / 1000).toFixed(1) + "k tokens\n";
        text += "🛠️ *Skills:* " + getSkillNames().length + " active\n";
        text += "🛡️ *Whitelist:* " + getAllWhitelist().length + " users\n\n";
        text += "📅 *Online sejak:* " + firstStartDate + "\n";
        text += "👑 *Owner:* Ahdi Khalida Fathir";

        await sock.sendMessage(remoteJid, { text });
    }
};

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    const parts = [];
    if (d > 0) parts.push(d + "h");
    if (h > 0) parts.push(h + "j");
    if (m > 0) parts.push(m + "m");
    if (s > 0 || parts.length === 0) parts.push(s + "d");
    
    return parts.join(" ");
}
