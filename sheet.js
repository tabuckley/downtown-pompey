export const SHEET_ID = '1INsPP2txSuajj7NYpGTbBhy-6nnTTgtbqhg-veMtgyk';

export function sheetUrl(tabName) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

export async function fetchSheet(tabName) {
    const res = await fetch(sheetUrl(tabName));
    if (!res.ok) throw new Error(`Failed to fetch sheet: ${tabName}`);
    return parseCSV(await res.text());
}

// Extracts a 4-digit year from any date format the sheet might hold
// ("2024-01-13", "13/05/2023", "summer 2023"). Falls back when none found.
export function yearFrom(dateStr, fallback = '') {
    const m = /\d{4}/.exec(dateStr || '');
    return m ? m[0] : (fallback || '');
}

// Sortable timestamp: ISO dates parse exactly; anything else falls back to
// the year alone; undated rows sort last.
export function dateStamp(dateStr) {
    const t = Date.parse(dateStr || '');
    if (!Number.isNaN(t)) return t;
    const y = yearFrom(dateStr);
    return y ? Date.UTC(+y, 0, 1) : 0;
}

// Single character scan across the whole payload: quoted fields may contain
// commas AND newlines (Google's gviz export emits both), so rows can only be
// split where a newline appears outside quotes.
function parseCSV(csv) {
    const text = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = [];
    let row = [], field = '', inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1)
        .filter(r => r.some(v => v.trim() !== ''))
        .map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])));
}
