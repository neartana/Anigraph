// Deployment checks use the real adapter and mocked upstreams, with no live API requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import handler from '../api/app.js';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist');
const request = globalThis.fetch;
const upstream = [];
let passed = 0;
async function test(name, run) {
  await run();
  passed += 1;
  console.log('PASS ' + name);
}

await test('build removes stale output and publishes exactly the three app files', async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'private-source.txt'), 'must not be published');
  const build = spawnSync(process.execPath, ['scripts/build-vercel.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  assert.deepEqual((await fs.readdir(output)).sort(), ['app.js', 'index.html', 'styles.css']);
  for (const file of await fs.readdir(output)) {
    assert.deepEqual(await fs.readFile(path.join(output, file)), await fs.readFile(path.join(root, file)));
  }
});
await test('Vercel uses Node 24, a bounded API function, and an unnamed rewrite capture', async () => {
  const config = JSON.parse(await fs.readFile(path.join(root, 'vercel.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '24.x');
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.functions['api/app.js'].maxDuration, 60);
  assert.deepEqual(config.rewrites, [{ source: '/api/(.*)', destination: '/api/app' }]);
});

globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  upstream.push(url.href);
  assert.equal(options.redirect, 'error');
  if (url.hostname === 'www.animenewsnetwork.com') {
    if (url.pathname === '/news/rss.xml') return new Response('<rss><channel><item><title>Deployment headline</title><link>https://www.animenewsnetwork.com/news/2026-10-20/test</link><pubDate>Tue, 20 Oct 2026 00:00:00 GMT</pubDate><description>News summary.</description></item></channel></rss>');
    assert.equal(url.pathname, '/news/2026-10-20/test');
    return new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } });
  }
  assert.equal(url.hostname, 'myanimelist.net');
  if (url.pathname.startsWith('/profile/')) return new Response('<meta property="og:title" content="Tester Profile - MyAnimeList.net">');
  assert.equal(url.pathname, '/mangalist/Test_User/load.json');
  assert.equal(url.searchParams.get('offset'), '300');
  return Response.json([{ manga_id: 1, manga_title: 'Deployment manga', manga_media_type_string: 'Manga', manga_image_path: 'https://cdn.myanimelist.net/images/manga/1/1.jpg', manga_num_chapters: 20, num_read_chapters: 7, num_read_volumes: 2, score: 8, status: 2 }]);
};
const server = http.createServer(handler);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
try {
  await test('adapter serves the original ANN route through the existing proxy', async () => {
    const response = await request(origin + '/api/ann/news');
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].title, 'Deployment headline');
    assert.equal(upstream[0], 'https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us');
  });
  await test('adapter preserves the MAL profile path and username query', async () => {
    const response = await request(origin + '/api/mal/profile?username=Test_User');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).name, 'Test_User');
    assert(upstream.includes('https://myanimelist.net/profile/Test_User'));
  });
  await test('adapter preserves MAL media type and pagination without added routing query parameters', async () => {
    const response = await request(origin + '/api/mal/list?username=Test_User&type=MANGA&offset=300');
    assert.equal(response.status, 200);
    const entry = (await response.json()).lists[0].entries[0];
    assert.equal(entry.media.title.romaji, 'Deployment manga');
    assert.equal(entry.score, 80);
    assert.equal(entry.progress, 7);
    assert(upstream.includes('https://myanimelist.net/mangalist/Test_User/load.json?status=7&offset=300'));
  });
  const attempts = upstream.length;
  for (const query of ['username=https://evil.test', 'username=Tester&url=https://evil.test', 'username=Tester&type=OTHER', 'username=Tester&offset=2']) {
    await test('adapter retains MAL validation for ' + query, async () => {
      assert.equal((await request(origin + '/api/mal/list?' + query)).status, 400);
    });
  }
  await test('adapter rejects POST requests before contacting upstream', async () => {
    for (const route of ['/api/ann/news', '/api/mal/profile?username=Tester', '/api/mal/list?username=Tester']) {
      const response = await request(origin + route, { method: 'POST', body: 'ignored' });
      assert.equal(response.status, 405);
      assert.match(response.headers.get('allow'), /GET/);
    }
    assert.equal(upstream.length, attempts);
  });
  await test('adapter retains the server allowlist for source, QA, and media paths', async () => {
    for (const route of ['/server.js', '/qa/vercel.mjs', '/media/showcase/render.mjs', '/.env']) {
      assert.equal((await request(origin + route)).status, 404);
    }
  });
} finally {
  globalThis.fetch = request;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log(passed + ' deployment checks passed.');
