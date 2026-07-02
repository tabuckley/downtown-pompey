import { fetchSheet } from './sheet.js';
import { initRoom, addFramedPhoto, addModel, addPlaceholders, onObjectClick, onObjectHover } from './three-scene.js';
import { initCursor } from './cursor.js';

const MAX_PHOTOS = 6;
const MAX_MODELS = 2;

initCursor();
initRoom('room-canvas');

// ===== INFO PANEL =====
const panel = document.getElementById('infoPanel');
const roomHint = document.getElementById('roomHint');

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

    panel.classList.add('open');
}

document.getElementById('infoClose').addEventListener('click', () => panel.classList.remove('open'));

onObjectClick(showPanel);
onObjectHover(hovering => document.body.classList.toggle('is-hovering', hovering));

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
            addPlaceholders();
            roomHint.textContent = 'The room is empty for now — placeholder objects on display';
            return;
        }

        const picks = shuffle([...published]).slice(0, 4);
        const results = await Promise.allSettled(picks.map(p => fetchSheet(p.tab)));

        let photos = 0, models = 0;
        results.forEach((res, i) => {
            if (res.status !== 'fulfilled') return;
            const project = picks[i];
            res.value.forEach(row => {
                const data = { ...row, project: project.title, year: row.date ? new Date(row.date).getFullYear() : project.year };
                if (row.type === 'photo' && row.url && photos < MAX_PHOTOS) {
                    addFramedPhoto(row.url, data);
                    photos++;
                } else if (row.type === '3d' && row.url && models < MAX_MODELS) {
                    addModel(row.url, data);
                    models++;
                }
            });
        });

        if (photos === 0 && models === 0) {
            addPlaceholders();
            roomHint.textContent = 'The room is empty for now — placeholder objects on display';
        }
    } catch (err) {
        console.warn('Could not load archive:', err.message);
        addPlaceholders();
        roomHint.textContent = 'Could not reach the archive — placeholder objects on display';
    }
}

populate();
