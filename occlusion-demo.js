// Proof-of-concept: a CSS line that "passes behind" the PC and the
// column in the homepage video. The camera is static, so each
// object's bounding box in the VIDEO's own coordinate space never
// changes — only where that box lands on screen does, as the
// viewport's aspect ratio changes how object-fit:cover crops the
// video (same reasoning as panel-glow.js's targetToScreen).
//
// Rather than a pixel-perfect silhouette mask (the rim-light PNGs
// used for the glow effect only trace part of each object's edge, not
// a closed shape, so they can't be flood-filled into one) this uses a
// hand-eyeballed rectangular bounding box per object and simply
// doesn't draw the line across it — three separate segments instead
// of one line spanning the full width. For boxy objects like these
// (a CRT monitor+tower, a rectangular column) a bounding-box gap
// reads as "behind the object" convincingly without needing a real
// mask.

const VIDEO_SELECTOR = '.panels-bg';

// Fractions of the 1924x1076 video frame — eyeballed from a still.
const OBJECTS = [
    { name: 'computer', x1: 0.398, x2: 0.546 },
    { name: 'column', x1: 0.546, x2: 0.624 },
];
const LINE_FY = 0.51; // vertical position of the demo line, as a video-frame fraction

function coverOffset(intrinsicW, intrinsicH, boxW, boxH) {
    const scale = Math.max(boxW / intrinsicW, boxH / intrinsicH);
    return {
        x: (boxW - intrinsicW * scale) / 2,
        y: (boxH - intrinsicH * scale) / 2,
        scale,
    };
}

function initOcclusionDemo() {
    const video = document.querySelector(VIDEO_SELECTOR);
    const segments = Array.from(document.querySelectorAll('.occlusion-line-segment'));
    if (!video || segments.length !== 3) return;

    function redraw() {
        const iw = video.videoWidth || 1924;
        const ih = video.videoHeight || 1076;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const { x: offsetX, y: offsetY, scale } = coverOffset(iw, ih, vw, vh);

        const toScreenX = (fx) => offsetX + fx * iw * scale;
        const y = Math.round(offsetY + LINE_FY * ih * scale);

        const [before, between, after] = segments;
        const computer = OBJECTS[0];
        const column = OBJECTS[1];
        const cLeft = toScreenX(computer.x1);
        const cRight = toScreenX(computer.x2);
        const colLeft = toScreenX(column.x1);
        const colRight = toScreenX(column.x2);

        before.style.top = `${y}px`;
        before.style.left = '0px';
        before.style.width = `${Math.max(0, cLeft)}px`;

        between.style.top = `${y}px`;
        between.style.left = `${cRight}px`;
        between.style.width = `${Math.max(0, colLeft - cRight)}px`;

        after.style.top = `${y}px`;
        after.style.left = `${colRight}px`;
        after.style.width = `${Math.max(0, vw - colRight)}px`;
    }

    redraw();
    window.addEventListener('resize', redraw);
    video.addEventListener('loadedmetadata', redraw);
}

initOcclusionDemo();
