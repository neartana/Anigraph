import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-15');
await fs.mkdir(out, { recursive: true });
const browser = await launchChrome(), page = await browser.newPage(), results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
try {
  await page.route('*/api/ann/news*', () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '[]' }));
  await page.route('*graphql.anilist.co*', request => ({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [] } } }) }));
  await page.setReducedMotion(true);
  await page.goto('http://127.0.0.1:5174/');
  await page.waitForSelector('.footer-inner');
  check('one labelled footer contains navigation and both source credits', await page.evaluate(() => document.querySelectorAll('footer').length === 1 && document.querySelector('footer').getAttribute('aria-label') === 'Site footer' && document.querySelectorAll('[data-footer-view]').length === 4 && [...document.querySelectorAll('.footer-sources a')].map(e=>e.hostname).join(',') === 'anilist.co,www.animenewsnetwork.com'));
  check('source links open safely and retain meaningful names', await page.evaluate(() => [...document.querySelectorAll('.footer-sources a')].every(e => e.protocol === 'https:' && e.target === '_blank' && e.rel.includes('noopener') && e.rel.includes('noreferrer') && e.textContent.trim().length > 5)));
  check('main navigation remains four tabs', await page.evaluate(() => document.querySelectorAll('[data-view-target]').length === 4));
  for (const width of [1440,1224,985,768,390,320]) {
    await page.setViewport({ width, height: 800, mobile: width <= 390 });
    await page.evaluate(() => window.scrollTo(0,document.documentElement.scrollHeight));
    const geometry = await page.evaluate(() => ({ width:innerWidth, doc:document.documentElement.scrollWidth, footer:document.querySelector('footer').getBoundingClientRect().toJSON(),
      links:[...document.querySelectorAll('footer button,footer a')].map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent.trim(),left:r.left,right:r.right,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};}),
      radius:parseFloat(getComputedStyle(document.querySelector('.footer-inner')).borderRadius) }));
    check(width+' footer and text fit without horizontal overflow', geometry.doc <= width && geometry.footer.x >= 0 && geometry.footer.right <= width && geometry.links.every(e=>e.left>=0&&e.right<=width&&e.scrollWidth<=e.clientWidth+1), geometry);
    check(width+' footer uses rounded surfaces and 44px controls', geometry.radius >= 8 && geometry.links.every(e=>e.height>=44));
    await page.screenshot(path.join(out,width+'-footer.png'));
    if (width === 1224) {
      const {data} = await page.cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:geometry.footer.y+await page.evaluate(()=>scrollY)-24,width,height:geometry.footer.height+24,scale:1},captureBeyondViewport:true},page.sessionId);
      await fs.writeFile(path.join(out,'1224-footer-detail.png'),Buffer.from(data,'base64'));
    }
  }
  for (const view of ['library','tiers','radar','stats']) {
    await page.evaluate(v => {document.querySelector('[data-footer-view="'+v+'"]').scrollIntoView();document.querySelector('[data-footer-view="'+v+'"]').click();},view);
    check('footer '+view+' selects its view, syncs both navigation groups and restores visible focus',await page.evaluate(v => document.querySelector('.view-tab[aria-current="page"]').dataset.viewTarget === v && document.querySelector('[data-footer-view][aria-current="page"]').dataset.footerView === v && document.activeElement.dataset.viewTarget === v && window.scrollY === 0,view));
  }
  await page.focus('[data-footer-view="library"]');
  await page.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13},page.sessionId);
  await page.cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},page.sessionId);
  check('footer navigation works from the keyboard',await page.evaluate(()=>document.activeElement.dataset.viewTarget==='library'&&document.querySelector('#viewLibrary').hidden===false));
  await page.evaluate(()=>{history.replaceState(null,'','#qa-preserve');window.scrollTo(0,document.documentElement.scrollHeight);document.querySelector('[data-action="footer-top"]').click();});
  check('Back to top restores header focus without changing the URL hash',await page.evaluate(()=>window.scrollY===0&&document.activeElement.dataset.viewTarget==='library'&&location.hash==='#qa-preserve'));
  await page.evaluate(()=>{window.scrollTo(0,document.documentElement.scrollHeight);document.querySelector('[data-footer-view="library"]').click();});
  check('clicking the current footer view also returns to the top',await page.evaluate(()=>window.scrollY===0&&document.activeElement.dataset.viewTarget==='library'));
  check('footer changes produce no uncaught exceptions',page.events.exceptions.length===0,page.events.exceptions);
  await fs.writeFile(path.join(out,'footer-results.json'),JSON.stringify({chrome:browser.version,total:results.length,failed:results.filter(r=>!r.ok).length,results},null,2));
  assert.ok(results.every(r=>r.ok),'See footer-results.json');
} finally {await browser.close();}
