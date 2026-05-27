import { callAI, chatWithContext, getVoiceBuffer, extractAndStoreMemories } from '../services/ai.js';
import { getMode, getGroupHistory, addContextMessage, incrementInteractionCount, getInteractionCount, resetInteractionCount } from '../services/db.js';
import { getLearningInterval } from '../services/ai.js';
import { warn } from '../utils/logger.js';

export default {
    name: 'ai',
    title: 'AI Chat',
    description: 'Ngobrol dengan AI (chat biasa, bukan command)',
    commands: [],
    hasConfig: true,

    async respond(sock, remoteJid, text, context) {
        const { msg, isGroup, isMentioned, isPrivateChat, isAudio, GROUP_CONTEXT_ENABLED, quotedText } = context;

        await sock.sendPresenceUpdate('composing', remoteJid);

        const mode = getMode(remoteJid);

        let promptText = text;
        if (quotedText) {
            promptText = `(Membalas pesan: "${quotedText}")\n\n${text}`;
        }

        const response = await chatWithContext(promptText, mode, remoteJid);

        if (isAudio) {
            const voiceBuffer = await getVoiceBuffer(response);
            if (voiceBuffer) {
                await sock.sendMessage(remoteJid, {
                    audio: voiceBuffer,
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true
                }, { quoted: msg });

                if (GROUP_CONTEXT_ENABLED) {
                    addContextMessage(remoteJid, 'Thirty (Bot)', response);
                }
                return;
            }
        }

        try {
            await sock.sendMessage(remoteJid, { text: response }, { quoted: msg });
        } catch (sendErr) {
            warn('Gagal mengirim dengan quote: ' + sendErr.message);
            await sock.sendMessage(remoteJid, { text: response });
        }

        if (GROUP_CONTEXT_ENABLED) {
            addContextMessage(remoteJid, 'Thirty (Bot)', response);
        }

        if (GROUP_CONTEXT_ENABLED) {
            incrementInteractionCount(remoteJid);
            const count = getInteractionCount(remoteJid);
            const interval = getLearningInterval();
            if (count >= interval) {
                console.log(`🧠 Learning trigger for ${remoteJid}`);
                const history = getGroupHistory(remoteJid, 20);
                extractAndStoreMemories(remoteJid, history);
                resetInteractionCount(remoteJid);
            }
        }
    }
};
