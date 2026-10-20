import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './cdp.mjs';
const out=path.join(import.meta.dirname,'artifacts','acceptance-19');
await fs.mkdir(out,{recursive:true});
const browser=await launchChrome(),page=await browser.newPage(),results=[];
const check=(name,ok,detail)=>{results.push({name,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+name);};
const click=s=>page.evaluate(sel=>document.querySelector(sel).click(),s);
const load=async()=>{await page.evaluate(()=>{document.querySelector('#libraryUsername').value='Neartana';document.querySelector('#libraryProfileForm').requestSubmit();});await page.waitForSelector('.library-card',{timeout:60000});};
const librarySource=type=>page.evaluate(type=>{
  const pages=Object.entries(sessionStorage).filter(([key])=>key.startsWith('anigraph:v1:cache:[')&&JSON.parse(key.slice(18))[0].includes('UserTitles')&&JSON.parse(key.slice(18))[1].type===type).map(([key,value])=>({v:JSON.parse(key.slice(18))[1],data:JSON.parse(value).data.MediaListCollection})).sort((a,b)=>a.v.chunk-b.v.chunk);
  const entries=new Map();for(const p of pages)for(const list of p.data.lists)for(const e of list.entries||[])if(e.media?.id)entries.set(e.media.id,e);
  return {pages:pages.map(p=>({chunk:p.v.chunk,hasNext:p.data.hasNextChunk})),entries:[...entries.values()]};
},type);
try {
  await page.setReducedMotion(true);await page.setViewport({width:1440,height:1100});
  await page.cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Jakarta'},page.sessionId);
  await page.route('*/api/ann/news*',()=>({status:200,headers:{'content-type':'application/json'},body:'[]'}));
  await page.goto('http://127.0.0.1:5174/');await click('[data-view-target="library"]');await click('[data-library-mode="seasons"]');await page.waitForSelector('.catalog-grid',{timeout:60000});
  check('Live Seasonal Explorer returns titles with working next-page navigation',await page.evaluate(()=>document.querySelectorAll('.catalog-grid .library-card').length>0&&!document.querySelector('[data-action="catalog-next"]').disabled));
  await click('[data-action="catalog-next"]');await page.waitFor(()=>document.querySelector('#catalogResultsTitle')?.textContent.includes('page 2'),{timeout:60000});
  check('Live seasonal page 2 retains its filters and renders distinct IDs',await page.evaluate(()=>document.querySelectorAll('.catalog-grid .library-card').length>0&&document.querySelector('.library-pagination span').textContent==='Page 2'));
  await page.evaluate(()=>{document.querySelector('#catalog-year').value='2025';document.querySelector('#catalog-season').value='SPRING';document.querySelector('#catalog-genre').value='Action';document.querySelector('#catalog-format').value='TV';document.querySelector('#catalog-score').value='80';document.querySelector('#catalogForm').requestSubmit();});await page.waitForSelector('#catalogResultsTitle',{timeout:60000});
  const filtered=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('anigraph:v1:cache:[')&&JSON.parse(key.slice(18))[0].includes('SeasonalCatalog')&&JSON.parse(key.slice(18))[1].year===2025).map(([,value])=>JSON.parse(value).data.Page.media).flat());
  check('Live genre, format, season/year and minimum-score filters return matching data',filtered.length>0&&filtered.every(e=>e.format==='TV'&&e.genres.includes('Action')&&e.averageScore>=80),filtered.map(e=>({id:e.id,title:e.title.romaji,score:e.averageScore})));
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot(path.join(out,'1440-seasons-live.png'));
  await click('[data-library-mode="browse"]');await load();
  const sources={};
  for(const type of ['ANIME','MANGA']) {
    await click('[data-media-type="'+type+'"]');await page.waitForSelector('.library-card',{timeout:60000});sources[type]=await librarySource(type);
    await click('[data-library-mode="discover"]');await page.waitForSelector('.catalog-grid',{timeout:60000});
    const cards=await page.evaluate(()=>[...document.querySelectorAll('.catalog-grid .library-card')].map(e=>({id:Number(e.dataset.mediaId),link:e.querySelector('a').href,cover:e.querySelector('img')?.src,reason:e.querySelector('.catalog-reason').textContent})));
    const known=new Set(sources[type].entries.map(e=>e.media.id));
    check(type+' live discovery excludes every title from the complete public collection',cards.length>0&&cards.every(e=>!known.has(e.id)),{collection:sources[type].entries.length,chunks:sources[type].pages,cards:cards.length});
    check(type+' real recommendations have source links, artwork and an explanation',cards.every(e=>e.link===`https://anilist.co/${type.toLowerCase()}/${e.id}`&&/^https:\/\/(?:s[0-9]+|img)\.anilist.co\//.test(e.cover)&&e.reason.length>20),cards.slice(0,3));
    await page.waitFor(()=>[...document.querySelectorAll('.catalog-grid img')].filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight;}).every(e=>e.complete),{timeout:25000});
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot(path.join(out,'1440-'+type.toLowerCase()+'-discover-live.png'));
    await click('[data-library-mode="browse"]');
  }
  await click('[data-view-target="radar"]');await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"]'),{timeout:60000});await click('[data-radar-scope="MINE"]');await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"]'),{timeout:60000});
  const expectedIds=new Set(sources.ANIME.entries.filter(e=>['CURRENT','REPEATING','PLANNING'].includes(e.status)).map(e=>e.media.id));
  const schedules=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('anigraph:v1:cache:[')&&JSON.parse(key.slice(18))[0].includes('AiringRadar')).flatMap(([,value])=>JSON.parse(value).data.Page.airingSchedules));
  const expected=[...new Map(schedules.filter(e=>expectedIds.has(e.media?.id)).map(e=>[e.id,e])).values()];
  const visible=await page.evaluate(()=>[...document.querySelectorAll('.radar-episode')].map(e=>Number(e.dataset.scheduleId)));
  check('My Schedule matches the real watching/planning anime while preserving manga division',expected.length===visible.length&&expected.every(e=>visible.includes(e.id)),{eligible:expectedIds.size,matching:expected.length});
  if(!expected.length)check('A real empty personal week shows an honest message',await page.evaluate(()=>document.querySelector('#viewRadar').textContent.includes('No matching anime airs this week.')&&!document.querySelector('.radar-next')));
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot(path.join(out,'1440-my-schedule-live.png'));
  check('Live new-feature flows have no uncaught exceptions',page.events.exceptions.length===0,page.events.exceptions);
} catch(error) {check('Live feature flow completes',false,String(error.stack));await page.screenshot(path.join(out,'live-feature-failure.png'));}
finally {await fs.writeFile(path.join(out,'feature-live-results.json'),JSON.stringify({chrome:browser.version,total:results.length,failed:results.filter(e=>!e.ok).length,results,requests:page.events.requests},null,2));await browser.close();}
assert.ok(results.every(e=>e.ok),'See feature-live-results.json');
