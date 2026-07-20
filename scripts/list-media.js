#!/usr/bin/env node
// Turns an `rclone lsjson` recursive listing into one CSV per top-level
// project folder, ready to import into the Google Sheet — matching the
// exact columns sheet.js/scrapbook.js already read (type, title, url,
// thumbnail, date, description, credit, tags).
//
// Usage:
//   rclone lsjson r2:YOUR_BUCKET --recursive | node scripts/list-media.js media-import
//
// Writes media-import/<project>.csv (one per top-level folder found) plus
// media-import/_index.csv — a starting point for the Sheet's _index tab
// (status left blank; fill in "published" per project when ready to go live).
//
// Per project CSV: Google Sheets > File > Import > Upload, "Insert new
// sheet(s)". Add a helper column next to `url` with =IMAGE(<url cell>) and
// fill it down so you can see a thumbnail per row while tagging — the site's
// CSV parser only reads columns by header name, so an extra helper column is
// harmless and can stay.

const fs = require('fs');
const path = require('path');

const EXT_TYPE = {
    jpg: 'photo', jpeg: 'photo', png: 'photo', gif: 'photo', webp: 'photo', avif: 'photo',
    mp4: 'video', mov: 'video', webm: 'video',
    mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio',
    glb: '3d', gltf: '3d',
};

const HEADERS = ['type', 'title', 'url', 'thumbnail', 'date', 'description', 'credit', 'tags'];
const BASE_URL = 'https://media.downtownpompey.online';

function csvField(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, headers) {
    const lines = [headers.join(',')];
    rows.forEach(row => lines.push(headers.map(h => csvField(row[h])).join(',')));
    return lines.join('\n') + '\n';
}

function titleFromPath(p) {
    const base = p.split('/').pop().replace(/\.[^.]+$/, '');
    return base.replace(/[-_]+/g, ' ').trim();
}

function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function mostCommon(values) {
    const counts = new Map();
    values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    let best = '', bestCount = 0;
    for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
    return best;
}

function main() {
    const outDir = process.argv[2] || 'media-import';
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => {
        let entries;
        try {
            entries = JSON.parse(input);
        } catch (err) {
            console.error('Could not parse input as JSON — did you pipe in `rclone lsjson ... --recursive`?');
            process.exit(1);
        }

        const byProject = new Map();
        let unrecognized = 0;

        entries.filter(e => !e.IsDir).forEach(e => {
            const segments = e.Path.split('/');
            const project = segments.length > 1 ? segments[0] : '(root)';
            const ext = (e.Path.split('.').pop() || '').toLowerCase();
            const type = EXT_TYPE[ext] || '';
            if (!type) unrecognized++;
            const url = `${BASE_URL}/${segments.map(encodeURIComponent).join('/')}`;
            const date = e.ModTime ? e.ModTime.slice(0, 10) : '';

            const row = { type, title: titleFromPath(e.Path), url, thumbnail: '', date, description: '', credit: '', tags: '' };
            if (!byProject.has(project)) byProject.set(project, []);
            byProject.get(project).push(row);
        });

        fs.mkdirSync(outDir, { recursive: true });

        const indexRows = [];
        for (const [project, rows] of byProject) {
            const fileName = `${slug(project)}.csv`;
            fs.writeFileSync(path.join(outDir, fileName), toCsv(rows, HEADERS));
            const year = mostCommon(rows.map(r => r.date.slice(0, 4)).filter(Boolean));
            indexRows.push({ status: '', tab: slug(project), title: project, year });
            console.error(`${project}: ${rows.length} rows -> ${fileName}`);
        }

        fs.writeFileSync(path.join(outDir, '_index.csv'), toCsv(indexRows, ['status', 'tab', 'title', 'year']));

        const total = entries.filter(e => !e.IsDir).length;
        console.error(`\n${total} files total across ${byProject.size} folders, written to ${outDir}/`);
        if (unrecognized) console.error(`${unrecognized} files had an unrecognized type — check those rows.`);
    });
}

main();
