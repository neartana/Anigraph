import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep, fileUrl } from './cdp.mjs';

const out = path.join(import.meta.dirname, 'artifacts', 'acceptance-19');
await fs.mkdir(out, { recursive: true });
const browser = await launchChrome(), page = await browser.newPage(), results = [], requests = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok?'PASS ':'FAIL ')+name); };
const json = (data, status=200, headers={}) => ({ status, headers: {'content-type':'application/json','access-control-allow-origin':'*','access-control-expose-headers':'Retry-After',...headers}, body:JSON.stringify(data) });
const click = async selector => {await page.evaluate(s=>{const e=document.querySelector(s);if(!e)throw Error('Missing '+s);e.click();},selector);if(selector==='#dialogOk'||selector==='#dialogCancel')await sleep(60);};
const select = (selector,value) => page.evaluate((s,v)=>{const e=document.querySelector(s);e.focus();e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},selector,value);
const input = (selector,value) => page.evaluate((s,v)=>{const e=document.querySelector(s);e.focus();e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},selector,value);
const settle = () => page.waitFor(()=>['viewLibrary','viewRadar'].some(id=>{const e=document.getElementById(id);return !e.hidden&&e.getAttribute('aria-busy')==='false';}));
const mode = async name => { await click('[data-library-mode="'+name+'"]'); await settle(); };
const load = async name => {await input('#libraryUsername',name);await page.evaluate(()=>document.querySelector('#libraryProfileForm').requestSubmit());await page.waitFor(()=>document.querySelector('#viewLibrary[aria-busy="false"]')&&!document.querySelector('#libraryProfileForm button:disabled'));};
const media = (id,type='ANIME',title='Title '+id,genres=['Action','Comedy']) => ({id,type,title:{romaji:title,english:null,native:null},coverImage:{large:'https://s4.anilist.co/file/anilistcdn/qa-feature.jpg'},format:type==='MANGA'?'MANGA':'TV',genres,averageScore:85,isAdult:false,episodes:12,duration:24,chapters:20,startDate:{year:2026}});
const entries = type => ['CURRENT','PLANNING','COMPLETED','REPEATING'].map((status,i)=>({status,score:95-i*5,progress:i,media:media((type==='ANIME'?1001:2001)+i,type, (type==='ANIME'?'Anime ':'Manga ')+(i+1),type==='ANIME'?['Action','Comedy']:['Romance','Comedy'])}));
let catalogState='ready', recState='ready', titlesState='ready', slowRelease=null;
const setUp = async target => {
  await target.setReducedMotion(true);
  await target.cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Jakarta'},target.sessionId);
  await target.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()+window.__clockShift]));}static now(){return RealDate.now()+window.__clockShift;}};window.__clockShift='+ (Date.parse('2026-10-20T12:00:00+07:00')-Date.now())+';'},target.sessionId);
  await target.route('*s4.anilist.co*',()=>({status:200,headers:{'content-type':'image/svg+xml'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="#223248"/></svg>'}));
  await target.route('*/api/ann/news*',()=>json([]));
  await target.route('*graphql.anilist.co*',async request=>{
    if(request.method==='OPTIONS')return {status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,accept'},body:''};
    const body=JSON.parse(request.postData),v=body.variables;requests.push(body);
    if(body.query.includes('UserStats'))return json({data:{User:{id:999,name:v.name,statistics:null}}});
    if(body.query.includes('UserTitles'))return json({data:{MediaListCollection:titlesState==='malformed'?{lists:[]}:{hasNextChunk:false,lists:[{entries:entries(v.type).map(e=>v.name==='unrated'?{...e,score:0}:e)}]}}});
    if(body.query.includes('AiringRadar')) {
      const start=v.start+1;
      const airings=[[1001,1,18],[1002,2,20],[1003,1,16],[9999,1,14],[1004,1,19]].map(([id,day,hour],i)=>({id:8000+i,airingAt:start+day*86400+hour*3600,episode:i+1,media:media(id)}));
      return json({data:{Page:{pageInfo:{hasNextPage:false},airingSchedules:airings}}});
    }
    if(body.query.includes('DiscoverRecommendations')) {
      if(recState==='slow')await new Promise(resolve=>{slowRelease=resolve;});
      if(recState==='malformed')return json({data:{Page:{media:null}}});
      const type=v.type,base=type==='ANIME'?50000:60000;
      return json({data:{Page:{media:v.ids.map((id,i)=>({id,recommendations:{nodes:[{rating:20-i,mediaRecommendation:media(base+1,type,'Recommended <img src=x onerror="window.__injected=1">')},{rating:30,mediaRecommendation:media(v.ids[0],type)},{rating:30,mediaRecommendation:media(base+2,type==='ANIME'?'MANGA':'ANIME')},{rating:90,mediaRecommendation:{...media(base+3,type),isAdult:true}},{rating:1,mediaRecommendation:null}]}}))}}});
    }
    if(body.query.includes('SeasonalCatalog')) {
      if(v.season&&catalogState==='rate')return json({errors:[{message:'Slow down'}]},429,{'retry-after':'1'});
      if(v.season&&catalogState==='malformed')return json({data:{Page:{media:[],pageInfo:null},GenreCollection:[]}});
      const rows=v.season?Array.from({length:v.page===1?24:4},(_,i)=>media(40000+v.page*100+i,'ANIME',i===0?'Seasonal <img src=x onerror="window.__injected=1">':'Seasonal '+i)):[media(v.type==='ANIME'?50004:60004,v.type,'Genre match',v.genre),media(v.exclude[0],v.type)];
      return json({data:{GenreCollection:['Action','Comedy','Romance'],Page:{pageInfo:{hasNextPage:!!v.season&&v.page===1},media:rows}}});
    }
    throw Error('Unexpected query '+body.query.slice(0,60));
  });
};
try {
  await setUp(page);await page.setViewport({width:1440,height:1000});
  await page.goto('http://127.0.0.1:5174/');await click('[data-view-target="library"]');
  await mode('seasons');
  check('Seasons works without a profile and returns real pagination controls',await page.evaluate(()=>document.querySelectorAll('.catalog-grid .library-card').length===24&&!document.querySelector('#libraryProfileForm')&&!document.querySelector('[data-action="catalog-next"]').disabled)&&!requests.some(r=>r.query.includes('UserStats')));
  check('Seasons is fixed to anime and hides the irrelevant division switch',requests.at(-1).variables.type==='ANIME'&&await page.evaluate(()=>document.querySelector('.division-switch').hidden));
  check('Unused catalog filters are omitted instead of sending illegal null arguments',!requests.at(-1).query.includes('averageScore_greater')&&!requests.at(-1).query.includes('id_not_in')&&!requests.at(-1).query.includes('genre_in')&&!requests.at(-1).query.includes('format: $format'));
  await select('#catalog-season','SPRING');await input('#catalog-year','2025');await select('#catalog-genre','Action');await select('#catalog-format','TV');await select('#catalog-score','80');await select('#catalog-sort','SCORE_DESC');
  const beforeApply=requests.length;
  await page.evaluate(()=>document.querySelector('#catalogForm').requestSubmit());await settle();
  const vars=requests.at(-1).variables;
  check('Season filters apply together in one correctly bounded request',requests.length===beforeApply+1&&vars.season==='SPRING'&&vars.year===2025&&vars.genre[0]==='Action'&&vars.format==='TV'&&vars.score===79&&vars.sort[0]==='SCORE_DESC',vars);
  await click('[data-action="catalog-next"]');await settle();
  check('Season pagination changes results and focuses the result heading',await page.evaluate(()=>document.querySelectorAll('.catalog-grid .library-card').length===4&&document.activeElement.id==='catalogResultsTitle'&&document.querySelector('[data-action="catalog-next"]').disabled));
  await click('[data-action="catalog-prev"]');await settle();
  check('Catalog text is escaped and links use validated media IDs',await page.evaluate(()=>!window.__injected&&!document.querySelector('.library-card-copy img')&&document.querySelector('.catalog-grid h2').textContent.includes('<img')&&[...document.querySelectorAll('.catalog-grid a')].every(a=>/^https:\/\/anilist\.co\/anime\/\d+$/.test(a.href))));
  await mode('browse');await load('featureUser');await page.waitForSelector('.library-card');
  for(const type of ['ANIME','MANGA']) {
    await click('[data-media-type="'+type+'"]');await page.waitForSelector('.library-card');await mode('discover');await page.waitForSelector('.catalog-grid');
    const cards=await page.evaluate(()=>[...document.querySelectorAll('.catalog-grid .library-card')].map(e=>({id:Number(e.dataset.mediaId),reason:e.querySelector('.catalog-reason').textContent,link:e.querySelector('a').href})));
    const base=type==='ANIME'?50000:60000;
    check(type+' discovery excludes owned titles, wrong media types, adult entries and duplicates',cards.length===2&&new Set(cards.map(e=>e.id)).size===2&&cards.some(e=>e.id===base+1)&&cards.some(e=>e.id===base+4),cards);
    check(type+' recommendations explain actual seed ratings and genre matches',cards.some(e=>e.reason.includes('95/100'))&&cards.some(e=>e.reason.startsWith('Matches your taste for ')&&(type==='ANIME'?['Action','Comedy']:['Romance','Comedy']).some(genre=>e.reason.includes(genre))));
    const query=requests.filter(r=>r.query.includes('DiscoverRecommendations')).at(-1);
    check(type+' recommendation seeds are the three highest rated titles',JSON.stringify(query.variables.ids)===JSON.stringify(entries(type).slice(0,3).map(e=>e.media.id)));
    check(type+' source links and hostile recommendation titles stay safe',cards.every(e=>e.link.includes('/'+type.toLowerCase()+'/'))&&await page.evaluate(()=>!window.__injected&&!document.querySelector('.library-card-copy img')));
    await page.screenshot(path.join(out,type.toLowerCase()+'-discover-fixture.png'));
    await mode('browse');
  }
  await click('[data-media-type="ANIME"]');await page.waitForSelector('.library-card');
  await click('[data-collection-media="1001"]');await page.waitForSelector('#confirmDialog[open]');await input('#collectionName','Weekend watch');await click('#dialogOk');
  await page.waitFor(()=>!document.querySelector('#confirmDialog').open);
  check('Save to collection can create a named collection and add the chosen title',await page.evaluate(()=>{const groups=JSON.parse(localStorage.getItem('anigraph:v1:collections'));return groups.length===1&&groups[0].name==='Weekend watch'&&groups[0].owner==='featureuser'&&groups[0].items[0].id===1001;}));
  await click('[data-collection-media="1001"]');await page.waitForSelector('#confirmDialog[open]');await click('#dialogOk');await page.waitFor(()=>!document.querySelector('#confirmDialog').open);
  check('Repeated saves do not duplicate collection items',await page.evaluate(()=>JSON.parse(localStorage.getItem('anigraph:v1:collections'))[0].items.length===1));
  await click('[data-collection-media="1002"]');await page.waitForSelector('#confirmDialog[open]');await click('#dialogOk');await page.waitFor(()=>!document.querySelector('#confirmDialog').open);
  await click('[data-media-type="MANGA"]');await page.waitForSelector('.library-card');await click('[data-collection-media="2001"]');await page.waitForSelector('#confirmDialog[open]');await click('#dialogOk');await page.waitFor(()=>!document.querySelector('#confirmDialog').open);
  await mode('collections');
  check('A collection holds both divisions and displays the selected division honestly',await page.evaluate(()=>document.querySelectorAll('.library-grid .library-card').length===1&&document.querySelector('.feature-summary').textContent.includes('3 titles total')&&document.querySelector('.library-grid a').href.endsWith('/manga/2001')));
  await click('[data-action="collection-rename"]');await page.waitForSelector('#confirmDialog[open]');await input('#collectionName','    ');await click('#dialogOk');
  check('A whitespace-only rename cannot erase a saved collection or its items',await page.evaluate(()=>{const group=JSON.parse(localStorage.getItem('anigraph:v1:collections'))[0];return group.name==='Weekend watch'&&group.items.length===3&&document.querySelector('#toast').textContent==='ENTER A COLLECTION NAME';}));
  await click('[data-action="collection-rename"]');await page.waitForSelector('#confirmDialog[open]');await input('#collectionName','Holiday <b>favorites</b>');await click('#dialogOk');await page.waitFor(()=>!document.querySelector('#confirmDialog').open);
  check('Rename persists escaped plain text',await page.evaluate(()=>document.querySelector('#collectionSelect').textContent.includes('Holiday <b>favorites</b>')&&!document.querySelector('#collectionSelect b')));
  await page.reload();await page.waitForSelector('#collectionSelect');
  check('Custom collections and their media survive a reload',await page.evaluate(()=>document.querySelector('#collectionSelect').textContent.includes('Holiday')&&document.querySelectorAll('.library-grid .library-card').length===1));
  await load('anotherUser');await page.waitFor(()=>document.querySelector('#viewLibrary[aria-busy="false"]'));
  check('Collections are scoped to the loaded profile',await page.evaluate(()=>!document.querySelector('#collectionSelect')&&document.querySelector('#viewLibrary').textContent.includes('A place for your favorites.')));
  await load('featureUser');await page.waitForSelector('#collectionSelect');
  await click('[data-view-target="radar"]');await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"] .radar-episode'));
  await click('[data-radar-scope="MINE"]');await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"] .radar-next'));
  await click('[data-radar-day="ALL"]');
  const mine=await page.evaluate(()=>[...document.querySelectorAll('.radar-episode')].map(e=>Number(e.dataset.mediaId)));
  check('My Schedule uses anime Watching, Repeating and Planning despite manga division',JSON.stringify(mine)==='[1001,1004,1002]',mine);
  check('Next up shows the earliest future eligible episode with its source link',await page.evaluate(()=>document.querySelector('.radar-next a').href.endsWith('/anime/1001')&&document.querySelector('.radar-next').textContent.includes('Episode 1')));
  const requestsBeforeListFilter=requests.length;
  await select('#radar-list-status','PLANNING');
  check('Planning filter updates days, counts and Next up without a query',requests.length===requestsBeforeListFilter&&await page.evaluate(()=>document.querySelectorAll('.radar-episode').length===1&&document.querySelector('.radar-next a').href.endsWith('/anime/1002')&&document.activeElement.id==='radar-list-status'));
  await page.screenshot(path.join(out,'my-schedule-fixture.png'));
  await page.reload();await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"] .radar-next'));
  check('My Schedule scope, list filter and profile restore on reload',await page.evaluate(()=>document.querySelector('[data-radar-scope="MINE"]').getAttribute('aria-pressed')==='true'&&document.querySelector('#radar-list-status').value==='PLANNING'&&document.querySelector('.radar-next a').href.endsWith('/anime/1002')));
  await select('#radar-list-status','CURRENT');
  for(const width of [1440,985,768,390,320]) {
    await page.setViewport({width,height:1000,mobile:width<=390});
    check(width+' My Schedule controls and Next up fit',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.radar-scope select,.radar-next,.radar-scope button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})));
    await click('[data-view-target="library"]');await mode('collections');
    check(width+' collection controls and cards fit',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.collections-toolbar button,.collections-toolbar select,.library-tools button,.library-grid .library-card')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})));
    await mode('seasons');
    check(width+' seasonal filters and cards fit',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('#catalogForm input,#catalogForm select,#catalogForm button,.catalog-grid .library-card')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})));
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot(path.join(out,width+'-seasons-fixture.png'));
    await click('[data-view-target="radar"]');await page.waitFor(()=>document.querySelector('#viewRadar[aria-busy="false"]'));
  }
  await click('[data-view-target="library"]');await mode('collections');
  await click('[data-action="collection-remove"]');
  check('Removing an item persists without affecting AniList',await page.evaluate(()=>JSON.parse(localStorage.getItem('anigraph:v1:collections'))[0].items.length===2&&document.querySelectorAll('.library-grid .library-card').length===0));
  await click('[data-action="collection-delete"]');await page.waitForSelector('#confirmDialog[open]');await click('#dialogCancel');await page.waitFor(()=>!document.querySelector('#confirmDialog').open);
  check('Deleting a collection can be canceled',await page.evaluate(()=>JSON.parse(localStorage.getItem('anigraph:v1:collections')).length===1));
  await click('[data-action="collection-delete"]');await page.waitForSelector('#confirmDialog[open]');await click('#dialogOk');await page.waitFor(()=>!document.querySelector('#confirmDialog').open);
  check('Confirmed deletion removes only the local collection',await page.evaluate(()=>JSON.parse(localStorage.getItem('anigraph:v1:collections')).length===0&&document.querySelector('#viewLibrary').textContent.includes('A place for your favorites.')));
  await mode('seasons');catalogState='malformed';await input('#catalog-year','2024');await page.evaluate(()=>document.querySelector('#catalogForm').requestSubmit());await page.waitForSelector('[data-action="retry-catalog"]');
  check('Malformed seasonal responses show a recoverable error',await page.evaluate(()=>!document.querySelector('.catalog-grid')&&document.querySelector('[data-action="retry-catalog"]').disabled===false));
  catalogState='ready';await click('[data-action="retry-catalog"]');await page.waitForSelector('.catalog-grid');
  check('Retry bypasses a malformed cached response and recovers',await page.evaluate(()=>document.querySelectorAll('.catalog-grid .library-card').length===24));
  catalogState='rate';await input('#catalog-year','2023');await page.evaluate(()=>document.querySelector('#catalogForm').requestSubmit());await page.waitForSelector('[data-action="retry-catalog"]');
  check('Seasonal rate limits disable retry during Retry-After',await page.evaluate(()=>document.querySelector('[data-action="retry-catalog"]').disabled));
  catalogState='ready';await page.waitFor(()=>!document.querySelector('[data-action="retry-catalog"]').disabled,{timeout:5000});await click('[data-action="retry-catalog"]');await page.waitForSelector('.catalog-grid');
  await mode('browse');await load('unrated');await mode('discover');await page.waitForSelector('.catalog-grid');
  check('Unrated libraries receive an explained genre-based fallback',await page.evaluate(()=>document.querySelector('.feature-summary').textContent.includes('Rate titles on AniList')&&document.querySelector('.catalog-reason').textContent.includes('Matches your taste')));
  recState='malformed';await mode('browse');await load('featureUser');await page.evaluate(()=>sessionStorage.clear());await mode('discover');await page.waitForSelector('[data-action="retry-discover"]');
  recState='ready';await click('[data-action="retry-discover"]');await page.waitForSelector('.catalog-grid');
  check('Discovery retry recovers from a malformed cached recommendation response',await page.evaluate(()=>document.querySelectorAll('.catalog-grid .library-card').length===2));
  await mode('browse');await load('featureUser');await page.evaluate(()=>sessionStorage.clear());recState='slow';await click('[data-library-mode="discover"]');
  await page.waitFor(()=>document.querySelector('#viewLibrary[aria-busy="true"]'));
  while(!slowRelease)await sleep(10);
  recState='ready';await click('[data-media-type="ANIME"]');await page.waitForSelector('.catalog-grid');slowRelease();await sleep(100);
  check('A delayed old-division recommendation cannot overwrite current results',await page.evaluate(()=>[...document.querySelectorAll('.catalog-grid a')].every(a=>a.href.includes('/anime/'))));
  await mode('collections');await click('[data-action="collection-create"]');await page.waitForSelector('#confirmDialog[open]');await click('#dialogCancel');
  check('A blank required collection name does not prevent Cancel',await page.evaluate(()=>!document.querySelector('#confirmDialog').open));
  await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='anigraph:v1:collections')throw new Error('Quota fixture');return window.__originalSetItem.call(this,key,value);};});
  await click('[data-action="collection-create"]');await page.waitForSelector('#confirmDialog[open]');await input('#collectionName','Cannot save');await click('#dialogOk');
  check('Storage failure reports an error without a false save or data loss',await page.evaluate(()=>!document.querySelector('#collectionSelect')&&document.querySelector('#toast').textContent.includes('SAVE FAILED')&&JSON.parse(localStorage.getItem('anigraph:v1:collections')).length===0));
  await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;});
  for(const name of ['First group','Second group']){await click('[data-action="collection-create"]');await page.waitForSelector('#confirmDialog[open]');await input('#collectionName',name);await click('#dialogOk');}
  const selectedGroup=await page.evaluate(()=>document.querySelector('#collectionSelect').value);
  await click('[data-media-type="MANGA"]');await page.waitForSelector('#collectionSelect');
  check('Switching divisions keeps the chosen collection instead of jumping to the first',await page.evaluate(id=>document.querySelector('#collectionSelect').value===id&&document.querySelector('#collectionSelect').selectedOptions[0].textContent.includes('Second group'),selectedGroup));
  await click('[data-media-type="ANIME"]');await page.waitForSelector('#collectionSelect');await mode('seasons');
  const seasonalId=await page.evaluate(()=>Number(document.querySelector('.catalog-grid .library-card').dataset.mediaId));
  await click('[data-collection-media="'+seasonalId+'"]');await page.waitForSelector('#confirmDialog[open]');await select('#collectionTarget',selectedGroup);await click('#dialogOk');
  await mode('discover');await page.waitForSelector('.catalog-grid');await click('[data-collection-media="50001"]');await page.waitForSelector('#confirmDialog[open]');await select('#collectionTarget',selectedGroup);await click('#dialogOk');
  check('Seasonal and discovered titles can both be saved before they enter AniList Library',await page.evaluate(({id,seasonalId})=>{const g=JSON.parse(localStorage.getItem('anigraph:v1:collections')).find(g=>g.id===id);return g.items.some(e=>e.id===seasonalId)&&g.items.some(e=>e.id===50001);},{id:selectedGroup,seasonalId}));
  await mode('collections');
  await page.evaluate(()=>{const groups=JSON.parse(localStorage.getItem('anigraph:v1:collections'));groups[1].items=[{id:999,type:'ANIME',title:'<img src=x onerror="window.__injected=1">',cover:'javascript:alert(1)'},{id:-1,type:'ANIME',title:'Invalid'},{id:998,type:'INVALID',title:'Invalid'}];localStorage.setItem('anigraph:v1:collections',JSON.stringify(groups));});
  await page.reload();await page.waitForSelector('#collectionSelect');await select('#collectionSelect',selectedGroup);
  check('Stored snapshots reject unsafe artwork and invalid IDs/types and escape text',await page.evaluate(()=>document.querySelectorAll('.library-grid .library-card').length===1&&!document.querySelector('.library-grid img')&&!document.querySelector('.library-card-copy img')&&!window.__injected&&document.querySelector('.library-card-copy h2').textContent.includes('<img')));
  await click('[data-view-target="radar"]');await page.waitFor(()=>document.querySelector('.radar-next'));
  await select('#radar-list-status','CURRENT');
  const beforeClock=requests.length;
  await page.evaluate(()=>{window.__clockShift+=6*3600000+60000;});
  await page.waitFor(()=>document.querySelector('.radar-next a')?.href.endsWith('/anime/1004'),{timeout:34000});
  check('Next up advances after an airing passes without making another request',requests.length===beforeClock&&await page.evaluate(()=>document.querySelector('[data-media-id="1001"] .radar-countdown').classList.contains('is-aired')));
  const coldContext=await browser.newContext(),cold=await coldContext.newPage();
  try {
    await setUp(cold);await cold.goto('http://127.0.0.1:5174/');await cold.evaluate(()=>document.querySelector('[data-view-target="radar"]').click());await cold.waitForSelector('[data-radar-scope="MINE"]');await cold.evaluate(()=>document.querySelector('[data-radar-scope="MINE"]').click());
    check('My Schedule without a profile explains how to load the library',await cold.evaluate(()=>document.querySelector('.radar-message').textContent.includes('Load your AniList library')&&!!document.querySelector('[data-action="open-my-library"]')));
    await cold.evaluate(()=>document.querySelector('[data-action="open-my-library"]').click());
    check('The schedule library action opens the visible username field and focuses it',await cold.evaluate(()=>document.activeElement.id==='libraryUsername'&&!document.querySelector('#viewLibrary').hidden));
    await cold.evaluate(()=>{document.querySelector('#libraryUsername').value='featureUser';document.querySelector('#libraryProfileForm').requestSubmit();});await cold.waitForSelector('.library-card');await cold.evaluate(()=>document.querySelector('[data-view-target="radar"]').click());await cold.waitForSelector('.radar-next');
    check('Loading a profile completes the personal-schedule flow',await cold.evaluate(()=>document.querySelector('.radar-next a').href.endsWith('/anime/1001')));
  } finally {await cold.close();await coldContext.close();}
  const brokenContext=await browser.newContext(),broken=await brokenContext.newPage();
  try {
    titlesState='malformed';await setUp(broken);await broken.goto('http://127.0.0.1:5174/');await broken.evaluate(()=>document.querySelector('[data-view-target="library"]').click());await broken.evaluate(()=>{document.querySelector('#libraryUsername').value='recoverProfile';document.querySelector('#libraryProfileForm').requestSubmit();});await broken.waitForSelector('[data-action="retry-library"]');await broken.evaluate(()=>document.querySelector('[data-view-target="radar"]').click());await broken.waitForSelector('[data-radar-scope="MINE"]');await broken.evaluate(()=>document.querySelector('[data-radar-scope="MINE"]').click());await broken.waitForSelector('[data-action="retry-my-schedule"]');
    check('My Schedule surfaces an incomplete-library error with a retry',await broken.evaluate(()=>!document.querySelector('.radar-next')&&!document.querySelector('[data-action="retry-my-schedule"]').disabled));
    titlesState='ready';await broken.evaluate(()=>document.querySelector('[data-action="retry-my-schedule"]').click());await broken.waitForSelector('.radar-next');
    check('Personal-schedule retry discards a malformed cached library page and recovers',await broken.evaluate(()=>document.querySelector('.radar-next a').href.endsWith('/anime/1001')));
  } finally {titlesState='ready';await broken.close();await brokenContext.close();}
  const fileContext=await browser.newContext(),file=await fileContext.newPage();
  try {
    await setUp(file);await file.goto(fileUrl(path.join(import.meta.dirname,'..','index.html')));await file.evaluate(()=>document.querySelector('[data-view-target="library"]').click());await file.evaluate(()=>document.querySelector('[data-library-mode="seasons"]').click());await file.waitForSelector('.catalog-grid');
    check('Seasonal Explorer works from file:// without a profile or proxy',await file.evaluate(()=>document.querySelectorAll('.catalog-grid .library-card').length===24)&&!file.events.requests.some(r=>r.url.includes('/api/ann/')));
  } finally {await file.close();await fileContext.close();}
  check('All external AniList operations remain read-only queries',requests.every(r=>r.query.trim().startsWith('query')));
  check('No uncaught exceptions',page.events.exceptions.length===0,page.events.exceptions);
} catch(error) {
  check('feature flow completes without an unexpected error',false,String(error.stack));
  await page.screenshot(path.join(out,'feature-failure.png'));
} finally {
  if(slowRelease)slowRelease();
  await fs.writeFile(path.join(out,'new-feature-results.json'),JSON.stringify({chrome:browser.version,total:results.length,failed:results.filter(r=>!r.ok).length,results,requests},null,2));
  await browser.close();
}
assert.ok(results.every(r=>r.ok),'See new-feature-results.json');
