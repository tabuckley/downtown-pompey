import { fetchSheet, yearFrom } from './sheet.js';
import { initRoom, addFramedPhoto, addModel, addPlaceholders, addLowPolyModel, onObjectClick, onObjectHover } from './three-scene.js';
import { initCursor } from './cursor.js';

const MAX_PHOTOS = 6;
const MAX_MODELS = 2;

initCursor();
initRoom('room-canvas');

// Testing the low-poly-collectible replacement for the floating-gif
// overlay — a couple of fixed models for now; eventually a pool in R2 to
// randomly draw 3 from each load, same idea as the old gif rotation.
addLowPolyModel('https://media.downtownpompey.online/_site-assets/low-poly/doll-on-the-beach.glb', {
    title: 'Doll on the Beach',
});
addLowPolyModel('https://media.downtownpompey.online/_site-assets/low-poly/recycling-sculpture.glb', {
    title: 'Recycling Sculpture',
}, [-0.5, 0.28, -0.4], 0, 0);

// ===== INFO PANEL =====
const panel = document.getElementById('infoPanel');
const roomHint = document.getElementById('roomHint');
const roomItems = document.getElementById('roomItems');

if (window.matchMedia('(pointer: coarse)').matches) {
    roomHint.textContent = 'Drag to look around · tap an object to learn its story';
}

function showPanel(data) {
    document.getElementById('infoKicker').textContent = data.project || '';
    document.getElementById('infoTitle').textContent = data.title || 'Untitled';
    document.getElementById('infoMeta').textContent =
        [data.year, data.credit ? `© ${data.credit}` : ''].filter(Boolean).join(' · ');
    document.getElementById('infoDesc').textContent = data.description || '';

    const tagsEl = document.getElementById('infoTags');
    tagsEl.innerHTML = '';
    (data.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        const span = document.createElement('span');
        span.className = 'lb-tag';
        span.textContent = t;
        tagsEl.appendChild(span);
    });

    // The panel now covers part of the canvas, so the raycast hover state
    // can go stale — clear it explicitly.
    document.body.classList.remove('is-hovering');
    panel.classList.add('open');
    document.getElementById('infoClose').focus();
}

function closePanel() {
    panel.classList.remove('open');
}

document.getElementById('infoClose').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
});

onObjectClick(showPanel);
onObjectHover(hovering => document.body.classList.toggle('is-hovering', hovering));

// Screen-reader / keyboard mirror of the objects in the room
function addRoomItemButton(data) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = `View: ${data.title || 'Untitled'}${data.project ? ` (${data.project})` : ''}`;
    btn.addEventListener('click', () => showPanel(data));
    li.appendChild(btn);
    roomItems.appendChild(li);
}

function fallBackToPlaceholders(hint) {
    const placed = addPlaceholders();
    placed.forEach(addRoomItemButton);
    roomHint.textContent = hint;
}

// ===== POPULATE THE ROOM FROM THE ARCHIVE =====
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function populate() {
    try {
        const index = await fetchSheet('_index');
        const published = index.filter(p => p.status === 'published' && p.tab);

        if (!published.length) {
            fallBackToPlaceholders('The room is empty for now — placeholder objects on display');
            return;
        }

        const picks = shuffle([...published]).slice(0, 4);
        const results = await Promise.allSettled(picks.map(p => fetchSheet(p.tab)));

        const attempts = [];
        let photoCount = 0, modelCount = 0;
        results.forEach((res, i) => {
            if (res.status !== 'fulfilled') return;
            const project = picks[i];
            res.value.forEach(row => {
                const data = { ...row, project: project.title, year: yearFrom(row.date, project.year) };
                if (row.type === 'photo' && row.url && photoCount < MAX_PHOTOS) {
                    attempts.push(addFramedPhoto(row.url, data));
                    photoCount++;
                } else if (row.type === '3d' && row.url && modelCount < MAX_MODELS) {
                    attempts.push(addModel(row.url, data));
                    modelCount++;
                }
            });
        });

        // addFramedPhoto/addModel resolve with the item's data on success and
        // null on failure — only count what actually appeared in the scene.
        const placed = (await Promise.all(attempts)).filter(Boolean);
        if (!placed.length) {
            fallBackToPlaceholders('The room is empty for now — placeholder objects on display');
            return;
        }
        placed.forEach(addRoomItemButton);
    } catch (err) {
        console.warn('Could not load archive:', err.message);
        fallBackToPlaceholders('Could not reach the archive — placeholder objects on display');
    }
}

populate();
