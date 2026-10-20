import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, sleep } from './cdp.mjs';

const phase = process.argv[2] || 'before';
const username = process.argv[3] || 'derF';
const artifacts = path.join(import.meta.dirname, 'artifacts', 'design-' + phase);
const browser = await launchChrome();
try {
  await fs.mkdir(artifacts, { recursive: true });
  const page = await browser.newPage();
  await page.setReducedMotion(true);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5174/');
  await page.evaluate((name) => {
    const input = document.querySelector('#statsUsername');
    input.value = name; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#statsForm').requestSubmit();
  }, username);
  await page.waitForSelector('[data-panel="titles"] .chart-title-label', { timeout: 40000 });
  const data = {};
  for (const division of ['ANIME', 'MANGA']) {
    await page.evaluate((type) => document.querySelector('[data-media-type="' + type + '"]').click(), division);
    await page.waitFor((type) => {
      const panel = document.querySelector('[data-panel="titles"]');
      return panel?.querySelectorAll('.chart-title-label').length === 8 && panel.getAttribute('aria-label').includes(type === 'ANIME' ? 'episodes' : 'chapters');
    }, { args: [division], timeout: 40000 });
    await page.waitFor(() => !/loading/i.test(document.querySelector('#annWire .ann-status')?.textContent || ''), { timeout: 30000, label: 'ANN settles for screenshot' });
    await page.evaluate(() => document.querySelector('.title-chart-row:last-child')?.scrollIntoView({ block: 'center' }));
    await page.waitFor(() => [...document.querySelectorAll('.title-art img')].every((img) => img.complete), { timeout: 30000, label: 'all title covers settle for screenshot' });
    await page.evaluate(() => document.querySelector('.ann-news-item:last-child')?.scrollIntoView({ block: 'center' }));
    await page.waitFor(() => [...document.querySelectorAll('.ann-art img')].every((img) => img.complete), { timeout: 30000, label: 'all ANN covers settle for screenshot' });
    data[division] = await page.evaluate(() => ({
      summary: [...document.querySelectorAll('.summary-value')].map(el => el.textContent.trim()),
      panels: [...document.querySelectorAll('[data-panel]')].map(el => ({ id: el.dataset.panel, label: el.getAttribute('aria-label'), values: [...el.querySelectorAll('.chart-value-label')].map(t => t.textContent.trim()) })),
      cache: Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('anigraph:v1:cache:')))
    }));
    assert.equal(data[division].summary.length, 4, division + ' has four statistics');
    assert.equal(data[division].panels.length, 7, division + ' has seven chart panels');
    for (const width of [1440, 985, 768, 390]) {
      await page.setViewport({ width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
      await sleep(650);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot(path.join(artifacts, width + '-' + division.toLowerCase() + '-profile.png'));
      await page.screenshot(path.join(artifacts, width + '-' + division.toLowerCase() + '-full.png'), { fullPage: true });
      await page.evaluate(() => document.querySelector('.chart-grid').scrollIntoView({ block: 'start' }));
      await page.screenshot(path.join(artifacts, width + '-' + division.toLowerCase() + '-charts.png'));
      if (width === 390) {
        for (const id of ['genres', 'titles']) {
          const clip = await page.evaluate((panelId) => {
            const r = document.querySelector('[data-panel="' + panelId + '"]').getBoundingClientRect();
            return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 1 };
          }, id);
          const { data } = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip }, page.sessionId);
          await fs.writeFile(path.join(artifacts, width + '-' + division.toLowerCase() + '-' + id + '.png'), Buffer.from(data, 'base64'));
        }
      }
    }
  }
  await fs.writeFile(path.join(artifacts, 'data.json'), JSON.stringify(data, null, 2));
  await fs.writeFile(path.join(artifacts, 'browser.json'), JSON.stringify({ chrome: browser.version, exceptions: page.events.exceptions, consoleErrors: page.events.consoleErrors }, null, 2));
  assert.equal(page.events.exceptions.length, 0, 'capture has no uncaught browser exception');
  console.log('Captured real ' + username + ' ANIME and MANGA at 1440, 985, 768, and 390: ' + artifacts);
} finally { await browser.close(); }
