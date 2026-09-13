// Team photo stack — a loose pile of portraits that idly cycles which one
// is on top, and jumps straight to (and pauses on) a person's photo when
// their bio is hovered or focused. Reciprocal: hovering a photo itself also
// activates it, matching whichever bio it belongs to.
const stack = document.getElementById('teamStack');
if (stack) {
    const photos = [...stack.querySelectorAll('.team-photo')];
    const bios = [...document.querySelectorAll('.team-bio')];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const IDLE_INTERVAL_MS = 2800;

    let activeIndex = 0;
    let idleTimer = null;

    function setActive(index) {
        activeIndex = index;
        const person = photos[index].dataset.person;
        photos.forEach((p, i) => p.classList.toggle('is-active', i === index));
        bios.forEach(b => b.classList.toggle('is-active', b.dataset.person === person));
    }

    function activateByPerson(person) {
        const index = photos.findIndex(p => p.dataset.person === person);
        if (index !== -1) setActive(index);
    }

    function stopIdle() {
        if (idleTimer) clearInterval(idleTimer);
        idleTimer = null;
    }

    // Ambient only — never the sole way to reach a photo, since hover/focus
    // on the matching bio (or the photo itself) always works regardless.
    function startIdle() {
        if (reduceMotion) return;
        stopIdle();
        idleTimer = setInterval(() => setActive((activeIndex + 1) % photos.length), IDLE_INTERVAL_MS);
    }

    [...bios, ...photos].forEach(el => {
        const person = el.dataset.person;
        el.addEventListener('mouseenter', () => { stopIdle(); activateByPerson(person); });
        el.addEventListener('mouseleave', startIdle);
        el.addEventListener('focus', () => { stopIdle(); activateByPerson(person); });
        el.addEventListener('blur', startIdle);
    });

    setActive(0);
    startIdle();
}

// ===== CARDS: shrink text to fit instead of scrolling =====
// Every .pr-panel card has overflow:hidden and no scrollbar of its own —
// #prScroll (below) is the page's one and only scrollable thing — so
// content that would otherwise overflow a card shrinks via the --pr-scale
// custom property (see styles.css) instead. Same step-down-until-it-fits
// approach as Flo's scrapbook bubble (helper.js's fitTextToBubble).
const SCALE_STEPS = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58];
const cards = [...document.querySelectorAll('.pr-panel')];

function fitCardText(card) {
    for (const scale of SCALE_STEPS) {
        card.style.setProperty('--pr-scale', scale);
        if (card.scrollHeight <= card.clientHeight + 1 && card.scrollWidth <= card.clientWidth + 1) return;
    }
}

function fitAllCards() {
    cards.forEach(fitCardText);
}

if (cards.length) {
    fitAllCards();
    // Web fonts swapping in, and the group photo/team photos/video poster
    // loading, can all change a card's natural content size after the
    // first pass.
    window.addEventListener('load', fitAllCards);
    document.fonts?.ready.then(fitAllCards).catch(() => {});
    // A resize can turn text that fit into text that doesn't (or free up
    // room to grow back toward scale 1) — debounced since resize fires
    // continuously while dragging.
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(fitAllCards, 150);
    });
}

// ===== SIDEWAYS SCROLL: vertical wheel → horizontal =====
// Remaps ordinary wheel input (vertical, from a mouse or a trackpad's
// two-finger scroll) onto scrollLeft, so getting through the page never
// needs shift-scroll or a dragged scrollbar. Unconditional — no
// deltaY-vs-deltaX gate — because a trackpad's momentum phase fires many
// small events where deltaX can transiently outweigh deltaY even during a
// gesture that reads as "vertical" overall; gating on that per-event
// dropped some of them, which felt like scrolling had silently stopped
// working partway through. Always prevents default and always moves
// scrollLeft, by whichever delta is actually present.
const scroller = document.getElementById('prScroll');
if (scroller) {
    scroller.addEventListener('wheel', (e) => {
        e.preventDefault();
        scroller.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
    }, { passive: false });

    // A touchscreen's horizontal drag already pans the scroller natively
    // (no JS needed) — this only covers a straight-up-or-down finger
    // swipe, which would otherwise do nothing (the page itself has no
    // vertical overflow to scroll). Direction decided once per touch from
    // the first real movement, not re-checked every event, so a gesture
    // that starts vertical keeps working even if the finger drifts.
    let touchStartX = 0;
    let touchStartY = 0;
    let touchIsVertical = null;
    scroller.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchIsVertical = null;
    }, { passive: true });
    scroller.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        const dx = touchStartX - touch.clientX;
        const dy = touchStartY - touch.clientY;
        if (touchIsVertical === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
            touchIsVertical = Math.abs(dy) > Math.abs(dx);
        }
        if (touchIsVertical) {
            e.preventDefault();
            scroller.scrollLeft += dy;
            touchStartY = touch.clientY;
        }
    }, { passive: false });
}
