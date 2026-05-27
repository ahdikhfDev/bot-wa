import { getLinkPreview } from 'link-preview-js';

function formatPreview(data, url) {
    try {
        const parsedUrl = new URL(url);
        const domain = parsedUrl.hostname.replace('www.', '');
        const isSecure = parsedUrl.protocol === 'https:';
        
        let text = `🔗 *${domain}*`;
        if (data.title && !data.title.toLowerCase().includes(domain)) {
            text += `\n📌 ${data.title.substring(0, 100)}`;
        } else if (data.title) {
            text += `\n📌 ${data.title.substring(0, 100)}`;
        }
        if (data.description) {
            text += `\n\n${data.description.substring(0, 250)}`;
        }
        text += `\n\n${isSecure ? '🔒' : '⚠️'} ${url}`;
        return text;
    } catch {
        return `🔗 ${url}`;
    }
}

export default {
    name: 'preview',
    title: 'Link Preview',
    description: 'Lihat preview dari sebuah link/URL',
    commands: ['preview', 'priview', 'cek', 'cekurl', 'cekpreview'],

    async handler(sock, remoteJid, args) {
        let url = args[0];
        if (!url) {
            await sock.sendMessage(remoteJid, {
                text: `🔗 *Link Preview*
Lihat info singkat dari sebuah URL.

*Contoh:*
• /preview https://github.com
• /cek https://kompas.com
• /cekpreview https://detik.com`
            });
            return;
        }

        // Add protocol if missing
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        // Basic URL validation
        try {
            new URL(url);
        } catch {
            await sock.sendMessage(remoteJid, { text: '❌ URL tidak valid.' });
            return;
        }

        await sock.sendPresenceUpdate('composing', remoteJid);
        await sock.sendMessage(remoteJid, { text: `🔗 _Mengecek: ${url}..._` });

        try {
            const preview = await getLinkPreview(url, {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                },
                timeout: 10000,
                followRedirects: 'follow',
            });

            const text = formatPreview(preview, url);

            // Send image if available
            if (preview.images && preview.images.length > 0) {
                const imgUrl = preview.images[0];
                // Try to send image
                try {
                    const imgResp = await fetch(imgUrl, {
                        signal: AbortSignal.timeout(5000),
                    });
                    if (imgResp.ok) {
                        const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                        await sock.sendMessage(remoteJid, {
                            image: imgBuffer,
                            caption: text,
                        });
                        return;
                    }
                } catch {
                    // Image fetch failed, send text only
                }
            }

            // Fallback: text only
            await sock.sendMessage(remoteJid, { text });
        } catch (err) {
            console.error('Preview Error:', err.message);
            await sock.sendMessage(remoteJid, {
                text: `❌ Gagal mendapatkan preview.\nError: ${err.message}`
            });
        }
    }
};
