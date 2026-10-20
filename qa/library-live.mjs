import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-17');
await fs.mkdir(out, { recursive: true });
const browser = await launchChrome(), page = await browser.newPage();
const results = [], collections = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
const click = s => page.evaluate(sel=>document.querySelector(sel).click(),s);
try {
  await page.setReducedMotion(true);
  await page.setViewport({ width: 1440, height: 1050 });
  await page.goto('http://127.0.0.1:5174/');
  await click('[data-view-target="library"]');
  await page.evaluate(()=>{document.querySelector('#libraryUsername').value='Neartana';document.querySelector('#libraryProfileForm').requestSubmit();});
  for (const type of ['ANIME','MANGA']) {
    await click('[data-media-type="'+type+'"]');
    await page.waitForSelector('.library-card',{timeout:60000});
    const source = await page.evaluate(type=>{
      const cached = Object.entries(sessionStorage).filter(([k])=>{if(!k.startsWith('anigraph:v1:cache:['))return false; const [q,v]=JSON.parse(k.slice('anigraph:v1:cache:'.length));return q.includes('UserTitles')&&v.type===type;}).map(([k,v])=>({variables:JSON.parse(k.slice('anigraph:v1:cache:'.length))[1],collection:JSON.parse(v).data.MediaListCollection})).sort((a,b)=>a.variables.chunk-b.variables.chunk);
      const best = new Map();
      for(const {collection} of cached)for(const list of collection.lists)for(const entry of list.entries||[]){if(entry.media?.id&&(!best.has(entry.media.id)||entry.progress>best.get(entry.media.id).progress))best.set(entry.media.id,entry);}
      return {chunks:cached.map(c=>({chunk:c.variables.chunk,hasNextChunk:c.collection.hasNextChunk})),entries:[...best.values()]};
    },type);
    const plans=source.entries.filter(e=>e.status==='PLANNING');
    check(type+' live pagination reaches the final chunk',source.chunks.length>0&&source.chunks.at(-1).hasNextChunk===false&&source.chunks.every((c,i)=>c.chunk===i+1),source.chunks);
    const caption=await page.evaluate(()=>document.querySelector('.library-subtitle').textContent);
    check(type+' live collection count matches every deduplicated public entry',caption===source.entries.length.toLocaleString('en-US')+' public titles · '+plans.length.toLocaleString('en-US')+' planned',caption);
    await page.evaluate(()=>{const select=document.querySelector('#library-genre');select.value='Action';select.dispatchEvent(new Event('change',{bubbles:true}));});
    const visible=await page.evaluate(()=>[...document.querySelectorAll('.library-card')].map(e=>Number(e.dataset.mediaId)));
    check(type+' real Action filter matches source genres',visible.length>0&&visible.every(id=>source.entries.find(e=>e.media.id===id).media.genres.includes('Action')),visible);
    for(const width of [1440,1224,985,768,390]) {
      await page.setViewport({width,height:1050,mobile:width===390});
      await page.evaluate(()=>window.scrollTo(0,0));
      await sleep(150);
      await page.waitFor(()=>[...document.querySelectorAll('.library-card img')].filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight;}).every(e=>e.complete),{timeout:20000});
      const images=await page.evaluate(()=>[...document.querySelectorAll('.library-card img')].filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight;}).map(e=>({src:e.src,loaded:e.naturalWidth>0})));
      check(type+' '+width+' live cover grid fits and loads real artwork',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)&&images.length>0&&images.every(e=>e.loaded),images);
      await page.screenshot(path.join(out,width+'-'+type.toLowerCase()+'-library-live.png'));
    }
    await click('[data-library-mode="pick"]');
    check(type+' header draws from the whole public library by default',await page.evaluate(ids=>document.querySelector('#pick-source').value==='ALL'&&ids.includes(Number(document.querySelector('.picked-title').dataset.mediaId))&&document.activeElement.id==='pickedTitle',source.entries.map(e=>e.media.id)));
    await page.evaluate(()=>{const select=document.querySelector('#pick-source');select.value='PLANNING';select.dispatchEvent(new Event('change',{bubbles:true}));});
    check(type+' real picker count comes only from Planning',await page.evaluate(n=>document.querySelector('#pickerResult [role="status"]').textContent===n+' matching planned title'+(n===1?'':'s'),plans.length));
    if(plans.length){
      await click('[data-action="pick-title"]');
      const first=await page.evaluate(()=>Number(document.querySelector('.picked-title').dataset.mediaId));
      await click('[data-action="pick-title"]');
      const second=await page.evaluate(()=>Number(document.querySelector('.picked-title').dataset.mediaId));
      check(type+' live draws select eligible planned titles without immediate repeat',plans.some(e=>e.media.id===first)&&plans.some(e=>e.media.id===second)&&(plans.length===1||first!==second),{first,second});
      for(const width of [1224,390]){
        await page.setViewport({width,height:1050,mobile:width===390});
        await page.evaluate(()=>window.scrollTo(0,window.scrollY+document.querySelector('.library-head').getBoundingClientRect().top-12));
        await page.waitFor(()=>!document.querySelector('.picked-title img')||document.querySelector('.picked-title img').complete,{timeout:20000});
        check(type+' '+width+' real pick fits with loaded artwork',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&(!document.querySelector('.picked-title img')||document.querySelector('.picked-title img').naturalWidth>0)));
        await page.screenshot(path.join(out,width+'-'+type.toLowerCase()+'-picker-live.png'));
      }
    }
    collections.push({type,...source});
    await click('[data-library-mode="browse"]');
  }
  check('live library and picker produce no uncaught exceptions',page.events.exceptions.length===0,page.events.exceptions);
  await fs.writeFile(path.join(out,'library-live.json'),JSON.stringify({chrome:browser.version,total:results.length,failed:results.filter(r=>!r.ok).length,results,collections,requests:page.events.requests},null,2));
  assert.ok(results.every(r=>r.ok),'See library-live.json');
} finally { await browser.close(); }
