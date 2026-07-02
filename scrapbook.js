import { fetchSheet } from './sheet.js';

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
let lightboxIndex = -1;

// ===== TAG BAR =====
TAGS.forEach(tag => {
    const pill = document.createElement('button');
    pill.className = 'tag-pill';
    pill.textContent = tag;
    pill.addEventListener('click', () => {
        if (activeTags.has(tag)) activeTags.delete(tag);
        else activeTags.add(tag);
        pill.classList.toggle('active');
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
    tagBar.querySelectorAll('.tag-pill.active').forEach(p => p.classList.remove('active'));
    applyFilters();
});

// ===== FILTERING =====
function itemTags(item) {
    return (item.tags || '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
}

function matchesTag(item, tag) {
    const tags = itemTags(item);
    const wanted = tag.toLowerCase();
    if (tags.includes(wanted)) return true;
    // "Seaside/Coastal/Edge" matches any of its parts
    return wanted.split('/').some(part => tags.includes(part.trim()));
}

function matchesQuery(item) {
    if (!query) return true;
    const haystack = [item.title, item.description, item.credit, item.tags]
        .join(' ').toLowerCase();
    return query.split(/\s+/).every(word => haystack.includes(word));
}

function applyFilters() {
    filtered = allItems.filter(item =>
        [...activeTags].every(tag => matchesTag(item, tag)) && matchesQuery(item)
    );
    shown = 0;
    grid.innerHTML = '';
    gridStatus.textContent = '';
    clearBtn.classList.toggle('visible', activeTags.size > 0 || query.length > 0);
    loadMore();
    updateCount();
}

function updateCount() {
    if (!allItems.length) return;
    const label = filtered.length === 1 ? 'item' : 'items';
    itemCount.textContent = `${filtered.length} ${label}`;
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
        v.controls = large;
        if (!large) v.autoplay = true;
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
        card.appendChild(mediaElement(item));

        const caption = document.createElement('div');
        caption.className = 'media-item-caption';
        const year = item.date ? new Date(item.date).getFullYear() : '';
        caption.innerHTML = `
            <div class="media-item-title">${esc(item.title)}</div>
            <div class="media-item-meta">${esc([item.project, year].filter(Boolean).join(' · '))}</div>
        `;
        card.appendChild(caption);

        const index = filtered.indexOf(item);
        card.addEventListener('click', () => openLightbox(index));
        grid.appendChild(card);
    });
    shown += batch.length;

    if (!allItems.length) return;
    if (!filtered.length) {
        gridStatus.textContent = activeTags.size || query
            ? 'Nothing matches those filters — try removing one.'
            : 'Nothing in the archive yet — check back soon.';
    } else if (shown >= filtered.length) {
        gridStatus.textContent = '· end of the archive ·';
    }
}

// ===== INFINITE SCROLL =====
new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && shown < filtered.length) loadMore();
}, { rootMargin: '600px' }).observe(sentinel);

// ===== LIGHTBOX =====
function openLightbox(index) {
    if (index < 0 || index >= filtered.length) return;
    lightboxIndex = index;
    const item = filtered[index];

    lightboxMedia.innerHTML = '';
    lightboxMedia.appendChild(mediaElement(item, { large: true }));

    const year = item.date ? new Date(item.date).getFullYear() : '';
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
}

function closeLightbox() {
    lightbox.classList.remove('open');
    lightboxMedia.innerHTML = '';
    lightboxIndex = -1;
}

document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
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

        allItems.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
        applyFilters();

        if (!allItems.length) {
            itemCount.textContent = 'The archive is growing';
            gridStatus.textContent = 'Nothing in the archive yet — check back soon.';
        }
    } catch (err) {
        console.warn('Archive load failed:', err.message);
        itemCount.textContent = 'Archive unavailable';
        gridStatus.textContent = 'Could not reach the archive — try refreshing.';
    }
}

init();
