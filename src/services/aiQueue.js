/**
 * AI Request Queue — Mencegah overload AI provider
 * Mengantre request AI dan memprosesnya satu per satu
 * dengan timeout dan rate limiting.
 */

import { log, warn } from "../utils/logger.js";

let queue = [];
let processing = false;
const MAX_QUEUE_SIZE = 20;
const REQUEST_TIMEOUT = 60000;
let activeRequests = 0;
const MAX_CONCURRENT = 3;

export function getQueueStats() {
    return {
        pending: queue.length,
        active: activeRequests,
        maxConcurrent: MAX_CONCURRENT,
        maxQueueSize: MAX_QUEUE_SIZE,
    };
}

export function enqueueRequest(fn, priority = 0) {
    return new Promise((resolve, reject) => {
        if (queue.length >= MAX_QUEUE_SIZE) {
            reject(new Error("Antrean AI penuh. Coba lagi nanti."));
            return;
        }

        const entry = {
            fn,
            priority,
            resolve,
            reject,
            createdAt: Date.now(),
        };

        if (priority > 0) {
            queue.unshift(entry);
        } else {
            queue.push(entry);
        }

        log("AI_QUEUE", `Antrean: ${queue.length} pending, ${activeRequests} aktif`);
        processQueue();
    });
}

function processQueue() {
    if (processing) return;
    if (queue.length === 0) return;
    if (activeRequests >= MAX_CONCURRENT) return;

    processing = true;

    try {
        while (queue.length > 0 && activeRequests < MAX_CONCURRENT) {
            const entry = queue.shift();
            if (!entry) continue;

            if (Date.now() - entry.createdAt > REQUEST_TIMEOUT) {
                entry.reject(new Error("Request timeout di antrean."));
                continue;
            }

            activeRequests++;
            executeEntry(entry);
        }
    } finally {
        processing = false;
    }
}

async function executeEntry(entry) {
    try {
        const result = await entry.fn();
        entry.resolve(result);
    } catch (err) {
        warn("AI_QUEUE_ERROR", err.message);
        entry.reject(err);
    } finally {
        activeRequests--;
        setTimeout(() => processQueue(), 100);
    }
}

export function clearQueue() {
    const dropped = queue.length;
    for (const entry of queue) {
        entry.reject(new Error("Antrean dibersihkan."));
    }
    queue = [];
    log("AI_QUEUE", `Antrean dibersihkan: ${dropped} request dibatalkan`);
}
