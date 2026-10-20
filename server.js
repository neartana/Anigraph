'use strict';

const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const FEED_URL = 'https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us';
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLE_BYTES = 512 * 1024;
const PUBLIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8']
};
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name[0] !== '#') return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : entity;
    const value = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '';
  });
}

function plainText(text) {
  return decodeEntities(decodeEntities(text).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function articleLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.animenewsnetwork.com', 'animenewsnetwork.com'].includes(url.hostname) || url.username || url.password || url.port || !url.pathname.startsWith('/news/')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function articleImageUrl(value) {
  try {
    const url = new URL(decodeEntities(value), FEED_URL);
    if (url.protocol !== 'https:' || !['www.animenewsnetwork.com', 'animenewsnetwork.com'].includes(url.hostname) || url.username || url.password || url.port || /%(?:2[ef]|5c|25)/i.test(url.pathname) || !/^\/(?:thumbnails|cms)\/.+\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseArticleImage(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > MAX_ARTICLE_BYTES) return null;
  // shortcut: publisher metadata only; leave a headline text-only if ANN changes it.
  const head = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').split(/<\/head\s*>/i)[0];
  for (const match of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attributes = Object.create(null);
    for (const attribute of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4];
    if (!['og:image', 'twitter:image'].includes((attributes.property || attributes.name || '').toLowerCase())) continue;
    const image = articleImageUrl(attributes.content || '');
    if (image) return image;
  }
  return null;
}

// shortcut: RSS 2.0 only, extend if ANN changes format; declarations are rejected.
function parseRss(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_FEED_BYTES) throw new Error('Invalid RSS feed');
  const document = { name: '', children: [], text: '' };
  const stack = [document];
  const tokens = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g;
  let cursor = 0;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== cursor) throw new Error('Invalid RSS XML');
    const token = match[0];
    cursor += token.length;
    const current = stack[stack.length - 1];
    if (token.startsWith('<?')) {
      if (!/^<\?xml\s[^?]*\?>$/.test(token) || document.children.length || stack.length !== 1) throw new Error('Invalid RSS XML');
    } else if (token.startsWith('<!--')) {
      if (token.slice(4, -3).includes('--')) throw new Error('Invalid RSS XML');
    } else if (token.startsWith('<![CDATA[')) {
      if (stack.length === 1) throw new Error('Invalid RSS XML');
      current.text += token.slice(9, -3);
    } else if (token.startsWith('</')) {
      if (stack.length === 1 || token !== `</${current.name}>`) throw new Error('Invalid RSS XML');
      stack.pop();
    } else if (token.startsWith('<')) {
      const opening = token.match(/^<([A-Za-z_][\w.:-]*)(?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*(\/?)>$/);
      if (!opening || stack.length > 64) throw new Error('Invalid RSS XML');
      const node = { name: opening[1], children: [], text: '' };
      current.children.push(node);
      if (!opening[2]) stack.push(node);
    } else {
      if (token.includes(']]>') || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(token) || (stack.length === 1 && token.trim())) throw new Error('Invalid RSS XML');
      current.text += decodeEntities(token);
    }
  }
  if (cursor !== xml.length || stack.length !== 1 || document.children.length !== 1 || document.children[0].name !== 'rss') throw new Error('Invalid RSS feed');
  const channels = document.children[0].children.filter(node => node.name === 'channel');
  if (channels.length !== 1) throw new Error('Invalid RSS feed');
  const items = channels[0].children.filter(node => node.name === 'item');
  return items.map(item => {
    const value = name => item.children.find(node => node.name === name)?.text.trim() ?? '';
    const title = plainText(value('title'));
    const link = articleLink(value('link'));
    const timestamp = Date.parse(value('pubDate'));
    if (!title || !link || !Number.isFinite(timestamp)) return null;
    const excerpt = plainText(value('description'));
    return { title, link, publishedAt: new Date(timestamp).toISOString(), summary: excerpt.length <= 200 ? excerpt : `${excerpt.slice(0, 199).trimEnd()}…`, source: 'Anime News Network' };
  }).filter(Boolean).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 5);
}

function retrySeconds(value) {
  if (value && /^\d+(?:\.\d+)?$/.test(value)) return Math.max(1, Math.ceil(Number(value)));
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(1, Math.ceil((at - Date.now()) / 1000)) : 60;
}

async function readUpstreamText(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Upstream body too large');
  }
  if (!response.body) throw new Error('Upstream body is empty');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Upstream body too large');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
}

function normalizeMalEntry(row, type) {
  const prefix = type === 'MANGA' ? 'manga' : 'anime';
  const id = Number(row && row[prefix + '_id']);
  if (!row || !Number.isSafeInteger(id) || id < 1 || typeof row[prefix + '_title'] !== 'string') throw new Error('Invalid list entry');
  const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const year = value => {
    const match = typeof value === 'string' && value.match(/^\d{2}-\d{2}-(\d{2}|\d{4})$/);
    if (!match) return null;
    if (Number(value.slice(0, 2)) < 1 || Number(value.slice(0, 2)) > 12 || Number(value.slice(3, 5)) < 1 || Number(value.slice(3, 5)) > 31) return null;
    const n = Number(match[1]);
    return match[1].length === 4 ? n : n <= new Date().getFullYear() % 100 + 10 ? 2000 + n : 1900 + n;
  };
  const format = String(row[prefix + '_media_type_string'] || '').toUpperCase().replace(/[ -]+/g, '_');
  const score = number(row.score);
  return {
    progress: number(row[type === 'MANGA' ? 'num_read_chapters' : 'num_watched_episodes']),
    volumesRead: type === 'MANGA' ? number(row.num_read_volumes) : null,
    startYear: year(row.start_date_string),
    status: Number(row[type === 'MANGA' ? 'is_rereading' : 'is_rewatching']) === 1 ? 'REPEATING' : ({ 1: 'CURRENT', 2: 'COMPLETED', 3: 'PAUSED', 4: 'DROPPED', 6: 'PLANNING' }[row.status] || 'UNKNOWN'),
    score: score > 0 && score <= 10 ? score * 10 : null,
    media: { id, source: 'mal', title: { romaji: row[prefix + '_title'].slice(0, 500), english: String(row.anime_title_eng || row.manga_english || '').slice(0, 500) },
      coverImage: { large: row[prefix + '_image_path'] }, format: ({ LIGHT_NOVEL: 'NOVEL', ONE_SHOT: 'ONE_SHOT', TV_SPECIAL: 'SPECIAL' })[format] || format,
      episodes: number(row.anime_num_episodes), chapters: number(row.manga_num_chapters),
      genres: Array.isArray(row.genres) ? row.genres.filter(g => g && typeof g.name === 'string').map(g => g.name.slice(0, 80)).slice(0, 40) : [],
      startDate: { year: year(row[prefix + '_start_date_string']) }
    }
  };
}

function createAppServer() {
  let cache = null;
  let pending = null;
  let nextAllowedAt = 0;
  let lastUpstreamAt = -Infinity;
  const malCache = new Map();
  const malPending = new Map();
  let malQueue = Promise.resolve();
  let malNextAt = 0;

  async function getMal(kind, username, type, offset) {
    const key = JSON.stringify([kind, username.toLowerCase(), type, offset]);
    const cached = malCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.result;
    if (malPending.has(key)) return malPending.get(key);
    if (malPending.size >= 8 || malNextAt > Date.now() + 15000) return { status: 429, data: { error: 'MyAnimeList is busy. Retry shortly.', retryAfter: 15 } };
    const pending = malQueue.then(async () => {
      const wait = malNextAt - Date.now();
      if (wait > 15000) return { status: 429, data: { error: 'MyAnimeList rate limited. Retry after the countdown.', retryAfter: Math.ceil(wait / 1000) } };
      if (wait > 0) await delay(wait);
      malNextAt = Date.now() + 1000;
      const url = kind === 'profile' ? 'https://myanimelist.net/profile/' + encodeURIComponent(username)
        : 'https://myanimelist.net/' + type.toLowerCase() + 'list/' + encodeURIComponent(username) + '/load.json?status=7&offset=' + offset;
      try {
        const upstream = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: kind === 'profile' ? 'text/html' : 'application/json', 'User-Agent': 'Anigraph/1.0 (public list reader)' } });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          if (upstream.status === 429) {
            const retryAfter = retrySeconds(upstream.headers.get('retry-after'));
            malNextAt = Math.max(malNextAt, Date.now() + retryAfter * 1000);
            return { status: 429, data: { error: 'MyAnimeList rate limited. Retry after the countdown.', retryAfter } };
          }
          const status = [400, 404].includes(upstream.status) ? 404 : upstream.status === 403 ? 403 : 502;
          return { status, data: { error: status === 404 ? 'No public MyAnimeList profile found.' : 'MyAnimeList could not provide this public list. It may be private or temporarily unavailable.' } };
        }
        const text = await readUpstreamText(upstream, 3 * 1024 * 1024);
        let data;
        if (kind === 'profile') {
          const title = text.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"\n]+)["']/i);
          if (!title || !/Profile - MyAnimeList\.net/i.test(decodeEntities(title[1]))) throw new Error('Unreadable profile');
          const avatar = text.match(/<img\s+[^>]*(?:data-src|src)=["'](https:\/\/cdn\.myanimelist\.net\/[^"']*userimages[^"']*)["']/i);
          const days = text.match(/Anime Stats[\s\S]{0,600}?Days:\s*<\/span>\s*([\d,.]+)/i);
          data = { name: username, avatar: avatar ? decodeEntities(avatar[1]) : null, minutesWatched: days ? Number(days[1].replaceAll(',', '')) * 1440 : null };
        } else {
          const rows = JSON.parse(text);
          if (!Array.isArray(rows) || rows.length > 300) throw new Error('Unreadable list');
          data = { lists: [{ entries: rows.map(row => normalizeMalEntry(row, type)) }], hasNextChunk: rows.length === 300 };
        }
        const result = { status: 200, data };
        malCache.delete(key);
        malCache.set(key, { at: Date.now(), result });
        if (malCache.size > 64) malCache.delete(malCache.keys().next().value);
        return result;
      } catch {
        return { status: 502, data: { error: 'MyAnimeList is unavailable or returned an unreadable response. Retry shortly.' } };
      }
    });
    malQueue = pending.then(() => {}, () => {});
    malPending.set(key, pending);
    try { return await pending; } finally { malPending.delete(key); }
  }

  async function fetchAnn(url, accept, signal) {
    const wait = 1000 - (performance.now() - lastUpstreamAt);
    if (wait > 0) await delay(Math.ceil(wait), undefined, { signal });
    signal.throwIfAborted();
    lastUpstreamAt = performance.now();
    nextAllowedAt = Math.max(nextAllowedAt, Date.now() + 1000);
    return fetch(url, {
      headers: { 'User-Agent': 'Anigraph/1.0 (local read-only RSS headline reader)', Accept: accept },
      redirect: 'error', signal
    });
  }

  async function addNewsImages(items) {
    const deadline = AbortSignal.timeout(8000);
    for (const item of items) {
      if (deadline.aborted) break;
      try {
        const response = await fetchAnn(item.link, 'text/html', AbortSignal.any([deadline, AbortSignal.timeout(2000)]));
        if (!response.ok || !/^text\/html(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')) {
          await response.body?.cancel();
          if (response.status === 429) {
            nextAllowedAt = Math.max(nextAllowedAt, Date.now() + retrySeconds(response.headers.get('retry-after')) * 1000);
            break;
          }
          continue;
        }
        const image = parseArticleImage(await readUpstreamText(response, MAX_ARTICLE_BYTES));
        if (image) item.imageUrl = image;
      } catch {
        // Article metadata is optional; a missing image must not hide the news.
      }
    }
    return items;
  }

  async function getNews() {
    if (cache && Date.now() - cache.at < 10 * 60 * 1000) return { status: 200, data: cache.data };
    if (pending) return pending;
    if (Date.now() < nextAllowedAt) return { status: 429, data: { error: 'Anime News Network is rate limited. Try again after the countdown.', retryAfter: Math.ceil((nextAllowedAt - Date.now()) / 1000) } };
    nextAllowedAt = Date.now() + 1000;
    pending = (async () => {
      try {
        const response = await fetchAnn(FEED_URL, 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', AbortSignal.timeout(10000));
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429) {
            const retryAfter = retrySeconds(response.headers.get('retry-after'));
            nextAllowedAt = Math.max(nextAllowedAt, Date.now() + retryAfter * 1000);
            return { status: 429, data: { error: 'Anime News Network is rate limited. Try again after the countdown.', retryAfter } };
          }
          throw new Error('Upstream unavailable');
        }
        const data = await addNewsImages(parseRss(await readUpstreamText(response, MAX_FEED_BYTES)));
        cache = { at: Date.now(), data };
        return { status: 200, data };
      } catch {
        return { status: 502, data: { error: 'Anime News Network is unavailable. Open ANN directly or retry shortly.' } };
      }
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    let pathname;
    try {
      if (!request.url.startsWith('/')) throw new Error('Invalid request target');
      pathname = decodeURIComponent(request.url.split('?')[0]);
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }
    if (pathname === '/api/ann/news') {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET' });
        response.end();
        return;
      }
      const { status, data } = await getNews();
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': String(data.retryAfter) } : {}) });
      response.end(JSON.stringify(data));
      return;
    }
    if (pathname === '/api/mal/profile' || pathname === '/api/mal/list') {
      const params = new URL(request.url, 'http://localhost').searchParams;
      const username = params.get('username') || '';
      const type = params.get('type') || 'ANIME';
      const offset = params.get('offset') || '0';
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
      if (!/^[A-Za-z0-9_-]{2,16}$/.test(username) || !['ANIME', 'MANGA'].includes(type) || !/^\d{1,5}$/.test(offset) || Number(offset) > 30000 || Number(offset) % 300 !== 0 || [...params.keys()].some(key => !['username', 'type', 'offset'].includes(key))) {
        response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Enter a valid MyAnimeList username.' })); return;
      }
      const { status, data } = await getMal(pathname.endsWith('profile') ? 'profile' : 'list', username, type, Number(offset));
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': String(data.retryAfter) } : {}) });
      response.end(JSON.stringify(data)); return;
    }
    const file = Object.hasOwn(PUBLIC_FILES, pathname) && PUBLIC_FILES[pathname];
    if (!file) {
      response.writeHead(404);
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    try {
      const data = await readFile(path.join(__dirname, file[0]));
      response.writeHead(200, { 'Content-Type': file[1], 'Content-Length': data.length });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch {
      response.writeHead(500);
      response.end(request.method === 'HEAD' ? undefined : 'Unable to read app file');
    }
  });
}

module.exports = { createAppServer, parseRss, parseArticleImage, normalizeMalEntry };

if (require.main === module) {
  const port = process.env.PORT === undefined ? 5173 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be a number from 1 to 65535.');
    process.exitCode = 1;
  } else {
    const server = createAppServer();
    server.on('error', error => {
      console.error(`Cannot start Anigraph on 127.0.0.1:${port}: ${error.code ?? 'server error'}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Anigraph: http://127.0.0.1:${port}`));
  }
}
