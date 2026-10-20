import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-20');
await fs.mkdir(out, { recursive: true });
const fixture = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'artifacts', 'acceptance-19', 'images-live-data.json'), 'utf8'));
const responses = Object.entries(fixture.cache).filter(([key]) => key.startsWith('anigraph:v1:cache:[')).map(([key, value]) => ({ variables: JSON.parse(key.slice(18))[1], data: JSON.parse(value).data }));
const browser = await launchChrome(), page = await browser.newPage(), results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
const click = selector => page.evaluate(s => { const e = document.querySelector(s); if (typeof e.click === 'function') e.click(); else e.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, selector);
const json = data => ({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
let releaseStats;
const statsGate = new Promise(resolve => { releaseStats = resolve; });
try {
  await page.setReducedMotion(true);
  await page.route('*/api/ann/news*', () => json([]));
  await page.route('*graphql.anilist.co*', async request => {
    if (request.method === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept' }, body: '' };
    const { query, variables } = JSON.parse(request.postData);
    if (query.includes('UserStats')) await statsGate;
    const response = query.includes('UserStats') ? responses.find(r => r.data.User) : responses.find(r => r.data.MediaListCollection && r.variables.type === variables.type && r.variables.chunk === variables.chunk);
    if (!response) throw Error('Unexpected stats query');
    return json({ data: response.data });
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5174/');
  await page.evaluate(() => { document.querySelector('#statsUsername').value = 'derF'; document.querySelector('#statsForm').requestSubmit(); });
  await page.waitForSelector('.skel-summary');
  for (const width of [1440, 390, 320]) {
    await page.setViewport({ width, height: 1000, mobile: width <= 390 });
    check(width + ' loading placeholders match the responsive summary and stay inside the page', await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.skel-cell')].map(e => e.getBoundingClientRect());
      return document.documentElement.scrollWidth <= innerWidth && cells.length === 4 && Math.abs(cells[0].top - cells[innerWidth <= 600 ? 1 : 3].top) < 1 && (innerWidth > 600 || cells[2].top > cells[0].top);
    }));
  }
  releaseStats();
  await page.waitForSelector('.title-chart-row');
  const source = responses.find(r => r.data.User).data.User.statistics;
  for (const type of ['ANIME', 'MANGA']) {
    await click('[data-media-type="' + type + '"]');
    await page.waitFor(() => document.querySelectorAll('.title-chart-row').length === 8);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.summary-label')].map(e => e.textContent));
    check(type + ' summary has meaningful labels without decorative indices', labels.join('|') === (type === 'ANIME' ? 'TITLES|MEAN SCORE / 100|EPISODES|DAYS WATCHED' : 'TITLES|MEAN SCORE / 100|CHAPTERS|VOLUMES'));
    check(type + ' summary still uses original source totals', await page.evaluate(() => document.querySelector('.summary-value').textContent.replaceAll(',', '')) === String(source[type.toLowerCase()].count));
    const panels = await page.evaluate(() => [...document.querySelectorAll('[data-panel]')].map(e => ({ id: e.dataset.panel, label: e.getAttribute('aria-label') })));
    check(type + ' chart reading order matches the paired layout', panels.map(p => p.id).join(',') === 'scores,statuses,genres,formats,releaseYears,startYears,titles');
    for (const width of [1440, 1224, 985, 768, 545, 390, 320]) {
      await page.setViewport({ width, height: 1000, mobile: width <= 390 });
      await sleep(150);
      const geometry = await page.evaluate(() => {
        const bounds = selector => [...document.querySelectorAll(selector)].map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, height: r.height, fits: e.scrollWidth <= e.clientWidth + 1 }; });
        return { width: innerWidth, document: document.documentElement.scrollWidth, cards: bounds('.summary-cell'), values: bounds('.summary-value'), art: bounds('.profile-art-strip'), panels: bounds('[data-panel]'), genres: getComputedStyle(document.querySelector('[data-panel="genres"] .chart-slot')).overflowY };
      });
      check(type + ' ' + width + ' content fits without horizontal overflow', geometry.document <= width && [...geometry.cards, ...geometry.values, ...geometry.panels].every(r => r.left >= 0 && r.right <= width && r.fits), geometry);
      check(type + ' ' + width + ' summary uses four desktop or two mobile columns', Math.abs(geometry.cards[0].top - geometry.cards[width <= 600 ? 1 : 3].top) < 1 && (width > 600 || geometry.cards[2].top > geometry.cards[0].top));
      check(type + ' ' + width + ' artwork is compact and genres remain scrollable', geometry.art[0].height <= 90 && geometry.genres === 'auto');
      if (width > 900) check(type + ' ' + width + ' related charts align in matching rows', [0, 2, 4].every(i => Math.abs(geometry.panels[i].top - geometry.panels[i + 1].top) < 1 && Math.abs(geometry.panels[i].height - geometry.panels[i + 1].height) < 1));
      if ([1440, 390].includes(width)) {
        await page.scrollTo('.profile-block');
        await page.screenshot(path.join(out, width + '-' + type.toLowerCase() + '-overview.png'));
        await page.scrollTo('.chart-grid');
        await page.screenshot(path.join(out, width + '-' + type.toLowerCase() + '-charts.png'));
      }
    }
    await page.focus('[data-genre="Action"]');
    await page.key('Enter');
    await page.waitForSelector('#genrePanelTitle');
    check(type + ' genres still open with the keyboard and focus the results', await page.evaluate(() => document.activeElement.id === 'genrePanelTitle' && document.querySelectorAll('.genre-title-row').length > 0));
    await page.key('Escape');
    check(type + ' Escape restores the genre trigger', await page.evaluate(() => !document.querySelector('#genrePanelTitle') && document.activeElement.dataset.genre === 'Action'));
  }
  check('no uncaught browser exceptions', page.events.exceptions.length === 0, page.events.exceptions);
  await fs.writeFile(path.join(out, 'stats-layout-results.json'), JSON.stringify({ chrome: browser.version, total: results.length, failed: results.filter(r => !r.ok).length, results }, null, 2));
  assert.ok(results.every(r => r.ok), 'See stats-layout-results.json');
} finally { await browser.close(); }
