import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
}

function formatHistoryForContext(messages) {
    if (!messages || !messages.length) return '';
    return messages.map(m => `[${m.sender}]: ${m.message}`).join('\n');
}

describe('estimateTokens', () => {
    it('returns 0 for empty input', () => {
        assert.equal(estimateTokens(null), 0);
        assert.equal(estimateTokens(''), 0);
        assert.equal(estimateTokens(undefined), 0);
    });

    it('estimates ~1 token per 3.5 chars (English)', () => {
        const tokens = estimateTokens('hello world');
        assert.ok(tokens > 0);
        assert.equal(tokens, Math.ceil('hello world'.length / 3.5));
    });

    it('estimates ~1 token per 3.5 chars (Indonesian)', () => {
        const text = 'cuaca jakarta hari ini gimana?';
        const tokens = estimateTokens(text);
        assert.equal(tokens, Math.ceil(text.length / 3.5));
    });

    it('long text returns proportional tokens', () => {
        const short = estimateTokens('a'.repeat(35));
        const long = estimateTokens('a'.repeat(350));
        assert.ok(long > short);
        assert.equal(long, short * 10);
    });
});

describe('formatHistoryForContext', () => {
    it('returns empty string for empty input', () => {
        assert.equal(formatHistoryForContext(null), '');
        assert.equal(formatHistoryForContext([]), '');
    });

    it('formats single message correctly', () => {
        const result = formatHistoryForContext([{ sender: 'User', message: 'halo' }]);
        assert.equal(result, '[User]: halo');
    });

    it('formats multiple messages with newlines', () => {
        const msgs = [
            { sender: 'User', message: 'halo' },
            { sender: 'Thirty (Bot)', message: 'hai juga' },
        ];
        const result = formatHistoryForContext(msgs);
        assert.equal(result, '[User]: halo\n[Thirty (Bot)]: hai juga');
    });

    it('handles messages with special characters', () => {
        const msgs = [{ sender: 'User', message: 'test dengan "petik" dan \n baris baru' }];
        const result = formatHistoryForContext(msgs);
        assert.ok(result.includes('"petik"'));
        assert.ok(result.includes('baris baru'));
    });
});
