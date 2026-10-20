// qa/acceptance.mjs - Acceptance suite for Anigraph (real browser evidence, no app edits).
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchChrome, serveDir, fileUrl, sleep } from './cdp.mjs';

const here = import.meta.dirname;
const repo = path.resolve(here, '..');
const artifacts = path.join(here, 'artifacts', 'acceptance-20');
const results = [];
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const want = (n) => !only || only.has(String(n));
let currentItem = '0';
const state = {};

function check (name, ok, detail) {
  const record = { item: currentItem, name, ok: !!ok, detail: detail === undefined ? '' : String(detail) };
  results.push(record);
  console.log((ok ? 'PASS ' : 'FAIL ') + '[' + currentItem + '] ' + name + (record.detail ? '  [' + record.detail + ']' : ''));
}
function item (n) { currentItem = String(n); }
async function shot (page, name, opts) {
  const file = path.join(artifacts, name + '.png');
  await page.screenshot(file, opts);
  return file;
}
function js (page, fn, ...args) { return page.evaluate(fn, ...args); }
async function clickSel (page, selector) {
  return js(page, (sel) => { const el = document.querySelector(sel); if (!el) return false; if (typeof el.click === 'function') el.click(); else el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, selector);
}
async function setInput (page, selector, value) {
  return js(page, (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, selector, value);
}
async function submitForm (page, selector) {
  return js(page, (sel) => { const form = document.querySelector(sel); if (!form) return false; form.requestSubmit(); return true; }, selector);
}
async function setSelect (page, key, value) {
  return js(page, (filter, val) => {
    const select = document.querySelector('[data-genre-filter="' + filter + '"]');
    if (!select || ![...select.options].some((option) => option.value === val)) return false;
    select.value = val;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, key, value);
}
async function genreRows (page) {
  return js(page, () => [...document.querySelectorAll('#genreDrilldown .genre-title-row')].map((row) => ({ id: Number(row.dataset.mediaId), text: row.textContent.replace(/\s+/g, ' ').trim() })));
}
async function cachedTitles (page, type) {
  return js(page, (division) => {
    const cached = Object.entries(sessionStorage).filter(([key]) => {
      if (!key.startsWith('anigraph:v1:cache:')) return false;
      try { const [query, vars] = JSON.parse(key.slice('anigraph:v1:cache:'.length)); return query.includes('query UserTitles') && vars.type === division; } catch { return false; }
    });
    return cached.flatMap(([, value]) => (JSON.parse(value).data.MediaListCollection?.lists || []).flatMap((list) => list.entries || []));
  }, type);
}
function expectedGenreEntries (raw, genre) {
  const byId = new Map();
  for (const entry of raw) {
    if (!entry?.media?.id) continue;
    const existing = byId.get(entry.media.id);
    if (!existing || entry.progress > existing.progress) byId.set(entry.media.id, entry);
  }
  return [...byId.values()].filter((entry) => entry.media.genres?.includes(genre));
}
function sortedGenreIds (entries, sort = 'PROGRESS') {
  const title = (entry) => entry.media.title.romaji || entry.media.title.english || entry.media.title.native || 'Untitled';
  return [...entries].sort((a, b) => {
    const tie = title(a).localeCompare(title(b));
    if (sort === 'TITLE') return tie;
    if (sort === 'YEAR') return (b.media.startDate?.year || 0) - (a.media.startDate?.year || 0) || tie;
    return b.progress - a.progress || tie;
  }).map((entry) => entry.media.id);
}
async function checkGenreNetwork (page, label) {
  const consoleErrors = page.events.consoleErrors.filter((entry) => !/status of 404|favicon/i.test(entry.text || ''));
  const origins = [...new Set(page.events.requests.map((request) => new URL(request.url).origin))];
  const allowed = new Set([server.origin, 'https://graphql.anilist.co', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  const unexpected = origins.filter((origin) => !allowed.has(origin) && !/^https:\/\/[^/]*anilist\.co$/.test(origin));
  check(label + ': no console errors or uncaught exceptions', consoleErrors.length === 0 && page.events.exceptions.length === 0, JSON.stringify({ consoleErrors, exceptions: page.events.exceptions }));
  check(label + ': no new external origins', unexpected.length === 0, origins.join(' '));
  const failed = page.events.failed.filter((entry) => !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(entry.url || ''));
  check(label + ': no failed app/API requests', failed.length === 0, JSON.stringify(failed));
  await fs.writeFile(path.join(artifacts, label + '-network.json'), JSON.stringify({ consoleErrors: page.events.consoleErrors, exceptions: page.events.exceptions, origins, failed: page.events.failed, requests: page.events.requests }, null, 2));
}
async function rect (page, selector) {
  return js(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, centerX: r.x + r.width / 2, centerY: r.y + r.height / 2, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  }, selector);
}
async function count (page, selector) {
  return js(page, (sel) => document.querySelectorAll(sel).length, selector);
}
async function text (page, selector) {
  return js(page, (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }, selector);
}
async function layout (page) {
  return js(page, () => {
    const out = {};
    for (const row of ['S', 'A', 'B', 'C', 'D', 'pool']) {
      out[row] = [...document.querySelectorAll('[data-drop-tier="' + row + '"] .char-card')].map((card) => Number(card.getAttribute('data-char-id')));
    }
    return out;
  });
}
async function waitText (page, selector, needle, timeout) {
  return page.waitFor((sel, textNeedle) => {
    const el = document.querySelector(sel);
    return !!el && (el.textContent || '').includes(textNeedle);
  }, { args: [selector, needle], timeout: timeout || 25000, label: selector + ' includes ' + needle });
}
async function waitCount (page, selector, min, timeout) {
  return page.waitFor((sel, n) => document.querySelectorAll(sel).length >= n, { args: [selector, min], timeout: timeout || 30000, label: selector + ' >= ' + min });
}
async function waitGone (page, selector, timeout) {
  return page.waitFor((sel) => !document.querySelector(sel), { args: [selector], timeout: timeout || 15000, label: selector + ' gone' });
}
async function viewportState (page) {
  return js(page, () => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, docWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
}
function parseColor (value) {
  const match = String(value || '').match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => parseFloat(part));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
}
function luminance (color) {
  const channels = [color.r, color.g, color.b].map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrastRatio (fg, bg) {
  const foreground = parseColor(fg);
  const background = parseColor(bg);
  if (!foreground || !background) return -1;
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const CORS_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type,accept', 'access-control-expose-headers': 'Retry-After' };
const PREFLIGHT = { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type,accept', 'access-control-expose-headers': 'Retry-After' }, body: '' };

async function mockPrivate (page) {
  await page.route('*graphql.anilist.co*', (request) => {
    if (request.method === 'OPTIONS') return PREFLIGHT;
    if (String(request.postData || '').includes('UserStats')) {
      return { status: 200, headers: CORS_HEADERS, body: JSON.stringify({ data: { User: { id: 999999, name: 'sealed', avatar: { medium: null }, statistics: null } } }) };
    }
    return null;
  });
}
async function mockRateLimit (page, seconds) {
  await page.route('*graphql.anilist.co*', (request) => {
    if (request.method === 'OPTIONS') return PREFLIGHT;
    if (String(request.postData || '').includes('UserStats')) {
      return { status: 429, headers: { ...CORS_HEADERS, 'retry-after': String(seconds) }, body: JSON.stringify({ errors: [{ message: 'Too Many Requests', status: 429 }] }) };
    }
    return null;
  });
}

async function waitTitlesReady (page, unit, needle, timeout) {
  return page.waitFor((u, textNeedle) => {
    const panel = document.querySelector('[data-panel="titles"]');
    if (!panel) return false;
    const aria = panel.getAttribute('aria-label') || '';
    const rendered = panel.querySelectorAll('.chart-title-label').length;
    return rendered >= 1 && aria.indexOf('Top titles by ' + u + ':') === 0 && aria.indexOf(textNeedle) !== -1;
  }, { args: [unit, needle], timeout: timeout || 20000, label: 'titles ' + unit + ' ready (' + needle + ')' });
}

async function panelSnapshot (page) {
  return js(page, () => {
    const panels = [...document.querySelectorAll('[data-panel]')];
    return panels.map((panel) => ({
      id: panel.getAttribute('data-panel'),
      label: panel.getAttribute('aria-label') || '',
      classes: panel.className,
      frame: panel.querySelector('.panel-frame') ? panel.querySelector('.panel-frame').textContent.trim() : null,
      svgs: panel.querySelectorAll('svg.chart-svg').length,
      svgTitles: panel.querySelectorAll('svg title').length,
      rowTooltips: [...panel.querySelectorAll('.title-chart-row[title]')].map((row) => row.getAttribute('title')),
      bars: panel.querySelectorAll('.chart-bar, .title-progress-track').length,
      empty: !!panel.querySelector('.chart-empty'),
      emptyText: panel.querySelector('.chart-empty-text') ? panel.querySelector('.chart-empty-text').textContent.trim() : null,
      loading: !!panel.querySelector('.chart-loading'),
      titleLabels: [...panel.querySelectorAll('.chart-title-label')].map((el) => el.textContent),
      valueLabels: [...panel.querySelectorAll('.chart-value-label')].map((el) => el.textContent)
    }));
  });
}

async function minimalCopySnapshot (page) {
  return js(page, () => {
    const text = document.body.innerText.replace(/\s+/g, ' ');
    const removedSelectors = {};
    for (const selector of ['.protocol', '.profile-meta', '.record-meta', '.tier-empty', '.chart-empty-hint', '.command-hint', '.switch-caption', '.station-tail', '.brand-jp', '.footer-note', '.board-caption']) {
      removedSelectors[selector] = document.querySelectorAll(selector).length;
    }
    return {
      removedSelectors,
      removedText: ['CACHE 05:00', 'アニグラフ', 'FAN-MADE', 'Enter submits', '300ms debounce', 'PUBLIC ANILIST RECORD', 'LAST SYNC', 'RECORD / 000', 'DROP A CARD HERE', 'CAST INDEX', 'LIVE DRAFT', 'TIER BOARD /'].filter((needle) => text.indexOf(needle) !== -1),
      labels: [...document.querySelectorAll('label.spec-label')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      recordTitle: document.querySelector('.record-title') ? document.querySelector('.record-title').textContent.trim() : null,
      commandLabel: document.querySelector('.command-label') ? document.querySelector('.command-label').innerText.replace(/\s+/g, ' ').trim() : null
    };
  });
}

async function paletteSnapshot (page) {
  return js(page, () => {
    const root = getComputedStyle(document.documentElement);
    const panel = document.querySelector('.panel');
    const primary = document.querySelector('.btn-primary');
    return {
      vars: { ink: root.getPropertyValue('--ink').trim(), panel: root.getPropertyValue('--panel').trim(), rule: root.getPropertyValue('--rule').trim(), paper: root.getPropertyValue('--paper').trim(), muted: root.getPropertyValue('--muted').trim(), accent: root.getPropertyValue('--accent').trim(), violet: root.getPropertyValue('--violet').trim() },
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      panelBackground: panel ? getComputedStyle(panel).backgroundColor : null,
      primaryBackground: primary ? getComputedStyle(primary).backgroundColor : null
    };
  });
}

async function bannerSnapshot (page) {
  return js(page, () => {
    const banner = document.querySelector('.profile-banner');
    const image = banner ? banner.querySelector('img') : null;
    const rect = banner ? banner.getBoundingClientRect() : null;
    return {
      present: !!banner,
      height: rect ? Math.round(rect.height * 100) / 100 : null,
      width: rect ? Math.round(rect.width) : null,
      src: image ? image.src : null,
      naturalWidth: image ? image.naturalWidth : 0,
      naturalHeight: image ? image.naturalHeight : 0,
      imgHeight: image ? Math.round(image.getBoundingClientRect().height * 100) / 100 : null,
      imgWidth: image ? image.getBoundingClientRect().width : 0,
      docWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  });
}

async function item1 (page) {
  item(1);
  const requestIndex = page.events.requests.length;
  await setInput(page, '#statsUsername', 'derF');
  await submitForm(page, '#statsForm');
  await sleep(120);
  const loading = await js(page, () => ({ skeletons: document.querySelectorAll('.skeleton').length, spinners: document.querySelectorAll('.spinner, [role="progressbar"], .loading-spinner').length, busy: document.getElementById('viewStats').getAttribute('aria-busy') }));
  check('loading state uses skeletons only (no spinner)', loading.skeletons > 0 && loading.spinners === 0, JSON.stringify(loading));
  await waitCount(page, '.panel[data-panel]', 7, 30000);
  await waitTitlesReady(page, 'episodes', 'ONE PIECE 611');
  await sleep(500);

  const summary = await js(page, () => [...document.querySelectorAll('.summary-strip .summary-value')].map((el) => el.textContent.trim()));
  check('derF anime summary: 1,088 / 73.37 / 15,162 / 249.5', JSON.stringify(summary) === JSON.stringify(['1,088', '73.37', '15,162', '249.5']), JSON.stringify(summary));

  const panels = await panelSnapshot(page);
  check('seven stats panels render', panels.length === 7, panels.map((panel) => panel.id).join(','));
  check('panels retain all seven chart IDs in order without decorative frame captions', JSON.stringify(panels.map((panel) => panel.id)) === JSON.stringify(['scores', 'statuses', 'formats', 'genres', 'releaseYears', 'startYears', 'titles']) && panels.every((panel) => panel.frame === null), panels.map((panel) => panel.id + ':' + panel.frame).join(' '));
  const titlesPanel = panels.find((panel) => panel.id === 'titles');
  check('TOP TITLES panel is span-12 and titled by division', !!titlesPanel && titlesPanel.classes.includes('span-12') && titlesPanel.titleLabels.length === 8 && titlesPanel.bars === 8, titlesPanel ? JSON.stringify({ classes: titlesPanel.classes, rows: titlesPanel.titleLabels.length, bars: titlesPanel.bars }) : null);
  const expectedTitles = ['ONE PIECE', 'BLEACH', 'Meitantei Conan'];
  const expectedProgress = ['611', '366 / 366', '359'];
  check('derF anime top titles: ONE PIECE 611, BLEACH 366, Meitantei Conan 359', JSON.stringify(titlesPanel && titlesPanel.titleLabels.slice(0, 3)) === JSON.stringify(expectedTitles) && JSON.stringify(titlesPanel && titlesPanel.valueLabels.slice(0, 3)) === JSON.stringify(expectedProgress), JSON.stringify({ titles: titlesPanel && titlesPanel.titleLabels.slice(0, 3), values: titlesPanel && titlesPanel.valueLabels.slice(0, 3) }));
  check('TOP TITLES aria-label summarizes real progress', /^Top titles by episodes: ONE PIECE 611 episodes, BLEACH 366 episodes, Meitantei Conan 359 episodes\.$/.test(titlesPanel ? titlesPanel.label : ''), titlesPanel && titlesPanel.label);
  check('TOP TITLES keeps a descriptive tooltip per artwork row', !!titlesPanel && titlesPanel.rowTooltips.length === 8 && titlesPanel.rowTooltips.every((value) => /episodes/.test(value)), titlesPanel && JSON.stringify(titlesPanel.rowTooltips));

  const emptyPanels = panels.filter((panel) => panel.empty).map((panel) => panel.id);
  check('start-years empty state (variable SVG count)', JSON.stringify(emptyPanels) === JSON.stringify(['startYears']) && panels.find((panel) => panel.id === 'startYears').emptyText === 'No start years.', JSON.stringify(emptyPanels));
  const nonEmpty = panels.filter((panel) => !panel.empty);
  check('non-empty aggregate charts render one SVG; top titles use semantic artwork rows', nonEmpty.length === 6 && nonEmpty.every((panel) => panel.id === 'titles' ? panel.svgs === 0 && panel.rowTooltips.length === 8 : panel.svgs === 1), JSON.stringify(nonEmpty.map((panel) => panel.id + ':' + panel.svgs)));
  check('panels carry summary aria-labels', panels.every((panel) => panel.label.length > 15), panels.map((panel) => panel.id + ':' + panel.label.length).join(' '));
  check('aggregate SVG charts include <title> elements', nonEmpty.filter((panel) => panel.id !== 'titles').every((panel) => panel.svgTitles > 0), panels.map((panel) => panel.id + ':' + panel.svgTitles).join(' '));
  const axisSize = await js(page, () => { const el = document.querySelector('.chart-axis-label'); return el ? getComputedStyle(el).fontSize : null; });
  check('chart axis label font size is at least 11px', parseFloat(axisSize) >= 11, axisSize);

  const colors = await js(page, () => {
    const value = document.querySelector('.summary-value');
    const label = document.querySelector('.summary-label');
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    return { valueColor: getComputedStyle(value).color, labelColor: getComputedStyle(label).color, bodyBg, htmlBg };
  });
  const bg = /rgba\(0, 0, 0, 0\)/.test(colors.bodyBg) ? colors.htmlBg : colors.bodyBg;
  const valueContrast = contrastRatio(colors.valueColor, bg);
  const labelContrast = contrastRatio(colors.labelColor, bg);
  check('summary contrast AA (value >= 4.5, label >= 4.5)', valueContrast >= 4.5 && labelContrast >= 4.5, JSON.stringify({ value: Number(valueContrast.toFixed(2)), label: Number(labelContrast.toFixed(2)), bg }));

  const posts = page.events.requests.slice(requestIndex).filter((request) => request.method === 'POST' && request.url.includes('graphql.anilist.co'));
  const statsPosts = posts.filter((request) => String(request.postData || '').includes('query UserStats'));
  const titlesPosts = posts.filter((request) => String(request.postData || '').includes('query UserTitles'));
  check('stats load shares paginated collection queries without per-title operations', posts.length === statsPosts.length + titlesPosts.length && statsPosts.length === 1 && titlesPosts.length >= 1 && titlesPosts.every((r,i) => JSON.parse(r.postData).variables.chunk === i + 1), JSON.stringify(posts.map((request) => (String(request.postData || '').match(/query (UserStats|UserTitles)/) || ['?'])[0])));

  const palette = await paletteSnapshot(page);
  const expectedVars = { ink: '#0A121E', panel: '#101B2A', rule: '#223248', paper: '#F2F5F8', muted: '#8B9BB0', accent: '#3DB4F2', violet: '#8CA8FF' };
  check('AniList-blue palette variables', JSON.stringify(palette.vars) === JSON.stringify(expectedVars), JSON.stringify(palette.vars));
  check('body / panel / primary button use blue palette', palette.bodyBackground === 'rgb(10, 18, 30)' && palette.panelBackground === 'rgb(16, 27, 42)' && palette.primaryBackground === 'rgb(61, 180, 242)', JSON.stringify({ body: palette.bodyBackground, panel: palette.panelBackground, primary: palette.primaryBackground }));

  const copy = await minimalCopySnapshot(page);
  check('minimal copy: old helper text/selectors removed', Object.values(copy.removedSelectors).every((count) => count === 0) && copy.removedText.length === 0, JSON.stringify({ selectors: copy.removedSelectors, text: copy.removedText }));
  check('minimal copy: new stats labels', copy.commandLabel === 'ANILIST USERNAME' && copy.recordTitle === 'Statistics', JSON.stringify({ commandLabel: copy.commandLabel, recordTitle: copy.recordTitle }));
  check('derF has no profile banner', (await bannerSnapshot(page)).present === false);

  await shot(page, '1440-stats-loaded', { fullPage: true });

  const mangaIndex = page.events.requests.length;
  await clickSel(page, '[data-media-type="MANGA"]');
  await waitTitlesReady(page, 'chapters', 'Inuyasha 558');
  await sleep(500);
  const mangaSummary = await js(page, () => [...document.querySelectorAll('.summary-strip .summary-value')].map((el) => el.textContent.trim()));
  check('derF manga summary: 732 / 77.76 / 20,194 / 3,073', JSON.stringify(mangaSummary) === JSON.stringify(['732', '77.76', '20,194', '3,073']), JSON.stringify(mangaSummary));
  const mangaPanels = await panelSnapshot(page);
  const mangaTitles = mangaPanels.find((panel) => panel.id === 'titles');
  check('derF manga top titles: Inuyasha 558, Dragon Ball 520, Katekyo Hitman REBORN! 409', /^Top titles by chapters: Inuyasha 558 chapters, Dragon Ball 520 chapters, Katekyo Hitman REBORN! 409 chapters\.$/.test(mangaTitles ? mangaTitles.label : '') && mangaTitles.titleLabels.length === 8 && JSON.stringify(mangaTitles.valueLabels.slice(0, 3)) === JSON.stringify(['558 / 558', '520 / 520', '409 / 411']), JSON.stringify({ aria: mangaTitles && mangaTitles.label, values: mangaTitles && mangaTitles.valueLabels.slice(0, 3) }));
  check('MANGA division fires its own titles query', page.events.requests.slice(mangaIndex).some((request) => request.method === 'POST' && String(request.postData || '').includes('query UserTitles') && String(request.postData || '').includes('MANGA')), JSON.stringify(page.events.requests.slice(mangaIndex).filter((request) => request.method === 'POST').map((request) => (String(request.postData || '').match(/query (UserStats|UserTitles)/) || ['?'])[0] + ':' + (/MANGA/.test(String(request.postData || '')) ? 'MANGA' : 'ANIME'))));
  const mangaPanelData = await panelSnapshot(page);
  check('manga keeps seven panels and start-years empty', mangaPanelData.length === 7 && mangaPanelData.filter((panel) => panel.empty).map((panel) => panel.id).join(',') === 'startYears', JSON.stringify(mangaPanelData.map((panel) => panel.id + ':' + (panel.empty ? 'empty' : 'svg'))));

  await clickSel(page, '[data-media-type="ANIME"]');
  await sleep(500);
  check('toggle back to anime summary', (await text(page, '.summary-strip .summary-value')) === '1,088', await text(page, '.summary-strip .summary-value'));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  await shot(page, '390-stats-loaded', { fullPage: true });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);

  await clickSel(page, '[data-media-type="MANGA"]');
  await sleep(350);
  await page.reload();
  await page.waitForSelector('#statsForm', { timeout: 20000 });
  await sleep(500);
  const restored = await js(page, () => ({ username: document.getElementById('statsUsername') ? document.getElementById('statsUsername').value : null, manga: document.querySelector('[data-media-type="MANGA"]') ? document.querySelector('[data-media-type="MANGA"]').getAttribute('aria-pressed') : null, statsVisible: document.getElementById('viewStats').hidden === false }));
  check('same-URL reload restores username + division', restored.username === 'derF' && restored.manga === 'true' && restored.statsVisible === true, JSON.stringify(restored));
  await clickSel(page, '[data-media-type="ANIME"]');
  await sleep(300);

  // Banner: matchai has a real banner, derF does not.
  await setInput(page, '#statsUsername', 'matchai');
  await submitForm(page, '#statsForm');
  await waitCount(page, '.panel[data-panel]', 7, 30000);
  await waitTitlesReady(page, 'episodes', 'Dragon Ball Z 291');
  await sleep(700);
  const banner1440 = await bannerSnapshot(page);
  check('matchai banner preserves its natural image aspect at 1440', banner1440.present && banner1440.naturalWidth > 0 && Math.abs(banner1440.imgHeight - banner1440.imgWidth * banner1440.naturalHeight / banner1440.naturalWidth) < 1 && Math.abs(banner1440.height - banner1440.imgHeight) <= 3, JSON.stringify(banner1440));
  check('banner image comes from s4.anilist.co and loads', !!banner1440.src && /^https:\/\/s4\.anilist\.co\//.test(banner1440.src) && banner1440.naturalWidth > 0, JSON.stringify({ src: banner1440.src, natural: banner1440.naturalWidth + 'x' + banner1440.naturalHeight }));
  check('banner causes no page overflow at 1440', banner1440.docWidth <= banner1440.innerWidth + 1, JSON.stringify({ docWidth: banner1440.docWidth, innerWidth: banner1440.innerWidth }));
  const bannerPaint = await js(page, () => {
    const banner = document.querySelector('.profile-banner');
    if (!banner) return null;
    const img = banner.querySelector('img');
    const fallback = banner.querySelector('.img-fallback');
    if (!img || !fallback) return { missing: true };
    const imgStyle = getComputedStyle(img);
    const fallbackStyle = getComputedStyle(fallback);
    return {
      imgPosition: imgStyle.position,
      imgZIndex: imgStyle.zIndex,
      imgBroken: img.classList.contains('is-broken'),
      fallbackPosition: fallbackStyle.position,
      fallbackZIndex: fallbackStyle.zIndex,
      fallbackDisplay: fallbackStyle.display,
      fallbackPaintsAbove: fallbackStyle.display !== 'none' && fallbackStyle.position !== 'static' && imgStyle.position === 'static'
    };
  });
  check('banner image paints above fallback overlay', !!bannerPaint && bannerPaint.fallbackPaintsAbove === false, JSON.stringify(bannerPaint));
  const bannerRect = await rect(page, '.profile-banner');
  if (bannerRect) {
    const clip = await page.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: bannerRect.x, y: bannerRect.y, width: bannerRect.width, height: bannerRect.height, scale: 1 } }, page.sessionId);
    await fs.writeFile(path.join(artifacts, 'banner-1440-clip.png'), Buffer.from(clip.data, 'base64'));
  }
  const matchaiSummary = await js(page, () => [...document.querySelectorAll('.summary-strip .summary-value')].map((el) => el.textContent.trim()));
  check('matchai anime summary loads (258 titles)', matchaiSummary[0] === '258', JSON.stringify(matchaiSummary));
  await shot(page, '1440-banner-matchai');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const banner390 = await bannerSnapshot(page);
  check('matchai banner preserves its natural image aspect at 390', banner390.present && banner390.naturalWidth > 0 && Math.abs(banner390.imgHeight - banner390.imgWidth * banner390.naturalHeight / banner390.naturalWidth) < 1 && Math.abs(banner390.height - banner390.imgHeight) <= 3, JSON.stringify(banner390));
  check('banner causes no page overflow at 390', banner390.docWidth <= banner390.innerWidth + 1 && banner390.imgWidth <= banner390.width + 1, JSON.stringify({ docWidth: banner390.docWidth, innerWidth: banner390.innerWidth, imgHeight: banner390.imgHeight }));
  await shot(page, '390-banner-matchai');
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
}

async function item2 (page) {
  item(2);
  await setInput(page, '#statsUsername', 'qa-no-such-user-83741');
  await submitForm(page, '#statsForm');
  await waitText(page, '.state-title', 'No such profile.', 20000);
  const notFound = await js(page, () => ({ title: document.querySelector('.state-title') ? document.querySelector('.state-title').textContent.trim() : null, action: document.querySelector('.state .btn-primary') ? document.querySelector('.state .btn-primary').textContent.trim() : null, code: document.querySelector('.state-kicker') ? document.querySelector('.state-kicker').textContent.trim() : null }));
  check('unknown user: "No such profile." + EDIT USERNAME', notFound.title === 'No such profile.' && notFound.action === 'EDIT USERNAME', JSON.stringify(notFound));
  await shot(page, '1440-state-notfound');
  await clickSel(page, '.state [data-action="focus-stats"]');
  await sleep(200);
  check('unknown user action focuses username field', (await js(page, () => document.activeElement ? document.activeElement.id : '')) === 'statsUsername', await js(page, () => document.activeElement ? document.activeElement.id : ''));
  await js(page, () => sessionStorage.clear());
  await mockPrivate(page);
  await setInput(page, '#statsUsername', 'derF');
  await submitForm(page, '#statsForm');
  await waitText(page, '.state-title', 'This record is sealed.', 20000);
  const privateState = await js(page, () => ({ title: document.querySelector('.state-title').textContent.trim(), action: document.querySelector('.state .btn-primary') ? document.querySelector('.state .btn-primary').textContent.trim() : null }));
  check('mocked private profile: "This record is sealed." + RETRY', privateState.title === 'This record is sealed.' && privateState.action === 'RETRY', JSON.stringify(privateState));
  await shot(page, '1440-state-private');
  await js(page, () => sessionStorage.clear());
  await page.clearRoutes();
  await clickSel(page, '.state [data-action="retry-stats"]');
  await page.waitForSelector('.panel[data-panel]', { timeout: 30000 });
  check('private RETRY recovers with real API', true);
  await js(page, () => sessionStorage.clear());
  await mockRateLimit(page, 5);
  await setInput(page, '#statsUsername', 'derF');
  await submitForm(page, '#statsForm');
  await waitText(page, '.state-title', 'Signal throttled.', 20000);
  const rateState = await js(page, () => ({ countdown: document.querySelector('[data-rate-countdown]') ? document.querySelector('[data-rate-countdown]').textContent.trim() : null, disabled: document.querySelector('[data-rate-button]') ? document.querySelector('[data-rate-button]').disabled : null, label: document.querySelector('.state .btn-primary') ? document.querySelector('.state .btn-primary').textContent.trim() : null }));
  check('mocked 429: "Signal throttled.", countdown, disabled retry', rateState.disabled === true && /^\d\d:\d\d$/.test(rateState.countdown || '') && /^RETRY IN/.test(rateState.label || ''), JSON.stringify(rateState));
  await shot(page, '1440-state-429');
  await page.waitFor(() => { const button = document.querySelector('[data-rate-button]'); return button && !button.disabled; }, { timeout: 15000, label: 'rate countdown reaches zero' });
  const enabled = await js(page, () => ({ disabled: document.querySelector('[data-rate-button]') ? document.querySelector('[data-rate-button]').disabled : null, label: document.querySelector('[data-rate-button]') ? document.querySelector('[data-rate-button]').textContent.trim() : null, countdown: document.querySelector('[data-rate-countdown]') ? document.querySelector('[data-rate-countdown]').textContent.trim() : null }));
  check('429 retry enables at countdown zero', enabled.disabled === false && enabled.label === 'RETRY RECORD', JSON.stringify(enabled));
  await page.clearRoutes();
  await clickSel(page, '.state [data-action="retry-stats"]');
  await page.waitForSelector('.panel[data-panel]', { timeout: 30000 });
  check('429 RETRY recovers with real API', true);
  await js(page, () => sessionStorage.clear());
  await page.setOffline(true);
  await setInput(page, '#statsUsername', 'derF');
  await submitForm(page, '#statsForm');
  await waitText(page, '.state-title', 'Feed unreachable.', 20000);
  const offlineState = await js(page, () => ({ title: document.querySelector('.state-title').textContent.trim(), action: document.querySelector('.state .btn-primary') ? document.querySelector('.state .btn-primary').textContent.trim() : null }));
  check('offline: "Feed unreachable." + RETRY', offlineState.title === 'Feed unreachable.' && offlineState.action === 'RETRY', JSON.stringify(offlineState));
  await shot(page, '1440-state-offline');
  await page.setOffline(false);
  await clickSel(page, '.state [data-action="retry-stats"]');
  await page.waitForSelector('.panel[data-panel]', { timeout: 30000 });
  check('offline RETRY recovers when network is back', true);
}

async function item3 (page) {
  item(3);
  await clickSel(page, '[data-view-target="tiers"]');
  await page.waitForSelector('#tierSearchInput', { timeout: 10000 });
  await js(page, () => { const input = document.getElementById('tierSearchInput'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); });
  const requestIndex = page.events.requests.length;
  for (const char of 'Frieren') { await page.insertText(char); await sleep(70); }
  await page.waitForSelector('.media-card', { timeout: 25000 });
  await sleep(1500);
  const posts = page.events.requests.slice(requestIndex).filter((request) => request.method === 'POST' && request.url.includes('graphql.anilist.co'));
  const cards = await js(page, () => [...document.querySelectorAll('.media-card')].map((card) => ({ id: card.getAttribute('data-media-id'), label: (card.getAttribute('aria-label') || '').trim(), img: card.querySelector('img') ? card.querySelector('img').src : '' })));
  check('300ms debounce: one GraphQL search request for typed query', posts.length === 1, posts.length + ' POSTs');
  check('search shows real Frieren results', cards.length > 0 && /Frieren/i.test(cards[0].label), cards.length + ' cards: ' + (cards[0] && cards[0].label));
  const coversLoaded = await page.waitFor(() => { const images = [...document.querySelectorAll('.media-card img')]; return images.length > 0 && images.slice(0, 3).every((image) => image.complete && image.naturalWidth > 0); }, { timeout: 20000, label: 'covers loaded' }).then(() => true).catch(() => false);
  check('real AniList covers load', coversLoaded && cards.length > 0 && cards[0].img.includes('anilist.co'), cards[0] && cards[0].img);
  await clickSel(page, '.media-card');
  await page.waitForSelector('.board-title', { timeout: 10000 });
  await waitCount(page, '.char-card', 25, 35000);
  await sleep(400);
  const loaded = await js(page, () => ({ total: document.querySelectorAll('.char-card').length, pool: document.querySelectorAll('[data-drop-tier="pool"] .char-card').length, cast: document.querySelector('[data-board-cast-count]') ? document.querySelector('[data-board-cast-count]').textContent : null, title: document.querySelector('.board-title') ? document.querySelector('.board-title').textContent : null }));
  check('opening first title auto-loads 25 characters', loaded.pool === 25 && loaded.total === 25, JSON.stringify(loaded));
  const steps = [];
  for (let index = 0; index < 5; index += 1) {
    const button = await js(page, () => { const el = document.querySelector('[data-action="load-more"]'); return el ? { disabled: el.disabled, label: el.textContent.trim() } : null; });
    if (!button || button.disabled) break;
    const before = await count(page, '.char-card');
    await clickSel(page, '[data-action="load-more"]');
    const reached = await page.waitFor((n) => document.querySelectorAll('.char-card').length > n, { args: [before], timeout: 35000, label: 'more characters' }).then(() => true).catch(() => false);
    steps.push({ before, after: await count(page, '.char-card'), reached });
    if (!reached) break;
  }
  await sleep(500);
  const final = await js(page, () => ({ total: document.querySelectorAll('.char-card').length, progress: document.querySelector('.pool-progress') ? document.querySelector('.pool-progress').textContent.replace(/\s+/g, ' ').trim() : null, button: (() => { const el = document.querySelector('[data-action="load-more"]'); return el ? { label: el.textContent.trim(), disabled: el.disabled } : null; })(), cast: document.querySelector('[data-board-cast-count]') ? document.querySelector('[data-board-cast-count]').textContent : null }));
  check('load more reaches exactly 100 characters', final.total === 100, JSON.stringify({ steps, total: final.total }));
  check('cap state: 100 / 100 PAGE 04 and disabled BOARD LIMIT / 100', /100 \/ 100 · PAGE 04/.test(final.progress || '') && final.button !== null && final.button.disabled === true && /BOARD LIMIT \/ 100/.test(final.button.label), JSON.stringify({ progress: final.progress, button: final.button }));
  await clickSel(page, '[data-action="load-more"]');
  await sleep(700);
  check('character cap cannot exceed 100', (await count(page, '.char-card')) === 100, String(await count(page, '.char-card')));
  const boardCopy = await js(page, () => ({
    note: document.querySelector('.board-note-hint') ? document.querySelector('.board-note-hint').innerText.replace(/\s+/g, ' ').trim() : null,
    metrics: [...document.querySelectorAll('.board-metric-key')].map((el) => el.textContent.trim()),
    caption: document.querySelectorAll('.board-caption').length,
    tierRows: [...document.querySelectorAll('.tier-row:not([data-drop-tier="pool"]) .tier-drop')].map((el) => el.textContent.trim()),
    tierEmptyEls: document.querySelectorAll('.tier-empty').length,
    touchHintDisplay: document.querySelector('.touch-hint') ? getComputedStyle(document.querySelector('.touch-hint')).display : null,
    touchHintText: document.querySelector('.board-note-hint') ? document.querySelector('.board-note-hint').textContent.replace(/\s+/g, ' ').trim() : null
  }));
  check('board minimal copy: note + metrics only', boardCopy.note === 'DRAG TO RANK / MOVE MENU FOR KEYS' && JSON.stringify(boardCopy.metrics) === JSON.stringify(['COMMUNITY AVG', 'CAST', 'SAVE']) && boardCopy.caption === 0 && boardCopy.touchHintDisplay === 'none' && /\/ HOLD TO DRAG ON TOUCH$/.test(boardCopy.touchHintText || ''), JSON.stringify(boardCopy));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1, touch: true });
  await sleep(350);
  const touchNote = await js(page, () => { const hint = document.querySelector('.board-note-hint'); const touch = document.querySelector('.touch-hint'); return { text: hint ? hint.innerText.replace(/\s+/g, ' ').trim() : null, touchDisplay: touch ? getComputedStyle(touch).display : null, hoverNone: matchMedia('(hover: none)').matches }; });
  check('board note shows hold-to-drag copy on touch devices', /\/ HOLD TO DRAG ON TOUCH$/.test(touchNote.text || '') && touchNote.touchDisplay === 'inline' && touchNote.hoverNone === true, JSON.stringify(touchNote));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1, touch: false });
  await sleep(200);
  check('empty tier rows are blank', boardCopy.tierEmptyEls === 0 && boardCopy.tierRows.every((row) => row === ''), JSON.stringify(boardCopy.tierRows));
  const stored = await js(page, () => { const raw = localStorage.getItem('anigraph:v1:boards'); try { return raw ? JSON.parse(raw) : null; } catch (error) { return null; } });
  const keys = stored ? Object.keys(stored) : [];
  const record = keys.length ? stored[keys[0]] : null;
  state.mediaId = keys.length ? keys[0] : null;
  check('board auto-saved to localStorage under media id', !!record && record.chars.length === 100 && String(record.mediaId) === keys[0] && record.tiers && Array.isArray(record.tiers.S), record ? JSON.stringify({ key: keys[0], chars: record.chars.length, title: record.title, page: record.page }) : null);
}

async function item4 (page) {
  item(4);
  await page.setViewport({ width: 1440, height: 1600, deviceScaleFactor: 1, touch: true });
  await js(page, () => window.scrollTo(0, 0));
  await sleep(500);
  const layoutBefore = await layout(page);
  const source = await rect(page, '[data-drop-tier="pool"] .char-card');
  const sTarget = await rect(page, '[data-drop-tier="S"] .tier-drop');
  check('drag geometry available (pool card + S row visible)', !!source && !!sTarget && source.centerY < 1580 && sTarget.centerY > 0, JSON.stringify({ source: source && source.centerY, target: sTarget && sTarget.centerY }));
  await page.mouse('mousePressed', source.centerX, source.centerY);
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse('mouseMoved', source.centerX + ((sTarget.centerX - source.centerX) * step) / 10, source.centerY + ((sTarget.centerY - source.centerY) * step) / 10, { buttons: 1 });
    await sleep(22);
  }
  await sleep(120);
  check('mouse drag shows .is-drop-target on S row', (await js(page, () => !!document.querySelector('.tier-row[data-drop-tier="S"].is-drop-target'))));
  await page.mouse('mouseReleased', sTarget.centerX, sTarget.centerY);
  await sleep(500);
  const afterMove = await layout(page);
  check('mouse drag pool -> S moves the card', afterMove.S.length === 1 && afterMove.pool.length === layoutBefore.pool.length - 1, JSON.stringify({ S: afterMove.S.length, pool: afterMove.pool.length }));
  const source2 = await rect(page, '[data-drop-tier="pool"] .char-card');
  await page.mouse('mousePressed', source2.centerX, source2.centerY);
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse('mouseMoved', source2.centerX + ((sTarget.centerX - source2.centerX) * step) / 10, source2.centerY + ((sTarget.centerY - source2.centerY) * step) / 10, { buttons: 1 });
    await sleep(22);
  }
  await page.mouse('mouseReleased', sTarget.centerX, sTarget.centerY);
  await sleep(500);
  const beforeOrder = (await layout(page)).S;
  const firstS = await rect(page, '[data-drop-tier="S"] .char-card');
  const sDrop = await rect(page, '[data-drop-tier="S"] .tier-drop');
  await page.mouse('mousePressed', firstS.centerX, firstS.centerY);
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse('mouseMoved', firstS.centerX + (((sDrop.x + sDrop.width - 24) - firstS.centerX) * step) / 10, firstS.centerY, { buttons: 1 });
    await sleep(22);
  }
  await sleep(100);
  await page.mouse('mouseReleased', sDrop.x + sDrop.width - 24, firstS.centerY);
  await sleep(500);
  const afterOrder = (await layout(page)).S;
  check('mouse drag reorders within a row', beforeOrder.length === 2 && afterOrder.length === 2 && String(beforeOrder) !== String(afterOrder), JSON.stringify({ beforeOrder, afterOrder }));
  const poolBeforeX = (await layout(page)).pool.length;
  await clickSel(page, '[data-drop-tier="S"] .card-x');
  await sleep(500);
  const afterX = await layout(page);
  check('card x returns character to UNASSIGNED', afterX.pool.length === poolBeforeX + 1 && afterX.S.length === 1, JSON.stringify({ pool: afterX.pool.length, S: afterX.S.length }));
  await js(page, () => window.scrollTo(0, 0));
  await sleep(300);
  const beforeCancel = await layout(page);
  const escapeSource = await rect(page, '[data-drop-tier="S"] .char-card');
  const aTarget = await rect(page, '[data-drop-tier="A"] .tier-drop');
  await page.mouse('mousePressed', escapeSource.centerX, escapeSource.centerY);
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse('mouseMoved', escapeSource.centerX + ((aTarget.centerX - escapeSource.centerX) * step) / 10, escapeSource.centerY + ((aTarget.centerY - escapeSource.centerY) * step) / 10, { buttons: 1 });
    await sleep(22);
  }
  await sleep(120);
  const escapeTargetSeen = await js(page, () => !!document.querySelector('.tier-row[data-drop-tier="A"].is-drop-target'));
  await page.key('Escape');
  await sleep(300);
  await page.mouse('mouseReleased', aTarget.centerX, aTarget.centerY);
  await sleep(300);
  const afterCancel = await layout(page);
  const dropTargets = await count(page, '.tier-row.is-drop-target');
  check('Escape cancels an in-progress drag', escapeTargetSeen && afterCancel.S.length === beforeCancel.S.length && afterCancel.A.length === beforeCancel.A.length && String(afterCancel.pool) === String(beforeCancel.pool) && dropTargets === 0, JSON.stringify({ escapeTargetSeen, S: afterCancel.S.length, A: afterCancel.A.length, dropTargets }));
  const touchSource = await rect(page, '[data-drop-tier="pool"] .char-card');
  const dTarget = await rect(page, '[data-drop-tier="D"] .tier-drop');
  await page.touch('touchStart', [{ x: touchSource.centerX, y: touchSource.centerY, id: 1, radiusX: 5, radiusY: 5, force: 1 }]);
  await sleep(330);
  for (let step = 1; step <= 10; step += 1) {
    await page.touch('touchMove', [{ x: touchSource.centerX + ((dTarget.centerX - touchSource.centerX) * step) / 10, y: touchSource.centerY + ((dTarget.centerY - touchSource.centerY) * step) / 10, id: 1, radiusX: 5, radiusY: 5, force: 1 }]);
    await sleep(30);
  }
  await sleep(140);
  const touchHighlight = await js(page, () => !!document.querySelector('.tier-row[data-drop-tier="D"].is-drop-target'));
  await page.touch('touchEnd', []);
  await sleep(600);
  const touchLayout = await layout(page);
  check('touch long-press (>220ms) drag moves card to another tier', touchHighlight && touchLayout.D.length === 1, JSON.stringify({ touchHighlight, D: touchLayout.D.length }));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1, touch: false });
  await sleep(300);
}

async function item6 (page) {
  item(6);
  const rows = ['S', 'A', 'B', 'C', 'D', 'pool'];
  await js(page, () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0); });
  await sleep(300);
  let reached = false;
  let usedTabs = 0;
  for (let index = 0; index < 160; index += 1) {
    await page.key('Tab');
    usedTabs += 1;
    await sleep(25);
    reached = await js(page, () => {
      const active = document.activeElement;
      return !!active && active.classList && active.classList.contains('char-card');
    });
    if (reached) break;
  }
  check('keyboard-only: Tab reaches a character card', reached, usedTabs + ' Tab presses');
  if (!reached) return;
  const focusInfo = await js(page, () => ({ tag: document.activeElement.tagName, cls: document.activeElement.className, id: document.activeElement.getAttribute('data-char-id') }));
  console.log('  keyboard focus: ' + JSON.stringify(focusInfo));
  const cardId = focusInfo.id;
  await page.key('Enter');
  await page.waitForSelector('.move-menu', { timeout: 5000 });
  await sleep(400);
  const menu = await js(page, () => ({ options: [...document.querySelectorAll('.move-option')].map((option) => option.getAttribute('data-target-row')), focusedRow: document.activeElement ? document.activeElement.getAttribute('data-target-row') : null, activeClass: document.activeElement ? document.activeElement.className : null }));
  check('Enter opens move menu with all six rows', menu.options.length === 6 && rows.every((row) => menu.options.includes(row)), JSON.stringify(menu));
  console.log('  menu focus: ' + JSON.stringify(menu));
  const startIndex = rows.indexOf(menu.focusedRow);
  const sequence = [];
  await page.key('ArrowDown'); await sleep(100); sequence.push(await js(page, () => document.activeElement ? document.activeElement.getAttribute('data-target-row') : null));
  await page.key('ArrowDown'); await sleep(100); sequence.push(await js(page, () => document.activeElement ? document.activeElement.getAttribute('data-target-row') : null));
  await page.key('Home'); await sleep(100); sequence.push(await js(page, () => document.activeElement ? document.activeElement.getAttribute('data-target-row') : null));
  await page.key('End'); await sleep(100); sequence.push(await js(page, () => document.activeElement ? document.activeElement.getAttribute('data-target-row') : null));
  const expected = startIndex >= 0 ? [rows[(startIndex + 1) % 6], rows[(startIndex + 2) % 6], rows[0], rows[5]] : null;
  check('ArrowDown/ArrowUp/Home/End navigate move menu', !!expected && JSON.stringify(sequence) === JSON.stringify(expected), JSON.stringify({ sequence, expected, start: menu.focusedRow }));
  await page.key('Escape');
  await sleep(350);
  const afterEscape = await js(page, () => ({ menuOpen: !!document.querySelector('.move-menu'), activeId: document.activeElement ? document.activeElement.getAttribute('data-char-id') : null, activeClass: document.activeElement ? document.activeElement.className : null }));
  check('Escape closes move menu and focus returns to card', afterEscape.menuOpen === false && String(afterEscape.activeId) === String(cardId), JSON.stringify(afterEscape));
  await page.key('Enter');
  await page.waitForSelector('.move-menu', { timeout: 5000 });
  await sleep(400);
  for (let index = 0; index < 4; index += 1) { await page.key('ArrowDown'); await sleep(90); }
  const chosenRow = await js(page, () => document.activeElement ? document.activeElement.getAttribute('data-target-row') : null);
  await page.key('Enter');
  await sleep(800);
  const keyboardMove = await js(page, (id, row) => {
    const card = document.querySelector('[data-drop-tier="' + row + '"] .char-card[data-char-id="' + id + '"]');
    const active = document.activeElement;
    const style = active ? getComputedStyle(active) : null;
    return {
      cardAtChosen: !!card,
      activeId: active ? active.getAttribute('data-char-id') : null,
      outlineStyle: style ? style.outlineStyle : null,
      outlineWidth: style ? style.outlineWidth : null,
      outlineColor: style ? style.outlineColor : null,
      menuOpen: !!document.querySelector('.move-menu')
    };
  }, cardId, chosenRow);
  check('keyboard Enter moves the card to chosen tier', keyboardMove.cardAtChosen, JSON.stringify({ chosenRow, keyboardMove }));
  check('focus returns to moved card with 2px blue focus ring', String(keyboardMove.activeId) === String(cardId) && keyboardMove.outlineStyle === 'solid' && keyboardMove.outlineWidth === '2px' && keyboardMove.outlineColor === 'rgb(61, 180, 242)' && keyboardMove.menuOpen === false, JSON.stringify(keyboardMove));
}

async function item5 (page) {
  item(5);
  const before = await js(page, () => {
    const boards = JSON.parse(localStorage.getItem('anigraph:v1:boards') || '{}');
    const ui = JSON.parse(localStorage.getItem('anigraph:v1:ui') || 'null');
    const rows = {};
    for (const row of ['S', 'A', 'B', 'C', 'D', 'pool']) rows[row] = [...document.querySelectorAll('[data-drop-tier="' + row + '"] .char-card')].map((card) => card.getAttribute('data-char-id')).join(',');
    return { boards: Object.keys(boards), ui, rows, title: document.querySelector('.board-title') ? document.querySelector('.board-title').textContent : null, cast: document.querySelector('[data-board-cast-count]') ? document.querySelector('[data-board-cast-count]').textContent : null };
  });
  const requestIndex = page.events.requests.length;
  await page.reload();
  await page.waitForSelector('.board-page', { timeout: 20000 });
  await sleep(900);
  const after = await js(page, () => {
    const rows = {};
    for (const row of ['S', 'A', 'B', 'C', 'D', 'pool']) rows[row] = [...document.querySelectorAll('[data-drop-tier="' + row + '"] .char-card')].map((card) => card.getAttribute('data-char-id')).join(',');
    return { rows, title: document.querySelector('.board-title') ? document.querySelector('.board-title').textContent : null, cast: document.querySelector('[data-board-cast-count]') ? document.querySelector('[data-board-cast-count]').textContent : null, view: document.getElementById('viewTiers') ? document.getElementById('viewTiers').hidden === false : null };
  });
  const graphqlReload = page.events.requests.slice(requestIndex).filter((request) => request.url.includes('graphql.anilist.co'));
  check('reload restores the exact board layout from anigraph:v1:boards', JSON.stringify(before.rows) === JSON.stringify(after.rows) && before.title === after.title, JSON.stringify({ title: after.title, cast: after.cast }));
  check('reload makes zero GraphQL requests', graphqlReload.length === 0, graphqlReload.map((request) => request.method + ' ' + request.url).join(' | '));
  check('reload restores tiers view from anigraph:v1:ui', before.ui && before.ui.view === 'tiers' && after.view === true, JSON.stringify({ ui: before.ui, view: after.view }));
  const snapshot = await js(page, () => {
    const boards = JSON.parse(localStorage.getItem('anigraph:v1:boards') || '{}');
    const key = Object.keys(boards)[0];
    const record = boards[key];
    const first = record && record.chars && record.chars[0];
    return { key, hasChars: !!(record && record.chars && record.chars.length === 100), firstChar: first ? Object.keys(first).sort().join(',') : null, hasTiers: !!(record && record.tiers) };
  });
  check('storage keeps char snapshots keyed by media id', snapshot.hasChars && snapshot.hasTiers && snapshot.firstChar === 'id,image,name', JSON.stringify(snapshot));
}

async function item7share (page) {
  item(7);
  const boardInfo = await js(page, () => {
    const boards = JSON.parse(localStorage.getItem('anigraph:v1:boards') || '{}');
    const ui = JSON.parse(localStorage.getItem('anigraph:v1:ui') || 'null');
    const key = ui && ui.activeMediaId ? String(ui.activeMediaId) : Object.keys(boards)[0];
    const rows = {};
    for (const row of ['S', 'A', 'B', 'C', 'D', 'pool']) rows[row] = document.querySelectorAll('[data-drop-tier="' + row + '"] .char-card').length;
    return { key, title: document.querySelector('.board-title') ? document.querySelector('.board-title').textContent : null, rows };
  });
  state.mediaId = boardInfo.key;
  state.boardTitle = boardInfo.title;
  state.rows = boardInfo.rows;
  await clickSel(page, '[data-action="copy-share"]');
  await sleep(900);
  let link = null;
  try { link = await js(page, () => navigator.clipboard.readText()); } catch (error) { link = null; }
  if (!link || !String(link).includes('#board=')) {
    link = await js(page, () => { const dialog = document.getElementById('copyDialog'); const input = dialog ? dialog.querySelector('input') : null; return dialog && dialog.open && input ? input.value : null; });
  }
  check('COPY SHARE LINK yields a #board= URL', typeof link === 'string' && link.includes('#board='), link ? link.slice(0, 90) + '... (' + link.length + ' chars)' : 'no link captured');
  state.link = link;
  if (!link) return;
  const payload = await js(page, (url) => {
    try {
      const hash = String(url).split('#board=')[1] || '';
      const base64 = hash.replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const json = JSON.parse(new TextDecoder().decode(bytes));
      return { v: json.v, m: json.m, chars: Array.isArray(json.chars) ? json.chars.length : -1, s: json.tiers && json.tiers.S ? json.tiers.S.length : -1, pool: Array.isArray(json.pool) ? json.pool.length : -1 };
    } catch (error) { return { error: String(error) }; }
  }, link);
  check('share payload carries board data', payload && payload.v === 1 && payload.chars > 0 && payload.m === Number(state.mediaId), JSON.stringify(payload));
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.goto(link);
  await fresh.waitForSelector('.board-page', { timeout: 20000 });
  await sleep(700);
  const freshState = await js(fresh, () => ({
    banner: document.querySelector('.share-banner') ? document.querySelector('.share-banner').innerText.replace(/\s+/g, ' ').trim() : null,
    title: document.querySelector('.board-title') ? document.querySelector('.board-title').textContent : null,
    cast: document.querySelector('[data-board-cast-count]') ? document.querySelector('[data-board-cast-count]').textContent : null,
    save: document.querySelector('[data-board-save]') ? document.querySelector('[data-board-save]').textContent : null,
    boards: localStorage.getItem('anigraph:v1:boards'),
    hash: location.hash
  }));
  const freshGraphql = fresh.events.requests.filter((request) => request.url.includes('graphql.anilist.co'));
  check('fresh context renders shared board with "Shared board — save a copy?"', /Shared board — save a copy\?/.test(freshState.banner || '') && freshState.title === state.boardTitle, JSON.stringify({ banner: freshState.banner, title: freshState.title }));
  check('shared board renders with zero GraphQL requests', freshGraphql.length === 0, freshGraphql.length + ' requests');
  check('shared board renders without an ANN news request', !fresh.events.requests.some((request) => request.url.includes('/api/ann/news')));
  check('fresh profile starts with empty board storage', freshState.boards === null, String(freshState.boards));
  await clickSel(fresh, '[data-action="save-shared-copy"]');
  await sleep(900);
  const savedFresh = await js(fresh, () => ({ banner: !!document.querySelector('.share-banner'), hash: location.hash, boards: JSON.parse(localStorage.getItem('anigraph:v1:boards') || 'null'), save: document.querySelector('[data-board-save]') ? document.querySelector('[data-board-save]').textContent : null }));
  const savedRecord = savedFresh.boards ? savedFresh.boards[String(state.mediaId)] : null;
  check('SAVE A COPY persists locally and clears hash + banner', !!savedRecord && savedFresh.banner === false && savedFresh.hash === '' && /AUTO-SAVED/.test(savedFresh.save || '') && savedRecord.chars.length > 0, JSON.stringify({ banner: savedFresh.banner, hash: savedFresh.hash, save: savedFresh.save, chars: savedRecord ? savedRecord.chars.length : null }));
  await context.close();
}

async function item9 (page) {
  item(9);
  await js(page, () => window.scrollTo(0, 0));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
  let view = await viewportState(page);
  check('1440 board: no page-level horizontal scroll', view.docWidth <= view.innerWidth + 1, JSON.stringify(view));
  await shot(page, '1440-board');
  await page.setViewport({ width: 768, height: 1000, deviceScaleFactor: 1 });
  await sleep(400);
  view = await viewportState(page);
  check('768 board: no page-level horizontal scroll', view.docWidth <= view.innerWidth + 1, JSON.stringify(view));
  await shot(page, '768-board');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  view = await viewportState(page);
  const rowInfo = await js(page, () => {
    const row = document.querySelector('.tier-row[data-drop-tier="pool"]');
    const letter = row ? row.querySelector('.tier-letter') : null;
    return {
      innerWidth: window.innerWidth,
      docWidth: document.documentElement.scrollWidth,
      overflowX: row ? getComputedStyle(row).overflowX : null,
      scrollWidth: row ? row.scrollWidth : null,
      clientWidth: row ? row.clientWidth : null,
      letterPosition: letter ? getComputedStyle(letter).position : null,
      letterLeft: letter ? getComputedStyle(letter).left : null
    };
  });
  check('390 viewport reports innerWidth 390 (mobile emulation)', rowInfo.innerWidth === 390, String(rowInfo.innerWidth));
  check('390 board: no page-level horizontal scroll', view.docWidth <= view.innerWidth + 1, JSON.stringify(view));
  check('<=600px tier rows scroll horizontally', rowInfo.overflowX === 'auto' && rowInfo.scrollWidth > rowInfo.clientWidth + 1, JSON.stringify({ overflowX: rowInfo.overflowX, scrollWidth: rowInfo.scrollWidth, clientWidth: rowInfo.clientWidth }));
  check('<=600px tier letter column is sticky', rowInfo.letterPosition === 'sticky' && rowInfo.letterLeft === '0px', JSON.stringify({ position: rowInfo.letterPosition, left: rowInfo.letterLeft }));
  await shot(page, '390-board', { fullPage: true });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
  await clickSel(page, '[data-action="new-board"]');
  await page.waitForSelector('#tierSearchInput', { timeout: 6000 });
  await setInput(page, '#tierSearchInput', 'Frieren');
  await page.waitForSelector('.media-card', { timeout: 25000 });
  await sleep(1200);
  view = await viewportState(page);
  check('1440 search results: no page-level horizontal scroll', view.docWidth <= view.innerWidth + 1, JSON.stringify(view));
  await page.setViewport({ width: 768, height: 1000, deviceScaleFactor: 1 });
  await sleep(400);
  view = await viewportState(page);
  check('768 search results: no page-level horizontal scroll', view.docWidth <= view.innerWidth + 1, JSON.stringify(view));
  const searchCards = await count(page, '.media-card');
  check('search results render at 768', searchCards > 0, searchCards + ' cards');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(450);
  view = await viewportState(page);
  check('390 search results: no page-level horizontal scroll', view.docWidth <= view.innerWidth + 1, JSON.stringify(view));
  await shot(page, '390-search-results', { fullPage: true });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await sleep(200);
  await clickSel(page, '[data-view-target="stats"]');
  await page.waitForSelector('#statsForm', { timeout: 10000 });
  await setInput(page, '#statsUsername', 'derF');
  await submitForm(page, '#statsForm');
  await waitCount(page, '.panel[data-panel]', 7, 30000);
  await waitTitlesReady(page, 'episodes', 'ONE PIECE 611');
  await sleep(800);
  view = await viewportState(page);
  const layout1440 = await js(page, () => {
    const panels = [...document.querySelectorAll('[data-panel]')];
    const summary = document.querySelector('.summary-strip');
    return { tops: panels.map((panel) => Math.round(panel.getBoundingClientRect().top)), summaryColumns: summary ? getComputedStyle(summary).gridTemplateColumns.split(' ').filter(Boolean).length : null };
  });
  check('1440 stats: no page-level horizontal scroll', view.docWidth <= view.innerWidth + 1, JSON.stringify(view));
  check('1440 charts render multi-column', new Set(layout1440.tops).size < 7, JSON.stringify(layout1440.tops));
  check('1440 summary is 2x2 beside the ANN sidebar', layout1440.summaryColumns === 2, String(layout1440.summaryColumns));
  await page.setViewport({ width: 768, height: 1000, deviceScaleFactor: 1 });
  await sleep(450);
  view = await viewportState(page);
  const layout768 = await js(page, () => {
    const panels = [...document.querySelectorAll('[data-panel]')];
    const grid = document.querySelector('.chart-grid');
    const summary = document.querySelector('.summary-strip');
    return { widths: panels.map((panel) => Math.round(panel.getBoundingClientRect().width)), tops: panels.map((panel) => Math.round(panel.getBoundingClientRect().top)), gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : null, summaryColumns: summary ? getComputedStyle(summary).gridTemplateColumns.split(' ').filter(Boolean).length : null };
  });
  check('768 stats: no page-level horizontal scroll', view.docWidth <= view.innerWidth + 1, JSON.stringify(view));
  check('charts are 1-column under 900px', new Set(layout768.tops).size === 7 && layout768.widths.every((width) => Math.abs(width - layout768.gridWidth) < 3), JSON.stringify(layout768));
  check('summary stays 4-column between 720 and 900', layout768.summaryColumns === 4, String(layout768.summaryColumns));
  await shot(page, '768-stats-loaded', { fullPage: true });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  view = await viewportState(page);
  const layout390 = await js(page, () => {
    const cells = [...document.querySelectorAll('.summary-cell')];
    const summary = document.querySelector('.summary-strip');
    return { innerWidth: window.innerWidth, docWidth: document.documentElement.scrollWidth, summaryColumns: summary ? getComputedStyle(summary).gridTemplateColumns.split(' ').filter(Boolean).length : null, cellTops: cells.map((cell) => Math.round(cell.getBoundingClientRect().top)) };
  });
  check('390 stats: no page-level horizontal scroll', layout390.docWidth <= layout390.innerWidth + 1, JSON.stringify(layout390));
  check('summary is 2x2 under 720px', layout390.summaryColumns === 2 && new Set(layout390.cellTops).size === 2, JSON.stringify({ columns: layout390.summaryColumns, tops: layout390.cellTops }));
  await shot(page, '390-stats-loaded', { fullPage: true });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
}

async function item7archive (page) {
  item(7);
  await clickSel(page, '[data-view-target="tiers"]');
  await page.waitForSelector('[data-action="open-archive"]', { timeout: 10000 });
  const requestIndex = page.events.requests.length;
  await clickSel(page, '[data-action="open-archive"]');
  await page.waitForSelector('#archiveDialog[open]', { timeout: 6000 });
  const dialogInfo = await js(page, () => ({ open: document.getElementById('archiveDialog').open, rows: document.querySelectorAll('#archiveDialog .archive-dialog-row').length }));
  check('archive dialog opens and lists saved boards', dialogInfo.open && dialogInfo.rows >= 1, JSON.stringify(dialogInfo));
  await clickSel(page, '#archiveDialog [data-action="open-saved"]');
  await sleep(700);
  const opened = await js(page, () => ({ dialogOpen: document.getElementById('archiveDialog') ? document.getElementById('archiveDialog').open : null, title: document.querySelector('.board-title') ? document.querySelector('.board-title').textContent : null, hash: location.hash }));
  const openedRequests = page.events.requests.slice(requestIndex).filter((request) => request.url.includes('graphql.anilist.co')).length;
  check('archive OPEN restores the saved board with no GraphQL request', !!opened.title && opened.dialogOpen !== true && openedRequests === 0, JSON.stringify({ opened, openedRequests }));
  await clickSel(page, '[data-action="open-archive"]');
  await page.waitForSelector('#archiveDialog[open]', { timeout: 6000 });
  await clickSel(page, '#archiveDialog [data-action="delete-saved"]');
  await page.waitForSelector('#confirmDialog[open]', { timeout: 6000 });
  const confirmInfo = await js(page, () => ({ title: document.getElementById('dialogTitle') ? document.getElementById('dialogTitle').textContent : null, cancel: document.getElementById('dialogCancel') ? document.getElementById('dialogCancel').textContent : null, body: document.getElementById('dialogBody') ? document.getElementById('dialogBody').innerText.replace(/\s+/g, ' ').trim() : null }));
  check('DELETE asks for confirmation with CANCEL', /Delete this board\?/.test(confirmInfo.title || '') && confirmInfo.cancel === 'CANCEL', JSON.stringify(confirmInfo));
  await clickSel(page, '#dialogCancel');
  await sleep(500);
  const afterCancel = await js(page, () => ({ confirmOpen: document.getElementById('confirmDialog') ? document.getElementById('confirmDialog').open : null, boards: JSON.parse(localStorage.getItem('anigraph:v1:boards') || 'null') }));
  check('DELETE cancel keeps the saved board', afterCancel.confirmOpen === false && !!afterCancel.boards && !!afterCancel.boards[String(state.mediaId)], JSON.stringify({ confirmOpen: afterCancel.confirmOpen }));
  await clickSel(page, '[data-action="open-archive"]');
  await page.waitForSelector('#archiveDialog[open]', { timeout: 6000 });
  await clickSel(page, '#archiveDialog [data-action="delete-saved"]');
  await page.waitForSelector('#confirmDialog[open]', { timeout: 6000 });
  await clickSel(page, '#dialogOk');
  await sleep(800);
  const afterDelete = await js(page, () => ({ boards: JSON.parse(localStorage.getItem('anigraph:v1:boards') || 'null'), archiveOpen: document.getElementById('archiveDialog') ? document.getElementById('archiveDialog').open : null, confirmOpen: document.getElementById('confirmDialog') ? document.getElementById('confirmDialog').open : null, boardVisible: !!document.querySelector('.board-page') }));
  check('DELETE confirm removes the board from storage', (!afterDelete.boards || !afterDelete.boards[String(state.mediaId)]) && afterDelete.confirmOpen === false, JSON.stringify(afterDelete));
}

async function item8 (page) {
  item(8);
  const intentional = /ERR_INTERNET_DISCONNECTED|status of 404|Failed to load resource/i;
  const consoleErrors = page.events.consoleErrors.filter((entry) => !intentional.test(entry.text || ''));
  const exceptions = page.events.exceptions;
  check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).map((entry) => entry.text).join(' | '));
  check('no uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 5).map((entry) => entry.text).join(' | '));
  const origins = [...new Set(page.events.requests.map((request) => { try { return new URL(request.url).origin; } catch (error) { return 'bad:' + request.url; } }))];
  const allowed = new Set([server.origin, 'https://graphql.anilist.co', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  const unexpected = origins.filter((origin) => !allowed.has(origin) && !/^https:\/\/[^/]*anilist\.co$/.test(origin));
  check('external requests limited to AniList + Google Fonts', unexpected.length === 0, 'origins: ' + origins.join(' ') + (unexpected.length ? ' | UNEXPECTED: ' + unexpected.join(' ') : ''));
  const graphql = page.events.requests.filter((request) => request.url.includes('graphql.anilist.co')).length;
  check('GraphQL traffic reaches real API host', graphql > 0, graphql + ' requests');
  const failed = page.events.failed.filter((entry) => !/ERR_INTERNET_DISCONNECTED/.test(entry.errorText || ''));
  const criticalFailed = failed.filter((entry) => !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(entry.url || ''));
  const fontFailed = failed.filter((entry) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(entry.url || ''));
  check('no failed app/API network requests', criticalFailed.length === 0, criticalFailed.slice(0, 5).map((entry) => entry.errorText + ' ' + entry.url).join(' | '));
  if (fontFailed.length) console.log('  note: transient external font-CDN failures (not app/API): ' + fontFailed.map((entry) => entry.errorText + ' ' + entry.url).join(' | '));
  const allConsole = page.events.consoleErrors.map((entry) => entry.text);
  await fs.writeFile(path.join(artifacts, 'console-network-evidence.json'), JSON.stringify({ consoleErrors: page.events.consoleErrors, exceptions: page.events.exceptions, origins, failed: page.events.failed, requestCount: page.events.requests.length, graphqlCount: graphql }, null, 2));
  console.log('  console.error/notice capture during whole main session: ' + JSON.stringify(allConsole));
}

async function item10 () {
  item(10);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setReducedMotion(true);
    await page.goto(server.url + 'index.html');
    await page.waitForSelector('#statsForm', { timeout: 20000 });
    await sleep(400);
    const rail = await count(page, '.station, .live-pip, #localClock');
    check('removed station rail and live indicator stay absent under reduced motion', rail === 0, String(rail));
    await setInput(page, '#statsUsername', 'derF');
    await submitForm(page, '#statsForm');
    await page.waitForSelector('.panel[data-panel]', { timeout: 30000 });
    await sleep(800);
    const motion = await js(page, () => {
      const reveal = document.querySelector('.reveal');
      const bar = document.querySelector('.chart-bar');
      const revealStyle = reveal ? getComputedStyle(reveal) : null;
      const barStyle = bar ? getComputedStyle(bar) : null;
      return {
        prefersReduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        revealName: revealStyle ? revealStyle.animationName : null,
        revealOpacity: revealStyle ? revealStyle.opacity : null,
        revealHeight: reveal ? reveal.getBoundingClientRect().height : 0,
        barName: barStyle ? barStyle.animationName : null,
        barOpacity: barStyle ? barStyle.opacity : null
      };
    });
    check('reduced motion: .reveal animation-name none', motion.revealName === 'none', JSON.stringify(motion));
    check('reduced motion: .chart-bar animation-name none', motion.barName === 'none', JSON.stringify(motion));
    check('reduced motion: content not hidden', motion.revealOpacity === '1' && motion.barOpacity === '1' && motion.revealHeight > 0, JSON.stringify(motion));
    check('reduced motion emulation active', motion.prefersReduced === true);
    await page.screenshot(path.join(artifacts, 'reduced-motion-1440.png'));
  } finally {
    await page.close();
    await context.close();
  }
}

async function item11 () {
  item(11);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.goto(fileUrl(path.join(repo, 'index.html')));
    await page.waitForSelector('#statsForm', { timeout: 20000 });
    await sleep(500);
    await setInput(page, '#statsUsername', 'derF');
    await submitForm(page, '#statsForm');
    await waitCount(page, '.panel[data-panel]', 7, 30000);
    await waitTitlesReady(page, 'episodes', 'ONE PIECE 611');
    await sleep(700);
    const stats = await js(page, () => ({ summary: [...document.querySelectorAll('.summary-value')].map((el) => el.textContent.trim()), panels: document.querySelectorAll('[data-panel]').length, svgs: document.querySelectorAll('svg.chart-svg').length, titles: document.querySelectorAll('.title-chart-row').length, origin: location.origin }));
    const graphql = page.events.requests.filter((request) => request.url.includes('graphql.anilist.co')).length;
    check('file:// live API + 7-panel charts render', stats.panels === 7 && stats.svgs === 5 && stats.titles === 8 && stats.summary[0] === '1,088', JSON.stringify(stats));
    check('file:// uses live AniList API', graphql > 0, graphql + ' requests');
    const consoleErrors = page.events.consoleErrors.filter((entry) => !/favicon|status of 404/i.test(entry.text || ''));
    check('file:// no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).map((entry) => entry.text).join(' | '));
    if (state.link) {
      const hash = String(state.link).split('#')[1];
      await page.goto(fileUrl(path.join(repo, 'index.html')) + '#' + hash);
      await page.waitForSelector('.board-page', { timeout: 10000 });
      await sleep(600);
      const shared = await js(page, () => ({ banner: document.querySelector('.share-banner') ? document.querySelector('.share-banner').innerText.replace(/\s+/g, ' ').trim() : null, title: document.querySelector('.board-title') ? document.querySelector('.board-title').textContent : null }));
      check('file:// share hash renders shared board', /Shared board/.test(shared.banner || ''), JSON.stringify(shared));
    } else {
      check('file:// share hash renders shared board', false, 'no share link captured earlier');
    }
    await page.screenshot(path.join(artifacts, 'file-protocol-stats.png'));
  } finally {
    await page.close();
  }
}

async function item16 () {
  item(16);
  const before = JSON.parse(await fs.readFile(path.join(here, 'artifacts', 'design-before', 'data.json'), 'utf8'));
  const cache = { ...before.ANIME.cache, ...before.MANGA.cache };
  const responses = Object.entries(cache).filter(([key]) => key.startsWith('anigraph:v1:cache:[')).map(([key, value]) => {
    const [query, variables] = JSON.parse(key.slice('anigraph:v1:cache:'.length));
    return { query, variables, data: JSON.parse(value).data };
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const evidence = [];
  let singleYear = false;
  try {
    await page.route('*graphql.anilist.co*', (request) => {
      if (request.method === 'OPTIONS') return PREFLIGHT;
      const body = JSON.parse(request.postData);
      const operation = body.query.match(/query (\w+)/)?.[1];
      const captured = responses.find((entry) => entry.query.includes('query ' + operation) && (!entry.variables.type || entry.variables.type === body.variables.type) && (!entry.variables.chunk || entry.variables.chunk === body.variables.chunk));
      if (!captured) return null;
      const data = structuredClone(captured.data);
      // The frozen chart fixture predates pagination and represents one complete test dataset.
      if (data.MediaListCollection && !captured.variables.chunk) data.MediaListCollection.hasNextChunk = false;
      if (singleYear && data.User) {
        data.User.statistics.anime.releaseYears = [{ releaseYear: 2001, count: 3 }];
        data.User.statistics.anime.startYears = [{ startYear: 2001, count: 3 }];
      }
      return { status: 200, headers: CORS_HEADERS, body: JSON.stringify({ data }) };
    });
    await page.route('*/api/ann/news', () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: cache['anigraph:v1:cache:ann:news'] ? JSON.stringify(JSON.parse(cache['anigraph:v1:cache:ann:news']).data) : '[]' }));
    await page.setReducedMotion(true);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(server.url + 'index.html');
    await setInput(page, '#statsUsername', 'derF');
    await submitForm(page, '#statsForm');
    for (const division of ['ANIME', 'MANGA']) {
      await clickSel(page, '[data-media-type="' + division + '"]');
      await waitTitlesReady(page, division === 'ANIME' ? 'episodes' : 'chapters', division === 'ANIME' ? 'ONE PIECE 611' : 'Inuyasha 558');
      await js(page, async () => document.fonts.ready);
      const summary = await js(page, () => [...document.querySelectorAll('.summary-value')].map((el) => el.textContent.trim()));
      const panels = await panelSnapshot(page);
      const byId = (a, b) => a.id.localeCompare(b.id);
      check(division + ' redesign preserves every source summary and semantic chart total', JSON.stringify(summary) === JSON.stringify(before[division].summary) && JSON.stringify(panels.map(({ id, label }) => ({ id, label })).sort(byId)) === JSON.stringify(before[division].panels.map(({ id, label }) => ({ id, label })).sort(byId)), JSON.stringify({ summary, panels: panels.map(({ id, label }) => ({ id, label })) }));
      const baselineRows = before[division].panels.filter(({ id }) => ['formats', 'genres', 'titles'].includes(id)).map(({ id, values }) => ({ id, values })).sort(byId);
      const currentRows = panels.filter(({ id }) => ['formats', 'genres', 'titles'].includes(id)).map(({ id, valueLabels }) => ({ id, values: valueLabels })).sort(byId);
      check(division + ' redesign preserves ranked format, genre, and title values', JSON.stringify(currentRows) === JSON.stringify(baselineRows), JSON.stringify(currentRows));
      const source = responses.find((entry) => entry.query.includes('query UserStats')).data.User.statistics[division.toLowerCase()];
      const tooltips = await js(page, () => Object.fromEntries([...document.querySelectorAll('[data-panel]')].map((panel) => [panel.dataset.panel, [...panel.querySelectorAll('svg title')].map((title) => title.textContent)])));
      const expectedTooltips = {
        scores: source.scores.map((row) => 'Score ' + row.score * 10 + ': ' + row.count + ' entr'),
        statuses: source.statuses.map((row) => row.status.replaceAll('_', ' ') + ': ' + row.count + ' entr'),
        releaseYears: source.releaseYears.map((row) => row.releaseYear + ': ' + row.count + ' entr'),
        genres: [...source.genres].sort((a, b) => b.count - a.count).slice(0, 10).map((row) => row.genre + ': ' + row.count + ' entries, mean score ' + Number(row.meanScore.toFixed(2)))
      };
      const missing = Object.entries(expectedTooltips).flatMap(([id, values]) => values.filter((value) => !(tooltips[id] || []).some((tooltip) => tooltip.includes(value))).map((value) => id + ': ' + value));
      check(division + ' score, status, year, and genre-mean tooltips retain every source value', missing.length === 0, JSON.stringify(missing));
      for (const width of [1440, 768, 390]) {
        await page.setViewport({ width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
        await sleep(450);
        const geometry = await js(page, () => {
          const panels = [...document.querySelectorAll('[data-panel]')];
          const out = { innerWidth, docWidth: document.documentElement.scrollWidth, panels: [] };
          for (const panel of panels) {
            const bounds = panel.getBoundingClientRect();
            const record = { id: panel.dataset.panel, left: bounds.left, right: bounds.right, width: bounds.width, text: [], overlaps: [], outside: [] };
            for (const svg of panel.querySelectorAll('svg.chart-svg')) {
              const svgBounds = svg.getBoundingClientRect();
              const labels = [...svg.querySelectorAll('text')].filter((el) => el.textContent.trim() && getComputedStyle(el).visibility !== 'hidden').map((el) => {
                const r = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return { text: el.textContent.trim(), x: r.left, y: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, font: parseFloat(style.fontSize) * svgBounds.width / svg.viewBox.baseVal.width, fill: style.fill, bg: getComputedStyle(panel).backgroundColor };
              });
              for (const label of labels) {
                if (label.x < svgBounds.left - 1 || label.right > svgBounds.right + 1 || label.y < svgBounds.top - 1 || label.bottom > svgBounds.bottom + 1) record.outside.push(label.text);
              }
              for (let i = 0; i < labels.length; i += 1) {
                for (let j = i + 1; j < labels.length; j += 1) {
                  const a = labels[i], b = labels[j];
                  if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1) record.overlaps.push([a.text, b.text]);
                }
              }
              record.text.push(...labels);
            }
            for (const el of panel.querySelectorAll('.chart-legend-item span')) {
              if (!el.textContent.trim()) continue;
              const r = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              record.text.push({ text: el.textContent.trim(), font: parseFloat(style.fontSize), fill: style.color, bg: getComputedStyle(panel).backgroundColor });
              if (r.left < bounds.left - 1 || r.right > bounds.right + 1) record.outside.push(el.textContent.trim());
            }
            out.panels.push(record);
          }
          return out;
        });
        evidence.push({ division, width, geometry });
        const name = division + ' ' + width;
        check(name + ' chart panels fit viewport without horizontal overflow', geometry.docWidth <= width + 1 && geometry.panels.length === 7 && geometry.panels.every((panel) => panel.left >= 0 && panel.right <= width + 1 && panel.width > 200), JSON.stringify({ docWidth: geometry.docWidth, panels: geometry.panels.map(({ id, left, right, width }) => ({ id, left, right, width })) }));
        check(name + ' every SVG label stays inside its chart and avoids other labels', geometry.panels.every((panel) => panel.outside.length === 0 && panel.overlaps.length === 0), JSON.stringify(geometry.panels.filter((panel) => panel.outside.length || panel.overlaps.length).map(({ id, outside, overlaps }) => ({ id, outside, overlaps }))));
        const labels = geometry.panels.flatMap((panel) => panel.text);
        const unreadable = labels.filter((label) => label.font < 10.95 || contrastRatio(label.fill, label.bg) < 4.5);
        check(name + ' chart and legend labels remain at least 11px with AA text contrast', labels.length > 30 && unreadable.length === 0, JSON.stringify(unreadable.map(({ text, font, fill, bg }) => ({ text, font, fill, bg }))));
        await js(page, () => window.scrollTo(0, 0));
        await shot(page, width + '-design-' + division.toLowerCase(), { fullPage: true });
      }
      await page.scrollTo('[data-genre="Action"]');
      await page.focus('[data-genre="Action"]');
      await page.key('Enter');
      await page.waitForSelector('#genrePanelTitle');
      const raw = await cachedTitles(page, division);
      const expected = expectedGenreEntries(raw, 'Action');
      check(division + ' restyled genre supports Enter and preserves every matching public title', (await text(page, '#genrePanelTitle')) === 'Action' && JSON.stringify((await genreRows(page)).map((row) => row.id)) === JSON.stringify(sortedGenreIds(expected)), expected.length + ' Action entries');
      await page.key('Escape');
      const focus = await js(page, () => { const el = document.activeElement; const s = getComputedStyle(el); return { genre: el?.dataset.genre, outline: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
      check(division + ' restyled genre restores a visible keyboard focus ring', focus.genre === 'Action' && focus.outline === 'solid' && focus.width >= 2, JSON.stringify(focus));
      await page.scrollTo('[data-genre="Action"]');
      const bounds = await rect(page, '[data-genre="Action"]');
      await page.mouse('mousePressed', bounds.centerX, bounds.centerY);
      await page.mouse('mouseReleased', bounds.centerX, bounds.centerY);
      await page.waitForSelector('#genrePanelTitle');
      check(division + ' restyled genre supports pointer activation at mobile width', (await text(page, '#genrePanelTitle')) === 'Action' && (await genreRows(page)).length === expected.length, String((await genreRows(page)).length));
      await page.key('Escape');
    }
    check('redesigned charts share the paginated public collection without extra operation types', page.events.exceptions.length === 0 && page.events.requests.filter((request) => request.method === 'POST').every(r => /query (UserStats|UserTitles)/.test(r.postData)), JSON.stringify({ exceptions: page.events.exceptions, operations: page.events.requests.filter((request) => request.method === 'POST').map((request) => JSON.parse(request.postData).query.match(/query (\w+)/)?.[1]) }));
    singleYear = true;
    await clickSel(page, '[data-media-type="ANIME"]');
    await setInput(page, '#statsUsername', 'qa_single_year');
    await submitForm(page, '#statsForm');
    await page.waitForSelector('[data-panel="startYears"] svg');
    const years = await js(page, () => ['releaseYears', 'startYears'].map((id) => {
      const svg = document.querySelector('[data-panel="' + id + '"] svg');
      const ticks = [...svg.querySelectorAll('.chart-axis-label')].filter((el) => /^\d{4}$/.test(el.textContent));
      const bar = svg.querySelector('.chart-bar');
      const cx = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2;
      return { id, years: ticks.map((el) => el.textContent), tickX: ticks.map((el) => Number(el.getAttribute('x'))), barCenter: cx, tooltip: bar.querySelector('title').textContent };
    }));
    for (const year of years) check(year.id + ' single-year fixture labels only the real year and aligns tick with its bar', JSON.stringify(year.years) === '["2001"]' && Math.abs(year.tickX[0] - year.barCenter) < 1 && year.tooltip.includes('2001: 3 entries'), JSON.stringify(year));
    await shot(page, '390-design-single-year', { fullPage: true });
    await fs.writeFile(path.join(artifacts, 'chart-design-geometry.json'), JSON.stringify(evidence, null, 2));
  } finally { await page.close(); await context.close(); }
}

async function item17 () {
  item(17);
  const context = await browser.newContext();
  const page = await context.newPage();
  const evidence = [];
  const captured = [];
  const artworkSnapshot = () => [...document.querySelectorAll('.artwork')].map((slot) => {
    const r = slot.getBoundingClientRect();
    const img = slot.querySelector('img');
    const fallback = slot.querySelector('.img-fallback');
    const host = slot.closest('[data-media-id]');
    return { classes: slot.className, id: host ? Number(host.dataset.mediaId) : null, src: img?.getAttribute('src') || null, currentSrc: img?.currentSrc || null, loaded: !!img?.naturalWidth, complete: img?.complete, naturalWidth: img?.naturalWidth || 0, naturalHeight: img?.naturalHeight || 0, loading: img?.loading, decoding: img?.decoding, alt: img?.alt, referrerPolicy: img?.referrerPolicy, broken: img?.classList.contains('is-broken'), imageDisplay: img ? getComputedStyle(img).display : null, imageVisibility: img ? getComputedStyle(img).visibility : null, fallback: fallback?.textContent.trim() || '', fallbackDisplay: fallback ? getComputedStyle(fallback).display : null, width: r.width, height: r.height, x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  });
  try {
    await page.route('*/api/ann/news*', () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '[]' }));
    await page.setReducedMotion(true);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(server.url + 'index.html');
    await setInput(page, '#statsUsername', 'derF');
    await submitForm(page, '#statsForm');
    for (const division of ['ANIME', 'MANGA']) {
      await clickSel(page, '[data-media-type="' + division + '"]');
      await waitTitlesReady(page, division === 'ANIME' ? 'episodes' : 'chapters', division === 'ANIME' ? 'ONE PIECE 611' : 'Inuyasha 558');
      const raw = await cachedTitles(page, division);
      const byId = new Map(raw.map((entry) => [entry.media?.id, entry]));
      const query = page.events.requests.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.postData)).find((r) => r.query.includes('query UserTitles') && r.variables.type === division);
      check(division + ' artwork comes from paginated public-list queries without per-title requests', !!query && /coverImage\s*\{[^}]*large/.test(query.query) && page.events.requests.filter((r) => r.method === 'POST' && JSON.parse(r.postData).query.includes('query UserTitles') && JSON.parse(r.postData).variables.type === division).every((r,i) => JSON.parse(r.postData).variables.chunk === i + 1), query?.query.match(/coverImage[^}]*}/)?.[0]);
      const rows = await js(page, () => [...document.querySelectorAll('.title-chart-row')].map((row) => ({ id: Number(row.dataset.mediaId), title: row.querySelector('.chart-title-label')?.textContent.trim(), value: row.querySelector('.chart-value-label')?.textContent.trim(), src: row.querySelector('.title-art img')?.getAttribute('src'), tooltip: row.getAttribute('title') })));
      check(division + ' every top-title cover matches its actual media id and source title', rows.length === 8 && rows.every((row) => { const entry = byId.get(row.id); return entry && row.src === entry.media.coverImage?.large && row.title === (entry.media.title.romaji || entry.media.title.english || entry.media.title.native) && row.tooltip?.includes(String(entry.progress)); }), JSON.stringify(rows));
      await page.scrollTo('.title-chart-row:last-child');
      await page.waitFor(() => [...document.querySelectorAll('.title-art img')].every((img) => img.complete), { timeout: 30000, label: division + ' title covers settled' });
      let artwork = await js(page, artworkSnapshot);
      const titleArt = artwork.filter((slot) => slot.classes.includes('title-art'));
      check(division + ' all eight real title covers load from AniList CDN', titleArt.length === 8 && titleArt.every((slot) => slot.loaded && /^https:\/\/[^/]*anilist\.co\//.test(slot.src)), JSON.stringify(titleArt.map(({ id, src, naturalWidth, naturalHeight }) => ({ id, src, naturalWidth, naturalHeight }))));
      const profileArt = artwork.filter((slot) => slot.classes.includes('profile-art'));
      check(division + ' profile artwork strip uses the same three leading list entries', profileArt.length === 3 && profileArt.every((slot, index) => slot.src === rows[index].src), JSON.stringify(profileArt.map(({ id, src }) => ({ id, src }))));
      await page.focus('[data-genre="Action"]');
      await page.key('Enter');
      await page.waitForSelector('#genrePanelTitle');
      const genre = await js(page, () => [...document.querySelectorAll('.genre-title-row')].map((row) => ({ id: Number(row.dataset.mediaId), src: row.querySelector('.genre-art img')?.getAttribute('src') || null, text: row.textContent.replace(/\s+/g, ' ').trim() })));
      check(division + ' every genre cover belongs to that exact returned genre entry', genre.length > 8 && genre.every((row) => byId.get(row.id)?.media.genres?.includes('Action') && row.src === byId.get(row.id).media.coverImage?.large), String(genre.length) + ' id/source pairs');
      await page.scrollTo('.genre-title-row:first-child');
      await page.waitFor(() => { const img = document.querySelector('.genre-art img'); return img?.complete; }, { timeout: 30000, label: division + ' visible genre artwork settled' });
      artwork = await js(page, artworkSnapshot);
      check(division + ' visible genre artwork loads and title remains independently readable', artwork.some((slot) => slot.classes.includes('genre-art') && slot.loaded) && genre.every((row) => row.text.length > 5), JSON.stringify(artwork.filter((slot) => slot.classes.includes('genre-art')).slice(0, 3)));
      for (const width of [1440, 768, 390]) {
        await page.setViewport({ width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
        await sleep(400);
        const geometry = await js(page, () => {
          const rows = [...document.querySelectorAll('.title-chart-row, .genre-title-row')];
          return { innerWidth, docWidth: document.documentElement.scrollWidth, rows: rows.map((row) => { const r = row.getBoundingClientRect(); const labels = [...row.querySelectorAll('.chart-title-label, .chart-value-label')].map((el) => { const t = el.getBoundingClientRect(); return { text: el.textContent.trim(), left: t.left, right: t.right, top: t.top, bottom: t.bottom }; }); return { id: row.dataset.mediaId, left: r.left, right: r.right, top: r.top, bottom: r.bottom, labels }; }), artwork: [...document.querySelectorAll('.title-art, .genre-art, .profile-art')].map((slot) => { const r = slot.getBoundingClientRect(); return { width: r.width, height: r.height }; }) };
        });
        evidence.push({ division, width, geometry });
        check(division + ' ' + width + ' image rows fit the viewport and keep labels inside their rows', geometry.docWidth <= width + 1 && geometry.rows.every((row) => row.left >= 0 && row.right <= width + 1 && row.labels.every((label) => label.left >= row.left - 1 && label.right <= row.right + 1 && label.top >= row.top - 1 && label.bottom <= row.bottom + 1)), JSON.stringify({ width: geometry.docWidth, bad: geometry.rows.filter((row) => row.labels.some((label) => label.left < row.left - 1 || label.right > row.right + 1 || label.top < row.top - 1 || label.bottom > row.bottom + 1)).slice(0, 4) }));
        check(division + ' ' + width + ' cover slots reserve a positive consistent portrait aspect ratio', geometry.artwork.length >= 11 && geometry.artwork.every((slot) => slot.width > 0 && slot.height > 0 && Math.abs(slot.width / slot.height - 2 / 3) < 0.02), JSON.stringify(geometry.artwork.slice(0, 12)));
        await js(page, () => window.scrollTo(0, 0));
        await shot(page, width + '-images-' + division.toLowerCase() + '-profile');
        await page.scrollTo('[data-panel="titles"]');
        await shot(page, width + '-images-' + division.toLowerCase() + '-titles');
        await page.scrollTo('#genrePanelTitle');
        await shot(page, width + '-images-' + division.toLowerCase() + '-genre');
      }
      const semantics = await js(page, artworkSnapshot);
      const images = semantics.filter((slot) => slot.src);
      check(division + ' artwork is lazy, async, private-referrer and decorative beside real labels', images.length > 10 && images.every((slot) => slot.loading === 'lazy' && slot.decoding === 'async' && slot.referrerPolicy === 'no-referrer' && slot.alt === ''), JSON.stringify(images.slice(0, 3)));
      await page.key('Escape');
      check(division + ' illustrated genre panel closes with Escape and restores trigger focus', (await count(page, '#genrePanelTitle')) === 0 && (await js(page, () => document.activeElement?.dataset.genre)) === 'Action');
      captured.push({ division, label: (await panelSnapshot(page)).find((panel) => panel.id === 'titles').label, summary: await js(page, () => [...document.querySelectorAll('.summary-value')].map((el) => el.textContent.trim())), rows, artwork: semantics });
    }
    const cache = await js(page, () => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('anigraph:v1:cache:'))));
    const responses = Object.entries(cache).filter(([key]) => key.startsWith('anigraph:v1:cache:[')).map(([key, value]) => { const [query, variables] = JSON.parse(key.slice('anigraph:v1:cache:'.length)); return { query, variables, data: JSON.parse(value).data }; });
    const stats = responses.find((entry) => entry.query.includes('query UserStats')).data;
    const titleData = { MediaListCollection: { lists: responses.filter(entry => entry.query.includes('query UserTitles') && entry.variables.type === 'ANIME').flatMap(entry => structuredClone(entry.data.MediaListCollection.lists)) } };
    const best = new Map();
    for (const entry of titleData.MediaListCollection.lists.flatMap((list) => list.entries || [])) { const id = entry.media?.id; if (id && (!best.has(id) || entry.progress > best.get(id).progress)) best.set(id, entry); }
    const top = [...best.values()].filter((entry) => entry.progress > 0).sort((a, b) => b.progress - a.progress || (a.media.title.romaji || a.media.title.english || a.media.title.native).localeCompare(b.media.title.romaji || b.media.title.english || b.media.title.native)).slice(0, 8);
    for (const entry of top) entry.media.coverImage = { large: null };
    top[0].media.coverImage.large = 'https://s4.anilist.co/file/anilistcdn/qa-valid.svg';
    top[2].media.coverImage.large = 'javascript:window.__imageInjected=1';
    top[3].media.coverImage.large = 'https://s4.anilist.co/file/anilistcdn/qa-404.png';
    top[4].media.coverImage.large = 'https://s4.anilist.co/file/anilistcdn/qa-corrupt.png';
    top[5].media.coverImage.large = 'https://user:pass@s4.anilist.co/file/anilistcdn/qa-credential.png';
    const fixture = { MediaListCollection: { hasNextChunk: false, lists: [{ entries: top }] } };
    await fs.writeFile(path.join(artifacts, 'images-live-data.json'), JSON.stringify({ captured, cache }, null, 2));
    check('image enrichment produces no uncaught exceptions or per-image GraphQL operations', page.events.exceptions.length === 0 && page.events.requests.filter((request) => request.method === 'POST').every(r => /query (UserStats|UserTitles)/.test(r.postData)), JSON.stringify({ exceptions: page.events.exceptions, postCount: page.events.requests.filter((request) => request.method === 'POST').length }));
    const brokenContext = await browser.newContext();
    const broken = await brokenContext.newPage();
    let releaseImage;
    const heldImage = new Promise((resolve) => { releaseImage = resolve; });
    try {
      await broken.route('*qa-*', async (request) => {
        if (request.url.endsWith('qa-valid.svg')) { await heldImage; return { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#3DB4F2"/></svg>' }; }
        return { status: request.url.endsWith('qa-404.png') ? 404 : 200, headers: { 'content-type': 'image/png' }, body: 'invalid PNG bytes' };
      });
      await broken.route('*/api/ann/news*', () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '[]' }));
      await broken.route('*graphql.anilist.co*', (request) => {
        if (request.method === 'OPTIONS') return PREFLIGHT;
        return { status: 200, headers: CORS_HEADERS, body: JSON.stringify({ data: request.postData.includes('query UserStats') ? stats : fixture }) };
      });
      await broken.setReducedMotion(true);
      await broken.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await broken.goto(server.url + 'index.html');
      await setInput(broken, '#statsUsername', 'qa_images');
      await submitForm(broken, '#statsForm');
      await waitTitlesReady(broken, 'episodes', 'ONE PIECE 611');
      await broken.scrollTo('.title-chart-row:first-child');
      const pending = await js(broken, artworkSnapshot);
      releaseImage();
      await broken.waitFor(() => [...document.querySelectorAll('.title-art img')].every((img) => img.complete), { timeout: 15000, label: 'controlled image failures settled' });
      await sleep(100);
      const settled = await js(broken, artworkSnapshot);
      const pendingTitles = pending.filter((slot) => slot.classes.includes('title-art'));
      const settledTitles = settled.filter((slot) => slot.classes.includes('title-art'));
      check('cover geometry is reserved before load and stays stable after success/failure', settledTitles.length === 8 && settledTitles.every((slot, index) => Math.abs(slot.width - pendingTitles[index].width) < 0.5 && Math.abs(slot.height - pendingTitles[index].height) < 0.5 && slot.height > 0), JSON.stringify({ pending: pendingTitles.map(({ width, height }) => ({ width, height })), settled: settledTitles.map(({ width, height }) => ({ width, height })) }));
      check('missing, script, and credentialed image sources never create image requests', !settledTitles[1].src && !settledTitles[2].src && !settledTitles[5].src && !broken.events.requests.some((request) => /javascript:|qa-credential/.test(request.url)) && !(await js(broken, () => window.__imageInjected)), JSON.stringify(settledTitles.map(({ id, src }) => ({ id, src }))));
      check('404 and corrupt image responses show an intentional fixed-size fallback', [settledTitles[3], settledTitles[4]].every((slot) => slot.broken && slot.fallback && slot.fallbackDisplay !== 'none' && (slot.imageDisplay === 'none' || slot.imageVisibility === 'hidden')), JSON.stringify([settledTitles[3], settledTitles[4]]));
      const fallbackPanel = (await panelSnapshot(broken)).find((panel) => panel.id === 'titles');
      const fallbackSummary = await js(broken, () => [...document.querySelectorAll('.summary-value')].map((el) => el.textContent.trim()));
      check('missing artwork retains all real titles, progress, and chart summaries', (await count(broken, '.title-chart-row')) === 8 && fallbackPanel.label === captured[0].label && JSON.stringify(fallbackPanel.titleLabels) === JSON.stringify(captured[0].rows.map((row) => row.title)) && JSON.stringify(fallbackPanel.valueLabels) === JSON.stringify(captured[0].rows.map((row) => row.value)) && JSON.stringify(fallbackSummary) === JSON.stringify(captured[0].summary), JSON.stringify({ panel: fallbackPanel, summary: fallbackSummary }));
      await shot(broken, '390-images-fallback-titles');
      await fs.writeFile(path.join(artifacts, 'images-fallback.json'), JSON.stringify({ pending, settled, requests: broken.events.requests, exceptions: broken.events.exceptions }, null, 2));
    } finally { releaseImage(); await broken.close(); await brokenContext.close(); }
    await fs.writeFile(path.join(artifacts, 'images-geometry.json'), JSON.stringify(evidence, null, 2));
  } finally { await page.close(); await context.close(); }
}

async function item18 () {
  item(18);
  const { createAppServer } = await import('../server.js');
  const appServer = createAppServer();
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + appServer.address().port;
  const context = await browser.newContext();
  const page = await context.newPage();
  const evidence = [];
  try {
    await page.setReducedMotion(true);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(origin + '/');
    await setInput(page, '#statsUsername', 'Neartana');
    await submitForm(page, '#statsForm');
    await page.waitForSelector('.title-chart-row');
    await page.waitFor(() => { const img = document.querySelector('.profile-banner img'); return img?.complete && img.naturalWidth > 0; }, { timeout: 30000, label: 'Neartana real banner loads' });
    await waitCount(page, '.ann-news-item', 5, 35000);
    await page.scrollTo('.ann-news-item:last-child');
    await page.waitFor(() => [...document.querySelectorAll('.ann-art img')].every((img) => img.complete), { timeout: 30000, label: 'real compact ANN thumbnails settle' });
    const sourceNews = await js(page, () => JSON.parse(sessionStorage.getItem('anigraph:v1:cache:ann:news:images')).data);
    for (const width of [1440, 985, 768, 390]) {
      await page.setViewport({ width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
      await sleep(350);
      const banner = await bannerSnapshot(page);
      const details = await js(page, () => {
        const surface = document.querySelector('.profile-banner');
        const fade = getComputedStyle(surface, '::after');
        const img = surface.querySelector('img');
        const imageStyle = getComputedStyle(img);
        return { railElements: document.querySelectorAll('.station, .live-pip, #localClock').length, bodyText: document.body.innerText, title: document.querySelector('.ann-wire .panel-head')?.textContent.trim(), imageStyle: { objectFit: imageStyle.objectFit, objectPosition: imageStyle.objectPosition }, fade: { content: fade.content, background: fade.backgroundImage, height: parseFloat(fade.height), bottom: fade.bottom, opacity: fade.opacity, pointerEvents: fade.pointerEvents } };
      });
      check(width + ' station rail, public-feed ticker and live indicator are removed', details.railElements === 0 && !/ANILIST\s*\/\s*PUBLIC FEED/.test(details.bodyText));
      check(width + ' real Neartana banner shows the entire natural image without stretching', banner.present && banner.naturalWidth > 0 && Math.abs(banner.imgHeight - banner.imgWidth * banner.naturalHeight / banner.naturalWidth) < 1 && Math.abs(banner.height - banner.imgHeight) <= 3 && banner.docWidth <= width + 1, JSON.stringify(banner));
      check(width + ' banner has a visible non-interactive bottom fade', details.fade.content !== 'none' && /linear-gradient/.test(details.fade.background) && details.fade.height > 0 && details.fade.bottom === '0px' && Number(details.fade.opacity) > 0 && details.fade.pointerEvents === 'none', JSON.stringify(details.fade));
      check(width + ' news section has a single NEWS heading', details.title === 'NEWS', details.title);
      await js(page, () => window.scrollTo(0, 0));
      await shot(page, width + '-review-neartana-profile');
      const bounds = await js(page, () => { const r = document.querySelector('.profile-banner').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 1 }; });
      const clip = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: bounds }, page.sessionId);
      await fs.writeFile(path.join(artifacts, width + '-review-neartana-banner.png'), Buffer.from(clip.data, 'base64'));
      await page.scrollTo('#annWire');
      const news = await js(page, () => ({ innerWidth, docWidth: document.documentElement.scrollWidth, items: [...document.querySelectorAll('.ann-news-item')].map((item) => {
        const row = item.getBoundingClientRect();
        const art = item.querySelector('.ann-art');
        const cover = art?.getBoundingClientRect();
        const img = art?.querySelector('img');
        const link = item.querySelector('.ann-news-link');
        const range = document.createRange();
        range.selectNodeContents(link);
        const lines = [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }));
        return { title: link.textContent.trim(), font: parseFloat(getComputedStyle(link).fontSize), row: { left: row.left, right: row.right, top: row.top, bottom: row.bottom }, cover: cover ? { left: cover.left, right: cover.right, top: cover.top, bottom: cover.bottom, width: cover.width, height: cover.height } : null, naturalWidth: img?.naturalWidth || 0, src: img?.getAttribute('src') || null, lines };
      }) }));
      const limit = width === 390 ? 96 : 160;
      check(width + ' every available publisher thumbnail is compact, decoded and source matched', news.items.length === 5 && news.items.some((item) => item.cover) && news.items.every((item, index) => sourceNews[index].imageUrl ? item.cover && item.cover.width > 0 && item.cover.width <= limit + 1 && item.naturalWidth > 0 && item.src === sourceNews[index].imageUrl : !item.cover), JSON.stringify(news.items.map(({ title, cover, naturalWidth }) => ({ title, cover, naturalWidth }))));
      const invalid = news.items.filter((item) => !item.title || item.font < 12 || item.lines.some((line) => line.left < item.row.left - 1 || line.right > item.row.right + 1 || line.top < item.row.top - 1 || line.bottom > item.row.bottom + 1 || (item.cover && Math.min(line.right, item.cover.right) - Math.max(line.left, item.cover.left) > 1 && Math.min(line.bottom, item.cover.bottom) - Math.max(line.top, item.cover.top) > 1)));
      const stacked = news.items.filter((item) => item.cover && (!item.lines[0] || item.lines[0].left < item.cover.right + 3 || item.lines[0].top >= item.cover.bottom));
      check(width + ' headlines remain readable beside thumbnails in wide news layouts without page overflow', news.docWidth <= width + 1 && invalid.length === 0 && (width >= 1200 || stacked.length === 0), JSON.stringify({ docWidth: news.docWidth, invalid, stacked }));
      await shot(page, width + '-review-news');
      evidence.push({ width, banner, details: { ...details, bodyText: undefined }, news });
    }
    check('four visual revisions keep the live app free of uncaught exceptions', page.events.exceptions.length === 0, JSON.stringify(page.events.exceptions));
    await fs.writeFile(path.join(artifacts, 'ui-review-geometry.json'), JSON.stringify(evidence, null, 2));
    await fs.writeFile(path.join(artifacts, 'ui-review-live-data.json'), JSON.stringify({ cache: await js(page, () => Object.fromEntries(Object.entries(sessionStorage))), requests: page.events.requests, consoleErrors: page.events.consoleErrors, exceptions: page.events.exceptions }, null, 2));
  } finally {
    await page.close(); await context.close(); appServer.closeAllConnections(); await new Promise((resolve) => appServer.close(resolve));
  }
}

async function item12 () {
  item(12);
  const context = await browser.newContext();
  const page = await context.newPage();
  const scrollEvidence = [];
  try {
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.goto(server.url + 'index.html');
    await page.waitForSelector('#statsForm');
    await setInput(page, '#statsUsername', 'derF');
    await submitForm(page, '#statsForm');
    await waitTitlesReady(page, 'episodes', 'ONE PIECE 611');
    const query = page.events.requests.find((request) => String(request.postData).includes('query UserTitles'))?.postData || '';
    check('genre fields share the paginated titles query', /status/.test(query) && /genres/.test(query) && /startDate/.test(query) && /year/.test(query) && /chunk: \$chunk/.test(query) && /hasNextChunk/.test(query) && /perChunk: 500/.test(query), query);
    const accessibility = await js(page, () => ({
      rows: [...document.querySelectorAll('[data-genre]')].map((row) => ({ role: row.getAttribute('role'), tab: row.getAttribute('tabindex'), label: row.getAttribute('aria-label'), svgHidden: row.closest('svg').getAttribute('aria-hidden'), childrenHidden: [...row.querySelectorAll('text,line,rect')].every((el) => !!el.closest('[aria-hidden="true"]')) })),
      otherHidden: [...document.querySelectorAll('[data-panel]:not([data-panel="genres"]) svg')].every((svg) => svg.getAttribute('aria-hidden') === 'true')
    }));
    check('genres alone expose labelled, keyboard-focusable SVG buttons', accessibility.rows.length > 0 && accessibility.rows.every((row) => row.role === 'button' && row.tab === '0' && /Show all titles/.test(row.label) && row.svgHidden !== 'true' && row.childrenHidden) && accessibility.otherHidden, JSON.stringify(accessibility));

    for (const division of ['ANIME', 'MANGA']) {
      const captureScroll = async (action) => { scrollEvidence.push({ division, action, ...await js(page, () => { const list = document.querySelector('.genre-title-list'); const first = list.firstElementChild; return { scrollTop: list.scrollTop, firstId: first.dataset.mediaId, listTop: list.getBoundingClientRect().top, firstTop: first.getBoundingClientRect().top }; }) }); };
      if (division === 'MANGA') {
        await clickSel(page, '[data-media-type="MANGA"]');
        await waitTitlesReady(page, 'chapters', 'Inuyasha 558');
        check('division switch clears the open genre panel', (await count(page, '#genrePanelTitle')) === 0);
      }
      const raw = await cachedTitles(page, division);
      const expected = expectedGenreEntries(raw, 'Action');
      const before = page.events.requests.filter((request) => request.method === 'POST').length;
      await page.scrollTo('[data-genre="Action"]');
      const target = await rect(page, '[data-genre="Action"]');
      await page.mouse('mousePressed', target.centerX, target.centerY);
      await page.mouse('mouseReleased', target.centerX, target.centerY);
      await page.waitForSelector('#genrePanelTitle');
      const rows = await genreRows(page);
      await captureScroll('open');
      check(division + ' Action opens every returned public title in that genre', expected.length > 8 && JSON.stringify(rows.map((row) => row.id)) === JSON.stringify(sortedGenreIds(expected)), JSON.stringify({ raw: raw.length, returnedAction: expected.length, visible: rows.length, firstIds: rows.slice(0, 10).map((row) => row.id) }));
      check(division + ' heading and public count reflect list data', (await text(page, '#genrePanelTitle')) === 'Action' && new RegExp('\\b' + expected.length + '\\b').test(await text(page, '.genre-public-count')), await text(page, '.genre-public-count'));
      check(division + ' opening genre focuses heading', (await js(page, () => document.activeElement?.id)) === 'genrePanelTitle');
      const options = await js(page, () => Object.fromEntries(['status', 'format', 'sort'].map((key) => [key, [...document.querySelector('[data-genre-filter="' + key + '"]').options].map((option) => option.value)])));
      const statuses = ['ALL', ...new Set(expected.map((entry) => entry.status))].sort();
      const formats = ['ALL', ...new Set(expected.map((entry) => entry.media.format))].sort();
      check(division + ' filter options match only values present in this genre', JSON.stringify([...options.status].sort()) === JSON.stringify(statuses) && JSON.stringify([...options.format].sort()) === JSON.stringify(formats) && JSON.stringify(options.sort) === JSON.stringify(['PROGRESS', 'TITLE', 'YEAR']), JSON.stringify(options));
      await js(page, () => { window.__qaGenreChart = document.querySelector('[data-panel="genres"] svg'); });
      const status = options.status.includes('PLANNING') ? 'PLANNING' : options.status.find((value) => value !== 'ALL');
      await setSelect(page, 'status', status);
      await captureScroll('status ' + status);
      check(division + ' status filter changes visible rows and preserves select focus', JSON.stringify((await genreRows(page)).map((row) => row.id)) === JSON.stringify(sortedGenreIds(expected.filter((entry) => entry.status === status))) && (await js(page, () => document.activeElement?.getAttribute('data-genre-filter'))) === 'status', status);
      await setSelect(page, 'status', 'ALL');
      await captureScroll('status ALL');
      const format = options.format.find((value) => value !== 'ALL');
      await setSelect(page, 'format', format);
      await captureScroll('format ' + format);
      check(division + ' format filter changes visible rows', JSON.stringify((await genreRows(page)).map((row) => row.id)) === JSON.stringify(sortedGenreIds(expected.filter((entry) => entry.media.format === format))), format);
      await setSelect(page, 'format', 'ALL');
      await captureScroll('format ALL');
      for (const sort of ['TITLE', 'YEAR', 'PROGRESS']) {
        await setSelect(page, 'sort', sort);
        await captureScroll('sort ' + sort);
        const ids = (await genreRows(page)).map((row) => row.id);
        check(division + ' ' + sort + ' sort orders all matching titles', JSON.stringify(ids) === JSON.stringify(sortedGenreIds(expected, sort)), JSON.stringify(ids.slice(0, 10)));
      }
      check(division + ' filtering preserves charts and makes no extra request', (await js(page, () => document.querySelector('[data-panel="genres"] svg') === window.__qaGenreChart)) && page.events.requests.filter((request) => request.method === 'POST').length === before);
      const scrolls = scrollEvidence.filter((entry) => entry.division === division);
      check(division + ' open and filters keep the first result visible', scrolls.every((entry) => entry.scrollTop === 0 && Math.abs(entry.firstTop - entry.listTop) < 1), JSON.stringify(scrolls));
      if (division === 'ANIME') {
        await page.key('Escape');
        check('Escape closes genre and restores chart trigger focus', (await count(page, '#genrePanelTitle')) === 0 && (await js(page, () => document.activeElement?.getAttribute('data-genre'))) === 'Action');
        await page.key('Enter');
        check('Enter on focused SVG genre opens panel', (await text(page, '#genrePanelTitle')) === 'Action');
        await clickSel(page, '[data-action="close-genre"]');
        await page.key('Space');
        check('Space on focused SVG genre opens panel', (await text(page, '#genrePanelTitle')) === 'Action');
        await page.key('Escape');
        const focus = await js(page, () => { const style = getComputedStyle(document.activeElement); return { outline: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }; });
        check('genre trigger has visible blue keyboard focus', focus.outline === 'solid' && parseFloat(focus.width) >= 2 && focus.color === 'rgb(61, 180, 242)', JSON.stringify(focus));
        await page.key('Tab');
        check('Tab reaches the next SVG genre button', !!(await js(page, () => document.activeElement?.getAttribute('data-genre'))));
        await clickSel(page, '[data-genre="Action"]');
      }
    }
    for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
      await page.setViewport({ width, height, deviceScaleFactor: width === 390 ? 2 : 1, mobile: width === 390 });
      await sleep(350);
      await page.scrollTo('#genrePanelTitle');
      const dimensions = await viewportState(page);
      const fits = await js(page, () => [...document.querySelectorAll('#genreDrilldown select, #genreDrilldown .genre-title-row')].every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
      check('open genre panel fits ' + width + ' viewport without page overflow', dimensions.docWidth <= dimensions.innerWidth + 1 && fits, JSON.stringify(dimensions));
      await shot(page, width + '-genre-manga', { fullPage: false });
    }
    await setInput(page, '#statsUsername', 'iamkisei');
    await submitForm(page, '#statsForm');
    check('new profile load clears stale genre immediately', (await count(page, '#genrePanelTitle')) === 0);
    await waitText(page, '.division-empty-note', 'No entries in this division.', 30000);
    check('empty public profile does not retain genre panel', (await count(page, '#genrePanelTitle')) === 0);
    await checkGenreNetwork(page, 'genre-live');
    await fs.writeFile(path.join(artifacts, 'genre-scroll.json'), JSON.stringify(scrollEvidence, null, 2));
  } finally {
    await page.close();
    await context.close();
  }
}

async function item13 () {
  item(13);
  const context = await browser.newContext();
  const page = await context.newPage();
  const makeEntry = (id, title, progress, status, format, year, genres = ['Action']) => ({ progress, status, media: { id, title: { romaji: title, english: null, native: null }, format, episodes: id === 91006 ? null : 24, chapters: null, startDate: { year }, genres } });
  const entries = [
    makeEntry(91001, 'Zulu <img src=x onerror="window.__genreInjected=1">', 3, 'CURRENT', 'TV', 2010),
    makeEntry(91002, 'Alpha & Omega', 0, 'PLANNING', 'MOVIE', 2023),
    makeEntry(91003, 'Bravo', 12, 'COMPLETED', 'TV', 2014),
    makeEntry(91004, 'Charlie', 12, 'REPEATING', 'TV', null),
    makeEntry(91005, 'Different genre', 999, 'CURRENT', 'TV', 2009, ['Drama']),
    makeEntry(91006, 'Unknown count', 7, 'PAUSED', 'ONA', 2020),
    makeEntry(91007, 'Dropped title', 1, 'DROPPED', 'TV_SHORT', 2000),
    makeEntry(91008, 'Hotel', 18, 'COMPLETED', 'MUSIC', 2019),
    makeEntry(91009, 'India', 25, 'COMPLETED', 'SPECIAL', 2021),
    makeEntry(91010, 'Juliet', 9, 'CURRENT', 'OVA', 2018)
  ];
  const payload = { data: { MediaListCollection: { hasNextChunk: false, lists: [{ entries }, { entries: [makeEntry(91001, 'Stale duplicate', 2, 'COMPLETED', 'TV', 2008)] }] } } };
  const division = { count: 42, meanScore: 75, minutesWatched: 400, episodesWatched: 100, chaptersRead: 100, volumesRead: 12, scores: [{ score: 75, count: 42 }], statuses: [{ status: 'COMPLETED', count: 42 }], formats: [{ format: 'TV', count: 42 }], genres: [{ genre: 'Action', count: 417, meanScore: 75 }, { genre: 'Adventure', count: 3, meanScore: 70 }], releaseYears: [], startYears: [] };
  let mode = 'loading';
  let release;
  let heldTitles = new Promise((resolve) => { release = resolve; });
  try {
    await page.route('*graphql.anilist.co*', async (request) => {
      if (request.method === 'OPTIONS') return PREFLIGHT;
      const body = JSON.parse(request.postData);
      if (body.query.includes('UserStats')) return { status: 200, headers: CORS_HEADERS, body: JSON.stringify({ data: { User: { id: 999998, name: body.variables.name, avatar: { medium: null }, bannerImage: null, statistics: { anime: division, manga: division } } } }) };
      if (body.query.includes('UserTitles')) {
        if (mode === 'loading') await heldTitles;
        const reply = mode === 'private' ? { data: { MediaListCollection: null }, errors: [{ message: 'Private list.', status: 403 }] } : mode === 'empty' ? { data: { MediaListCollection: { hasNextChunk: false, lists: [] } } } : payload;
        return { status: 200, headers: CORS_HEADERS, body: JSON.stringify(reply) };
      }
      return null;
    });
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.goto(server.url + 'index.html');
    await page.waitForSelector('#statsForm');
    await setInput(page, '#statsUsername', 'qa_genre');
    await submitForm(page, '#statsForm');
    await page.waitForSelector('[data-genre="Action"]');
    await clickSel(page, '[data-genre="Action"]');
    await waitText(page, '#genreDrilldown', 'Loading');
    check('genre opens honestly while titles are loading', (await genreRows(page)).length === 0 && (await count(page, '#genrePanelTitle')) === 1, await text(page, '#genreDrilldown'));
    await shot(page, '1440-genre-loading');
    mode = 'ready';
    release();
    await waitCount(page, '.genre-title-row', 9);
    const rows = await genreRows(page);
    check('genre list retains zero-progress/planning entries and exceeds top eight', rows.length === 9 && rows.some((row) => row.id === 91002), JSON.stringify(rows));
    check('duplicate entries retain highest progress and matching metadata', rows.filter((row) => row.id === 91001).length === 1 && rows.find((row) => row.id === 91001).text.includes('CURRENT') && !rows.some((row) => row.text.includes('Stale duplicate')), JSON.stringify(rows.find((row) => row.id === 91001)));
    check('public count reports nine returned entries, not 417 statistics entries', /\b9\b/.test(await text(page, '.genre-public-count')) && !/417/.test(await text(page, '.genre-public-count')), await text(page, '.genre-public-count'));
    check('async title load preserves heading focus', (await js(page, () => document.activeElement?.id)) === 'genrePanelTitle');
    check('unknown totals omit invented denominators', !/\//.test(await text(page, '.genre-title-row[data-media-id="91006"] .genre-title-progress')), await text(page, '.genre-title-row[data-media-id="91006"] .genre-title-progress'));
    check('title strings are escaped, not inserted as executable markup', (await count(page, '.genre-title-row img')) === 0 && (await js(page, () => window.__genreInjected || 0)) === 0 && rows.some((row) => row.text.includes('<img src=x')), rows.find((row) => row.id === 91001)?.text);
    const titles = await panelSnapshot(page);
    check('top titles still render eight positive-progress rows', titles.find((panel) => panel.id === 'titles').titleLabels.length === 8 && !titles.find((panel) => panel.id === 'titles').titleLabels.includes('Alpha & Omega'));
    const statuses = await js(page, () => [...document.querySelector('[data-genre-filter="status"]').options].map((option) => option.value).sort());
    check('all six list statuses are available when present', JSON.stringify(statuses) === JSON.stringify(['ALL', 'CURRENT', 'COMPLETED', 'PLANNING', 'PAUSED', 'DROPPED', 'REPEATING'].sort()), JSON.stringify(statuses));
    await setSelect(page, 'status', 'PLANNING');
    await setSelect(page, 'format', 'TV');
    check('valid combined filters show specific empty message', (await genreRows(page)).length === 0 && (await text(page, '#genreDrilldown')).includes('No titles match this filter.'));
    check('filter-empty keeps the returned public count', /\b9\b/.test(await text(page, '.genre-public-count')), await text(page, '.genre-public-count'));
    await shot(page, '1440-genre-filtered-empty');
    await setSelect(page, 'status', 'ALL');
    await setSelect(page, 'format', 'ALL');
    await setSelect(page, 'sort', 'YEAR');
    const yearIds = (await genreRows(page)).map((row) => row.id);
    check('year sort puts unknown years last', yearIds.at(-1) === 91004, JSON.stringify(yearIds));
    await clickSel(page, '[data-action="close-genre"]');
    check('close restores the replacement SVG trigger after async rerender', (await js(page, () => document.activeElement?.getAttribute('data-genre'))) === 'Action');
    await clickSel(page, '[data-genre="Adventure"]');
    check('genre with statistics but no public titles shows honest empty state', (await text(page, '#genreDrilldown')).includes('No public titles in this genre.') && (await genreRows(page)).length === 0, await text(page, '#genreDrilldown'));
    await shot(page, '1440-genre-empty');

    mode = 'loading';
    heldTitles = new Promise((resolve) => { release = resolve; });
    await setInput(page, '#statsUsername', 'qa_genre_focus');
    await submitForm(page, '#statsForm');
    await page.waitForSelector('[data-genre="Action"]');
    await page.focus('[data-genre="Action"]');
    mode = 'ready';
    release();
    await page.waitFor(() => !!document.querySelector('.chart-title-label'), { label: 'focused fixture titles ready' });
    check('pending title query preserves focused SVG genre row', (await js(page, () => document.activeElement?.getAttribute('data-genre'))) === 'Action');
    await page.key('Enter');
    check('preserved genre focus remains keyboard-operable after load', (await text(page, '#genrePanelTitle')) === 'Action');
    await page.key('Escape');
    await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
    await sleep(350);
    check('chart width redraw preserves focused SVG genre row', (await js(page, () => document.activeElement?.getAttribute('data-genre'))) === 'Action');
    await page.key('Enter');
    check('preserved genre focus remains keyboard-operable after resize', (await text(page, '#genrePanelTitle')) === 'Action');
    const scrollable = await js(page, () => { const list = document.querySelector('.genre-title-list'); return { tabindex: list?.getAttribute('tabindex'), overflow: list && getComputedStyle(list).overflowY }; });
    check('bounded results list is keyboard-focusable for scrolling', scrollable.tabindex === '0' && scrollable.overflow === 'auto', JSON.stringify(scrollable));
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

    for (const next of ['empty', 'private']) {
      mode = next;
      await js(page, () => sessionStorage.clear());
      await setInput(page, '#statsUsername', 'qa_genre_' + next);
      await submitForm(page, '#statsForm');
      await page.waitForSelector('[data-genre="Action"]');
      await page.waitFor(() => !document.querySelector('[data-panel="titles"] .chart-loading'), { label: 'fixture titles settled' });
      await clickSel(page, '[data-genre="Action"]');
      const message = await text(page, '#genreDrilldown');
      check(next === 'private' ? 'private title-query error shows unavailable state without error dump' : 'empty public title response shows specific empty state', (next === 'private' ? /unavailable/i.test(message) && !/Private list/.test(message) : message.includes('No public titles in this genre.')) && (await genreRows(page)).length === 0, message);
      await shot(page, '1440-genre-' + next);
    }
    await checkGenreNetwork(page, 'genre-fixtures');
  } finally {
    release();
    await page.close();
    await context.close();
  }
}

async function item14 () {
  item(14);
  const { createAppServer } = await import('../server.js');
  const upstreamFetch = globalThis.fetch;
  const annServer = createAppServer();
  const context = await browser.newContext();
  const page = await context.newPage();
  let release;
  let upstreamCalls = 0;
  const held = new Promise((resolve) => { release = resolve; });
  const headlines = Array.from({ length: 6 }, (_, index) => ({ title: index === 0 ? 'Frieren Season 3 Confirmed' : index === 4 ? 'A longer anime news headline about an upcoming television adaptation and its cast. '.repeat(3).trim() : 'ANN headline ' + index, link: 'https://www.animenewsnetwork.com/news/2026-10-19/story-' + index, publishedAt: new Date(Date.now() - (index + 1) * 3600000).toISOString(), summary: 'A short excerpt & context.', source: 'Anime News Network' }));
  const rss = '<rss version="2.0"><channel>' + headlines.map((entry) => '<item><title>' + entry.title + '</title><link>' + entry.link + '</link><pubDate>' + new Date(entry.publishedAt).toUTCString() + '</pubDate><description><![CDATA[<p>A short <b>excerpt</b> &amp; context.</p>]]></description></item>').join('') + '</channel></rss>';
  globalThis.fetch = async (url, options) => {
    if (!/animenewsnetwork\.com/.test(String(url))) return upstreamFetch(url, options);
    upstreamCalls += 1;
    await held;
    if (String(url).includes('/rss.xml')) return new Response(rss, { headers: { 'content-type': 'application/rss+xml' } });
    const index = headlines.findIndex((entry) => entry.link === String(url));
    return new Response('<html><head><meta property="og:image" content="https://www.animenewsnetwork.com/thumbnails/fit600x400/cms/news/qa-article-' + index + '.jpg"></head></html>', { headers: { 'content-type': 'text/html' } });
  };
  await new Promise((resolve) => annServer.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + annServer.address().port;
  const mockAniList = async (target) => {
    await target.route('*graphql.anilist.co*', (request) => {
      if (request.method === 'OPTIONS') return PREFLIGHT;
      const body = JSON.parse(request.postData);
      if (body.query.includes('UserStats')) {
        const division = { count: body.variables.name === 'qa_ann_large' ? 1000000 : 0, meanScore: 0, minutesWatched: 0, episodesWatched: 0, chaptersRead: 0, volumesRead: 0, scores: [], statuses: [], formats: [], genres: [], releaseYears: [], startYears: [] };
        return { status: 200, headers: CORS_HEADERS, body: JSON.stringify({ data: { User: { id: 999997, name: body.variables.name, avatar: { medium: null }, bannerImage: null, statistics: { anime: division, manga: division } } } }) };
      }
      if (body.query.includes('UserTitles')) return { status: 200, headers: CORS_HEADERS, body: JSON.stringify({ data: { MediaListCollection: { hasNextChunk: false, lists: [] } } }) };
      if (body.query.includes('SearchMedia')) return { status: 200, headers: CORS_HEADERS, body: JSON.stringify({ data: { Page: { media: [] } } }) };
      return null;
    });
  };
  const newsRequests = (target) => target.events.requests.filter((request) => request.url.includes('/api/ann/news'));
  const waitAnnSettled = async (target) => target.waitFor(() => {
    const host = document.querySelector('#annWire');
    return host && (host.querySelector('.ann-news-item') || (host.querySelector('.ann-status') && !/loading/i.test(host.textContent)));
  }, { label: 'ANN state settled', timeout: 15000 });
  const audit = async (target, label) => {
    const errors = target.events.consoleErrors.filter((entry) => !/status of (?:404|429|502|503)|favicon/i.test(entry.text || ''));
    const origins = [...new Set(target.events.requests.map((request) => new URL(request.url).origin))];
    const allowed = new Set([origin, server.origin, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://graphql.anilist.co', 'https://www.animenewsnetwork.com']);
    check(label + ': no unexpected console errors or exceptions', errors.length === 0 && target.events.exceptions.length === 0, JSON.stringify({ errors, exceptions: target.events.exceptions }));
    check(label + ': browser contacts only same-origin proxy, AniList, ANN artwork and fonts', origins.every((value) => allowed.has(value) || /^https:\/\/[^/]*anilist\.co$/.test(value)), origins.join(' '));
    const failed = target.events.failed.filter((entry) => !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(entry.url || ''));
    check(label + ': no failed app or API network requests', failed.length === 0, JSON.stringify(failed));
    await fs.writeFile(path.join(artifacts, label + '-network.json'), JSON.stringify({ consoleErrors: target.events.consoleErrors, exceptions: target.events.exceptions, origins, requests: target.events.requests, failed: target.events.failed }, null, 2));
  };
  try {
    await mockAniList(page);
    await page.route('*animenewsnetwork.com/thumbnails*', () => ({ status: 200, headers: { 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#3DB4F2"/></svg>' }));
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.goto(origin + '/');
    await page.waitForSelector('#annWire .ann-status');
    check('ANN starts on the initial stats view and exposes loading state', /loading/i.test(await text(page, '#annWire .ann-status')) && newsRequests(page).length === 1 && (await count(page, '#statsForm')) === 1, await text(page, '#annWire'));
    await setInput(page, '#statsUsername', 'qa_ann_large');
    await submitForm(page, '#statsForm');
    await waitCount(page, '.panel[data-panel]', 7);
    check('held ANN request never blocks AniList stats or adds an eighth chart', (await count(page, '.panel[data-panel]')) === 7 && /loading/i.test(await text(page, '#annWire .ann-status')));
    await js(page, () => document.fonts.ready.then(() => true));
    const summaryBounds = await js(page, () => [...document.querySelectorAll('.summary-value')].map((value) => { const range = document.createRange(); range.selectNodeContents(value); const text = range.getBoundingClientRect(); const cell = value.closest('.summary-cell'); const bounds = cell.getBoundingClientRect(); const style = getComputedStyle(cell); return { text: value.textContent.trim(), left: text.left, right: text.right, cellLeft: bounds.left + parseFloat(style.paddingLeft), cellRight: bounds.right - parseFloat(style.paddingRight) }; }));
    check('desktop sidebar summary keeps a million-title total inside its cell', summaryBounds[0].text === '1,000,000' && summaryBounds.every((value) => value.left >= value.cellLeft - 1 && value.right <= value.cellRight + 1), JSON.stringify(summaryBounds));
    await shot(page, '1440-ann-large-summary');
    release();
    await waitCount(page, '.ann-news-item', 5);
    const articles = await js(page, () => [...document.querySelectorAll('.ann-news-item')].map((item) => ({ title: item.querySelector('.ann-news-link')?.textContent.trim(), link: item.querySelector('.ann-news-link')?.href, target: item.querySelector('.ann-news-link')?.target, rel: item.querySelector('.ann-news-link')?.rel, time: item.querySelector('.ann-news-time')?.textContent.trim(), summary: item.querySelector('.ann-news-summary')?.textContent.trim() })));
    check('real Node proxy renders only the five latest RSS headlines', articles.length === 5 && articles[0].title === headlines[0].title && articles.at(-1).title === headlines[4].title && upstreamCalls === 6, JSON.stringify(articles));
    check('headlines use safe ANN HTTPS outbound links', articles.every((article) => /^https:\/\/(?:www\.)?animenewsnetwork\.com\/news\//.test(article.link) && (article.target !== '_blank' || /noopener/.test(article.rel))), JSON.stringify(articles.map((article) => ({ link: article.link, rel: article.rel }))));
    check('headlines have relative timestamps, bounded plain excerpts and attribution', articles.every((article) => !!article.time && !/^\d{4}-\d\d-\d\dT/.test(article.time) && article.summary === 'A short excerpt & context.' && article.summary.length <= 200) && /via Anime News Network/i.test(await text(page, '#annWire')) && (await count(page, '.ann-news-summary b, .ann-news-summary p')) === 0);
    const metadata = await js(page, () => [...document.querySelectorAll('.ann-news-meta')].map((meta) => ({ text: meta.textContent.trim(), time: meta.querySelector('time')?.textContent.trim(), children: [...meta.children].map((node) => node.tagName) })));
    check('article metadata contains only its timestamp and no repeated ANN tag or Find action', (await count(page, '[data-action="find-ann"]')) === 0 && metadata.length === 5 && metadata.every((meta) => meta.text === meta.time && JSON.stringify(meta.children) === '["TIME"]'), JSON.stringify(metadata));
    await setInput(page, '#statsUsername', 'qa_ann');
    await submitForm(page, '#statsForm');
    await page.waitFor(() => document.querySelector('.summary-value')?.textContent.trim() === '0', { label: 'standard ANN fixture summary' });
    for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
      await page.setViewport({ width, height, deviceScaleFactor: width === 390 ? 2 : 1, mobile: width === 390 });
      await page.scrollTo('#annWire');
      await sleep(250);
      const dimensions = await viewportState(page);
      const fits = await js(page, () => [...document.querySelectorAll('.ann-news-item')].every((el) => { const bounds = el.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth + 1; }));
      check('ANN Wire fits ' + width + ' without page overflow', dimensions.docWidth <= dimensions.innerWidth + 1 && fits, JSON.stringify(dimensions));
      await page.waitFor(() => [...document.querySelectorAll('.ann-art img')].every((img) => img.complete), { timeout: 15000, label: 'ANN artwork settled' });
      const images = await js(page, () => [...document.querySelectorAll('.ann-news-item')].map((item) => { const img = item.querySelector('.ann-art img'); return { src: img?.getAttribute('src'), width: img?.naturalWidth || 0, loading: img?.loading, alt: img?.alt, referrerPolicy: img?.referrerPolicy }; }));
      check('ANN ' + width + ' article artwork uses the matching publisher metadata and loads', images.length === 5 && images.every((img, index) => img.src === 'https://www.animenewsnetwork.com/thumbnails/fit600x400/cms/news/qa-article-' + index + '.jpg' && img.width > 0 && img.loading === 'lazy' && img.alt === '' && img.referrerPolicy === 'no-referrer'), JSON.stringify(images));
      await shot(page, width + '-ann-wire');
    }
    const beforeReload = newsRequests(page).length;
    await page.reload();
    await waitCount(page, '.ann-news-item', 5);
    check('five-minute client session cache avoids another proxy request on reload', newsRequests(page).length === beforeReload && upstreamCalls === 6, newsRequests(page).length + ' proxy requests / ' + upstreamCalls + ' upstream requests');
    await js(page, () => { const key = 'anigraph:v1:cache:ann:news:images'; const cached = JSON.parse(sessionStorage.getItem(key)); cached.at -= 5 * 60 * 1000 + 1; sessionStorage.setItem(key, JSON.stringify(cached)); });
    await page.reload();
    await waitCount(page, '.ann-news-item', 5);
    check('expired client cache refreshes proxy while the server reuses its ten-minute cache', newsRequests(page).length === beforeReload + 1 && upstreamCalls === 6, newsRequests(page).length + ' proxy requests / ' + upstreamCalls + ' upstream requests');
    const sourceLinks = await js(page, () => [...document.querySelectorAll('.ann-news-item')].map((item) => ({ headline: item.querySelector('.ann-news-link')?.href, artwork: item.querySelector('.ann-art-link')?.href })));
    check('headline and image anchors directly open the matching source without launching AniList search', sourceLinks.length === 5 && sourceLinks.every((item, index) => item.headline === headlines[index].link && item.artwork === item.headline) && !page.events.requests.some((request) => String(request.postData).includes('query SearchMedia')) && (await js(page, () => document.querySelector('#viewStats').hidden)) === false, JSON.stringify(sourceLinks));
    await audit(page, 'ann-proxy');

    const fixtureContext = await browser.newContext();
    const fixture = await fixtureContext.newPage();
    let mode = 'empty';
    const unsafeNews = [{ ...headlines[0], title: '<img src=x onerror="window.__annInjected=1">', summary: '<script>window.__annInjected=1</script> & words' }, ...headlines.slice(1), { ...headlines[0], link: 'javascript:alert(1)' }, { ...headlines[0], link: 'https://evil.test/news' }];
    try {
      await mockAniList(fixture);
      await fixture.route('*/api/ann/news*', () => ({ status: mode === 'offline' ? 502 : mode === 'rate' ? 429 : 200, headers: { 'content-type': 'application/json', ...(mode === 'rate' ? { 'retry-after': '2' } : {}) }, body: JSON.stringify(mode === 'empty' ? [] : mode === 'offline' ? { error: 'Upstream unavailable.' } : mode === 'rate' ? { error: 'Slow down.', retryAfter: 2 } : mode === 'malformed' ? { unexpected: true } : mode === 'unsafe' ? unsafeNews : headlines.slice(0, 5)) }));
      await fixture.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
      await fixture.goto(server.url + 'index.html');
      await waitAnnSettled(fixture);
      check('empty ANN feed has a specific quiet state and preserves stats form', /no .*headlines|no news|quiet|empty|nothing/i.test(await text(fixture, '#annWire .ann-status')) && (await count(fixture, '.ann-news-item')) === 0 && (await count(fixture, '#statsForm')) === 1, await text(fixture, '#annWire'));
      await shot(fixture, '1440-ann-empty');
      for (const next of ['offline', 'malformed']) {
        mode = next;
        await js(fixture, () => sessionStorage.clear());
        await fixture.reload();
        await waitAnnSettled(fixture);
        check(next + ' proxy produces honest wire-offline state with retry', /WIRE OFFLINE/i.test(await text(fixture, '#annWire')) && (await count(fixture, '[data-action="retry-ann"]')) === 1 && (await count(fixture, '#statsForm')) === 1, await text(fixture, '#annWire'));
      }
      await shot(fixture, '1440-ann-offline');
      mode = 'ready';
      await clickSel(fixture, '[data-action="retry-ann"]');
      await waitCount(fixture, '.ann-news-item', 5);
      check('ANN retry recovers independently after proxy failure', (await count(fixture, '#statsForm')) === 1 && (await count(fixture, '.ann-news-item')) === 5);
      mode = 'rate';
      await js(fixture, () => sessionStorage.clear());
      await fixture.reload();
      await fixture.waitFor(() => document.querySelector('#annWire [data-rate-button]')?.disabled, { label: 'ANN429countdown' });
      check('upstream429 shows a disabled retry and Retry-After countdown', (await count(fixture, '#annWire [data-rate-countdown]')) === 1 && (await count(fixture, '.ann-news-item')) === 0, await text(fixture, '#annWire'));
      await shot(fixture, '1440-ann-429');
      await fixture.waitFor(() => { const button = document.querySelector('#annWire [data-rate-button]'); return button && !button.disabled; }, { label: 'ANN429retry enabled', timeout: 10000 });
      mode = 'ready';
      await clickSel(fixture, '[data-action="retry-ann"]');
      await waitCount(fixture, '.ann-news-item', 5);
      check('ANN retry enables and recovers after Retry-After expires', (await count(fixture, '.ann-news-item')) === 5);
      mode = 'unsafe';
      await js(fixture, () => sessionStorage.clear());
      await fixture.reload();
      await waitCount(fixture, '.ann-news-item', 5);
      const links = await js(fixture, () => [...document.querySelectorAll('.ann-news-link')].map((link) => link.href));
      check('hostile headlines and excerpts are text while unsafe links are excluded', (await count(fixture, '#annWire img, #annWire script')) === 0 && (await js(fixture, () => window.__annInjected || 0)) === 0 && links.length === 5 && links.every((link) => /^https:\/\/(?:www\.)?animenewsnetwork\.com\/news\//.test(link)), JSON.stringify(links));
      await audit(fixture, 'ann-fixtures');
    } finally {
      await fixture.close();
      await fixtureContext.close();
    }
    const fileContext = await browser.newContext();
    const file = await fileContext.newPage();
    try {
      await file.goto(fileUrl(path.join(repo, 'index.html')));
      await file.waitForSelector('#annWire .ann-status');
      check('file:// shows WIRE OFFLINE with a safe external ANN link and no proxy fetch', /WIRE OFFLINE/i.test(await text(file, '#annWire')) && newsRequests(file).length === 0 && (await js(file, () => [...document.querySelectorAll('#annWire a')].some((link) => /^https:\/\/(?:www\.)?animenewsnetwork\.com\//.test(link.href)))) && (await count(file, '#statsForm')) === 1, await text(file, '#annWire'));
      check('file:// ANN fallback causes no exceptions or new API request', file.events.exceptions.length === 0 && !file.events.requests.some((request) => request.url.includes('graphql.anilist.co')));
      await shot(file, '1440-ann-file-offline');
    } finally {
      await file.close();
      await fileContext.close();
    }
  } finally {
    release();
    globalThis.fetch = upstreamFetch;
    await page.close();
    await context.close();
    annServer.closeAllConnections();
    await new Promise((resolve) => annServer.close(resolve));
  }
}

async function item15 () {
  item(15);
  const context = await browser.newContext();
  const page = await context.newPage();
  const frozenNow = Date.parse('2026-10-21T12:00:00+07:00');
  const requests = [];
  let mode = 'loading';
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const installClock = async (target, instant, timezone) => {
    await target.cdp.send('Emulation.setTimezoneOverride', { timezoneId: timezone }, target.sessionId);
    await target.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__qaNow=' + (instant - Date.now()) + '; const RealDate=Date; window.Date=class extends RealDate { constructor(...args) { super(...(args.length ? args : [RealDate.now()+window.__qaNow])); } static now() { return RealDate.now()+window.__qaNow; } };' }, target.sessionId);
  };
  const json = (data, status = 200, headers = {}) => ({ status, headers: { ...CORS_HEADERS, ...headers }, body: JSON.stringify(data) });
  const schedule = (id, airingAt, title = 'Scheduled title ' + id, mediaId = id + 1000) => ({ id, airingAt, episode: id === 106 ? 6 : 5, media: { id: mediaId, type: 'ANIME', title: { romaji: title, english: null, native: null }, format: 'TV', coverImage: { medium: null, large: null }, siteUrl: 'javascript:alert(1)' } });
  const fixture = (variables) => {
    const start = variables.start + 1;
    const rows = [
      schedule(101, start, 'Monday opening'),
      schedule(102, start + 23 * 3600 + 30 * 60, 'Monday late local time'),
      schedule(103, start + 2 * 86400 + 11 * 3600, 'Already aired'),
      schedule(104, start + 2 * 86400 + 12 * 3600 + 30, 'Due shortly'),
      schedule(105, start + 2 * 86400 + 18 * 3600, 'Alpha simultaneous', 1105),
      schedule(106, start + 2 * 86400 + 18 * 3600, 'Bravo simultaneous', 1105),
      schedule(107, variables.end - 1, 'Sunday final second'),
      schedule(111, start + 3 * 86400 + 20 * 3600, 'Title <img src=x onerror="window.__radarInjected=1"> & context')
    ];
    return variables.page === 1 ? rows.slice(0, 4) : rows.slice(4).concat([
      rows[4], schedule(109, start - 1, 'Outside before week'), schedule(110, variables.end, 'Outside after week'),
      { ...schedule(112, start + 1), media: null }
    ]);
  };
  const mock = async (target, log = requests) => {
    await target.route('*/api/ann/news*', () => json([]));
    await target.route('*graphql.anilist.co*', async (request) => {
      if (request.method === 'OPTIONS') return PREFLIGHT;
      const body = JSON.parse(request.postData);
      if (body.query.includes('AiringRadar')) {
        log.push(body);
        if (mode === 'loading') await held;
        if (mode === 'error') return json({ errors: [{ message: 'Fixture upstream unavailable', status: 503 }] }, 503);
        if (mode === 'rate') return json({ errors: [{ message: 'Too Many Requests', status: 429 }] }, 429, { 'retry-after': '2' });
        if (mode === 'malformed') return json({ data: { Page: { pageInfo: { hasNextPage: false } } } });
        const v = body.variables;
        const rows = mode === 'empty' ? [] : mode === 'cap' ? Array.from({ length: 50 }, (_, index) => schedule(20000 + (v.page - 1) * 50 + index, v.start + 61 + ((v.page - 1) * 50 + index) * 60)) : fixture(v);
        return json({ data: { Page: { pageInfo: { currentPage: v.page, hasNextPage: mode === 'cap' || (mode !== 'empty' && v.page === 1) }, airingSchedules: rows } } });
      }
      if (body.query.includes('UserStats')) {
        const division = { count: 0, meanScore: 0, minutesWatched: 0, episodesWatched: 0, chaptersRead: 0, volumesRead: 0, scores: [], statuses: [], formats: [], genres: [], releaseYears: [], startYears: [] };
        return json({ data: { User: { id: 999996, name: body.variables.name, avatar: { medium: null }, bannerImage: null, statistics: { anime: division, manga: division } } } });
      }
      if (body.query.includes('UserTitles')) return json({ data: { MediaListCollection: { hasNextChunk: false, lists: [] } } });
      return null;
    });
  };
  const settled = async (target) => target.waitFor(() => {
    const host = document.querySelector('#viewRadar');
    return host && !host.hidden && host.getAttribute('aria-busy') !== 'true' && !host.querySelector('.skeleton');
  }, { label: 'Radar state settled', timeout: 15000 });
  const rows = async (target) => js(target, () => [...document.querySelectorAll('#viewRadar li.radar-episode')].map((row) => ({ id: Number(row.dataset.scheduleId), text: row.textContent.replace(/\s+/g, ' ').trim(), link: row.querySelector('a.radar-title-link')?.href, title: row.querySelector('a.radar-title-link')?.textContent, iso: row.querySelector('time.radar-airing-time')?.dateTime, time: row.querySelector('time.radar-airing-time')?.textContent, countdown: row.querySelector('.radar-countdown')?.textContent.trim(), timestamp: Number(row.querySelector('.radar-countdown')?.dataset.radarAiring), day: [...document.querySelectorAll('.radar-day')].indexOf(row.closest('.radar-day')) })));
  const fresh = async (next) => {
    mode = next;
    await js(page, () => sessionStorage.clear());
    await page.reload();
    await clickSel(page, '[data-view-target="radar"]');
    await settled(page);
  };
  try {
    await installClock(page, frozenNow, 'Asia/Jakarta');
    await mock(page);
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.goto(server.url + 'index.html');
    await page.waitForSelector('[data-view-target="radar"]');
    check('Radar remains lazy alongside the new Library view', requests.length === 0 && (await count(page, '[data-view-target]')) === 4 && !page.events.requests.some((request) => /UserStats/.test(request.postData || '')));
    await page.focus('[data-view-target="tiers"]');
    await page.key('Tab');
    check('Tab reaches the Radar view button with visible focus', await js(page, () => { const active = document.activeElement; const style = getComputedStyle(active); return active?.dataset.viewTarget === 'radar' && style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2; }));
    await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }, page.sessionId);
    await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId);
    await page.waitFor(() => !!document.querySelector('#viewRadar .skeleton'), { label: 'Radar loading skeleton' });
    check('Radar has an announced loading state with skeletons and no spinner', (await js(page, () => document.querySelector('#viewRadar').getAttribute('aria-busy'))) === 'true' && (await count(page, '#viewRadar .spinner, #viewRadar [role="progressbar"]')) === 0 && (await count(page, '#radarTitle')) === 1);
    check('global anime Radar hides the media switch and other views', await js(page, () => getComputedStyle(document.querySelector('.division-switch')).display === 'none' && document.querySelector('#statsLayout').hidden && document.querySelector('#viewTiers').hidden && !document.querySelector('#viewRadar').hidden && document.querySelector('[data-view-target="radar"]').getAttribute('aria-current') === 'page'));
    await shot(page, '1440-radar-loading');
    mode = 'ready';
    release();
    await waitCount(page, '#viewRadar li.radar-episode', 8);
    await settled(page);
    const initial = await rows(page);
    const expectedBounds = await js(page, () => { const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (start.getDay() + 6) % 7); const end = new Date(start); end.setDate(end.getDate() + 7); return { start: start.getTime() / 1000, end: end.getTime() / 1000 }; });
    check('Radar requests local Monday midnight through next Monday exclusively', requests.length === 2 && requests.every((request) => request.variables.start === expectedBounds.start - 1 && request.variables.end === expectedBounds.end && !('name' in request.variables) && !('type' in request.variables)), JSON.stringify(requests.map((request) => request.variables)));
    check('Radar uses the shared GraphQL query with bounded sequential pagination', requests.map((request) => request.variables.page).join(',') === '1,2' && /perPage:\s*50/.test(requests[0].query) && /airingAt_greater:\s*\$start/.test(requests[0].query) && /airingAt_lesser:\s*\$end/.test(requests[0].query), requests[0].query);
    check('seven day columns group the local week and sort episode times', (await count(page, '.radar-board .radar-day')) === 7 && initial.map((row) => row.id).join(',') === '101,102,103,104,105,106,111,107' && initial.map((row) => row.day).join(',') === '0,0,2,2,2,2,3,6', JSON.stringify(initial));
    check('duplicate schedule IDs and invalid or outside-week entries are omitted', initial.length === 8 && new Set(initial.map((row) => row.id)).size === 8 && !initial.some((row) => [109,110,112,113].includes(row.id)));
    check('simultaneous episodes retain their distinct schedule IDs', initial.filter((row) => [105,106].includes(row.id)).length === 2 && initial.find((row) => row.id === 105).link === initial.find((row) => row.id === 106).link);
    check('week range and resolved local timezone are visible', /19/.test(await text(page, '.radar-week')) && /25/.test(await text(page, '.radar-week')) && /Asia\/Jakarta/.test(await text(page, '.radar-timezone')), JSON.stringify({ week: await text(page, '.radar-week'), timezone: await text(page, '.radar-timezone') }));
    check('airing times expose ISO timestamps and local 23:30 display', initial.every((row) => Number.isFinite(Date.parse(row.iso)) && Date.parse(row.iso) / 1000 === row.timestamp) && /23:30|11:30\s*PM/i.test(initial.find((row) => row.id === 102).time), JSON.stringify(initial.map((row) => ({ id: row.id, iso: row.iso, time: row.time }))));
    check('past episodes read Aired while future episodes have a countdown', /aired/i.test(initial.find((row) => row.id === 103).countdown) && /\d/.test(initial.find((row) => row.id === 105).countdown) && !/aired/i.test(initial.find((row) => row.id === 105).countdown), JSON.stringify(initial.map((row) => ({ id: row.id, countdown: row.countdown }))));
    check('titles are escaped and outbound links are constructed from media IDs', initial.every((row) => /^https:\/\/anilist\.co\/anime\/\d+$/.test(row.link)) && initial.find((row) => row.id === 111).title.includes('<img src=x') && (await count(page, '#viewRadar img, #viewRadar script')) === 0 && !(await js(page, () => window.__radarInjected)), JSON.stringify(initial.map((row) => row.link)));
    check('days with no episodes keep an explicit empty message', await js(page, () => [...document.querySelectorAll('.radar-day')].filter((day) => !day.querySelector('.radar-episode')).every((day) => /no .*episodes|no .*airings|nothing.*air|no scheduled/i.test(day.textContent))));
    for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
      await page.setViewport({ width, height, deviceScaleFactor: width === 390 ? 2 : 1, mobile: width === 390 });
      await page.scrollTo('#radarTitle');
      await sleep(150);
      const dimensions = await viewportState(page);
      const fits = await js(page, () => [...document.querySelectorAll('.radar-day, .radar-episode')].every((el) => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1; }));
      check('Radar fits ' + width + ' without page or episode overflow', dimensions.docWidth <= dimensions.innerWidth + 1 && fits, JSON.stringify(dimensions));
      const masthead = await js(page, () => [...document.querySelectorAll('.brand-block, .brand-word, .view-nav, .view-tab')].map((el) => { const box = el.getBoundingClientRect(); return { selector: el.className, left: box.left, right: box.right, width: box.width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; }));
      check('brand and all four navigation tabs fit ' + width + ' without clipping', masthead.every((el) => el.left >= -1 && el.right <= width + 1 && el.width > 0 && el.scrollWidth <= el.clientWidth + 1), JSON.stringify(masthead));
      await shot(page, width + '-radar-week');
    }
    await js(page, () => { window.__qaNow += 61000; });
    await page.waitFor(() => /aired/i.test(document.querySelector('[data-schedule-id="104"] .radar-countdown')?.textContent || ''), { label: '30 second clock updates Radar countdown', timeout: 34000 });
    check('the existing clock refreshes countdowns without another API request', requests.length === 2 && /aired/i.test((await rows(page)).find((row) => row.id === 104).countdown));
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await clickSel(page, '[data-action="radar-next"]');
    await page.waitFor(() => !document.querySelector('#viewRadar .skeleton'), { label: 'next Radar week loaded' });
    await settled(page);
    check('next week advances the local calendar bounds and requests fresh pages', requests.length === 4 && requests.at(-1).variables.start === expectedBounds.start + 7 * 86400 - 1 && requests.at(-1).variables.end === expectedBounds.end + 7 * 86400, JSON.stringify(requests.at(-1).variables));
    await clickSel(page, '[data-action="radar-prev"]');
    await settled(page);
    check('previous week restores its cached schedules without a request', requests.length === 4 && (await rows(page)).map((row) => row.id).join(',') === initial.map((row) => row.id).join(','));
    await clickSel(page, '[data-action="radar-prev"]');
    await settled(page);
    check('previous week can move before the current week', requests.length === 6 && requests.at(-1).variables.start === expectedBounds.start - 7 * 86400 - 1, JSON.stringify(requests.at(-1).variables));
    await clickSel(page, '[data-action="radar-today"]');
    await settled(page);
    check('this week action returns to the current local week using cache', requests.length === 6 && /19/.test(await text(page, '.radar-week')));
    await page.reload();
    await settled(page);
    check('Radar view restores on reload and reuses the shared five-minute session cache', requests.length === 6 && (await count(page, '#viewRadar li.radar-episode')) === 8);
    await js(page, () => { for (const [key, value] of Object.entries(sessionStorage)) { if (!key.includes('AiringRadar')) continue; const cached = JSON.parse(value); cached.at -= 300001; sessionStorage.setItem(key, JSON.stringify(cached)); } });
    await page.reload();
    await settled(page);
    check('expired shared GraphQL cache refreshes the Radar pages', requests.length === 8, requests.length + ' Radar requests');
    for (const next of ['empty', 'error', 'malformed']) {
      await fresh(next);
      const body = await text(page, '#viewRadar');
      check(next === 'empty' ? 'empty whole week has an explicit message' : next + ' response has an honest error state and exactly one retry', (await count(page, '#viewRadar .radar-episode')) === 0 && (next === 'empty' ? /no .*episodes|no .*airings|nothing.*air|no schedule/i.test(body) : (await count(page, '[data-action="retry-radar"]')) === 1 && /unavailable|could not|no signal|signal lost|failed|error/i.test(body)), body);
      await shot(page, '1440-radar-' + next);
    }
    mode = 'ready';
    await clickSel(page, '[data-action="retry-radar"]');
    await waitCount(page, '#viewRadar .radar-episode', 8);
    check('Radar retry recovers without a profile or proxy dependency', (await count(page, '#viewRadar .radar-episode')) === 8 && !(await js(page, () => document.querySelector('#viewRadar').hidden)));
    await fresh('rate');
    await page.waitFor(() => document.querySelector('#viewRadar [data-rate-button]')?.disabled, { label: 'Radar 429 countdown' });
    check('Radar 429 shows Retry-After countdown and disables its sole retry', (await count(page, '#viewRadar [data-rate-countdown]')) >= 1 && (await count(page, '[data-action="retry-radar"]')) === 1 && (await count(page, '#viewRadar .radar-episode')) === 0, await text(page, '#viewRadar'));
    await shot(page, '1440-radar-429');
    await page.waitFor(() => { const button = document.querySelector('#viewRadar [data-rate-button]'); return button && !button.disabled; }, { label: 'Radar 429 retry enabled', timeout: 6000 });
    mode = 'ready';
    await clickSel(page, '[data-action="retry-radar"]');
    await waitCount(page, '#viewRadar .radar-episode', 8);
    check('Radar retries successfully after Retry-After expires', (await count(page, '#viewRadar .radar-episode')) === 8);
    const beforeCap = requests.length;
    await fresh('cap');
    check('pagination stops at ten pages and 500 episodes with a visible limit note', requests.length - beforeCap === 10 && (await count(page, '#viewRadar .radar-episode')) === 500 && /500/.test(await text(page, '#viewRadar')) && /limit|first|partial|more.*available/i.test(await text(page, '#viewRadar')), (requests.length - beforeCap) + ' pages / ' + (await count(page, '#viewRadar .radar-episode')) + ' episodes');
    await shot(page, '1440-radar-capped');
    mode = 'ready';
    const board = { v: 1, mediaId: 77777, type: 'MANGA', title: 'Radar navigation board', nativeTitle: '', cover: '', format: 'MANGA', year: 2020, averageScore: 80, updatedAt: frozenNow, page: 1, hasNext: false, tiers: { S: [777], A: [], B: [], C: [], D: [] }, pool: [], chars: [{ id: 777, name: 'Saved character', image: '' }] };
    await js(page, (record) => { localStorage.setItem('anigraph:v1:boards', JSON.stringify({ [record.mediaId]: record })); localStorage.setItem('anigraph:v1:ui', JSON.stringify({ view: 'tiers', type: 'MANGA', username: 'qa_radar', activeMediaId: record.mediaId })); sessionStorage.clear(); }, board);
    await page.reload();
    await page.waitForSelector('.board-page');
    const saved = await js(page, () => localStorage.getItem('anigraph:v1:boards'));
    await clickSel(page, '[data-view-target="radar"]');
    await settled(page);
    await clickSel(page, '[data-view-target="tiers"]');
    check('visiting anime Radar preserves the active manga board and division', /Radar navigation board/.test(await text(page, '.board-title')) && (await count(page, '[data-drop-tier="S"] .char-card[data-char-id="777"]')) === 1 && (await js(page, () => document.querySelector('[data-media-type="MANGA"]').getAttribute('aria-pressed'))) === 'true' && (await js(page, () => localStorage.getItem('anigraph:v1:boards'))) === saved);
    await clickSel(page, '[data-view-target="stats"]');
    await page.waitForSelector('#statsUsername');
    check('returning to stats restores the profile and visible manga division switch', (await js(page, () => document.querySelector('#statsUsername').value)) === 'qa_radar' && (await js(page, () => getComputedStyle(document.querySelector('.division-switch')).display)) !== 'none' && (await js(page, () => document.querySelector('[data-media-type="MANGA"]').getAttribute('aria-pressed'))) === 'true');
    const consoleErrors = page.events.consoleErrors.filter((entry) => !/status of (?:404|429|503)|favicon/i.test(entry.text || ''));
    const origins = [...new Set(page.events.requests.map((request) => new URL(request.url).origin))];
    check('Radar fixtures introduce no unexpected console errors or exceptions', consoleErrors.length === 0 && page.events.exceptions.length === 0, JSON.stringify({ consoleErrors, exceptions: page.events.exceptions }));
    check('Radar only contacts existing AniList, fonts and same-origin endpoints', origins.every((origin) => [server.origin, 'https://graphql.anilist.co', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(origin)), origins.join(' '));
    await fs.writeFile(path.join(artifacts, 'radar-fixtures-network.json'), JSON.stringify({ requests, consoleErrors: page.events.consoleErrors, exceptions: page.events.exceptions, origins, failed: page.events.failed }, null, 2));
    for (const [timezone, instant, expectedHours] of [['America/New_York', '2026-11-01T12:00:00-05:00', 169], ['America/New_York', '2026-03-08T12:00:00-04:00', 167]]) {
      const dstContext = await browser.newContext();
      const dst = await dstContext.newPage();
      const log = [];
      try {
        mode = 'empty';
        await installClock(dst, Date.parse(instant), timezone);
        await mock(dst, log);
        await dst.goto(server.url + 'index.html');
        await clickSel(dst, '[data-view-target="radar"]');
        await settled(dst);
        const bounds = await js(dst, () => { const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate() - (start.getDay() + 6) % 7); const end = new Date(start); end.setDate(end.getDate() + 7); return { start: start.getTime() / 1000, end: end.getTime() / 1000, startDay: start.getDay(), endDay: end.getDay(), startHour: start.getHours(), endHour: end.getHours() }; });
        check('local week remains Monday midnight across the ' + expectedHours + '-hour DST week', log.length === 1 && log[0].variables.start === bounds.start - 1 && log[0].variables.end === bounds.end && (bounds.end - bounds.start) / 3600 === expectedHours && bounds.startDay === 1 && bounds.endDay === 1 && bounds.startHour === 0 && bounds.endHour === 0, JSON.stringify({ bounds, query: log[0]?.variables }));
        await clickSel(dst, '[data-action="radar-next"]');
        await settled(dst);
        check('calendar week navigation preserves Monday midnight after ' + expectedHours + '-hour DST week', log.length === 2 && log[1].variables.start === bounds.end - 1, JSON.stringify(log.map((request) => request.variables)));
      } finally { await dst.close(); await dstContext.close(); }
    }
    const fileContext = await browser.newContext();
    const file = await fileContext.newPage();
    try {
      mode = 'ready';
      await installClock(file, frozenNow, 'Asia/Jakarta');
      await mock(file, []);
      await file.goto(fileUrl(path.join(repo, 'index.html')));
      await clickSel(file, '[data-view-target="radar"]');
      await waitCount(file, '#viewRadar .radar-episode', 8);
      check('file:// Radar loads direct AniList schedules while ANN stays offline', (await count(file, '#viewRadar .radar-episode')) === 8 && !file.events.requests.some((request) => request.url.includes('/api/ann/')) && file.events.exceptions.length === 0);
      await shot(file, '1440-radar-file');
    } finally { await file.close(); await fileContext.close(); }
    const liveContext = await browser.newContext();
    const live = await liveContext.newPage();
    try {
      await live.cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Jakarta' }, live.sessionId);
      await live.route('*/api/ann/news*', () => json([]));
      await live.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
      await live.goto(server.url + 'index.html');
      await clickSel(live, '[data-view-target="radar"]');
      await settled(live);
      const payload = await js(live, () => ({
        timezone: document.querySelector('.radar-timezone')?.textContent,
        range: document.querySelector('.radar-week')?.textContent,
        status: document.querySelector('.radar-message')?.textContent || null,
        count: document.querySelectorAll('.radar-episode').length,
        pages: Object.entries(sessionStorage).filter(([key]) => key.includes('AiringRadar')).map(([key, value]) => { const [, variables] = JSON.parse(key.slice('anigraph:v1:cache:'.length)); const cached = JSON.parse(value); return { variables, pageInfo: cached.data.Page?.pageInfo, schedules: cached.data.Page?.airingSchedules }; }),
        days: [...document.querySelectorAll('.radar-day')].map((day) => ({ date: day.dataset.day, count: day.querySelectorAll('.radar-episode').length }))
      }));
      payload.pages.sort((a, b) => a.variables.page - b.variables.page);
      const first = payload.pages[0]?.variables;
      const realIds = new Set(payload.pages.flatMap((page) => page.schedules || []).filter((entry) => Number.isInteger(entry.id) && entry.id > 0 && entry.media?.id > 0 && entry.airingAt > first.start && entry.airingAt < first.end).map((entry) => entry.id));
      check('live AniList weekly schedules render the actual returned episode count', payload.pages.length >= 1 && payload.pages.length <= 10 && payload.count === realIds.size && (payload.count > 0 || /no schedule available/i.test(payload.status || '')) && payload.pages.at(-1).pageInfo.hasNextPage === false, JSON.stringify({ range: payload.range, timezone: payload.timezone, count: payload.count, pages: payload.pages.map((page) => ({ page: page.variables.page, count: page.schedules?.length, hasNextPage: page.pageInfo?.hasNextPage })), status: payload.status }));
      check('live Radar has no uncaught browser exception or unexpected request origin', live.events.exceptions.length === 0 && live.events.requests.every((request) => [server.origin, 'https://graphql.anilist.co', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(new URL(request.url).origin) || /^https:\/\/[^/]*anilist\.co$/.test(new URL(request.url).origin)), JSON.stringify(live.events.exceptions));
      const scheduleById = new Map(payload.pages.flatMap((page) => page.schedules || []).map((entry) => [entry.id, entry]));
      const radarArtwork = await js(live, () => [...document.querySelectorAll('.radar-episode')].map((row) => ({ id: Number(row.dataset.scheduleId), mediaId: Number(row.dataset.mediaId), src: row.querySelector('.radar-art img')?.getAttribute('src') || null })));
      check('live Radar artwork matches each scheduled media id and its source cover', radarArtwork.length === payload.count && radarArtwork.length > 0 && radarArtwork.every((row) => { const entry = scheduleById.get(row.id); return row.mediaId === entry?.media.id && row.src === (entry?.media.coverImage?.large || entry?.media.coverImage?.medium || null); }), JSON.stringify(radarArtwork.slice(0, 5)));
      await clickSel(live, '[data-radar-day="ALL"]');
      for (const width of [1440, 768, 390]) {
        await live.setViewport({ width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
        await live.scrollTo('.radar-episode:first-child');
        await live.waitFor(() => { const img = document.querySelector('.radar-art img'); return img?.complete; }, { timeout: 25000, label: 'visible live Radar image settled' });
        const visual = await js(live, () => ({ innerWidth, docWidth: document.documentElement.scrollWidth, art: [...document.querySelectorAll('.radar-art')].map((slot) => { const r = slot.getBoundingClientRect(); const img = slot.querySelector('img'); return { width: r.width, height: r.height, naturalWidth: img?.naturalWidth || 0, loading: img?.loading, alt: img?.alt, referrerPolicy: img?.referrerPolicy }; }) }));
        check('live Radar ' + width + ' retains portrait slots, loaded artwork and viewport fit', visual.docWidth <= width + 1 && visual.art.length === payload.count && visual.art.some((art) => art.naturalWidth > 0) && visual.art.every((art) => art.width > 0 && Math.abs(art.width / art.height - 2 / 3) < 0.02 && art.loading === 'lazy' && art.alt === '' && art.referrerPolicy === 'no-referrer'), JSON.stringify({ width: visual.docWidth, art: visual.art.slice(0, 3) }));
        await shot(live, width + '-radar-live-images');
      }
      payload.artwork = radarArtwork;
      await fs.writeFile(path.join(artifacts, 'radar-live.json'), JSON.stringify({ when: new Date().toISOString(), ...payload, requests: live.events.requests, consoleErrors: live.events.consoleErrors, exceptions: live.events.exceptions }, null, 2));
      await shot(live, '1440-radar-live');
    } finally { await live.close(); await liveContext.close(); }
  } finally {
    release();
    await page.close();
    await context.close();
  }
}

let browser = null;
let server = null;
try {
  browser = await launchChrome();
  server = await serveDir(repo);
  try { await browser.grantPermissions(['clipboardReadWrite', 'clipboardSanitizedWrite'], server.origin); } catch (error) { console.log('clipboard permission grant failed: ' + error.message); }
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(server.url + 'index.html');
  await page.waitForSelector('#statsForm', { timeout: 20000 });
  await sleep(500);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await shot(page, '390-stats-empty', { fullPage: true });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
  const run = async (n, fn) => { try { await fn(); } catch (error) { check('item ' + n + ' threw', false, error && error.stack ? error.stack : String(error)); } };
  if (want(1)) await run(1, () => item1(page));
  if (want(2)) await run(2, () => item2(page));
  if (want(3)) await run(3, () => item3(page));
  if (want(4)) await run(4, () => item4(page));
  if (want(6)) await run(6, () => item6(page));
  if (want(5)) await run(5, () => item5(page));
  if (want(7)) await run(7, () => item7share(page));
  if (want(9)) await run(9, () => item9(page));
  if (want(7)) await run(7, () => item7archive(page));
  if (want(12)) await run(12, () => item12());
  if (want(13)) await run(13, () => item13());
  if (want(14)) await run(14, () => item14());
  if (want(15)) await run(15, () => item15());
  if (want(16)) await run(16, () => item16());
  if (want(17)) await run(17, () => item17());
  if (want(18)) await run(18, () => item18());
  if (want(8)) await run(8, () => item8(page));
  if (want(10)) await run(10, () => item10());
  if (want(11)) await run(11, () => item11());
} catch (error) {
  check('acceptance suite aborted', false, error && error.stack ? error.stack : String(error));
} finally {
  try { if (server) server.close(); } catch (error) {}
  try { if (browser) await browser.close(); } catch (error) {}
  try {
    await fs.mkdir(artifacts, { recursive: true });
    const failed = results.filter((result) => !result.ok).length;
    const byItem = {};
    for (const result of results) {
      if (!byItem[result.item]) byItem[result.item] = { total: 0, failed: 0, checks: [] };
      byItem[result.item].total += 1;
      if (!result.ok) byItem[result.item].failed += 1;
      byItem[result.item].checks.push(result);
    }
    const payload = { when: new Date().toISOString(), chrome: browser ? browser.version : null, server: server ? server.url : null, total: results.length, failed, byItem, results };
    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(payload, null, 2));
    const lines = ['# Anigraph acceptance run', '', 'When: ' + payload.when, 'Chrome: ' + payload.chrome, 'Entry: ' + payload.server + 'index.html', '', 'Total: ' + results.length + ', failed: ' + failed, ''];
    for (const key of Object.keys(byItem).sort((a, b) => Number(a) - Number(b))) {
      lines.push('## Item ' + key + ' — ' + (byItem[key].failed === 0 ? 'PASS' : 'FAIL') + ' (' + byItem[key].total + ' checks)');
      for (const result of byItem[key].checks) lines.push('- [' + (result.ok ? 'x' : ' ') + '] ' + result.name + (result.detail ? ' — ' + result.detail : ''));
      lines.push('');
    }
    await fs.writeFile(path.join(artifacts, 'summary.md'), lines.join('\n'));
    console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed; results in ' + artifacts);
    if (failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error('failed to write results', error);
    process.exitCode = 1;
  }
}
