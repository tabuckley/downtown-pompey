const SHEET_ID = '1INsPP2txSuajj7NYpGTbBhy-6nnTTgtbqhg-veMtgyk';

function sheetUrl(tabName) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

async function fetchSheet(tabName) {
    const res = await fetch(sheetUrl(tabName));
    if (!res.ok) throw new Error(`Failed to fetch sheet: ${tabName}`);
    const csv = await res.text();
    return parseCSV(csv);
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
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
            if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

// ===== MODE SWITCHING =====
const MODES = ['editorial', 'scrapbook', 'easy'];
let currentMode = localStorage.getItem('aa-mode') || 'editorial';

function setMode(mode) {
    currentMode = mode;
    document.body.setAttribute('data-mode', mode);
    localStorage.setItem('aa-mode', mode);
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

// ===== MOBILE NAV =====
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileNav = document.getElementById('mobileNav');
const mobileNavClose = document.getElementById('mobileNavClose');

mobileMenuBtn.addEventListener('click', () => mobileNav.classList.add('open'));
mobileNavClose.addEventListener('click', () => mobileNav.classList.remove('open'));
mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => mobileNav.classList.remove('open'));
});

// ===== ACTIVE NAV ON SCROLL =====
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.side-nav-menu a');

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            navLinks.forEach(link => {
                link.style.color = link.getAttribute('href') === `#${entry.target.id}` ? 'var(--white)' : '';
            });
        }
    });
}, { threshold: 0.5 });

sections.forEach(s => observer.observe(s));

// ===== INIT =====
async function init() {
    setMode(currentMode);

    try {
        const [index, config] = await Promise.all([
            fetchSheet('_index'),
            fetchSheet('_config')
        ]);

        // Apply config
        const cfg = Object.fromEntries(config.map(r => [r.key, r.value]));
        if (cfg.site_title) document.title = cfg.site_title;
        if (cfg.mode_1_name) updateModeName(0, cfg.mode_1_name);
        if (cfg.mode_2_name) updateModeName(1, cfg.mode_2_name);
        if (cfg.mode_3_name) updateModeName(2, cfg.mode_3_name);

        // Render archive list from index
        const published = index.filter(p => p.status === 'published');
        renderArchive(published);

    } catch (err) {
        console.warn('Sheet not yet published or accessible:', err.message);
    }
}

function updateModeName(i, name) {
    const btns = document.querySelectorAll('.mode-btn');
    if (btns[i]) btns[i].textContent = name;
}

function renderArchive(projects) {
    const list = document.querySelector('.archive-list');
    if (!list) return;
    list.innerHTML = '';

    projects.forEach(p => {
        const row = document.createElement('div');
        row.className = 'archive-row';
        row.dataset.project = p.id;
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
        console.log(`Loaded ${items.length} items from ${project.tab}`);
        // Project viewer will be built out next
    } catch (err) {
        console.warn('Could not load project tab:', err.message);
    }
}

init();
