import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './cdp.mjs';

const before = process.argv[2] === 'before';
const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-14');
await fs.mkdir(out, { recursive: true });
const baselinePath = before ? path.join(out, 'compact-before.json') : path.join(import.meta.dirname, 'artifacts', 'acceptance-10', 'compact-before.json');
const baseline = before ? null : JSON.parse(await fs.readFile(baselinePath, 'utf8'));
const browser = await launchChrome();
const results = [];
const check = (name, condition, detail) => { results.push({ name, ok: !!condition, detail }); console.log((condition ? 'PASS ' : 'FAIL ') + name); };
const page = await browser.newPage();
const samples = [];
try {
  await page.setReducedMotion(true);
  if (baseline) await page.route('https://graphql.anilist.co', (request) => {
    const { query, variables } = JSON.parse(request.postData);
    if (query.includes('query AiringRadar')) return { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage:false }, airingSchedules:[] } } }) };
    const cached = baseline.cache['anigraph:v1:cache:' + JSON.stringify([query, variables])] || Object.entries(baseline.cache).find(([key]) => {
      if (!query.includes('UserTitles') || !key.startsWith('anigraph:v1:cache:[')) return false;
      const [q,v] = JSON.parse(key.slice('anigraph:v1:cache:'.length));
      return q.includes('UserTitles') && v.name === variables.name && v.type === variables.type;
    })?.[1];
    assert.ok(cached, 'The frozen fixture must cover this query');
    const data = JSON.parse(cached).data;
    if (data.MediaListCollection) data.MediaListCollection.hasNextChunk = false;
    return { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ data }) };
  });
  await page.setViewport({ width: 1224, height: 900 });
  await page.goto('http://127.0.0.1:5174/');
  await page.evaluate(() => { document.querySelector('#statsUsername').value = 'Neartana'; document.querySelector('#statsForm').requestSubmit(); });
  await page.waitForSelector('#statsTitle', { timeout: 30000 });
  for (const type of ['ANIME', 'MANGA']) {
    await page.evaluate(type => document.querySelector('[data-media-type="' + type + '"]').click(), type);
    await page.waitFor(() => document.querySelectorAll('.title-chart-row').length > 0 && !document.querySelector('.chart-loading'), { timeout: 30000 });
    for (const width of [1440, 1224, 985, 768, 390]) {
      await page.setViewport({ width, height: 1000, mobile: width === 390 });
      await sleep(400);
      const sample = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
        const nav = document.querySelector('.view-nav');
        return { width: innerWidth, docWidth: document.documentElement.scrollWidth, nav: rect(nav), navFont: parseFloat(getComputedStyle(document.querySelector('.view-name')).fontSize), navNumbers: document.querySelectorAll('.view-index').length,
          summary: [...document.querySelectorAll('.summary-value')].map(e => e.textContent), panels: [...document.querySelectorAll('[data-panel]')].map(panel => ({
            id: panel.dataset.panel, ...rect(panel), label: panel.getAttribute('aria-label'), values: [...panel.querySelectorAll('.chart-value-label')].map(e=>e.textContent), tooltips: [...panel.querySelectorAll('svg title,.title-chart-row[title]')].map(e=>e.getAttribute('title') || e.textContent), canvas: rect(panel.querySelector('.chart-canvas'))
          })) };
      });
      sample.type = type;
      samples.push(sample);
      if (!before) {
        const old = baseline.samples.find(s => s.type === type && s.width === width);
        const semantic = s => ({ summary:s.summary, panels:s.panels.map(({id,label,values,tooltips})=>({id,label,values,tooltips})) });
        check(type + ' ' + width + ' retains every statistic, value and tooltip', JSON.stringify(semantic(sample)) === JSON.stringify(semantic(old)));
        check(type + ' ' + width + ' navigation is centered, larger and unnumbered', sample.navNumbers === 0 && sample.navFont >= 14 && Math.abs(sample.nav.x + sample.nav.width / 2 - width / 2) <= 1, sample.nav);
        check(type + ' ' + width + ' charts and page remain within viewport', sample.docWidth <= width && sample.panels.every(p=>p.x>=0 && p.right<=width+1));
        const oldArea = old.panels.filter(p=>p.id!=='titles').reduce((sum,p)=>sum+p.height,0);
        const newArea = sample.panels.filter(p=>p.id!=='titles').reduce((sum,p)=>sum+p.height,0);
        check(type + ' ' + width + ' six aggregate panels use at least 20% less vertical space', newArea < oldArea * .8, { before:oldArea, after:newArea });
        const formats = sample.panels.find(p=>p.id==='formats');
        const startYears = sample.panels.find(p=>p.id==='startYears');
        check(type + ' ' + width + ' Formats matches Start years on desktop and stays compact on phones', width > 900 ? Math.abs(formats.height - startYears.height) < 1 : formats.height - formats.canvas.height < 125, {panel:formats.height,chart:formats.canvas.height});
        const panels = sample.panels;
        check(type + ' ' + width + ' chart cards never overlap', panels.every((a,i)=>panels.slice(i+1).every(b=>Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1 || Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1)));
      }
      await page.evaluate(() => window.scrollTo(0, window.scrollY + document.querySelector('.record-head').getBoundingClientRect().top - 12));
      await page.screenshot(path.join(out, `${before?'before':'after'}-${width}-${type.toLowerCase()}-charts.png`));
      await page.evaluate(() => window.scrollTo(0,0));
      await page.screenshot(path.join(out, `${before?'before':'after'}-${width}-${type.toLowerCase()}-profile.png`));
    }
    if (!before) {
      await page.scrollTo('[data-genre="Action"]'); await page.focus('[data-genre="Action"]'); await page.key('Enter');
      await page.waitForSelector('#genrePanelTitle');
      check(type + ' genre opens from keyboard', (await page.evaluate(()=>document.querySelector('#genrePanelTitle').textContent)) === 'Action');
      await page.key('Escape');
      check(type + ' genre closes and restores keyboard focus', (await page.evaluate(()=>document.activeElement?.dataset.genre)) === 'Action');
    }
  }
  if (before) {
    await fs.writeFile(baselinePath, JSON.stringify({ samples, cache: await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage))) }, null, 2));
  } else {
    for (const width of [1224,390]) {
    await page.setViewport({width,height:1000,mobile:width===390});
    for (const view of ['tiers','radar','stats']) {
      await page.evaluate(view=>document.querySelector('[data-view-target="'+view+'"]').click(), view);
      await sleep(200);
      const nav = await page.evaluate(()=>{ const r=document.querySelector('.view-nav').getBoundingClientRect(); return { center:r.x+r.width/2,width:innerWidth, current:document.querySelector('[aria-current="page"]').dataset.viewTarget }; });
      check(view + ' ' + width + ' navigation still selects its view and stays centered', nav.current===view && Math.abs(nav.center-nav.width/2)<1, nav);
    }
    }
    check('no uncaught browser exceptions', page.events.exceptions.length===0, page.events.exceptions);
    await fs.writeFile(path.join(out,'compact-results.json'),JSON.stringify({chrome:browser.version,total:results.length,failed:results.filter(r=>!r.ok).length,results,samples},null,2));
    assert.ok(results.every(r=>r.ok), 'See compact-results.json for failed checks');
  }
} finally { await browser.close(); }
