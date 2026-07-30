// Accessible archive: plain-text search built for imperfect memory, real
// focusable results (no pan-canvas-style unfocusable tiles), and a stable
// per-item URL every result deep-links to. See search.js for the matching
// approach and its known limits (lexical + typo-tolerant, no semantic
// embeddings yet).
import { loadArchive } from './archive.js';
import { TAGS, itemTags } from './tags.js';
import { buildSearchIndex, search, likeQueryFor } from './search.js';
import { yearFrom } from './sheet.js';

const TYPE_LABELS = { photo: 'Photo', video: 'Video', audio: 'Audio', '3d': '3D object', download: 'Document' };

const searchView = document.getElementById('accSearchView');
const detailView = document.getElementById('accDetailView');
const form = document.getElementById('accSearchForm');
const input = document.getElementById('accSearchInput');
const typeFiltersEl = document.getElementById('accTypeFilters');
const tagFiltersEl = document.getElementById('accTagFilters');
const projectFilterEl = document.getElementById('accProjectFilter');
const statusEl = document.getElementById('accStatus');
const resultsEl = document.getElementById('accResults');
const backLink = document.getElementById('accBackLink');
const detailContent = document.getElementById('accDetailContent');

let allItems = [];
let searchIndex = [];
let itemsById = new Map();
const activeTypes = new Set();
const activeTags = new Set();
let lastSearchUrl = 'accessible.html';
// Session-only — "not this one" hides a result from THIS visitor's current
// browsing without recording anything server-side or requiring an account.
const dismissed = new Set();

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ===== FILTER UI =====
function buildFilterChips() {
    const typesPresent = [...new Set(allItems.map(i => i.type).filter(Boolean))];
    typesPresent.sort();
    typesPresent.forEach(type => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'acc-chip';
        btn.textContent = TYPE_LABELS[type] || type;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
            if (activeTypes.has(type)) activeTypes.delete(type); else activeTypes.add(type);
            btn.classList.toggle('active', activeTypes.has(type));
            btn.setAttribute('aria-pressed', String(activeTypes.has(type)));
            runSearch();
        });
        typeFiltersEl.appendChild(btn);
    });

    TAGS.forEach(tag => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'acc-chip';
        btn.textContent = tag;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
            if (activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
            btn.classList.toggle('active', activeTags.has(tag));
            btn.setAttribute('aria-pressed', String(activeTags.has(tag)));
            runSearch();
        });
        tagFiltersEl.appendChild(btn);
    });

    const projects = [...new Set(allItems.map(i => i.project).filter(Boolean))].sort();
    projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        projectFilterEl.appendChild(opt);
    });
    projectFilterEl.addEventListener('change', runSearch);
}

// ===== SEARCH + RENDER =====
function applyFilters(items) {
    return items.filter(item => {
        if (dismissed.has(item.id)) return false;
        if (activeTypes.size && !activeTypes.has(item.type)) return false;
        if (projectFilterEl.value && item.project !== projectFilterEl.value) return false;
        if (activeTags.size && ![...activeTags].every(tag => itemTags(item).some(t => t === tag.toLowerCase() || t.split('/').includes(tag.toLowerCase())))) return false;
        return true;
    });
}

function runSearch(pushUrl = true) {
    const query = input.value.trim();
    let results;
    if (query) {
        results = search(searchIndex, query, { maxResults: 60 }).map(r => ({ item: r.item, reason: r.reason }));
        results = results.filter(r => applyFilters([r.item]).length);
    } else {
        results = applyFilters(allItems)
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
            .slice(0, 60)
            .map(item => ({ item, reason: '' }));
    }

    renderResults(results, query);
    if (pushUrl) updateSearchUrl(query);
    lastSearchUrl = location.pathname.split('/').pop() + location.search;
}

function renderResults(results, query) {
    resultsEl.innerHTML = '';

    if (!allItems.length) {
        statusEl.textContent = 'Could not reach the archive — try refreshing.';
        return;
    }
    if (!results.length) {
        statusEl.textContent = query
            ? `No matches for "${query}". Try fewer or different words, or clear a filter.`
            : 'Nothing matches the current filters.';
        return;
    }
    statusEl.textContent = `${results.length} item${results.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}.`;

    results.forEach(({ item, reason }) => {
        const li = document.createElement('li');
        li.className = 'acc-result';

        const link = document.createElement('a');
        link.className = 'acc-result-link';
        link.href = `accessible.html?item=${encodeURIComponent(item.id)}`;
        link.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let modified/middle clicks behave normally
            e.preventDefault();
            showItem(item.id);
        });

        const thumbSrc = item.type === 'download' ? '' : (item.thumbnail || (item.type !== 'audio' ? item.url : ''));
        if (thumbSrc) {
            const img = document.createElement('img');
            img.className = 'acc-result-thumb';
            img.src = thumbSrc;
            img.alt = '';
            img.loading = 'lazy';
            link.appendChild(img);
        } else {
            const ph = document.createElement('div');
            ph.className = 'acc-result-thumb acc-result-thumb--none';
            ph.textContent = TYPE_LABELS[item.type] || item.type || '';
            link.appendChild(ph);
        }

        const meta = document.createElement('div');
        meta.className = 'acc-result-meta';
        const year = yearFrom(item.date, item.projectYear);
        meta.innerHTML = `
            <span class="acc-result-title">${esc(item.title || 'Untitled')}</span>
            <span class="acc-result-sub">${esc(item.project || '')}${year ? ` · ${esc(year)}` : ''}</span>
            ${reason ? `<span class="acc-result-reason">${esc(reason)}</span>` : ''}
        `;
        link.appendChild(meta);
        li.appendChild(link);
        resultsEl.appendChild(li);
    });
}

function updateSearchUrl(query) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (activeTypes.size) params.set('type', [...activeTypes].join(','));
    if (activeTags.size) params.set('tags', [...activeTags].join(','));
    if (projectFilterEl.value) params.set('project', projectFilterEl.value);
    const url = 'accessible.html' + (params.toString() ? `?${params}` : '');
    history.pushState({ view: 'search' }, '', url);
}

function restoreSearchStateFromUrl() {
    const params = new URLSearchParams(location.search);
    input.value = params.get('q') || '';
    (params.get('type') || '').split(',').filter(Boolean).forEach(t => activeTypes.add(t));
    (params.get('tags') || '').split(',').filter(Boolean).forEach(t => activeTags.add(t));
    if (params.get('project')) projectFilterEl.value = params.get('project');

    [...typeFiltersEl.children].forEach(btn => {
        const type = Object.keys(TYPE_LABELS).find(k => (TYPE_LABELS[k] || k) === btn.textContent) || btn.textContent.toLowerCase();
        const active = activeTypes.has(type);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
    [...tagFiltersEl.children].forEach(btn => {
        const active = activeTags.has(btn.textContent);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
});

// ===== ITEM DETAIL =====
function buildDetailMedia(item) {
    if (item.type === 'video') {
        const v = document.createElement('video');
        v.src = item.url;
        v.controls = true;
        v.className = 'acc-detail-media';
        return v;
    }
    if (item.type === 'audio') {
        const a = document.createElement('audio');
        a.src = item.url;
        a.controls = true;
        a.className = 'acc-detail-media acc-detail-media--audio';
        return a;
    }
    if (item.type === 'download') {
        const wrap = document.createElement('div');
        wrap.className = 'acc-detail-download';
        if (item.thumbnail) {
            const img = document.createElement('img');
            img.src = item.thumbnail;
            img.alt = '';
            img.className = 'acc-detail-media';
            img.addEventListener('error', () => img.remove());
            wrap.appendChild(img);
        }
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'acc-open-link';
        link.textContent = 'Open original document ↗';
        wrap.appendChild(link);
        return wrap;
    }
    // photo / 3d — 3d has no browser-native viewer here, so its thumbnail is
    // the whole picture, same as scrapbook's own treatment of these.
    const img = document.createElement('img');
    img.src = item.type === '3d' ? (item.thumbnail || item.url) : item.url;
    img.alt = item.title || 'Archive item';
    img.className = 'acc-detail-media';
    return img;
}

function showItem(id, pushUrl = true) {
    const item = itemsById.get(id);
    if (!item) {
        showNotFound(id);
        return;
    }

    searchView.hidden = true;
    detailView.hidden = false;
    backLink.href = lastSearchUrl;
    window.scrollTo(0, 0);

    detailContent.innerHTML = '';
    detailContent.appendChild(buildDetailMedia(item));

    const info = document.createElement('div');
    info.className = 'acc-detail-info';
    const year = yearFrom(item.date, item.projectYear);
    const tags = itemTags(item);
    info.innerHTML = `
        <p class="acc-result-sub">${esc(item.project || '')}${year ? ` · ${esc(year)}` : ''}${item.credit ? ` · © ${esc(item.credit)}` : ''}</p>
        <h1 class="acc-detail-title">${esc(item.title || 'Untitled')}</h1>
        <p class="acc-detail-desc">${esc(item.description || 'No description recorded for this item yet.')}</p>
        ${item.type === '3d' ? '<p class="acc-detail-desc">3D object — see it in the Editorial room for the interactive version.</p>' : ''}
        <div class="acc-tag-row">${tags.map(t => `<span class="acc-tag-pill">${esc(t)}</span>`).join('')}</div>
    `;
    detailContent.appendChild(info);
    detailContent.appendChild(buildShareBlock(item));
    detailContent.appendChild(buildRefinementBlock(item));

    if (pushUrl) history.pushState({ view: 'item', id }, '', `accessible.html?item=${encodeURIComponent(id)}`);
    document.title = `${item.title || 'Archive item'} | Downtown Pompey`;
}

function showNotFound(id) {
    searchView.hidden = true;
    detailView.hidden = false;
    backLink.href = lastSearchUrl;
    detailContent.innerHTML = `
        <div class="acc-detail-info">
            <h1 class="acc-detail-title">Item not found</h1>
            <p class="acc-detail-desc">"${esc(id)}" doesn't match anything currently in the archive — it may have been retitled, or the link may be out of date.</p>
        </div>
    `;
}

// ===== SHARING =====
function buildShareBlock(item) {
    const wrap = document.createElement('div');
    wrap.className = 'acc-share';
    const url = `${location.origin}${location.pathname}?item=${encodeURIComponent(item.id)}`;
    const shareText = `"${item.title || 'This item'}" from the Downtown Pompey archive`;

    const heading = document.createElement('h2');
    heading.className = 'acc-share-heading';
    heading.textContent = 'Share this item';
    wrap.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'acc-share-row';

    if (navigator.share) {
        const shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.className = 'acc-btn';
        shareBtn.textContent = 'Share…';
        shareBtn.addEventListener('click', () => {
            navigator.share({ title: shareText, url }).catch(() => {}); // AbortError on cancel — nothing to report
        });
        row.appendChild(shareBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'acc-btn';
    copyBtn.textContent = 'Copy link';
    copyBtn.addEventListener('click', async () => {
        try {
            if (navigator.clipboard) await navigator.clipboard.writeText(url);
            else {
                // Fallback for non-secure contexts / older browsers.
                const ta = document.createElement('textarea');
                ta.value = url;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            copyBtn.textContent = 'Link copied';
            setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
        } catch {
            copyBtn.textContent = 'Could not copy — select the link manually';
        }
    });
    row.appendChild(copyBtn);

    const emailLink = document.createElement('a');
    emailLink.className = 'acc-btn';
    emailLink.href = `mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(url)}`;
    emailLink.textContent = 'Email to a friend';
    row.appendChild(emailLink);

    wrap.appendChild(row);

    const urlField = document.createElement('input');
    urlField.type = 'text';
    urlField.className = 'acc-share-url';
    urlField.readOnly = true;
    urlField.value = url;
    urlField.setAttribute('aria-label', 'Link to this item');
    urlField.addEventListener('focus', () => urlField.select());
    wrap.appendChild(urlField);

    return wrap;
}

// ===== "IS THIS YOURS?" / "NOT THIS ONE" / "SHOW MORE LIKE THIS" =====
// Local-only, per the brief — nothing here is sent anywhere or persisted
// past this browser session; refreshing clears it.
function buildRefinementBlock(item) {
    const wrap = document.createElement('div');
    wrap.className = 'acc-refine';

    const isYours = document.createElement('button');
    isYours.type = 'button';
    isYours.className = 'acc-btn';
    isYours.textContent = 'Is this yours?';
    const confirmMsg = document.createElement('p');
    confirmMsg.className = 'acc-refine-msg';
    confirmMsg.hidden = true;
    confirmMsg.setAttribute('role', 'status');
    isYours.addEventListener('click', () => {
        confirmMsg.textContent = 'Glad you found it! (This isn’t recorded anywhere — it’s just for you.)';
        confirmMsg.hidden = false;
        isYours.disabled = true;
    });

    const notThis = document.createElement('button');
    notThis.type = 'button';
    notThis.className = 'acc-btn';
    notThis.textContent = 'Not this one';
    notThis.addEventListener('click', () => {
        dismissed.add(item.id);
        history.pushState({ view: 'search' }, '', lastSearchUrl);
        searchView.hidden = false;
        detailView.hidden = true;
        runSearch(false);
    });

    const moreLike = document.createElement('button');
    moreLike.type = 'button';
    moreLike.className = 'acc-btn';
    moreLike.textContent = 'Show more like this';
    moreLike.addEventListener('click', () => {
        input.value = likeQueryFor(item);
        searchView.hidden = false;
        detailView.hidden = true;
        runSearch();
        input.focus();
    });

    const row = document.createElement('div');
    row.className = 'acc-share-row';
    row.append(isYours, notThis, moreLike);
    wrap.append(row, confirmMsg);
    return wrap;
}

// ===== ROUTING =====
function route(pushUrl = false) {
    const params = new URLSearchParams(location.search);
    const itemId = params.get('item');
    if (itemId) {
        showItem(itemId, pushUrl);
    } else {
        searchView.hidden = false;
        detailView.hidden = true;
        document.title = 'Accessible | Alternative Archiving';
        restoreSearchStateFromUrl();
        runSearch(false);
    }
}

window.addEventListener('popstate', () => route(false));

// ===== INIT =====
async function init() {
    try {
        allItems = await loadArchive();
        allItems.forEach(item => { if (item.id) itemsById.set(item.id, item); });
        searchIndex = buildSearchIndex(allItems);
        buildFilterChips();
        route(false);
    } catch (err) {
        console.warn('Accessible archive load failed:', err.message);
        statusEl.textContent = 'Could not reach the archive — try refreshing.';
    }
}

init();
