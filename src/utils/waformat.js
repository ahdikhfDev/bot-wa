// ==================== WHATSAPP FORMATTER ====================
// WA cuma support: *bold*, _italic_, ~strikethrough~, ```monospace```
// Gak ada tabel native. Tapi kita bisa simulasi pake karakter.

export function formatTable(headers, rows) {
    if (!rows.length) return '_(Data kosong)_';

    // Calculate column widths
    const colWidths = headers.map((h, i) => {
        const maxData = Math.max(...rows.map(r => String(r[i] || '').length));
        return Math.max(h.length, maxData) + 2;
    });

    // Build separator
    const sep = '─'.repeat(colWidths.reduce((a, b) => a + b + 3, 1));

    // Header
    let text = `\`\`\`\n`;
    text += `┌${colWidths.map(w => '─'.repeat(w + 2)).join('┬')}┐\n`;
    text += `│${headers.map((h, i) => ` ${h.padEnd(colWidths[i])} `).join('│')}│\n`;
    text += `├${colWidths.map(w => '─'.repeat(w + 2)).join('┼')}┤\n`;

    // Rows
    rows.forEach((row, idx) => {
        text += `│${row.map((cell, i) => ` ${String(cell).padEnd(colWidths[i])} `).join('│')}│\n`;
        if (idx < rows.length - 1) {
            text += `├${colWidths.map(w => '─'.repeat(w + 2)).join('┼')}┤\n`;
        }
    });

    text += `└${colWidths.map(w => '─'.repeat(w + 2)).join('┴')}┘\n`;
    text += `\`\`\``;
    return text;
}

export function formatList(items, ordered = false) {
    if (!items.length) return '_(Kosong)_';
    return items.map((item, i) => {
        const prefix = ordered ? `${i + 1}.` : '•';
        return `${prefix} ${item}`;
    }).join('\n');
}

export function formatSection(title, content) {
    return `*${title}*\n${content}`;
}

export function formatKeyValue(data) {
    // data = [{key: "Nama", val: "Budi"}, ...]
    const maxKeyLen = Math.max(...data.map(d => d.key.length));
    return data.map(d => `• *${d.key}*: ${d.val}`).join('\n');
}
