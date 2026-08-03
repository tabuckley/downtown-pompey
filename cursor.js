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

    document.addEventListener('mousemove', (e) => {
        sprite.style.left = e.clientX + 'px';
        sprite.style.top = e.clientY + 'px';
    });

    // Grow the sprite over interactive elements
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('a, button')) document.body.classList.add('is-hovering');
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('a, button')) document.body.classList.remove('is-hovering');
    });
}
