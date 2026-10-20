import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, fileUrl, sleep } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-19');
await fs.mkdir(out, { recursive: true });
const browser = await launchChrome();
const results = [], requests = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
const json = (data, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Retry-After', ...headers }, body: JSON.stringify(data) });
const division = { count: 608, meanScore: 80, minutesWatched: 2000, episodesWatched: 100, chaptersRead: 100, volumesRead: 10, scores: [{ score: 80, count: 50 }], statuses: [{ status: 'COMPLETED', count: 600 }], formats: [{ format: 'TV', count: 600 }], genres: [{ genre: 'Action', count: 608, meanScore: 80 }], releaseYears: [{ releaseYear: 2024, count: 600 }], startYears: [] };
function fixture(type) {
  const manga = type === 'MANGA', offset = manga ? 20000 : 1000;
  const make = (i, status, genres, duration, chapters, format, title) => ({ progress: status === 'PLANNING' ? 0 : i, status, score: i % 4 === 0 ? 0 : 50 + i % 51,
    media: { id: offset + i, title: { romaji: title || 'Title ' + String(i).padStart(4, '0'), english: i === 1 ? 'Alternate Name One' : null, native: i === 1 ? '雨の図書館' : null }, coverImage: { large: i === 1 ? 'javascript:alert(1)' : 'https://s4.anilist.co/file/anilistcdn/qa-library.png' },
      format: format || (manga ? 'MANGA' : 'TV'), genres, duration, chapters, episodes: 12, startDate: { year: i === 2 ? null : 2000 + i % 25 } } });
  const rows = Array.from({ length: 600 }, (_, k) => make(k + 1, k % 2 ? 'CURRENT' : 'COMPLETED', [k % 2 ? 'Comedy' : 'Action'], 24, 100));
  rows.push(make(1001, 'PLANNING', ['Comedy', 'Slice of Life'], 12, 8, manga ? 'ONE_SHOT' : 'TV', 'Light One'));
  rows.push(make(1002, 'PLANNING', ['Action', 'Adventure'], 24, 40, null, 'Action One'));
  rows.push(make(1003, 'PLANNING', ['Drama', 'Psychological'], 90, 100, null, 'Drama One'));
  rows.push(make(1004, 'PLANNING', ['Comedy'], null, null, null, 'Unknown Length'));
  rows.push(make(1005, 'PLANNING', ['Fantasy', 'Adventure'], 24, 200, null, 'Fantasy One'));
  rows.push(make(1006, 'PLANNING', ['Comedy'], 12, 6, manga ? 'ONE_SHOT' : 'TV', 'Light Two'));
  rows.push(make(1007, 'PLANNING', ['Action'], 110, 50, manga ? 'MANGA' : 'MOVIE', 'Movie One'));
  rows.push(make(1008, 'DROPPED', ['Action'], 24, 10, null, '<img src=x onerror="window.__libraryInjected=1"> & Title'));
  return rows;
}
const data = { ANIME: fixture('ANIME'), MANGA: fixture('MANGA') };
let mode = 'ready', releaseSlow;
const slow = new Promise(resolve => { releaseSlow = resolve; });
async function route(page) {
  await page.route('*s4.anilist.co*', () => ({ status: 200, headers: { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="#223248"/></svg>' }));
  await page.route('*/api/ann/news*', () => json([]));
  await page.route('*graphql.anilist.co*', async request => {
    if (request.method === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept' }, body: '' };
    const body = JSON.parse(request.postData), v = body.variables;
    requests.push(body);
    if (body.query.includes('UserStats')) return json({ data: { User: v.name === 'missing' ? null : { id: 999999, name: v.name, avatar: { medium: null }, bannerImage: null, statistics: v.name === 'privateStats' ? null : { anime: division, manga: division } } } });
    if (body.query.includes('AiringRadar')) return json({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [] } } });
    if (!body.query.includes('UserTitles')) return null;
    if (v.name === 'slow') await slow;
    if (mode === 'rate' && v.chunk === 2) return json({ errors: [{ message: 'Slow down' }] }, 429, { 'retry-after': '1' });
    if (mode === 'private') return json({ errors: [{ message: 'Private list', status: 403 }], data: { MediaListCollection: null } });
    if (mode === 'malformed') return json({ data: { MediaListCollection: { lists: [] } } });
    if (mode === 'repeat') return json({ data: { MediaListCollection: { hasNextChunk: true, lists: [{ entries: data[v.type].slice(0, 2) }] } } });
    let rows = mode === 'empty' ? [] : mode === 'noPlans' ? data[v.type].filter(e => e.status !== 'PLANNING') : data[v.type];
    if (v.name === 'fast') rows = rows.slice(0, 1);
    const entries = rows.slice((v.chunk - 1) * 500, v.chunk * 500);
    if (v.chunk === 2 && rows.length > 500) entries.push({ ...rows[0], progress: 999 });
    return json({ data: { MediaListCollection: { hasNextChunk: v.chunk * 500 < rows.length, lists: [{ entries }] } } });
  });
}
const page = await browser.newPage();
const click = selector => page.evaluate(s => document.querySelector(s).click(), selector);
const select = (selector, value) => page.evaluate((s,v) => { const e = document.querySelector(s); e.focus(); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, selector, value);
const input = (selector, value) => page.evaluate((s,v) => { const e = document.querySelector(s); e.focus(); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, selector, value);
const ids = () => page.evaluate(() => [...document.querySelectorAll('.library-card')].map(e => Number(e.dataset.mediaId)));
async function load(name) {
  await input('#libraryUsername', name);
  await page.evaluate(() => document.querySelector('#libraryProfileForm').requestSubmit());
}
async function clear() { await click('[data-action="library-reset"]'); }
try {
  await route(page);
  await page.setReducedMotion(true);
  await page.setViewport({ width: 1224, height: 1000 });
  await page.goto('http://127.0.0.1:5174/');
  await click('[data-view-target="library"]');
  check('Library starts without a profile or collection request', requests.length === 0 && await page.evaluate(() => document.querySelector('#viewLibrary h1').textContent === 'My Library'));
  await load('');
  check('blank username focuses the visible library input without querying', requests.length === 0 && await page.evaluate(() => document.activeElement.id === 'libraryUsername'));
  await load('libraryTest');
  await page.waitForSelector('.library-card');
  check('collection follows hasNextChunk and requests both chunks', requests.filter(r => r.query.includes('UserTitles')).map(r => r.variables.chunk).join(',') === '1,2');
  check('query normalizes personal scores and includes real duration and continuation', requests.some(r => /score\(format: POINT_100\)/.test(r.query) && /duration/.test(r.query) && /hasNextChunk/.test(r.query)));
  check('complete library deduplicates entries across chunks and retains 608 titles', await page.evaluate(() => document.querySelector('.library-subtitle').textContent === '608 public titles · 7 planned'));
  check('large collection renders 48 covers and accessible pagination', (await ids()).length === 48 && await page.evaluate(() => document.querySelector('.library-pagination').textContent.includes('Page 1 of 13')));
  await click('[data-action="library-next"]');
  check('next page changes cards and focuses the results heading', (await ids()).length === 48 && await page.evaluate(() => document.activeElement.id === 'libraryResultTitle' && document.querySelector('.library-pagination').textContent.includes('Page 2 of 13')));
  const beforeFilters = requests.length;
  for (const type of ['ANIME', 'MANGA']) {
    await click('[data-media-type="' + type + '"]');
    await page.waitForSelector('.library-card');
    const rows = data[type];
    await input('#librarySearch', '雨の図書館');
    check(type + ' native title search includes aliases and keeps typing focus', JSON.stringify(await ids()) === JSON.stringify([rows[0].media.id]) && await page.evaluate(() => document.activeElement.id === 'librarySearch'));
    await input('#librarySearch', 'Alternate Name One');
    check(type + ' English alias finds the same entry with highest duplicate progress', JSON.stringify(await ids()) === JSON.stringify([rows[0].media.id]) && await page.evaluate(() => document.querySelector('.library-progress').textContent.startsWith('999')));
    await clear();
    await select('#library-status', 'PLANNING');
    check(type + ' Planning filter includes zero-progress entries from all chunks', (await ids()).length === 7);
    await select('#library-genre', 'Comedy');
    await select('#library-format', type === 'ANIME' ? 'TV' : 'ONE_SHOT');
    await select('#library-year', '2001');
    const expected = rows.filter(e => e.status === 'PLANNING' && e.media.genres.includes('Comedy') && e.media.format === (type === 'ANIME' ? 'TV' : 'ONE_SHOT') && e.media.startDate.year === 2001);
    check(type + ' status, genre, format and year combine correctly', JSON.stringify(await ids()) === JSON.stringify(expected.map(e => e.media.id)) && await page.evaluate(() => document.activeElement.id === 'library-year'));
    await clear();
    await select('#library-score', '90');
    await select('#library-sort', 'SCORE');
    const scored = rows.filter(e => e.score >= 90).sort((a,b) => b.score-a.score || a.media.title.romaji.localeCompare(b.media.title.romaji)).slice(0,48).map(e=>e.media.id);
    check(type + ' normalized score threshold and score sorting match source values', JSON.stringify(await ids()) === JSON.stringify(scored));
    await select('#library-score', 'UNSCORED');
    check(type + ' unscored filter keeps zero scores separate', (await ids()).every(id => rows.find(e=>e.media.id===id).score===0));
    await clear();
    await input('#librarySearch', 'no such title');
    check(type + ' empty filters show a specific recoverable state', await page.evaluate(() => document.querySelector('.library-empty h2').textContent === 'No titles match.' && document.querySelectorAll('.library-card').length === 0));
    await input('#librarySearch', '<img');
    check(type + ' hostile title text is escaped and unsafe art is rejected', await page.evaluate(() => !window.__libraryInjected && !document.querySelector('.library-card-copy img') && document.querySelector('.library-card h2').textContent.startsWith('<img')));
    await clear();
    const requestCount = requests.length;
    await click('[data-library-mode="pick"]');
    await select('#pick-source', 'PLANNING');
    check(type + ' picker counts only Planning entries', await page.evaluate(() => document.querySelector('#pickerResult [role="status"]').textContent === '7 matching planned titles'));
    await select('#pick-mood', 'LIGHT');
    await select('#pick-limit', type === 'ANIME' ? '15' : '10');
    check(type + ' mood and actual duration/chapter limits exclude unknown lengths', await page.evaluate(() => document.querySelector('#pickerResult [role="status"]').textContent === '2 matching planned titles'));
    let lastId = null, valid = true;
    const allowed = rows.filter(e=>e.status==='PLANNING' && e.media.genres.includes('Comedy') && (type === 'ANIME' ? e.media.duration !== null && e.media.duration <= 15 : e.media.chapters !== null && e.media.chapters <= 10)).map(e=>e.media.id);
    for (let i=0;i<12;i++) { await click('[data-action="pick-title"]'); const id = await page.evaluate(()=>Number(document.querySelector('.picked-title').dataset.mediaId)); valid &&= allowed.includes(id) && id!==lastId; lastId=id; }
    check(type + ' picks are eligible and consecutive rerolls do not repeat', valid, allowed);
    await page.waitFor(()=>document.querySelector('#liveRegion').textContent.startsWith('Picked '));
    check(type + ' picking focuses and announces the result with a real source link', await page.evaluate(type => document.activeElement.id === 'pickedTitle' && document.querySelector('.picked-copy a').href.includes('/' + (type === 'ANIME' ? 'anime' : 'manga') + '/') && document.querySelector('#liveRegion').textContent.startsWith('Picked '), type));
    await select('#pick-genre', 'Action');
    check(type + ' changed filters clear stale picks and offer an enabled recovery', await page.evaluate(() => !document.querySelector('.picked-title') && !document.querySelector('[data-action="pick-unfiltered"]').disabled && document.querySelector('.picker-waiting h3').textContent === 'No planned titles match.'));
    await clear();
    await select('#pick-source', 'PLANNING');
    await select('#pick-format', type === 'ANIME' ? 'MOVIE' : 'ONE_SHOT');
    await select('#pick-genre', type === 'ANIME' ? 'Action' : 'Comedy');
    await click('[data-action="pick-title"]');
    const formattedId = await page.evaluate(()=>Number(document.querySelector('.picked-title').dataset.mediaId));
    check(type + ' picker genre and format combine without leaving Planning', rows.some(e=>e.media.id===formattedId&&e.status==='PLANNING'&&e.media.format===(type==='ANIME'?'MOVIE':'ONE_SHOT')&&e.media.genres.includes(type==='ANIME'?'Action':'Comedy')));
    await clear();
    await select('#pick-source', 'PLANNING');
    await select('#pick-genre', 'Psychological');
    await click('[data-action="pick-title"]'); await click('[data-action="pick-title"]');
    check(type + ' one eligible title remains pickable without an infinite reroll', await page.evaluate(() => document.querySelector('#pickedTitle').textContent === 'Drama One'));
    check(type + ' filters and picks make no new API requests', requests.length === requestCount);
    await click('[data-library-mode="browse"]');
    for (const width of [1440,1224,985,768,390,320]) {
      await page.setViewport({ width, height: 1000, mobile: width <= 390 });
      await sleep(100);
      const geometry = await page.evaluate(() => ({ width: innerWidth, doc: document.documentElement.scrollWidth, valid: [...document.querySelectorAll('#viewLibrary input,#viewLibrary select,.library-card,.view-tab,.brand-block,.switch-options')].every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1;}), nav: document.querySelector('.view-nav').getBoundingClientRect().toJSON() }));
      check(type + ' ' + width + ' library controls, cards and navigation fit', geometry.doc<=width && geometry.valid && Math.abs(geometry.nav.x+geometry.nav.width/2-width/2)<1, geometry);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot(path.join(out,width+'-'+type.toLowerCase()+'-library-fixture.png'));
    }
  }
  check('both divisions share two paginated collection operations each', requests.filter(r=>r.query.includes('UserTitles')).length===4 && beforeFilters>=3);
  await page.setViewport({width:1224,height:1000});
  await click('[data-library-mode="pick"]');
  await select('#pick-genre','Comedy');
  await click('[data-action="pick-title"]');
  await page.screenshot(path.join(out,'1224-picker-fixture.png'));
  const preReload=requests.length;
  await page.reload(); await page.waitForSelector('#pickerResult');
  check('reload restores Library, picker mode, username and division from cache', requests.length===preReload && await page.evaluate(()=>document.querySelector('[data-view-target="library"]').getAttribute('aria-current')==='page'&&document.querySelector('[data-media-type="MANGA"]').getAttribute('aria-pressed')==='true'&&document.querySelector('#libraryUsername').value==='libraryTest'));
  mode='ready';
  await load('privateStats'); await page.waitForSelector('#pickerResult');
  check('public collection works when statistics are private', await page.evaluate(()=>document.querySelector('#pickerResult [role="status"]').textContent==='608 matching titles'));
  for (const testMode of ['noPlans','empty','private','malformed','repeat','rate']) {
    mode=testMode;
    await load('case-'+testMode);
    await page.waitFor(()=>!document.querySelector('#viewLibrary[aria-busy="true"]'),{timeout:30000});
    if (testMode === 'noPlans') await select('#pick-source', 'PLANNING');
    const text=await page.evaluate(()=>document.querySelector('#viewLibrary').textContent);
    check(testMode+' has an honest empty/error state without partial results', testMode==='noPlans'?text.includes('Your planning list is empty.'):testMode==='empty'?text.includes('No public titles.'):text.includes('Collection unavailable.') && await page.evaluate(()=>!document.querySelector('.picked-title')&&!document.querySelector('.library-card')),text.slice(-250));
    if(testMode==='rate') {
      check('429 disables collection retry during Retry-After',await page.evaluate(()=>document.querySelector('[data-action="retry-library"]').disabled));
      try { await page.waitFor(()=>!document.querySelector('[data-action="retry-library"]').disabled,{timeout:10000}); }
      catch(error) { await fs.writeFile(path.join(out,'library-rate-debug.json'),JSON.stringify(await page.evaluate(()=>({html:document.querySelector('#viewLibrary').innerHTML,exceptions:[]})),null,2));throw error; }
      mode='ready';await click('[data-action="retry-library"]');await page.waitForSelector('#pickerResult');
      check('retry completes all chunks after rate limit without losing profile',await page.evaluate(()=>document.querySelector('.library-subtitle').textContent.startsWith('608 public titles')));
    }
  }
  mode='ready';
  await load('slow');
  await page.waitFor(()=>document.querySelector('#viewLibrary[aria-busy="true"]')&&document.querySelector('#libraryProfileForm button').disabled===false);
  await load('fast'); await page.waitForSelector('#pickerResult'); releaseSlow(); await sleep(200);
  check('stale collection pages cannot overwrite a newer profile',await page.evaluate(()=>document.querySelector('.library-subtitle').textContent==='1 public title · 0 planned'&&document.querySelector('.library-head .spec-label').textContent.startsWith('fast')));
  check('no uncaught browser exceptions',page.events.exceptions.length===0,page.events.exceptions);
  const local=await browser.newPage();
  try {await route(local);await local.goto(fileUrl(path.join(import.meta.dirname,'..','index.html')));await local.evaluate(()=>document.querySelector('[data-view-target="library"]').click());await local.evaluate(()=>{document.querySelector('#libraryUsername').value='fileLibrary';document.querySelector('#libraryProfileForm').requestSubmit();});await local.waitForSelector('.library-card');check('file:// Library works without the news proxy',await local.evaluate(()=>document.querySelector('.library-subtitle').textContent.startsWith('608 public titles')));}finally{await local.close();}
  await fs.writeFile(path.join(out,'library-results.json'),JSON.stringify({chrome:browser.version,total:results.length,failed:results.filter(r=>!r.ok).length,results,requests,exceptions:page.events.exceptions},null,2));
  assert.ok(results.every(r=>r.ok),'See library-results.json');
} finally { releaseSlow();await browser.close(); }
