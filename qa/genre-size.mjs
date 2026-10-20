import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-14');
const baseline = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'artifacts', 'acceptance-10', 'compact-before.json'), 'utf8'));
await fs.mkdir(out, { recursive: true });
const browser = await launchChrome();
const page = await browser.newPage();
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name); }
try {
  await page.setReducedMotion(true);
  await page.route('https://graphql.anilist.co', request => {
    const { query, variables } = JSON.parse(request.postData);
    const fixture = baseline.cache['anigraph:v1:cache:' + JSON.stringify([query, variables])] || Object.entries(baseline.cache).find(([key]) => {
      if (!query.includes('UserTitles') || !key.startsWith('anigraph:v1:cache:[')) return false;
      const [q,v] = JSON.parse(key.slice('anigraph:v1:cache:'.length));
      return q.includes('UserTitles') && v.name === variables.name && v.type === variables.type;
    })?.[1];
    assert.ok(fixture, 'Query must have a frozen public-data fixture');
    const data = JSON.parse(fixture).data;
    if (data.MediaListCollection) data.MediaListCollection.hasNextChunk = false;
    return { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ data }) };
  });
  await page.goto('http://127.0.0.1:5174/');
  await page.evaluate(() => { document.querySelector('#statsUsername').value = 'Neartana'; document.querySelector('#statsForm').requestSubmit(); });
  await page.waitForSelector('#statsTitle', { timeout: 30000 });
  for (const type of ['ANIME', 'MANGA']) {
    await page.evaluate(type => document.querySelector('[data-media-type="' + type + '"]').click(), type);
    await page.waitFor(() => document.querySelectorAll('.title-chart-row').length > 0 && !document.querySelector('.chart-loading'), { timeout: 30000 });
    for (const width of [1440, 1224, 985, 768, 390]) {
      await page.setViewport({ width, height: 1050, mobile: width === 390 });
      await sleep(200);
      const size = await page.evaluate(() => {
        const panel = document.querySelector('[data-panel="genres"]');
        const slot = panel.querySelector('.chart-slot');
        return { genre: panel.getBoundingClientRect().height, score: document.querySelector('[data-panel="scores"]').getBoundingClientRect().height,
          rows: panel.querySelectorAll('[data-genre]').length, scrolls: slot.scrollHeight > slot.clientHeight, overflow: getComputedStyle(slot).overflowY,
          fits: document.documentElement.scrollWidth <= innerWidth, values: [...panel.querySelectorAll('svg title')].map(e => e.textContent) };
      });
      const old = baseline.samples.find(s => s.type === type && s.width === width).panels.find(p => p.id === 'genres');
      const formatValues = baseline.samples.find(s => s.type === type && s.width === width).panels.find(p => p.id === 'formats').values.map(v => Number(v.replace(/,/g, '')));
      const expectedShare = (formatValues[0] * 100 / formatValues.reduce((a,b) => a+b, 0)).toFixed(1).replace(/\.0$/, '') + '%';
      check(type + ' ' + width + ' format insight is calculated from every source format', await page.evaluate(expected => document.querySelector('[data-panel="formats"] .chart-insight strong')?.textContent === expected, expectedShare));
      check(type + ' ' + width + ' division controls meet 44px touch height', await page.evaluate(() => [...document.querySelectorAll('.switch-btn')].every(e => e.getBoundingClientRect().height >= 44)));
      check(type + ' ' + width + ' genre card matches score height', Math.abs(size.genre - size.score) < 3, size);
      check(type + ' ' + width + ' all ten rows and values remain scrollable without page overflow', size.rows === 10 && size.scrolls && size.overflow === 'auto' && size.fits && JSON.stringify(size.values) === JSON.stringify(old.tooltips));
      const layout = await page.evaluate(() => {
        const panels = [...document.querySelectorAll('.chart-grid > [data-panel]')].map(e => {
          const r = e.getBoundingClientRect(); return { id: e.dataset.panel, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, radius: parseFloat(getComputedStyle(e).borderRadius) };
        });
        const genre = document.querySelector('[data-panel="genres"]');
        return { panels, font: parseFloat(getComputedStyle(genre.querySelector('.chart-row-label')).fontSize), metricFont: parseFloat(getComputedStyle(genre.querySelector('.chart-value-label')).fontSize),
          scrollbar: getComputedStyle(genre.querySelector('.chart-slot')).scrollbarWidth,
          scrollbarColor: getComputedStyle(genre.querySelector('.chart-slot')).scrollbarColor,
          dividers: [...document.querySelectorAll('.panel-head,.summary-cell,.record-head,.view-tab,.ann-news-item')].map(e => getComputedStyle(e).borderBottomWidth) };
      });
      check(type + ' ' + width + ' genres use smaller readable type and a themed thin scrollbar', layout.font === 12 && layout.metricFont === 11 && layout.scrollbar === 'thin' && layout.scrollbarColor.includes('rgb(139, 155, 176)'), layout);
      check(type + ' ' + width + ' panels have soft corners and decorative dividers are removed', layout.panels.every(p => p.radius >= 6) && layout.dividers.every(v => v === '0px'));
      check(type + ' ' + width + ' stat panels never overlap', layout.panels.every((a, i) => layout.panels.slice(i + 1).every(b => Math.min(a.right, b.right) - Math.max(a.x, b.x) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) <= 1)));
      if (width > 900) {
        check(type + ' ' + width + ' paired cards share their top and bottom edges', [['scores', 'genres'], ['statuses', 'releaseYears'], ['formats', 'startYears']].every(ids => {
          const a = layout.panels.find(p => p.id === ids[0]), b = layout.panels.find(p => p.id === ids[1]);
          return Math.abs(a.y - b.y) < 1 && Math.abs(a.bottom - b.bottom) < 1 && Math.abs(a.width - b.width) < 1;
        }));
      }
      await page.focus('[data-genre]:first-of-type');
      for (let i = 0; i < 9; i++) await page.key('Tab');
      const last = await page.evaluate(() => {
        const row = document.activeElement, r = row.getBoundingClientRect(), slot = row.closest('.chart-slot'), s = slot.getBoundingClientRect();
        return { name: row.dataset.genre, last: row === document.querySelector('[data-panel="genres"] [data-genre]:last-of-type'), visible: r.top >= s.top && r.bottom <= s.bottom, scroll: slot.scrollTop };
      });
      check(type + ' ' + width + ' Tab scrolls the final genre into view', last.last && last.visible && last.scroll > 0, last);
      const heading = await page.evaluate(() => {
        const head = document.querySelector('.genre-chart-columns').getBoundingClientRect(), slot = document.querySelector('[data-panel="genres"] .chart-slot').getBoundingClientRect();
        return { top: head.top, bottom: head.bottom, slotTop: slot.top, text: document.querySelector('.genre-chart-columns').textContent };
      });
      check(type + ' ' + width + ' genre headings remain visible while scrolling', heading.top >= heading.slotTop && heading.bottom <= heading.slotTop + 30 && heading.text === 'GenreEntriesMean /100', heading);
      await page.screenshot(path.join(out, width + '-' + type.toLowerCase() + '-scrolled-genres.png'));
      await page.key('Enter');
      await page.waitForSelector('#genrePanelTitle');
      check(type + ' ' + width + ' scrolled genre opens', await page.evaluate(name => document.querySelector('#genrePanelTitle').textContent === name, last.name));
      await page.key('Escape');
      check(type + ' ' + width + ' Escape restores visible genre focus', await page.evaluate(() => {
        const row = document.activeElement, r = row.getBoundingClientRect(), s = row.closest('.chart-slot').getBoundingClientRect();
        return !!row.dataset.genre && r.top >= s.top && r.bottom <= s.bottom;
      }));
      for (let i = 0; i < 9; i++) {
        await page.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }, page.sessionId);
        await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }, page.sessionId);
      }
      check(type + ' ' + width + ' reverse Tab keeps the first genre below its sticky headings', await page.evaluate(() => {
        const row = document.activeElement, first = document.querySelector('[data-genre]'), head = document.querySelector('.genre-chart-columns').getBoundingClientRect();
        return row === first && row.getBoundingClientRect().top >= head.bottom - 1;
      }));
      await page.evaluate(() => { document.activeElement.blur(); document.querySelector('[data-panel="genres"] .chart-slot').scrollTop = 0; window.scrollTo(0, window.scrollY + document.querySelector('.record-head').getBoundingClientRect().top - 12); });
      await page.screenshot(path.join(out, width + '-' + type.toLowerCase() + '-genres.png'));
    }
  }
  check('no uncaught exceptions', page.events.exceptions.length === 0, page.events.exceptions);
  await fs.writeFile(path.join(out, 'genre-style-results.json'), JSON.stringify({ chrome: browser.version, total: results.length, failed: results.filter(r => !r.ok).length, results }, null, 2));
  assert.ok(results.every(r => r.ok), 'See genre-style-results.json');
} finally { await browser.close(); }
