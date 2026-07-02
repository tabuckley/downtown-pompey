// Archie — the site helper. Scripted, page-aware, Clippy-spirited.

// Placeholder torso-up figure until the final PNG is ready — swap this one
// constant for the real asset URL (e.g. an R2 link) and nothing else changes.
const ARCHIE_IMAGE_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">
  <path d="M20 260 Q20 140 100 140 Q180 140 180 260 Z" fill="#8b3a00" stroke="#3a2a10" stroke-width="5"/>
  <circle cx="100" cy="72" r="58" fill="#c8b89a" stroke="#3a2a10" stroke-width="5"/>
  <circle cx="80" cy="68" r="6.5" fill="#3a2a10"/>
  <circle cx="120" cy="68" r="6.5" fill="#3a2a10"/>
  <path d="M74 96 Q100 114 126 96" fill="none" stroke="#3a2a10" stroke-width="6" stroke-linecap="round"/>
</svg>
`.trim());

const SCRIPTS = {
    landing: {
        intro: "Hello! I'm Archie, the archive helper. Pick one of the buttons above — each shows the archive in a different way.",
        tips: [
            "Editorial is the full art experience — a 3D room you can look around.",
            "Scrapbook is the fun one: scroll forever, filter by tags.",
            "Accessible is the clear, easy-to-read version for researchers and screen readers.",
            "Hover over each button to get a feel for where it takes you.",
        ],
    },
    editorial: {
        intro: "You're in the room. Move your mouse to look around, and click any object on display to learn its story.",
        tips: [
            "The objects here are pulled from the archive — a new selection each visit.",
            "Click a framed photo or object to open its info panel.",
            "Want more control? The Scrapbook view lets you search everything.",
        ],
    },
    scrapbook: {
        intro: "This is the whole archive in one endless scroll. Use the tags or the search bar to curate what you see.",
        tips: [
            "Pick more than one tag to narrow things down — items must match all of them.",
            "The search box looks through titles and descriptions.",
            "Click any item to see it big, with its full story.",
            "Clear filters any time with the link next to the item count.",
        ],
    },
    accessible: {
        intro: "This is the accessible view — designed to be clear, fast, and easy to navigate for everyone.",
        tips: [
            "This page is being built. Everything from the archive will be here in plain, readable form.",
            "You can switch views at any time with the buttons at the top.",
        ],
    },
    process: {
        intro: "This page is about how the archive itself was made — the thinking, the tools, and the people behind it.",
        tips: [
            "The archive is a living project — this page grows as it does.",
            "Head back to the landing page to pick a way in.",
        ],
    },
};

function buildHelper() {
    const mount = document.getElementById('site-helper');
    if (!mount) return;

    const page = document.body.dataset.page || 'landing';
    const script = SCRIPTS[page] || SCRIPTS.landing;
    let tipIndex = -1;

    const widget = document.createElement('div');
    widget.className = 'helper-widget';

    const bubble = document.createElement('div');
    bubble.className = 'helper-bubble';
    bubble.setAttribute('role', 'status');
    bubble.innerHTML = `
        <div class="helper-bubble-name">Archie</div>
        <div class="helper-bubble-text"></div>
        <div class="helper-bubble-actions">
            <button class="helper-chip" data-action="tip">another tip ?</button>
            <button class="helper-chip" data-action="close">close ×</button>
        </div>
    `;

    const btn = document.createElement('button');
    btn.className = 'helper-figure-btn';
    btn.setAttribute('aria-label', 'Site helper — Archie');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<img class="helper-figure-img" src="${ARCHIE_IMAGE_URL}" alt="">`;

    widget.appendChild(bubble);
    widget.appendChild(btn);
    mount.appendChild(widget);

    const textEl = bubble.querySelector('.helper-bubble-text');

    function say(text) {
        textEl.textContent = text;
        bubble.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
    }

    function close() {
        bubble.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        sessionStorage.setItem('aa-helper-seen-' + page, '1');
    }

    function nextTip() {
        tipIndex = (tipIndex + 1) % script.tips.length;
        say(script.tips[tipIndex]);
    }

    btn.addEventListener('click', () => {
        if (bubble.classList.contains('open')) close();
        else say(script.intro);
    });

    bubble.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'tip') nextTip();
        if (action === 'close') close();
    });

    // Auto-introduce once per page per session
    if (!sessionStorage.getItem('aa-helper-seen-' + page)) {
        setTimeout(() => say(script.intro), 1400);
    }
}

buildHelper();
