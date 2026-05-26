import { CONFIG } from '../config.js';

let tail = Promise.resolve();
let pendingCount = 0;
const MAX_QUEUE_SIZE = 50;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function nextDelay() {
    return CONFIG.outboundMinDelayMs + Math.floor(Math.random() * CONFIG.outboundJitterMs);
}

export function queueSendMessage(sock, jid, content, options) {
    if (pendingCount >= MAX_QUEUE_SIZE) {
        return Promise.reject(new Error('Antrean pesan penuh. Mohon tunggu sebentar.'));
    }

    pendingCount++;
    const task = tail
        .catch(() => {})
        .then(async () => {
            await wait(nextDelay());
            return sock.sendMessage(jid, content, options);
        })
        .finally(() => {
            pendingCount--;
        });
    
    tail = task.catch(() => {});
    return task;
}

export function createQueuedSock(sock) {
    return new Proxy(sock, {
        get(target, prop, receiver) {
            if (prop === 'sendMessage') {
                return (jid, content, options) => queueSendMessage(target, jid, content, options);
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
