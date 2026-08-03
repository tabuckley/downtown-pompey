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
