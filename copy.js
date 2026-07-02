import { fetchSheet } from './sheet.js';

// Fills every [data-copy] element from the _copy sheet tab.
// HTML fallback text stays in place if the sheet is unreachable or a key is missing.
export async function applyCopy() {
    try {
        const rows = await fetchSheet('_copy');
        const copy = Object.fromEntries(rows.map(r => [r.key, r.value]));
        document.querySelectorAll('[data-copy]').forEach(el => {
            const val = copy[el.dataset.copy];
            if (val) el.textContent = val;
        });
    } catch (err) {
        console.warn('Copy sheet unavailable:', err.message);
    }
}
