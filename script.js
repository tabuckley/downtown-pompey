import { initScene, loadModel } from './three-scene.js';

const SHEET_ID = '1INsPP2txSuajj7NYpGTbBhy-6nnTTgtbqhg-veMtgyk';

function sheetUrl(tabName) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

async function fetchSheet(tabName) {
    const res = await fetch(sheetUrl(tabName));
    if (!res.ok) throw new Error(`Failed to fetch sheet: ${tabName}`);
    return parseCSV(await res.text());
}

function parseCSV(csv) {
    const lines = csv.trim().split('\n');
    const headers = parseCSVRow(lines[0]);
    return lines.slice(1).map(line => {
        const values = parseCSVRow(line);
        return Object.fromEntries(headers.map((h, i) => [h.trim(), (values[i] || '').trim()]));
    });
}

function parseCSVRow(row) {
    const result = [];
    let current = '', inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
            if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current); current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

// ===== MODE SWITCHING =====
let currentMode = localStorage.getItem('aa-mode') || 'editorial';
let sceneReady = false;

function setMode(mode) {
    currentMode = mode;
    document.body.setAttribute('data-mode', mode);
    localStorage.setItem('aa-mode', mode);
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    if (mode === 'editorial' && !sceneReady) {
        initScene();
        sceneReady = true;
    }
}

document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

// ===== CUSTOM CURSOR =====
const cursor = document.getElementById('cursor');
const cursorDot = document.getElementById('cursorDot');
let curX = 0, curY = 0, dotX = 0, dotY = 0;

document.addEventListener('mousemove', (e) => {
    curX = e.clientX;
    curY = e.clientY;
    cursorDot.style.left = curX + 'px';
    cursorDot.style.top  = curY + 'px';
});

function animateCursor() {
    dotX += (curX - dotX) * 0.08;
    dotY += (curY - dotY) * 0.08;
    cursor.style.left = dotX + 'px';
    cursor.style.top  = dotY + 'px';
    requestAnimationFrame(animateCursor);
}
animateCursor();

// ===== MOBILE NAV =====
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileNav     = document.getElementById('mobileNav');
const mobileNavClose = document.getElementById('mobileNavClose');

mobileMenuBtn.addEventListener('click', () => mobileNav.classList.add('open'));
mobileNavClose.addEventListener('click', () => mobileNav.classList.remove('open'));
mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => mobileNav.classList.remove('open'));
});

// ===== ACTIVE NAV ON SCROLL =====
const sections = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('.side-nav-menu a');

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            navLinks.forEach(link => {
                link.style.color = link.getAttribute('href') === `#${entry.target.id}`
                    ? 'var(--text)' : '';
            });
        }
    });
}, { threshold: 0.5 });

sections.forEach(s => observer.observe(s));

// ===== SHEET + RENDER =====
async function init() {
    setMode(currentMode);

    try {
        const [index, config] = await Promise.all([
            fetchSheet('_index'),
            fetchSheet('_config'),
        ]);

        const cfg = Object.fromEntries(config.map(r => [r.key, r.value]));
        if (cfg.site_title) document.title = cfg.site_title + ' | Downtown Pompey';

        const published = index.filter(p => p.status === 'published');
        renderArchive(published);

    } catch (err) {
        console.warn('Sheet not yet accessible:', err.message);
        document.querySelector('.archive-empty').textContent = 'Archive coming soon.';
    }
}

function renderArchive(projects) {
    const list = document.querySelector('.archive-list');
    if (!list) return;
    list.innerHTML = '';

    if (!projects.length) {
        list.innerHTML = '<p class="archive-empty">No published projects yet.</p>';
        return;
    }

    projects.forEach(p => {
        const row = document.createElement('div');
        row.className = 'archive-row';
        row.innerHTML = `
            <div class="archive-year">${p.year}</div>
            <div class="archive-info">
                <h3 class="archive-title">${p.title}</h3>
                <p class="archive-desc">${p.description}</p>
            </div>
        `;
        row.addEventListener('click', () => openProject(p));
        list.appendChild(row);
    });
}

async function openProject(project) {
    try {
        const items = await fetchSheet(project.tab);
        const models = items.filter(i => i.type === '3d' && i.url);
        models.forEach((m, idx) => {
            const x = (idx - models.length / 2) * 3;
            loadModel(m.url, [x, 0, 0]);
        });
        console.log(`Loaded project: ${project.title}`, items);
    } catch (err) {
        console.warn('Could not load project:', err.message);
    }
}

init();
