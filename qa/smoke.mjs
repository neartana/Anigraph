// qa/smoke.mjs - Phase 1 self-check. Proves each harness capability against data:/http/file fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchChrome, serveDir, fileUrl, sleep } from './cdp.mjs';

const here = import.meta.dirname;
const artifacts = path.join(here, 'artifacts');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

let browser = null;
let server = null;
let page = null;

try {
  browser = await launchChrome();
  check('launch chrome via spawn + DevToolsActivePort', /Chrome\//.test(browser.version), browser.version);

  page = await browser.newPage();

  await page.goto('data:text/html,<title>smoke</title><h1 id=x>hello</h1>');
  check('navigate data: URL', (await page.title()) === 'smoke');
  check('evaluate JS in page', (await page.evaluate(() => 2 + 2)) === 4 && (await page.evaluate(() => document.querySelector('#x').textContent)) === 'hello');

  const shot = await page.screenshot(path.join(artifacts, 'smoke-data.png'));
  const png = await fs.readFile(shot);
  check('screenshot PNG', png[0] === 0x89 && png.toString('ascii', 1, 4) === 'PNG', png.length + ' bytes');

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, touch: true });
  check('viewport emulation 390x844', (await page.evaluate(() => innerWidth + 'x' + innerHeight)) === '390x844');
  check('touch emulation', (await page.evaluate(() => navigator.maxTouchPoints)) > 0);
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1, touch: true });

  await page.setReducedMotion(true);
  check('reduced motion: reduce', (await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) === true);
  await page.setReducedMotion(false);
  check('reduced motion: reset', (await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) === false);

  server = await serveDir(path.join(here, 'fixtures'));
  await page.goto(server.url + 'smoke.html');
  check('serve dir (python http.server on free port)', (await page.title()) === 'smoke-fixture', server.url);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true });
  check('mobile emulation 390 (meta viewport)', (await page.evaluate(() => innerWidth)) === 390);
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1, touch: true });

  await page.waitFor(() => window.__fetchStatus !== null, { label: 'fixture fetch' });
  const urls = page.events.requests.map((request) => request.url);
  const fixtureResponse = page.events.responses.find((response) => response.url.includes('fixture.json'));
  check('collect network requests/responses', urls.some((url) => url.includes('fixture.json')) && fixtureResponse?.status === 200, urls.length + ' requests');

  await page.evaluate(() => { console.error('boom-console'); setTimeout(() => { throw new Error('boom-error'); }, 0); });
  await sleep(250);
  check('collect console.error', page.events.consoleErrors.some((entry) => entry.text.includes('boom-console')));
  check('collect uncaught exception', page.events.exceptions.some((entry) => entry.text.includes('boom-error')));

  await page.evaluate(() => { window.__ev.length = 0; });
  await page.touchDrag({ x: 80, y: 80 }, { x: 240, y: 200 }, { steps: 6 });
  await sleep(80);
  let events = await page.evaluate(() => window.__ev);
  let types = events.map((event) => event.t);
  check('dispatch touch drag', ['touchstart', 'touchmove', 'touchend'].every((type) => types.includes(type)), types.join(','));

  await page.evaluate(() => { window.__ev.length = 0; });
  await page.mouseDrag({ x: 100, y: 100 }, { x: 260, y: 160 }, { steps: 6 });
  await sleep(80);
  events = await page.evaluate(() => window.__ev);
  types = events.map((event) => event.t);
  check('dispatch mouse drag', ['pointerdown', 'pointermove', 'pointerup'].every((type) => types.includes(type)), types.join(','));

  await page.evaluate(() => { window.__ev.length = 0; });
  await page.key('ArrowRight');
  await sleep(80);
  events = await page.evaluate(() => window.__ev);
  check('dispatch keyboard', events.some((event) => event.t === 'keydown' && event.key === 'ArrowRight'));

  await page.setLocalStorage({ 'qa:smoke': 'persisted' });
  await page.reload();
  check('localStorage survives reload', (await page.localStorage())['qa:smoke'] === 'persisted');
  await page.clearLocalStorage();
  check('localStorage clear', Object.keys(await page.localStorage()).length === 0);

  await page.route('*fixture.json*', () => null);
  const passthrough = await page.evaluate(async () => (await fetch('/fixture.json')).status);
  check('intercept request (Fetch domain, continue)', passthrough === 200);

  await page.route('*mock-rate-limit*', () => ({ status: 429, headers: { 'content-type': 'application/json', 'retry-after': '7' }, body: JSON.stringify({ errors: [{ status: 429, message: 'Too Many Requests' }] }) }));
  const limited = await page.evaluate(async () => {
    const response = await fetch('/mock-rate-limit/x');
    return { status: response.status, retryAfter: response.headers.get('retry-after') };
  });
  check('fulfill 429 + Retry-After', limited.status === 429 && limited.retryAfter === '7', JSON.stringify(limited));

  await page.route('*mock-private-profile*', () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { User: null }, errors: [{ status: 404, message: 'Not Found' }] }) }));
  const privateReply = await page.evaluate(async () => {
    const response = await fetch('/mock-private-profile/x');
    return { status: response.status, body: await response.text() };
  });
  let privateJson = {};
  try { privateJson = JSON.parse(privateReply.body); } catch {}
  check('fulfill private-profile shape', privateReply.status === 200 && privateJson.errors?.[0]?.message === 'Not Found');

  await page.setOffline(true);
  const offline = await page.evaluate(async () => ({ online: navigator.onLine, failure: await fetch('/fixture.json').then(() => 'ok', (error) => error.name) }));
  check('offline emulation', offline.online === false && offline.failure === 'TypeError', JSON.stringify(offline));
  await page.setOffline(false);
  check('online restored', (await page.evaluate(async () => (await fetch('/fixture.json')).ok)) === true);

  const context = await browser.newContext();
  const fresh = await context.newPage({ url: server.url + 'smoke.html' });
  check('isolated context starts with empty localStorage', Object.keys(await fresh.localStorage()).length === 0);
  await fresh.setLocalStorage({ 'qa:share': 'fresh-only' });
  check('isolated context does not leak localStorage', Object.keys(await page.localStorage()).length === 0);
  await context.close();

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true });
  await page.goto(server.url + 'smoke.html');
  const mobileShot = await page.screenshot(path.join(artifacts, 'smoke-390.png'));
  check('screenshot at 390 viewport', (await fs.stat(mobileShot)).size > 1000);

  await page.goto(fileUrl(path.join(here, 'fixtures', 'smoke.html')));
  check('file:// navigation', (await page.title()) === 'smoke-fixture');
  const fileStore = await page.evaluate(() => {
    try { localStorage.setItem('qa:file', 'value'); const value = localStorage.getItem('qa:file'); localStorage.removeItem('qa:file'); return { ok: value === 'value' }; }
    catch (error) { return { ok: false, error: error.name }; }
  });
  check('file:// localStorage', fileStore.ok === true, JSON.stringify(fileStore));
  await page.screenshot(path.join(artifacts, 'smoke-file.png'));
} catch (error) {
  check('smoke run completed', false, String(error && error.stack ? error.stack : error));
} finally {
  try { if (server) server.close(); } catch {}
  try { if (browser) await browser.close(); } catch {}
  try {
    await fs.mkdir(artifacts, { recursive: true });
    const failed = results.filter((result) => !result.ok).length;
    const payload = { when: new Date().toISOString(), chrome: browser ? browser.version : null, total: results.length, failed, results };
    await fs.writeFile(path.join(artifacts, 'smoke-results.json'), JSON.stringify(payload, null, 2));
    console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed; artifacts in qa/artifacts/');
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error('failed to write results', error);
    process.exitCode = 1;
  }
}
