// Generic pannable, infinitely-wrapping tile canvas. Knows nothing about
// tags, sheets, or lightboxes — the caller supplies renderTile()/onActivate()
// and gets back setItems(). Mirrors the three-scene.js/editorial.js split:
// this is the engine, the page wires up what the tiles mean.

// A wider spread of shapes — strong portrait through to wide landscape —
// rather than the previous narrow cluster around square, so the grid reads
// more like a mixed photo album than a uniform tile wall.
const RATIOS = [0.5, 0.65, 0.8, 1, 1, 1.25, 1.5, 1.78, 2.0];
const GAP = 26;
const ROW_STAGGER = 0.5; // alternate rows shift sideways by this fraction of a cell, brick-lay style
const JITTER_FRAC = 0.24; // per-tile position jitter, as a fraction of its own (smaller) dimension
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

// Deterministic per-slot nudge, decorrelated from ratioForSlot's hash (different
// multipliers) so shape and position don't co-vary in an obviously patterned way.
// Fixed per (row,col) rather than per wrap-copy — like ratioForSlot, the same
// slot always gets the same nudge, it's just showing different content each page.
function jitterForSlot(row, col) {
    const jx = (hash(row * 12983 + col * 50261) % 1000) / 1000 - 0.5;
    const jy = (hash(row * 77111 + col * 20441) % 1000) / 1000 - 0.5;
    return { jx, jy };
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

    // 20% smaller than the original 150/190/260 at each breakpoint.
    function computeUnitW() {
        const w = window.innerWidth;
        if (w <= 480) return 120;
        if (w <= 768) return 152;
        return 208;
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
    // A tile's OWN visual footprint, from its own slot's aspect ratio —
    // distinct from rowH[row]/colX below, which are the row/column's
    // *reserved* space (the largest any slot in that row/column needs),
    // used purely to position the next row/column without overlap.
    // Rendering every tile at a shared cell size was why ratio variety only
    // ever showed up between rows, never between neighbouring tiles — and
    // why the layout read as a rigid grid. Both dimensions are derived from
    // the ratio around a roughly constant area, so a portrait slot is
    // narrower AND taller (not just taller), a landscape slot wider AND
    // shorter — genuine footprint variety, not just a crop.
    function ownSizeForSlot(row, col) {
        const ratio = ratioForSlot(row, col, cols);
        const area = unitW * unitW;
        const w = Math.max(unitW * 0.55, Math.min(unitW, Math.sqrt(area * ratio)));
        const h = Math.max(unitW * 0.5, Math.min(unitW * 1.9, Math.sqrt(area / ratio)));
        return { w, h };
    }

    function rebuildLayout() {
        unitW = computeUnitW();
        cols = Math.max(3, Math.min(6, Math.round(window.innerWidth / (unitW + GAP))));
        rows = Math.max(3, Math.ceil(window.innerHeight / (unitW + GAP)) + 2);
        // Kept even so the alternating row-stagger lines up with itself across
        // the vertical wrap seam (row `rows` continuing into the next copy's
        // row 0 needs the same parity, or the stagger pattern visibly flips).
        if (rows % 2 !== 0) rows += 1;

        colX = new Array(cols).fill(0);
        for (let c = 1; c < cols; c++) colX[c] = colX[c - 1] + unitW + GAP;

        rowH = new Array(rows).fill(unitW);
        for (let r = 0; r < rows; r++) {
            let tallest = unitW;
            for (let c = 0; c < cols; c++) {
                const h = ownSizeForSlot(r, c).h;
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

        // targetPanX/renderPanX are never wrapped — a pitch change here needs
        // no special handling, kx/ky ranges are simply recomputed fresh
        // against whatever pitch is current wherever they're used.
    }

    // Size is the tile's own, which is usually smaller than its row/column's
    // reserved space — that leftover slack is what makes the scattered look
    // possible. Position centers the tile in that slack (rather than
    // top/left-aligning it, which would just redraw the same grid lines with
    // smaller boxes) then: (a) shifts alternate rows sideways by half a cell,
    // brick-lay style, so columns don't line up top-to-bottom, and (b) nudges
    // every slot by a small fixed jitter so neighbours don't even share a
    // row/column baseline. Jitter is capped relative to GAP, not to the
    // slack, so it can never push a tile far enough to overlap its neighbour
    // regardless of how little slack that particular slot has.
    function slotRect(row, col) {
        const { w, h } = ownSizeForSlot(row, col);
        const { jx, jy } = jitterForSlot(row, col);
        const stagger = (row % 2 === 1) ? (unitW + GAP) * ROW_STAGGER : 0;
        const jitterAmp = Math.min(GAP * 0.8, Math.min(w, h) * JITTER_FRAC);
        const x = colX[col] + stagger + (unitW - w) / 2 + jx * jitterAmp;
        const y = rowY[row] + (rowH[row] - h) / 2 + jy * jitterAmp;
        return { x, y, w, h };
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

        // Deliberately NOT wrapped. The (kx,ky) "which repeat of the pattern"
        // index already provides the infinite tiling on its own — kx/ky are
        // just integers that grow arbitrarily large in either direction as
        // you pan further, exactly mirroring renderPanX/Y's own unbounded
        // growth. Wrapping renderPanX here as well would make kx/ky jump
        // discontinuously every time it crossed a pitch boundary — the same
        // on-screen tile would suddenly be reclassified under a different
        // (kx,ky), get a new pool key, and get unmounted+remounted (visible
        // as a flicker/fade right at the boundary) for no visual reason.
        const kxMin = Math.floor((-renderPanX - bufX) / pitchX);
        const kxMax = Math.ceil((-renderPanX + vw + bufX) / pitchX);
        const kyMin = Math.floor((-renderPanY - bufY) / pitchY);
        const kyMax = Math.ceil((-renderPanY + vh + bufY) / pitchY);

        const wanted = new Set();

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const rect = slotRect(row, col);
                for (let ky = kyMin; ky <= kyMax; ky++) {
                    const baseY = rect.y + ky * pitchY + renderPanY;
                    if (baseY + rect.h < -bufY || baseY > vh + bufY) continue;
                    for (let kx = kxMin; kx <= kxMax; kx++) {
                        const baseX = rect.x + kx * pitchX + renderPanX;
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
        // Raw renderPanX/Y, same as recull() — see the comment there.
        pool.forEach(tile => {
            const rect = slotRect(tile.row, tile.col);
            const x = rect.x + tile.kx * pitchX + renderPanX;
            const y = rect.y + tile.ky * pitchY + renderPanY;
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

        // targetPanX/Y and renderPanX/Y are deliberately never wrapped at
        // all — not in place, and not even locally where consumed. Dragging
        // computes targetPanX = startPanX + dx fresh from a fixed reference
        // point captured at pointerdown, so wrapping the state mid-drag
        // would desync from that reference and snap (see the drag-jolt fix
        // above this one). And recull()/positionTiles() need the pan value
        // to stay perfectly continuous too — the (kx,ky) "which repeat of
        // the pattern" index is what provides the infinite tiling; wrapping
        // the pan value as well would make kx/ky jump discontinuously at
        // every pitch boundary, causing on-screen tiles to be reclassified
        // under a new pool key and spuriously unmount+remount (a visible
        // flicker) for no visual reason.

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
            // recull()'s pool diffing only reacts to GEOMETRIC visibility
            // changes (same row:col:kx:ky key = same pool slot, left alone).
            // A filter/search change doesn't move the pan position, so the
            // same keys stay "wanted" — but cellItemIndex() now maps those
            // keys to different items (tilePages/cellsPerTile just changed).
            // Without a full teardown, every currently-mounted tile would
            // keep showing whatever item it had before the filter changed.
            pool.forEach(tile => {
                const video = tile.el.querySelector('video');
                if (video) {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                }
                tile.el.remove();
            });
            pool.clear();
            recull();
        },
    };
}
