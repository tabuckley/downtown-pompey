// Generic pannable, infinitely-wrapping tile canvas. Knows nothing about
// tags, sheets, or lightboxes — the caller supplies renderTile()/onActivate()
// and gets back setItems(). Mirrors the three-scene.js/editorial.js split:
// this is the engine, the page wires up what the tiles mean.

const RATIOS = [0.75, 1, 1, 1.3, 1.6];
const GAP = 14;
const POOL_BUFFER = 1.6; // how many extra tile-widths beyond the viewport to keep mounted
const DAMPING = 0.96;
const LERP = 0.13;
const DRAG_THRESHOLD = 6;
const MIN_VELOCITY = 0.02;
const IDLE_VX = -0.06, IDLE_VY = -0.03;
const IDLE_EASE = 0.002;
const IDLE_RESUME_MS = 2000; // hold off ambient drift until the pointer has been away/still this long
const RECULL_THRESHOLD = 0.4; // fraction of a tile's width before re-checking the visible set
const SAMPLE_WINDOW = 120; // ms of pointer history kept for release-velocity calc

function hash(n) {
    let h = (n ^ 0x9e3779b9) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = h ^ (h >>> 16);
    return Math.abs(h);
}

// Aspect ratio is a property of the grid SLOT (row/col), not of whichever
// item happens to be showing there — different wrap-copies show different
// items in the same slot (see cellItemIndex), so shape has to be geometry-
// driven and content just crops to fit via object-fit: cover, exactly like
// a real photo would.
function ratioForSlot(row, col, cols) {
    return RATIOS[hash(row * 92821 + col * 43711 + cols) % RATIOS.length];
}

function mod(n, m) {
    return ((n % m) + m) % m;
}

export function initPanCanvas(container, { renderTile, onActivate, reduceMotion }) {
    let items = [];
    let cols = 4, unitW = 260;
    let colX = [], rowY = [], rowH = [];
    let pitchX = 0, pitchY = 0;
    let rows = 0;

    let targetPanX = 0, targetPanY = 0;
    let renderPanX = 0, renderPanY = 0;
    let velX = 0, velY = 0;
    let isDragging = false, dragPointerId = null, dragMoved = false;
    let ancX = 0, ancY = 0, startPanX = 0, startPanY = 0;
    const samples = [];
    let lastFrame = performance.now();
    let panSinceCull = Infinity; // force a cull on first frame
    let lastCullX = 0, lastCullY = 0;
    // Ambient drift only resumes after the pointer has been away/still for a
    // while — otherwise a target a user is aiming at could drift out from
    // under their cursor mid-click, which is both a real usability problem
    // and (not coincidentally) exactly what automated "is this element
    // stable" click checks catch too.
    let lastActivity = performance.now();

    // pool: Map<cellKey, { el, inner, itemIndex, kx, ky }>
    const pool = new Map();

    container.classList.add('pan-canvas');
    container.setAttribute('aria-hidden', 'true');

    function computeUnitW() {
        const w = window.innerWidth;
        if (w <= 480) return 150;
        if (w <= 768) return 190;
        return 260;
    }

    let cellsPerTile = 1, tilePages = 1;

    // One repeating "pitch" block is sized to comfortably exceed a single
    // viewport — NOT to hold every item in the (potentially much larger)
    // archive. That would make the pitch enormous for a few hundred items
    // (rows = items/cols), pushing most tiles far outside any viewport ever
    // shown. Instead: the grid shape (rows/cols/pitch) depends only on
    // viewport size, and different wrap-copies (kx,ky) cycle through
    // different "pages" of the item list via cellItemIndex(), so panning
    // further keeps surfacing more of the archive instead of looping the
    // same handful of items forever.
    function rebuildLayout() {
        unitW = computeUnitW();
        cols = Math.max(3, Math.min(6, Math.round(window.innerWidth / (unitW + GAP))));
        rows = Math.max(3, Math.ceil(window.innerHeight / (unitW + GAP)) + 2);

        colX = new Array(cols).fill(0);
        for (let c = 1; c < cols; c++) colX[c] = colX[c - 1] + unitW + GAP;

        rowH = new Array(rows).fill(unitW);
        for (let r = 0; r < rows; r++) {
            let tallest = unitW;
            for (let c = 0; c < cols; c++) {
                const ratio = ratioForSlot(r, c, cols);
                const h = Math.max(unitW * 0.55, Math.min(unitW * 1.7, unitW / ratio));
                if (h > tallest) tallest = h;
            }
            rowH[r] = tallest;
        }

        rowY = new Array(rows).fill(0);
        for (let r = 1; r < rows; r++) rowY[r] = rowY[r - 1] + rowH[r - 1] + GAP;

        pitchX = cols * (unitW + GAP);
        pitchY = rowY[rows - 1] + rowH[rows - 1] + GAP;

        cellsPerTile = rows * cols;
        tilePages = items.length ? Math.max(1, Math.ceil(items.length / cellsPerTile)) : 1;

        // targetPanX/renderPanX are never wrapped in place (see tick()) — a
        // pitch change here needs no special handling, mod(renderPanX, pitchX)
        // is simply computed fresh against whatever pitch is current wherever
        // it's actually used.
    }

    function slotRect(row, col) {
        return { x: colX[col], y: rowY[row], w: unitW, h: rowH[row] };
    }

    // Which item shows in a given grid slot, for a given wrap-copy. Each
    // (kx,ky) copy is assigned a "page" (a contiguous, non-repeating chunk
    // of the item list sized to one screenful) via a hash of its wrap
    // coordinates, so exploring in any direction surfaces different items
    // instead of re-showing the same page everywhere.
    function cellItemIndex(row, col, kx, ky) {
        if (!items.length) return -1;
        const slot = row * cols + col;
        const page = mod(hash(kx * 92821 + ky * 43711), tilePages);
        return (page * cellsPerTile + slot) % items.length;
    }

    // Tap detection deliberately does NOT rely on a native 'click' listener
    // per tile. container.setPointerCapture() (needed so a fast drag never
    // loses tracking if the cursor slips off the container) redirects the
    // resulting click event's target to the capturing element itself, so it
    // never bubbles up from whatever tile was actually under the pointer —
    // confirmed by tracing the actual event sequence in a headless browser.
    // Instead, item + index are stashed directly on the element and looked
    // up via elementFromPoint from the pointerup handler below, which always
    // has the real release coordinates regardless of capture redirection.
    function makeTile(row, col, kx, ky) {
        const itemIndex = cellItemIndex(row, col, kx, ky);
        if (itemIndex < 0) return null;
        const item = items[itemIndex];
        const el = document.createElement('div');
        el.className = 'pan-tile';
        el.__panItem = item;
        el.__panItemIndex = itemIndex;

        const inner = document.createElement('div');
        inner.className = 'pan-tile-inner';
        inner.appendChild(renderTile(item));
        el.appendChild(inner);

        container.appendChild(el);
        requestAnimationFrame(() => inner.classList.add('tile-in'));

        return { el, inner, row, col, kx, ky };
    }

    function recull() {
        panSinceCull = 0;
        if (!items.length || pitchX <= 0 || pitchY <= 0) {
            pool.forEach(t => t.el.remove());
            pool.clear();
            return;
        }

        const vw = window.innerWidth, vh = window.innerHeight;
        const bufX = unitW * POOL_BUFFER;
        const bufY = unitW * POOL_BUFFER;

        // renderPanX/Y are unbounded accumulators (see tick()) — wrap into
        // [0,pitch) here, locally, for this computation only.
        const panX = mod(renderPanX, pitchX);
        const panY = mod(renderPanY, pitchY);

        const kxMin = Math.floor((-panX - bufX) / pitchX);
        const kxMax = Math.ceil((-panX + vw + bufX) / pitchX);
        const kyMin = Math.floor((-panY - bufY) / pitchY);
        const kyMax = Math.ceil((-panY + vh + bufY) / pitchY);

        const wanted = new Set();

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const rect = slotRect(row, col);
                for (let ky = kyMin; ky <= kyMax; ky++) {
                    const baseY = rect.y + ky * pitchY + panY;
                    if (baseY + rect.h < -bufY || baseY > vh + bufY) continue;
                    for (let kx = kxMin; kx <= kxMax; kx++) {
                        const baseX = rect.x + kx * pitchX + panX;
                        if (baseX + rect.w < -bufX || baseX > vw + bufX) continue;
                        wanted.add(`${row}:${col}:${kx}:${ky}`);
                    }
                }
            }
        }

        // Unmount stale — explicitly release video decoders (mobile Safari has
        // a hard concurrent-decoder limit; leaving a stale src silently
        // breaks later videos).
        pool.forEach((tile, key) => {
            if (!wanted.has(key)) {
                const video = tile.el.querySelector('video');
                if (video) {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                }
                tile.el.remove();
                pool.delete(key);
            }
        });

        // Mount new
        wanted.forEach(key => {
            if (pool.has(key)) return;
            const [row, col, kx, ky] = key.split(':').map(Number);
            const tile = makeTile(row, col, kx, ky);
            if (tile) pool.set(key, tile);
        });
    }

    function positionTiles() {
        // Same local wrap as recull() — must stay in sync with it, since a
        // pool entry's (kx,ky) only make sense relative to the same wrapped
        // reference recull() used when it decided this cell was visible.
        const panX = mod(renderPanX, pitchX);
        const panY = mod(renderPanY, pitchY);
        pool.forEach(tile => {
            const rect = slotRect(tile.row, tile.col);
            const x = rect.x + tile.kx * pitchX + panX;
            const y = rect.y + tile.ky * pitchY + panY;
            tile.el.style.width = rect.w + 'px';
            tile.el.style.height = rect.h + 'px';
            tile.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        });
    }

    // ===== Physics loop =====
    function tick(now) {
        let dt = now - lastFrame;
        lastFrame = now;
        dt = Math.max(0, Math.min(48, dt));
        const dtFactor = dt / 16.67;

        if (!isDragging) {
            if (!reduceMotion) {
                const speed = Math.hypot(velX, velY);
                const idleFor = now - lastActivity;
                if (speed > MIN_VELOCITY) {
                    velX *= Math.pow(DAMPING, dtFactor);
                    velY *= Math.pow(DAMPING, dtFactor);
                } else if (idleFor > IDLE_RESUME_MS) {
                    // Ease toward gentle idle drift, only once truly idle
                    velX += (IDLE_VX - velX) * IDLE_EASE * dtFactor;
                    velY += (IDLE_VY - velY) * IDLE_EASE * dtFactor;
                } else {
                    // Recent pointer activity — hold still so whatever the
                    // user is looking at / aiming for doesn't creep away.
                    velX = 0;
                    velY = 0;
                }
                targetPanX += velX * dt;
                targetPanY += velY * dt;
            } else {
                velX = 0;
                velY = 0;
            }
        }

        if (reduceMotion) {
            renderPanX = targetPanX;
            renderPanY = targetPanY;
        } else {
            const lerpFactor = 1 - Math.pow(1 - LERP, dtFactor);
            renderPanX += (targetPanX - renderPanX) * lerpFactor;
            renderPanY += (targetPanY - renderPanY) * lerpFactor;
        }

        // targetPanX/Y and renderPanX/Y are deliberately never wrapped in
        // place. Dragging computes targetPanX = startPanX + dx fresh from a
        // fixed reference point captured at pointerdown — if this wrapped
        // mid-drag, the very next pointermove would immediately undo the
        // wrap (since startPanX wasn't updated to match), producing a
        // visible snap right at the pitch boundary. Wrapping only happens
        // where the value is actually consumed (positionTiles, recull),
        // via a local mod() that never feeds back into this state.

        panSinceCull = Math.hypot(renderPanX - lastCullX, renderPanY - lastCullY);
        if (panSinceCull > unitW * RECULL_THRESHOLD) {
            lastCullX = renderPanX;
            lastCullY = renderPanY;
            recull();
        }

        positionTiles();
        requestAnimationFrame(tick);
    }

    // ===== Pointer / wheel =====
    function setPointerFromClient(x, y) {
        return { x, y, t: performance.now() };
    }

    container.addEventListener('pointerdown', (e) => {
        lastActivity = performance.now();
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        isDragging = true;
        dragMoved = false;
        dragPointerId = e.pointerId;
        container.setPointerCapture(e.pointerId);
        ancX = e.clientX;
        ancY = e.clientY;
        startPanX = targetPanX;
        startPanY = targetPanY;
        samples.length = 0;
        samples.push(setPointerFromClient(e.clientX, e.clientY));
        velX = 0;
        velY = 0;
        container.classList.add('is-dragging');
    });

    container.addEventListener('pointermove', (e) => {
        // Track regardless of drag state — mere hover (aiming a click) should
        // hold off ambient drift just as much as an active drag does.
        lastActivity = performance.now();
        if (!isDragging || e.pointerId !== dragPointerId) return;
        const dx = e.clientX - ancX;
        const dy = e.clientY - ancY;
        if (!dragMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragMoved = true;
        targetPanX = startPanX + dx;
        targetPanY = startPanY + dy;
        samples.push(setPointerFromClient(e.clientX, e.clientY));
        const cutoff = performance.now() - SAMPLE_WINDOW;
        while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
    });

    function endDrag(e) {
        if (!isDragging) return;
        isDragging = false;
        container.classList.remove('is-dragging');

        const wasTap = !dragMoved;

        if (!reduceMotion && samples.length >= 2) {
            const first = samples[0];
            const last = samples[samples.length - 1];
            const dt = last.t - first.t;
            if (dt > 5 && dt < SAMPLE_WINDOW + 20) {
                velX = Math.max(-3, Math.min(3, (last.x - first.x) / dt));
                velY = Math.max(-3, Math.min(3, (last.y - first.y) / dt));
            }
        }
        samples.length = 0;

        if (wasTap && e) {
            const hit = document.elementFromPoint(e.clientX, e.clientY);
            const tileEl = hit && hit.closest ? hit.closest('.pan-tile') : null;
            if (tileEl && tileEl.__panItem) {
                onActivate(tileEl.__panItem, tileEl.__panItemIndex, tileEl);
            }
        }
    }

    window.addEventListener('pointerup', (e) => {
        if (e.pointerId !== dragPointerId) return;
        endDrag(e);
    });
    window.addEventListener('pointercancel', (e) => {
        if (e.pointerId !== dragPointerId) return;
        isDragging = false;
        container.classList.remove('is-dragging');
        samples.length = 0;
    });

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        lastActivity = performance.now();
        targetPanX -= e.deltaX;
        targetPanY -= e.deltaY;
        velX = 0;
        velY = 0;
    }, { passive: false });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            rebuildLayout();
            recull();
        }, 150);
    });

    requestAnimationFrame(tick);

    return {
        setItems(newItems) {
            items = newItems;
            rebuildLayout();
            recull();
        },
    };
}
