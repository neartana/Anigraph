import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome } from './cdp.mjs';

const phase = process.argv[2] === 'before' ? 'before' : 'after';
const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-17');
await fs.mkdir(out, { recursive: true });
const source = JSON.parse(await fs.readFile(path.join(import.meta.dirname,'artifacts','acceptance-14','library-live.json'),'utf8'));
const planned = source.collections.find(c=>c.type==='MANGA').entries.filter(e=>e.status==='PLANNING');
const browser = await launchChrome(), page = await browser.newPage(), results = [];
let requests=0;
const check=(name,ok,detail)=>{results.push({name,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+name);};
const click=selector=>page.evaluate(s=>document.querySelector(s).click(),selector);
const select=(selector,value)=>page.evaluate((s,v)=>{const e=document.querySelector(s);e.focus();e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},selector,value);
try {
  await page.setReducedMotion(true);
  await page.route('*graphql.anilist.co*',request=>{
    if(request.method==='OPTIONS')return {status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type, accept'},body:''};
    requests++;
    const {query,variables:v}=JSON.parse(request.postData);
    const entries=structuredClone(planned).map(e=>{if(v.type==='ANIME'){e.media.format='TV';e.media.duration=e.media.genres.includes('Fantasy')?90:12;}if(v.name==='noPlans')e.status='CURRENT';return e;});
    const data=query.includes('UserStats')?{User:{id:123,name:v.name,statistics:null}}:{MediaListCollection:{hasNextChunk:false,lists:[{entries}]}};
    return {status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body:JSON.stringify({data})};
  });
  await page.setViewport({width:1224,height:1000});
  await page.goto('http://127.0.0.1:5174/');
  await click('[data-view-target="library"]');
  await page.evaluate(()=>{document.querySelector('#libraryUsername').value='Neartana';document.querySelector('#libraryProfileForm').requestSubmit();});
  await page.waitForSelector('.library-card');
  await click('[data-library-mode="pick"]');
  for(const type of ['ANIME','MANGA']) {
    await click('[data-media-type="'+type+'"]');await page.waitForSelector('#pickerResult');
    await select('#pick-source','PLANNING');
    const initialRequests=requests;
    check(type+' unavailable moods show a zero count and cannot be selected',await page.evaluate(()=>{const option=document.querySelector('#pick-mood option[value="DRAMA"]');return option.disabled&&option.textContent.includes('(0)');}));
    await select('#pick-mood','DRAMA');
    check(type+' zero-match primary action offers an enabled recovery',await page.evaluate(()=>{const button=document.querySelector('[data-action="pick-unfiltered"]');return button&&!button.disabled&&button.textContent==='CLEAR FILTERS & PICK'&&!document.querySelector('.picked-title');}));
    check(type+' empty-state explains the available planning pool',await page.evaluate(()=>document.querySelector('.picker-waiting').textContent.includes('3 planned titles')));
    await page.evaluate(()=>window.scrollTo(0,window.scrollY+document.querySelector('.library-head').getBoundingClientRect().top-12));
    await page.screenshot(path.join(out,phase+'-'+type.toLowerCase()+'-no-match.png'));
    if(await page.evaluate(()=>!!document.querySelector('[data-action="pick-unfiltered"]'))) {
      await click('[data-action="pick-unfiltered"]');
      check(type+' recovery preserves Planning, clears restrictions, draws and focuses a planned title',await page.evaluate(ids=>[...document.querySelectorAll('[data-pick-filter]')].every(e=>e.value===(e.id==='pick-source'?'PLANNING':'ALL'))&&ids.includes(Number(document.querySelector('.picked-title').dataset.mediaId))&&document.activeElement.id==='pickedTitle',planned.map(e=>e.media.id)));
      let previous=null,valid=true;
      for(let i=0;i<10;i++){await click('[data-action="pick-title"]');const id=await page.evaluate(()=>Number(document.querySelector('.picked-title').dataset.mediaId));valid&&=id!==previous;previous=id;}
      check(type+' recovered picker remains rerollable without immediate repeats',valid);
      await select('#pick-mood','FANTASY');
      await select('#pick-limit',type==='ANIME'?'15':'10');
      check(type+' other filters recalculate mood availability and retain select focus',await page.evaluate(()=>document.querySelector('#pick-mood option[value="FANTASY"]').disabled&&document.querySelector('#pick-mood option[value="FANTASY"]').textContent.includes('(0)')&&document.activeElement.id==='pick-limit'));
      await page.focus('[data-action="pick-unfiltered"]');
      await page.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13},page.sessionId);
      await page.cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},page.sessionId);
      check(type+' recovery works from the keyboard',await page.evaluate(()=>document.activeElement.id==='pickedTitle'&&!!document.querySelector('.picked-title')));
      await page.setViewport({width:390,height:1000,mobile:true});await select('#pick-mood','DRAMA');
      check(type+' recovery controls fit on phones',await page.evaluate(()=>{const r=document.querySelector('[data-action="pick-unfiltered"]').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&r.left>=0&&r.right<=innerWidth&&r.height>=44;}));
      await page.evaluate(()=>window.scrollTo(0,window.scrollY+document.querySelector('.library-head').getBoundingClientRect().top-12));
      await page.screenshot(path.join(out,'390-'+type.toLowerCase()+'-recovery.png'));
      await click('[data-action="pick-unfiltered"]');
      await page.setViewport({width:1224,height:1000});
      await page.evaluate(()=>window.scrollTo(0,window.scrollY+document.querySelector('.library-head').getBoundingClientRect().top-12));
      await page.screenshot(path.join(out,'1224-'+type.toLowerCase()+'-recovered.png'));
    }
    check(type+' recovery and filtering make no additional API requests',requests===initialRequests);
    await click('[data-action="library-reset"]');
  }
  await page.evaluate(()=>{document.querySelector('#libraryUsername').value='noPlans';document.querySelector('#libraryProfileForm').requestSubmit();});await page.waitForSelector('#pickerResult');
  await select('#pick-source','PLANNING');
  check('empty Planning offers an explicit whole-library action without a silent draw',await page.evaluate(()=>!document.querySelector('.picked-title')&&!document.querySelector('[data-action="pick-library"]').disabled&&document.querySelector('.picker-waiting').textContent.includes('Your planning list is empty.')));
  check('no uncaught exceptions',page.events.exceptions.length===0,page.events.exceptions);
  await fs.writeFile(path.join(out,'picker-'+phase+'-results.json'),JSON.stringify({chrome:browser.version,total:results.length,failed:results.filter(r=>!r.ok).length,results},null,2));
  assert.ok(results.every(r=>r.ok),'See picker-'+phase+'-results.json');
} finally {await browser.close();}
