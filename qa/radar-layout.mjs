import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-18');
await fs.mkdir(out, { recursive: true });
const recorded = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'artifacts', 'acceptance-14', 'radar-live.json'), 'utf8'));
const media = recorded.pages.flatMap(p => p.schedules).filter(e => e.media?.id);
const browser = await launchChrome(), page = await browser.newPage(), results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
const click = selector => page.evaluate(s => document.querySelector(s).click(), selector);
let requests = 0;
try {
  await page.setReducedMotion(true);
  await page.cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Jakarta' }, page.sessionId);
  await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'const RealDate=Date; window.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[Date.now()]));} static now(){return '+Date.parse('2026-10-20T12:00:00+07:00')+';} };' }, page.sessionId);
  await page.route('*graphql.anilist.co*', request => {
    if (request.method === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept' }, body: '' };
    requests++;
    const { variables: v } = JSON.parse(request.postData);
    const slots = [[0,10],[0,18],[1,11],[1,13],[1,20],[3,15],[4,19],[5,16],[6,12],[6,21]];
    const rows = slots.map(([day, hour], i) => ({ ...structuredClone(media[i]), id: 7000+i, airingAt: v.start+1+day*86400+hour*3600 }));
    const data = { Page: { pageInfo: { hasNextPage: v.page===1 }, airingSchedules: v.page===1?rows.slice(0,5):rows.slice(5) } };
    return { status: 200, headers: { 'content-type':'application/json', 'access-control-allow-origin':'*' }, body: JSON.stringify({ data }) };
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5174/');
  await click('[data-view-target="radar"]');
  await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"] .radar-episode'));
  check('today is selected by default with only its day visible', await page.evaluate(()=>document.querySelector('[data-radar-day="2026-10-20"]').getAttribute('aria-pressed')==='true'&&document.querySelectorAll('.radar-day:not([hidden])').length===1&&document.querySelector('.radar-day:not([hidden])').dataset.day==='2026-10-20'));
  check('day labels expose exact counts and selected content relationships',await page.evaluate(()=>document.querySelectorAll('[data-radar-day]').length===8&&document.querySelector('[data-radar-day="2026-10-20"]').getAttribute('aria-label').includes('3 episodes')&&document.querySelector('[data-radar-day="2026-10-20"]').getAttribute('aria-controls')==='radarSchedule1'));
  check('episode time, number and status remain readable and honest',await page.evaluate(()=>getComputedStyle(document.querySelector('.radar-airing-time')).fontSize==='18px'&&document.querySelector('[data-schedule-id="7002"] .radar-countdown').classList.contains('is-aired')&&!document.querySelector('[data-schedule-id="7003"] .radar-countdown').classList.contains('is-aired')&&document.querySelector('[data-schedule-id="7003"] .radar-episode-meta').textContent.includes('Episode')));
  check('compact titles preserve their full accessible text and tooltip',await page.evaluate(()=>[...document.querySelectorAll('.radar-title-link')].every(e=>e.title===e.textContent&&getComputedStyle(e).webkitLineClamp==='3')));
  await click('[data-radar-day="2026-10-22"]');
  check('changing day displays only its locally grouped episodes',await page.evaluate(()=>document.querySelectorAll('.radar-day:not([hidden]) .radar-episode').length===1&&document.querySelector('.radar-day:not([hidden])').dataset.day==='2026-10-22'));
  await click('[data-radar-day="2026-10-21"]');
  check('an empty selected day has an explicit message',await page.evaluate(()=>document.querySelector('.radar-day:not([hidden]) .radar-day-empty').textContent==='No episodes.'));
  await click('[data-radar-day="ALL"]');
  check('All week reveals seven day groups and every scheduled episode',await page.evaluate(()=>document.querySelectorAll('.radar-day:not([hidden])').length===7&&document.querySelectorAll('.radar-episode').length===10));
  await page.focus('[data-radar-day="2026-10-25"]');
  await page.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},page.sessionId);
  await page.cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},page.sessionId);
  await sleep(100);
  check('Enter selects a day, retains focus and announces its count',await page.evaluate(()=>document.activeElement.dataset.radarDay==='2026-10-25'&&document.activeElement.getAttribute('aria-pressed')==='true'&&document.querySelector('#liveRegion').textContent.includes('2 episodes')&&getComputedStyle(document.activeElement).outlineStyle==='solid'));
  check('switching days makes no extra API requests',requests===2,requests);
  for (const width of [1440,1224,985,768,545,390,320]) {
    await page.setViewport({width,height:1000,mobile:width<=390});
    await click('[data-radar-day="2026-10-20"]');
    await page.evaluate(()=>window.scrollTo(0,0));
    const geometry=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.radar-day:not([hidden]) .radar-episode')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,scroll:e.scrollWidth,client:e.clientWidth};}),nav:document.querySelector('.radar-day-nav').getBoundingClientRect().toJSON(),controls:[...document.querySelectorAll('.radar-controls button,[data-radar-day]')].every(e=>e.getBoundingClientRect().height>=44)}));
    check(width+' layout fits, card text stays inside, and controls remain touch sized',geometry.documentWidth<=width&&geometry.cards.every(r=>r.left>=0&&r.right<=width&&r.scroll<=r.client+1)&&geometry.nav.right<=width&&geometry.controls,geometry);
    await page.screenshot(path.join(out,width+'-radar-daily.png'));
  }
  check('day strip scrolls horizontally inside the phone layout',await page.evaluate(()=>{const nav=document.querySelector('.radar-day-nav');return nav.scrollWidth>nav.clientWidth&&getComputedStyle(nav).overflowX==='auto';}));
  await click('[data-action="radar-next"]');
  await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"] .radar-episode'));
  check('another week starts on Monday without a misleading Today label',await page.evaluate(()=>document.querySelector('[data-radar-day="2026-10-26"]').getAttribute('aria-pressed')==='true'&&!document.querySelector('.radar-day-button.is-today')));
  await click('[data-action="radar-today"]');
  await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"] .radar-episode'));
  check('This week restores today and reuses cached weekly schedules',requests===4&&await page.evaluate(()=>document.querySelector('[data-radar-day="2026-10-20"]').getAttribute('aria-pressed')==='true'));
  check('no uncaught exceptions',page.events.exceptions.length===0,page.events.exceptions);
  await fs.writeFile(path.join(out,'radar-layout-results.json'),JSON.stringify({chrome:browser.version,total:results.length,failed:results.filter(r=>!r.ok).length,results},null,2));
  assert.ok(results.every(r=>r.ok),'See radar-layout-results.json');
} finally { await browser.close(); }
