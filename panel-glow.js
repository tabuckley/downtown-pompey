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
    // Vertical from the title up to the target's height, then
    // horizontal into the target — reads as a flagpole reaching over to
    // the object rather than a diagonal line cutting across the scene.
    return `M ${sx} ${sy} L ${sx} ${ty} L ${tx} ${ty}`;
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
        const title = panel.querySelector('.badge-title') || panel;
        return { panel, glow, line, title, fx, fy, active: false };
    });

    function redraw(rig) {
        if (!rig.active || !rig.line) return;
        const titleRect = rig.title.getBoundingClientRect();
        const sx = Math.round(titleRect.left + titleRect.width / 2);
        const sy = Math.round(titleRect.top);
        const target = targetToScreen(video, rig.fx, rig.fy);
        rig.line.setAttribute('d', buildElbowPath(sx, sy, Math.round(target.x), Math.round(target.y)));
    }

    function setActive(rig, on) {
        rig.active = on;
        if (rig.glow) rig.glow.classList.toggle('is-active', on);
        if (rig.line) rig.line.classList.toggle('is-active', on);
        if (on) redraw(rig);
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
