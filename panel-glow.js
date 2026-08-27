// Homepage panel glow + elbow connector — test prototype.
//
// Each panel that wants an effect carries data-glow-target/-x/-y (the
// target point as a fraction of the *video's own frame*, not the
// viewport — see index.html). On hover/focus it activates the matching
// .object-glow (pure CSS/opacity, no JS math needed there — it shares
// .panels-bg's exact fixed/inset/object-fit treatment and intrinsic
// size, so it's already pixel-aligned) and draws an elbow line from the
// panel's title to that same point.
//
// The one thing that does need JS is translating a video-relative
// fraction into a screen position: object-fit:cover crops differently
// depending on how the viewport's aspect ratio compares to the video's,
// so "where the PC is on screen" moves as the window resizes even
// though "where the PC is in the video" never does.

const VIDEO_SELECTOR = '.panels-bg';
const PANEL_SELECTOR = '[data-glow-target]';

function coverOffset(intrinsicW, intrinsicH, boxW, boxH) {
    const scale = Math.max(boxW / intrinsicW, boxH / intrinsicH);
    const drawnW = intrinsicW * scale;
    const drawnH = intrinsicH * scale;
    return {
        x: (boxW - drawnW) / 2,
        y: (boxH - drawnH) / 2,
        scale,
    };
}

function targetToScreen(video, fx, fy) {
    const iw = video.videoWidth || 1924;
    const ih = video.videoHeight || 1076;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { x: offsetX, y: offsetY, scale } = coverOffset(iw, ih, vw, vh);
    return {
        x: offsetX + fx * iw * scale,
        y: offsetY + fy * ih * scale,
    };
}

function buildElbowPath(sx, sy, tx, ty) {
    // Vertical from the badge edge to the target's height, then
    // horizontal into the target — reads as a flagpole reaching over to
    // the object rather than a diagonal line cutting across the scene.
    return `M ${sx} ${sy} L ${sx} ${ty} L ${tx} ${ty}`;
}

// getBoundingClientRect() on a *rotated* element returns the axis-
// aligned box that contains the rotated shape, which is bigger than
// the shape itself (a square rotated by 8° needs a ~13% bigger AABB to
// contain it) — rect.width stops being the circle's true diameter the
// moment rotate() is in the mix. Collected/Credited both rotate on
// hover; Curated doesn't, which is why only that one badge's line
// lined up correctly before this fix. The centre is still trustworthy
// from the rect (rotating around an element's own centre can't move
// that centre), so only the radius needs a rotation-proof source:
// offsetWidth (the layout box, untouched by any CSS transform) times
// the transform matrix's own scale factor, sqrt(a²+b²) — that
// combination is invariant to whatever angle rotate() is currently at.
function getTransformScale(el) {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 1;
    const values = t.replace(/^matrix\(|\)$/g, '').split(',').map(Number);
    const [a, b] = values;
    return Math.sqrt(a * a + b * b);
}

function initPanelGlow() {
    const video = document.querySelector(VIDEO_SELECTOR);
    const panels = document.querySelectorAll(PANEL_SELECTOR);
    if (!video || !panels.length) return;

    const rigs = Array.from(panels).map((panel) => {
        const key = panel.dataset.glowTarget;
        const fx = parseFloat(panel.dataset.glowX);
        const fy = parseFloat(panel.dataset.glowY);
        const glow = document.querySelector(`.object-glow[data-glow="${key}"]`);
        const line = document.querySelector(`.connector-line[data-connector="${key}"]`);
        const dot = document.querySelector(`.connector-dot[data-connector="${key}"]`);
        return { panel, glow, line, dot, fx, fy, active: false };
    });

    function redraw(rig) {
        if (!rig.active || !rig.line) return;
        // Start from the badge's own circle edge, not its text — the
        // circle is a true circle (width === height), so its centre and
        // radius are enough to find where the vertical first leg should
        // actually leave the ring, rather than starting from inside it.
        // Centre comes from the live (post-transform) rect; radius comes
        // from the untransformed layout size × the transform's own scale
        // factor — see getTransformScale for why rect.width alone isn't
        // safe here once rotate() is involved.
        const rect = rig.panel.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const radius = (rig.panel.offsetWidth / 2) * getTransformScale(rig.panel);
        const target = targetToScreen(video, rig.fx, rig.fy);
        const goingDown = target.y >= cy;
        const sx = Math.round(cx);
        const sy = Math.round(cy + radius * (goingDown ? 1 : -1));
        const tx = Math.round(target.x);
        const ty = Math.round(target.y);
        rig.line.setAttribute('d', buildElbowPath(sx, sy, tx, ty));
        if (rig.dot) {
            rig.dot.setAttribute('cx', tx);
            rig.dot.setAttribute('cy', ty);
        }
    }

    // A single redraw on activation used to grab the badge's resting
    // bounding box before its hover :transform transition (scale +
    // rotate + lift, 0.35s) had actually finished animating — the line
    // would jump to roughly the right place immediately, then sit
    // slightly off from the ring's real (now bigger/shifted) edge once
    // the bounce settled. Tracking every frame for as long as anything
    // is active keeps it glued to the badge's true current position
    // throughout the whole hover-in/out animation instead of just its
    // start and end states.
    let rafId = null;
    function tick() {
        rigs.forEach(redraw);
        if (rigs.some((r) => r.active)) {
            rafId = requestAnimationFrame(tick);
        } else {
            rafId = null;
        }
    }
    function ensureTicking() {
        if (rafId === null) rafId = requestAnimationFrame(tick);
    }

    function setActive(rig, on) {
        rig.active = on;
        if (rig.glow) rig.glow.classList.toggle('is-active', on);
        if (rig.line) rig.line.classList.toggle('is-active', on);
        if (rig.dot) rig.dot.classList.toggle('is-active', on);
        if (on) {
            redraw(rig);
            ensureTicking();
        }
        // On deactivation the line/dot simply freeze at their last
        // drawn (hovered) position and fade out via their own opacity
        // transition (0.3s) rather than tracking the badge's hover-out
        // settle — short enough that a static line briefly fading
        // under it isn't noticeable, and simpler than extending the
        // tick loop past "is anything currently active".
    }

    rigs.forEach((rig) => {
        rig.panel.addEventListener('mouseenter', () => setActive(rig, true));
        rig.panel.addEventListener('mouseleave', () => setActive(rig, false));
        rig.panel.addEventListener('focus', () => setActive(rig, true));
        rig.panel.addEventListener('blur', () => setActive(rig, false));
    });

    window.addEventListener('resize', () => rigs.forEach(redraw));
}

initPanelGlow();
