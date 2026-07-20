import { fetchSheet, yearFrom, dateStamp } from './sheet.js';
import { initPanCanvas } from './pan-canvas.js';

const TAGS = [
    'Event', 'Drag', 'Capture', 'Landmarks', 'Medium', 'Identity', 'Haunted',
    'Seaside', 'Non-Gendered', 'View', 'Island', 'Journey', 'Bubbles',
    'Wandering', 'Personal', 'Closeup', 'Change', 'Found', 'Leisure',
    'Message', 'Trade', 'Going Out-Out', 'Movements', 'Uniform',
    'Reflections', 'Town', 'Overcast', 'Dream', 'Structures', 'Impermanence',
    'Histories', 'Restrictions', 'Symbols', 'Signs', 'Slogan', 'Homey',
    'Digestion', 'Communal', 'Rubbish', 'Gendered', 'Lost',
];

const PLACEHOLDER_COUNT = 140;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Stand-in content for testing the canvas/filters before real media is
// published. Every tag gets used at least a few times so filtering can be
// exercised properly. These vanish automatically the moment a real published
// project shows up in the sheet — see init() below.
function makePlaceholderItems(count = PLACEHOLDER_COUNT) {
    const kinds = ['photo', 'photo', 'photo', 'video', 'audio', '3d'];
    const projects = ['Test Set A', 'Test Set B', 'Test Set C', 'Test Set D'];
    const ratios = [0.72, 1, 1, 1.35, 1.6];
    const items = [];

    for (let i = 0; i < count; i++) {
        const primaryTag = TAGS[i % TAGS.length];
        const tags = new Set([primaryTag]);
        const extra = 1 + Math.floor(Math.random() * 2);
        while (tags.size < 1 + extra) {
            tags.add(TAGS[Math.floor(Math.random() * TAGS.length)]);
        }

        const year = 2019 + (i % 8);
        const month = String(1 + (i % 12)).padStart(2, '0');
        const day = String(1 + ((i * 7) % 28)).padStart(2, '0');
        const hue = Math.round((i * 47) % 360);

        items.push({
            _placeholder: true,
            _placeholderBg: `hsl(${hue}, 60%, 90%)`,
            _placeholderFg: `hsl(${hue}, 45%, 32%)`,
            _placeholderRatio: ratios[i % ratios.length],
            type: kinds[i % kinds.length],
            title: `Placeholder ${i + 1}`,
            url: '',
            thumbnail: '',
            date: `${year}-${month}-${day}`,
            description: `Stand-in test item. Will be replaced by real archive media tagged: ${[...tags].join(', ')}.`,
            credit: 'Test data',
            tags: [...tags].join(', '),
            project: projects[i % projects.length],
            projectYear: String(year),
        });
    }
    return items;
}

function placeholderBox(item, large) {
    const box = document.createElement('div');
    // Non-large boxes deliberately have no aspect-ratio of their own — they
    // fill whatever slot pan-canvas.js already sized for this tile, exactly
    // like a real photo does with object-fit: cover.
    box.className = large ? 'media-placeholder-box media-placeholder-box--large' : 'media-placeholder-box';
    box.style.setProperty('--ph-bg', item._placeholderBg);
    box.style.setProperty('--ph-fg', item._placeholderFg);
    box.innerHTML = `
        <span class="media-placeholder-type">${esc(item.type)}</span>
        <span class="media-placeholder-title">${esc(item.title)}</span>
    `;
    return box;
}

let allItems = [];
let filtered = [];
const activeTags = new Set();

const canvasEl = document.getElementById('panCanvas');
const tagBar = document.getElementById('tagBar');
const clearBtn = document.getElementById('clearFilters');
const gridStatus = document.getElementById('gridStatus');
const itemsListToggle = document.getElementById('scrapItemsToggle');
const itemsList = document.getElementById('scrapItemsList');

// The list pops via position:fixed (see styles.css) rather than a CSS
// bottom:100% anchor, since .tag-bar's overflow-x:auto (needed for the
// mobile tag-scroll fallback) would otherwise clip it — so its position
// is computed here, above the bottom bar and aligned under the toggle.
itemsListToggle.addEventListener('toggle', () => {
    if (!itemsListToggle.open) return;
    const barRect = document.querySelector('.filter-bar-bottom').getBoundingClientRect();
    const toggleRect = itemsListToggle.getBoundingClientRect();
    itemsList.style.bottom = `${window.innerHeight - barRect.top + 8}px`;
    itemsList.style.left = `${toggleRect.left}px`;
});

const lightbox = document.getElementById('lightbox');
const lightboxMedia = document.getElementById('lightboxMedia');
const lightboxInfo = document.getElementById('lightboxInfo');
const lightboxClose = document.getElementById('lightboxClose');
let lightboxIndex = -1;
let lastFocused = null;

// ===== TAG BAR =====
TAGS.forEach(tag => {
    const pill = document.createElement('button');
    pill.className = 'tag-pill';
    pill.textContent = tag;
    pill.setAttribute('aria-pressed', 'false');
    pill.addEventListener('click', () => {
        if (activeTags.has(tag)) activeTags.delete(tag);
        else activeTags.add(tag);
        const active = activeTags.has(tag);
        pill.classList.toggle('active', active);
        pill.setAttribute('aria-pressed', String(active));
        applyFilters();
    });
    tagBar.appendChild(pill);
});

clearBtn.addEventListener('click', () => {
    activeTags.clear();
    tagBar.querySelectorAll('.tag-pill.active').forEach(p => {
        p.classList.remove('active');
        p.setAttribute('aria-pressed', 'false');
    });
    applyFilters();
});

// ===== FILTERING =====
// Expand each comma-separated tag into the full value plus its slash parts,
// so "Coastal/Edge" on an item matches the "Seaside/Coastal/Edge" pill and
// vice versa.
function itemTags(item) {
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

function matchesTag(item, tag) {
    const tags = itemTags(item);
    const wanted = tag.toLowerCase();
    if (tags.includes(wanted)) return true;
    return wanted.split('/').some(part => tags.includes(part.trim()));
}

function applyFilters() {
    filtered = allItems.filter(item => [...activeTags].every(tag => matchesTag(item, tag)));
    clearBtn.classList.toggle('visible', activeTags.size > 0);
    panCanvas.setItems(filtered);
    rebuildKeyboardList();
    updateStatus();
}

function updateStatus() {
    if (!allItems.length) {
        gridStatus.textContent = 'Nothing in the archive yet — check back soon.';
    } else if (!filtered.length) {
        gridStatus.textContent = 'Nothing matches those filters — try removing one.';
    } else {
        gridStatus.textContent = '';
    }
}

// ===== KEYBOARD / SCREEN-READER FALLBACK =====
// The pan canvas is a continuously-moving, pooled/recycled visual surface —
// DOM order has no coherent relationship to spatial position, so individual
// tiles are not focusable (see .pan-canvas[aria-hidden] in the HTML). This
// real, focusable list — styled to sit as the first "tag" in the tag bar,
// bold rather than a plain pill so it doesn't look like a filter — is the
// actual way keyboard/AT users reach every item, same pattern as
// editorial.js's room-items-toggle.
function rebuildKeyboardList() {
    itemsList.innerHTML = '';
    filtered.forEach((item, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.textContent = `${item.title || 'Untitled'}${item.project ? ` — ${item.project}` : ''}`;
        btn.addEventListener('click', () => openLightbox(i));
        li.appendChild(btn);
        itemsList.appendChild(li);
    });
    itemsListToggle.style.display = filtered.length ? '' : 'none';
}

// ===== RENDERING =====
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// The "Content Warning" tag is a curatorial flag, not a filter pill (it's
// deliberately absent from TAGS) — checked independently here rather than
// via itemTags()/matchesTag(), which only concern themselves with the pills.
function hasContentWarning(item) {
    return (item.tags || '').split(',').some(t => t.trim().toLowerCase() === 'content warning');
}

function buildMedia(item, large) {
    if (item.type === 'video') {
        const v = document.createElement('video');
        v.src = item.url;
        v.muted = !large;
        v.loop = true;
        v.playsInline = true;
        v.preload = 'metadata';
        // Respect reduced motion: no autoplay, give controls instead
        v.controls = large || reduceMotion;
        if (!large && !reduceMotion) v.autoplay = true;
        return v;
    }
    if (item.type === 'audio') {
        const wrap = document.createElement('div');
        wrap.className = 'media-item-audio';
        const a = document.createElement('audio');
        a.src = item.url;
        a.controls = true;
        wrap.appendChild(a);
        return wrap;
    }
    // photo and 3d (3d shows its thumbnail)
    const img = document.createElement('img');
    img.src = item.type === '3d' ? (item.thumbnail || item.url) : item.url;
    img.alt = item.alt || item.title || 'Archive item';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
}

function mediaElement(item, { large = false } = {}) {
    if (item._placeholder) return placeholderBox(item, large);
    const media = buildMedia(item, large);
    if (!hasContentWarning(item)) return media;

    // Grid tiles: blurred with a small badge, tap-through to the lightbox
    // works exactly as any other tile (the wrapper doesn't intercept the
    // tap — see .pan-tile-inner img/video pointer-events:none).
    // Lightbox: blurred behind a real button that must be clicked to reveal.
    const wrap = document.createElement('div');
    wrap.className = large ? 'cw-wrap cw-wrap-large' : 'cw-wrap';
    media.classList.add('cw-blurred');
    wrap.appendChild(media);

    if (large) {
        const gate = document.createElement('button');
        gate.type = 'button';
        gate.className = 'cw-gate';
        gate.innerHTML = '<span class="cw-gate-icon">⚠</span><span class="cw-gate-text">Content warning — click to view</span>';
        gate.addEventListener('click', (e) => {
            e.stopPropagation();
            media.classList.remove('cw-blurred');
            gate.remove();
        });
        wrap.appendChild(gate);
    } else {
        const badge = document.createElement('span');
        badge.className = 'cw-badge';
        badge.textContent = '⚠ Content warning';
        wrap.appendChild(badge);
    }

    return wrap;
}

// ===== PAN CANVAS =====
const panCanvas = initPanCanvas(canvasEl, {
    renderTile: (item) => mediaElement(item, { large: false }),
    reduceMotion,
    onActivate(item, index, tileEl) {
        const others = shuffle(
            [...canvasEl.querySelectorAll('.pan-tile')].filter(el => el !== tileEl)
        );
        others.forEach((el, i) => {
            setTimeout(() => el.querySelector('.pan-tile-inner')?.classList.add('tile-fading'), i * 20);
        });
        tileEl.querySelector('.pan-tile-inner')?.classList.add('tile-active');
        setTimeout(() => openLightbox(filtered.indexOf(item)), 300);
    },
});

// ===== LIGHTBOX =====
function openLightbox(index) {
    if (index < 0 || index >= filtered.length) return;
    const wasOpen = lightbox.classList.contains('open');
    lightboxIndex = index;
    const item = filtered[index];

    lightboxMedia.innerHTML = '';
    lightboxMedia.appendChild(mediaElement(item, { large: true }));

    const year = yearFrom(item.date, item.projectYear);
    const meta = [item.project, year, item.credit ? `© ${item.credit}` : '']
        .filter(Boolean).join(' · ');
    const tags = itemTags(item);
    lightboxInfo.innerHTML = `
        <h3>${esc(item.title)}</h3>
        <p class="lb-meta">${esc(meta)}</p>
        <p class="lb-desc">${esc(item.description)}</p>
        ${item.type === '3d' && !item._placeholder ? '<p class="lb-desc">3D object — see it in the Editorial room.</p>' : ''}
        <div class="lb-tags">${tags.map(t => `<span class="lb-tag">${esc(t)}</span>`).join('')}</div>
    `;
    lightbox.classList.add('open');

    if (!wasOpen) {
        lastFocused = document.activeElement;
        document.body.style.overflow = 'hidden';
        lightboxClose.focus();
    }
}

function closeLightbox() {
    lightbox.classList.remove('open');
    lightboxMedia.innerHTML = '';
    lightboxIndex = -1;
    document.body.style.overflow = '';
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
}

lightboxClose.addEventListener('click', closeLightbox);
document.getElementById('lightboxPrev').addEventListener('click', () => openLightbox(lightboxIndex - 1));
document.getElementById('lightboxNext').addEventListener('click', () => openLightbox(lightboxIndex + 1));
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxMedia) closeLightbox();
});

document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') openLightbox(lightboxIndex - 1);
    if (e.key === 'ArrowRight') openLightbox(lightboxIndex + 1);
    if (e.key === 'Tab') {
        // Keep focus inside the dialog while it is open
        const focusables = lightbox.querySelectorAll('button, audio, video, [href], [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

// ===== DATA LOAD =====
async function init() {
    try {
        const index = await fetchSheet('_index');
        const published = index.filter(p => p.status === 'published' && p.tab);

        const results = await Promise.allSettled(published.map(p => fetchSheet(p.tab)));
        results.forEach((res, i) => {
            if (res.status !== 'fulfilled') return;
            const project = published[i];
            res.value.forEach(row => {
                if (!row.url && !row.thumbnail) return;
                allItems.push({ ...row, project: project.title, projectYear: project.year });
            });
        });

        if (!allItems.length) {
            allItems = makePlaceholderItems();
            console.info(`Scrapbook: no published items in the sheet — showing ${allItems.length} placeholder test items.`);
        }

        allItems.sort((a, b) => dateStamp(b.date) - dateStamp(a.date));
        applyFilters();
    } catch (err) {
        console.warn('Archive load failed:', err.message);
        gridStatus.textContent = 'Could not reach the archive — try refreshing.';
    }
}

init();
