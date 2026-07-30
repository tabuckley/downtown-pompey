#!/usr/bin/env node
// Data + accessibility audit for the live archive sheet — reads the exact
// same published rows accessible.js/scrapbook.js load at runtime. Runs
// under plain Node (not a browser), so the small pieces of shared logic
// (CSV fetch/parse, item ID slugging, the search-matching algorithm) are
// duplicated here from sheet.js / archive.js / search.js rather than
// imported — those files are browser ES modules loaded via <script
// type="module">, and this project has no build step or "type": "module"
// in package.json, so Node can't load them directly without either change.
// Keep this in sync by hand if the source algorithms change.
//
// Usage:
//   node scripts/validate-archive.js               full audit
//   node scripts/validate-archive.js --fast         skip oversized-image HEAD checks (network-heavy)
//   node scripts/validate-archive.js --json out.json   also write a full machine-readable report
//
// This script only READS the sheet (Google's gviz CSV export has no write
// path without OAuth/service-account credentials this project doesn't have
// configured) and never fabricates descriptions or titles — per the brief,
// uncertain or missing content is flagged for a human to fill in, not
// invented. Nothing here is "auto-repaired": every issue below needs either
// a sheet edit or a human editorial call.

const fs = require('fs');

const SHEET_ID = '1INsPP2txSuajj7NYpGTbBhy-6nnTTgtbqhg-veMtgyk';
const OVERSIZED_BYTES = 5 * 1024 * 1024; // 5MB — generous for a web-served photo/thumbnail
const WEAK_TITLE_RE = /^(img|dsc|dscn|scan|photo|picture|untitled|image)[\s_-]*\d*$/i;

// ===== sheet.js (duplicated) =====
function sheetUrl(tabName) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&headers=1`;
}

async function fetchSheet(tabName) {
    const res = await fetch(sheetUrl(tabName));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCSV(await res.text());
}

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

// ===== archive.js (duplicated) =====
function itemId(projectTab, row) {
    const source = row.url || row.thumbnail || row.title || '';
    const filename = decodeURIComponent(source.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
    const slug = `${projectTab}-${filename}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || null;
}

// ===== search.js (duplicated core — reason-building omitted, unused here) =====
const STOPWORDS = new Set([
    'i', 'me', 'my', 'mine', 'you', 'your', 'it', 'its', 'this', 'that',
    'these', 'those', 'a', 'an', 'the', 'is', 'was', 'were', 'be', 'been',
    'being', 'am', 'are', 'do', 'did', 'does', 'have', 'has', 'had', 'having',
    'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must',
    'of', 'in', 'on', 'at', 'to', 'for', 'with', 'about', 'against',
    'between', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again',
    'and', 'or', 'but', 'so', 'if', 'because', 'as', 'than', 'then',
    'there', 'here', 'some', 'sort', 'kind', 'thing', 'something', 'stuff',
    'made', 'make', 'think', 'thought', 'remember', 'recall', 'sure',
    'maybe', 'probably', 'definitely', 'really', 'just', 'like', 'one',
    'got', 'get', 'saw', 'see', 'called', 'named', 'titled', 'title',
    'photo', 'picture', 'image',
]);

const FIELD_WEIGHTS = { title: 5, tags: 4, description: 2.5, credit: 1.5, project: 1.5 };

function normalize(str) {
    return (str || '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(str) {
    return normalize(str).split(' ').filter(Boolean);
}

function queryTokens(rawQuery) {
    return tokenize(rawQuery).filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const m = a.length, n = b.length;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        let rowMin = curr[0];
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            if (curr[j] < rowMin) rowMin = curr[j];
        }
        if (rowMin > max) return max + 1;
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

function fuzzyThreshold(len) {
    if (len <= 6) return 1;
    if (len <= 9) return 2;
    return 3;
}

function buildSearchIndex(items) {
    return items.map(item => {
        const fields = {};
        for (const field of Object.keys(FIELD_WEIGHTS)) {
            const raw = field === 'tags' ? (item.tags || '').replace(/\//g, ' ') : item[field];
            fields[field] = { text: normalize(raw), tokens: tokenize(raw) };
        }
        return { item, fields };
    });
}

function searchScore(index, rawQuery, { maxResults = 500, minScore = 0.01 } = {}) {
    const terms = queryTokens(rawQuery);
    if (!terms.length) return [];

    const scored = index.map(entry => {
        let score = 0;
        const matchedTerms = new Set();

        for (const term of terms) {
            let bestFieldScore = 0;
            for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
                const { text, tokens } = entry.fields[field];
                if (!text) continue;
                let hit = 0;
                if (tokens.includes(term)) hit = 1;
                else if (text.includes(term)) hit = 0.85;
                else {
                    const threshold = fuzzyThreshold(term.length);
                    for (const tok of tokens) {
                        if (Math.abs(tok.length - term.length) > threshold) continue;
                        if (editDistance(term, tok, threshold) <= threshold) { hit = 0.6; break; }
                    }
                }
                const fieldScore = hit * weight;
                if (fieldScore > bestFieldScore) bestFieldScore = fieldScore;
            }
            if (bestFieldScore > 0) { score += bestFieldScore; matchedTerms.add(term); }
        }

        const coverage = matchedTerms.size / terms.length;
        score *= (0.5 + 0.5 * coverage);
        return { entry, score };
    });

    return scored
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}

// ===== audit =====
function printSection(title, list, note) {
    console.log(`\n=== ${title} (${list.length}) ===`);
    console.log(note);
    if (!list.length) { console.log('  none'); return; }
    list.slice(0, 50).forEach(line => console.log('  - ' + line));
    if (list.length > 50) console.log(`  ...and ${list.length - 50} more`);
}

async function main() {
    const args = process.argv.slice(2);
    const fast = args.includes('--fast');
    const jsonIdx = args.indexOf('--json');
    const jsonPath = jsonIdx !== -1 ? args[jsonIdx + 1] : null;

    console.log('Fetching _index...');
    const index = await fetchSheet('_index');
    const published = index.filter(p => p.status === 'published' && p.tab);
    console.log(`${published.length} published project(s): ${published.map(p => p.tab).join(', ')}`);

    const items = [];
    for (const project of published) {
        let rows;
        try {
            rows = await fetchSheet(project.tab);
        } catch (err) {
            console.error(`  ! Could not fetch tab "${project.tab}": ${err.message}`);
            continue;
        }
        rows.forEach((row, i) => {
            if (!row.url && !row.thumbnail) return; // matches loadArchive()'s own skip rule
            items.push({
                ...row,
                project: project.title,
                projectYear: project.year,
                id: itemId(project.tab, row),
                _rowInTab: i + 2, // +1 header row, +1 to make it 1-indexed
            });
        });
    }
    console.log(`${items.length} items loaded.`);

    const issues = {
        missingId: [], duplicateId: [], noMedia: [], weakTitle: [],
        missingDescription: [], missingTags: [], oversizedImage: [], unrecoverable: [],
    };

    const idCounts = new Map();
    items.forEach(it => { if (it.id) idCounts.set(it.id, (idCounts.get(it.id) || 0) + 1); });

    items.forEach(item => {
        const label = `${item.project} / ${item.title || '(untitled)'} [row ${item._rowInTab}]`;
        if (!item.id) issues.missingId.push(label);
        else if (idCounts.get(item.id) > 1) issues.duplicateId.push(`${label} -> id "${item.id}"`);
        if (!item.url && !item.thumbnail) issues.noMedia.push(label);
        if (!item.title || !item.title.trim()) issues.weakTitle.push(`${label} — no title at all`);
        else if (WEAK_TITLE_RE.test(item.title.trim())) issues.weakTitle.push(`${label} — looks like a raw filename ("${item.title}"), not a real title/alt text`);
        if (!item.description || item.description.trim().length < 8) issues.missingDescription.push(label);
        if (!item.tags || !item.tags.trim()) issues.missingTags.push(label);
    });

    if (!fast) {
        console.log('\nChecking image sizes (HEAD requests, this takes a while)...');
        // Only ever check an actual image file: a photo's own url, or any
        // item's thumbnail. Never the full video/audio/3d asset itself —
        // those are expected to be much larger and are a different concern.
        const withImage = items.filter(it => it.type === 'photo' ? it.url : it.thumbnail);
        let checked = 0;
        for (const item of withImage) {
            const src = item.type === 'photo' ? item.url : item.thumbnail;
            try {
                const res = await fetch(src, { method: 'HEAD' });
                const len = Number(res.headers.get('content-length') || 0);
                if (len > OVERSIZED_BYTES) {
                    issues.oversizedImage.push(`${item.project} / ${item.title || '(untitled)'} — ${(len / 1024 / 1024).toFixed(1)}MB (${src})`);
                }
            } catch { /* one file's network hiccup shouldn't kill the run */ }
            checked++;
            if (checked % 50 === 0) console.log(`  ...${checked}/${withImage.length}`);
        }
    } else {
        console.log('\nSkipping image-size check (--fast).');
    }

    console.log('\nChecking search recoverability (does each item\'s own title/tags find it?)...');
    const searchIndex = buildSearchIndex(items);
    items.forEach(item => {
        const query = [item.title, (item.tags || '').replace(/\//g, ' ')].filter(Boolean).join(' ');
        if (!query.trim()) {
            issues.unrecoverable.push(`${item.project} / (untitled) [row ${item._rowInTab}] — no title or tags to search by at all`);
            return;
        }
        const results = searchScore(searchIndex, query);
        const found = results.some(r => r.entry.item === item);
        if (!found) issues.unrecoverable.push(`${item.project} / ${item.title || '(untitled)'} — its own title/tags don't surface it in search`);
    });

    printSection('Missing stable ID', issues.missingId,
        'Could not derive an item ID (no url, thumbnail, or title to build a slug from) — this item cannot be deep-linked.');
    printSection('Duplicate IDs', issues.duplicateId,
        'Two or more rows produce the same item ID — their deep links collide, so only one is reachable by direct URL.');
    printSection('No media at all', issues.noMedia,
        'Row has neither a url nor a thumbnail — nothing to display or link to (should already be excluded from the live site).');
    printSection('Missing or weak title / alt text', issues.weakTitle,
        'Title is empty or looks like an unedited filename — title also doubles as image alt text on this page.');
    printSection('Missing description', issues.missingDescription,
        'Description is empty or under 8 characters.');
    printSection('Missing tags/keywords', issues.missingTags,
        "Tags field is empty — item won't surface via tag filters or benefit from the search engine's tag-weighted matching.");
    if (!fast) {
        printSection('Oversized images', issues.oversizedImage,
            `Image over ${(OVERSIZED_BYTES / 1024 / 1024).toFixed(0)}MB — slow to load, worth compressing.`);
    }
    printSection('Unrecoverable via search', issues.unrecoverable,
        "Searching the item's own title/tags doesn't surface it in the top results — likely too sparse or generic for the current matching to catch reliably.");

    console.log("\nNote: the sheet schema (type, title, url, thumbnail, date, description, credit, tags, preview) has no permission/consent column, so no automated permission-flag check was possible — that would need a new column added to the sheet first.");
    console.log('Nothing above was auto-repaired: this script only reads the sheet (no write credentials configured) and never fabricates titles/descriptions, per the brief — every flagged item needs a human sheet edit.');

    const totalIssues = Object.values(issues).reduce((s, arr) => s + arr.length, 0);
    console.log(`\n${totalIssues} potential issue(s) across ${items.length} items.`);

    if (jsonPath) {
        fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), itemCount: items.length, issues }, null, 2));
        console.log(`Full report written to ${jsonPath}`);
    }
}

main().catch(err => {
    console.error('Validation failed:', err);
    process.exit(1);
});
