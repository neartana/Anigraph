// Dependency-free assertions for the local ANN proxy; no live upstream requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAppServer, parseRss } from '../server.js';

const artifacts = path.join(import.meta.dirname, 'artifacts', 'acceptance-9');
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const results = [];
let upstream = async () => new Response(feed());
let attempts = [];
globalThis.fetch = async (url, options) => {
  if (!/animenewsnetwork\.com/.test(String(url))) return originalFetch(url, options);
  attempts.push({ url: String(url), options, at: Date.now() });
  return upstream(url, options);
};

function xml (value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function feed (items = Array.from({ length: 7 }, (_, index) => ({ title: 'Headline ' + index, link: 'https://www.animenewsnetwork.com/news/2026-10-19/item-' + index, publishedAt: new Date(Date.UTC(2026, 9, 19, 12 - index)).toUTCString(), summary: '<p>Short <b>excerpt</b> &amp; facts.</p>' }))) {
  return '<?xml version="1.0"?><rss version="2.0"><channel><title>Anime News Network</title>' + items.map((item) => '<item><title>' + xml(item.title) + '</title><link>' + xml(item.link) + '</link><pubDate>' + xml(item.publishedAt) + '</pubDate><description><![CDATA[' + item.summary + ']]></description></item>').join('') + '</channel></rss>';
}
async function test (name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack || String(error) }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function withServer (fn) {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await fn('http://127.0.0.1:' + server.address().port); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
async function until (fn) {
  for (let index = 0; index < 200; index += 1) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('timed out waiting for upstream request');
}

try {
  await test('RSS returns five newest headlines with ISO dates and source attribution', () => {
    const items = parseRss(feed());
    assert.equal(items.length, 5);
    assert.deepEqual(items.map((item) => item.title), ['Headline 0', 'Headline 1', 'Headline 2', 'Headline 3', 'Headline 4']);
    assert(items.every((item) => item.source === 'Anime News Network' && Number.isFinite(Date.parse(item.publishedAt)) && item.publishedAt.endsWith('Z')));
  });
  await test('RSS entities and markup become bounded plain excerpts', () => {
    const items = parseRss(feed([{ title: 'Title & more', link: 'https://www.animenewsnetwork.com/news/a', publishedAt: 'Mon, 19 Oct 2026 12:00:00 GMT', summary: '<p>Short <b>excerpt</b> &amp; facts. ' + 'Long '.repeat(100) + '</p>' }]));
    assert.equal(items[0].title, 'Title & more');
    assert.match(items[0].summary, /^Short excerpt & facts\./);
    assert(items[0].summary.length <= 200 && !/[<>]/.test(items[0].summary));
  });
  await test('RSS rejects non-HTTPS, foreign-host and credentialed article links', () => {
    const links = ['javascript:alert(1)', 'http://www.animenewsnetwork.com/news/a', 'https://example.com/news/a', 'https://www.animenewsnetwork.com.evil.test/news/a', 'https://user:pass@www.animenewsnetwork.com/news/a'];
    const items = parseRss(feed(links.map((link) => ({ title: 'Unsafe', link, publishedAt: 'Mon, 19 Oct 2026 12:00:00 GMT', summary: 'Excerpt' }))));
    assert.deepEqual(items, []);
  });
  await test('empty valid RSS returns an empty list', () => { assert.deepEqual(parseRss(feed([])), []); });
  await test('malformed XML and external entities are rejected', () => {
    assert.throws(() => parseRss('<rss><channel><item></channel></rss>'));
    assert.throws(() => parseRss('<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///private">]><rss><channel>&secret;</channel></rss>'));
  });
  await test('only the four public app files are served; HEAD omits the body', async () => withServer(async (origin) => {
    for (const file of ['/', '/index.html', '/styles.css', '/app.js']) {
      const response = await originalFetch(origin + file);
      assert.equal(response.status, 200, file);
      assert((await response.text()).length > 100, file);
    }
    const head = await originalFetch(origin + '/index.html', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.match(head.headers.get('content-type'), /html/);
  }));
  await test('static allowlist blocks source, QA, dotfiles, and traversal variants', async () => withServer(async (origin) => {
    for (const file of ['/server.js', '/NEXT_AGENT.md', '/ANIGRAPH.md', '/qa/acceptance.mjs', '/.env', '/%2e%2e/server.js', '/..%2fserver.js', '/%252e%252e%252fserver.js', '/app.js/extra', '/unknown']) {
      const response = await originalFetch(origin + file);
      assert.equal(response.status, 404, file);
      assert(!/API_URL|createAppServer|NEXT_AGENT/.test(await response.text()), file);
    }
  }));
  await test('unsupported methods return 405 with an Allow header', async () => withServer(async (origin) => {
    for (const file of ['/', '/api/ann/news']) {
      const response = await originalFetch(origin + file, { method: 'POST', body: 'ignored' });
      assert.equal(response.status, 405);
      assert.match(response.headers.get('allow') || '', /GET/);
    }
  }));
  await test('proxy fetches the fixed RSS and only its five validated articles with no redirects', async () => withServer(async (origin) => {
    attempts = [];
    upstream = async () => new Response(feed(), { headers: { 'content-type': 'application/rss+xml' } });
    const response = await originalFetch(origin + '/api/ann/news?url=https://evil.test/');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 5);
    assert.equal(attempts.length, 6);
    assert(attempts.slice(1).every((attempt, index) => attempt.url === 'https://www.animenewsnetwork.com/news/2026-10-19/item-' + index));
    assert.equal(attempts[0].url, 'https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us');
    assert.match(new Headers(attempts[0].options.headers).get('user-agent') || '', /Anigraph/i);
    assert(attempts.every((attempt) => attempt.options.redirect === 'error' && attempt.options.signal instanceof AbortSignal));
  }));
  await test('simultaneous requests coalesce, success caches ten minutes, expiry refetches', async () => withServer(async (origin) => {
    let now = originalNow();
    Date.now = () => now;
    attempts = [];
    let release;
    upstream = (url) => String(url).includes('/rss.xml') ? new Promise((resolve) => { release = () => resolve(new Response(feed())); }) : Promise.resolve(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    const first = originalFetch(origin + '/api/ann/news');
    const second = originalFetch(origin + '/api/ann/news');
    await until(() => attempts.length === 1 && release);
    release();
    const responses = await Promise.all([first, second]);
    assert(responses.every((response) => response.status === 200));
    await Promise.all(responses.map((response) => response.json()));
    assert.equal(attempts.length, 6);
    now += 10 * 60 * 1000 - 1;
    assert.equal((await originalFetch(origin + '/api/ann/news')).status, 200);
    assert.equal(attempts.length, 6);
    upstream = async () => new Response(feed());
    now += 2;
    assert.equal((await originalFetch(origin + '/api/ann/news')).status, 200);
    assert.equal(attempts.length, 12);
    Date.now = originalNow;
  }));
  await test('upstream 429 preserves Retry-After and suppresses requests during cooldown', async () => withServer(async (origin) => {
    let now = originalNow();
    Date.now = () => now;
    attempts = [];
    upstream = async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '3' } });
    const first = await originalFetch(origin + '/api/ann/news');
    assert.equal(first.status, 429);
    assert.equal(first.headers.get('retry-after'), '3');
    assert.equal((await first.json()).retryAfter, 3);
    const second = await originalFetch(origin + '/api/ann/news');
    assert.equal(second.status, 429);
    assert.equal(attempts.length, 1);
    now += 3001;
    upstream = async () => new Response(feed());
    assert.equal((await originalFetch(origin + '/api/ann/news')).status, 200);
    assert.equal(attempts.length, 7);
    Date.now = originalNow;
  }));
  await test('failed fetches are bounded errors and remain limited to one attempt per second', async () => withServer(async (origin) => {
    let now = originalNow();
    Date.now = () => now;
    attempts = [];
    upstream = async () => { throw new TypeError('sensitive upstream diagnostic'); };
    const first = await originalFetch(origin + '/api/ann/news');
    assert.equal(first.status, 502);
    assert(!(await first.text()).includes('sensitive upstream diagnostic'));
    assert.equal((await originalFetch(origin + '/api/ann/news')).status, 429);
    assert.equal(attempts.length, 1);
    now += 1001;
    assert.equal((await originalFetch(origin + '/api/ann/news')).status, 502);
    assert.equal(attempts.length, 2);
    Date.now = originalNow;
  }));
  await test('oversized upstream bodies are rejected instead of mirrored', async () => withServer(async (origin) => {
    upstream = async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/rss+xml' } });
    const response = await originalFetch(origin + '/api/ann/news');
    assert.equal(response.status, 502);
    assert((await response.text()).length < 500);
  }));
  await test('malformed upstream XML reports unavailable JSON', async () => withServer(async (origin) => {
    upstream = async () => new Response('<html>Unavailable</html>', { headers: { 'content-type': 'text/html' } });
    const response = await originalFetch(origin + '/api/ann/news');
    assert.equal(response.status, 502);
    assert.equal(typeof (await response.json()).error, 'string');
  }));
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  await fs.mkdir(artifacts, { recursive: true });
  const failed = results.filter((result) => !result.ok).length;
  await fs.writeFile(path.join(artifacts, 'server-results.json'), JSON.stringify({ when: new Date().toISOString(), total: results.length, failed, results }, null, 2));
  console.log('\n' + (results.length - failed) + '/' + results.length + ' server checks passed.');
  if (failed) process.exitCode = 1;
}
