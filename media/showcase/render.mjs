import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const sharp = createRequire(import.meta.url)('sharp');
sharp.concurrency(3);
const here = import.meta.dirname, media = path.resolve(here, '..'), scratch = path.join(here, '.render');
const W = 1920, H = 1080, FPS = 30, DURATION = 30;
const C = { ink: '#0A121E', panel: '#101B2A', rule: '#223248', white: '#F2F5F8', muted: '#93A5BD', blue: '#3DB4F2', teal: '#4FD1C5' };
const scenes = [
  { key: 'stats', start: 3, end: 8, tag: 'STATS', title: ['See your', 'taste.'], subtitle: ['Scores, genres, and progress.', 'A clearer view of your favorites.'], note: 'AniList + MyAnimeList', file: 'stats.jpg' },
  { key: 'library', start: 8, end: 13, tag: 'MY LIBRARY', title: ['Every title.', 'One place.'], subtitle: ['Search. Filter. Collect.', 'Make your library feel like yours.'], note: 'Anime and manga', file: 'library.jpg' },
  { key: 'pick', start: 13, end: 16, tag: 'PICK FOR ME', title: ['Less scrolling.', 'More watching.'], subtitle: ['One pick from your library.'], note: '', file: 'pick.jpg' },
  { key: 'discover', start: 16, end: 19, tag: 'DISCOVER', title: ['Find your', 'next favorite.'], subtitle: ['Inspired by your ratings.'], note: '', file: 'discover.jpg' },
  { key: 'airing', start: 19, end: 23, tag: 'AIRING RADAR', title: ['Know what’s', 'next.'], subtitle: ['A day-by-day anime schedule.', 'Local times. Your schedule.'], note: 'All anime or My Schedule', file: 'airing.jpg' },
  { key: 'tiers', start: 23, end: 26, tag: 'TIER LISTS', title: ['Your cast.', 'Your ranking.'], subtitle: ['Save your board. Share the link.'], note: 'Example board · demonstration rankings', file: 'tiers.jpg' }
];
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => 1 - Math.pow(1 - clamp(n), 3);
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const text = (s, x, y, size, color = C.white, weight = 600, extra = '') => `<text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${xml(s)}</text>`;
function mark(x, y, scale = 1, p = 1) {
  const rects = [[0,0,13,32,C.blue], [18,0,16,14,C.white], [18,19,16,13,C.teal]];
  return `<g transform="translate(${x} ${y}) scale(${scale})">${rects.map((r, i) => { const q = ease(p * 2.5 - i * .2); return `<rect x="${r[0]}" y="${r[1] + 30 * (1 - q)}" width="${r[2]}" height="${r[3]}" fill="${r[4]}" opacity="${q}"/>`; }).join('')}</g>`;
}
function bars(t, x, y, opacity = 1, scale = 1) {
  return `<g opacity="${opacity}" transform="translate(${x} ${y}) scale(${scale})">${[35,58,84,55,120,156,113,194,153,225,182,260].map((height, i) => {
    const h = height * ease(t - i * .055);
    return `<rect x="${i * 33}" y="${260 - h}" width="21" height="${h}" rx="3" fill="${i % 4 === 0 ? C.teal : C.blue}" opacity="${.25 + i / 17}"/>`;
  }).join('')}</g>`;
}
function background(t) {
  const lines = Array.from({ length: 13 }, (_, i) => `<path d="M ${100+i*144} 0 V1080" stroke="${C.rule}" stroke-opacity=".17"/>`).join('');
  return `<rect width="1920" height="1080" fill="${C.ink}"/><ellipse cx="${1510+Math.sin(t*.2)*60}" cy="400" rx="600" ry="520" fill="url(#light)"/>${lines}<path d="M100 155H1820" stroke="${C.rule}" stroke-opacity=".7"/>`;
}
function brand() { return mark(100, 84, 1.15) + text('ANIGRAPH', 156, 116, 32, C.white, 750, 'letter-spacing="-.5"') + text('ANIME + MANGA', 1820, 112, 18, C.muted, 500, 'text-anchor="end" letter-spacing="3"'); }
function footer(t) {
  const labels = ['STATS', 'LIBRARY', 'PICK FOR ME', 'DISCOVER', 'AIRING', 'TIER LISTS'];
  const current = scenes.findIndex(s => t >= s.start && t < s.end);
  return `<rect x="100" y="1032" width="1720" height="2" fill="${C.rule}"/><rect x="100" y="1032" width="${1720 * clamp(t / DURATION)}" height="2" fill="${C.blue}"/>` + labels.map((label, i) => text(label, 100 + i * 292, 1007, 16, i === current ? C.blue : C.muted, i === current ? 700 : 400, 'letter-spacing="1.5"')).join('');
}
const images = {};
function feature(s, t) {
  const local = t - s.start, reveal = ease((local + .32) / .6), fade = clamp((s.end - t) / .28), progress = clamp(local / (s.end-s.start));
  const opacity = reveal * fade, dy = 32 * (1 - reveal);
  const words = s.title.map((line, i) => text(line, 100, 395+i*91, line.length > 12 ? 64 : 76, i ? C.blue : C.white, 750, 'letter-spacing="-2.5"')).join('');
  const subtitle = s.subtitle.map((line, i) => text(line, 104, 586+i*42, 27, C.muted, 400)).join('');
  const sx = 642 + 110 * (1 - reveal), sy = 227 + Math.sin(progress*Math.PI)*-8, sw = 1178, sh = 736;
  const zoom = 1.025 + progress*.025;
  const image = `<g transform="translate(${sx} ${sy})"><rect x="-1" y="-1" width="${sw+2}" height="${sh+2}" rx="18" fill="${C.blue}" fill-opacity=".2"/><g clip-path="url(#screen)"><rect width="${sw}" height="${sh}" fill="${C.panel}"/><image href="${images[s.key]}" x="${-(zoom-1)*sw/2}" y="${-(zoom-1)*sh/2}" width="${sw*zoom}" height="${sh*zoom}" preserveAspectRatio="xMidYMid slice"/></g><path d="M18 0 H${sw-18}" stroke="${C.white}" stroke-opacity=".15"/></g>`;
  return `<g opacity="${opacity}"><g transform="translate(0 ${dy})">${text(s.tag,104,296,20,C.blue,600,'letter-spacing="4"')}${words}${subtitle}${text(s.note,104,702,s.key==='tiers'?17:19,C.muted,400)}${bars(local,104,770,.75,.56)}</g>${image}</g>`;
}
function opening(t) {
  const p = ease(t / .65), fade = clamp((3.1-t)/.4), opacity = p * fade;
  return `<g opacity="${opacity}">${bars(t*.8,280,575,.18,1.7)}${bars(t*.8,1190,250,.15,1.5)}${text('YOUR WORLD, IN PERSPECTIVE',960,310,22,C.muted,500,'text-anchor="middle" letter-spacing="6"')}<g transform="translate(0 ${26*(1-p)})">${mark(430,408,3.4,t)}${text('ANIGRAPH',575,510,140,C.white,800,'letter-spacing="-5"')}${text('Your anime. Your story.',960,620,42,C.muted,400,'text-anchor="middle"')}</g><path d="M 760 685 H ${760+400*ease(t-.55)}" stroke="${C.blue}" stroke-width="4"/></g>`;
}
function closing(t) {
  const local = t-26, p=ease(local/.7);
  return `<g opacity="${p}" transform="translate(0 ${35*(1-p)})">${bars(local,200,610,.22,1.2)}${bars(local,1300,420,.2,1.2)}${mark(830,240,1.8,local)}${text('ANIGRAPH',916,294,44,C.white,750,'letter-spacing="-1"')}${text('Explore Anigraph.',960,493,106,C.white,750,'text-anchor="middle" letter-spacing="-4"')}${text('Stats. Discovery. Your library.',960,578,38,C.muted,400,'text-anchor="middle"')}<g opacity="${ease(local-.45)}"><rect x="385" y="674" width="1150" height="102" rx="14" fill="${C.blue}"/>${text('github.com/neartana/Anigraph',960,740,39,C.ink,650,'text-anchor="middle"')}${text('Made for AniList + MyAnimeList users',960,846,27,C.muted,400,'text-anchor="middle"')}</g></g>`;
}
function frame(t) {
  assert.ok(Number.isFinite(t) && t >= 0 && t <= DURATION);
  const visible = scenes.filter(s => t >= s.start - .32 && t < s.end);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><radialGradient id="light"><stop stop-color="${C.blue}" stop-opacity=".08"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></radialGradient><clipPath id="screen"><rect width="1178" height="736" rx="18"/></clipPath></defs>${background(t)}${brand()}${t<3.1?opening(t):''}${visible.map(s=>feature(s,t)).join('')}${t>=26?closing(t):''}${footer(t)}</svg>`;
}
function soundtrack() {
  const rate=48000, length=rate*DURATION, samples=new Float32Array(length), beat=60/112;
  const chords=[[130.813,155.563,195.998],[103.826,130.813,155.563],[116.541,146.832,174.614],[97.999,123.471,146.832]];
  let seed=89321;
  const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
  for(let i=0;i<length;i++){
    const t=i/rate, chord=chords[Math.floor(t/(beat*8))%chords.length], tick=t%beat;
    const fade=Math.min(clamp(t/1.4),clamp((DURATION-t)/1.8));
    let v=chord.reduce((sum,f,j)=>sum+Math.sin(2*Math.PI*f*t+Math.sin(t*.5+j)*.12)*.018,0);
    const note=chord[Math.floor(t/(beat/2))%3]*4, env=Math.exp(-(t%(beat/2))*15);
    v+=Math.sin(2*Math.PI*note*t)*env*.026;
    v+=Math.sin(2*Math.PI*(49*t + 8*(1-Math.exp(-tick*35))))*Math.exp(-tick*27)*.055;
    v+=noise()*Math.exp(-(t%(beat/2))*95)*.012;
    const transition=[3,8,13,16,19,23,26].some(s=>t>=s-.12&&t<s+.08);
    if(transition) v+=noise()*.009;
    samples[i]=v*fade;
  }
  const wav=Buffer.alloc(44+length*2); wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(length*2,40);
  let peak=0; for(let i=0;i<length;i++){assert.ok(Number.isFinite(samples[i]));peak=Math.max(peak,Math.abs(samples[i]));wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),44+i*2);} assert.ok(peak>.01&&peak<.2,'soundtrack must be quiet and unclipped');
  return wav;
}
async function loadAssets(){
  for(const s of scenes){const file=await fs.readFile(path.join(here,'assets',s.file));const info=await sharp(file).metadata();assert.ok(info.width>=1200&&info.height>=700,s.file+' needs a real desktop capture');images[s.key]='data:image/jpeg;base64,'+file.toString('base64');}
}
async function previews(){
  const times=[1.7,5.4,10.2,14.6,17.4,21,24.5,28.3], thumbs=[];
  for(let i=0;i<times.length;i++){
    const png=await sharp(Buffer.from(frame(times[i]))).png().toBuffer();
    await fs.writeFile(path.join(scratch,`scene-${i+1}.png`),png);
    thumbs.push({input:await sharp(png).resize(480,270).png().toBuffer(),left:(i%4)*480,top:Math.floor(i/4)*270});
  }
  await sharp({create:{width:1920,height:540,channels:3,background:C.ink}}).composite(thumbs).png().toFile(path.join(scratch,'contact-sheet.png'));
  await sharp(Buffer.from(frame(5.4))).jpeg({quality:94}).toFile(path.join(media,'anigraph-showcase-poster.jpg'));
  console.log('8 scene previews and poster rendered.');
}
async function playbackFormats(mp4){
  const formats = [
    ['anigraph-showcase.webm', ['-map','0:v:0','-map','0:a:0','-c:v','libvpx-vp9','-b:v','0','-crf','33','-deadline','good','-cpu-used','4','-row-mt','1','-threads','4','-pix_fmt','yuv420p','-r',String(FPS),'-c:a','libopus','-b:a','96k'], 95],
    ['anigraph-showcase-preview.gif', ['-an','-filter_complex','[0:v]fps=8,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle','-loop','0'], 8]
  ];
  for(const [name, options, maxMB] of formats){
    const output=path.join(media,name);
    const child=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y','-i',mp4,...options,output],{stdio:['ignore','ignore','pipe'],windowsHide:true});
    let errors='';child.stderr.on('data',data=>{errors+=data;});
    await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('FFmpeg failed for '+name+': '+errors)));});
    const info=await fs.stat(output);assert.ok(info.size>10000&&info.size<maxMB*1024*1024,name+' exceeds its publishing size limit');
    console.log(`Saved ${output} (${(info.size/1024/1024).toFixed(1)} MB)`);
  }
}
await fs.mkdir(scratch,{recursive:true});await loadAssets();await previews();
if(!process.argv.includes('--preview')){
  const audio=path.join(scratch,'soundtrack.wav');await fs.writeFile(audio,soundtrack());
  const output=path.join(media,'anigraph-showcase.mp4');
  const child=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-r',String(FPS),'-i','pipe:0','-i',audio,'-c:v','libx264','-preset','medium','-crf','21','-pix_fmt','yuv420p','-r',String(FPS),'-c:a','aac','-b:a','128k','-movflags','+faststart','-t',String(DURATION),output],{stdio:['pipe','ignore','pipe'],windowsHide:true});
  let errors='';child.stderr.on('data',data=>{errors+=data;});child.stdin.on('error',()=>{});
  const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('FFmpeg failed: '+errors)));});
  const total=FPS*DURATION;
  for(let start=0;start<total;start+=4){
    const frames=await Promise.all(Array.from({length:Math.min(4,total-start)},(_,i)=>sharp(Buffer.from(frame((start+i)/FPS))).png({compressionLevel:1}).toBuffer()));
    for(const buffer of frames)if(!child.stdin.write(buffer))await once(child.stdin,'drain');
    if(start%60===0)console.log(`Rendered ${start}/${total} frames`);
  }
  child.stdin.end();await finished;
  const info=await fs.stat(output);assert.ok(info.size>100000&&info.size<95*1024*1024,'MP4 must fit normal GitHub uploads');
  console.log(`Saved ${output} (${(info.size/1024/1024).toFixed(1)} MB)`);
  await playbackFormats(output);
}
