// Shared filter-tag vocabulary — used by both scrapbook.js (tag pills) and
// accessible.js (search refinement chips), split out so the two views can't
// silently drift apart into two different tag lists.
export const TAGS = [
    'Event', 'Drag', 'Capture', 'Landmarks', 'Identity', 'Haunted',
    'Seaside', 'Non-Gendered', 'View', 'Island', 'Journey', 'Bubbles',
    'Wandering', 'Personal', 'Closeup', 'Change', 'Found', 'Leisure',
    'Message', 'Trade', 'Going Out-Out', 'Movements', 'Uniform',
    'Reflections', 'Town', 'Overcast', 'Dream', 'Structures', 'Impermanence',
    'Histories', 'Restrictions', 'Symbols', 'Signs', 'Slogan', 'Homey',
    'Digestion', 'Communal', 'Rubbish', 'Gendered', 'Lost',
];

// Expand each comma-separated tag into the full value plus its slash parts,
// so "Coastal/Edge" on an item matches the "Seaside/Coastal/Edge" pill and
// vice versa. Shared so scrapbook's tag-filter and accessible's search both
// treat tags identically.
export function itemTags(item) {
    const parts = [];
    (item.tags || '').toLowerCase().split(',').forEach(raw => {
        const full = raw.trim();
        if (!full) return;
        parts.push(full);
        if (full.includes('/')) {
            full.split('/').forEach(p => {
                const s = p.trim();
                if (s) parts.push(s);
            });
        }
    });
    return parts;
}

export function matchesTag(item, tag) {
    const tags = itemTags(item);
    const wanted = tag.toLowerCase();
    if (tags.includes(wanted)) return true;
    return wanted.split('/').some(part => tags.includes(part.trim()));
}

// Sticker-background pairing for scrapbook's tag-filter pills (see
// images/tag-stickers/). Two pools by aspect ratio — WIDE (600x200) suits
// long text like "Non-Gendered" without squeezing it, COMPACT (roughly
// square) suits short/medium tags without leaving dead space either side.
// Assignment is by each tag's own position among same-length-category tags
// in the fixed TAGS order above, not random or hashed, so a given tag
// always lands on the same sticker rather than reshuffling per visit.
const WIDE_STICKERS = [
    'sticker-pill-long-navy',
    'sticker-arrow-navy',
    'sticker-ticket-long-pink',
    'sticker-label-long-pink',
];
const COMPACT_STICKERS = [
    'sticker-ticket',
    'sticker-oval-plain',
    'sticker-oval-floral',
    'sticker-stripe',
    'sticker-scallop',
    'sticker-starburst',
    'sticker-square',
    'sticker-ticket-notched',
    'sticker-oval-navy-thin',
    'sticker-rect-pink',
    'sticker-scallop-round-pink',
];
const WIDE_TAG_LENGTH = 10; // tag.length >= this uses the wide pool

export function tagStickerUrl(tag) {
    const isWide = tag.length >= WIDE_TAG_LENGTH;
    const pool = isWide ? WIDE_STICKERS : COMPACT_STICKERS;
    const sameCategory = TAGS.filter(t => (t.length >= WIDE_TAG_LENGTH) === isWide);
    const index = sameCategory.indexOf(tag) % pool.length;
    return `images/tag-stickers/${pool[index]}.png`;
}
