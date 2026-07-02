// Archie — the site helper. Scripted, page-aware, Clippy-spirited.

const SCRIPTS = {
    landing: {
        intro: "Hello! I'm Archie, the archive helper. Pick one of the four doors above — each shows the archive in a different way.",
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
    btn.className = 'helper-btn';
    btn.setAttribute('aria-label', 'Site helper');
    btn.innerHTML = `
        <svg viewBox="0 0 40 40" aria-hidden="true">
            <path d="M7 15 L20 8 L33 15 L33 32 a3 3 0 0 1 -3 3 L10 35 a3 3 0 0 1 -3 -3 Z" fill="#c8b89a" stroke="#3a2a10" stroke-width="1.5"/>
            <path d="M7 15 L20 21 L33 15" fill="none" stroke="#3a2a10" stroke-width="1.5"/>
            <circle class="helper-eye" cx="15" cy="27" r="1.8" fill="#3a2a10"/>
            <circle class="helper-eye" cx="25" cy="27" r="1.8" fill="#3a2a10"/>
            <path d="M16.5 31 q3.5 2.4 7 0" fill="none" stroke="#3a2a10" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
    `;

    mount.appendChild(bubble);
    mount.appendChild(btn);

    const textEl = bubble.querySelector('.helper-bubble-text');

    function say(text) {
        textEl.textContent = text;
        bubble.classList.add('open');
    }

    function close() {
        bubble.classList.remove('open');
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
