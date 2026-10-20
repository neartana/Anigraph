import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAppServer, normalizeMalEntry } from '../server.js';
import { launchChrome, sleep } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-21');
await fs.mkdir(out, { recursive: true });
const originalFetch = globalThis.fetch, results = [], upstream = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
const raw = (id, type = 'ANIME') => type === 'ANIME'
  ? { anime_id: id, anime_title: 'Anime ' + id, anime_title_eng: 'Alias ' + id, anime_num_episodes: 12, anime_image_path: 'https://cdn.myanimelist.net/images/anime/1/1.jpg', anime_media_type_string: 'TV', anime_start_date_string: '01-01-24', num_watched_episodes: 5, status: id === 2 ? 6 : 1, score: id === 2 ? 0 : 1, start_date_string: '01-01-25', genres: [{ name: 'Action' }] }
  : { manga_id: id, manga_title: 'Manga ' + id, manga_num_chapters: 12, manga_image_path: 'https://cdn.myanimelist.net/images/manga/1/1.jpg', manga_media_type_string: 'Manga', manga_start_date_string: '01-01-23', num_read_chapters: 7, num_read_volumes: 3, status: 2, score: 8, genres: [{ name: 'Romance' }] };
const profile = '<meta property="og:title" content="tester&#039;s Profile - MyAnimeList.net"><img src="https://cdn.myanimelist.net/images/userimages/1.jpg"><h5>Anime Stats</h5><span>Days: </span>2.5';
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://myanimelist.net/')) return originalFetch(url, options);
  upstream.push({ url: String(url), at: Date.now() });
  const parsed = new URL(url), user = parsed.pathname.split('/')[2];
  if (user === 'missing') return new Response('', { status: 404 });
  if (user === 'private') return new Response('', { status: 403 });
  if (user === 'rateuser') return new Response('', { status: 429, headers: { 'retry-after': '1' } });
  if (parsed.pathname.startsWith('/profile/')) return new Response(profile);
  if (user === 'baduser') return new Response('{"unexpected":[]}');
  if (user === 'hugeuser') return new Response('x', { headers: { 'content-length': '4000000' } });
  const type = parsed.pathname.startsWith('/mangalist') ? 'MANGA' : 'ANIME';
  const offset = Number(parsed.searchParams.get('offset'));
  const rows = user === 'emptyuser' ? [] : type === 'MANGA' ? [raw(1, type)] : Array.from({ length: offset === 0 ? 300 : 1 }, (_, i) => raw(offset + i + 1));
  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
};
const server = createAppServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  const anime = normalizeMalEntry(raw(1), 'ANIME'), manga = normalizeMalEntry(raw(1, 'MANGA'), 'MANGA');
  check('MAL scores, progress and source IDs normalize without guessing AniList IDs', anime.score === 10 && anime.progress === 5 && anime.media.id === 1 && anime.media.source === 'mal' && manga.score === 80 && manga.progress === 7 && manga.volumesRead === 3);
  check('unknown volume counts and unknown dates stay unknown', normalizeMalEntry({ ...raw(1, 'MANGA'), num_read_volumes: null, start_date_string: '00-00-00' }, 'MANGA').volumesRead === null && normalizeMalEntry({ ...raw(1), start_date_string: '00-00-00' }, 'ANIME').startYear === null);
  const attempts = upstream.length;
  for (const query of ['username=https://evil.test', 'username=tester&type=OTHER', 'username=tester&offset=2', 'username=tester&url=https://evil.test']) {
    check('proxy rejects invalid request ' + query, (await originalFetch(origin + '/api/mal/list?' + query)).status === 400);
  }
  check('invalid proxy requests never contact upstream', upstream.length === attempts);
  for (const [user, status] of [['missing', 404], ['private', 403], ['baduser', 502], ['hugeuser', 502], ['rateuser', 429]]) {
    const r = await originalFetch(origin + '/api/mal/list?username=' + user);
    check(user + ' is an explicit error without partial list data', r.status === status && !('lists' in await r.json()));
  }
  browser = await launchChrome(); const page = await browser.newPage();
  const click = async selector => { await page.evaluate(s => { const el = document.querySelector(s); if (typeof el.click === 'function') el.click(); else el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, selector); if (selector === '#dialogOk') await sleep(60); };
  const select = (selector, value) => page.evaluate((s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, selector, value);
  const load = async name => { await page.evaluate(v => { document.querySelector('#statsUsername').value = v; document.querySelector('#statsForm').requestSubmit(); }, name); await page.waitFor(() => document.querySelector('#viewStats[aria-busy="false"] .summary-value') || document.querySelector('#viewStats[aria-busy="false"] .state-title')); };
  const base = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'artifacts', 'acceptance-19', 'images-live-data.json'), 'utf8'));
  const captured = Object.entries(base.cache).filter(([k]) => k.startsWith('anigraph:v1:cache:[')).map(([k, v]) => ({ variables: JSON.parse(k.slice(18))[1], data: JSON.parse(v).data }));
  const media = (id, idMal) => ({ id, idMal, type: 'ANIME', title: { romaji: 'Catalog ' + id }, genres: ['Action'], averageScore: 85, isAdult: false });
  const gql = [];
  await page.route('*graphql.anilist.co*', req => {
    if (req.method === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type,accept' }, body: '' };
    const { query, variables: v } = JSON.parse(req.postData); gql.push({ query, v }); let data;
    if (query.includes('DiscoverRecommendations')) data = { Page: { media: [{ id: 900, idMal: 1, recommendations: { nodes: [ { rating: 10, mediaRecommendation: media(901, 1) }, { rating: 10, mediaRecommendation: media(902, 9999) }, { rating: 10, mediaRecommendation: media(1, 9998) } ] } }] } };
    else if (query.includes('DiscoverGenres')) data = { GenreCollection: ['Action', 'Romance'] };
    else if (query.includes('SeasonalCatalog')) data = { GenreCollection: ['Action'], Page: { pageInfo: { hasNextPage: false }, media: v.season ? [media(1, 9998)] : [] } };
    else if (query.includes('AiringRadar')) data = { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [{ id: 800, airingAt: v.start + 3600, episode: 2, media: { ...media(999, 2), coverImage: {} } }, { id: 801, airingAt: v.start + 7200, episode: 3, media: { ...media(2, 9999), coverImage: {} } }] } };
    else { const r = captured.find(r => query.includes('UserStats') ? r.data.User : r.data.MediaListCollection && r.variables.type === v.type && r.variables.chunk === v.chunk); data = structuredClone(r.data); if (data.User) data.User.name = 'tester'; }
    return { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ data }) };
  });
  await page.route('*cdn.myanimelist.net*', () => ({ status: 200, headers: { 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="#223248"/></svg>' }));
  await page.route('*/api/ann/news*', () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '[]' }));
  await page.setReducedMotion(true); await page.setViewport({ width: 1440, height: 1000 }); await page.goto(origin + '/');
  await select('#viewStats [data-profile-source]', 'mal'); await load('tester');
  check('MAL source loads all public list pages before reporting totals', await page.evaluate(() => document.querySelector('.summary-value').textContent === '301') && upstream.some(r => r.url.includes('offset=300')));
  check('MAL low scores retain the /10 to /100 conversion in charts', await page.evaluate(() => document.querySelector('[data-panel="scores"]').getAttribute('aria-label').includes('Peak at 10') && document.querySelectorAll('.summary-value')[1].textContent === '10'));
  check('MAL reported days retain their units and absent banner stays absent', await page.evaluate(() => document.querySelectorAll('.summary-value')[3].textContent === '2.5' && !document.querySelector('.profile-banner')));
  await click('[data-genre="Action"]'); await page.waitForSelector('.genre-title-row');
  check('MAL genre results include every matching public title with MAL links', await page.evaluate(() => document.querySelectorAll('.genre-title-row').length === 301 && [...document.querySelectorAll('.genre-title-copy a')].every(a => a.href.startsWith('https://myanimelist.net/anime/'))));
  await page.key('Escape'); await click('[data-media-type="MANGA"]'); await page.waitFor(() => document.querySelector('.summary-value')?.textContent === '1');
  check('MAL manga preserves chapters, volumes, scores and format', await page.evaluate(() => [...document.querySelectorAll('.summary-value')].map(e => e.textContent).join('|') === '1|80|7|3' && document.querySelector('.profile-art-link').href === 'https://myanimelist.net/manga/1'));
  await click('[data-media-type="ANIME"]'); await click('[data-view-target="library"]'); await page.waitForSelector('.library-card');
  check('MAL library reuses its complete list and real source links', await page.evaluate(() => document.querySelector('.library-subtitle').textContent.includes('301 public titles') && document.querySelector('.library-card-link').href.startsWith('https://myanimelist.net/anime/')));
  await click('[data-library-mode="pick"]'); await page.waitForSelector('.picked-title');
  check('Pick for Me draws from MAL and opens on MAL', await page.evaluate(() => document.querySelector('.picked-copy a').href.startsWith('https://myanimelist.net/anime/') && document.querySelector('.picked-copy a').textContent === 'OPEN ON MYANIMELIST'));
  await click('[data-library-mode="discover"]'); await page.waitForSelector('.catalog-grid');
  check('MAL recommendations query mapped MAL seed IDs and exclude known MAL titles', gql.some(r => r.query.includes('media(idMal_in:')) && await page.evaluate(() => [...document.querySelectorAll('.catalog-grid .library-card')].map(e => e.dataset.mediaId).sort().join(',') === '1,902'));
  await click('[data-library-mode="browse"]'); await click('#viewLibrary .collection-add');
  await page.evaluate(() => { document.querySelector('#collectionName').value = 'MAL favorites'; }); await click('#dialogOk');
  check('MAL collections are scoped separately and retain source IDs', await page.evaluate(() => { const g = JSON.parse(localStorage.getItem('anigraph:v1:collections'))[0]; return g.owner === 'mal:tester' && g.items[0].source === 'mal'; }));
  await click('[data-library-mode="seasons"]'); await page.waitForSelector('.catalog-grid'); await click('#viewLibrary .collection-add'); await click('#dialogOk');
  check('same numeric MAL and AniList IDs coexist inside one collection', await page.evaluate(() => { const items = JSON.parse(localStorage.getItem('anigraph:v1:collections'))[0].items; return items.every(e => e.id === 1) && items.map(e => e.source).sort().join(',') === 'anilist,mal'; }));
  await click('[data-library-mode="collections"]');
  check('mixed-source saved titles link to their correct sites', await page.evaluate(() => [...document.querySelectorAll('#viewLibrary .library-card-link')].map(e => new URL(e.href).hostname).sort().join(',') === 'anilist.co,myanimelist.net'));
  for (const width of [1440, 985, 768, 390, 320]) {
    await page.setViewport({ width, height: 1000, mobile: width <= 390 }); await click('[data-view-target="stats"]'); await sleep(120);
    check(width + ' MAL source selector, cards and charts fit', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#viewStats [data-profile-source]').getBoundingClientRect().right <= innerWidth));
    if ([1440, 390].includes(width)) { await page.scrollTo('.profile-block'); await page.screenshot(path.join(out, width + '-mal-stats.png')); }
  }
  await click('[data-view-target="radar"]'); await click('[data-radar-scope="MINE"]'); await page.waitFor(() => document.querySelector('.radar-episode'));
  check('My Schedule matches MAL IDs rather than colliding AniList IDs', await page.evaluate(() => document.querySelectorAll('.radar-episode').length === 1 && document.querySelector('.radar-episode').dataset.scheduleId === '800'));
  await click('[data-view-target="library"]'); await page.reload(); await page.waitForSelector('#viewLibrary .collections-head');
  check('MAL source, profile and saved collections survive reload', await page.evaluate(() => document.querySelector('#viewLibrary [data-profile-source]').value === 'mal' && document.querySelector('.feature-summary').textContent.includes('MAL favorites')));
  await click('[data-view-target="stats"]'); await select('#viewStats [data-profile-source]', 'anilist'); await load('tester');
  check('switching source clears the previous profile and preserves AniList behavior', await page.evaluate(() => document.querySelector('.summary-value').textContent === '1,088' && document.querySelector('#viewStats [data-profile-source]').value === 'anilist'));
  await click('[data-view-target="library"]'); await click('[data-library-mode="collections"]');
  check('identical usernames never expose the other source collection', await page.evaluate(() => !document.querySelector('.collections-toolbar') && !document.querySelector('#viewLibrary').textContent.includes('MAL favorites')));
  await click('[data-view-target="stats"]'); await select('#viewStats [data-profile-source]', 'mal');
  await load('emptyuser');
  check('empty MAL lists show zero titles and honest empty charts', await page.evaluate(() => document.querySelector('.summary-value').textContent === '0' && document.querySelectorAll('.chart-empty').length === 7));
  await load('private');
  check('private or blocked MAL lists have a source-specific error without stale stats', await page.evaluate(() => !document.querySelector('.summary-value') && document.querySelector('.state-body').textContent.includes('MyAnimeList') && !document.querySelector('.state-body').textContent.includes('AniList has')));
  await load('missing');
  check('missing MAL profiles have a recoverable username error', await page.evaluate(() => document.querySelector('.state-title').textContent === 'No such profile.' && document.querySelector('[data-action="focus-stats"]')));
  check('no uncaught browser exceptions', page.events.exceptions.length === 0, page.events.exceptions);
  check('MAL upstream is fixed-host, paced and read-only', upstream.every(r => r.url.startsWith('https://myanimelist.net/')) && upstream.slice(1).every((r, i) => r.at - upstream[i].at >= 950));
} finally {
  if (browser) await browser.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); globalThis.fetch = originalFetch;
  await fs.writeFile(path.join(out, 'mal-results.json'), JSON.stringify({ total: results.length, failed: results.filter(r => !r.ok).length, results }, null, 2));
}
assert.ok(results.every(r => r.ok), 'See mal-results.json');
