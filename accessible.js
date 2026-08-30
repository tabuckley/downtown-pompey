// Accessible archive: plain-text search built for imperfect memory, real
// focusable results (no pan-canvas-style unfocusable tiles), and a stable
// per-item URL every result deep-links to. See search.js for the matching
// approach and its known limits (lexical + typo-tolerant, no semantic
// embeddings yet).
import { loadArchive } from './archive.js';
import { itemTags } from './tags.js';
import { buildSearchIndex, search } from './search.js';
import { yearFrom } from './sheet.js';

const TYPE_LABELS = { photo: 'Photo', video: 'Video', audio: 'Audio', '3d': '3D object', download: 'Document' };
// Small icon + accent per type, for results with no real thumbnail (audio,
// documents) — a plain grey box for every one of those made the list hard
// to scan, since visually nothing distinguished a "Photo" search result
// from an "Audio" one except a tiny caption.
const TYPE_ICONS = {
    photo: { glyph: '▣', bg: '#ffe1ee', color: '#d01359' },
    video: { glyph: '▶', bg: '#d6ecff', color: '#1c6fb0' },
    audio: { glyph: '♫', bg: '#ece0ff', color: '#6b3fbf' },
    '3d': { glyph: '◈', bg: '#d7f7e3', color: '#1a8f5c' },
    download: { glyph: '☷', bg: '#ffe3d1', color: '#c05a1f' },
};
const RESULTS_PAGE_SIZE = 20;

// Renamed from the old searchView/detailView pair — these two now swap
// places WITHIN the results panel (see accessible.html) so the search
// panel to its left never disappears, instead of the whole search view
// (search panel included) getting hidden in favour of a separate full-page
// detail view.
const resultsPane = document.getElementById('accResultsPane');
const detailPane = document.getElementById('accDetailPane');

// Results <-> detail used to be a hard hidden-attribute cut with no
// transition — the whole panel instantly teleported to new content. A full
// crossfade (both panes overlapping) would need position:absolute on both,
// which drops them out of normal flow and collapses .acc-results-panel's
// height (this page scrolls to fit variable content, it isn't a fixed-
// height app shell) — so this only animates the pane being revealed, via
// the same class + forced-reflow replay pattern as .flo-pop/.tile-in
// elsewhere on the site.
function revealPane(el) {
    el.hidden = false;
    el.classList.remove('acc-pane-enter');
    void el.offsetWidth;
    el.classList.add('acc-pane-enter');
}

const form = document.getElementById('accSearchForm');
const input = document.getElementById('accSearchInput');
const typeFiltersEl = document.getElementById('accTypeFilters');
const projectFiltersEl = document.getElementById('accProjectFilters');
const statusEl = document.getElementById('accStatus');
const resultsEl = document.getElementById('accResults');
const backLink = document.getElementById('accBackLink');
const detailContent = document.getElementById('accDetailContent');

// Display options (text size / high contrast / dark mode) live in Flo's
// speech bubble on this page now — see helper.js. It sets the same
// data-text-size/data-contrast/data-theme attributes on <body> that
// styles.css keys off, so nothing here needs to know about them.

let allItems = [];
let searchIndex = [];
let itemsById = new Map();
const activeTypes = new Set();
const activeProjects = new Set();
let lastSearchUrl = 'accessible.html';
// Reset to one page's worth on every new search/filter change (see
// runSearch) — otherwise "show more" state from a previous, longer result
// set would carry over and dump everything from a new one at once.
let visibleCount = RESULTS_PAGE_SIZE;

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ===== FILTER UI =====
// Shared by both chip rows below — type and project filters behave
// identically (toggle membership in a Set, re-run search), so one function
// builds either given the values to show and the Set backing it.
function buildChipGroup(container, values, activeSet, labelFor = (v) => v) {
    values.forEach(value => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'acc-chip';
        btn.textContent = labelFor(value);
        btn.dataset.value = value;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
            if (activeSet.has(value)) activeSet.delete(value); else activeSet.add(value);
            btn.classList.toggle('active', activeSet.has(value));
            btn.setAttribute('aria-pressed', String(activeSet.has(value)));
            runSearch();
        });
        container.appendChild(btn);
    });
}

function buildFilterChips() {
    const typesPresent = [...new Set(allItems.map(i => i.type).filter(Boolean))].sort();
    buildChipGroup(typeFiltersEl, typesPresent, activeTypes, (type) => TYPE_LABELS[type] || type);

    // Every project gets a chip so its full contents are always one click
    // away, even for items whose title/tags/description are too sparse for
    // lexical search to ever surface them (many of the archival newspaper
    // clippings have empty tags — the project name is the only reliable
    // handle on those).
    const projectsPresent = [...new Set(allItems.map(i => i.project).filter(Boolean))].sort();
    buildChipGroup(projectFiltersEl, projectsPresent, activeProjects);
}

// ===== SEARCH + RENDER =====
function applyFilters(items) {
    return items.filter(item => {
        if (activeTypes.size && !activeTypes.has(item.type)) return false;
        if (activeProjects.size && !activeProjects.has(item.project)) return false;
        return true;
    });
}

let lastResults = [];
let lastQuery = '';

function runSearch(pushUrl = true) {
    const query = input.value.trim();
    // A type or project filter counts as deliberate search intent too, same
    // as typing something — but with none of the three, the results panel
    // should stay empty rather than dumping the 20 most recent items with
    // nothing actually searched for.
    const hasFilter = activeTypes.size > 0 || activeProjects.size > 0;
    let results;
    if (query || hasFilter) {
        if (query) {
            // No maxResults cap here — "Show N more" (see renderResults)
            // already paginates the display, so capping the underlying
            // result set too just silently drops real matches once a
            // project's items pass 60 (Drag Files alone has 91).
            results = search(searchIndex, query, { maxResults: allItems.length }).map(r => ({ item: r.item, reason: r.reason }));
            results = results.filter(r => applyFilters([r.item]).length);
        } else {
            // Same reasoning: type/project browsing with no text query
            // should surface every matching item (a project can run to 190+
            // photos), not just the 60 most recent.
            results = applyFilters(allItems)
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .map(item => ({ item, reason: '' }));
        }
    } else {
        results = null; // distinct from [] — "nothing searched yet" vs "searched, found nothing"
    }

    visibleCount = RESULTS_PAGE_SIZE; // a new search/filter always starts back at one page
    renderResults(results, query);
    if (pushUrl) updateSearchUrl(query);
    lastSearchUrl = location.pathname.split('/').pop() + location.search;
}

function renderResults(results, query) {
    lastResults = results || [];
    lastQuery = query;
    resultsEl.innerHTML = '';

    if (!allItems.length) {
        statusEl.textContent = 'Could not reach the archive — try refreshing.';
        return;
    }
    if (results === null) {
        const li = document.createElement('li');
        li.className = 'acc-empty-state';
        li.textContent = 'Results will appear here once you search or filter.';
        resultsEl.appendChild(li);
        return;
    }
    if (!results.length) {
        statusEl.textContent = query
            ? `No matches for "${query}". Try fewer or different words, or clear a filter.`
            : 'Nothing matches the current filters.';
        return;
    }

    const visible = results.slice(0, visibleCount);
    statusEl.textContent = `Showing ${visible.length} of ${results.length} item${results.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}.`;

    visible.forEach(({ item, reason }) => {
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

        // item.url is only ever safe as an <img src> for photo items — for
        // video/3d/audio/download it's a non-image file (.mp4, .glb, etc.),
        // and falling back to it for a missing thumbnail just renders a
        // permanently-broken image instead of the type-icon fallback below.
        // (A video item with no thumbnail recorded was doing exactly this.)
        // Documents specifically never use item.thumbnail here even when
        // it's set — the sheet's "thumbnail" for a download row is the
        // document file itself, not a real image, so treating it as one
        // showed a permanently-broken image instead of the ☷ type icon.
        const thumbSrc = item.type === 'download' ? '' : (item.thumbnail || (item.type === 'photo' ? item.url : ''));
        if (thumbSrc) {
            const img = document.createElement('img');
            img.className = 'acc-result-thumb';
            img.src = thumbSrc;
            img.alt = '';
            img.loading = 'lazy';
            link.appendChild(img);
        } else {
            // Distinct icon + colour per type instead of a flat grey box —
            // otherwise every non-photo result (audio, documents) looked
            // identical in the list bar its caption.
            const icon = TYPE_ICONS[item.type] || { glyph: '?', bg: '#eee', color: 'var(--muted)' };
            const ph = document.createElement('div');
            ph.className = 'acc-result-thumb acc-result-thumb--none';
            ph.style.background = icon.bg;
            ph.style.color = icon.color;
            ph.innerHTML = `<span class="acc-result-thumb-glyph" aria-hidden="true">${icon.glyph}</span>${esc(TYPE_LABELS[item.type] || item.type || '')}`;
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

    if (results.length > visible.length) {
        const moreLi = document.createElement('li');
        moreLi.className = 'acc-show-more-wrap';
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'acc-btn acc-show-more';
        const remaining = results.length - visible.length;
        moreBtn.textContent = `Show ${Math.min(remaining, RESULTS_PAGE_SIZE)} more`;
        moreBtn.addEventListener('click', () => {
            visibleCount += RESULTS_PAGE_SIZE;
            renderResults(lastResults, lastQuery);
            // renderResults rebuilds the whole list (innerHTML = ''), so
            // the moreBtn this closure captured is already detached by the
            // time this runs — re-query the fresh one (still present if
            // there's yet another page left) rather than focus() on a
            // stale, removed element.
            resultsEl.querySelector('.acc-show-more')?.focus();
        });
        moreLi.appendChild(moreBtn);
        resultsEl.appendChild(moreLi);
    }
}

function updateSearchUrl(query) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (activeTypes.size) params.set('type', [...activeTypes].join(','));
    if (activeProjects.size) params.set('project', [...activeProjects].join(','));
    const url = 'accessible.html' + (params.toString() ? `?${params}` : '');
    history.pushState({ view: 'search' }, '', url);
}

function restoreSearchStateFromUrl() {
    const params = new URLSearchParams(location.search);
    input.value = params.get('q') || '';
    (params.get('type') || '').split(',').filter(Boolean).forEach(t => activeTypes.add(t));
    (params.get('project') || '').split(',').filter(Boolean).forEach(p => activeProjects.add(p));

    [...typeFiltersEl.children].forEach(btn => {
        const active = activeTypes.has(btn.dataset.value);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
    [...projectFiltersEl.children].forEach(btn => {
        const active = activeProjects.has(btn.dataset.value);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
});

// In-place, not a real navigation — the results list is still sitting in
// the DOM under detailPane (just hidden), so there's nothing to re-render,
// only to reveal again. Keeps history/back-button working right via
// pushState, without a full page reload resetting scroll and re-fetching
// the whole archive for what's just a "go back" click.
backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({ view: 'search' }, '', lastSearchUrl);
    revealPane(resultsPane);
    detailPane.hidden = true;
    document.title = 'Credited | Alternative Archiving';
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
    // Photos prefer the thumbnail too now (~800px, not the multi-megabyte
    // original) — it was taking several seconds to appear otherwise, for a
    // page whose whole point is being fast and easy to use. Falls back to
    // the full original for any item with no thumbnail recorded, and links
    // to the original either way for anyone who wants the full resolution.
    const useThumb = item.thumbnail && item.type !== '3d';
    const img = document.createElement('img');
    img.src = useThumb ? item.thumbnail : (item.type === '3d' ? (item.thumbnail || item.url) : item.url);
    img.alt = item.title || 'Archive item';
    img.className = 'acc-detail-media';
    if (!useThumb || item.type === '3d') return img;

    const wrap = document.createElement('div');
    wrap.className = 'acc-detail-photo-wrap';
    wrap.appendChild(img);
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'acc-open-link';
    link.textContent = 'View full size ↗';
    wrap.appendChild(link);
    return wrap;
}

function showItem(id, pushUrl = true) {
    const item = itemsById.get(id);
    if (!item) {
        showNotFound(id);
        return;
    }

    resultsPane.hidden = true;
    revealPane(detailPane);
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
        ${item.type === '3d' ? '<p class="acc-detail-desc">3D object — see it in the Curated room for the interactive version.</p>' : ''}
        <div class="acc-tag-row">${tags.map(t => `<span class="acc-tag-pill">${esc(t)}</span>`).join('')}</div>
    `;
    detailContent.appendChild(info);
    detailContent.appendChild(buildCreditRequestBlock(item));

    if (pushUrl) history.pushState({ view: 'item', id }, '', `accessible.html?item=${encodeURIComponent(id)}`);
    document.title = `${item.title || 'Archive item'} | Downtown Pompey`;
}

function showNotFound(id) {
    resultsPane.hidden = true;
    revealPane(detailPane);
    backLink.href = lastSearchUrl;
    detailContent.innerHTML = `
        <div class="acc-detail-info">
            <h1 class="acc-detail-title">Item not found</h1>
            <p class="acc-detail-desc">"${esc(id)}" doesn't match anything currently in the archive — it may have been retitled, or the link may be out of date.</p>
        </div>
    `;
}

// ===== "ASK TO BE CREDITED" =====
// No backend on this site (static files only) — submits via Web3Forms
// (web3forms.com), a free form-relay for static sites: POST straight to
// their API with the access key below and the request lands as an email,
// with no page navigation and no mail app involved. Get a key by entering
// an email at web3forms.com (no account/password needed) and paste it in
// below in place of the placeholder.
const WEB3FORMS_ACCESS_KEY = 'fe833ea5-c80a-468d-828b-7781e93d4bf4';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';
const CREDIT_REQUEST_EMAIL = 'Thomas@Thomas-Buckley.com';

// Two steps sharing ONE input box rather than two fields stacked (name,
// then connection) — asking the name, then swapping the same box's
// placeholder/purpose to ask the connection once that's answered, so the
// whole thing stays a single compact line instead of growing the page
// every time a new question appeared underneath the last one.
function buildCreditRequestBlock(item) {
    const wrap = document.createElement('div');
    wrap.className = 'acc-credit';

    const label = document.createElement('label');
    label.className = 'acc-credit-label';
    label.htmlFor = 'accCreditField';
    label.textContent = 'Are you in this, or did you make it? Ask to be credited:';
    wrap.appendChild(label);

    const form = document.createElement('form');
    form.className = 'acc-credit-line';

    const field = document.createElement('input');
    field.type = 'text';
    field.id = 'accCreditField';
    field.className = 'acc-search-input acc-credit-input';
    field.placeholder = 'Your name…';
    field.required = true;

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'acc-btn';
    submitBtn.textContent = 'Next';

    form.append(field, submitBtn);
    wrap.appendChild(form);

    const privacyNote = document.createElement('p');
    privacyNote.className = 'acc-credit-privacy-note';
    privacyNote.innerHTML = 'We only use this to credit you — see <a href="privacy.html">privacy</a>.';
    wrap.appendChild(privacyNote);

    let name = '';
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!name) {
            // Step 1 done — swap the same box over to the second question
            // rather than adding a new one below it.
            name = field.value.trim();
            field.value = '';
            field.placeholder = 'How are you connected? e.g. "I\'m on the left"';
            submitBtn.textContent = 'Send';
            field.focus();
            return;
        }
        const note = field.value.trim();
        const url = `${location.origin}${location.pathname}?item=${encodeURIComponent(item.id)}`;
        const subject = `Credit request — ${item.title || 'Untitled item'}`;

        field.disabled = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';

        try {
            const res = await fetch(WEB3FORMS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    access_key: WEB3FORMS_ACCESS_KEY,
                    subject,
                    from_name: name,
                    item: item.title || 'Untitled',
                    link: url,
                    connection: note,
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Send failed');
            label.textContent = 'Thanks — request sent. We\'ll be in touch.';
            form.remove();
        } catch {
            // Covers both a real network/API failure and the access key
            // still being the unfilled placeholder above — either way, a
            // mailto: fallback means the message is never just lost.
            const body = `Item: ${item.title || 'Untitled'}\nLink: ${url}\n\nName: ${name}\nConnection: ${note}`;
            const mailtoUrl = `mailto:${CREDIT_REQUEST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            label.innerHTML = `Couldn't send that automatically — <a href="${mailtoUrl}">email us directly instead</a>.`;
            submitBtn.disabled = false;
            field.disabled = false;
            submitBtn.textContent = 'Send';
        }
    });

    return wrap;
}

// ===== ROUTING =====
function route(pushUrl = false) {
    const params = new URLSearchParams(location.search);
    const itemId = params.get('item');
    if (itemId) {
        showItem(itemId, pushUrl);
    } else {
        revealPane(resultsPane);
        detailPane.hidden = true;
        document.title = 'Credited | Alternative Archiving';
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
