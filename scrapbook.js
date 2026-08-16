import { yearFrom, dateStamp } from './sheet.js';
import { initPanCanvas } from './pan-canvas.js';
import { loadArchive } from './archive.js';
import { TAGS, itemTags, matchesTag } from './tags.js';

const PLACEHOLDER_COUNT = 140;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ===== TAPE DECORATION =====
// Physical scrapbook touch — washi tape across the top of some tiles, like
// they've been stuck to a page. Deterministic per grid SLOT (row/col/kx/ky)
// rather than per item, the same reasoning as pan-canvas.js's own
// ratioForSlot/jitterForSlot: a tile is torn down and rebuilt from scratch
// every time it's recycled while panning, so anything based on Math.random()
// would visibly re-roll mid-session. Salted per decision so presence/pick/
// rotation/position don't correlate.
const TAPE_IMAGES = ['images/tape/tape-1.png', 'images/tape/tape-2.png', 'images/tape/tape-3.png', 'images/tape/tape-4.png'];
const TAPE_CHANCE = 0.2;

function slotHash(row, col, kx, ky, salt) {
    let h = (row * 92821 + col * 43711 + kx * 15485867 + ky * 32452867 + salt * 2654435761) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = h ^ (h >>> 16);
    return Math.abs(h);
}
// [0, 1) — same shape as Math.random(), just deterministic per slot+salt.
function slotRandom(row, col, kx, ky, salt) {
    return (slotHash(row, col, kx, ky, salt) % 100000) / 100000;
}

function renderTileOverlay(item, row, col, kx, ky) {
    if (item._placeholder) return null; // stand-in test content, not worth decorating
    // Tape is positioned against the tile's own rectangular edge, which
    // matches a photo (fills the tile edge-to-edge) but not the audio
    // badge — a smaller circle inset within the tile — where the strip
    // ends up floating near the tile's corner instead of touching the
    // circle it's supposedly holding down.
    if (item.type === 'audio') return null;
    if (slotRandom(row, col, kx, ky, 1) >= TAPE_CHANCE) return null;

    const src = TAPE_IMAGES[Math.floor(slotRandom(row, col, kx, ky, 2) * TAPE_IMAGES.length)];
    const rotate = (slotRandom(row, col, kx, ky, 3) - 0.5) * 16; // -8deg..8deg
    const shiftX = (slotRandom(row, col, kx, ky, 4) - 0.5) * 30; // -15%..15% of tile width
    const tape = document.createElement('img');
    tape.src = src;
    tape.alt = '';
    tape.className = 'tile-tape';
    tape.style.setProperty('--tape-rotate', `${rotate.toFixed(1)}deg`);
    tape.style.setProperty('--tape-shift', `${shiftX.toFixed(1)}%`);
    return [tape];
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
function applyFilters() {
    filtered = allItems.filter(item => [...activeTags].every(tag => matchesTag(item, tag)));
    clearBtn.classList.toggle('visible', activeTags.size > 0);
    // The canvas pools items in contiguous chunks (one screenful at a time —
    // see cellItemIndex in pan-canvas.js), and `filtered` is sorted by date,
    // so same-project items (which mostly share a date) landed in the same
    // chunk and visibly clumped together while panning. A shuffled copy for
    // the canvas breaks that up; `filtered` itself stays date-ordered since
    // the keyboard/screen-reader list and lightbox prev/next both still walk
    // it in that (more sensible for those) order.
    panCanvas.setItems(shuffle([...filtered]));
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

// Simple deterministic string hash — used so the same PDF always gets the
// same little tilt/shade rather than it changing every time the tile is
// recycled while panning (see pan-canvas.js's own hash() for the same
// reasoning applied to tile shape/jitter).
function strHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// Stand-in for a download item whose thumbnail 404s — a real title beats a
// browser's broken-image icon, at least until PDF thumbnails exist. Styled
// as a pink post-it rather than a plain grey box, fitting the scrapbook
// page's own tape/sticker physical-page look.
function documentPlaceholder(item, large) {
    const box = document.createElement('div');
    box.className = large ? 'postit-note postit-note--large' : 'postit-note';
    const h = strHash(item.title || item.url || '');
    const rotate = ((h % 1000) / 1000 - 0.5) * 8; // -4deg..4deg, deterministic per item
    box.style.setProperty('--postit-rotate', `${rotate.toFixed(1)}deg`);
    box.innerHTML = `
        <span class="postit-type">PDF</span>
        <span class="postit-title">${esc(item.title)}</span>
    `;
    return box;
}

// A genuinely curved circular label — CSS alone can't bend text along a
// path, so this is real SVG: a <textPath> following a full circle built
// from two semicircle arcs (left-to-right over the top, then right-to-left
// under the bottom — a single arc command can't express exactly 360° since
// its start/end points would coincide, and using two points a hair apart
// instead, as a single near-360° arc, renders correctly by getTotalLength()
// but leaves most of the actual text invisible in practice — confirmed by
// testing both side by side). Each call needs its own unique path id since
// <textPath href> resolves against the whole document, not just this
// element — reusing one id across multiple badges on the same page would
// make every badge but the first point at nothing.
// The path lives in a fixed 200x200 viewBox, so its length never changes no
// matter how large the circle is actually rendered on screen — a bigger
// on-screen circle alone doesn't fit more text, it just makes the same
// fixed character count bigger. Font-size is what trades against capacity:
// fits ~65 characters at 15px around this path's ~565-unit circumference,
// which is the real limit here, not an arbitrary one — going bigger than
// that font size to read clearly on a small tile means accepting a shorter
// max length. textLength+lengthAdjust stretches whatever text there is
// (even a short title) to genuinely fill the whole ring rather than
// leaving it as a small arc — confirmed working the same whether it's set
// on <text> or its <textPath> child; kept on <text> to match spec.
const AUDIO_FONT_SIZE = 15;
const AUDIO_TEXT_RADIUS = 78; // inset from the disc's own r=90 edge, so text doesn't sit flush against the rim
const AUDIO_MAX_CHARS = 56; // what AUDIO_FONT_SIZE actually fits around the (smaller, inset) path
const AUDIO_CIRCLE_SIZE = 92; // % of tile — consistently large; font-size no longer varies by length

function truncate(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max - 1).trimEnd() + '…';
}

let audioBadgeCounter = 0;
function audioBadgeCircle(rawText) {
    const text = truncate(rawText, AUDIO_MAX_CHARS);
    const id = `audio-badge-path-${audioBadgeCounter++}`;
    const wrap = document.createElement('span');
    wrap.className = 'audio-badge-circle';
    wrap.style.setProperty('--audio-circle-size', `${AUDIO_CIRCLE_SIZE}%`);
    wrap.innerHTML = `
        <svg viewBox="0 0 200 200" class="audio-badge-svg" aria-hidden="true">
            <defs>
                <path id="${id}" d="M 100,100 m -${AUDIO_TEXT_RADIUS},0 a ${AUDIO_TEXT_RADIUS},${AUDIO_TEXT_RADIUS} 0 1,0 ${AUDIO_TEXT_RADIUS * 2},0 a ${AUDIO_TEXT_RADIUS},${AUDIO_TEXT_RADIUS} 0 1,0 -${AUDIO_TEXT_RADIUS * 2},0" fill="none" />
            </defs>
            <circle cx="100" cy="100" r="90" class="audio-badge-disc" />
            <text class="audio-badge-curved-text" style="font-size:${AUDIO_FONT_SIZE}px" textLength="${(AUDIO_TEXT_RADIUS * 2 * Math.PI * 0.97).toFixed(0)}" lengthAdjust="spacing">
                <textPath href="#${id}" startOffset="1%">${esc(text)}</textPath>
            </text>
            <text x="100" y="106" text-anchor="middle" class="audio-badge-icon-svg">♫</text>
        </svg>
    `;
    return wrap;
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
        // In the grid, a real <audio controls> element used to sit directly
        // in the tile — its own play/seek controls swallow the click, so
        // there was no way to actually reach the title/description/tags
        // for an audio item the way every other tile type gets them via
        // the lightbox. A plain badge here has no controls of its own, so
        // a tap falls through to the normal tile-activate/open-lightbox
        // handling instead, same as a photo. The real player only appears
        // once you're already in the lightbox.
        if (!large) {
            const badge = document.createElement('div');
            badge.className = 'media-item-audio-badge';
            badge.appendChild(audioBadgeCircle(item.description || item.title));
            return badge;
        }
        const wrap = document.createElement('div');
        wrap.className = 'media-item-audio';
        const a = document.createElement('audio');
        a.src = item.url;
        a.controls = true;
        wrap.appendChild(a);
        return wrap;
    }
    // download items are PDFs/documents — item.url is the file itself, not
    // an image, so it can never go in an <img src>  (that's what was
    // producing a broken-image icon in the lightbox). Same idea as 3d:
    // always show the thumbnail as the visual, and in the lightbox add an
    // actual link to open the real file, since the whole point of a
    // "download" item is reaching that file.
    if (item.type === 'download') {
        const img = document.createElement('img');
        img.src = item.thumbnail || '';
        img.alt = item.alt || item.title || 'Archive document';
        img.loading = 'lazy';
        img.decoding = 'async';
        // None of the download items currently have a real thumbnail
        // uploaded (every one 404s — a PDF page-render step that hasn't
        // been done yet, not something fixable from the site's own code).
        // Falls back to a plain document placeholder instead of a broken-
        // image icon so it's at least legible in the meantime.
        img.addEventListener('error', () => {
            img.replaceWith(documentPlaceholder(item, large));
        }, { once: true });
        if (!large) return img;

        const wrap = document.createElement('div');
        wrap.className = 'media-item-download';
        wrap.appendChild(img);
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'media-download-link';
        link.textContent = 'Open original PDF ↗';
        wrap.appendChild(link);
        return wrap;
    }
    // 3d always shows its thumbnail (item.url is the model file, not an
    // image). Photos show a thumbnail in the grid too when one's set — full
    // originals are often multiple MB for what's a small pan-canvas tile —
    // but the lightbox ("large") always gets the real, full-resolution file.
    const img = document.createElement('img');
    if (item.type === '3d') {
        img.src = item.thumbnail || item.url;
    } else {
        img.src = (!large && item.thumbnail) ? item.thumbnail : item.url;
    }
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
// Pending fade/open timeouts from the most recent onActivate() — with 50+
// tiles pooled, the staggered i*20ms fade-outs below can still be queued up
// well past when the lightbox actually opens (300ms), so closing it quickly
// otherwise leaves some of these to fire late and re-fade a tile that
// closeLightbox() already cleaned up. Tracked here so close can cancel
// whatever's still pending, not just undo what already ran.
let activateTimeouts = [];

const panCanvas = initPanCanvas(canvasEl, {
    renderTile: (item) => mediaElement(item, { large: false }),
    renderOverlay: renderTileOverlay,
    reduceMotion,
    onActivate(item, index, tileEl) {
        const others = shuffle(
            [...canvasEl.querySelectorAll('.pan-tile')].filter(el => el !== tileEl)
        );
        others.forEach((el, i) => {
            activateTimeouts.push(
                setTimeout(() => el.querySelector('.pan-tile-inner')?.classList.add('tile-fading'), i * 20)
            );
        });
        tileEl.querySelector('.pan-tile-inner')?.classList.add('tile-active');
        activateTimeouts.push(setTimeout(() => openLightbox(filtered.indexOf(item)), 300));
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
    // onActivate() fades every other tile out and scales the clicked one up
    // right before the lightbox opens (see the pan canvas setup below) —
    // undone here, or closing left a permanent blank patch where those
    // tiles never got their opacity back. Cancels whatever staggered
    // fade-out timeouts are still pending too, not just the classes already
    // applied — otherwise a late one can still fire and re-fade a tile after
    // this cleanup already ran (see activateTimeouts above).
    activateTimeouts.forEach(id => clearTimeout(id));
    activateTimeouts = [];
    canvasEl.querySelectorAll('.tile-fading, .tile-active').forEach(el => {
        el.classList.remove('tile-fading', 'tile-active');
    });
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
}

lightboxClose.addEventListener('click', closeLightbox);
document.getElementById('lightboxPrev').addEventListener('click', () => openLightbox(lightboxIndex - 1));
document.getElementById('lightboxNext').addEventListener('click', () => openLightbox(lightboxIndex + 1));
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxMedia) closeLightbox();
});

// Swipe-to-advance — scoped to the media area only (not .lightbox-info),
// so a scroll of the description text never reaches this listener at all;
// no gesture-disambiguation against scrolling is needed.
const SWIPE_THRESHOLD = 50;
let swipeStartX = 0, swipeStartY = 0, swiping = false;

lightboxMedia.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
    swiping = false;
    lightboxMedia.setPointerCapture(e.pointerId);
});

lightboxMedia.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return;
    const dx = e.clientX - swipeStartX, dy = e.clientY - swipeStartY;
    if (!swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) swiping = true;
    if (swiping) e.preventDefault(); // stops this from also becoming the click that closes the lightbox
});

lightboxMedia.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' || !swiping) { swiping = false; return; }
    const dx = e.clientX - swipeStartX;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
        e.preventDefault();
        openLightbox(lightboxIndex + (dx < 0 ? 1 : -1));
    }
    swiping = false;
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
        allItems = await loadArchive();

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
