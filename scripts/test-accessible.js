#!/usr/bin/env node
// Automated browser test suite for the accessible archive page
// (accessible.html / accessible.js / search.js). Covers: exact search,
// misspelled search (typo tolerance), empty/browse-all search, a
// no-match query, item deep-links loaded directly (not just via SPA
// navigation), back/forward, invalid item IDs, sharing controls, and the
// is-this-yours/not-this-one/show-more-like-this refinement controls.
//
// Requires Playwright, which is NOT a dependency of this project (the
// site itself ships zero npm dependencies and no build step, by design —
// see project notes). Install it separately before running:
//   npm install -D playwright && npx playwright install chromium
//
// Requires a static server running with clean URLs OFF (query strings
// must survive — see serve.json), e.g.:
//   npx serve . --cors -l 5500
//
// Usage:
//   node scripts/test-accessible.js [baseUrl]     (default: http://localhost:5500)

let chromium;
try {
    ({ chromium } = require('playwright'));
} catch {
    console.error('Playwright is not installed. Run: npm install -D playwright && npx playwright install chromium');
    process.exit(1);
}

const BASE_URL = process.argv[2] || 'http://localhost:5500';
const KNOWN_QUERY = 'lily savage';
const KNOWN_QUERY_TYPO = 'lilly savge';

let pass = 0, fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log(`  PASS  ${label}`);
        pass++;
    } else {
        console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
        fail++;
    }
}

async function withPage(browser, fn) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    try {
        await fn(page, errors);
    } finally {
        await page.close();
    }
    return errors;
}

async function main() {
    const browser = await chromium.launch();

    console.log('\n1. Initial load + browse-all (empty query)');
    await withPage(browser, async (page, errors) => {
        await page.goto(`${BASE_URL}/accessible.html`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        const state = await page.evaluate(() => ({
            resultCount: document.querySelectorAll('#accResults .acc-result-link').length,
            hasTypeChips: document.querySelectorAll('#accTypeFilters .acc-chip').length > 0,
            hasTagChips: document.querySelectorAll('#accTagFilters .acc-chip').length > 0,
        }));
        check('renders results with no query (browse-all)', state.resultCount > 0, `got ${state.resultCount}`);
        check('type filter chips built from real data', state.hasTypeChips);
        check('tag filter chips built from real data', state.hasTagChips);
        check('no console/page errors', errors.length === 0, errors.join('; '));
    });

    console.log('\n2. Exact search query');
    let firstResultId = null;
    await withPage(browser, async (page, errors) => {
        await page.goto(`${BASE_URL}/accessible.html`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.fill('#accSearchInput', KNOWN_QUERY);
        await page.click('.acc-search-btn');
        await page.waitForTimeout(300);
        const state = await page.evaluate(() => ({
            resultCount: document.querySelectorAll('#accResults .acc-result-link').length,
            url: location.href,
            firstHref: document.querySelector('.acc-result-link')?.getAttribute('href'),
        }));
        check('exact query returns results', state.resultCount > 0, `got ${state.resultCount}`);
        check('search state pushed to URL as ?q=', state.url.includes('q=lily'), state.url);
        firstResultId = state.firstHref ? new URLSearchParams(state.firstHref.split('?')[1]).get('item') : null;
        check('result links carry a stable item id', !!firstResultId);
        check('no console/page errors', errors.length === 0, errors.join('; '));
    });

    console.log('\n3. Misspelled query (typo tolerance)');
    await withPage(browser, async (page) => {
        await page.goto(`${BASE_URL}/accessible.html`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.fill('#accSearchInput', KNOWN_QUERY_TYPO);
        await page.click('.acc-search-btn');
        await page.waitForTimeout(300);
        const count = await page.evaluate(() => document.querySelectorAll('#accResults .acc-result-link').length);
        check('misspelled query still surfaces results', count > 0, `got ${count}`);
    });

    console.log('\n4. Weak/no-match query');
    await withPage(browser, async (page) => {
        await page.goto(`${BASE_URL}/accessible.html`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.fill('#accSearchInput', 'zzzxxqqnonexistentqueryterm');
        await page.click('.acc-search-btn');
        await page.waitForTimeout(300);
        const status = await page.evaluate(() => document.getElementById('accStatus').textContent);
        check('no-match query shows a helpful empty state, not a crash', /no matches/i.test(status), status);
    });

    console.log('\n5. Direct load of an item URL (not via SPA nav)');
    await withPage(browser, async (page, errors) => {
        await page.goto(`${BASE_URL}/accessible.html?item=${encodeURIComponent(firstResultId)}`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        const state = await page.evaluate(() => ({
            detailVisible: !document.getElementById('accDetailView').hidden,
            searchHidden: document.getElementById('accSearchView').hidden,
            hasTitle: !!document.querySelector('.acc-detail-title')?.textContent,
        }));
        check('detail view visible on direct load', state.detailVisible);
        check('search view hidden on direct load', state.searchHidden);
        check('item title rendered', state.hasTitle);
        check('no console/page errors', errors.length === 0, errors.join('; '));
    });

    console.log('\n6. Invalid item id');
    await withPage(browser, async (page) => {
        await page.goto(`${BASE_URL}/accessible.html?item=this-id-does-not-exist-xyz`, { waitUntil: 'load' });
        await page.waitForTimeout(1000);
        const text = await page.evaluate(() => document.querySelector('.acc-detail-title')?.textContent || '');
        check('invalid id shows a graceful not-found message', /not found/i.test(text), text);
    });

    console.log('\n7. SPA navigation + back/forward');
    await withPage(browser, async (page) => {
        await page.goto(`${BASE_URL}/accessible.html`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.fill('#accSearchInput', KNOWN_QUERY);
        await page.click('.acc-search-btn');
        await page.waitForTimeout(300);
        await page.click('.acc-result-link');
        await page.waitForTimeout(300);
        const afterClick = await page.evaluate(() => !document.getElementById('accDetailView').hidden);
        check('clicking a result opens detail view', afterClick);

        await page.goBack();
        await page.waitForTimeout(300);
        const afterBack = await page.evaluate(() => ({
            searchHidden: document.getElementById('accSearchView').hidden,
            inputValue: document.getElementById('accSearchInput').value,
        }));
        check('back restores search view', !afterBack.searchHidden);
        check('back restores the search query text', afterBack.inputValue === KNOWN_QUERY, afterBack.inputValue);

        await page.goForward();
        await page.waitForTimeout(300);
        const afterForward = await page.evaluate(() => !document.getElementById('accDetailView').hidden);
        check('forward restores detail view', afterForward);
    });

    console.log('\n8. Sharing controls');
    await withPage(browser, async (page, errors) => {
        const context = browser.contexts()[0];
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto(`${BASE_URL}/accessible.html?item=${encodeURIComponent(firstResultId)}`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);

        const structure = await page.evaluate(() => {
            const block = document.querySelector('.acc-share');
            return {
                found: !!block,
                emailHref: block?.querySelector('a.acc-btn[href^="mailto:"]')?.getAttribute('href') || '',
                urlValue: block?.querySelector('.acc-share-url')?.value || '',
            };
        });
        check('share block renders', structure.found);
        check('email link is a real mailto: with subject+body', structure.emailHref.startsWith('mailto:?subject=') && structure.emailHref.includes('body='));
        check('share URL field shows the real deep link', structure.urlValue.includes(`item=${firstResultId}`));

        await page.locator('.acc-share .acc-btn', { hasText: 'Copy link' }).click();
        await page.waitForTimeout(300);
        let clipboard = '';
        try { clipboard = await page.evaluate(() => navigator.clipboard.readText()); } catch { /* clipboard perms unavailable in this environment */ }
        check('copy link puts the item URL on the clipboard', clipboard.includes(`item=${firstResultId}`), clipboard);
        check('no console/page errors', errors.length === 0, errors.join('; '));
    });

    console.log('\n9. Refinement controls (is-this-yours / not-this-one / show-more-like-this)');
    await withPage(browser, async (page) => {
        await page.goto(`${BASE_URL}/accessible.html`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.fill('#accSearchInput', KNOWN_QUERY);
        await page.click('.acc-search-btn');
        await page.waitForTimeout(300);
        const before = await page.evaluate(() => document.querySelectorAll('#accResults .acc-result-link').length);
        await page.click('.acc-result-link');
        await page.waitForTimeout(300);

        await page.locator('.acc-refine .acc-btn', { hasText: 'Is this yours?' }).click();
        await page.waitForTimeout(200);
        const msg = await page.evaluate(() => document.querySelector('.acc-refine-msg')?.textContent || '');
        check('"Is this yours?" shows a local, non-recorded confirmation', /isn.t recorded/i.test(msg), msg);

        await page.goto(`${BASE_URL}/accessible.html?q=${encodeURIComponent(KNOWN_QUERY)}`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.click('.acc-result-link');
        await page.waitForTimeout(300);
        await page.locator('.acc-refine .acc-btn', { hasText: 'Not this one' }).click();
        await page.waitForTimeout(300);
        const after = await page.evaluate(() => ({
            searchHidden: document.getElementById('accSearchView').hidden,
            count: document.querySelectorAll('#accResults .acc-result-link').length,
        }));
        check('"Not this one" returns to search results', !after.searchHidden);
        check('"Not this one" removes the dismissed item from results', after.count === before - 1, `before ${before}, after ${after.count}`);

        await page.goto(`${BASE_URL}/accessible.html?item=${encodeURIComponent(firstResultId)}`, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.locator('.acc-refine .acc-btn', { hasText: 'Show more like this' }).click();
        await page.waitForTimeout(300);
        const moreLike = await page.evaluate(() => ({
            searchHidden: document.getElementById('accSearchView').hidden,
            inputValue: document.getElementById('accSearchInput').value,
        }));
        check('"Show more like this" returns to search with a derived query', !moreLike.searchHidden && moreLike.inputValue.length > 0, moreLike.inputValue);
    });

    await browser.close();

    console.log(`\n${pass} passed, ${fail} failed.`);
    if (fail > 0) process.exit(1);
}

main().catch(err => {
    console.error('Test run crashed:', err);
    process.exit(1);
});
