// Flo — the site helper. Scripted, page-aware, Clippy-spirited.
//
// Dialogue is editable from the Google Sheet without touching code: add
// rows to the _copy tab using the keys
//   archie_<page>_intro   — shown automatically on first visit
//   archie_<page>_tip_1, archie_<page>_tip_2, ... — cycled by "another tip?"
// where <page> is landing / editorial / scrapbook / accessible / process.
// The defaults below are the fallback used until the sheet loads (or if a
// key is left blank), so the helper always has something to say.

import { getCopyMap } from './copy.js';

// Placeholder torso-up figure — the fallback for any page with no entry
// (or an empty one) in FLO_IMAGES below.
const ARCHIE_IMAGE_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">
  <path d="M20 260 Q20 140 100 140 Q180 140 180 260 Z" fill="#8b3a00" stroke="#3a2a10" stroke-width="5"/>
  <circle cx="100" cy="72" r="58" fill="#c8b89a" stroke="#3a2a10" stroke-width="5"/>
  <circle cx="80" cy="68" r="6.5" fill="#3a2a10"/>
  <circle cx="120" cy="68" r="6.5" fill="#3a2a10"/>
  <path d="M74 96 Q100 114 126 96" fill="none" stroke="#3a2a10" stroke-width="6" stroke-linecap="round"/>
</svg>
`.trim());

// Per-page real photo sets, keyed by the same <page> value used above and
// in document.body.dataset.page. Cycles one pose per line of dialogue
// (the intro, then each tip) instead of showing one static image
// throughout — order is display order, not the source filenames'
// numbering. To bring a new page's photos in: drop the files in images/,
// add its array here, done — buildHelper() below and the sizing rule in
// styles.css (.helper-figure-img--photo) both key off this same object
// and need no changes. Pages with no entry (or an empty array) keep
// showing the placeholder SVG.
const FLO_IMAGES = {
    editorial: [
        // Matching pink duotone/halftone treatment across all three.
        // Display order (pointing/intro, shrug, thoughtful) doesn't match
        // the filenames' own numbering (shrug, thoughtful, pointing) —
        // ordered here to line up with the intro + specific tip lines
        // they're meant to land on.
        'images/flo-editorial-3.png', // pointing — intro
        'images/flo-editorial-1.png', // shrug — "don't be a din"
        'images/flo-editorial-2.png', // thoughtful — "makes you think"
    ],
    scrapbook: [
        'images/flo-scrapbook-1.webp', // holding up a note — intro
        'images/flo-scrapbook-2.webp', // pointing
        'images/flo-scrapbook-3.webp', // eating chips
    ],
};

const MAX_TIPS = 8;

const DEFAULT_SCRIPTS = {
    landing: {
        intro: "Hello! I'm Flo, the archive helper. Pick one of the buttons above — each shows the archive in a different way.",
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
            "Search in plain language — you don't need the exact title, and small typos are fine.",
            "Use the type, project, and tag filters to narrow things down further.",
            "Every item has its own link, so you can share, bookmark, or come straight back to it.",
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

// Merges any archie_<page>_intro / archie_<page>_tip_N values found in the
// _copy sheet on top of the defaults. Mutates `script` in place so anything
// already holding a reference (buildHelper's closures) picks up the change.
function applyArchieOverrides(page, script) {
    getCopyMap().then(copy => {
        const introKey = `archie_${page}_intro`;
        if (copy[introKey]) script.intro = copy[introKey];

        const tips = [];
        for (let i = 1; i <= MAX_TIPS; i++) {
            const val = copy[`archie_${page}_tip_${i}`];
            if (val) tips.push(val);
        }
        if (tips.length) script.tips = tips;
    });
}

function buildHelper() {
    const mount = document.getElementById('site-helper');
    if (!mount) return;

    const page = document.body.dataset.page || 'landing';
    // Clone the default so sheet overrides don't mutate the shared constant.
    const script = { ...(DEFAULT_SCRIPTS[page] || DEFAULT_SCRIPTS.landing) };
    applyArchieOverrides(page, script);
    let tipIndex = -1;
    const floImages = FLO_IMAGES[page];
    const hasFloPhotos = !!(floImages && floImages.length);

    const widget = document.createElement('div');
    widget.className = 'helper-widget';

    const bubble = document.createElement('div');
    bubble.className = 'helper-bubble';
    bubble.setAttribute('role', 'status');
    // .helper-bubble-page is a plain, unstyled wrapper on every page except
    // scrapbook (display:contents there — structurally invisible, doesn't
    // affect layout at all). Scrapbook needs it as a real box: its bubble
    // is clipped to a torn-paper shape, and clip-path/mask on an element
    // clips that element's OWN pseudo-elements too — so the tape and tail
    // (::before/::after on .helper-bubble) can't hang past the torn edge
    // if the clip-path lives on that same element. Moving the paper's
    // clip-path/mask onto this inner wrapper instead leaves .helper-bubble
    // itself unclipped, free for its tape/tail to overlap the page edge.
    bubble.innerHTML = `
        <div class="helper-bubble-page">
            <div class="helper-bubble-name">Flo</div>
            <div class="helper-bubble-text"></div>
            <div class="helper-bubble-actions">
                <button class="helper-chip" data-action="tip">Next</button>
                <button class="helper-chip" data-action="close">close ×</button>
            </div>
        </div>
    `;

    const btn = document.createElement('button');
    btn.className = 'helper-figure-btn';
    btn.setAttribute('aria-label', 'Site helper — Flo');
    btn.setAttribute('aria-expanded', 'false');
    // The --photo class (not a page-name selector) is what styles.css's
    // sizing override keys off — real photos are a different aspect ratio
    // (landscape, waist-up with gesturing arms) than the tall narrow
    // placeholder SVG, regardless of which page they end up on.
    btn.innerHTML = `<img class="helper-figure-img${hasFloPhotos ? ' helper-figure-img--photo' : ''}" src="${hasFloPhotos ? floImages[0] : ARCHIE_IMAGE_URL}" alt="">`;

    widget.appendChild(bubble);
    widget.appendChild(btn);
    mount.appendChild(widget);

    const textEl = bubble.querySelector('.helper-bubble-text');
    const figureImg = btn.querySelector('.helper-figure-img');

    // Scrapbook's bubble is a fixed-size photo, not a box that grows with
    // content (see styles.css) — so a tip too long for its safe area at
    // normal size shrinks the type instead, in steps, until it fits or
    // hits the floor. Short tips exit the loop on the first check and stay
    // at full size; overflow-y:auto (already set) is the rare fallback if
    // even the floor size doesn't fit. Other pages' bubble just grows with
    // content and don't need this.
    const SCRAPBOOK_FONT_STEPS = [0.78, 0.72, 0.66, 0.6, 0.56];
    function fitTextToBubble() {
        if (page !== 'scrapbook') return;
        for (const size of SCRAPBOOK_FONT_STEPS) {
            textEl.style.fontSize = size + 'rem';
            if (textEl.scrollHeight <= textEl.clientHeight + 1) return;
        }
    }

    // imageIndex is which floImages entry belongs to THIS text, not a
    // rolling counter — intro is always floImages[0], tip N is always
    // floImages[(N+1) % length]. Re-showing the same line of dialogue (e.g.
    // closing and reopening Flo, which re-says the intro) always lands on
    // the same image that way, instead of an ever-advancing index drifting
    // the pairing apart from whatever text is actually on screen.
    function say(text, imageIndex) {
        textEl.textContent = text;
        if (hasFloPhotos) {
            figureImg.src = floImages[imageIndex % floImages.length];
            // Remove-reflow-readd, not just re-add — a CSS animation
            // doesn't restart just because the class is already present,
            // and it's already present from the previous line of dialogue
            // by the second image onward. Reading offsetWidth forces the
            // browser to apply the removal before the class goes back on.
            figureImg.classList.remove('flo-pop');
            void figureImg.offsetWidth;
            figureImg.classList.add('flo-pop');
        }
        fitTextToBubble();
        bubble.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
    }

    function close() {
        bubble.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
    }

    function nextTip() {
        tipIndex = (tipIndex + 1) % script.tips.length;
        say(script.tips[tipIndex], tipIndex + 1);
    }

    btn.addEventListener('click', () => {
        if (bubble.classList.contains('open')) close();
        else say(script.intro, 0);
    });

    bubble.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'tip') nextTip();
        if (action === 'close') close();
    });

    // Auto-introduce on every visit to the page — skipped specifically on
    // narrow viewports for two pages: accessible, where the search form +
    // type/project filters already fill the whole first screen and Flo's
    // own auto-opening bubble would land right on top of the filters
    // instead of below them like on every other page; and process, whose
    // team bio list can scroll to sit exactly in Flo's fixed bottom-right
    // corner (confirmed: with her bubble open, the longer names' tails
    // land underneath it, unclickable until she's closed). Neither case
    // is about the bubble's position at open time — it's a fixed corner
    // that can end up over arbitrary content once the page scrolls — so
    // not auto-opening is what actually avoids it for most visits; Flo
    // is still fully available via click either way.
    const skipAutoIntro = (page === 'accessible' || page === 'process') && window.matchMedia('(max-width: 480px)').matches;
    if (!skipAutoIntro) {
        setTimeout(() => say(script.intro, 0), 1400);
    }
}

buildHelper();
