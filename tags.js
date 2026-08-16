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
