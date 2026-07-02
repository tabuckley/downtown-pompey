import { fetchSheet, yearFrom, dateStamp } from './sheet.js';

const TAGS = [
    'Event', 'Press', 'Drag', 'Capture', 'Landmarks', 'Medium', 'Identity',
    'Haunted', 'Seaside/Coastal/Edge', 'Non-Gendered', 'Vista/View', 'Island',
    'Journey', 'Foam/Bubbles', 'Wandering', 'Personal', 'Closeup', 'Change',
    'Found', 'Leisure', 'Statement/Message', 'Trade', 'Going Out-Out',
    'Movements', 'Uniform', 'Kit', 'Reflections', 'Town', 'Overcast', 'Dream',
    'Idyllic', 'Structures', 'Impermanence', 'Histories', 'Restrictions',
    'Symbols', 'Signs', 'Slogan', 'Homey', 'Digestion', 'Communal', 'Flow',
    'Rubbish', 'Newness', 'Gendered', 'Lost',
];

const BATCH = 20;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let allItems = [];
let filtered = [];
let shown = 0;
const activeTags = new Set();
let query = '';

const grid = document.getElementById('mediaGrid');
const tagBar = document.getElementById('tagBar');
const searchInput = document.getElementById('searchInput');
const itemCount = document.getElementById('itemCount');
const clearBtn = document.getElementById('clearFilters');
const gridStatus = document.getElementById('gridStatus');
const sentinel = document.getElementById('scrollSentinel');

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

// ===== SEARCH =====
let searchTimer;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        query = searchInput.value.trim().toLowerCase();
        applyFilters();
    }, 200);
});

clearBtn.addEventListener('click', () => {
    activeTags.clear();
    query = '';
    searchInput.value = '';
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

function matchesQuery(item) {
    if (!query) return true;
    const haystack = [item.title, item.description, item.credit, item.tags, item.project, item.type]
        .join(' ').toLowerCase();
    return query.split(/\s+/).every(word => haystack.includes(word));
}

function applyFilters() {
    filtered = allItems.filter(item =>
        [...activeTags].every(tag => matchesTag(item, tag)) && matchesQuery(item)
    );
    shown = 0;
    grid.innerHTML = '';
    clearBtn.classList.toggle('visible', activeTags.size > 0 || query.length > 0);
    fillViewport();
    updateCount();
}

function updateCount() {
    if (!allItems.length) {
        itemCount.textContent = 'The archive is growing';
        return;
    }
    const label = filtered.length === 1 ? 'item' : 'items';
    itemCount.textContent = `${filtered.length} ${label}`;
}

function updateStatus() {
    if (!allItems.length) {
        gridStatus.textContent = 'Nothing in the archive yet — check back soon.';
    } else if (!filtered.length) {
        gridStatus.textContent = 'Nothing matches those filters — try removing one.';
    } else if (shown >= filtered.length) {
        gridStatus.textContent = '· end of the archive ·';
    } else {
        gridStatus.textContent = '';
    }
}

// ===== RENDERING =====
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function mediaElement(item, { large = false } = {}) {
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
    img.alt = item.title || 'Archive item';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
}

function loadMore() {
    const batch = filtered.slice(shown, shown + BATCH);
    batch.forEach(item => {
        const card = document.createElement('article');
        card.className = 'media-item';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `View ${item.title || 'archive item'}`);
        card.appendChild(mediaElement(item));

        const caption = document.createElement('div');
        caption.className = 'media-item-caption';
        const year = yearFrom(item.date, item.projectYear);
        caption.innerHTML = `
            <div class="media-item-title">${esc(item.title)}</div>
            <div class="media-item-meta">${esc([item.project, year].filter(Boolean).join(' · '))}</div>
        `;
        card.appendChild(caption);

        card.addEventListener('click', (e) => {
            // Let the inline audio player be used without opening the lightbox
            if (e.target.closest('audio')) return;
            openLightbox(filtered.indexOf(item));
        });
        card.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('audio')) {
                e.preventDefault();
                openLightbox(filtered.indexOf(item));
            }
        });
        grid.appendChild(card);
    });
    shown += batch.length;
    updateStatus();
}

// ===== INFINITE SCROLL =====
// IntersectionObserver only fires on state *transitions*, so if a batch
// doesn't push the sentinel out of range the callback would never re-fire.
// fillViewport keeps loading (a frame at a time) until the sentinel clears
// the trigger zone or everything is shown.
function sentinelNear() {
    return sentinel.getBoundingClientRect().top < window.innerHeight + 600;
}

function fillViewport() {
    loadMore();
    if (shown < filtered.length && sentinelNear()) {
        requestAnimationFrame(fillViewport);
    }
}

new IntersectionObserver((entries) => {
    if (entries[entries.length - 1].isIntersecting && shown < filtered.length) fillViewport();
}, { rootMargin: '600px' }).observe(sentinel);

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
        ${item.type === '3d' ? '<p class="lb-desc">3D object — see it in the Editorial room.</p>' : ''}
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

        allItems.sort((a, b) => dateStamp(b.date) - dateStamp(a.date));
        applyFilters();
    } catch (err) {
        console.warn('Archive load failed:', err.message);
        itemCount.textContent = 'Archive unavailable';
        gridStatus.textContent = 'Could not reach the archive — try refreshing.';
    }
}

init();
