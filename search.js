// Hybrid lexical search for the accessible archive — built for imperfect,
// conversational memory ("I made a collage about gender", "it had a boat in
// it"), not just exact title lookup. No server/build step in this project
// (static files only — see project notes), so this runs entirely
// client-side against the same items scrapbook.js already loads; there's no
// precomputed semantic embedding layer yet (see the implementation report
// for what that would take to add later). What this DOES do: strip
// low-value conversational filler, match per-field with different weights,
// and tolerate small typos via edit-distance on top of exact/substring
// matching — which covers the large majority of "I sort of remember..."
// queries without needing an external model or per-visitor API cost.

// Dropped before matching — carries no distinguishing signal for THIS
// archive's content, and reliably appears in exactly the kind of vague,
// conversational query this needs to handle well ("I think it was...",
// "mine had...", "something about...").
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

const FIELD_WEIGHTS = {
    title: 5,
    tags: 4,
    description: 2.5,
    credit: 1.5,
    project: 1.5,
};

function normalize(str) {
    return (str || '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
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

// Iterative Levenshtein distance, capped — exact typo tolerance for single-
// word slips ("colage" -> "collage", "gendar" -> "gender") without being
// expensive enough to matter at this item count.
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
        if (rowMin > max) return max + 1; // whole row exceeded — no point continuing
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

// Distance allowance by term length. Deliberately tighter than it first
// looks: a distance-2 allowance at 5-6 letters was found (via testing) to
// coincidentally match unrelated same-length words ("gender" ~ "geode",
// both distance 2) as often as it caught real typos — capping those
// lengths at distance 1 keeps genuine single-edit typos ("colage" ->
// "collage") working while dropping the coincidental collisions.
function fuzzyThreshold(len) {
    if (len <= 6) return 1;
    if (len <= 9) return 2;
    return 3;
}

// One entry per item: normalized text + token list per weighted field, plus
// the item itself for building results from.
export function buildSearchIndex(items) {
    return items.map(item => {
        const fields = {};
        for (const field of Object.keys(FIELD_WEIGHTS)) {
            const raw = field === 'tags' ? (item.tags || '').replace(/\//g, ' ') : item[field];
            fields[field] = { text: normalize(raw), tokens: tokenize(raw) };
        }
        return { item, fields };
    });
}

// Ranked results — each with a `reason` string safe to show directly
// ("Possible match because it relates to X, Y") and NO raw numeric score
// exposed to callers, per the brief: visitors shouldn't see confidence
// numbers or be told a match is certain.
export function search(index, rawQuery, { maxResults = 30, minScore = 3 } = {}) {
    const terms = queryTokens(rawQuery);
    if (!terms.length) return [];

    const scored = index.map(entry => {
        let score = 0;
        const matchedTerms = new Map(); // term -> best field it matched in

        for (const term of terms) {
            let bestFieldForTerm = null;
            let bestFieldScore = 0;

            for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
                const { text, tokens } = entry.fields[field];
                if (!text) continue;

                let hit = 0;
                if (tokens.includes(term)) {
                    hit = 1; // exact token match
                } else if (text.includes(term)) {
                    hit = 0.85; // substring (handles compound words, partial titles)
                } else {
                    // Fuzzy: only bother for the field's own tokens close in
                    // length, keeps this cheap.
                    const threshold = fuzzyThreshold(term.length);
                    for (const tok of tokens) {
                        if (Math.abs(tok.length - term.length) > threshold) continue;
                        if (editDistance(term, tok, threshold) <= threshold) { hit = 0.6; break; }
                    }
                }

                const fieldScore = hit * weight;
                if (fieldScore > bestFieldScore) { bestFieldScore = fieldScore; bestFieldForTerm = field; }
            }

            if (bestFieldForTerm) {
                score += bestFieldScore;
                matchedTerms.set(term, bestFieldForTerm);
            }
        }

        // Multi-term queries: reward covering MORE of the query, not just
        // matching one term very well, so a two-word query doesn't rank a
        // one-word coincidental match above a genuine two-word match.
        const coverage = matchedTerms.size / terms.length;
        score *= (0.5 + 0.5 * coverage);

        return { entry, score, matchedTerms };
    });

    return scored
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(r => ({ item: r.entry.item, reason: buildReason(r.matchedTerms) }));
}

// "gender, collage and identity" — pulled from whichever query terms
// actually matched something, favouring the higher-weight fields (title/
// tags) they landed in, deliberately worded as a possibility, not a claim.
function buildReason(matchedTerms) {
    const priority = ['title', 'tags', 'description', 'project', 'credit'];
    const terms = [...matchedTerms.entries()]
        .sort((a, b) => priority.indexOf(a[1]) - priority.indexOf(b[1]))
        .map(([term]) => term)
        .slice(0, 4);
    if (!terms.length) return '';
    const list = terms.length === 1 ? terms[0]
        : `${terms.slice(0, -1).join(', ')} and ${terms[terms.length - 1]}`;
    return `Possible match because it relates to ${list}`;
}

// For "show more like this" — takes a result item and turns its own tags +
// a couple of title words into a fresh query, rather than requiring the
// visitor to retype anything.
export function likeQueryFor(item) {
    const tagWords = (item.tags || '').split(',').map(t => t.split('/')[0].trim()).filter(Boolean);
    const titleWords = tokenize(item.title).filter(t => !STOPWORDS.has(t)).slice(0, 3);
    return [...new Set([...tagWords, ...titleWords])].join(' ');
}
