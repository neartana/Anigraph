import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-17');
await fs.mkdir(out, { recursive: true });
const source = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'artifacts', 'acceptance-14', 'library-live.json'), 'utf8'));
const planned = source.collections.find(c => c.type === 'MANGA').entries.filter(e => e.status === 'PLANNING');
const allowed = planned.map(e => e.media.id);
const browser = await launchChrome(), page = await browser.newPage(), results = [];
let requests = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
const click = selector => page.evaluate(s => document.querySelector(s).click(), selector);
const select = (selector, value) => page.evaluate((s, v) => { const control = document.querySelector(s); control.focus(); control.value = v; control.dispatchEvent(new Event('change', { bubbles: true })); }, selector, value);
const picked = () => page.evaluate(() => ({ id: Number(document.querySelector('.picked-title')?.dataset.mediaId), focus: document.activeElement.id, announcement: document.querySelector('#liveRegion').textContent }));
async function load(name) {
  await page.evaluate(value => { document.querySelector('#libraryUsername').value = value; document.querySelector('#libraryProfileForm').requestSubmit(); }, name);
  await page.waitFor(() => !document.querySelector('#viewLibrary[aria-busy="true"]') && !!document.querySelector('#pickerResult,.library-card'));
}
async function enter(selector) {
  await page.focus(selector);
  await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }, page.sessionId);
  await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId);
  await sleep(80);
}
try {
  await page.setReducedMotion(true);
  await page.setViewport({ width: 1224, height: 1000 });
  await page.route('*graphql.anilist.co*', request => {
    if (request.method === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept' }, body: '' };
    requests++;
    const { query, variables: v } = JSON.parse(request.postData);
    const extras = ['COMPLETED', 'CURRENT'].map((status, index) => { const entry = structuredClone(planned[0]); entry.status = status; entry.media.id = 900001 + index; entry.media.title.romaji = status + ' library fixture'; return entry; });
    const entries = extras.concat(structuredClone(planned)).map(e => { if (v.type === 'ANIME') { e.media.format = 'TV'; e.media.duration = 12; } if (v.name === 'noPlans') e.status = 'CURRENT'; return e; });
    const data = query.includes('UserStats') ? { User: { id: 123, name: v.name, statistics: null } } : { MediaListCollection: { hasNextChunk: false, lists: [{ entries }] } };
    return { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ data }) };
  });
  await page.goto('http://127.0.0.1:5174/');
  await click('[data-view-target="library"]');
  await load('pickerAction');
  for (const type of ['ANIME', 'MANGA']) {
    await click('[data-media-type="' + type + '"]');
    await page.waitForSelector('.library-card');
    const initialRequests = requests;
    await page.evaluate(() => { Math.random = () => 0; });
    await click('[data-library-mode="pick"]');
    const first = await picked();
    check(type + ' whole library is the default picker source', await page.evaluate(() => document.querySelector('#pick-source').value === 'ALL' && document.querySelector('#pickerResult [role="status"]').textContent.startsWith('5 matching')));
    check(type + ' header Pick for Me draws a Completed title immediately', first.id === 900001 && first.focus === 'pickedTitle', first);
    await click('[data-library-mode="pick"]');
    const second = await picked();
    check(type + ' repeating the header action can pick Current and avoids an immediate repeat', second.id === 900002 && second.id !== first.id && second.focus === 'pickedTitle', second);
    await enter('[data-library-mode="pick"]');
    const third = await picked();
    check(type + ' keyboard Enter on the header draws, focuses and announces the result', third.id === 900001 && third.id !== second.id && third.focus === 'pickedTitle' && third.announcement.startsWith('Picked '), third);
    await select('#pick-source', 'PLANNING');
    check(type + ' source changes clear stale results and recalculate counts and moods', await page.evaluate(() => !document.querySelector('.picked-title') && document.activeElement.id === 'pick-source' && document.querySelector('#pickerResult [role="status"]').textContent.startsWith('3 matching') && document.querySelector('#pick-mood option[value="ALL"]').textContent.includes('(3)')));
    await click('[data-library-mode="pick"]');
    const planFirst = await picked();
    await click('[data-library-mode="pick"]');
    const planSecond = await picked();
    check(type + ' optional Planning source stays strict and rerolls', allowed.includes(planFirst.id) && allowed.includes(planSecond.id) && planFirst.id !== planSecond.id, { first: planFirst.id, second: planSecond.id });
    await select('#pick-mood', 'FANTASY');
    await select('#pick-source', 'ALL');
    check(type + ' returning to whole library clears old preferences and restores its pool', await page.evaluate(() => !document.querySelector('.picked-title') && [...document.querySelectorAll('[data-pick-filter]')].every(e => e.value === 'ALL') && document.querySelector('#pickerResult [role="status"]').textContent.startsWith('5 matching') && document.querySelector('#pick-mood option[value="ALL"]').textContent.includes('(5)')));
    check(type + ' changing source and drawing make no new API requests', requests === initialRequests);
    await click('[data-library-mode="pick"]');
    await page.screenshot(path.join(out, type.toLowerCase() + '-header-pick.png'));
    await page.setViewport({ width: 390, height: 1000, mobile: true });
    await click('[data-library-mode="pick"]');
    const phone = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, targets: ['#pick-source', '[data-library-mode="pick"]', '.picked-title'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, left: r.left, right: r.right, height: r.height }; }) }));
    check(type + ' picker sources, header action and result fit on phones', phone.documentWidth <= phone.width && phone.targets.every(r => r.left >= 0 && r.right <= phone.width && r.height >= 44), phone);
    await page.evaluate(() => window.scrollTo(0, window.scrollY + document.querySelector('.library-head').getBoundingClientRect().top - 12));
    await page.screenshot(path.join(out, '390-' + type.toLowerCase() + '-header-pick.png'));
    await page.setViewport({ width: 1224, height: 1000 });
    await click('[data-library-mode="browse"]');
  }
  await load('noPlans');
  for (const type of ['ANIME', 'MANGA']) {
    await click('[data-media-type="' + type + '"]');
    await page.waitForSelector('.library-card');
    await enter('[data-library-mode="pick"]');
    check(type + ' a library without Planning titles still picks from the whole library', !!(await picked()).id);
    await select('#pick-source', 'PLANNING');
    await enter('[data-library-mode="pick"]');
    const empty = await page.evaluate(() => ({ picked: !!document.querySelector('.picked-title'), focus: document.activeElement.textContent, announcement: document.querySelector('#liveRegion').textContent, heading: document.querySelector('.picker-waiting h3')?.textContent }));
    check(type + ' empty Planning explains, focuses and announces why there is no pick', !empty.picked && empty.heading === 'Your planning list is empty.' && empty.focus === empty.heading && empty.announcement.includes(empty.heading), empty);
    await click('[data-action="pick-library"]');
    check(type + ' empty Planning recovery explicitly selects the whole library and draws', await page.evaluate(() => document.querySelector('#pick-source').value === 'ALL' && !!document.querySelector('.picked-title') && document.activeElement.id === 'pickedTitle'));
    await click('[data-library-mode="browse"]');
  }
  check('header picker actions have no uncaught exceptions', page.events.exceptions.length === 0, page.events.exceptions);
  await fs.writeFile(path.join(out, 'picker-action-results.json'), JSON.stringify({ chrome: browser.version, total: results.length, failed: results.filter(r => !r.ok).length, results }, null, 2));
  assert.ok(results.every(r => r.ok), 'See picker-action-results.json');
} finally { await browser.close(); }
