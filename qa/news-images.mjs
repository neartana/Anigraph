// Targeted ANN image checks, with no live upstream requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAppServer, parseArticleImage } from '../server.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const results = [];
const image = 'https://www.animenewsnetwork.com/thumbnails/crop600x315/cms/news.10/242983/air.jpg';
const metadata = '<html><head><meta property="og:image" content="' + image + '"></head></html>';
let attempts = [];
let upstream;
globalThis.fetch = async (url, options) => {
  if (!['www.animenewsnetwork.com', 'animenewsnetwork.com'].includes(new URL(url).hostname)) return originalFetch(url, options);
  attempts.push({ url: String(url), options, at: performance.now() });
  return upstream(url, options);
};

function feed(count = 5) {
  return '<rss><channel>' + Array.from({ length: count }, (_, index) => '<item><title>Headline ' + index + '</title><link>https://www.animenewsnetwork.com/news/2026-10-19/item-' + index + '</link><pubDate>Mon, 19 Oct 2026 ' + (12 - index) + ':00:00 GMT</pubDate><description>News summary</description></item>').join('') + '</channel></rss>';
}
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.stack || String(error) }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function withServer(fn) {
  attempts = [];
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn('http://127.0.0.1:' + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

try {
  await test('publisher metadata supports attribute order, entities and relative raster URLs', () => {
    assert.equal(parseArticleImage(metadata), image);
    assert.equal(parseArticleImage('<head><META content="/cms/news/a.webp?x=1&amp;y=2" PROPERTY="og:image"></head>'), 'https://www.animenewsnetwork.com/cms/news/a.webp?x=1&y=2');
    assert.equal(parseArticleImage("<head><meta content='/cms/news/a.png' name='twitter:image'></head>"), 'https://www.animenewsnetwork.com/cms/news/a.png');
    assert.equal(parseArticleImage('<head><meta property=og:image content=/cms/news/a.gif></head>'), 'https://www.animenewsnetwork.com/cms/news/a.gif');
  });
  await test('metadata rejects unsafe hosts, credentials, schemes, paths and encoded traversal', () => {
    const unsafe = ['http://www.animenewsnetwork.com/cms/a.jpg', 'https://evil.test/cms/a.jpg', 'https://www.animenewsnetwork.com.evil.test/cms/a.jpg', 'https://user:secret@www.animenewsnetwork.com/cms/a.jpg', 'https://www.animenewsnetwork.com:444/cms/a.jpg', 'javascript:alert(1)', 'data:image/png,abc', '/private/a.jpg', '/cms/a.svg', '/thumbnails/%2e%2e/private/a.jpg', '/thumbnails%2fcms/a.jpg', '/thumbnails/a%2f..%2fprivate.jpg', '/thumbnails/%252e%252e/private.jpg'];
    for (const value of unsafe) assert.equal(parseArticleImage('<head><meta property="og:image" content="' + value + '"></head>'), null, value);
  });
  await test('missing, oversized, commented and body-only metadata stays text-only', () => {
    assert.equal(parseArticleImage('<html><head></head><body>' + metadata + '</body></html>'), null);
    assert.equal(parseArticleImage('<head><!-- ' + metadata + ' --></head>'), null);
    assert.equal(parseArticleImage('<head><script>"' + metadata + '"</script></head>'), null);
    assert.equal(parseArticleImage('x'.repeat(512 * 1024 + 1) + metadata), null);
    assert.equal(parseArticleImage(null), null);
  });
  await test('news enriches five fixed feed URLs, coalesces, caches images and respects the upstream ceiling', async () => withServer(async origin => {
    upstream = async url => String(url).includes('/news/rss.xml') ? new Response(feed()) : new Response(metadata, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const responses = await Promise.all([originalFetch(origin + '/api/ann/news?url=https://evil.test/'), originalFetch(origin + '/api/ann/news')]);
    const lists = await Promise.all(responses.map(response => response.json()));
    assert.deepEqual(lists[0], lists[1]);
    assert.equal(lists[0].length, 5);
    assert(lists[0].every(item => item.imageUrl === image && item.summary === 'News summary'));
    assert.equal(attempts.length, 6);
    assert(attempts[0].url.startsWith('https://www.animenewsnetwork.com/news/rss.xml?'));
    for (let index = 1; index < attempts.length; index += 1) {
      assert.equal(attempts[index].url, 'https://www.animenewsnetwork.com/news/2026-10-19/item-' + (index - 1));
      assert(attempts[index].at - attempts[index - 1].at >= 980, 'upstream starts must remain at most one per second');
    }
    assert(attempts.every(attempt => attempt.options.redirect === 'error' && attempt.options.signal instanceof AbortSignal));
    assert.deepEqual(await (await originalFetch(origin + '/api/ann/news')).json(), lists[0]);
    assert.equal(attempts.length, 6);
  }));
  await test('wrong types, oversized bodies and timeouts omit only the unavailable article image', async () => withServer(async origin => {
    upstream = async (url, options) => {
      if (String(url).includes('/news/rss.xml')) return new Response(feed());
      if (String(url).endsWith('item-0')) return new Response(metadata, { headers: { 'content-type': 'text/html' } });
      if (String(url).endsWith('item-1')) return new Response(metadata, { headers: { 'content-type': 'application/json' } });
      if (String(url).endsWith('item-2')) return new Response(metadata, { headers: { 'content-type': 'text/html', 'content-length': String(512 * 1024 + 1) } });
      if (String(url).endsWith('item-3')) return new Response('x'.repeat(512 * 1024 + 1), { headers: { 'content-type': 'text/html' } });
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    };
    const started = performance.now();
    const response = await originalFetch(origin + '/api/ann/news');
    assert.equal(response.status, 200);
    const items = await response.json();
    assert.equal(items.length, 5);
    assert.equal(items[0].imageUrl, image);
    assert(items.slice(1).every(item => !Object.hasOwn(item, 'imageUrl') && item.title));
    assert(performance.now() - started < 10000, 'enrichment must stay within its shared deadline');
  }));
  await test('article 429 stops enrichment and preserves Retry-After without dropping headlines', async () => withServer(async origin => {
    let now = originalNow();
    Date.now = () => now;
    upstream = async url => String(url).includes('/news/rss.xml') ? new Response(feed()) : new Response('limited', { status: 429, headers: { 'retry-after': '3600' } });
    const response = await originalFetch(origin + '/api/ann/news');
    assert.equal(response.status, 200);
    const items = await response.json();
    assert.equal(items.length, 5);
    assert(items.every(item => !Object.hasOwn(item, 'imageUrl')));
    assert.equal(attempts.length, 2);
    now += 10 * 60 * 1000 + 1;
    const blocked = await originalFetch(origin + '/api/ann/news');
    assert.equal(blocked.status, 429);
    assert(Number(blocked.headers.get('retry-after')) >= 2999);
    assert.equal(attempts.length, 2);
    Date.now = originalNow;
  }));
  await test('repeated slow pages stop at the shared eight-second enrichment deadline', async () => withServer(async origin => {
    upstream = async (url, options) => {
      if (String(url).includes('/news/rss.xml')) return new Response(feed());
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    };
    const started = performance.now();
    const response = await originalFetch(origin + '/api/ann/news');
    const elapsed = performance.now() - started;
    assert.equal(response.status, 200);
    const items = await response.json();
    assert.equal(items.length, 5);
    assert(items.every(item => !Object.hasOwn(item, 'imageUrl')));
    assert(elapsed >= 7500 && elapsed < 10000, 'optional metadata must stop at the shared deadline');
    assert(attempts.length < 6, 'remaining articles must not be fetched after the deadline');
  }));
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  const artifacts = path.join(import.meta.dirname, 'artifacts', 'acceptance-9');
  await fs.mkdir(artifacts, { recursive: true });
  const failed = results.filter(result => !result.ok).length;
  await fs.writeFile(path.join(artifacts, 'news-image-results.json'), JSON.stringify({ when: new Date().toISOString(), total: results.length, failed, results }, null, 2));
  console.log('\n' + (results.length - failed) + '/' + results.length + ' news image checks passed.');
  if (failed) process.exitCode = 1;
}
