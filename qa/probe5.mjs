import fs from 'node:fs/promises';
import path from 'node:path';
import { launchChrome, serveDir, sleep } from './cdp.mjs';
const here = import.meta.dirname;
let browser = null;
let server = null;
try {
  browser = await launchChrome();
  server = await serveDir(path.resolve(here, '..'));
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(server.url + 'index.html');
  await page.waitForSelector('#statsForm', { timeout: 20000 });
  await page.evaluate(() => { const input = document.getElementById('statsUsername'); input.value = 'matchai'; input.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('statsForm').requestSubmit(); });
  await page.waitForSelector('.profile-banner', { timeout: 30000 });
  await sleep(3000);
  const rect = await page.evaluate(() => { const r = document.querySelector('.profile-banner').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  const shot = await page.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x - 2, y: rect.y - 2, width: rect.width + 4, height: rect.height + 4, scale: 1 } }, page.sessionId);
  const out = path.join(here, 'artifacts', 'acceptance-2', 'banner-defect-evidence.png');
  await fs.writeFile(out, Buffer.from(shot.data, 'base64'));
  const analysis = await page.evaluate(() => {
    const banner = document.querySelector('.profile-banner');
    const img = banner.querySelector('img');
    const fallback = banner.querySelector('.img-fallback');
    const imgStyle = getComputedStyle(img);
    const fallbackStyle = getComputedStyle(fallback);
    const positionedAbove = (fallbackStyle.position !== 'static') && (imgStyle.position === 'static') && fallbackStyle.display !== 'none';
    return {
      img: { position: imgStyle.position, zIndex: imgStyle.zIndex, complete: img.complete, natural: img.naturalWidth + 'x' + img.naturalHeight, broken: img.classList.contains('is-broken') },
      fallback: { position: fallbackStyle.position, zIndex: fallbackStyle.zIndex, display: fallbackStyle.display, background: fallbackStyle.backgroundColor },
      paintOrderDefect: positionedAbove,
      bannerRect: { width: Math.round(banner.getBoundingClientRect().width), height: Math.round(banner.getBoundingClientRect().height) }
    };
  });
  console.log(JSON.stringify(analysis, null, 1));
  console.log('clip saved:', out);
} finally {
  if (server) server.close();
  if (browser) await browser.close();
}
