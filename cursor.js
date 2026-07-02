// Custom cursor for the editorial page. Only runs on precise-pointer devices.

export function initCursor() {
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const ring = document.getElementById('cursor');
    const dot = document.getElementById('cursorDot');
    if (!ring || !dot) return;

    let curX = 0, curY = 0, ringX = 0, ringY = 0;

    document.addEventListener('mousemove', (e) => {
        curX = e.clientX;
        curY = e.clientY;
        dot.style.left = curX + 'px';
        dot.style.top = curY + 'px';
    });

    // Grow the ring over interactive elements
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('a, button')) document.body.classList.add('is-hovering');
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('a, button')) document.body.classList.remove('is-hovering');
    });

    function frame() {
        ringX += (curX - ringX) * 0.12;
        ringY += (curY - ringY) * 0.12;
        ring.style.left = ringX + 'px';
        ring.style.top = ringY + 'px';
        requestAnimationFrame(frame);
    }
    frame();
}
