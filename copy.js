import { fetchSheet } from './sheet.js';

let copyMapPromise = null;

// Fetches the _copy tab once and shares the result with every caller on the
// page (helper.js reads archie_* keys from the same map applyCopy uses).
export function getCopyMap() {
    if (!copyMapPromise) {
        copyMapPromise = fetchSheet('_copy')
            .then(rows => Object.fromEntries(rows.map(r => [r.key, r.value])))
            .catch(err => {
                console.warn('Copy sheet unavailable:', err.message);
                return {};
            });
    }
    return copyMapPromise;
}

// Fills every [data-copy] element from the _copy sheet tab.
// HTML fallback text stays in place if the sheet is unreachable or a key is missing.
export async function applyCopy() {
    const copy = await getCopyMap();
    document.querySelectorAll('[data-copy]').forEach(el => {
        const val = copy[el.dataset.copy];
        if (val) el.textContent = val;
    });
}
