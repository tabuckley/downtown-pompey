// Custom cursor for the editorial page. Only runs on precise-pointer devices.
// Adds .has-custom-cursor to <body>; ALL cursor-hiding/showing CSS keys off
// that class, so touch devices keep their normal behaviour and never see
// stray cursor elements.

export function initCursor() {
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const sprite = document.getElementById('cursor');
    if (!sprite) return;

    document.body.classList.add('has-custom-cursor');

    // Start off-screen so nothing shows until the first mousemove. A
    // pixel-art cursor tracks 1:1 with no lag/easing — smooth trailing
    // reads as "modern UI," not the snap of a real pointer sprite.
    sprite.style.left = '-100px';
    sprite.style.top = '-100px';

    // Sparkle trail: throttled by distance moved rather than a fixed
    // interval, so it thins out naturally when the mouse sits still and
    // thickens when it moves fast — closer to a real particle trail than
    // a metronome. Colours alternate with the low-poly sparkle ring's own
    // pink/gold pairing (three-scene.js) so the 2D trail and the 3D
    // room's own sparkle effect read as the same idea.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TRAIL_MIN_DIST = 18;
    let lastTrailX = -100, lastTrailY = -100;
    let goldNext = false;

    function spawnParticle(x, y) {
        const p = document.createElement('div');
        p.className = 'cursor-particle' + (goldNext ? ' cursor-particle--gold' : '');
        goldNext = !goldNext;
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        document.body.appendChild(p);
        // Force layout before adding .fade so the browser has actually
        // committed the base (unfaded) state first — a single rAF isn't a
        // reliable guarantee of that, and without this the transition has
        // no "before" to animate from and just jumps straight to the end
        // state (confirmed: opacity read back as 0 within the same tick).
        void p.offsetWidth;
        p.classList.add('fade');
        p.addEventListener('transitionend', () => p.remove(), { once: true });
    }

    document.addEventListener('mousemove', (e) => {
        sprite.style.left = e.clientX + 'px';
        sprite.style.top = e.clientY + 'px';

        if (reduceMotion) return;
        const dx = e.clientX - lastTrailX, dy = e.clientY - lastTrailY;
        if (dx * dx + dy * dy >= TRAIL_MIN_DIST * TRAIL_MIN_DIST) {
            lastTrailX = e.clientX;
            lastTrailY = e.clientY;
            spawnParticle(e.clientX, e.clientY);
        }
    });

    // Grow the sprite over interactive elements
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('a, button')) document.body.classList.add('is-hovering');
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('a, button')) document.body.classList.remove('is-hovering');
    });
}
