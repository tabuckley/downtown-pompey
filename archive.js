// Shared archive-loading logic — pulls every published project's rows into
// one flat item list. Extracted from scrapbook.js's own init() so
// accessible.js can load the exact same data the same way, rather than a
// second parallel implementation that could quietly drift from it.
import { fetchSheet } from './sheet.js';

export async function loadArchive() {
    const index = await fetchSheet('_index');
    const published = index.filter(p => p.status === 'published' && p.tab);

    const results = await Promise.allSettled(published.map(p => fetchSheet(p.tab)));
    const items = [];
    results.forEach((res, i) => {
        if (res.status !== 'fulfilled') return;
        const project = published[i];
        res.value.forEach(row => {
            if (!row.url && !row.thumbnail) return;
            items.push({ ...row, project: project.title, projectYear: project.year, id: itemId(project.tab, row) });
        });
    });
    return items;
}

// A stable-enough identifier for deep-linking to one item — there's no id
// column in the per-project sheet tabs, but url is already unique and
// permanent (it's the actual media file's address), so a slug built from it
// survives re-ordering/re-tagging/retitling rows in the sheet. Prefixed
// with the project tab in case two projects ever reuse a filename.
export function itemId(projectTab, row) {
    const source = row.url || row.thumbnail || row.title || '';
    const filename = decodeURIComponent(source.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
    const slug = `${projectTab}-${filename}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || null;
}
