(function () {
  'use strict';

  /* ── constants ─────────────────────────────────────────────── */

  var API_URL = 'https://graphql.anilist.co';
  var CACHE_PREFIX = 'anigraph:v1:cache:';
  var CACHE_TTL = 5 * 60 * 1000;
  var BOARDS_KEY = 'anigraph:v1:boards';
  var UI_KEY = 'anigraph:v1:ui';
  var COLLECTIONS_KEY = 'anigraph:v1:collections';
  var LIBRARY_MODES = ['browse', 'pick', 'discover', 'seasons', 'collections'];
  var LIBRARY_LABELS = { browse: 'My Library', pick: 'Pick for Me', discover: 'Discover for Me', seasons: 'Seasonal Explorer', collections: 'My Collections' };
  var PAGE_SIZE = 25;
  var MAX_PAGES = 5;
  var MAX_CHARS = 100;

  var TIER_KEYS = ['S', 'A', 'B', 'C', 'D'];
  var ALL_ROWS = ['S', 'A', 'B', 'C', 'D', 'pool'];

  var STATUS_COLORS = {
    COMPLETED: 'var(--teal)',
    CURRENT: 'var(--accent)',
    PLANNING: 'var(--violet)',
    PAUSED: 'var(--amber)',
    DROPPED: 'var(--muted)',
    REPEATING: 'var(--paper)'
  };

  var FORMAT_LABELS = {
    TV: 'TV',
    TV_SHORT: 'TV SHORT',
    MOVIE: 'FILM',
    SPECIAL: 'SPECIAL',
    OVA: 'OVA',
    ONA: 'ONA',
    MUSIC: 'MUSIC',
    MANGA: 'MANGA',
    NOVEL: 'NOVEL',
    ONE_SHOT: 'ONE SHOT'
  };

  var USER_STATS_QUERY = 'query UserStats($name: String) {\n' +
    '  User(name: $name) {\n' +
    '    id\n' +
    '    name\n' +
    '    avatar { medium }\n' +
    '    bannerImage\n' +
    '    statistics {\n' +
    '      anime {\n' +
    '        count meanScore minutesWatched episodesWatched\n' +
    '        scores { score count }\n' +
    '        statuses { status count }\n' +
    '        formats { format count }\n' +
    '        genres { genre count meanScore }\n' +
    '        releaseYears { releaseYear count }\n' +
    '        startYears { startYear count }\n' +
    '      }\n' +
    '      manga {\n' +
    '        count meanScore chaptersRead volumesRead\n' +
    '        scores { score count }\n' +
    '        statuses { status count }\n' +
    '        formats { format count }\n' +
    '        genres { genre count meanScore }\n' +
    '        releaseYears { releaseYear count }\n' +
    '        startYears { startYear count }\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '}';

  var USER_TITLES_QUERY = 'query UserTitles($name: String, $type: MediaType, $chunk: Int!) {\n' +
    '  MediaListCollection(userName: $name, type: $type, chunk: $chunk, perChunk: 500) {\n' +
    '    hasNextChunk\n' +
    '    lists {\n' +
    '      entries {\n' +
    '        progress\n' +
    '        status\n' +
    '        score(format: POINT_100)\n' +
    '        media {\n' +
    '          id\n' +
    '          title { romaji english native }\n' +
    '          coverImage { large }\n' +
    '          format\n' +
    '          episodes\n' +
    '          duration\n' +
    '          chapters\n' +
    '          genres\n' +
    '          startDate { year }\n' +
    '        }\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '}';

  var SEARCH_MEDIA_QUERY = 'query SearchMedia($q: String, $type: MediaType) {\n' +
    '  Page(page: 1, perPage: 12) {\n' +
    '    media(search: $q, type: $type, sort: SEARCH_MATCH) {\n' +
    '      id type\n' +
    '      title { romaji english native }\n' +
    '      coverImage { large }\n' +
    '      format episodes chapters averageScore\n' +
    '      startDate { year }\n' +
    '    }\n' +
    '  }\n' +
    '}';

  var MEDIA_CHARACTERS_QUERY = 'query MediaCharacters($id: Int, $page: Int) {\n' +
    '  Media(id: $id) {\n' +
    '    id\n' +
    '    title { romaji english native }\n' +
    '    coverImage { large }\n' +
    '    averageScore\n' +
    '    characters(page: $page, perPage: 25, sort: [ROLE, RELEVANCE, ID]) {\n' +
    '      pageInfo { currentPage hasNextPage }\n' +
    '      edges {\n' +
    '        role\n' +
    '        node {\n' +
    '          id\n' +
    '          name { full native }\n' +
    '          image { large medium }\n' +
    '          favourites\n' +
    '        }\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '}';

  var AIRING_RADAR_QUERY = 'query AiringRadar($page: Int!, $start: Int!, $end: Int!) {\n' +
    '  Page(page: $page, perPage: 50) {\n' +
    '    pageInfo { hasNextPage }\n' +
    '    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: [TIME, ID]) {\n' +
    '      id episode airingAt\n' +
    '      media { id idMal title { romaji english native } format coverImage { large } }\n' +
    '    }\n' +
    '  }\n' +
    '}';

  /* ── state + dom ───────────────────────────────────────────── */

  var CATALOG_FIELDS = 'id idMal type isAdult title { romaji english native } coverImage { large } format genres averageScore startDate { year }';
  function catalogQuery (variables) {
    var definitions = ['$page: Int!', '$type: MediaType!', '$sort: [MediaSort]'];
    var filters = ['type: $type', 'sort: $sort', 'isAdult: false'];
    // AniList rejects some explicitly null filters; leave unused arguments out.
    [['season', 'MediaSeason', 'season'], ['year', 'Int', 'seasonYear'], ['genre', '[String]', 'genre_in'], ['format', 'MediaFormat', 'format'], ['score', 'Int', 'averageScore_greater'], ['exclude', '[Int]', 'id_not_in']].forEach(function (field) {
      if (variables[field[0]] !== null && variables[field[0]] !== undefined) { definitions.push('$' + field[0] + ': ' + field[1]); filters.push(field[2] + ': $' + field[0]); }
    });
    return 'query SeasonalCatalog(' + definitions.join(', ') + ') { GenreCollection Page(page: $page, perPage: 24) { pageInfo { hasNextPage } media(' + filters.join(', ') + ') { ' + CATALOG_FIELDS + ' } } }';
  }
  var DISCOVER_QUERY = 'query DiscoverRecommendations($ids: [Int], $type: MediaType!) { Page(page: 1, perPage: 3) { media(id_in: $ids, type: $type) { id idMal recommendations(perPage: 15, sort: RATING_DESC) { nodes { rating mediaRecommendation { ' + CATALOG_FIELDS + ' } } } } } }';

  var state = {
    view: 'stats',
    type: 'ANIME',
    username: '',
    source: 'anilist',
    statsStatus: 'idle',
    stats: null,
    statsError: null,
    statsLoadedAt: 0,
    statsSeq: 0,
    genre: null,
    library: freshLibrary(),
    discover: { status: 'idle', rows: [], seq: 0, error: null, retryAt: 0, summary: '' },
    catalog: freshCatalog(),
    collections: [],
    news: { status: 'idle', items: [], error: null, loadedAt: 0 },
    radar: { status: 'idle', weekStart: null, day: null, scope: 'ALL', listStatus: 'ALL', entries: [], capped: false, error: null, retryAt: 0, seq: 0 },
    titles: {
      ANIME: freshTitlesBucket(),
      MANGA: freshTitlesBucket()
    },
    search: {
      q: '',
      activeQuery: '',
      status: 'idle',
      results: [],
      error: null,
      seq: 0,
      stale: false
    },
    tierMode: 'search',
    board: null,
    tierFatal: null,
    boards: {},
    storageOk: true,
    saveWarned: false,
    drag: null
  };

  var dom = {};
  var chartObservers = [];
  var searchTimer = null;
  var genreTriggerEl = null;

  function cacheDom () {
    dom.viewStats = document.getElementById('viewStats');
    dom.statsLayout = document.getElementById('statsLayout');
    dom.annWire = document.getElementById('annWire');
    dom.viewTiers = document.getElementById('viewTiers');
    dom.viewRadar = document.getElementById('viewRadar');
    dom.viewLibrary = document.getElementById('viewLibrary');
    dom.divisionSwitch = $('.division-switch');
    dom.main = document.getElementById('main');
    dom.live = document.getElementById('liveRegion');
    dom.toast = document.getElementById('toast');
    dom.confirm = document.getElementById('confirmDialog');
    dom.body = document.body;
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /* ── small utilities ───────────────────────────────────────── */

  function esc (value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      if (char === '&') return '&amp;';
      if (char === '<') return '&lt;';
      if (char === '>') return '&gt;';
      if (char === '"') return '&quot;';
      return '&#39;';
    });
  }

  function escAttr (value) {
    return esc(value);
  }

  function cleanText (value, maxLength) {
    if (typeof value !== 'string') return '';
    var clean = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.slice(0, maxLength || 220);
  }

  function safeInteger (value) {
    var n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }

  function safeImageUrl (value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      var url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      var host = url.hostname.toLowerCase();
      if (host !== 'anilist.co' && !host.endsWith('.anilist.co') && host !== 'cdn.myanimelist.net') return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function clamp (value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function artworkMarkup (url, className) {
    url = safeImageUrl(url) || safeAnnImageUrl(url);
    return '<span class="artwork ' + className + '" aria-hidden="true">' +
      (url ? '<img src="' + escAttr(url) + '" alt="" loading="lazy" decoding="async" width="160" height="240" referrerpolicy="no-referrer">' : '') +
      '<span class="img-fallback">—</span></span>';
  }

  function mediaLink (id) {
    return 'https://anilist.co/' + (state.type === 'MANGA' ? 'manga/' : 'anime/') + id;
  }

  function profileLabel () { return state.source === 'mal' ? 'MyAnimeList' : 'AniList'; }

  function entryLink (entry, type) {
    return entry.source === 'mal' ? 'https://myanimelist.net/' + (type || state.type).toLowerCase() + '/' + entry.id : 'https://anilist.co/' + (type || state.type).toLowerCase() + '/' + entry.id;
  }

  function collectionOwner () { return state.stats ? (state.source === 'mal' ? 'mal:' : '') + state.stats.name.toLowerCase() : ''; }

  function pad (value, width) {
    var text = String(value);
    while (text.length < width) text = '0' + text;
    return text;
  }

  function formatNumber (value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('en-US').format(number);
  }

  function formatMean (value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number);
  }

  function formatMeanShort (value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    return Number(number.toFixed(1)).toString();
  }

  function formatDays (minutes) {
    var number = Number(minutes);
    if (!Number.isFinite(number)) return '—';
    return (number / 1440).toFixed(1);
  }

  function formatClock (date) {
    var d = date || new Date();
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }

  function formatStamp (timestamp) {
    if (!timestamp) return '—';
    var d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '—';
    var datePart = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(d).toUpperCase();
    return datePart + ' / ' + formatClock(d);
  }

  function formatCountdown (seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var mins = Math.floor(total / 60);
    var secs = total % 60;
    return pad(mins, 2) + ':' + pad(secs, 2);
  }

  function labelize (code) {
    if (!code) return '—';
    return String(code).replace(/_/g, ' ');
  }

  function formatLabel (code) {
    if (!code) return '—';
    return FORMAT_LABELS[code] || labelize(code);
  }

  function mediaTitle (media) {
    if (!media || !media.title) return 'Untitled';
    return media.title.romaji || media.title.english || media.title.native || 'Untitled';
  }

  function announce (message) {
    if (!dom.live) return;
    dom.live.textContent = '';
    window.setTimeout(function () { dom.live.textContent = message; }, 30);
  }

  var toastTimer = 0;
  function showToast (message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      if (dom.toast) dom.toast.hidden = true;
    }, 2800);
  }

  function updateDocumentTitle () {
    var title = 'Anigraph / Anime & manga record';
    if (state.view === 'tiers' && state.board) {
      title = state.board.title + ' / Anigraph tier board';
    } else if (state.view === 'stats' && state.statsStatus === 'success' && state.stats) {
      title = state.stats.name + ' / Anigraph record';
    } else if (state.view === 'radar') {
      title = 'Airing radar / Anigraph';
    } else if (state.view === 'library') {
      title = (state.stats ? state.stats.name + ' / ' : '') + LIBRARY_LABELS[state.library.mode] + ' / Anigraph';
    }
    document.title = title;
  }

  /* ── storage ───────────────────────────────────────────────── */

  function getStorage (kind) {
    try {
      return kind === 'session' ? window.sessionStorage : window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function readJson (storage, key, fallback) {
    try {
      var raw = storage ? storage.getItem(key) : null;
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function writeJson (storage, key, value) {
    try {
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function saveUiState () {
    var activeMediaId = null;
    if (state.view === 'tiers' && state.board && !state.board.shared) {
      if (state.boards[String(state.board.mediaId)]) activeMediaId = state.board.mediaId;
    }
    var payload = {
      view: state.view,
      type: state.type,
      username: state.username,
      source: state.source,
      libraryMode: state.library.mode,
      radarScope: state.radar.scope,
      radarListStatus: state.radar.listStatus,
      activeMediaId: activeMediaId
    };
    writeJson(getStorage('local'), UI_KEY, payload);
  }

  function loadUiState () {
    var value = readJson(getStorage('local'), UI_KEY, null);
    if (!value || typeof value !== 'object') return null;
    return {
      view: ['stats', 'tiers', 'radar', 'library'].indexOf(value.view) !== -1 ? value.view : 'stats',
      type: value.type === 'MANGA' ? 'MANGA' : 'ANIME',
      username: cleanText(value.username, 80),
      source: value.source === 'mal' ? 'mal' : 'anilist',
      libraryMode: LIBRARY_MODES.indexOf(value.libraryMode) !== -1 ? value.libraryMode : 'browse',
      radarScope: value.radarScope === 'MINE' ? 'MINE' : 'ALL',
      radarListStatus: ['CURRENT', 'PLANNING'].indexOf(value.radarListStatus) !== -1 ? value.radarListStatus : 'ALL',
      activeMediaId: safeInteger(value.activeMediaId)
    };
  }

  /* ── api ───────────────────────────────────────────────────── */

  class ApiError extends Error {
    constructor (message, options) {
      super(message || 'AniList request failed');
      this.name = 'ApiError';
      this.kind = (options && options.kind) || 'server';
      this.status = options && options.status ? options.status : 0;
      this.retryAfter = options && options.retryAfter ? options.retryAfter : null;
      this.graphqlMessage = (options && options.graphqlMessage) || '';
    }
  }

  function parseRetryAfter (header) {
    if (!header) return null;
    var numeric = Number(header);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
    var date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
    return null;
  }

  async function gql (query, variables, options) {
    var vars = variables || {};
    var cacheKey = CACHE_PREFIX + JSON.stringify([query, vars]);
    var session = getStorage('session');
    var cached = session ? readJson(session, cacheKey, null) : null;
    if (!(options && options.force) && cached && cached.data && typeof cached.at === 'number' && Date.now() - cached.at < CACHE_TTL) {
      return cached.data;
    }

    var response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ query: query, variables: vars })
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw new ApiError('Network request failed', { kind: 'network', status: 0 });
    }

    var retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
    var payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    var firstError = payload && Array.isArray(payload.errors) && payload.errors.length ? payload.errors[0] : null;
    var graphqlMessage = firstError && firstError.message ? String(firstError.message) : '';

    if (response.status === 429) {
      throw new ApiError(graphqlMessage || 'Too many requests', {
        kind: 'rate',
        status: 429,
        retryAfter: retryAfter || 60,
        graphqlMessage: graphqlMessage
      });
    }

    if (firstError) {
      throw new ApiError(graphqlMessage || 'AniList returned an error', {
        kind: 'graphql',
        status: response.status || (firstError.status || 0),
        retryAfter: retryAfter,
        graphqlMessage: graphqlMessage
      });
    }

    if (!response.ok) {
      throw new ApiError('AniList returned HTTP ' + response.status, {
        kind: response.status >= 500 ? 'server' : 'http',
        status: response.status,
        retryAfter: retryAfter
      });
    }

    if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new ApiError('AniList returned an unreadable response', { kind: 'server', status: response.status });
    }

    if (session) writeJson(session, cacheKey, { at: Date.now(), data: payload.data });
    return payload.data;
  }

  function discardCachedQuery (query, variables) {
    try {
      var session = getStorage('session');
      if (session) session.removeItem(CACHE_PREFIX + JSON.stringify([query, variables]));
    } catch (error) {}
  }

  function safeAnnUrl (value) {
    if (typeof value !== 'string') return '';
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && (url.hostname === 'www.animenewsnetwork.com' || url.hostname === 'animenewsnetwork.com') && !url.username && !url.password && !url.port ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function safeAnnImageUrl (value) {
    var safe = safeAnnUrl(value);
    if (!safe) return '';
    var path = new URL(safe).pathname;
    return /^\/(?:thumbnails|cms)\/.+\.(?:jpe?g|png|webp|gif)$/i.test(path) && !/%(?:2[ef]|5c|25)/i.test(path) ? safe : '';
  }

  async function annFetch (force) {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') throw new ApiError('Wire offline', { kind: 'network' });
    var key = CACHE_PREFIX + 'ann:news:images';
    var session = getStorage('session');
    var cached = readJson(session, key, null);
    var payload;
    var loadedAt = Date.now();
    if (!force && cached && Array.isArray(cached.data) && typeof cached.at === 'number' && Date.now() - cached.at < CACHE_TTL) {
      payload = cached.data;
      loadedAt = cached.at;
    } else {
      var response;
      try {
        response = await fetch('/api/ann/news', { headers: { Accept: 'application/json' }, credentials: 'omit', signal: AbortSignal.timeout(25000) });
      } catch (error) {
        throw new ApiError('Wire offline', { kind: 'network' });
      }
      if (response.status === 429) throw new ApiError('Wire rate limited', { kind: 'rate', status: 429, retryAfter: parseRetryAfter(response.headers.get('Retry-After')) || 60 });
      if (!response.ok) throw new ApiError('Wire offline', { kind: 'server', status: response.status });
      try { payload = await response.json(); } catch (error) { throw new ApiError('Unreadable wire response', { kind: 'server' }); }
    }
    if (!Array.isArray(payload)) throw new ApiError('Unreadable wire response', { kind: 'server' });
    var items = payload.filter(function (item) { return item && cleanText(item.title, 300) && safeAnnUrl(item.link); }).slice(0, 5).map(function (item) {
      var time = Date.parse(item.publishedAt);
      return { title: cleanText(item.title, 300), link: safeAnnUrl(item.link), imageUrl: safeAnnImageUrl(item.imageUrl), summary: cleanText(item.summary, 200), publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null, source: 'Anime News Network' };
    });
    writeJson(session, key, { at: loadedAt, data: items });
    return { items: items, at: loadedAt };
  }

  function classifyError (error) {
    if (!(error instanceof ApiError)) {
      return { kind: 'server', status: 0, retryAfter: null, message: cleanText(error && error.message, 220) || 'Unexpected error' };
    }
    if (error.kind === 'network') return { kind: 'network', status: 0, retryAfter: null, message: error.message };
    if (error.status === 429 || error.kind === 'rate') {
      return { kind: 'rate', status: 429, retryAfter: error.retryAfter || 60, message: error.graphqlMessage || error.message };
    }
    var message = error.graphqlMessage || error.message || '';
    if (error.status === 404 || /\bnot found\b/i.test(message)) {
      return { kind: 'notfound', status: 404, retryAfter: null, message: message };
    }
    if (/private/i.test(message)) {
      return { kind: 'private', status: error.status, retryAfter: null, message: message };
    }
    return { kind: 'server', status: error.status, retryAfter: error.retryAfter, message: message };
  }

  /* ── rate-limit countdowns ─────────────────────────────────── */

  function startRateLimitCountdowns (root) {
    $all('[data-rate-block]', root || document).forEach(function (block) {
      if (block.getAttribute('data-rate-started') === 'true') return;
      block.setAttribute('data-rate-started', 'true');
      var remaining = Number(block.getAttribute('data-rate-seconds')) || 60;
      var countEls = $all('[data-rate-countdown]', block);
      var button = $('[data-rate-button]', block);
      var tick = function () {
        if (!document.documentElement.contains(block)) {
          window.clearInterval(timerId);
          return;
        }
        if (remaining <= 0) {
          countEls.forEach(function (el) { el.textContent = '00:00'; });
          if (button) {
            button.disabled = false;
            button.removeAttribute('aria-disabled');
            button.textContent = button.getAttribute('data-retry-label') || 'RETRY';
          }
          window.clearInterval(timerId);
          return;
        }
        countEls.forEach(function (el) { el.textContent = formatCountdown(remaining); });
        if (button) {
          button.textContent = (button.getAttribute('data-retry-prefix') || 'RETRY IN') + ' ' + formatCountdown(remaining);
        }
        remaining -= 1;
      };
      if (button) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      }
      tick();
      var timerId = window.setInterval(tick, 1000);
    });
  }

  /* ── chart data preparation ────────────────────────────────── */

  function divisionData () {
    if (!state.stats || !state.stats.statistics) return null;
    return state.stats.statistics[state.type === 'ANIME' ? 'anime' : 'manga'] || null;
  }

  function prepareScores (scores, normalized) {
    var raw = Array.isArray(scores) ? scores.filter(function (item) {
      return item && Number(item.score) > 0 && Number(item.count) > 0;
    }).map(function (item) {
      return { score: Number(item.score), count: Number(item.count) };
    }) : [];
    if (!raw.length) return { bins: [], total: 0, peak: null, gain: 1 };
    var maxRaw = raw.reduce(function (max, item) { return Math.max(max, item.score); }, 0);
    var gain = normalized ? 1 : maxRaw <= 5 ? 20 : maxRaw <= 10 ? 10 : 1;
    var bins = [];
    for (var i = 1; i <= 10; i += 1) bins.push({ label: String(i * 10), count: 0 });
    raw.forEach(function (item) {
      var index = clamp(Math.ceil((item.score * gain) / 10), 1, 10) - 1;
      bins[index].count += item.count;
    });
    var total = bins.reduce(function (sum, bin) { return sum + bin.count; }, 0);
    var peak = bins.reduce(function (best, bin) { return !best || bin.count > best.count ? bin : best; }, null);
    return { bins: bins, total: total, peak: peak, gain: gain };
  }

  function prepareStatuses (statuses) {
    var rows = Array.isArray(statuses) ? statuses.filter(function (item) {
      return item && item.status && Number(item.count) > 0;
    }).map(function (item) {
      return { code: String(item.status), label: labelize(item.status), count: Number(item.count), color: STATUS_COLORS[item.status] || 'var(--paper)' };
    }) : [];
    rows.sort(function (a, b) { return b.count - a.count; });
    var total = rows.reduce(function (sum, row) { return sum + row.count; }, 0);
    return { rows: rows, total: total };
  }

  function prepareFormats (formats) {
    var rows = Array.isArray(formats) ? formats.filter(function (item) {
      return item && item.format && Number(item.count) > 0;
    }).map(function (item) {
      return { code: String(item.format), label: formatLabel(item.format), count: Number(item.count) };
    }) : [];
    rows.sort(function (a, b) { return b.count - a.count; });
    return { rows: rows };
  }

  function prepareGenres (genres) {
    var rows = Array.isArray(genres) ? genres.filter(function (item) {
      return item && item.genre && Number(item.count) > 0;
    }).map(function (item) {
      return { label: String(item.genre), count: Number(item.count), mean: Number(item.meanScore) || 0 };
    }) : [];
    rows.sort(function (a, b) { return b.count - a.count; });
    return { rows: rows.slice(0, 10) };
  }

  function prepareYears (years, key) {
    var map = new Map();
    if (Array.isArray(years)) {
      years.forEach(function (item) {
        var year = Number(item && item[key]);
        var count = Number(item && item.count);
        if (Number.isInteger(year) && year > 0 && count > 0) {
          map.set(year, (map.get(year) || 0) + count);
        }
      });
    }
    var rows = Array.from(map.entries()).map(function (entry) {
      return { year: entry[0], label: String(entry[0]), count: entry[1] };
    }).sort(function (a, b) { return a.year - b.year; });
    var peak = rows.reduce(function (best, row) { return !best || row.count > best.count ? row : best; }, null);
    return { rows: rows, peak: peak };
  }

  function plural (count, singular, pluralWord) {
    return count + ' ' + (count === 1 ? singular : (pluralWord || singular + 's'));
  }

  function scoreSummary (data) {
    if (!data.total) return 'Score distribution. No scores recorded in this division.';
    return 'Score distribution in 10-point bins. ' + plural(data.total, 'scored entry', 'scored entries') +
      '. Peak at ' + data.peak.label + ' with ' + plural(data.peak.count, 'entry', 'entries') + '.';
  }

  function statusSummary (data) {
    if (!data.total) return 'Status distribution. No status data recorded in this division.';
    var parts = data.rows.slice(0, 5).map(function (row) { return row.label + ' ' + row.count; });
    return 'Status distribution: ' + parts.join(', ') + (data.rows.length > 5 ? ', plus more.' : '.');
  }

  function formatSummary (data) {
    if (!data.rows.length) return 'Format distribution. No format data recorded in this division.';
    var top = data.rows[0];
    return 'Format distribution. ' + plural(data.rows.length, 'format') + '. ' + top.label + ' leads with ' + plural(top.count, 'entry', 'entries') + '.';
  }

  function genreSummary (data) {
    if (!data.rows.length) return 'Genres. No genre data recorded in this division.';
    var top = data.rows[0];
    return 'Top ten genres by count. ' + top.label + ' leads with ' + plural(top.count, 'entry', 'entries') +
      (top.mean > 0 ? ' and a mean score of ' + formatMean(top.mean) + '.' : '.');
  }

  function yearSummary (data, kind) {
    var word = kind === 'release' ? 'Release years' : 'Start years';
    if (!data.rows.length) return word + '. No ' + (kind === 'release' ? 'release-year' : 'start-year') + ' data recorded in this division.';
    var first = data.rows[0];
    var last = data.rows[data.rows.length - 1];
    return word + ' from ' + first.year + ' to ' + last.year + '. Busiest year is ' + data.peak.year +
      ' with ' + plural(data.peak.count, 'entry', 'entries') + '.';
  }

  function buildChartSpecs (division) {
    var scores = prepareScores(division && division.scores, division && division.scoreScale === 100);
    var statuses = prepareStatuses(division && division.statuses);
    var formats = prepareFormats(division && division.formats);
    var genres = prepareGenres(division && division.genres);
    var releaseYears = prepareYears(division && division.releaseYears, 'releaseYear');
    var startYears = prepareYears(division && division.startYears, 'startYear');
    var titleBucket = state.titles[state.type] || { status: 'idle', rows: [] };
    var titleData = { status: titleBucket.status, rows: titleBucket.rows || [], unit: state.type === 'MANGA' ? 'CH' : 'EP' };
    var titleEmpty = titleBucket.status === 'error'
      ? 'Title progress unavailable.'
      : titleBucket.status === 'loading'
        ? 'Loading title progress.'
        : 'No public title progress.';
    return [
      {
        id: 'scores', kind: 'scores', span: 'span-7', title: 'Score distribution', note: 'Scores /100 · 10-point ranges',
        data: scores, summary: scoreSummary(scores), empty: 'No scores.'
      },
      {
        id: 'statuses', kind: 'statuses', span: 'span-5', title: 'Status', note: 'Share of your list',
        data: statuses, summary: statusSummary(statuses), empty: 'No status data.'
      },
      {
        id: 'genres', kind: 'genres', span: 'span-7', title: 'Top genres', note: 'Select a genre to explore its titles',
        data: genres, summary: genreSummary(genres), empty: 'No genre data.'
      },
      {
        id: 'formats', kind: 'formats', span: 'span-5', title: 'Formats', note: 'Entries by format',
        data: formats, summary: formatSummary(formats), empty: 'No format data.'
      },
      {
        id: 'releaseYears', kind: 'release', span: 'span-7', title: 'Release years', note: 'Entries by original release year',
        data: releaseYears, summary: yearSummary(releaseYears, 'release'), empty: 'No release years.'
      },
      {
        id: 'startYears', kind: 'start', span: 'span-5', title: 'Start years', note: 'When you started each title',
        data: startYears, summary: yearSummary(startYears, 'start'), empty: 'No start years.'
      },
      {
        id: 'titles', kind: 'titles', span: 'span-12', title: 'Top titles', note: 'Ranked by ' + (state.type === 'MANGA' ? 'chapters read' : 'episodes watched'),
        data: titleData, summary: titlesSummary(titleBucket, state.type), empty: titleEmpty
      }
    ];
  }

  /* ── chart markup ──────────────────────────────────────────── */

  function chartPanelMarkup (spec, index) {
    return '<figure class="panel ' + spec.span + ' reveal" style="--stagger-i:' + (index + 3) + '" data-panel="' + spec.id + '" aria-label="' + escAttr(spec.summary) + '">' +
      '<figcaption class="panel-head">' +
        '<div><h2 class="panel-title">' + esc(spec.title) + '</h2><p class="panel-note">' + esc(spec.note) + '</p></div>' +
      '</figcaption>' +
      '<div class="chart-slot"><div class="chart-canvas" data-chart-canvas="' + spec.id + '"></div></div>' +
    '</figure>';
  }

  function chartEmptyMarkup (spec) {
    return '<div class="chart-empty">' +
      '<span class="chart-empty-mark" aria-hidden="true">—</span>' +
      '<p class="chart-empty-text">' + esc(spec.empty) + '</p>' +
    '</div>';
  }

  function niceMax (value) {
    if (!value || value <= 0) return 1;
    var power = Math.pow(10, Math.floor(Math.log10(value)));
    var fraction = value / power;
    var nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * power;
  }

  function chartSvg (width, height, body, interactive) {
    return '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '"' + (interactive ? '' : ' aria-hidden="true"') + ' focusable="false" preserveAspectRatio="xMidYMid meet">' +
      body + '</svg>';
  }

  function renderScoreChart (spec, width, animate) {
    var w = Math.max(260, Math.round(width));
    var h = 160;
    var padL = 38;
    var padR = 8;
    var padT = 12;
    var padB = 30;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;
    var bins = spec.data.bins;
    var maxValue = bins.reduce(function (max, bin) { return Math.max(max, bin.count); }, 0);
    var top = Math.max(4, niceMax(maxValue));
    var parts = [];
    for (var line = 0; line <= 4; line += 1) {
      var y = padT + plotH - (plotH * line / 4);
      var tick = Math.round(top * line / 4);
      parts.push('<line class="chart-rule" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + y.toFixed(1) + '"></line>');
      parts.push('<text class="chart-axis-label" x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + formatNumber(tick) + '</text>');
    }
    var step = plotW / bins.length;
    bins.forEach(function (bin, index) {
      var barW = Math.min(40, step * 0.68);
      var barH = Math.max(0, (bin.count / top) * plotH);
      var x = padL + step * index + (step - barW) / 2;
      var y = padT + plotH - barH;
      if (barH > 0) {
        var classes = 'chart-bar' + (animate ? ' grow-y' : '');
        parts.push('<rect class="' + classes + '" style="--i:' + Math.min(index, 10) + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" fill="var(--accent)" fill-opacity="' + (bin === spec.data.peak ? '1' : '.55') + '"><title>' + esc('Score ' + bin.label + ': ' + plural(bin.count, 'entry', 'entries')) + '</title></rect>');
      }
      parts.push('<text class="chart-axis-label" x="' + (x + barW / 2).toFixed(1) + '" y="' + (padT + plotH + 18) + '" text-anchor="middle">' + bin.label + '</text>');
    });
    return '<div class="chart-insight"><strong>' + (Number(spec.data.peak.label) - 9) + '–' + esc(spec.data.peak.label) + '</strong><span>Most common range<br>' + plural(spec.data.peak.count, 'entry', 'entries') + '</span></div>' + chartSvg(w, h, parts.join(''));
  }

  function renderYearChart (spec, width, animate) {
    var w = Math.max(260, Math.round(width));
    var h = 160;
    var padL = 38;
    var padR = 10;
    var padT = 12;
    var padB = 30;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;
    var rows = spec.data.rows;
    var minYear = rows[0].year;
    var maxYear = rows[rows.length - 1].year;
    var span = Math.max(1, maxYear - minYear);
    var maxValue = rows.reduce(function (max, row) { return Math.max(max, row.count); }, 0);
    var top = Math.max(4, niceMax(maxValue));
    var parts = [];
    for (var line = 0; line <= 4; line += 1) {
      var y = padT + plotH - (plotH * line / 4);
      var tick = Math.round(top * line / 4);
      parts.push('<line class="chart-rule" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + y.toFixed(1) + '"></line>');
      parts.push('<text class="chart-axis-label" x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + formatNumber(tick) + '</text>');
    }
    var barW = Math.max(2, Math.min(18, plotW / Math.max(rows.length, 10) * 0.7));
    rows.forEach(function (row, index) {
      var ratio = maxYear === minYear ? 0.5 : (row.year - minYear) / span;
      var center = padL + ratio * plotW;
      var barH = Math.max(0, (row.count / top) * plotH);
      var x = clamp(center - barW / 2, padL, padL + plotW - barW);
      var y = padT + plotH - barH;
      var classes = 'chart-bar' + (animate ? ' grow-y' : '');
      parts.push('<rect class="' + classes + '" style="--i:' + Math.min(index, 10) + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" fill="var(--accent)" fill-opacity="' + (row === spec.data.peak ? '1' : '.55') + '"><title>' + esc(row.year + ': ' + plural(row.count, 'entry', 'entries')) + '</title></rect>');
    });
    var tickCount = w < 390 ? 4 : 5;
    var seenYears = {};
    for (var t = 0; t < tickCount; t += 1) {
      var year = Math.round(minYear + ((maxYear - minYear) * t / Math.max(1, tickCount - 1)));
      if (seenYears[year]) continue;
      seenYears[year] = true;
      var xTick = maxYear === minYear ? padL + plotW / 2 : padL + ((year - minYear) / span) * plotW;
      var anchor = xTick < padL + 18 ? 'start' : xTick > padL + plotW - 18 ? 'end' : 'middle';
      parts.push('<text class="chart-axis-label" x="' + xTick.toFixed(1) + '" y="' + (padT + plotH + 18) + '" text-anchor="' + anchor + '">' + year + '</text>');
    }
    return '<div class="chart-insight"><strong>' + spec.data.peak.year + '</strong><span>Busiest year<br>' + plural(spec.data.peak.count, 'entry', 'entries') + '</span></div>' + chartSvg(w, h, parts.join(''));
  }

  function renderStatusChart (spec, width, animate) {
    var w = Math.max(260, Math.round(width));
    var h = 50;
    var pad = 0;
    var top = 28;
    var barH = 16;
    var total = spec.data.total;
    var rows = spec.data.rows;
    var parts = [];
    parts.push('<text class="chart-value-label" x="' + pad + '" y="16">TOTAL ' + formatNumber(total) + '</text>');
    var groupClass = animate ? 'chart-stack grow-x' : 'chart-stack';
    var group = ['<g class="' + groupClass + '">'];
    var x = pad;
    var usable = w - pad * 2;
    rows.forEach(function (row) {
      var segW = total ? (row.count / total) * usable : 0;
      group.push('<rect x="' + x.toFixed(1) + '" y="' + top + '" width="' + Math.max(0, segW - 1).toFixed(1) + '" height="' + barH + '" fill="' + row.color + '"><title>' + esc(row.label + ': ' + plural(row.count, 'entry', 'entries')) + '</title></rect>');
      x += segW;
    });
    group.push('</g>');
    parts.push(group.join(''));
    var dominant = rows[0];
    var share = function (count) { return (count * 100 / total).toFixed(1).replace(/\.0$/, '') + '%'; };
    var insight = '<div class="chart-insight"><strong>' + share(dominant.count) + '</strong><span>' + esc(dominant.label) + '<br>' + plural(dominant.count, 'entry', 'entries') + '</span></div>';
    var legend = '<div class="chart-legend" aria-hidden="true">' + rows.map(function (row) {
      return '<div class="chart-legend-item"><span class="chart-legend-swatch" style="background:' + row.color + '"></span><span class="chart-legend-name">' + esc(row.label) + '</span><span class="chart-legend-value">' + formatNumber(row.count) + '</span><span class="chart-legend-share">' + share(row.count) + '</span></div>';
    }).join('') + '</div>';
    return insight + chartSvg(w, h, parts.join('')) + legend;
  }

  function truncateLabel (text, maxWidth) {
    var max = Math.max(3, Math.floor((maxWidth - 4) / 6.5));
    var label = String(text || '—');
    if (label.length <= max) return label;
    return label.slice(0, Math.max(1, max - 1)) + '…';
  }

  function renderHorizontalChart (spec, width, animate) {
    var rows = spec.data.rows;
    var w = Math.max(270, Math.round(width));
    var hasMean = spec.kind === 'genres';
    var compact = hasMean && w < 390;
    var rightW = hasMean ? 128 : 54;
    var labelW = hasMean ? clamp(Math.round(w * 0.32), 112, 148) : clamp(Math.round(w * 0.36), 112, 148);
    var left = compact ? 24 : labelW;
    var right = w - (compact ? 18 : rightW);
    var plotW = right - left;
    var rowH = compact ? 44 : hasMean ? 28 : 30;
    var padT = hasMean ? 0 : 26;
    var padB = 5;
    var h = padT + rows.length * rowH + padB;
    var maxValue = rows.reduce(function (max, row) { return Math.max(max, row.count); }, 0);
    var top = niceMax(maxValue);
    var parts = [];
    if (!hasMean) {
      parts.push('<text class="chart-column-label" x="24" y="16">Format</text>');
      parts.push('<text class="chart-column-label" x="' + (w - 3) + '" y="16" text-anchor="end">Entries</text>');
    }
    rows.forEach(function (row, index) {
      var cy = padT + index * rowH + (compact ? 28 : rowH / 2);
      var labelY = cy + (compact ? -12 : 4);
      var barW = Math.max(1, (row.count / top) * plotW);
      var classes = 'chart-bar' + (animate ? ' grow-x' : '');
      parts.push(hasMean
        ? '<g class="chart-genre-row" role="button" tabindex="0" data-genre="' + escAttr(row.label) + '" aria-label="' + escAttr(row.label + ', ' + plural(row.count, 'entry', 'entries') + '. Show all titles.') + '" aria-controls="genreDrilldown">' +
          '<title aria-hidden="true">' + esc(row.label + ': ' + plural(row.count, 'entry', 'entries') + ', mean score ' + (row.mean > 0 ? formatMean(row.mean) : 'not scored')) + '</title>' +
          '<rect class="chart-hit" x="0" y="' + (padT + index * rowH) + '" width="' + w + '" height="' + rowH + '" aria-hidden="true"></rect><g aria-hidden="true">'
        : '<g><title>' + esc(row.label + ': ' + plural(row.count, 'entry', 'entries')) + '</title>');
      parts.push('<text class="chart-rank" x="0" y="' + labelY.toFixed(1) + '">' + pad(index + 1, 2) + '</text>');
      parts.push('<text class="chart-row-label" x="24" y="' + labelY.toFixed(1) + '">' + esc(truncateLabel(row.label, compact ? w - 156 : labelW - 28)) + '</text>');
      parts.push('<line class="chart-rule" x1="' + left + '" y1="' + cy.toFixed(1) + '" x2="' + right + '" y2="' + cy.toFixed(1) + '"></line>');
      parts.push('<rect class="' + classes + '" style="--i:' + Math.min(index, 10) + '" x="' + left + '" y="' + (cy - 3).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="6" fill="var(--accent)" fill-opacity="' + (index === 0 ? '1' : '.65') + '"></rect>');
      if (hasMean) {
        parts.push('<text class="chart-value-label" x="' + (w - 76) + '" y="' + labelY.toFixed(1) + '" text-anchor="end">' + formatNumber(row.count) + '</text>');
        parts.push('<text class="chart-axis-label" x="' + (w - 18) + '" y="' + labelY.toFixed(1) + '" text-anchor="end">' + (row.mean > 0 ? formatMeanShort(row.mean) : '—') + '</text>');
        parts.push('<text class="chart-row-arrow" x="' + (w - 2) + '" y="' + labelY.toFixed(1) + '" text-anchor="end">›</text>');
      } else {
        parts.push('<text class="chart-value-label" x="' + (w - 3) + '" y="' + (cy + 4).toFixed(1) + '" text-anchor="end">' + formatNumber(row.count) + '</text>');
      }
      parts.push(hasMean ? '</g></g>' : '</g>');
    });
    var chart = chartSvg(w, h, parts.join(''), hasMean);
    if (hasMean) return '<div class="genre-chart-columns" aria-hidden="true"><span>Genre</span><span>Entries</span><span>Mean /100</span></div>' + chart;
    var total = rows.reduce(function (sum, row) { return sum + row.count; }, 0);
    var share = (rows[0].count * 100 / total).toFixed(1).replace(/\.0$/, '') + '%';
    return '<div class="chart-insight"><strong>' + share + '</strong><span>' + esc(rows[0].label) + '<br>' + plural(rows[0].count, 'entry', 'entries') + '</span></div>' + chart;
  }

  function renderTitlesChart (spec) {
    var rows = spec.data.rows;
    var maxValue = rows.reduce(function (max, row) { return Math.max(max, row.progress); }, 0) || 1;
    return '<ol class="title-chart">' + rows.map(function (row, index) {
      var progressLabel = formatNumber(row.progress) + (row.total ? ' / ' + formatNumber(row.total) : '');
      var tooltip = row.title + ': ' + formatNumber(row.progress) + ' ' + (spec.data.unit === 'CH' ? 'chapters' : 'episodes') + (row.total ? ' of ' + formatNumber(row.total) : '') + (row.format ? ' / ' + formatLabel(row.format) : '');
      return '<li class="title-chart-row" data-media-id="' + row.id + '" title="' + escAttr(tooltip) + '">' +
        '<span class="title-rank" aria-hidden="true">' + pad(index + 1, 2) + '</span>' + artworkMarkup(row.cover, 'title-art') +
        '<div class="title-chart-copy"><a class="chart-title-label" href="' + entryLink(row) + '" target="_blank" rel="noopener noreferrer">' + esc(row.title) + '</a>' +
          '<p class="title-chart-meta">' + esc(formatLabel(row.format)) + (row.year ? ' / ' + row.year : '') + '</p>' +
          '<span class="title-progress-track" aria-hidden="true"><span style="width:' + (row.progress / maxValue * 100).toFixed(2) + '%"></span></span></div>' +
        '<span class="title-chart-progress"><span class="chart-value-label">' + esc(progressLabel) + '</span><small>' + (spec.data.unit === 'CH' ? 'CHAPTERS' : 'EPISODES') + '</small></span></li>';
    }).join('') + '</ol>';
  }

  function chartLoadingMarkup () {
    return '<div class="chart-loading" aria-hidden="true">' +
      '<div class="skeleton" style="height:9px;width:78%"></div>' +
      '<div class="skeleton" style="height:9px;width:64%"></div>' +
      '<div class="skeleton" style="height:9px;width:51%"></div>' +
      '<div class="skeleton" style="height:9px;width:38%"></div>' +
    '</div>';
  }

  function chartMarkupFor (spec, width, animate) {
    if (spec.kind === 'scores') {
      if (!spec.data.total) return chartEmptyMarkup(spec);
      return renderScoreChart(spec, width, animate);
    }
    if (spec.kind === 'statuses') {
      if (!spec.data.rows.length) return chartEmptyMarkup(spec);
      return renderStatusChart(spec, width, animate);
    }
    if (spec.kind === 'formats' || spec.kind === 'genres') {
      if (!spec.data.rows.length) return chartEmptyMarkup(spec);
      return renderHorizontalChart(spec, width, animate);
    }
    if (spec.kind === 'release' || spec.kind === 'start') {
      if (!spec.data.rows.length) return chartEmptyMarkup(spec);
      return renderYearChart(spec, width, animate);
    }
    if (spec.kind === 'titles') {
      if (spec.data.status === 'loading') return chartLoadingMarkup();
      if (!spec.data.rows.length) return chartEmptyMarkup(spec);
      return renderTitlesChart(spec);
    }
    return chartEmptyMarkup(spec);
  }

  function mountStatsCharts (specs, allowAnimate) {
    chartObservers.forEach(function (observer) { observer.disconnect(); });
    chartObservers = [];
    specs.forEach(function (spec) {
      var canvas = $('[data-chart-canvas="' + spec.id + '"]');
      if (!canvas) return;
      var lastWidth = 0;
      var animated = false;
      var draw = function (allowAnimate) {
        var width = Math.round(canvas.getBoundingClientRect().width);
        if (!width) return;
        var focusedGenre = canvas.contains(document.activeElement) && document.activeElement.getAttribute('data-genre');
        var animate = allowAnimate !== false && allowAnimate !== 0 && !animated;
        canvas.innerHTML = chartMarkupFor(spec, width, animate);
        if (focusedGenre) {
          var genreRow = $all('[data-genre]', canvas).find(function (row) { return row.getAttribute('data-genre') === focusedGenre; });
          if (genreRow) genreRow.focus({ preventScroll: true });
        }
        animated = true;
        lastWidth = width;
      };
      draw(allowAnimate !== false);
      if (spec.kind === 'titles') return;
      if (typeof ResizeObserver !== 'undefined') {
        var scheduled = false;
        var observer = new ResizeObserver(function () {
          if (scheduled) return;
          scheduled = true;
          window.requestAnimationFrame(function () {
            scheduled = false;
            var width = Math.round(canvas.getBoundingClientRect().width);
            if (width && Math.abs(width - lastWidth) > 1) draw(false);
          });
        });
        observer.observe(canvas);
        chartObservers.push(observer);
      }
    });
  }

  /* ── stats markup ──────────────────────────────────────────── */

  function statsCommandMarkup (library) {
    var disabled = state.statsStatus === 'loading' ? ' disabled' : '';
    var buttonLabel = state.statsStatus === 'loading' ? 'LOADING' : 'LOAD';
    var inputId = library ? 'libraryUsername' : 'statsUsername';
    return '<form class="command-panel" id="' + (library ? 'libraryProfileForm' : 'statsForm') + '" novalidate>' +
      '<div class="command-label">' +
        '<label class="spec-label" for="' + inputId + '">' + profileLabel().toUpperCase() + ' USERNAME</label>' +
        '<label class="profile-source"><span class="sr-only">Profile source</span><select data-profile-source><option value="anilist"' + (state.source === 'anilist' ? ' selected' : '') + '>AniList</option><option value="mal"' + (state.source === 'mal' ? ' selected' : '') + '>MyAnimeList</option></select></label>' +
      '</div>' +
      '<div class="command-field">' +
        '<span class="command-prefix" aria-hidden="true">@</span>' +
        '<input class="command-input" id="' + inputId + '" name="username" type="text" inputmode="text" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="username" aria-required="true" value="' + escAttr(state.username) + '">' +
      '</div>' +
      '<button class="btn btn-primary command-submit" type="submit"' + disabled + '>' + buttonLabel + '</button>' +
    '</form>';
  }

  function statsVoidMarkup () {
    return '<section class="stats-void">' +
      '<div class="void-main">' +
        '<h1 class="void-title">Read the<br>record<span class="dot">.</span></h1>' +
        '<p class="void-copy">Enter a public ' + profileLabel() + ' username to read its statistics.</p>' +
      '</div>' +
    '</section>';
  }

  function statsSkeletonMarkup () {
    var cells = '';
    for (var i = 0; i < 4; i += 1) {
      cells += '<div class="skel-cell"><div class="skeleton skel-value"></div><div class="skeleton skel-label"></div></div>';
    }
    var panels = '';
    var spans = ['span-7', 'span-5', 'span-5', 'span-7', 'span-7', 'span-5', 'span-12'];
    spans.forEach(function (span, index) {
      panels += '<div class="skel-panel ' + span + '">' +
        '<div class="skel-panel-head"><span class="skeleton"></span></div>' +
        '<div class="skeleton skel-chart" style="opacity:' + (0.24 + (index % 3) * 0.04) + '"></div>' +
      '</div>';
    });
    return '<div aria-hidden="true">' +
      '<div class="skel-profile">' +
        '<div class="skeleton skel-avatar"></div>' +
        '<div class="skel-profile-copy">' +
          '<div class="skeleton skel-line w-30"></div>' +
          '<div class="skeleton skel-display"></div>' +
          '<div class="skeleton skel-line w-70"></div>' +
        '</div>' +
      '</div>' +
      '<div class="skel-summary">' + cells + '</div>' +
      '<div class="skel-section-head"><div class="skeleton"></div><div class="skeleton"></div></div>' +
      '<div class="skel-grid">' + panels + '</div>' +
      '</div>' +
      '<p class="sr-only" role="status">Loading profile record.</p>';
  }

  function statsErrorMessage (error) {
    var kind = error ? error.kind : 'server';
    var name = esc(state.username || 'that profile');
    var code = profileLabel().toUpperCase() + ' / ERROR';
    var title = 'Record unreadable.';
    var body = '' + profileLabel() + ' returned an unexpected response. Try the request again.';
    var action = 'retry-stats';
    var actionLabel = 'RETRY';
    var rate = 0;

    if (kind === 'notfound') {
      code = profileLabel().toUpperCase() + ' / 404';
      title = 'No such profile.';
      body = '' + profileLabel() + ' has no public user named “' + name + '”. Check the spelling, then load again.';
      action = 'focus-stats';
      actionLabel = 'EDIT USERNAME';
    } else if (kind === 'private') {
      code = 'PROFILE / PRIVATE';
      title = state.source === 'mal' ? 'Public list unavailable.' : 'This record is sealed.';
      body = state.source === 'mal' ? esc(cleanText(error.message, 220)) : 'The profile exists, but AniList does not expose its statistics. If the list becomes public, try again.';
    } else if (kind === 'rate') {
      code = 'HTTP 429 / THROTTLED';
      title = 'Signal throttled.';
      body = '' + profileLabel() + ' is limiting requests from this browser. Wait for the countdown, then retry the record.';
      rate = error.retryAfter || 60;
    } else if (kind === 'network') {
      code = 'FETCH / OFFLINE';
      title = 'Feed unreachable.';
      body = 'The public ' + profileLabel() + ' feed did not answer. Check the connection, then retry.';
    } else if (kind === 'server' && error && error.message) {
      code = error.status ? profileLabel().toUpperCase() + ' / HTTP ' + error.status : profileLabel().toUpperCase() + ' / ERROR';
      title = 'Record unreadable.';
      body = '' + profileLabel() + ' returned an error: ' + esc(cleanText(error.message, 180)) + '. Try the request again.';
    }

    var aside = rate
      ? '<div class="state-aside"><span class="spec-label">NEXT ATTEMPT / RATE LIMIT</span>' +
        '<span class="state-count" data-rate-countdown>' + formatCountdown(rate) + '</span>' +
        '<span class="state-count-label">SECONDS REMAINING</span></div>'
      : '<div class="state-aside"><span class="spec-label">EXCHANGE</span><p class="state-code">' + esc(code) + '</p></div>';

    return '<div class="state" role="group" aria-label="Profile error"' + (rate ? ' data-rate-block data-rate-seconds="' + rate + '"' : '') + '>' +
      '<div class="state-main">' +
        '<p class="spec-label state-kicker">' + esc(code) + '</p>' +
        '<h2 class="state-title">' + esc(title) + '</h2>' +
        '<p class="state-body">' + body + '</p>' +
        '<div class="state-action">' +
          '<button class="btn btn-primary" type="button" data-action="' + action + '"' + (rate ? ' data-rate-button data-retry-prefix="RETRY IN" data-retry-label="RETRY RECORD" disabled' : '') + '>' + (rate ? 'RETRY IN ' + formatCountdown(rate) : actionLabel) + '</button>' +
        '</div>' +
      '</div>' +
      aside +
    '</div>';
  }

  function statsSuccessMarkup () {
    var user = state.stats;
    var division = divisionData();
    var isAnime = state.type === 'ANIME';
    var count = division && Number.isFinite(Number(division.count)) ? Number(division.count) : null;
    var mean = division ? division.meanScore : null;
    var avatar = safeImageUrl(user.avatar && user.avatar.medium);
    var banner = safeImageUrl(user.bannerImage);
    var specs = buildChartSpecs(division);
    var featured = state.titles[state.type].rows.filter(function (row) { return row.cover; }).slice(0, 3);

    var summaryItems = isAnime
      ? [
          { value: count === null ? '—' : formatNumber(count), label: 'TITLES', empty: count === null },
          { value: formatMean(mean), label: 'MEAN SCORE', empty: !(Number(mean) > 0) },
          { value: division && division.episodesWatched !== null && division.episodesWatched !== undefined ? formatNumber(division.episodesWatched) : '—', label: 'EPISODES', empty: !division || division.episodesWatched === null || division.episodesWatched === undefined },
          { value: division && division.minutesWatched !== null && division.minutesWatched !== undefined ? formatDays(division.minutesWatched) : '—', label: 'DAYS WATCHED', empty: !division || division.minutesWatched === null || division.minutesWatched === undefined }
        ]
      : [
          { value: count === null ? '—' : formatNumber(count), label: 'TITLES', empty: count === null },
          { value: formatMean(mean), label: 'MEAN SCORE', empty: !(Number(mean) > 0) },
          { value: division && division.chaptersRead !== null && division.chaptersRead !== undefined ? formatNumber(division.chaptersRead) : '—', label: 'CHAPTERS', empty: !division || division.chaptersRead === null || division.chaptersRead === undefined },
          { value: division && division.volumesRead !== null && division.volumesRead !== undefined ? formatNumber(division.volumesRead) : '—', label: 'VOLUMES', empty: !division || division.volumesRead === null || division.volumesRead === undefined }
        ];

    var summaryMarkup = summaryItems.map(function (item, index) {
      return '<div class="summary-cell reveal" style="--stagger-i:' + index + '">' +
        '<span class="summary-label">' + item.label + (item.label === 'MEAN SCORE' ? ' / 100' : '') + '</span>' +
        '<span class="summary-value' + (item.empty ? ' is-empty' : '') + '">' + esc(item.value) + '</span>' +
      '</div>';
    }).join('');

    var chartPanels = specs.map(chartPanelMarkup).join('');

    var bannerMarkup = banner
      ? '<div class="profile-banner reveal" style="--stagger-i:0" aria-hidden="true">' +
          '<img src="' + escAttr(banner) + '" alt="" decoding="async" referrerpolicy="no-referrer">' +
          '<span class="img-fallback" aria-hidden="true">—</span>' +
        '</div>'
      : '';

    var profileArt = featured.length ? '<div class="profile-art-block"><p class="spec-label">' + (isAnime ? 'MOST WATCHED' : 'MOST READ') + '</p><div class="profile-art-strip">' + featured.map(function (row) {
      return '<a class="profile-art-link" data-media-id="' + row.id + '" href="' + entryLink(row) + '" title="' + escAttr(row.title) + '" aria-label="' + escAttr(row.title + ' on ' + (row.source === 'mal' ? 'MyAnimeList' : 'AniList')) + '" target="_blank" rel="noopener noreferrer">' + artworkMarkup(row.cover, 'profile-art') + '</a>';
    }).join('') + '</div></div>' : '';

    var profile = '<header class="profile-block reveal' + (featured.length ? ' has-art' : '') + '" style="--stagger-i:0">' +
      '<div class="profile-avatar">' +
        (avatar ? '<img src="' + escAttr(avatar) + '" alt="" width="120" height="120" referrerpolicy="no-referrer">' : '') +
        '<span class="img-fallback" aria-hidden="true">—</span>' +
      '</div>' +
      '<div class="profile-copy">' +
        '<p class="profile-caption">' + (isAnime ? 'ANIME' : 'MANGA') + ' OVERVIEW</p>' +
        '<h1 class="profile-name" id="statsTitle">' + esc(user.name) + '</h1>' +
      '</div>' +
      profileArt +
    '</header>';

    var summary = '<div class="summary-strip" aria-label="' + (isAnime ? 'Anime' : 'Manga') + ' summary">' + summaryMarkup + '</div>' +
      (count === 0 ? '<p class="division-empty-note">No entries in this division.</p>' : '') +
      (state.source === 'mal' ? '<p class="stats-source-note">MyAnimeList public list · scores shown /100 · dates shown when recorded.</p>' : '');

    var recordHead = '<div class="record-head reveal" style="--stagger-i:2">' +
      '<div class="record-heading"><h2 class="record-title">Statistics</h2></div>' +
    '</div>';

    return bannerMarkup + profile + summary + recordHead + '<div class="chart-grid">' + chartPanels + '</div>' +
      '<div id="genreDrilldown">' + (state.genre ? genrePanelMarkup() : '') + '</div>';
  }

  function renderStats (allowAnimate) {
    if (!dom.viewStats) return;
    startAnnLoad();
    var genreHost = $('#genreDrilldown');
    var genreFocus = genreHost && genreHost.contains(document.activeElement) ? document.activeElement : null;
    var genreFocusKey = genreFocus && genreFocus.getAttribute('data-genre-filter');
    var genreFocusId = genreFocus && genreFocus.id;
    var genreFocusClose = genreFocus && genreFocus.getAttribute('data-action') === 'close-genre';
    var focusedGenre = document.activeElement && document.activeElement.getAttribute('data-genre');
    var animate = allowAnimate !== false;
    chartObservers.forEach(function (observer) { observer.disconnect(); });
    chartObservers = [];
    var body = '';
    if (state.statsStatus === 'loading') body = statsSkeletonMarkup();
    else if (state.statsStatus === 'error') body = statsErrorMessage(state.statsError);
    else if (state.statsStatus === 'success' && state.stats) body = state.source === 'mal' && !divisionData() ? state.titles[state.type].status === 'error' ? statsErrorMessage(state.titles[state.type].error) : statsSkeletonMarkup() : statsSuccessMarkup();
    else body = statsVoidMarkup();

    dom.viewStats.classList.toggle('is-static', !animate);
    dom.viewStats.innerHTML = statsCommandMarkup() + body;
    dom.viewStats.setAttribute('aria-busy', state.statsStatus === 'loading' || state.source === 'mal' && state.titles[state.type].status === 'loading' ? 'true' : 'false');
    if (state.statsStatus === 'success' && state.stats) {
      mountStatsCharts(buildChartSpecs(divisionData()), animate);
    }
    if (state.statsStatus === 'error' && state.statsError && state.statsError.kind === 'rate') {
      startRateLimitCountdowns(dom.viewStats);
    }
    if (state.genre && genreFocus) {
      var focusTarget = genreFocusKey ? $('[data-genre-filter="' + genreFocusKey + '"]')
        : genreFocusClose ? $('[data-action="close-genre"]') : document.getElementById(genreFocusId);
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    } else if (focusedGenre) {
      var genreRow = $all('[data-genre]').find(function (row) { return row.getAttribute('data-genre') === focusedGenre; });
      if (genreRow) genreRow.focus({ preventScroll: true });
    }
    updateDocumentTitle();
  }

  function freshTitlesBucket () {
    return { status: 'idle', entries: [], rows: [], error: null, retryAt: 0, chunk: 0, seq: 0 };
  }

  function resetTitles () {
    state.discover.seq += 1;
    state.discover.status = 'idle';
    state.discover.rows = [];
    state.titles = { ANIME: freshTitlesBucket(), MANGA: freshTitlesBucket() };
  }

  function parseTitleEntries (data, type) {
    var lists = data && data.MediaListCollection && Array.isArray(data.MediaListCollection.lists)
      ? data.MediaListCollection.lists
      : [];
    var byId = new Map();
    lists.forEach(function (list) {
      if (!list || !Array.isArray(list.entries)) return;
      list.entries.forEach(function (entry) {
        if (!entry || !entry.media) return;
        var media = entry.media;
        var id = safeInteger(media.id);
        var progress = Number(entry.progress);
        progress = Number.isFinite(progress) ? Math.max(0, Math.round(progress)) : 0;
        if (!id) return;
        var total = type === 'MANGA' ? Number(media.chapters) : Number(media.episodes);
        var row = {
          id: id,
          source: media.source === 'mal' ? 'mal' : 'anilist',
          title: mediaTitle(media),
          searchText: [media.title && media.title.romaji, media.title && media.title.english, media.title && media.title.native].filter(Boolean).join(' ').toLowerCase(),
          cover: safeImageUrl(media.coverImage && media.coverImage.large),
          progress: progress,
          score: Number(entry.score) > 0 && Number(entry.score) <= 100 ? Number(entry.score) : null,
          duration: safeInteger(media.duration),
          total: Number.isFinite(total) && total > 0 ? total : null,
          format: typeof media.format === 'string' ? media.format : '',
          status: typeof entry.status === 'string' ? entry.status : '',
          year: safeInteger(media.startDate && media.startDate.year),
          startYear: safeInteger(entry.startYear),
          volumesRead: Number.isFinite(entry.volumesRead) ? entry.volumesRead : null,
          genres: Array.isArray(media.genres) ? media.genres.filter(function (genre) { return typeof genre === 'string'; }) : []
        };
        var existing = byId.get(id);
        if (!existing || row.progress > existing.progress) byId.set(id, row);
      });
    });
    return Array.from(byId.values());
  }

  /* ── genre drill-down ──────────────────────────────────────── */

  function genrePanelMarkup () {
    var genre = state.genre;
    var bucket = state.titles[state.type];
    var entries = bucket.entries.filter(function (entry) { return entry.genres.indexOf(genre.name) !== -1; });
    var ready = bucket.status === 'ready';
    var count = ready ? plural(entries.length, 'public title') : bucket.status === 'error' ? 'Public titles unavailable' : 'Loading public titles';
    var body;
    if (!ready) {
      body = '<p class="genre-message" role="status">' + (bucket.status === 'error' ? 'Public titles unavailable.' : 'Loading public titles…') + '</p>';
    } else if (!entries.length) {
      body = '<p class="genre-message" role="status">No public titles in this genre.</p>';
    } else {
      var statuses = Array.from(new Set(entries.map(function (entry) { return entry.status; }).filter(Boolean))).sort();
      var formats = Array.from(new Set(entries.map(function (entry) { return entry.format; }).filter(Boolean))).sort();
      var filterMarkup = function (key, label, values, labelFn) {
        return '<label class="genre-filter">' + esc(label) + '<select data-genre-filter="' + escAttr(key) + '">' +
          values.map(function (value) {
            return '<option value="' + escAttr(value) + '"' + (genre[key] === value ? ' selected' : '') + '>' + esc(labelFn(value)) + '</option>';
          }).join('') + '</select></label>';
      };
      var rows = entries.filter(function (entry) {
        return (genre.status === 'ALL' || entry.status === genre.status) && (genre.format === 'ALL' || entry.format === genre.format);
      }).sort(function (a, b) {
        if (genre.sort === 'TITLE') return a.title.localeCompare(b.title);
        return (genre.sort === 'YEAR' ? (b.year || 0) - (a.year || 0) : b.progress - a.progress) || a.title.localeCompare(b.title);
      });
      body = '<div class="genre-filters">' +
        filterMarkup('status', 'STATUS', ['ALL'].concat(statuses), labelize) +
        filterMarkup('format', 'FORMAT', ['ALL'].concat(formats), formatLabel) +
        filterMarkup('sort', 'SORT', ['PROGRESS', 'TITLE', 'YEAR'], labelize) +
        '</div><p class="genre-result-count" role="status">' + esc(plural(rows.length, 'title')) + '</p>' +
        (rows.length ? '<ul class="genre-title-list" tabindex="0" aria-label="' + escAttr(genre.name + ' titles') + '">' + rows.map(function (entry) {
          return '<li class="genre-title-row" data-media-id="' + escAttr(entry.id) + '">' +
            artworkMarkup(entry.cover, 'genre-art') +
            '<div class="genre-title-copy"><h3><a href="' + entryLink(entry) + '" target="_blank" rel="noopener noreferrer">' + esc(entry.title) + '</a></h3><p class="genre-title-meta">' + esc(formatLabel(entry.format)) + ' / ' + esc(entry.year || '—') + '</p></div>' +
            '<span class="genre-title-progress">' + esc(formatNumber(entry.progress)) + (entry.total === null ? '' : ' / ' + esc(formatNumber(entry.total))) + ' ' + (state.type === 'MANGA' ? 'CH' : 'EP') + '</span>' +
            '<span class="genre-title-status">' + esc(labelize(entry.status)) + '</span></li>';
        }).join('') + '</ul>' : '<p class="genre-message">No titles match this filter.</p>');
    }
    return '<section class="genre-panel" aria-labelledby="genrePanelTitle" aria-busy="' + (bucket.status === 'loading' ? 'true' : 'false') + '">' +
      '<header class="genre-panel-head"><div><p class="spec-label">GENRE / ' + esc(state.type) + '</p>' +
        '<h2 id="genrePanelTitle" tabindex="-1">' + esc(genre.name) + '</h2><p class="genre-public-count">' + esc(count) + '</p></div>' +
        '<button class="btn btn-small" type="button" data-action="close-genre">CLOSE</button></header>' + body + '</section>';
  }

  function renderGenrePanel (focusKey) {
    var host = $('#genreDrilldown');
    if (!host) return;
    host.innerHTML = state.genre ? genrePanelMarkup() : '';
    if (!state.genre) return;
    var target = focusKey ? $('[data-genre-filter="' + focusKey + '"]', host) : $('#genrePanelTitle', host);
    if (target) target.focus(focusKey ? { preventScroll: true } : undefined);
  }

  function openGenre (name, trigger) {
    state.genre = { name: name, status: 'ALL', format: 'ALL', sort: 'PROGRESS' };
    genreTriggerEl = trigger;
    renderGenrePanel();
  }

  function closeGenre () {
    var name = state.genre && state.genre.name;
    state.genre = null;
    renderGenrePanel();
    var trigger = genreTriggerEl && genreTriggerEl.isConnected ? genreTriggerEl
      : $all('[data-genre]').find(function (element) { return element.getAttribute('data-genre') === name; });
    if (trigger) trigger.focus();
    genreTriggerEl = null;
  }

  function titlesSummary (bucket, type) {
    var unit = type === 'MANGA' ? 'chapters' : 'episodes';
    if (!bucket || bucket.status === 'loading') return 'Top titles by ' + unit + '. Loading.';
    if (!bucket.rows.length) return 'Top titles by ' + unit + '. No public title progress available.';
    var top = bucket.rows.slice(0, 3).map(function (row) {
      return row.title + ' ' + formatNumber(row.progress) + ' ' + unit;
    });
    return 'Top titles by ' + unit + ': ' + top.join(', ') + '.';
  }

  async function malFetch (kind, name, type, offset) {
    if (!/^[A-Za-z0-9_-]{2,16}$/.test(name)) throw new ApiError('Enter a MyAnimeList username using 2–16 letters, numbers, underscores or hyphens.');
    if (!/^https?:$/.test(location.protocol)) throw new ApiError('MyAnimeList requires the local server. Start node server.js and open its local address.');
    var url = '/api/mal/' + kind + '?username=' + encodeURIComponent(name) + (kind === 'list' ? '&type=' + type + '&offset=' + offset : '');
    var key = CACHE_PREFIX + 'mal:' + url;
    var cached = readJson(getStorage('session'), key, null);
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
    var response;
    try { response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(40000) }); }
    catch (error) { throw new ApiError('MyAnimeList could not be reached. Check the local server and retry.', { kind: 'network' }); }
    var data;
    try { data = await response.json(); } catch (error) { throw new ApiError('MyAnimeList requires node server.js. The current server did not return MAL data.'); }
    if (!response.ok) throw new ApiError(cleanText(data && data.error, 220) || 'MyAnimeList request failed.', { status: response.status, retryAfter: parseRetryAfter(response.headers.get('retry-after')) });
    if (!data || (kind === 'profile' ? typeof data.name !== 'string' : !Array.isArray(data.lists) || typeof data.hasNextChunk !== 'boolean')) throw new ApiError('MyAnimeList returned incomplete data.');
    writeJson(getStorage('session'), key, { at: Date.now(), data: data });
    return data;
  }

  function malStatistics (entries, type, minutes) {
    var result = { count: entries.length, meanScore: null, scoreScale: 100, scores: [], statuses: [], formats: [], genres: [], releaseYears: [], startYears: [],
      episodesWatched: null, minutesWatched: null, chaptersRead: null, volumesRead: null };
    var scored = entries.filter(function (entry) { return entry.score !== null; });
    if (scored.length) result.meanScore = scored.reduce(function (sum, entry) { return sum + entry.score; }, 0) / scored.length;
    if (type === 'ANIME') { result.episodesWatched = entries.reduce(function (sum, entry) { return sum + entry.progress; }, 0); result.minutesWatched = Number.isFinite(minutes) ? minutes : null; }
    else { result.chaptersRead = entries.reduce(function (sum, entry) { return sum + entry.progress; }, 0); result.volumesRead = entries.every(function (entry) { return entry.volumesRead !== null; }) ? entries.reduce(function (sum, entry) { return sum + entry.volumesRead; }, 0) : null; }
    [['scores', 'score', function (entry) { return entry.score; }], ['statuses', 'status', function (entry) { return entry.status; }], ['formats', 'format', function (entry) { return entry.format; }], ['releaseYears', 'releaseYear', function (entry) { return entry.year; }], ['startYears', 'startYear', function (entry) { return entry.startYear; }]].forEach(function (field) {
      var counts = new Map();
      entries.forEach(function (entry) { var value = field[2](entry); if (value) counts.set(value, (counts.get(value) || 0) + 1); });
      result[field[0]] = Array.from(counts).map(function (pair) { var row = { count: pair[1] }; row[field[1]] = pair[0]; return row; });
    });
    var genres = new Map();
    entries.forEach(function (entry) { entry.genres.forEach(function (name) { var genre = genres.get(name) || { genre: name, count: 0, sum: 0, scored: 0 }; genre.count += 1; if (entry.score !== null) { genre.sum += entry.score; genre.scored += 1; } genres.set(name, genre); }); });
    result.genres = Array.from(genres.values()).map(function (genre) { return { genre: genre.genre, count: genre.count, meanScore: genre.scored ? genre.sum / genre.scored : null }; });
    return result;
  }

  function changeProfileSource (source) {
    if (['anilist', 'mal'].indexOf(source) === -1 || source === state.source) return;
    state.source = source; state.username = ''; state.stats = null; state.statsStatus = 'idle'; state.statsError = null; state.statsSeq += 1;
    state.genre = null; genreTriggerEl = null; resetTitles(); state.library = freshLibrary(state.library.mode);
    saveUiState(); renderProfileView();
    var select = $('[data-profile-source]', state.view === 'library' ? dom.viewLibrary : dom.viewStats);
    if (select) select.focus();
    announce(profileLabel() + ' selected. Enter your public username.');
  }

  async function loadTitles (name, type, bucket, sequence) {
    var source = state.source;
    try {
      var lists = [];
      var chunks = new Set();
      var chunk = 1;
      while (true) {
        var variables = { name: name, type: type, chunk: chunk };
        var data = source === 'mal' ? { MediaListCollection: await malFetch('list', name, type, (chunk - 1) * 300) } : await gql(USER_TITLES_QUERY, variables);
        if (state.titles[type] !== bucket || bucket.seq !== sequence || !state.stats || state.stats.name !== name) return;
        var collection = data && data.MediaListCollection;
        if (!collection || !Array.isArray(collection.lists) || typeof collection.hasNextChunk !== 'boolean') {
          discardCachedQuery(USER_TITLES_QUERY, variables);
          throw new ApiError('AniList returned an incomplete collection.', { kind: 'server' });
        }
        var signature = JSON.stringify(collection.lists);
        if (chunks.has(signature) && collection.hasNextChunk) {
          discardCachedQuery(USER_TITLES_QUERY, variables);
          throw new ApiError('AniList repeated a collection page. Retry to load the complete list.', { kind: 'server' });
        }
        chunks.add(signature);
        lists = lists.concat(collection.lists);
        bucket.chunk = chunk;
        if (!collection.hasNextChunk) break;
        chunk += 1;
        // shortcut: 30,300 MAL titles per division; raise both this guard and the proxy offset cap for larger lists.
        if (source === 'mal' && chunk > 101) throw new ApiError('MyAnimeList list is too large to load completely.');
        if (state.view === 'library' && state.type === type) renderLibrary();
      }
      bucket.entries = parseTitleEntries({ MediaListCollection: { lists: lists } }, type);
      bucket.rows = bucket.entries.filter(function (entry) { return entry.progress > 0; }).sort(function (a, b) {
        return b.progress - a.progress || a.title.localeCompare(b.title);
      }).slice(0, 8);
      bucket.status = 'ready';
      bucket.error = null;
      bucket.retryAt = 0;
      if (source === 'mal') {
        state.stats.statistics[type.toLowerCase()] = malStatistics(bucket.entries, type, state.stats.malMinutes);
        state.statsStatus = 'success';
        state.statsError = null;
      }
      if (state.view === 'stats' && state.statsStatus === 'success' && state.type === type) renderStats(false);
      if (state.view === 'library' && state.type === type) {
        renderLibrary();
        announce(plural(bucket.entries.length, 'public title') + ' loaded.');
      }
      if (state.view === 'radar' && type === 'ANIME' && state.radar.scope === 'MINE') renderRadar();
    } catch (error) {
      if (state.titles[type] !== bucket || bucket.seq !== sequence) return;
      if (!state.stats || state.stats.name !== name) return;
      bucket.status = 'error';
      bucket.error = classifyError(error);
      bucket.retryAt = bucket.error.kind === 'rate' ? Date.now() + bucket.error.retryAfter * 1000 : 0;
      if (source === 'mal' && state.statsStatus === 'loading') { state.statsStatus = 'error'; state.statsError = bucket.error; renderProfileView(); }
      if (state.view === 'stats' && state.statsStatus === 'success' && state.type === type) renderStats(false);
      if (state.view === 'library' && state.type === type) {
        renderLibrary();
        announce('Your collection could not be loaded completely. Retry when available.');
      }
      if (state.view === 'radar' && type === 'ANIME' && state.radar.scope === 'MINE') renderRadar();
    }
  }

  function startTitlesLoad (name, type) {
    var bucket = state.titles[type];
    if (!bucket || bucket.status === 'loading' || bucket.status === 'ready' || Date.now() < bucket.retryAt) return;
    bucket.status = 'loading';
    bucket.entries = [];
    bucket.rows = [];
    bucket.error = null;
    bucket.chunk = 0;
    bucket.seq += 1;
    loadTitles(name, type, bucket, bucket.seq);
  }

  async function loadStats (rawName) {
    var name = cleanText(rawName, 80);
    if (!name) {
      var input = state.view === 'library' ? $('#libraryUsername') : $('#statsUsername');
      if (input) input.focus();
      announce('Enter a ' + profileLabel() + ' username first.');
      showToast('ENTER A ' + profileLabel().toUpperCase() + ' USERNAME');
      return;
    }
    state.username = name;
    state.statsStatus = 'loading';
    state.statsError = null;
    state.stats = null;
    state.library = freshLibrary(state.library.mode);
    state.genre = null;
    genreTriggerEl = null;
    resetTitles();
    state.statsSeq += 1;
    var sequence = state.statsSeq;
    saveUiState();
    renderProfileView();
    announce('Loading ' + profileLabel() + ' record for ' + name + '.');
    try {
      var data;
      if (state.source === 'mal') {
        var profile = await malFetch('profile', name);
        data = { User: { name: profile.name, avatar: { medium: profile.avatar }, bannerImage: null, malMinutes: profile.minutesWatched, statistics: { anime: null, manga: null } } };
      } else data = await gql(USER_STATS_QUERY, { name: name });
      if (sequence !== state.statsSeq) return;
      var user = data && data.User;
      if (!user) {
        state.statsStatus = 'error';
        state.statsError = { kind: 'notfound', status: 404, retryAfter: null, message: 'Not Found' };
        renderProfileView();
        announce('No public ' + profileLabel() + ' profile found for ' + name + '.');
        return;
      }
      state.stats = user;
      if (!user.statistics) {
        state.statsStatus = 'error';
        state.statsError = { kind: 'private', status: 200, retryAfter: null, message: 'Private statistics' };
        if (state.view === 'library' || state.view === 'radar' && state.radar.scope === 'MINE') startTitlesLoad(user.name, state.view === 'radar' ? 'ANIME' : state.type);
        renderProfileView();
        announce('The profile for ' + user.name + ' keeps its statistics private.');
        return;
      }
      state.statsLoadedAt = Date.now();
      state.statsStatus = state.source === 'mal' ? 'loading' : 'success';
      state.statsError = null;
      startTitlesLoad(user.name, state.view === 'radar' && state.radar.scope === 'MINE' ? 'ANIME' : state.type);
      renderProfileView();
      announce('Record loaded for ' + user.name + '. ' + state.type.charAt(0) + state.type.slice(1).toLowerCase() + ' division shown.');
    } catch (error) {
      if (sequence !== state.statsSeq) return;
      state.statsStatus = 'error';
      state.statsError = classifyError(error);
      renderProfileView();
      var label = state.statsError.kind === 'notfound' ? 'No such profile.' : state.statsError.kind === 'private' ? 'Statistics are private.' : 'The record could not be loaded.';
      announce(label);
    }
  }

  /* ── library + planning-list picker ─────────────────────────── */

  function freshLibrary (mode) {
    return { mode: LIBRARY_MODES && LIBRARY_MODES.indexOf(mode) !== -1 ? mode : 'browse', collectionId: null, search: '', status: 'ALL', genre: 'ALL', format: 'ALL', score: 'ALL', year: 'ALL', sort: 'TITLE', page: 1,
      pick: { source: 'ALL', genre: 'ALL', format: 'ALL', mood: 'ALL', limit: 'ALL', id: null } };
  }

  function renderProfileView () {
    if (state.view === 'library') renderLibrary();
    else if (state.view === 'radar') renderRadar();
    else renderStats();
  }

  function librarySelect (key, label, options, pick) {
    var values = pick ? state.library.pick : state.library;
    return '<label class="library-filter" for="' + (pick ? 'pick-' : 'library-') + key + '">' + esc(label) +
      '<select id="' + (pick ? 'pick-' : 'library-') + key + '" data-' + (pick ? 'pick' : 'library') + '-filter="' + key + '">' + options.map(function (option) {
        return '<option value="' + escAttr(option[0]) + '"' + (String(values[key]) === String(option[0]) ? ' selected' : '') + (option[2] ? ' disabled' : '') + '>' + esc(option[1]) + '</option>';
      }).join('') + '</select></label>';
  }

  function libraryOptions (entries, key, labelFn) {
    return [['ALL', 'All ' + key + (key === 'status' ? 'es' : 's')]].concat(Array.from(new Set(entries.reduce(function (values, entry) {
      return values.concat(key === 'genre' ? entry.genres : entry[key] || []);
    }, []))).sort(function (a, b) { return key === 'year' ? b - a : String(a).localeCompare(String(b)); }).map(function (value) {
      return [String(value), labelFn ? labelFn(value) : String(value)];
    }));
  }

  function libraryFilteredEntries () {
    var filters = state.library;
    var search = filters.search.trim().toLowerCase();
    return state.titles[state.type].entries.filter(function (entry) {
      return (!search || entry.searchText.indexOf(search) !== -1 || entry.title.toLowerCase().indexOf(search) !== -1) &&
        (filters.status === 'ALL' || entry.status === filters.status) &&
        (filters.genre === 'ALL' || entry.genres.indexOf(filters.genre) !== -1) &&
        (filters.format === 'ALL' || entry.format === filters.format) &&
        (filters.year === 'ALL' || String(entry.year) === filters.year) &&
        (filters.score === 'ALL' || (filters.score === 'SCORED' ? entry.score !== null : filters.score === 'UNSCORED' ? entry.score === null : entry.score !== null && entry.score >= Number(filters.score)));
    }).sort(function (a, b) {
      var difference = filters.sort === 'SCORE' ? (b.score || 0) - (a.score || 0) : filters.sort === 'YEAR' ? (b.year || 0) - (a.year || 0) : filters.sort === 'PROGRESS' ? b.progress - a.progress : 0;
      return difference || a.title.localeCompare(b.title) || a.id - b.id;
    });
  }

  function libraryCardsMarkup (rows) {
    return '<ul class="library-grid">' + rows.map(function (entry) {
      return '<li class="library-card" data-media-id="' + entry.id + '"><a class="library-card-link" href="' + entryLink(entry) + '" target="_blank" rel="noopener noreferrer" aria-labelledby="library-title-' + entry.id + '" aria-describedby="library-details-' + entry.id + '">' +
        artworkMarkup(entry.cover, 'library-art') + '<div class="library-card-copy"><p class="library-card-meta">' + esc(formatLabel(entry.format)) + ' · ' + esc(entry.year || '—') + '</p>' +
        '<h2 id="library-title-' + entry.id + '">' + esc(entry.title) + '</h2><div id="library-details-' + entry.id + '"><div class="library-card-status"><span>' + esc(labelize(entry.status)) + '</span><span>' + (entry.score === null ? 'Unscored' : esc(formatMean(entry.score)) + '/100') + '</span></div>' +
        '<p class="library-progress">' + formatNumber(entry.progress) + (entry.total === null ? '' : ' / ' + formatNumber(entry.total)) + ' ' + (state.type === 'MANGA' ? 'CH' : 'EP') + '</p></div></div></a>' + collectionAddButton(entry, state.type) + '</li>';
    }).join('') + '</ul>';
  }

  function libraryBrowseMarkup (entries) {
    return '<div class="library-filters"><label class="library-filter library-search" for="librarySearch">TITLE SEARCH<input id="librarySearch" type="search" placeholder="Search your collection" value="' + escAttr(state.library.search) + '" autocomplete="off"></label>' +
      librarySelect('status', 'STATUS', libraryOptions(entries, 'status', labelize)) +
      librarySelect('genre', 'GENRE', libraryOptions(entries, 'genre')) +
      librarySelect('format', 'FORMAT', libraryOptions(entries, 'format', formatLabel)) +
      librarySelect('year', 'RELEASE YEAR', libraryOptions(entries, 'year')) +
      librarySelect('score', 'YOUR SCORE /100', [['ALL', 'All scores'], ['SCORED', 'Scored only'], ['UNSCORED', 'Unscored only'], ['90', '90 and above'], ['80', '80 and above'], ['70', '70 and above'], ['60', '60 and above']]) +
      librarySelect('sort', 'SORT', [['TITLE', 'Title A–Z'], ['SCORE', 'Your score'], ['YEAR', 'Newest release'], ['PROGRESS', 'Most progress']]) +
      '</div><div id="libraryResults"></div>';
  }

  function renderLibraryResults (focus) {
    var host = $('#libraryResults');
    if (!host) return;
    var rows = libraryFilteredEntries();
    var pageSize = 48;
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.library.page = clamp(state.library.page, 1, pages);
    var start = (state.library.page - 1) * pageSize;
    host.innerHTML = '<div class="library-results-head"><p id="libraryResultTitle" tabindex="-1" role="status">' + (rows.length ? 'Showing ' + (start + 1) + '–' + Math.min(start + pageSize, rows.length) + ' of ' + plural(rows.length, 'title') : '0 titles') + '</p>' +
      '<button class="text-btn" type="button" data-action="library-reset">CLEAR FILTERS</button></div>' +
      (rows.length ? libraryCardsMarkup(rows.slice(start, start + pageSize)) : '<div class="library-empty"><h2>No titles match.</h2><p>Try another search or clear your filters.</p></div>') +
      (pages > 1 ? '<nav class="library-pagination" aria-label="Library pages"><button class="btn" type="button" data-action="library-prev" aria-label="Previous page"' + (state.library.page === 1 ? ' disabled' : '') + '>PREVIOUS</button><span>Page ' + state.library.page + ' of ' + pages + '</span><button class="btn" type="button" data-action="library-next" aria-label="Next page"' + (state.library.page === pages ? ' disabled' : '') + '>NEXT</button></nav>' : '');
    if (focus) $('#libraryResultTitle').focus();
  }

  var PICK_MOODS = {
    LIGHT: ['Comedy', 'Slice of Life'],
    ACTION: ['Action', 'Adventure'],
    DRAMA: ['Drama', 'Psychological', 'Mystery'],
    FANTASY: ['Fantasy', 'Supernatural', 'Sci-Fi']
  };

  function pickSourceEntries () {
    var entries = state.titles[state.type].entries;
    return state.library.pick.source === 'PLANNING' ? entries.filter(function (entry) { return entry.status === 'PLANNING'; }) : entries;
  }

  function pickCandidates (moodOverride) {
    var filters = state.library.pick;
    var mood = moodOverride === undefined ? filters.mood : moodOverride;
    return pickSourceEntries().filter(function (entry) {
      var length = state.type === 'MANGA' ? entry.total : entry.duration;
      return (filters.genre === 'ALL' || entry.genres.indexOf(filters.genre) !== -1) &&
        (filters.format === 'ALL' || entry.format === filters.format) &&
        (mood === 'ALL' || (PICK_MOODS[mood] || []).some(function (genre) { return entry.genres.indexOf(genre) !== -1; })) &&
        (filters.limit === 'ALL' || length !== null && length <= Number(filters.limit));
    });
  }

  function pickerMarkup (entries) {
    var pool = pickSourceEntries();
    var moods = [['ALL', 'Any mood'], ['LIGHT', 'Light & funny'], ['ACTION', 'Action & adventure'], ['DRAMA', 'Thoughtful & dramatic'], ['FANTASY', 'Fantasy escape']].map(function (option) {
      var count = pickCandidates(option[0]).length;
      return [option[0], option[1] + ' (' + count + ')', option[0] !== 'ALL' && count === 0];
    });
    return '<section class="picker-panel" aria-label="Title picker"><div class="picker-intro"><h2>Your next ' + (state.type === 'MANGA' ? 'read' : 'watch') + ' starts here.</h2><p>Pick from your library or planning list. Mood matches use genres in your list.</p></div>' +
      '<div class="library-filters picker-filters">' + librarySelect('source', 'PICK FROM', [['ALL', 'My whole library (' + entries.length + ')'], ['PLANNING', 'Planning list (' + entries.filter(function (entry) { return entry.status === 'PLANNING'; }).length + ')']], true) + librarySelect('genre', 'GENRE', libraryOptions(pool, 'genre'), true) + librarySelect('format', 'FORMAT', libraryOptions(pool, 'format', formatLabel), true) +
      librarySelect('mood', 'MOOD', moods, true) +
      librarySelect('limit', state.type === 'MANGA' ? 'MAXIMUM CHAPTERS' : 'TIME PER EPISODE / FILM', state.type === 'MANGA' ? [['ALL', 'Any length'], ['10', 'Up to 10 chapters'], ['50', 'Up to 50 chapters'], ['100', 'Up to 100 chapters']] : [['ALL', 'Any length'], ['15', 'Up to 15 minutes'], ['30', 'Up to 30 minutes'], ['60', 'Up to 60 minutes'], ['120', 'Up to 120 minutes']], true) +
      '</div><div id="pickerResult"></div></section>';
  }

  function renderPickerResult (focus) {
    var host = $('#pickerResult');
    if (!host) return;
    var rows = pickCandidates();
    var picked = rows.find(function (entry) { return entry.id === state.library.pick.id; });
    var planned = state.library.pick.source === 'PLANNING';
    var poolCount = pickSourceEntries().length;
    var useLibrary = planned && !poolCount;
    var recover = !rows.length && poolCount > 0;
    host.innerHTML = '<div class="picker-actions"><div><p class="spec-label" role="status">' + plural(rows.length, planned ? 'matching planned title' : 'matching title') + '</p>' +
      (state.library.pick.limit !== 'ALL' ? '<p class="picker-note">Titles with unknown lengths are excluded.</p>' : '') + '</div><button class="btn btn-primary" type="button" data-action="' + (useLibrary ? 'pick-library' : recover ? 'pick-unfiltered' : 'pick-title') + '"' + (!rows.length && !recover && !useLibrary ? ' disabled' : '') + '>' + (useLibrary ? 'PICK FROM MY LIBRARY' : recover ? 'CLEAR FILTERS & PICK' : picked ? 'PICK AGAIN' : 'PICK FOR ME') + '</button><button class="text-btn" type="button" data-action="library-reset">RESET FILTERS</button></div>' +
      (picked ? '<article class="picked-title" data-media-id="' + picked.id + '">' + artworkMarkup(picked.cover, 'picked-art') + '<div class="picked-copy"><p class="spec-label">FROM YOUR ' + (planned ? 'PLANNING LIST' : 'LIBRARY') + '</p><h2 id="pickedTitle" tabindex="-1">' + esc(picked.title) + '</h2><p class="picked-meta">' + esc(labelize(picked.status)) + ' · ' + esc(formatLabel(picked.format)) + ' · ' + esc(picked.year || 'Year unknown') + ' · ' + (state.type === 'MANGA' ? picked.total === null ? 'Chapter count unknown' : plural(picked.total, 'chapter') : picked.duration === null ? 'Duration unknown' : picked.duration + ' min ' + (picked.format === 'MOVIE' ? 'film' : 'per episode')) + '</p><p class="picked-genres">' + esc(picked.genres.join(' · ')) + '</p><a class="btn" href="' + entryLink(picked) + '" target="_blank" rel="noopener noreferrer">OPEN ON ' + (picked.source === 'mal' ? 'MYANIMELIST' : 'ANILIST') + '</a></div></article>' :
        '<div class="picker-waiting">' + (rows.length ? '<div class="picker-preview" aria-hidden="true">' + rows.slice(0, 3).map(function (entry) { return artworkMarkup(entry.cover, ''); }).join('') + '</div><h3>Leave the choice to chance.</h3><p>One pick from ' + plural(rows.length, planned ? 'planned title' : 'title') + ' that fits your filters.</p>' : '<h3>' + (useLibrary ? 'Your planning list is empty.' : planned ? 'No planned titles match.' : 'No titles match.') + '</h3><p>' + (useLibrary ? 'Pick from your whole library instead, or add titles to Planning on ' + profileLabel() + '.' : 'Clear the filters to pick from your ' + plural(poolCount, planned ? 'planned title' : 'title') + '.') + '</p>') + '</div>');
    if (focus && picked) { $('#pickedTitle').focus(); announce('Picked ' + picked.title + ' from your ' + (planned ? 'planning list.' : 'library.')); }
  }

  function drawLibraryPick () {
    var rows = pickCandidates();
    if (rows.length > 1) rows = rows.filter(function (entry) { return entry.id !== state.library.pick.id; });
    if (!rows.length) {
      var waiting = $('.picker-waiting', dom.viewLibrary);
      if (waiting) {
        var heading = $('h3', waiting);
        heading.setAttribute('tabindex', '-1');
        heading.focus();
        announce(waiting.textContent);
      }
      return;
    }
    state.library.pick.id = rows[Math.floor(Math.random() * rows.length)].id;
    renderPickerResult(true);
  }

  function renderLibrary () {
    if (!dom.viewLibrary) return;
    var focusId = dom.viewLibrary.contains(document.activeElement) ? document.activeElement.id : '';
    var selection = focusId === 'librarySearch' ? document.activeElement.selectionStart : null;
    var bucket = state.titles[state.type];
    var profileReady = state.stats && (state.statsStatus === 'success' || state.statsStatus === 'error' && state.statsError && state.statsError.kind === 'private');
    var body;
    if (state.library.mode === 'seasons') body = seasonalMarkup();
    else if (state.statsStatus === 'loading') body = '<div class="library-empty" role="status"><span class="skeleton library-loading"></span><p>Loading your profile…</p></div>';
    else if (!profileReady) body = state.statsStatus === 'error' ? statsErrorMessage(state.statsError) : '<div class="library-empty"><h2>Your collection, in one place.</h2><p>Load a public ' + profileLabel() + ' username to browse its library or pick a title.</p></div>';
    else if (state.library.mode === 'collections') body = collectionsMarkup();
    else if (bucket.status === 'loading' || bucket.status === 'idle') body = '<div class="library-empty" role="status"><span class="skeleton library-loading"></span><p>Loading your complete collection' + (bucket.chunk ? ' · ' + plural(bucket.chunk, 'batch') + ' loaded' : '') + '…</p></div>';
    else if (bucket.status === 'error') {
      var wait = Math.max(0, Math.ceil((bucket.retryAt - Date.now()) / 1000));
      body = '<div class="library-empty"' + (wait ? ' data-rate-block data-rate-seconds="' + wait + '"' : '') + '><h2>Collection unavailable.</h2><p>' + (wait ? '' + profileLabel() + ' rate limited. Retry in <span data-rate-countdown>' + formatCountdown(wait) + '</span>.' : 'The public list could not be loaded completely. Private entries are unavailable.') + '</p><button class="btn" type="button" data-action="retry-library"' + (wait ? ' data-rate-button data-retry-label="RETRY COLLECTION" disabled' : '') + '>RETRY COLLECTION</button></div>';
    } else if (!bucket.entries.length) body = '<div class="library-empty"><h2>No public titles.</h2><p>This ' + state.type.toLowerCase() + ' collection is empty or private.</p></div>';
    else body = state.library.mode === 'pick' ? pickerMarkup(bucket.entries) : state.library.mode === 'discover' ? discoverMarkup() : libraryBrowseMarkup(bucket.entries);
    dom.viewLibrary.innerHTML = (state.library.mode === 'seasons' ? '' : statsCommandMarkup(true)) + '<header class="library-head"><div><p class="spec-label">' + (state.library.mode === 'seasons' ? 'ANIME / BY SEASON' : profileReady ? esc(state.stats.name) + ' / ' + esc(state.type) : 'YOUR COLLECTION') + '</p><h1>' + LIBRARY_LABELS[state.library.mode] + '</h1><p class="library-subtitle">' + (state.library.mode === 'seasons' ? 'Explore a season. Find your next series.' : profileReady && bucket.status === 'ready' ? plural(bucket.entries.length, 'public title') + ' · ' + formatNumber(bucket.entries.filter(function (entry) { return entry.status === 'PLANNING'; }).length) + ' planned' : 'Anime and manga from your public ' + profileLabel() + ' collection.') + '</p></div><div class="library-tools" role="group" aria-label="Library tools">' + LIBRARY_MODES.map(function (mode) { return '<button class="btn" type="button" data-library-mode="' + mode + '" aria-pressed="' + (state.library.mode === mode) + '">' + ({ browse: 'BROWSE', pick: 'PICK FOR ME', discover: 'DISCOVER', seasons: 'SEASONS', collections: 'COLLECTIONS' })[mode] + '</button>'; }).join('') + '</div></header>' + body;
    dom.viewLibrary.setAttribute('aria-busy', (state.library.mode === 'seasons' ? state.catalog.status === 'loading' : state.statsStatus === 'loading' || bucket.status === 'loading' || state.library.mode === 'discover' && state.discover.status === 'loading') ? 'true' : 'false');
    if ($('#libraryResults')) renderLibraryResults();
    if ($('#pickerResult')) renderPickerResult();
    startRateLimitCountdowns(dom.viewLibrary);
    var focus = focusId && document.getElementById(focusId);
    if (focus) { focus.focus({ preventScroll: true }); if (selection !== null && focus.setSelectionRange) focus.setSelectionRange(selection, selection); }
    updateDocumentTitle();
    if (state.library.mode === 'discover' && profileReady && bucket.status === 'ready' && bucket.entries.length && state.discover.status === 'idle') startDiscover();
  }

  /* ── discovery + seasonal catalog ──────────────────────────── */

  function freshCatalog () {
    var now = new Date();
    return { status: 'idle', rows: [], genres: [], error: null, retryAt: 0, seq: 0, page: 1, hasNext: false,
      season: ['WINTER', 'SPRING', 'SUMMER', 'FALL'][Math.floor(now.getMonth() / 3)], year: now.getFullYear(), genre: 'ALL', format: 'ALL', score: 'ALL', sort: 'POPULARITY_DESC' };
  }

  function catalogEntry (media) {
    if (!media || !safeInteger(media.id) || ['ANIME', 'MANGA'].indexOf(media.type) === -1) return null;
    return { id: safeInteger(media.id), idMal: safeInteger(media.idMal), type: media.type, title: mediaTitle(media), cover: safeImageUrl(media.coverImage && media.coverImage.large),
      format: cleanText(media.format, 30), year: safeInteger(media.startDate && media.startDate.year),
      averageScore: Number.isFinite(media.averageScore) && media.averageScore > 0 && media.averageScore <= 100 ? media.averageScore : null,
      genres: Array.isArray(media.genres) ? media.genres.filter(function (genre) { return typeof genre === 'string'; }) : [], isAdult: media.isAdult === true };
  }

  function catalogCards (rows) {
    return '<ul class="library-grid catalog-grid">' + rows.map(function (entry) {
      return '<li class="library-card" data-media-id="' + entry.id + '"><a class="library-card-link" href="' + entryLink(entry, entry.type) + '" target="_blank" rel="noopener noreferrer">' + artworkMarkup(entry.cover, 'library-art') + '<div class="library-card-copy"><p class="library-card-meta">' + esc(formatLabel(entry.format)) + ' / ' + esc(entry.year || '—') + '</p><h2>' + esc(entry.title) + '</h2><p class="catalog-score">' + (entry.averageScore === null ? 'Not scored yet' : entry.averageScore + '/100 average') + '</p>' + (entry.reason ? '<p class="catalog-reason" title="' + escAttr(entry.reason) + '">' + esc(entry.reason) + '</p>' : '') + '</div></a>' + collectionAddButton(entry, entry.type) + '</li>';
    }).join('') + '</ul>';
  }

  function featureErrorMarkup (feature, action) {
    var wait = Math.max(0, Math.ceil((feature.retryAt - Date.now()) / 1000));
    return '<div class="library-empty" role="status"' + (wait ? ' data-rate-block data-rate-seconds="' + wait + '"' : '') + '><h2>' + (wait ? 'AniList rate limited.' : 'Titles could not be loaded.') + '</h2><p>' + (wait ? 'Try again in <span data-rate-countdown>' + formatCountdown(wait) + '</span>.' : 'Check your connection and try again.') + '</p><button class="btn" type="button" data-action="' + action + '"' + (wait ? ' data-rate-button data-retry-label="TRY AGAIN" disabled' : '') + '>TRY AGAIN</button></div>';
  }

  function catalogSelect (key, label, options) {
    return '<label class="library-filter">' + label + '<select name="' + key + '" id="catalog-' + key + '">' + options.map(function (option) { return '<option value="' + escAttr(option[0]) + '"' + (String(state.catalog[key]) === String(option[0]) ? ' selected' : '') + '>' + esc(option[1]) + '</option>'; }).join('') + '</select></label>';
  }

  function seasonalMarkup () {
    var catalog = state.catalog;
    var filters = '<form id="catalogForm" class="library-filters catalog-filters">' + catalogSelect('season', 'SEASON', [['WINTER', 'Winter'], ['SPRING', 'Spring'], ['SUMMER', 'Summer'], ['FALL', 'Fall']]) + '<label class="library-filter">YEAR<input id="catalog-year" name="year" type="number" min="1900" max="2100" required value="' + catalog.year + '"></label>' +
      catalogSelect('genre', 'GENRE', [['ALL', 'All genres']].concat(catalog.genres.map(function (genre) { return [genre, genre]; }))) + catalogSelect('format', 'FORMAT', [['ALL', 'All formats']].concat(['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'].map(function (format) { return [format, formatLabel(format)]; }))) +
      catalogSelect('score', 'MINIMUM SCORE', [['ALL', 'Any score'], ['70', '70 and above'], ['80', '80 and above'], ['90', '90 and above']]) + catalogSelect('sort', 'SORT', [['POPULARITY_DESC', 'Most popular'], ['SCORE_DESC', 'Highest rated'], ['START_DATE_DESC', 'Newest release']]) + '<button class="btn btn-primary" type="submit">APPLY FILTERS</button></form>';
    if (catalog.status === 'loading' || catalog.status === 'idle') return filters + '<div class="library-empty" role="status"><span class="skeleton library-loading"></span><p>Loading this season…</p></div>';
    if (catalog.status === 'error') return filters + featureErrorMarkup(catalog, 'retry-catalog');
    return filters + '<p class="feature-summary" id="catalogResultsTitle" tabindex="-1" role="status">' + plural(catalog.rows.length, 'title') + ' on page ' + catalog.page + '</p>' + (catalog.rows.length ? catalogCards(catalog.rows) : '<div class="library-empty"><h2>No titles match.</h2><p>Try another season or relax your filters.</p></div>') + '<nav class="library-pagination" aria-label="Season pages"><button class="btn" data-action="catalog-prev"' + (catalog.page === 1 ? ' disabled' : '') + '>PREVIOUS</button><span>Page ' + catalog.page + '</span><button class="btn" data-action="catalog-next"' + (!catalog.hasNext ? ' disabled' : '') + '>NEXT</button></nav>';
  }

  async function startCatalog (force, focus) {
    var catalog = state.catalog;
    if (Date.now() < catalog.retryAt) return;
    var sequence = ++catalog.seq;
    catalog.status = 'loading';
    catalog.error = null;
    renderLibrary();
    try {
      var variables = { page: catalog.page, type: 'ANIME', season: catalog.season, year: catalog.year, genre: catalog.genre === 'ALL' ? null : [catalog.genre], format: catalog.format === 'ALL' ? null : catalog.format, score: catalog.score === 'ALL' ? null : Number(catalog.score) - 1, sort: [catalog.sort], exclude: null };
      var data = await gql(catalogQuery(variables), variables, { force: force });
      if (sequence !== catalog.seq) return;
      if (!data || !data.Page || !Array.isArray(data.Page.media) || typeof (data.Page.pageInfo && data.Page.pageInfo.hasNextPage) !== 'boolean' || !Array.isArray(data.GenreCollection)) throw new ApiError('Unreadable catalog.');
      catalog.rows = data.Page.media.map(catalogEntry).filter(function (entry) { return entry && entry.type === 'ANIME' && !entry.isAdult; });
      catalog.genres = data.GenreCollection.filter(function (genre) { return typeof genre === 'string'; }).sort();
      catalog.hasNext = data.Page.pageInfo.hasNextPage;
      catalog.status = 'ready';
      catalog.retryAt = 0;
    } catch (error) {
      if (sequence !== catalog.seq) return;
      catalog.status = 'error'; catalog.error = classifyError(error);
      catalog.retryAt = catalog.error.kind === 'rate' ? Date.now() + catalog.error.retryAfter * 1000 : 0;
    }
    if (state.view === 'library' && state.library.mode === 'seasons') {
      renderLibrary();
      if (focus && $('#catalogResultsTitle')) $('#catalogResultsTitle').focus();
      announce(catalog.status === 'ready' ? plural(catalog.rows.length, 'seasonal title') + ' loaded.' : 'Seasonal titles could not be loaded.');
    }
  }

  function discoverMarkup () {
    var discover = state.discover;
    if (discover.status === 'idle' || discover.status === 'loading') return '<div class="library-empty" role="status"><span class="skeleton library-loading"></span><p>Finding titles for your taste…</p></div>';
    if (discover.status === 'error') return featureErrorMarkup(discover, 'retry-discover');
    return '<p class="feature-summary">' + esc(discover.summary) + ' Titles already in your library are excluded.</p>' + (discover.rows.length ? catalogCards(discover.rows) : '<div class="library-empty"><h2>No new matches yet.</h2><p>Rate more titles on ' + profileLabel() + ', or explore a season for something different.</p><button class="btn" data-library-mode="seasons">EXPLORE SEASONS</button></div>');
  }

  async function startDiscover (force) {
    var discover = state.discover;
    if (discover.status === 'loading' || Date.now() < discover.retryAt || !state.stats || state.titles[state.type].status !== 'ready') return;
    var sequence = ++discover.seq, type = state.type;
    var entries = state.titles[type].entries;
    var mal = state.source === 'mal';
    var known = new Set(entries.filter(function (entry) { return entry.source !== 'mal'; }).map(function (entry) { return entry.id; }));
    var knownMal = new Set(entries.filter(function (entry) { return entry.source === 'mal'; }).map(function (entry) { return entry.id; }));
    var seeds = entries.filter(function (entry) { return entry.score !== null; }).sort(function (a, b) { return b.score - a.score || a.id - b.id; }).slice(0, 3);
    var weights = {};
    entries.forEach(function (entry) { entry.genres.forEach(function (genre) { weights[genre] = (weights[genre] || 0) + (entry.score === null ? 0.25 : entry.score / 100); }); });
    var genres = Object.keys(weights).sort(function (a, b) { return weights[b] - weights[a] || a.localeCompare(b); }).slice(0, 3);
    discover.status = 'loading'; discover.error = null; discover.rows = [];
    renderLibrary();
    try {
      var matches = new Map();
      function add (media, rank, reason) {
        var entry = catalogEntry(media);
        if (!entry || entry.type !== type || entry.isAdult || known.has(entry.id) || knownMal.has(entry.idMal)) return;
        rank += entry.genres.filter(function (genre) { return genres.indexOf(genre) !== -1; }).length * 2;
        var existing = matches.get(entry.id);
        if (!existing || existing.rank < rank) { entry.rank = rank; entry.reason = reason; matches.set(entry.id, entry); }
      }
      if (seeds.length) {
        var data = await gql(mal ? DISCOVER_QUERY.replace('media(id_in:', 'media(idMal_in:') : DISCOVER_QUERY, { ids: seeds.map(function (entry) { return entry.id; }), type: type }, { force: force });
        if (sequence !== discover.seq) return;
        if (!data || !data.Page || !Array.isArray(data.Page.media)) throw new ApiError('Unreadable recommendations.');
        data.Page.media.forEach(function (media) {
          var seed = seeds.find(function (entry) { return media && entry.id === (mal ? media.idMal : media.id); });
          if (!seed || !media.recommendations || !Array.isArray(media.recommendations.nodes)) return;
          media.recommendations.nodes.forEach(function (node) { if (node) add(node.mediaRecommendation, (Number(node.rating) || 0) + seed.score / 5, 'Because you rated ' + seed.title + ' ' + formatMean(seed.score) + '/100'); });
        });
      }
      if (matches.size < 12 && genres.length) {
        if (mal) {
          var vocabulary = await gql('query DiscoverGenres { GenreCollection }', {}, { force: force });
          if (sequence !== discover.seq) return;
          if (!vocabulary || !Array.isArray(vocabulary.GenreCollection)) throw new ApiError('Unreadable genre catalog.');
          genres = genres.filter(function (genre) { return vocabulary.GenreCollection.indexOf(genre) !== -1; });
        }
      }
      if (matches.size < 12 && genres.length) {
        var variables = { page: 1, type: type, season: null, year: null, genre: [genres[0]], format: null, score: null, sort: ['SCORE_DESC', 'POPULARITY_DESC'], exclude: Array.from(known) };
        var fallback = await gql(catalogQuery(variables), variables, { force: force });
        if (sequence !== discover.seq) return;
        if (!fallback || !fallback.Page || !Array.isArray(fallback.Page.media)) throw new ApiError('Unreadable genre recommendations.');
        fallback.Page.media.forEach(function (media) {
          var shared = media && Array.isArray(media.genres) ? genres.filter(function (genre) { return media.genres.indexOf(genre) !== -1; }) : [];
          if (shared.length) add(media, shared.length * 3, 'Matches your taste for ' + shared.join(' and '));
        });
      }
      discover.rows = Array.from(matches.values()).sort(function (a, b) { return b.rank - a.rank || (b.averageScore || 0) - (a.averageScore || 0); }).slice(0, 24);
      discover.summary = seeds.length ? 'Based on your ' + plural(seeds.length, 'highest-rated title') + (genres.length ? ' and favorite genres.' : '.') : 'Based on the genres in your library. Rate titles on ' + profileLabel() + ' for more personal picks.';
      discover.status = 'ready'; discover.retryAt = 0;
    } catch (error) {
      if (sequence !== discover.seq) return;
      discover.status = 'error'; discover.error = classifyError(error);
      discover.retryAt = discover.error.kind === 'rate' ? Date.now() + discover.error.retryAfter * 1000 : 0;
    }
    if (state.view === 'library' && state.library.mode === 'discover' && state.type === type) { renderLibrary(); announce(discover.status === 'ready' ? plural(discover.rows.length, 'recommendation') + ' loaded.' : 'Recommendations could not be loaded.'); }
  }

  /* ── browser-local collections ─────────────────────────────── */

  function loadCollections () {
    var raw = readJson(getStorage('local'), COLLECTIONS_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (group) { return group && typeof group.id === 'string' && cleanText(group.id, 100) && cleanText(group.name, 60) && typeof group.owner === 'string' && Array.isArray(group.items); }).map(function (group) {
      var seen = new Set();
      return { id: cleanText(group.id, 100), owner: cleanText(group.owner, 80).toLowerCase(), name: cleanText(group.name, 60), items: group.items.filter(function (entry) {
        var key = entry && (entry.source === 'mal' ? 'mal:' : 'anilist:') + entry.type + ':' + safeInteger(entry.id);
        if (!entry || !safeInteger(entry.id) || ['ANIME', 'MANGA'].indexOf(entry.type) === -1 || seen.has(key)) return false;
        seen.add(key); return true;
      }).map(function (entry) { return { id: safeInteger(entry.id), source: entry.source === 'mal' ? 'mal' : 'anilist', type: entry.type, title: cleanText(entry.title, 500) || 'Untitled', cover: safeImageUrl(entry.cover), format: cleanText(entry.format, 30), year: safeInteger(entry.year) }; }) };
    });
  }

  function myCollections () {
    return state.stats ? state.collections.filter(function (group) { return group.owner === collectionOwner(); }) : [];
  }

  function persistCollections (next) {
    if (!writeJson(getStorage('local'), COLLECTIONS_KEY, next)) { showToast('SAVE FAILED / BROWSER STORAGE UNAVAILABLE'); announce('Your collection was not changed because browser storage is unavailable.'); return false; }
    state.collections = next;
    return true;
  }

  function collectionAddButton (entry, type) {
    return '<button class="text-btn collection-add" type="button" data-action="collection-add" data-collection-media="' + entry.id + '" data-collection-source="' + (entry.source || 'anilist') + '" data-collection-type="' + type + '" aria-label="' + escAttr('Save ' + entry.title + ' to a collection') + '">SAVE TO COLLECTION</button>';
  }

  function collectionsMarkup () {
    var groups = myCollections();
    var selected = groups.find(function (group) { return group.id === state.library.collectionId; }) || groups[0];
    if (selected) state.library.collectionId = selected.id;
    var header = '<div class="collections-head"><p>Personal groups saved in this browser, under your ' + profileLabel() + ' profile. They do not change your lists.</p><button class="btn btn-primary" data-action="collection-create">NEW COLLECTION</button></div>';
    if (!selected) return header + '<div class="library-empty"><h2>A place for your favorites.</h2><p>Create a collection, then save titles from Browse, Discover or Seasons.</p></div>';
    var rows = selected.items.filter(function (entry) { return entry.type === state.type; });
    return header + '<div class="collections-toolbar"><label class="library-filter">COLLECTION<select id="collectionSelect">' + groups.map(function (group) { return '<option value="' + escAttr(group.id) + '"' + (group.id === selected.id ? ' selected' : '') + '>' + esc(group.name) + ' (' + group.items.length + ')</option>'; }).join('') + '</select></label><button class="btn" data-action="collection-rename" data-collection-id="' + escAttr(selected.id) + '">RENAME</button><button class="btn btn-danger" data-action="collection-delete" data-collection-id="' + escAttr(selected.id) + '">DELETE</button></div>' +
      '<p class="feature-summary">' + esc(selected.name) + ' / ' + plural(rows.length, state.type === 'ANIME' ? 'anime title' : 'manga title') + ' / ' + plural(selected.items.length, 'title') + ' total</p>' + (rows.length ? '<ul class="library-grid">' + rows.map(function (entry) { return '<li class="library-card"><a class="library-card-link" href="' + entryLink(entry, entry.type) + '" target="_blank" rel="noopener noreferrer">' + artworkMarkup(entry.cover, 'library-art') + '<div class="library-card-copy"><h2>' + esc(entry.title) + '</h2><p class="library-card-meta">' + esc(formatLabel(entry.format)) + ' / ' + esc(entry.year || '—') + '</p></div></a><button class="text-btn collection-add" data-action="collection-remove" data-collection-id="' + escAttr(selected.id) + '" data-collection-media="' + entry.id + '" data-collection-source="' + (entry.source || 'anilist') + '" data-collection-type="' + entry.type + '">REMOVE</button></li>'; }).join('') + '</ul>' : '<div class="library-empty"><h2>No ' + state.type.toLowerCase() + ' titles here yet.</h2><p>Save a title to this collection, or switch the anime/manga division.</p></div>');
  }

  async function manageCollection (action, id, mediaId, type, source) {
    source = source === 'mal' ? 'mal' : 'anilist';
    if (!state.stats) { state.library.mode = 'browse'; switchView('library'); renderLibrary(); syncHeaderUi(); $('#libraryUsername').focus(); showToast('LOAD YOUR ' + profileLabel().toUpperCase() + ' PROFILE FIRST'); return; }
    var owner = collectionOwner();
    var groups = myCollections();
    var group = groups.find(function (entry) { return entry.id === id; });
    var next = state.collections.slice();
    if (action === 'collection-remove' && group) {
      next = next.map(function (entry) { return entry.id === id && entry.owner === owner ? Object.assign({}, entry, { items: entry.items.filter(function (item) { return item.id !== mediaId || item.type !== type || (item.source || 'anilist') !== source; }) }) : entry; });
      if (persistCollections(next)) { renderLibrary(); showToast('TITLE REMOVED'); $('#collectionSelect').focus({ preventScroll: true }); }
      return;
    }
    if (action === 'collection-delete' && group) {
      if (!await askConfirm({ title: 'Delete ' + group.name + '?', body: 'This removes the collection from this browser. Your source library stays unchanged.', confirmLabel: 'DELETE COLLECTION', danger: true })) return;
      if (persistCollections(state.collections.filter(function (entry) { return entry.id !== id || entry.owner !== owner; }))) { renderLibrary(); showToast('COLLECTION DELETED'); $('[data-action="collection-create"]').focus({ preventScroll: true }); }
      return;
    }
    var media = action === 'collection-add' ? state.titles[type].entries.concat(state.discover.rows, state.catalog.rows).find(function (entry) { return entry.id === mediaId && (entry.source || 'anilist') === source && (!entry.type || entry.type === type); }) : null;
    if (action === 'collection-add' && !media) return;
    if (action === 'collection-rename' && !group) return;
    var adding = action === 'collection-add';
    var accepted = await askConfirm({ kicker: 'SAVED IN THIS BROWSER', title: adding ? 'Save to a collection' : group ? 'Rename collection' : 'New collection', bodyHtml:
      (adding && groups.length ? '<label class="library-filter">COLLECTION<select id="collectionTarget">' + groups.map(function (entry) { return '<option value="' + escAttr(entry.id) + '">' + esc(entry.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="library-filter">' + (adding && groups.length ? 'OR CREATE A NEW COLLECTION' : 'COLLECTION NAME') + '<input id="collectionName" maxlength="60"' + (adding && groups.length ? '' : ' required') + ' value="' + escAttr(group ? group.name : '') + '" placeholder="Weekend watch"></label>', confirmLabel: adding ? 'SAVE TITLE' : 'SAVE COLLECTION' });
    if (!accepted || !state.stats || collectionOwner() !== owner) return;
    var name = cleanText($('#collectionName').value, 60);
    if (adding) group = name ? null : groups.find(function (entry) { return entry.id === ($('#collectionTarget') && $('#collectionTarget').value); });
    if (!name && (!adding || !group)) { showToast('ENTER A COLLECTION NAME'); return; }
    if (name && (!group || !adding)) {
      var duplicate = groups.find(function (entry) { return entry.name.toLowerCase() === name.toLowerCase() && (!group || entry.id !== group.id); });
      if (duplicate) { if (adding) group = duplicate; else { showToast('A COLLECTION WITH THAT NAME ALREADY EXISTS'); return; } }
    }
    next = state.collections.slice();
    if (!group) { group = { id: 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), owner: owner, name: name, items: [] }; next.push(group); }
    var updated = Object.assign({}, group, { name: adding ? group.name : name, items: group.items.slice() });
    if (adding) {
      if (updated.items.some(function (entry) { return entry.id === mediaId && entry.type === type && (entry.source || 'anilist') === source; })) { showToast('ALREADY IN ' + group.name); return; }
      updated.items.push({ id: media.id, source: source, type: type, title: media.title, cover: safeImageUrl(media.cover), format: media.format, year: media.year });
    }
    next = next.map(function (entry) { return entry.id === group.id && entry.owner === owner ? updated : entry; });
    if (persistCollections(next)) {
      state.library.collectionId = group.id;
      if (state.library.mode === 'collections') { renderLibrary(); $('#collectionSelect').focus({ preventScroll: true }); }
      showToast(adding ? 'SAVED TO ' + updated.name : 'COLLECTION SAVED');
      announce(adding ? media.title + ' saved to ' + updated.name + '.' : 'Collection saved.');
    }
  }

  /* ── ANN wire ──────────────────────────────────────────────── */

  function annRelativeTime (value) {
    var at = Date.parse(value);
    if (!Number.isFinite(at)) return '—';
    var seconds = Math.round((at - Date.now()) / 1000);
    if (Math.abs(seconds) < 60) return 'just now';
    var unit = Math.abs(seconds) >= 86400 ? 'day' : Math.abs(seconds) >= 3600 ? 'hour' : 'minute';
    var divisor = unit === 'day' ? 86400 : unit === 'hour' ? 3600 : 60;
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
  }

  function annWireMarkup () {
    var news = state.news;
    var body;
    if (news.status === 'idle' || news.status === 'loading') {
      body = '<p class="ann-status" role="status">Loading headlines.</p><div class="ann-skeleton" aria-hidden="true">' +
        [1, 2, 3, 4, 5].map(function () { return '<div><span class="skeleton"></span><span class="skeleton"></span></div>'; }).join('') + '</div>';
    } else if (news.status === 'ready') {
      body = news.items.length ? '<ol class="ann-news-list">' + news.items.map(function (item) {
        return '<li class="ann-news-item">' + (item.imageUrl ? '<a class="ann-art-link" href="' + escAttr(item.link) + '" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">' + artworkMarkup(item.imageUrl, 'ann-art') + '</a>' : '') + '<div class="ann-news-meta">' +
          '<time class="ann-news-time"' + (item.publishedAt ? ' datetime="' + escAttr(item.publishedAt) + '" data-ann-published="' + escAttr(item.publishedAt) + '" title="' + escAttr(new Date(item.publishedAt).toLocaleString()) + '"' : '') + '>' + esc(annRelativeTime(item.publishedAt)) + '</time></div>' +
          '<h3><a class="ann-news-link" href="' + escAttr(item.link) + '" target="_blank" rel="noopener noreferrer">' + esc(item.title) + '</a></h3>' +
          (item.summary ? '<p class="ann-news-summary">' + esc(item.summary) + '</p>' : '') +
          '</li>';
      }).join('') + '</ol>' : '<p class="ann-status" role="status">No headlines available.</p>';
    } else if (news.error && news.error.kind === 'rate') {
      body = '<div class="ann-status" role="status" data-rate-block data-rate-seconds="' + escAttr(news.error.retryAfter) + '"><p>WIRE RATE LIMITED</p>' +
        '<p>RETRY IN <span data-rate-countdown>' + esc(formatCountdown(news.error.retryAfter)) + '</span></p>' +
        '<button class="btn btn-small" type="button" data-action="retry-ann" data-rate-button data-retry-prefix="RETRY IN" data-retry-label="RETRY WIRE" disabled>RETRY IN ' + esc(formatCountdown(news.error.retryAfter)) + '</button></div>';
    } else {
      body = '<div class="ann-status" role="status"><p>WIRE OFFLINE</p>' +
        '<a href="https://www.animenewsnetwork.com/" target="_blank" rel="noopener noreferrer">OPEN ANIME NEWS NETWORK</a>' +
        (location.protocol === 'http:' || location.protocol === 'https:' ? '<button type="button" class="btn btn-small" data-action="retry-ann">RETRY WIRE</button>' : '') + '</div>';
    }
    return '<section class="ann-wire" aria-labelledby="annWireTitle" aria-busy="' + (news.status === 'loading' ? 'true' : 'false') + '"><header class="panel-head"><h2 class="panel-title" id="annWireTitle" tabindex="-1">NEWS</h2></header>' + body +
      '<p class="ann-attribution"><a href="https://www.animenewsnetwork.com/" target="_blank" rel="noopener noreferrer">via Anime News Network</a></p></section>';
  }

  function renderAnnWire () {
    if (!dom.annWire) return;
    var restoreFocus = dom.annWire.contains(document.activeElement);
    dom.annWire.innerHTML = annWireMarkup();
    startRateLimitCountdowns(dom.annWire);
    if (restoreFocus) {
      var target = $('[data-action="retry-ann"]:not(:disabled)', dom.annWire) || $('#annWireTitle', dom.annWire);
      if (target) target.focus({ preventScroll: true });
    }
  }

  async function startAnnLoad (force) {
    var news = state.news;
    if (news.status === 'loading' || (!force && news.status !== 'idle' && !(news.status === 'ready' && Date.now() - news.loadedAt >= CACHE_TTL))) return;
    news.status = 'loading';
    news.error = null;
    renderAnnWire();
    try {
      var result = await annFetch(force);
      news.items = result.items;
      news.status = 'ready';
      news.loadedAt = result.at;
    } catch (error) {
      news.items = [];
      news.status = 'error';
      news.error = classifyError(error);
    }
    renderAnnWire();
  }

  /* ── clock ─────────────────────────────────────────────────── */

  function tickClock () {
    $all('[data-ann-published]').forEach(function (time) { time.textContent = annRelativeTime(time.getAttribute('data-ann-published')); });
    $all('[data-radar-airing]').forEach(function (time) {
      time.textContent = radarCountdown(Number(time.getAttribute('data-radar-airing')));
      time.classList.toggle('is-aired', Number(time.getAttribute('data-radar-airing')) * 1000 <= Date.now());
    });
    var next = $('.radar-next[data-next-airing]');
    if (state.view === 'radar' && next && Number(next.getAttribute('data-next-airing')) * 1000 <= Date.now()) renderRadar();
  }

  /* ── airing radar ──────────────────────────────────────────── */

  function radarWeekStart (date) {
    var start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    return start;
  }

  function radarDayKey (date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1, 2) + '-' + pad(date.getDate(), 2);
  }

  function radarCountdown (airingAt) {
    var minutes = Math.ceil((airingAt * 1000 - Date.now()) / 60000);
    if (minutes <= 0) return 'Aired';
    var days = Math.floor(minutes / 1440);
    var hours = Math.floor((minutes % 1440) / 60);
    var rest = minutes % 60;
    return ('In ' + (days ? days + 'd ' : '') + (hours ? hours + 'h ' : '') + (rest || (!days && !hours) ? rest + 'm' : '')).trim();
  }

  function ensureScheduleLibrary () {
    if (state.radar.scope !== 'MINE') return;
    if (state.stats) startTitlesLoad(state.stats.name, 'ANIME');
    else if (state.username && state.statsStatus !== 'loading') loadStats(state.username);
  }

  function radarEntries () {
    if (state.radar.scope !== 'MINE') return state.radar.entries;
    var ids = new Set(state.titles.ANIME.entries.filter(function (entry) {
      var watching = entry.status === 'CURRENT' || entry.status === 'REPEATING';
      return state.radar.listStatus === 'PLANNING' ? entry.status === 'PLANNING' : state.radar.listStatus === 'CURRENT' ? watching : watching || entry.status === 'PLANNING';
    }).map(function (entry) { return entry.id; }));
    return state.radar.entries.filter(function (entry) { return ids.has(state.source === 'mal' ? entry.malId : entry.mediaId); });
  }

  function radarErrorMarkup () {
    var radar = state.radar;
    var error = radar.error;
    var wait = error.kind === 'rate' ? Math.max(0, Math.ceil((radar.retryAt - Date.now()) / 1000)) : 0;
    return '<div class="radar-message" role="status"' + (wait ? ' data-rate-block data-rate-seconds="' + wait + '"' : '') + '>' +
      '<h2>' + (error.kind === 'rate' ? 'AniList rate limited.' : 'Schedule unavailable.') + '</h2>' +
      '<p>' + (wait ? 'RETRY IN <span data-rate-countdown>' + esc(formatCountdown(wait)) + '</span>' : error.kind === 'network' ? 'Check the connection and retry.' : 'Retry the weekly schedule.') + '</p>' +
      '<button class="btn btn-small" type="button" data-action="retry-radar"' + (wait ? ' data-rate-button data-retry-prefix="RETRY IN" data-retry-label="RETRY SCHEDULE" disabled' : '') + '>' + (wait ? 'RETRY IN ' + esc(formatCountdown(wait)) : 'RETRY SCHEDULE') + '</button></div>';
  }

  function renderRadar () {
    if (!dom.viewRadar) return;
    var radar = state.radar;
    var focused = dom.viewRadar.contains(document.activeElement);
    var focusAction = focused && document.activeElement.getAttribute('data-action');
    var focusDay = focused && document.activeElement.getAttribute('data-radar-day');
    var focusScope = focused && document.activeElement.getAttribute('data-radar-scope');
    var focusId = focused && document.activeElement.id;
    var start = new Date(radar.weekStart === null ? radarWeekStart(new Date()).getTime() : radar.weekStart);
    var last = new Date(start);
    last.setDate(last.getDate() + 6);
    var today = radarDayKey(new Date());
    if (radar.day === null) radar.day = today >= radarDayKey(start) && today <= radarDayKey(last) ? today : radarDayKey(start);
    var dateFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
    var timeFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
    var mine = radar.scope === 'MINE';
    var weekly = radarEntries();
    var anime = state.titles.ANIME;
    var body;
    if (mine && !state.stats) {
      body = '<div class="radar-message" role="status"><h2>' + (state.statsStatus === 'loading' ? 'Loading your profile…' : 'Your personal airing schedule.') + '</h2><p>Load your AniList library to see the anime you are watching or planning.</p><button class="btn btn-primary" data-action="open-my-library">LOAD MY LIBRARY</button></div>';
    } else if (mine && anime.status === 'error') {
      body = featureErrorMarkup(anime, 'retry-my-schedule');
    } else if (mine && anime.status !== 'ready') {
      body = '<div class="radar-message" role="status"><span class="skeleton library-loading"></span><p>Loading your complete anime library…</p></div>';
    } else if (radar.status === 'error') {
      body = radarErrorMarkup();
    } else if (radar.status === 'ready' && !weekly.length) {
      body = '<div class="radar-message" role="status"><h2>' + (mine ? 'No matching anime airs this week.' : 'No schedule available for this week.') + '</h2>' + (mine ? '<p>Only your public watching and planning titles are included. Try another week or list filter.</p>' : '') + '</div>';
    } else {
      var days = [];
      var dayButtons = [];
      for (var index = 0; index < 7; index += 1) {
        var date = new Date(start);
        date.setDate(date.getDate() + index);
        var key = radarDayKey(date);
        var entries = weekly.filter(function (entry) { return radarDayKey(new Date(entry.airingAt * 1000)) === key; });
        var weekday = new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date);
        var dayLabel = (key === today ? 'Today, ' : '') + new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric' }).format(date) + (radar.status === 'ready' ? ', ' + plural(entries.length, 'episode') : '');
        dayButtons.push('<button class="radar-day-button' + (key === today ? ' is-today' : '') + '" type="button" data-radar-day="' + escAttr(key) + '" aria-pressed="' + (radar.day === key) + '" aria-controls="radarSchedule' + index + '" aria-label="' + escAttr(dayLabel) + '"><span class="radar-day-label">' + (key === today ? 'Today' : esc(weekday)) + '</span><time datetime="' + escAttr(key) + '">' + esc(new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(date)) + '</time><span class="radar-day-total">' + (radar.status === 'ready' ? esc(plural(entries.length, 'episode')) : 'Loading…') + '</span></button>');
        var rows = radar.status !== 'ready' ? '<div class="radar-skeleton" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>'
          : entries.length ? '<ol>' + entries.map(function (entry) {
            var at = new Date(entry.airingAt * 1000);
            return '<li class="radar-episode" data-schedule-id="' + escAttr(entry.id) + '" data-media-id="' + entry.mediaId + '">' + artworkMarkup(entry.cover, 'radar-art') + '<div class="radar-episode-copy"><p class="radar-episode-meta"><time class="radar-airing-time" datetime="' + escAttr(at.toISOString()) + '" title="' + escAttr(at.toLocaleString()) + '">' + esc(timeFormat.format(at)) + '</time><span>Episode ' + esc(entry.episode === null ? '—' : entry.episode) + '</span></p>' +
              '<h3><a class="radar-title-link" title="' + escAttr(entry.title) + '" href="https://anilist.co/anime/' + escAttr(entry.mediaId) + '" target="_blank" rel="noopener noreferrer">' + esc(entry.title) + '</a></h3>' +
              '<div class="radar-episode-foot"><p class="radar-episode-format">' + esc(formatLabel(entry.format)) + '</p><p class="radar-countdown' + (entry.airingAt * 1000 <= Date.now() ? ' is-aired' : '') + '" data-radar-airing="' + escAttr(entry.airingAt) + '">' + esc(radarCountdown(entry.airingAt)) + '</p></div></div></li>';
          }).join('') + '</ol>' : '<p class="radar-day-empty">No episodes.</p>';
        days.push('<section class="radar-day" id="radarSchedule' + index + '" data-day="' + escAttr(key) + '"' + (radar.day !== 'ALL' && radar.day !== key ? ' hidden' : '') + ' aria-labelledby="radarDay' + index + '"><h2 id="radarDay' + index + '"><span>' + esc(new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date)) + (key === today ? ' <small>Today</small>' : '') + '</span><time datetime="' + escAttr(key) + '">' + esc(new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(date)) + '</time></h2>' + rows + '</section>');
      }
      body = (radar.status === 'ready' ? '<p class="radar-count" role="status">' + esc(plural(weekly.length, 'scheduled episode')) + (mine ? ' from your library' : '') + ' this week</p>' : '<p class="radar-loading" role="status">Loading weekly schedule.</p>') +
        '<nav class="radar-day-nav" aria-label="Choose a day">' + dayButtons.join('') + '<button class="radar-day-button radar-all-week" type="button" data-radar-day="ALL" aria-pressed="' + (radar.day === 'ALL') + '"><span>All week</span><span class="radar-day-total">7 days</span></button></nav>' +
        '<div class="radar-board">' + days.join('') + '</div>';
    }
    if (radar.capped) body = '<p class="radar-cap">Showing ' + esc(plural(radar.entries.length, 'scheduled episode')) + '; more may be available.</p>' + body;
    var nextAiring = mine && anime.status === 'ready' && radar.status === 'ready' && weekly.find(function (entry) { return entry.airingAt * 1000 > Date.now(); });
    var nextMarkup = nextAiring ? '<aside class="radar-next" aria-label="Next airing in your library" data-next-airing="' + nextAiring.airingAt + '">' + artworkMarkup(nextAiring.cover, 'radar-next-art') + '<div><p class="spec-label">NEXT UP THIS WEEK</p><h2><a href="https://anilist.co/anime/' + nextAiring.mediaId + '" target="_blank" rel="noopener noreferrer">' + esc(nextAiring.title) + '</a></h2><p>Episode ' + esc(nextAiring.episode === null ? '—' : nextAiring.episode) + ' / <time datetime="' + new Date(nextAiring.airingAt * 1000).toISOString() + '">' + esc(new Date(nextAiring.airingAt * 1000).toLocaleString('en', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })) + '</time></p></div><p class="radar-countdown" data-radar-airing="' + nextAiring.airingAt + '">' + esc(radarCountdown(nextAiring.airingAt)) + '</p></aside>' : '';
    dom.viewRadar.innerHTML = '<header class="radar-head"><div><p class="spec-label">ANIME / SCHEDULE</p><h1 id="radarTitle" tabindex="-1">Airing radar</h1>' +
      '<p class="radar-week">' + esc(dateFormat.format(start) + ' – ' + dateFormat.format(last)) + '</p><p class="radar-timezone">Times in ' + esc(zone) + '</p>' +
      (start.getTime() < radarWeekStart(new Date()).getTime() ? '<p class="radar-timezone">Past airing data may be incomplete.</p>' : '') + '</div>' +
      '<div class="radar-controls" aria-label="Week navigation"><button class="btn btn-small" type="button" data-action="radar-prev">PREV WEEK</button><button class="btn btn-small" type="button" data-action="radar-today">THIS WEEK</button><button class="btn btn-small" type="button" data-action="radar-next">NEXT WEEK</button></div></header><div class="radar-scope"><div class="library-tools" role="group" aria-label="Schedule source"><button class="btn" data-radar-scope="ALL" aria-pressed="' + !mine + '">ALL ANIME</button><button class="btn" data-radar-scope="MINE" aria-pressed="' + mine + '">MY SCHEDULE</button></div>' + (mine ? '<div><p class="radar-profile">' + esc(state.stats ? state.stats.name : state.username || 'Your profile') + '</p><label class="library-filter">MY LISTS<select id="radar-list-status"><option value="ALL"' + (radar.listStatus === 'ALL' ? ' selected' : '') + '>Watching &amp; planning</option><option value="CURRENT"' + (radar.listStatus === 'CURRENT' ? ' selected' : '') + '>Watching</option><option value="PLANNING"' + (radar.listStatus === 'PLANNING' ? ' selected' : '') + '>Planning</option></select></label></div>' : '') + '</div>' + nextMarkup + body;
    dom.viewRadar.setAttribute('aria-busy', radar.status === 'loading' || mine && (state.statsStatus === 'loading' || anime.status === 'loading') ? 'true' : 'false');
    startRateLimitCountdowns(dom.viewRadar);
    var activeDay = $('[data-radar-day][aria-pressed="true"]', dom.viewRadar);
    if (activeDay) {
      var dayNav = activeDay.parentNode;
      dayNav.scrollLeft += activeDay.getBoundingClientRect().left - dayNav.getBoundingClientRect().left - (dayNav.clientWidth - activeDay.offsetWidth) / 2;
    }
    if (focused) {
      var target = focusDay ? $('[data-radar-day="' + focusDay + '"]', dom.viewRadar) : focusScope ? $('[data-radar-scope="' + focusScope + '"]', dom.viewRadar) : focusAction ? $('[data-action="' + focusAction + '"]:not(:disabled)', dom.viewRadar) : focusId ? document.getElementById(focusId) : null;
      (target || $('#radarTitle', dom.viewRadar)).focus({ preventScroll: true });
    }
  }

  async function startRadarLoad (date) {
    var radar = state.radar;
    if (!date && radar.status === 'loading') { renderRadar(); return; }
    var start = date || (radar.weekStart === null ? radarWeekStart(new Date()) : new Date(radar.weekStart));
    var end = new Date(start);
    end.setDate(end.getDate() + 7);
    if (radar.weekStart !== start.getTime()) radar.day = null;
    radar.weekStart = start.getTime();
    radar.seq += 1;
    var sequence = radar.seq;
    radar.entries = [];
    radar.capped = false;
    if (Date.now() < radar.retryAt) { radar.status = 'error'; renderRadar(); return; }
    radar.status = 'loading';
    radar.error = null;
    renderRadar();
    var byId = new Map();
    try {
      // shortcut: 500 schedules per week, raise the page cap if busy weeks exceed it.
      for (var page = 1; page <= 10; page += 1) {
        var variables = { page: page, start: Math.floor(start.getTime() / 1000) - 1, end: Math.floor(end.getTime() / 1000) };
        var data = await gql(AIRING_RADAR_QUERY, variables);
        if (sequence !== radar.seq) return;
        var result = data && data.Page;
        if (!result || !Array.isArray(result.airingSchedules) || !result.pageInfo || typeof result.pageInfo.hasNextPage !== 'boolean') {
          discardCachedQuery(AIRING_RADAR_QUERY, variables);
          throw new ApiError('Unreadable airing schedule', { kind: 'server' });
        }
        result.airingSchedules.forEach(function (entry) {
          var id = safeInteger(entry && entry.id);
          var at = safeInteger(entry && entry.airingAt);
          var media = entry && entry.media;
          var mediaId = safeInteger(media && media.id);
          if (!id || !at || !mediaId || at * 1000 < start.getTime() || at * 1000 >= end.getTime()) return;
          byId.set(id, { id: id, airingAt: at, mediaId: mediaId, malId: safeInteger(media.idMal), title: mediaTitle(media), cover: safeImageUrl(media.coverImage && media.coverImage.large), format: typeof media.format === 'string' ? media.format : '', episode: Number.isInteger(entry.episode) && entry.episode >= 0 ? entry.episode : null });
        });
        if (!result.pageInfo.hasNextPage) break;
        if (page === 10) radar.capped = true;
      }
      radar.entries = Array.from(byId.values()).sort(function (a, b) { return a.airingAt - b.airingAt || a.id - b.id; });
      radar.status = 'ready';
      radar.retryAt = 0;
      if (state.view === 'radar') renderRadar();
    } catch (error) {
      if (sequence !== radar.seq) return;
      radar.status = 'error';
      radar.error = classifyError(error);
      radar.retryAt = radar.error.kind === 'rate' ? Date.now() + radar.error.retryAfter * 1000 : 0;
      if (state.view === 'radar') renderRadar();
    }
  }

  function changeRadarWeek (direction) {
    var start = direction === 0 ? radarWeekStart(new Date()) : new Date(state.radar.weekStart);
    if (direction) start.setDate(start.getDate() + direction * 7);
    startRadarLoad(start);
  }

  /* ── saved boards ──────────────────────────────────────────── */

  function countBoardCharacters (board) {
    if (!board) return 0;
    var total = board.pool.length;
    TIER_KEYS.forEach(function (key) { total += board.tiers[key].length; });
    return total;
  }

  function everyBoardCharacter (board) {
    var chars = [];
    var seen = new Set();
    var add = function (char) {
      if (char && !seen.has(char.id)) {
        seen.add(char.id);
        chars.push(char);
      }
    };
    board.pool.forEach(add);
    TIER_KEYS.forEach(function (key) { board.tiers[key].forEach(add); });
    return chars;
  }

  function characterInBoard (board, charId) {
    var id = safeInteger(charId);
    if (!board || !id) return null;
    var rows = [board.pool].concat(TIER_KEYS.map(function (key) { return board.tiers[key]; }));
    for (var i = 0; i < rows.length; i += 1) {
      for (var j = 0; j < rows[i].length; j += 1) {
        if (rows[i][j].id === id) return rows[i][j];
      }
    }
    return null;
  }

  function characterLocation (board, charId) {
    var id = safeInteger(charId);
    if (!board || !id) return null;
    var rowKeys = ['pool'].concat(TIER_KEYS);
    for (var i = 0; i < rowKeys.length; i += 1) {
      var row = board.tiers[rowKeys[i]] || board.pool;
      if (rowKeys[i] === 'pool') row = board.pool;
      var index = row.findIndex(function (char) { return char.id === id; });
      if (index !== -1) return { row: rowKeys[i], index: index, char: row[index] };
    }
    return null;
  }

  function normalizeBoardRecord (raw, options) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid board');
    if (Number(raw.v) !== 1) throw new Error('Unsupported board version');

    var mediaId = safeInteger(raw.mediaId);
    if (!mediaId) throw new Error('Board is missing a media id');

    var charMap = new Map();
    var charInput = Array.isArray(raw.chars) ? raw.chars : [];
    charInput.forEach(function (item) {
      var id;
      var name;
      var image;
      if (Array.isArray(item)) {
        id = safeInteger(item[0]);
        name = cleanText(item[1], 160);
        image = safeImageUrl(item[2]);
      } else if (item && typeof item === 'object') {
        id = safeInteger(item.id);
        name = cleanText(item.name, 160);
        image = safeImageUrl(item.image);
      }
      if (!id || !name || charMap.has(id) || charMap.size >= MAX_CHARS) return;
      charMap.set(id, { id: id, name: name, image: image });
    });

    var seen = new Set();
    var tiers = { S: [], A: [], B: [], C: [], D: [] };
    var sourceTiers = raw.tiers && typeof raw.tiers === 'object' ? raw.tiers : {};
    TIER_KEYS.forEach(function (key) {
      var source = Array.isArray(sourceTiers[key]) ? sourceTiers[key] : [];
      source.forEach(function (value) {
        var id = safeInteger(value);
        var char = charMap.get(id);
        if (!char || seen.has(id)) return;
        seen.add(id);
        tiers[key].push(char);
      });
    });
    var pool = [];
    var sourcePool = Array.isArray(raw.pool) ? raw.pool : [];
    sourcePool.forEach(function (value) {
      var id = safeInteger(value);
      var char = charMap.get(id);
      if (!char || seen.has(id)) return;
      seen.add(id);
      pool.push(char);
    });
    charMap.forEach(function (char, id) {
      if (!seen.has(id)) {
        seen.add(id);
        pool.push(char);
      }
    });
    if (pool.length + tiers.S.length + tiers.A.length + tiers.B.length + tiers.C.length + tiers.D.length > MAX_CHARS) {
      pool = pool.slice(0, Math.max(0, MAX_CHARS - (tiers.S.length + tiers.A.length + tiers.B.length + tiers.C.length + tiers.D.length)));
    }

    return {
      mediaId: mediaId,
      type: raw.type === 'MANGA' ? 'MANGA' : 'ANIME',
      title: cleanText(raw.title, 220) || 'Untitled board',
      nativeTitle: cleanText(raw.nativeTitle, 220),
      cover: safeImageUrl(raw.cover),
      format: cleanText(raw.format, 30),
      year: Number.isInteger(Number(raw.year)) && Number(raw.year) > 0 ? Number(raw.year) : null,
      averageScore: Number.isFinite(Number(raw.averageScore)) && Number(raw.averageScore) > 0 ? Number(raw.averageScore) : null,
      updatedAt: Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : Date.now(),
      tiers: tiers,
      pool: pool,
      page: Math.max(1, Math.min(MAX_PAGES, Number(raw.page) || 1)),
      hasNext: Boolean(raw.hasNext),
      loading: false,
      loaded: true,
      error: null,
      shared: Boolean(options && options.shared)
    };
  }

  function boardFromSharePayload (payload) {
    if (!payload || typeof payload !== 'object' || Number(payload.v) !== 1) throw new Error('Unsupported share payload');
    var raw = {
      v: 1,
      mediaId: payload.m,
      type: payload.d,
      title: payload.t,
      nativeTitle: payload.n,
      cover: payload.c,
      format: payload.f,
      year: payload.y,
      averageScore: payload.a,
      updatedAt: Date.now(),
      tiers: payload.tiers,
      pool: payload.pool,
      chars: payload.chars,
      page: 1,
      hasNext: false
    };
    return normalizeBoardRecord(raw, { shared: true });
  }

  function serializeBoard (board, keepUpdatedAt) {
    var chars = [];
    var seen = new Set();
    var addChar = function (char) {
      if (!seen.has(char.id)) {
        seen.add(char.id);
        chars.push({ id: char.id, name: char.name, image: char.image });
      }
    };
    var tiers = { S: [], A: [], B: [], C: [], D: [] };
    TIER_KEYS.forEach(function (key) {
      board.tiers[key].forEach(function (char) {
        addChar(char);
        tiers[key].push(char.id);
      });
    });
    var pool = [];
    board.pool.forEach(function (char) {
      addChar(char);
      pool.push(char.id);
    });
    return {
      v: 1,
      mediaId: board.mediaId,
      type: board.type,
      title: board.title,
      nativeTitle: board.nativeTitle,
      cover: board.cover,
      format: board.format,
      year: board.year,
      averageScore: board.averageScore,
      updatedAt: keepUpdatedAt ? board.updatedAt : Date.now(),
      page: board.page,
      hasNext: Boolean(board.hasNext),
      tiers: tiers,
      pool: pool,
      chars: chars
    };
  }

  function loadBoardsFromStorage () {
    var storage = getStorage('local');
    var raw = readJson(storage, BOARDS_KEY, null);
    state.boards = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    Object.keys(raw).forEach(function (key) {
      try {
        var board = normalizeBoardRecord(raw[key], { shared: false });
        state.boards[String(board.mediaId)] = serializeBoard(board, true);
      } catch (error) {
        /* Ignore corrupt local records without touching the rest. */
      }
    });
  }

  function writeBoardsToStorage () {
    var ok = writeJson(getStorage('local'), BOARDS_KEY, state.boards);
    if (!ok) {
      state.storageOk = false;
      if (!state.saveWarned) {
        state.saveWarned = true;
        showToast('LOCAL STORAGE UNAVAILABLE / BOARD KEPT IN THIS TAB ONLY');
        announce('Local storage is unavailable. This board will not survive a reload.');
      }
    }
    return ok;
  }

  function persistCurrentBoard (board) {
    if (!board || board.shared) return false;
    if (!countBoardCharacters(board)) return false;
    board.updatedAt = Date.now();
    var record = serializeBoard(board, true);
    state.boards[String(board.mediaId)] = record;
    var ok = writeBoardsToStorage();
    saveUiState();
    updateBoardSaveLabels();
    updateArchiveCounts();
    return ok;
  }

  function sortedBoards () {
    return Object.keys(state.boards).map(function (key) {
      return state.boards[key];
    }).filter(Boolean).sort(function (a, b) {
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    });
  }

  function boardRecordCharCount (record) {
    if (!record) return 0;
    if (Array.isArray(record.chars)) return record.chars.length;
    return 0;
  }

  function updateArchiveCounts () {
    var count = Object.keys(state.boards).length;
    $all('[data-archive-count]').forEach(function (el) { el.textContent = pad(count, 2); });
    $all('[data-archive-word]').forEach(function (el) { el.textContent = String(count); });
  }

  function updateBoardSaveLabels () {
    var board = state.board;
    if (!board) return;
    var label = 'LOCAL / PENDING';
    if (board.shared) label = 'SHARED / NOT SAVED';
    else if (state.boards[String(board.mediaId)]) label = 'AUTO-SAVED / ' + formatClock(new Date(board.updatedAt));
    $all('[data-board-save]').forEach(function (el) { el.textContent = label; });
  }

  /* ── search page markup ────────────────────────────────────── */

  function tierIntroMarkup () {
    return '<header class="tier-intro">' +
      '<div class="tier-intro-copy">' +
        '<h1 class="tier-title">Rank the cast.</h1>' +
        '<p class="tier-copy">Search a title. Place the cast.</p>' +
      '</div>' +
      '<div class="tier-intro-aside">' +
        '<button class="btn" type="button" data-action="open-archive">SAVED BOARDS / <span data-archive-count>' + pad(Object.keys(state.boards).length, 2) + '</span></button>' +
      '</div>' +
    '</header>';
  }

  function tierSearchFormMarkup () {
    return '<form class="command-panel" id="tierSearchForm" novalidate>' +
      '<div class="command-label">' +
        '<label class="spec-label" for="tierSearchInput">TITLE SEARCH</label>' +
      '</div>' +
      '<div class="command-field">' +
        '<span class="command-prefix command-prefix-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"></circle><path d="M10.4 10.4L14 14"></path></svg></span>' +
        '<input class="command-input" id="tierSearchInput" name="title" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="search a title" value="' + escAttr(state.search.q) + '">' +
      '</div>' +
      '<button class="btn btn-primary command-submit" type="submit">SEARCH</button>' +
    '</form>';
  }

  function searchSkeletonMarkup () {
    var cards = '';
    for (var i = 0; i < 12; i += 1) {
      cards += '<div class="media-card media-skeleton" aria-hidden="true">' +
        '<div class="media-cover"><div class="skeleton" style="width:100%;height:100%"></div></div>' +
        '<div class="media-body"><div class="skeleton" style="height:13px;width:82%"></div><div class="skeleton" style="height:9px;width:52%;margin-top:9px"></div></div>' +
      '</div>';
    }
    return '<div class="media-grid">' + cards + '</div>';
  }

  function searchEmptyInitialMarkup () {
    return '<div class="search-empty-block">' +
      '<div>' +
        '<h2 class="search-empty-title">Search a title.</h2>' +
        '<p class="search-empty-copy">Anime or manga. Nothing saved yet.</p>' +
      '</div>' +
      '<span class="search-empty-mark" aria-hidden="true">/</span>' +
    '</div>';
  }

  function searchErrorMarkup (error) {
    var kind = error ? error.kind : 'server';
    var title = 'Search failed.';
    var body = 'AniList returned an unexpected response. Try the query again.';
    var code = 'SEARCH / ERROR';
    var rate = 0;
    if (kind === 'network') {
      code = 'FETCH / OFFLINE';
      title = 'Search offline.';
      body = 'The AniList feed did not answer. The query is kept; retry when the connection is back.';
    } else if (kind === 'rate') {
      code = 'HTTP 429 / THROTTLED';
      title = 'Search throttled.';
      body = 'AniList is limiting requests. Wait for the countdown, then search again.';
      rate = error.retryAfter || 60;
    } else if (kind === 'server' && error && error.message) {
      code = error.status ? 'HTTP ' + error.status : 'SEARCH / ERROR';
      body = 'AniList returned an error: ' + esc(cleanText(error.message, 150)) + '.';
    }
    return '<div class="state state-search" role="group" aria-label="Search error"' + (rate ? ' data-rate-block data-rate-seconds="' + rate + '"' : '') + '>' +
      '<div class="state-main">' +
        '<p class="spec-label state-kicker">' + esc(code) + '</p>' +
        '<h2 class="state-title">' + esc(title) + '</h2>' +
        '<p class="state-body">' + body + '</p>' +
        '<div class="state-action">' +
          '<button class="btn btn-primary" type="button" data-action="retry-search"' + (rate ? ' data-rate-button data-retry-prefix="RETRY IN" data-retry-label="RETRY SEARCH" disabled' : '') + '>' + (rate ? 'RETRY IN ' + formatCountdown(rate) : 'RETRY SEARCH') + '</button>' +
        '</div>' +
      '</div>' +
      (rate ? '<div class="state-aside"><span class="spec-label">NEXT QUERY / RATE LIMIT</span><span class="state-count" data-rate-countdown>' + formatCountdown(rate) + '</span><span class="state-count-label">SECONDS REMAINING</span></div>' : '<div class="state-aside"><span class="spec-label">EXCHANGE</span><p class="state-code">' + esc(code) + '</p></div>') +
    '</div>';
  }

  function mediaResultsMarkup (results) {
    return '<div class="media-grid">' + results.map(function (media, index) {
      var title = mediaTitle(media);
      var cover = safeImageUrl(media.coverImage && media.coverImage.large);
      var format = formatLabel(media.format);
      var year = media.startDate && media.startDate.year ? media.startDate.year : '—';
      var score = media.averageScore !== null && media.averageScore !== undefined && Number(media.averageScore) > 0 ? Number(media.averageScore) : null;
      return '<button class="media-card" type="button" data-action="open-media" data-media-id="' + media.id + '" aria-label="Open ' + escAttr(title) + '">' +
        '<span class="media-cover">' +
          '<span class="media-index" aria-hidden="true">' + pad(index + 1, 2) + '</span>' +
          (cover ? '<img src="' + escAttr(cover) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '') +
          '<span class="img-fallback" aria-hidden="true">—</span>' +
        '</span>' +
        '<span class="media-body">' +
          '<span class="media-title">' + esc(title) + '</span>' +
          '<span class="media-meta"><span>' + esc(format) + ' / ' + esc(year) + '</span><span class="media-score">' + (score === null ? '—' : score) + '<span class="denom">/100</span></span></span>' +
        '</span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function searchResultsMarkup () {
    var search = state.search;
    var hasQuery = Boolean(cleanText(search.q, 80));
    if (!hasQuery && search.status === 'idle') return searchEmptyInitialMarkup();

    var query = cleanText(search.q, 80);
    var status = '<div class="search-status">' +
      '<span>' + esc(query) + '</span>' +
      '<span class="search-count">' + (search.status === 'loading' ? 'SEARCHING' : search.status === 'error' ? 'ERROR' : pad(search.results.length, 2) + ' RESULTS') + '</span>' +
    '</div>';

    if (search.status === 'loading') return status + searchSkeletonMarkup();
    if (search.status === 'error') return status + searchErrorMarkup(search.error);
    if (search.status === 'ready' && search.results.length) return status + mediaResultsMarkup(search.results);
    if (search.status === 'ready') {
      return status + '<div class="empty-results">' +
        '<h2 class="empty-results-title">No titles found.</h2>' +
        '<p class="empty-results-copy">Try a shorter title or another division.</p>' +
      '</div>';
    }
    return status + searchEmptyInitialMarkup();
  }

  function archiveRowsMarkup (dialog) {
    var boards = sortedBoards();
    if (!boards.length) {
      return '<p class="archive-empty">No saved boards.</p>';
    }
    if (dialog) {
      return boards.map(function (record) {
        var isCurrent = state.board && state.board.mediaId === record.mediaId;
        return '<div class="archive-dialog-row">' +
          '<div class="archive-dialog-copy">' +
            '<button class="archive-dialog-title" type="button" data-action="open-saved" data-media-id="' + record.mediaId + '">' + esc(record.title || 'Untitled board') + (isCurrent ? ' / CURRENT' : '') + '</button>' +
            '<p class="archive-dialog-meta">' + esc(formatLabel(record.format)) + ' / ' + esc(record.year || '—') + ' / ' + (state && state.boards[String(record.mediaId)] ? boardRecordCharCount(record) : boardRecordCharCount(record)) + ' CAST / ' + esc(formatStamp(record.updatedAt)) + '</p>' +
          '</div>' +
          '<div class="archive-dialog-actions">' +
            '<button class="btn btn-small" type="button" data-action="open-saved" data-media-id="' + record.mediaId + '">OPEN</button>' +
            '<button class="btn btn-small btn-danger" type="button" data-action="delete-saved" data-media-id="' + record.mediaId + '">DELETE</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    return '<div class="archive-list">' + boards.map(function (record) {
      var count = boardRecordCharCount(record);
      return '<div class="archive-row">' +
        '<button class="archive-title-btn" type="button" data-action="open-saved" data-media-id="' + record.mediaId + '">' +
          '<span class="archive-title-text">' + esc(record.title || 'Untitled board') + '</span>' +
          '<span class="archive-id">#' + record.mediaId + '</span>' +
        '</button>' +
        '<span class="archive-info archive-format">' + esc(record.type) + ' / ' + esc(formatLabel(record.format)) + '</span>' +
        '<span class="archive-info">CAST / <b>' + pad(count, 2) + '</b></span>' +
        '<span class="archive-info">' + esc(formatStamp(record.updatedAt)) + '</span>' +
        '<span class="archive-actions">' +
          '<button class="btn btn-small" type="button" data-action="open-saved" data-media-id="' + record.mediaId + '">OPEN</button>' +
          '<button class="btn btn-small btn-danger" type="button" data-action="delete-saved" data-media-id="' + record.mediaId + '">DELETE</button>' +
        '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function archiveSectionMarkup () {
    var count = Object.keys(state.boards).length;
    return '<section class="archive-section" id="archiveRegion" aria-labelledby="savedBoardsTitle">' +
      '<div class="section-bar">' +
        '<div class="section-bar-title"><span class="spec-label">LOCAL / BOARDS</span><h2 id="savedBoardsTitle">Saved boards</h2></div>' +
        '<span class="section-bar-meta">' + pad(count, 2) + ' SAVED / THIS BROWSER ONLY</span>' +
      '</div>' +
      archiveRowsMarkup(false) +
    '</section>';
  }

  function searchPageMarkup () {
    return tierIntroMarkup() + tierSearchFormMarkup() +
      '<div id="searchResultsRegion">' + searchResultsMarkup() + '</div>' +
      '<div id="archiveSlot">' + archiveSectionMarkup() + '</div>';
  }

  function renderSearchRegion () {
    var region = document.getElementById('searchResultsRegion');
    if (!region) return;
    region.innerHTML = searchResultsMarkup();
    startRateLimitCountdowns(region);
  }

  function renderArchiveRegion () {
    var slot = document.getElementById('archiveSlot');
    if (slot) slot.innerHTML = archiveSectionMarkup();
    updateArchiveCounts();
  }

  /* ── search and character requests ─────────────────────────── */

  function beginSearch (inputValue, immediate) {
    var raw = String(inputValue === null || inputValue === undefined ? '' : inputValue);
    state.search.q = raw;
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
    state.search.seq += 1;
    var sequence = state.search.seq;
    var query = cleanText(raw, 80);
    if (!query) {
      state.search.status = 'idle';
      state.search.results = [];
      state.search.error = null;
      state.search.activeQuery = '';
      renderSearchRegion();
      return;
    }
    state.search.activeQuery = query;
    state.search.status = 'loading';
    state.search.error = null;
    renderSearchRegion();
    var run = function () { runSearch(query, sequence); };
    if (immediate) run();
    else searchTimer = window.setTimeout(run, 300);
  }

  async function runSearch (query, sequence) {
    if (sequence !== state.search.seq) return;
    state.search.activeQuery = query;
    state.search.status = 'loading';
    state.search.error = null;
    if (state.view === 'tiers' && state.tierMode === 'search') renderSearchRegion();
    try {
      var data = await gql(SEARCH_MEDIA_QUERY, { q: query, type: state.type });
      if (sequence !== state.search.seq) return;
      var media = data && data.Page && Array.isArray(data.Page.media) ? data.Page.media : [];
      state.search.results = media.filter(function (item) { return item && safeInteger(item.id); });
      state.search.status = 'ready';
      state.search.error = null;
      if (state.view === 'tiers' && state.tierMode === 'search') renderSearchRegion();
      announce(state.search.results.length + ' titles found for ' + query + '.');
    } catch (error) {
      if (sequence !== state.search.seq) return;
      state.search.status = 'error';
      state.search.error = classifyError(error);
      if (state.view === 'tiers' && state.tierMode === 'search') renderSearchRegion();
      announce('Search failed. ' + (state.search.error.kind === 'network' ? 'The feed is unreachable.' : 'AniList did not answer.'));
    }
  }

  function retrySearch () {
    var query = cleanText(state.search.activeQuery || state.search.q, 80);
    if (!query) {
      state.search.status = 'idle';
      state.search.error = null;
      renderSearchRegion();
      return;
    }
    state.search.seq += 1;
    var sequence = state.search.seq;
    state.search.status = 'loading';
    state.search.error = null;
    renderSearchRegion();
    runSearch(query, sequence);
  }

  function openMediaBoard (mediaId) {
    var id = safeInteger(mediaId);
    var media = state.search.results.find(function (item) { return item.id === id; });
    if (!media) {
      showToast('TITLE NO LONGER AVAILABLE / SEARCH AGAIN');
      return;
    }
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
    state.search.seq += 1;
    var title = mediaTitle(media);
    var board = {
      mediaId: media.id,
      type: media.type === 'MANGA' ? 'MANGA' : 'ANIME',
      title: title,
      nativeTitle: media.title && media.title.native ? cleanText(media.title.native, 220) : '',
      cover: safeImageUrl(media.coverImage && media.coverImage.large),
      format: media.format || '',
      year: media.startDate && media.startDate.year ? Number(media.startDate.year) : null,
      averageScore: media.averageScore !== null && media.averageScore !== undefined && Number(media.averageScore) > 0 ? Number(media.averageScore) : null,
      updatedAt: Date.now(),
      tiers: { S: [], A: [], B: [], C: [], D: [] },
      pool: [],
      page: 0,
      hasNext: true,
      loading: true,
      loaded: false,
      error: null,
      shared: false
    };
    if (state.type !== board.type) state.genre = null;
    state.type = board.type;
    state.board = board;
    state.tierMode = 'board';
    state.tierFatal = null;
    state.view = 'tiers';
    syncHeaderUi();
    saveUiState();
    renderTiers();
    updateDocumentTitle();
    window.scrollTo(0, 0);
    announce('Loading the first 25 characters for ' + title + '.');
    loadBoardCharacters(1);
  }

  async function loadBoardCharacters (page) {
    var board = state.board;
    if (!board || board.shared) return;
    var targetPage = Math.max(1, Math.min(MAX_PAGES, Number(page) || 1));
    if (countBoardCharacters(board) >= MAX_CHARS) {
      board.hasNext = false;
      board.loading = false;
      renderTiers();
      return;
    }
    board.loading = true;
    board.error = null;
    board.retryPage = targetPage;
    renderTiers();
    state.boardRequestSeq = (state.boardRequestSeq || 0) + 1;
    var sequence = state.boardRequestSeq;
    try {
      var data = await gql(MEDIA_CHARACTERS_QUERY, { id: board.mediaId, page: targetPage });
      if (state.board !== board || sequence !== state.boardRequestSeq) return;
      var media = data && data.Media;
      if (!media) {
        board.loading = false;
        board.error = { kind: 'server', status: 0, retryAfter: null, message: 'Title not found' };
        board.retryPage = targetPage;
        renderTiers();
        announce('Characters could not be loaded for this title.');
        return;
      }
      board.title = mediaTitle(media);
      board.nativeTitle = media.title && media.title.native ? cleanText(media.title.native, 220) : board.nativeTitle;
      var freshCover = safeImageUrl(media.coverImage && media.coverImage.large);
      if (freshCover) board.cover = freshCover;
      if (Number.isFinite(Number(media.averageScore)) && Number(media.averageScore) > 0) board.averageScore = Number(media.averageScore);
      var connection = media.characters || {};
      var info = connection.pageInfo || {};
      var edges = Array.isArray(connection.edges) ? connection.edges : [];
      var known = new Set(everyBoardCharacter(board).map(function (char) { return char.id; }));
      var added = 0;
      edges.forEach(function (edge) {
        if (!edge || !edge.node || countBoardCharacters(board) >= MAX_CHARS) return;
        var node = edge.node;
        var id = safeInteger(node.id);
        var name = cleanText(node.name && node.name.full, 160);
        if (!id || !name || known.has(id)) return;
        var image = safeImageUrl(node.image && (node.image.large || node.image.medium));
        board.pool.push({ id: id, name: name, image: image });
        known.add(id);
        added += 1;
      });
      board.page = Number.isInteger(Number(info.currentPage)) ? Number(info.currentPage) : targetPage;
      board.hasNext = Boolean(info.hasNextPage) && board.page < MAX_PAGES && countBoardCharacters(board) < MAX_CHARS;
      board.loading = false;
      board.loaded = true;
      board.error = null;
      if (countBoardCharacters(board)) persistCurrentBoard(board);
      saveUiState();
      renderTiers();
      updateDocumentTitle();
      announce(added ? added + ' characters added. ' + countBoardCharacters(board) + ' on the board.' : 'No new characters on this page.');
    } catch (error) {
      if (state.board !== board || sequence !== state.boardRequestSeq) return;
      board.loading = false;
      board.error = classifyError(error);
      board.retryPage = targetPage;
      renderTiers();
      announce(board.error.kind === 'rate' ? 'Character loading is rate limited.' : 'Characters could not be loaded.');
    }
  }

  function retryCharacters () {
    if (!state.board) return;
    loadBoardCharacters(state.board.retryPage || state.board.page + 1 || 1);
  }

  /* ── board markup ──────────────────────────────────────────── */

  function characterCardMarkup (char, rowKey) {
    var rowLabel = rowKey === 'pool' ? 'unassigned' : 'tier ' + rowKey;
    var image = char.image;
    var moveIcon = '<svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2 3.2h6M2 5h6M2 6.8h6"></path></svg>';
    return '<article class="char-card" tabindex="0" role="group" data-char-id="' + char.id + '" data-source-row="' + rowKey + '" aria-label="' + escAttr(char.name + '. ' + rowLabel + '. Press Enter for the move menu.') + '">' +
      '<div class="card-frame">' +
        '<div class="card-image">' +
          (image ? '<img src="' + escAttr(image) + '" alt="" loading="lazy" decoding="async" draggable="false" referrerpolicy="no-referrer">' : '') +
          '<span class="img-fallback" aria-hidden="true">—</span>' +
        '</div>' +
        '<div class="card-name">' +
          '<span class="card-name-text" title="' + escAttr(char.name) + '">' + esc(char.name) + '</span>' +
          '<button class="card-move" type="button" data-action="open-move" data-char-id="' + char.id + '" aria-label="Move ' + escAttr(char.name) + '. Choose S, A, B, C, D or unassigned." title="Move character">' + moveIcon + '</button>' +
        '</div>' +
        (rowKey === 'pool' ? '' : '<button class="card-x" type="button" data-action="unassign" data-char-id="' + char.id + '" aria-label="Return ' + escAttr(char.name) + ' to unassigned">×</button>') +
      '</div>' +
    '</article>';
  }

  function categoryEmptyMarkup (board, rowKey) {
    if (rowKey !== 'pool') return '';
    if (board.loading && !board.loaded) {
      var skeletons = '';
      for (var i = 0; i < 9; i += 1) skeletons += '<div class="char-skeleton" aria-hidden="true"><div class="skeleton"></div></div>';
      return skeletons;
    }
    if (board.error) return '';
    return '';
  }

  function tierRowMarkup (board, rowKey) {
    var row = rowKey === 'pool' ? board.pool : board.tiers[rowKey];
    var letter = rowKey === 'pool' ? 'U' : rowKey;
    var cards = row.length ? row.map(function (char) { return characterCardMarkup(char, rowKey); }).join('') : categoryEmptyMarkup(board, rowKey);
    var aria = (rowKey === 'pool' ? 'Unassigned' : 'Tier ' + rowKey) + ', ' + row.length + ' characters';
    return '<section class="tier-row" data-drop-tier="' + rowKey + '" aria-label="' + escAttr(aria) + '">' +
      '<div class="tier-letter" aria-hidden="true">' +
        '<span class="tier-letter-char">' + letter + '</span>' +
        '<span class="tier-letter-meta">' + (rowKey === 'pool' ? '<span class="tier-letter-label">UNASSIGNED</span>' : '') + '<span class="tier-letter-count" data-row-count="' + rowKey + '">' + pad(row.length, 2) + '</span></span>' +
      '</div>' +
      '<div class="tier-drop" data-drop-row="' + rowKey + '">' + cards + '</div>' +
    '</section>';
  }

  function tierStackMarkup (board) {
    return '<div class="tier-stack" id="tierStack">' + ALL_ROWS.map(function (rowKey) {
      return tierRowMarkup(board, rowKey);
    }).join('') + '</div>';
  }

  function poolControlsMarkup (board) {
    var total = countBoardCharacters(board);
    var page = Math.max(1, Number(board.page) || 1);
    var capReached = total >= MAX_CHARS;
    var canLoad = board.hasNext && !board.loading && !board.error && !board.shared && !capReached && page < MAX_PAGES;
    var buttonLabel = board.loading
      ? 'LOADING CHARACTERS'
      : capReached
        ? 'BOARD LIMIT / 100'
        : !board.hasNext || page >= MAX_PAGES
          ? 'END OF CHARACTER INDEX'
          : 'LOAD MORE CHARACTERS';
    if (board.shared) {
      return '<div class="pool-controls">' +
        '<span class="pool-progress"><b>' + pad(total, 2) + '</b> CAST</span>' +
      '</div>';
    }
    return '<div class="pool-controls">' +
      '<span class="pool-progress"><b>' + pad(total, 3) + '</b> / 100 · PAGE ' + pad(page, 2) + '</span>' +
      '<button class="btn btn-small" type="button" data-action="load-more" aria-disabled="' + (canLoad ? 'false' : 'true') + '"' + (canLoad ? '' : ' disabled') + '>' + buttonLabel + '</button>' +
    '</div>';
  }

  function boardErrorMarkup (board) {
    var error = board.error;
    if (!error) return '';
    var rate = error.kind === 'rate' ? error.retryAfter || 60 : 0;
    var body = 'Characters could not be loaded.';
    if (error.kind === 'network') {
      body = 'The feed did not answer. Retry.';
    } else if (error.kind === 'rate') {
      body = 'AniList is rate-limiting. Retry after the countdown.';
    } else if (error.message) {
      body = 'AniList error: ' + esc(cleanText(error.message, 110)) + '.';
    }
    return '<div class="board-error" role="group" aria-label="Character loading error" data-rate-block data-rate-seconds="' + rate + '">' +
      '<div><span class="mono">CAST SHEET / ' + esc(error.kind === 'rate' ? 'THROTTLED' : 'NO SIGNAL') + '</span><p class="board-error-copy">' + body + '</p></div>' +
      '<div class="board-error-action">' +
        (rate ? '<span class="state-count" data-rate-countdown style="font-size:24px;margin:0">' + formatCountdown(rate) + '</span>' : '') +
        '<button class="btn btn-small" type="button" data-action="retry-characters"' + (rate ? ' data-rate-button data-retry-prefix="RETRY IN" data-retry-label="RETRY CAST" disabled' : '') + '>' + (rate ? 'RETRY IN ' + formatCountdown(rate) : 'RETRY CAST') + '</button>' +
      '</div>' +
    '</div>';
  }

  function boardMarkup (board) {
    var total = countBoardCharacters(board);
    var cover = safeImageUrl(board.cover);
    var savedCount = Object.keys(state.boards).length;
    var saveLabel = board.shared
      ? 'SHARED / NOT SAVED'
      : state.boards[String(board.mediaId)]
        ? 'AUTO-SAVED / ' + formatClock(new Date(board.updatedAt))
        : 'LOCAL / PENDING';
    var sharedBanner = board.shared
      ? '<div class="share-banner" role="status">' +
          '<p class="share-banner-copy"><span class="share-banner-kicker">SHARE / INBOUND</span>Shared board — save a copy?</p>' +
          '<button class="btn btn-primary" type="button" data-action="save-shared-copy">SAVE A COPY</button>' +
        '</div>'
      : '';
    return '<div class="board-page">' +
      '<div class="board-top">' +
        '<p class="board-crumb"><b>' + esc(board.type) + '</b> / ' + esc(formatLabel(board.format)) + ' / ' + esc(board.year || '—') + '</p>' +
        '<div class="board-top-actions">' +
          '<button class="btn btn-small" type="button" data-action="open-archive">SAVED BOARDS / <span data-archive-count>' + pad(savedCount, 2) + '</span></button>' +
          '<button class="btn btn-small" type="button" data-action="new-board">NEW BOARD</button>' +
        '</div>' +
      '</div>' +
      sharedBanner +
      '<header class="board-head">' +
        '<div class="board-cover">' +
          (cover ? '<img src="' + escAttr(cover) + '" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer">' : '') +
          '<span class="img-fallback" aria-hidden="true">—</span>' +
        '</div>' +
        '<div class="board-copy">' +
          '<h1 class="board-title" id="boardTitle">' + esc(board.title) + '</h1>' +
          (board.nativeTitle ? '<p class="board-native" lang="ja">' + esc(board.nativeTitle) + '</p>' : '') +
          '<div class="board-metrics">' +
            '<div class="board-metric"><span class="board-metric-key">COMMUNITY AVG</span><span class="board-metric-val">' + (board.averageScore === null || board.averageScore === undefined ? '—' : esc(board.averageScore) + ' / 100') + '</span></div>' +
            '<div class="board-metric"><span class="board-metric-key">CAST</span><span class="board-metric-val" data-board-cast-count>' + total + ' / 100</span></div>' +
            '<div class="board-metric"><span class="board-metric-key">SAVE</span><span class="board-metric-val" data-board-save>' + esc(saveLabel) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="board-actions">' +
          '<button class="btn btn-primary" type="button" data-action="copy-share">COPY SHARE LINK</button>' +
        '</div>' +
      '</header>' +
      '<div class="board-note">' +
        '<span class="board-note-hint">DRAG TO RANK / <b>MOVE</b> MENU FOR KEYS <span class="touch-hint">/ HOLD TO DRAG ON TOUCH</span></span>' +
        '<span><b>' + total + '</b> / 100</span>' +
      '</div>' +
      boardErrorMarkup(board) +
      tierStackMarkup(board) +
      poolControlsMarkup(board) +
    '</div>';
  }

  function fatalMarkup () {
    var fatal = state.tierFatal || { title: 'Something broke.', body: 'The board could not be read.' };
    return '<div class="board-page">' +
      '<div class="board-top"><p class="board-crumb">SHARE LINK / UNREADABLE</p><div class="board-top-actions"><button class="btn btn-small" type="button" data-action="new-board">NEW BOARD</button></div></div>' +
      '<div class="state" role="group" aria-label="Share link error">' +
        '<div class="state-main"><p class="spec-label state-kicker">LINK / INVALID</p>' +
          '<h1 class="state-title">' + esc(fatal.title) + '</h1>' +
          '<p class="state-body">' + esc(fatal.body) + '</p>' +
          '<div class="state-action"><button class="btn btn-primary" type="button" data-action="new-board">START A NEW BOARD</button></div>' +
        '</div>' +
        '<div class="state-aside"><span class="spec-label">EXCHANGE</span><p class="state-code">SHARE HASH COULD NOT BE DECODED<br>NO API REQUESTS WERE MADE</p></div>' +
      '</div>' +
    '</div>';
  }

  function renderTiers () {
    if (!dom.viewTiers) return;
    if (state.tierFatal) {
      dom.viewTiers.innerHTML = fatalMarkup();
    } else if (state.tierMode === 'board' && state.board) {
      dom.viewTiers.innerHTML = boardMarkup(state.board);
      if (state.board.error && state.board.error.kind === 'rate') startRateLimitCountdowns(dom.viewTiers);
    } else {
      dom.viewTiers.innerHTML = searchPageMarkup();
      if (state.search.status === 'error') startRateLimitCountdowns(dom.viewTiers);
    }
    updateArchiveCounts();
    updateDocumentTitle();
  }

  function refreshBoardRows (focusCharId) {
    var board = state.board;
    var stack = document.getElementById('tierStack');
    if (!board || !stack) {
      renderTiers();
      return;
    }
    var scrolls = {};
    $all('[data-drop-row]', stack).forEach(function (el) { scrolls[el.getAttribute('data-drop-row')] = el.scrollLeft; });
    stack.innerHTML = ALL_ROWS.map(function (rowKey) { return tierRowMarkup(board, rowKey); }).join('');
    $all('[data-drop-row]', stack).forEach(function (el) {
      var key = el.getAttribute('data-drop-row');
      if (scrolls[key]) el.scrollLeft = scrolls[key];
    });
    $all('[data-board-cast-count]').forEach(function (el) { el.textContent = countBoardCharacters(board) + ' / 100'; });
    var noteCount = $('.board-note > span:last-child b');
    if (noteCount) noteCount.textContent = String(countBoardCharacters(board));
    var controls = $('.pool-controls');
    if (controls) controls.outerHTML = poolControlsMarkup(board);
    updateBoardSaveLabels();
    $all('[data-board-updated]').forEach(function (el) { el.textContent = formatStamp(board.updatedAt); });
    updateArchiveCounts();
    if (focusCharId) {
      window.requestAnimationFrame(function () {
        var card = document.querySelector('.char-card[data-char-id="' + focusCharId + '"]');
        if (card) card.focus();
      });
    }
  }

  /* ── board mutation + share encoding ───────────────────────── */

  function moveCharacterToRow (charId, targetRow, targetIndex, options) {
    var board = state.board;
    if (!board) return;
    var location = characterLocation(board, charId);
    if (!location) return;
    var sourceRow = location.row;
    var char = location.char;
    var target = targetRow === 'pool' ? board.pool : board.tiers[targetRow];
    if (!target) return;
    var index = Number.isInteger(targetIndex) ? clamp(targetIndex, 0, target.length) : target.length;
    if (sourceRow === targetRow && Number.isInteger(targetIndex)) {
      var sourceArray = sourceRow === 'pool' ? board.pool : board.tiers[sourceRow];
      sourceArray.splice(location.index, 1);
      index = clamp(index, 0, target.length);
      target.splice(index, 0, char);
      if (location.index === index) {
        /* Put it back if the reorder is a no-op. */
        target.splice(index, 1);
        sourceArray.splice(location.index, 0, char);
      }
    } else {
      var from = sourceRow === 'pool' ? board.pool : board.tiers[sourceRow];
      from.splice(location.index, 1);
      target.splice(index, 0, char);
    }
    if (sourceRow !== targetRow || target.indexOf(char) !== location.index) {
      board.updatedAt = Date.now();
      persistCurrentBoard(board);
    }
    refreshBoardRows(options && options.focus ? char.id : null);
    var label = targetRow === 'pool' ? 'unassigned' : 'tier ' + targetRow;
    announce(char.name + ' moved to ' + label + '.');
    if (options && options.focus) showToast(char.name.toUpperCase() + ' / ' + (targetRow === 'pool' ? 'UNASSIGNED' : 'TIER ' + targetRow));
  }

  function unassignCharacter (charId) {
    var board = state.board;
    if (!board) return;
    var location = characterLocation(board, charId);
    if (!location || location.row === 'pool') return;
    var source = board.tiers[location.row];
    source.splice(location.index, 1);
    board.pool.push(location.char);
    board.updatedAt = Date.now();
    persistCurrentBoard(board);
    refreshBoardRows(location.char.id);
    announce(location.char.name + ' returned to unassigned.');
    showToast(location.char.name.toUpperCase() + ' / UNASSIGNED');
  }

  function base64UrlEncode (text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlDecode (text) {
    var base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function sharePayloadFromBoard (board) {
    var chars = [];
    var seen = new Set();
    var add = function (char) {
      if (!seen.has(char.id)) {
        seen.add(char.id);
        chars.push([char.id, char.name, char.image || '']);
      }
    };
    var tiers = { S: [], A: [], B: [], C: [], D: [] };
    TIER_KEYS.forEach(function (key) {
      board.tiers[key].forEach(function (char) {
        add(char);
        tiers[key].push(char.id);
      });
    });
    var pool = [];
    board.pool.forEach(function (char) {
      add(char);
      pool.push(char.id);
    });
    return {
      v: 1,
      m: board.mediaId,
      t: board.title,
      tiers: tiers,
      pool: pool,
      chars: chars,
      d: board.type,
      n: board.nativeTitle,
      c: board.cover,
      f: board.format,
      y: board.year,
      a: board.averageScore
    };
  }

  function shareUrlForBoard (board) {
    var payload = sharePayloadFromBoard(board);
    var base = location.href.split('#')[0];
    return base + '#board=' + base64UrlEncode(JSON.stringify(payload));
  }

  function boardFromHash (hash) {
    var raw = String(hash || '');
    if (raw.charAt(0) === '#') raw = raw.slice(1);
    if (raw.indexOf('board=') !== 0) throw new Error('Not a board link');
    var encoded = raw.slice(6);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid board encoding');
    if (encoded.length > 400000) throw new Error('Board link is too large');
    var payload = JSON.parse(base64UrlDecode(encoded));
    return boardFromSharePayload(payload);
  }

  /* ── header / view control ─────────────────────────────────── */

  function syncHeaderUi () {
    $all('[data-view-target], [data-footer-view]').forEach(function (button) {
      var target = button.getAttribute('data-view-target') || button.getAttribute('data-footer-view');
      if (target === state.view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $all('[data-media-type]').forEach(function (button) {
      button.setAttribute('aria-pressed', button.getAttribute('data-media-type') === state.type ? 'true' : 'false');
    });
    if (dom.viewStats) dom.viewStats.hidden = state.view !== 'stats';
    if (dom.statsLayout) dom.statsLayout.hidden = state.view !== 'stats';
    if (dom.viewTiers) dom.viewTiers.hidden = state.view !== 'tiers';
    if (dom.viewRadar) dom.viewRadar.hidden = state.view !== 'radar';
    if (dom.viewLibrary) dom.viewLibrary.hidden = state.view !== 'library';
    if (dom.divisionSwitch) dom.divisionSwitch.hidden = state.view === 'radar' || state.view === 'library' && state.library.mode === 'seasons';
  }

  function switchView (nextView) {
    if (['stats', 'tiers', 'radar', 'library'].indexOf(nextView) === -1) return;
    if (nextView === state.view) return;
    closeMoveMenu(false);
    cancelDrag(false);
    state.view = nextView;
    syncHeaderUi();
    saveUiState();
    if (nextView === 'stats') {
      if (state.statsStatus === 'success' && state.stats) startTitlesLoad(state.stats.name, state.type);
      renderStats();
    } else if (nextView === 'radar') {
      ensureScheduleLibrary();
      startRadarLoad();
    } else if (nextView === 'library') {
      if (state.stats && state.library.mode !== 'seasons') startTitlesLoad(state.stats.name, state.type);
      else if (state.username && state.statsStatus === 'idle' && state.library.mode !== 'seasons') loadStats(state.username);
      renderLibrary();
      if (state.library.mode === 'seasons' && state.catalog.status === 'idle') startCatalog();
    } else {
      renderTiers();
      if (state.tierMode === 'search' && state.search.stale && cleanText(state.search.q, 80)) {
        state.search.stale = false;
        beginSearch(state.search.q, true);
      }
    }
    updateDocumentTitle();
    window.scrollTo(0, 0);
    announce(nextView === 'stats' ? 'Statistics view.' : nextView === 'radar' ? 'Airing radar. Anime schedule in local time.' : nextView === 'library' ? 'My Library.' : 'Tier lists view.');
  }

  function chooseDivision (nextType) {
    if (state.view === 'radar' || state.view === 'library' && state.library.mode === 'seasons') return;
    if (nextType !== 'ANIME' && nextType !== 'MANGA') return;
    if (nextType === state.type) return;
    return runAsyncAction(async function () {
      if (state.board && state.board.shared) {
        var proceed = await askConfirm({
          kicker: 'SHARED / DRAFT',
          title: 'Discard this shared draft?',
          bodyHtml: '<b>' + esc(state.board.title) + '</b> has not been saved on this browser. Switching division will discard its placements.',
          confirmLabel: 'DISCARD DRAFT',
          danger: true
        });
        if (!proceed) return;
      }
      closeMoveMenu(false);
      cancelDrag(false);
      state.type = nextType;
      state.genre = null;
      var collectionId = state.library.collectionId;
      state.library = freshLibrary(state.library.mode);
      state.library.collectionId = collectionId;
      state.discover.seq += 1; state.discover.status = 'idle'; state.discover.rows = [];
      genreTriggerEl = null;
      var wasBoard = Boolean(state.board);
      if (state.board) {
        state.board = null;
        state.tierMode = 'search';
        state.tierFatal = null;
        state.boardRequestSeq = (state.boardRequestSeq || 0) + 1;
        clearShareHash();
      }
      syncHeaderUi();
      saveUiState();
      if (state.view === 'stats' || state.view === 'library') {
        if (cleanText(state.search.q, 80)) {
          state.search.stale = true;
          state.search.status = 'idle';
          state.search.results = [];
          state.search.error = null;
        }
        if (state.stats) startTitlesLoad(state.stats.name, state.type);
        renderProfileView();
        announce(nextType.charAt(0) + nextType.slice(1).toLowerCase() + ' division.');
      } else {
        renderTiers();
        if (wasBoard) window.scrollTo(0, 0);
        if (cleanText(state.search.q, 80)) beginSearch(state.search.q, true);
        announce(nextType.charAt(0) + nextType.slice(1).toLowerCase() + ' division. Search updated.');
      }
    });
  }

  function focusStatsInput () {
    var input = state.view === 'library' ? $('#libraryUsername') : $('#statsUsername');
    if (input) {
      input.focus();
      input.select();
    }
  }

  function focusSearchInput () {
    var input = $('#tierSearchInput');
    if (input) input.focus();
  }

  function focusActiveView () {
    window.scrollTo(0, 0);
    var tab = $('.view-tab[aria-current="page"]');
    if (tab) tab.focus({ preventScroll: true });
  }

  function clearShareHash () {
    if (location.hash.indexOf('#board=') !== 0) return;
    try {
      history.replaceState(null, '', location.href.split('#')[0]);
    } catch (error) {
      /* Browsers that block history.replaceState on file:// keep the hash. */
    }
  }

  /* ── dialogs ───────────────────────────────────────────────── */

  var confirmResolver = null;
  var archiveDialog = null;
  var moveMenu = null;
  var moveMenuTrigger = null;
  var moveMenuCharId = null;
  var dropLine = null;

  function askConfirm (options) {
    var opts = options || {};
    if (!dom.confirm || typeof dom.confirm.showModal !== 'function') {
      return Promise.resolve(window.confirm((opts.title || 'Confirm') + '\n\n' + (opts.body || '')));
    }
    if (confirmResolver) return Promise.resolve(false);
    return new Promise(function (resolve) {
      confirmResolver = resolve;
      var kicker = document.getElementById('dialogKicker');
      var title = document.getElementById('dialogTitle');
      var body = document.getElementById('dialogBody');
      var cancel = document.getElementById('dialogCancel');
      var ok = document.getElementById('dialogOk');
      if (kicker) kicker.textContent = opts.kicker || 'CONFIRM';
      if (title) title.textContent = opts.title || 'Confirm action';
      if (body) body.innerHTML = opts.bodyHtml || esc(opts.body || '');
      if (cancel) cancel.textContent = opts.cancelLabel || 'CANCEL';
      if (ok) {
        ok.textContent = opts.confirmLabel || 'CONFIRM';
        ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
      }
      dom.confirm.returnValue = 'cancel';
      try {
        dom.confirm.showModal();
        if (cancel) window.requestAnimationFrame(function () { var field = body && $('input, select', body); (field || cancel).focus(); });
      } catch (error) {
        confirmResolver = null;
        resolve(false);
      }
    });
  }

  function onConfirmClose () {
    var resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) resolve(dom.confirm.returnValue === 'ok');
  }

  function ensureArchiveDialog () {
    if (archiveDialog && document.documentElement.contains(archiveDialog)) return archiveDialog;
    archiveDialog = document.createElement('dialog');
    archiveDialog.className = 'dialog dialog-wide';
    archiveDialog.id = 'archiveDialog';
    archiveDialog.setAttribute('aria-labelledby', 'archiveDialogTitle');
    archiveDialog.innerHTML = '<div class="dialog-form">' +
      '<p class="dialog-kicker">LOCAL ARCHIVE / <span data-archive-count>' + pad(Object.keys(state.boards).length, 2) + '</span></p>' +
      '<h2 class="dialog-title" id="archiveDialogTitle">Saved boards</h2>' +
      '<p class="dialog-body">Boards live in this browser only. Open one, or delete it with confirmation.</p>' +
      '<div class="archive-dialog-list" data-archive-dialog-list></div>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-action="close-archive">CLOSE</button></div>' +
    '</div>';
    document.body.appendChild(archiveDialog);
    return archiveDialog;
  }

  function openArchiveDialog () {
    var dialog = ensureArchiveDialog();
    var list = dialog.querySelector('[data-archive-dialog-list]');
    if (list) list.innerHTML = archiveRowsMarkup(true);
    var count = dialog.querySelector('[data-archive-count]');
    if (count) count.textContent = pad(Object.keys(state.boards).length, 2);
    if (!dialog.open) {
      try { dialog.showModal(); } catch (error) { /* already modal */ }
    }
  }

  function closeArchiveDialog () {
    if (archiveDialog && archiveDialog.open) {
      try { archiveDialog.close(); } catch (error) { /* not open */ }
    }
  }

  function showCopyDialog (link) {
    var dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.setAttribute('aria-labelledby', 'copyDialogTitle');
    dialog.innerHTML = '<div class="dialog-form">' +
      '<p class="dialog-kicker">COPY / MANUAL</p>' +
      '<h2 class="dialog-title" id="copyDialogTitle">Copy the share link.</h2>' +
      '<p class="dialog-body">Automatic clipboard access is blocked here. Select the link below and copy it.</p>' +
      '<div class="copy-field"><input type="text" readonly value="' + escAttr(link) + '" aria-label="Share link"></div>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-close-copy>CLOSE</button></div>' +
    '</div>';
    document.body.appendChild(dialog);
    var field = dialog.querySelector('input');
    var finished = false;
    function finish () {
      if (finished) return;
      finished = true;
      try { if (dialog.open) dialog.close(); } catch (error) { /* not open */ }
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      if (moveMenuTrigger && document.documentElement.contains(moveMenuTrigger)) moveMenuTrigger.focus();
    }
    var close = dialog.querySelector('[data-close-copy]');
    if (close) close.addEventListener('click', finish);
    dialog.addEventListener('close', finish);
    try { dialog.showModal(); } catch (error) { finish(); return; }
    if (field) {
      window.requestAnimationFrame(function () {
        field.focus();
        field.select();
      });
    }
  }

  /* ── archive actions ───────────────────────────────────────── */

  function discardSharedDraftPrompt (actionLabel) {
    return askConfirm({
      kicker: 'SHARED / DRAFT',
      title: 'Discard this shared draft?',
      bodyHtml: '<b>' + esc(state.board.title) + '</b> has not been saved on this browser. ' + esc(actionLabel || 'Leaving the board') + ' will discard its placements.',
      confirmLabel: 'DISCARD DRAFT',
      danger: true
    });
  }

  function openSavedBoard (mediaId) {
    return runAsyncAction(async function () {
      var id = safeInteger(mediaId);
      var record = state.boards[String(id)];
      if (!record) {
        showToast('BOARD NOT FOUND');
        return;
      }
      closeArchiveDialog();
      closeMoveMenu(false);
      cancelDrag(false);
      if (state.board && state.board.shared) {
        var proceed = await discardSharedDraftPrompt('Opening another board');
        if (!proceed) return;
      }
      var board;
      try {
        board = normalizeBoardRecord(record, { shared: false });
      } catch (error) {
        showToast('BOARD RECORD IS DAMAGED');
        return;
      }
      state.boardRequestSeq = (state.boardRequestSeq || 0) + 1;
      state.board = board;
      if (state.type !== board.type) state.genre = null;
      state.type = board.type;
      state.tierMode = 'board';
      state.tierFatal = null;
      state.view = 'tiers';
      clearShareHash();
      syncHeaderUi();
      saveUiState();
      renderTiers();
      updateDocumentTitle();
      window.scrollTo(0, 0);
      announce('Saved board opened for ' + board.title + '. No profile request was made.');
    });
  }

  function deleteSavedBoard (mediaId) {
    return runAsyncAction(async function () {
      var id = safeInteger(mediaId);
      var record = state.boards[String(id)];
      if (!record) return;
      closeArchiveDialog();
      var proceed = await askConfirm({
        kicker: 'DELETE / LOCAL',
        title: 'Delete this board?',
        bodyHtml: '<b>' + esc(record.title || 'Untitled board') + '</b> and its ' + boardRecordCharCount(record) + ' character placements will be removed from this browser. This cannot be undone.',
        confirmLabel: 'DELETE BOARD',
        danger: true
      });
      if (!proceed) return;
      delete state.boards[String(id)];
      writeBoardsToStorage();
      var wasCurrent = state.board && !state.board.shared && state.board.mediaId === id;
      if (wasCurrent) {
        state.board = null;
        state.tierMode = 'search';
        state.view = 'tiers';
        state.tierFatal = null;
        state.boardRequestSeq = (state.boardRequestSeq || 0) + 1;
        clearShareHash();
        syncHeaderUi();
        saveUiState();
        renderTiers();
        window.scrollTo(0, 0);
      } else {
        saveUiState();
        updateArchiveCounts();
        if (state.view === 'tiers' && state.tierMode === 'search') renderArchiveRegion();
      }
      updateDocumentTitle();
      showToast('BOARD DELETED');
      announce('Board deleted from this browser.');
    });
  }

  function startNewBoard () {
    return runAsyncAction(async function () {
      closeArchiveDialog();
      closeMoveMenu(false);
      cancelDrag(false);
      if (state.board && state.board.shared) {
        var proceed = await discardSharedDraftPrompt('Starting a new board');
        if (!proceed) return;
      }
      state.board = null;
      state.tierMode = 'search';
      state.tierFatal = null;
      state.view = 'tiers';
      state.boardRequestSeq = (state.boardRequestSeq || 0) + 1;
      clearShareHash();
      syncHeaderUi();
      saveUiState();
      renderTiers();
      updateDocumentTitle();
      window.scrollTo(0, 0);
      window.requestAnimationFrame(focusSearchInput);
      announce('New board. Search for a title.');
    });
  }

  function saveSharedCopy () {
    return runAsyncAction(async function () {
      var board = state.board;
      if (!board || !board.shared) return;
      var key = String(board.mediaId);
      var existing = state.boards[key];
      if (existing) {
        var replace = await askConfirm({
          kicker: 'LOCAL / REPLACE',
          title: 'Replace the saved board?',
          bodyHtml: 'A saved board for <b>' + esc(existing.title || board.title) + '</b> already exists. The shared copy will replace its tiers.',
          confirmLabel: 'REPLACE BOARD',
          danger: true
        });
        if (!replace) return;
      }
      var previous = state.boards[key];
      board.shared = false;
      board.updatedAt = Date.now();
      state.boards[key] = serializeBoard(board, true);
      var ok = writeBoardsToStorage();
      if (!ok) {
        board.shared = true;
        if (previous) state.boards[key] = previous;
        else delete state.boards[key];
        writeBoardsToStorage();
        renderTiers();
        showToast('SAVE FAILED / STORAGE UNAVAILABLE');
        return;
      }
      clearShareHash();
      saveUiState();
      renderTiers();
      updateDocumentTitle();
      showToast('BOARD SAVED TO THIS BROWSER');
      announce('Shared board saved locally. The share banner is cleared.');
    });
  }

  /* ── clipboard ─────────────────────────────────────────────── */

  function legacyCopy (text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
    if (area.parentNode) area.parentNode.removeChild(area);
    return copied;
  }

  async function copyText (text) {
    var copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (error) {
      copied = false;
    }
    if (!copied) copied = legacyCopy(text);
    return copied;
  }

  function copyShareLink () {
    return runAsyncAction(async function () {
      var board = state.board;
      if (!board) return;
      var link = shareUrlForBoard(board);
      var copied = await copyText(link);
      if (copied) {
        showToast('SHARE LINK COPIED / ' + everyBoardCharacter(board).length + ' CHARACTERS');
        announce('Share link copied to the clipboard.');
      } else {
        showCopyDialog(link);
        announce('Clipboard access is blocked. The share link is shown for manual copying.');
      }
    });
  }

  /* ── move menu ─────────────────────────────────────────────── */

  function closeMoveMenu (returnFocus) {
    if (!moveMenu) return;
    var trigger = moveMenuTrigger;
    if (moveMenu.parentNode) moveMenu.parentNode.removeChild(moveMenu);
    moveMenu = null;
    moveMenuTrigger = null;
    moveMenuCharId = null;
    if (returnFocus && trigger && document.documentElement.contains(trigger)) {
      try { trigger.focus(); } catch (error) { /* removed */ }
    }
  }

  function openMoveMenu (trigger, charId) {
    var board = state.board;
    var id = safeInteger(charId);
    if (!board || !id) return;
    var char = characterInBoard(board, id);
    var location = characterLocation(board, id);
    if (!char || !location) return;
    if (moveMenu && moveMenuTrigger === trigger) {
      closeMoveMenu(true);
      return;
    }
    closeMoveMenu(false);
    var currentRow = location.row;
    var rows = [
      { key: 'S', label: 'TIER S', color: 'var(--accent)' },
      { key: 'A', label: 'TIER A', color: 'var(--amber)' },
      { key: 'B', label: 'TIER B', color: 'var(--teal)' },
      { key: 'C', label: 'TIER C', color: 'var(--violet)' },
      { key: 'D', label: 'TIER D', color: 'var(--muted)' },
      { key: 'pool', label: 'UNASSIGNED', color: 'var(--muted)' }
    ];
    var menu = document.createElement('div');
    menu.className = 'move-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Move ' + char.name);
    menu.innerHTML = '<div class="move-menu-head">MOVE / ' + esc(char.name) + '</div>' +
      '<div class="move-menu-options">' + rows.map(function (row) {
        var isCurrent = currentRow === row.key;
        return '<button class="move-option" type="button" role="menuitem" data-action="move-char" data-char-id="' + char.id + '" data-target-row="' + row.key + '" style="--tier-color:' + row.color + '" aria-current="' + (isCurrent ? 'true' : 'false') + '">' +
          '<span class="move-option-letter">' + (row.key === 'pool' ? 'U' : row.key) + '</span>' +
          '<span class="move-option-label">' + row.label + '</span>' +
          '<span class="move-option-current">' + (isCurrent ? 'CURRENT' : '') + '</span>' +
        '</button>';
      }).join('') + '</div>';
    document.body.appendChild(menu);
    moveMenu = menu;
    moveMenuTrigger = trigger;
    moveMenuCharId = char.id;
    var triggerRect = trigger.getBoundingClientRect();
    var menuWidth = menu.offsetWidth || 196;
    var menuHeight = menu.offsetHeight || 270;
    var left = clamp(triggerRect.left, 8, window.innerWidth - menuWidth - 8);
    var below = triggerRect.bottom + 6;
    var top = below + menuHeight <= window.innerHeight - 8 ? below : Math.max(8, triggerRect.top - menuHeight - 6);
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.addEventListener('keydown', onMoveMenuKeydown);
    var currentOption = menu.querySelector('[aria-current="true"]');
    var target = currentOption || menu.querySelector('.move-option');
    if (target) window.requestAnimationFrame(function () { if (moveMenu === menu) target.focus(); });
  }

  function onMoveMenuKeydown (event) {
    var options = moveMenu ? $all('.move-option', moveMenu) : [];
    if (!options.length) return;
    var index = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[(index + 1 + options.length) % options.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      options[(index - 1 + options.length) % options.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      options[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      options[options.length - 1].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      var active = document.activeElement;
      if (active && active.classList && active.classList.contains('move-option')) active.click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMoveMenu(true);
    } else if (event.key === 'Tab') {
      closeMoveMenu(false);
    }
  }

  function chooseMoveTarget (charId, targetRow) {
    var board = state.board;
    var id = safeInteger(charId);
    if (!board || !id) return;
    var location = characterLocation(board, id);
    closeMoveMenu(false);
    if (!location) return;
    if (location.row === targetRow) {
      window.requestAnimationFrame(function () {
        var card = document.querySelector('.char-card[data-char-id="' + id + '"]');
        if (card) card.focus();
      });
      announce(location.char.name + ' is already in ' + (targetRow === 'pool' ? 'unassigned' : 'tier ' + targetRow) + '.');
      return;
    }
    moveCharacterToRow(id, targetRow, null, { focus: true });
  }

  /* ── pointer drag ──────────────────────────────────────────── */

  function dragDistance (candidate, event) {
    return Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
  }

  function removeDragListeners (candidate) {
    window.removeEventListener('pointermove', candidate.onPointerMove);
    window.removeEventListener('pointerup', candidate.onPointerUp);
    window.removeEventListener('pointercancel', candidate.onPointerCancel);
    window.removeEventListener('blur', candidate.onWindowBlur);
    document.removeEventListener('touchmove', candidate.onTouchMove, { passive: false });
    document.removeEventListener('contextmenu', candidate.onContextMenu);
  }

  function beginDragCandidate (event) {
    if (state.drag) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.isPrimary === false) return;
    var card = event.target.closest ? event.target.closest('.char-card') : null;
    if (!card) return;
    if (event.target.closest('button')) return;
    if (state.view !== 'tiers' || state.tierMode !== 'board' || !state.board) return;
    var row = card.closest('[data-drop-tier]');
    if (!row) return;
    var rect = card.getBoundingClientRect();
    var candidate = {
      card: card,
      charId: safeInteger(card.getAttribute('data-char-id')),
      sourceRow: row.getAttribute('data-drop-tier'),
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      active: false,
      timer: 0,
      ghost: null,
      autoFrame: 0,
      targetRow: null,
      targetRowEl: null,
      targetIndex: null
    };
    if (!candidate.charId) return;
    state.drag = candidate;
    candidate.onPointerMove = function (moveEvent) { handleDragPointerMove(candidate, moveEvent); };
    candidate.onPointerUp = function (upEvent) { handleDragPointerUp(candidate, upEvent); };
    candidate.onPointerCancel = function () { cleanupDrag(candidate, false); };
    candidate.onWindowBlur = function () { cleanupDrag(candidate, false); };
    candidate.onTouchMove = function (touchEvent) {
      if (state.drag === candidate && candidate.active && touchEvent.cancelable) touchEvent.preventDefault();
    };
    candidate.onContextMenu = function (contextEvent) {
      if (state.drag === candidate && candidate.active) contextEvent.preventDefault();
    };
    window.addEventListener('pointermove', candidate.onPointerMove, { passive: false });
    window.addEventListener('pointerup', candidate.onPointerUp);
    window.addEventListener('pointercancel', candidate.onPointerCancel);
    window.addEventListener('blur', candidate.onWindowBlur);
    document.addEventListener('touchmove', candidate.onTouchMove, { passive: false });
    document.addEventListener('contextmenu', candidate.onContextMenu);
    if (candidate.pointerType === 'touch') {
      candidate.timer = window.setTimeout(function () {
        if (state.drag !== candidate) return;
        activateDrag(candidate);
      }, 220);
    }
  }

  function activateDrag (candidate) {
    if (!candidate || state.drag !== candidate || candidate.active) return;
    if (!document.documentElement.contains(candidate.card)) {
      cleanupDrag(candidate, false);
      return;
    }
    candidate.active = true;
    window.clearTimeout(candidate.timer);
    var rect = candidate.card.getBoundingClientRect();
    var ghost = candidate.card.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('is-source');
    ghost.removeAttribute('tabindex');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = (candidate.lastX - candidate.offsetX) + 'px';
    ghost.style.top = (candidate.lastY - candidate.offsetY) + 'px';
    document.body.appendChild(ghost);
    candidate.ghost = ghost;
    candidate.card.classList.add('is-source');
    document.body.classList.add('is-dragging');
    if (!dropLine) {
      dropLine = document.createElement('div');
      dropLine.className = 'drop-line';
      dropLine.setAttribute('aria-hidden', 'true');
      document.body.appendChild(dropLine);
    }
    dropLine.style.display = 'none';
    updateDragGhost(candidate);
    updateDragTarget(candidate);
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (error) { /* unsupported */ }
    announce('Dragging ' + characterInBoard(state.board, candidate.charId).name + '. Drop on a tier or press Escape.');
    candidate.autoFrame = window.requestAnimationFrame(function () { dragAutoScroll(candidate); });
  }

  function updateDragGhost (candidate) {
    if (!candidate || !candidate.ghost) return;
    candidate.ghost.style.left = (candidate.lastX - candidate.offsetX) + 'px';
    candidate.ghost.style.top = (candidate.lastY - candidate.offsetY) + 'px';
  }

  function dropInsertionIndex (cards, x, y) {
    var index = cards.length;
    for (var i = 0; i < cards.length; i += 1) {
      var rect = cards[i].getBoundingClientRect();
      if (y < rect.top) {
        index = i;
        break;
      }
      if (y <= rect.bottom) {
        if (x < rect.left + rect.width / 2) {
          index = i;
          break;
        }
      }
    }
    return index;
  }

  function updateDropLine (drop, cards, index) {
    if (!dropLine) return;
    if (!drop) {
      dropLine.style.display = 'none';
      return;
    }
    var left = 8;
    var top = 8;
    var height = 70;
    if (cards.length) {
      if (index < cards.length) {
        var reference = cards[index].getBoundingClientRect();
        left = reference.left - 4;
        top = reference.top;
        height = reference.height;
      } else {
        var last = cards[cards.length - 1].getBoundingClientRect();
        left = last.right + 3;
        top = last.top;
        height = last.height;
      }
    } else {
      var dropRect = drop.getBoundingClientRect();
      left = dropRect.left + 12;
      top = dropRect.top + 12;
      height = Math.max(48, Math.min(96, dropRect.height - 24));
    }
    dropLine.style.display = 'block';
    dropLine.style.left = Math.round(clamp(left, 0, window.innerWidth - 2)) + 'px';
    dropLine.style.top = Math.round(clamp(top, 0, window.innerHeight - 2)) + 'px';
    dropLine.style.height = Math.round(clamp(height, 30, window.innerHeight)) + 'px';
  }

  function updateDragTarget (candidate) {
    if (!candidate || !candidate.active) return;
    var pointTarget = document.elementFromPoint(candidate.lastX, candidate.lastY);
    var row = pointTarget && pointTarget.closest ? pointTarget.closest('[data-drop-tier]') : null;
    var previousRows = $all('.tier-row.is-drop-target');
    if (candidate.targetRowEl && candidate.targetRowEl !== row) {
      candidate.targetRowEl.classList.remove('is-drop-target');
    }
    previousRows.forEach(function (el) { if (el !== row) el.classList.remove('is-drop-target'); });
    if (!row) {
      candidate.targetRow = null;
      candidate.targetRowEl = null;
      candidate.targetIndex = null;
      updateDropLine(null, [], 0);
      return;
    }
    row.classList.add('is-drop-target');
    candidate.targetRowEl = row;
    candidate.targetRow = row.getAttribute('data-drop-tier');
    var drop = row.querySelector('.tier-drop');
    if (!drop) {
      candidate.targetRow = null;
      updateDropLine(null, [], 0);
      return;
    }
    var cards = Array.prototype.slice.call(drop.querySelectorAll('.char-card')).filter(function (card) {
      return card !== candidate.card;
    });
    candidate.targetIndex = dropInsertionIndex(cards, candidate.lastX, candidate.lastY);
    updateDropLine(drop, cards, candidate.targetIndex);
  }

  function dragAutoScroll (candidate) {
    if (!candidate || state.drag !== candidate || !candidate.active) return;
    var changed = false;
    var edge = 74;
    var delta = 0;
    if (candidate.lastY < edge) delta = -Math.max(4, Math.round((edge - candidate.lastY) / 5));
    else if (candidate.lastY > window.innerHeight - edge) delta = Math.max(4, Math.round((candidate.lastY - (window.innerHeight - edge)) / 5));
    if (delta) {
      window.scrollBy(0, delta);
      changed = true;
    }
    var row = candidate.targetRowEl;
    if (row && row.scrollWidth > row.clientWidth + 1) {
      var rect = row.getBoundingClientRect();
      if (candidate.lastX < rect.left + 56) {
        row.scrollLeft -= 10;
        changed = true;
      } else if (candidate.lastX > rect.right - 56) {
        row.scrollLeft += 10;
        changed = true;
      }
    }
    if (changed) updateDragTarget(candidate);
    candidate.autoFrame = window.requestAnimationFrame(function () { dragAutoScroll(candidate); });
  }

  function cleanupDrag (candidate, announceCancel) {
    if (!candidate || state.drag !== candidate) return;
    var active = candidate.active;
    window.clearTimeout(candidate.timer);
    window.cancelAnimationFrame(candidate.autoFrame);
    removeDragListeners(candidate);
    if (candidate.ghost && candidate.ghost.parentNode) candidate.ghost.parentNode.removeChild(candidate.ghost);
    if (candidate.card) candidate.card.classList.remove('is-source');
    if (dropLine && dropLine.parentNode) dropLine.parentNode.removeChild(dropLine);
    dropLine = null;
    document.body.classList.remove('is-dragging');
    $all('.tier-row.is-drop-target').forEach(function (el) { el.classList.remove('is-drop-target'); });
    state.drag = null;
    if (announceCancel && active) announce('Drag cancelled.');
  }

  function cancelDrag (shouldAnnounce) {
    if (state.drag) cleanupDrag(state.drag, shouldAnnounce !== false);
  }

  function handleDragPointerMove (candidate, event) {
    if (!candidate || state.drag !== candidate) return;
    candidate.lastX = event.clientX;
    candidate.lastY = event.clientY;
    if (!candidate.active) {
      if (candidate.pointerType === 'touch') {
        if (dragDistance(candidate, event) > 10) cleanupDrag(candidate, false);
        return;
      }
      if (dragDistance(candidate, event) > 5) activateDrag(candidate);
      if (!candidate.active) return;
    }
    if (event.cancelable) event.preventDefault();
    updateDragGhost(candidate);
    updateDragTarget(candidate);
  }

  function handleDragPointerUp (candidate, event) {
    if (!candidate || state.drag !== candidate) return;
    var target = null;
    if (candidate.active && candidate.targetRow) {
      target = { row: candidate.targetRow, index: candidate.targetIndex, charId: candidate.charId };
    }
    cleanupDrag(candidate, false);
    if (target) {
      moveCharacterToRow(target.charId, target.row, target.index, { focus: false });
    } else if (event && event.type === 'pointerup' && candidate.active) {
      announce('Drop cancelled.');
    }
  }

  /* ── generic action safety ─────────────────────────────────── */

  function runAsyncAction (fn) {
    try {
      var result = fn();
      if (result && typeof result.catch === 'function') {
        result.catch(function () {
          showToast('ACTION FAILED / TRY AGAIN');
          announce('The action could not be completed.');
        });
      }
      return result;
    } catch (error) {
      showToast('ACTION FAILED / TRY AGAIN');
      announce('The action could not be completed.');
      return null;
    }
  }

  /* ── events ────────────────────────────────────────────────── */

  function onDocumentClick (event) {
    var radarScope = event.target.closest ? event.target.closest('[data-radar-scope]') : null;
    if (radarScope) {
      state.radar.scope = radarScope.getAttribute('data-radar-scope') === 'MINE' ? 'MINE' : 'ALL';
      ensureScheduleLibrary(); renderRadar(); saveUiState();
      $('[data-radar-scope="' + state.radar.scope + '"]', dom.viewRadar).focus({ preventScroll: true });
      return;
    }
    var radarDay = event.target.closest ? event.target.closest('[data-radar-day]') : null;
    if (radarDay) {
      var day = radarDay.getAttribute('data-radar-day');
      state.radar.day = day;
      $all('[data-radar-day]', dom.viewRadar).forEach(function (button) { button.setAttribute('aria-pressed', button.getAttribute('data-radar-day') === day); });
      $all('.radar-day', dom.viewRadar).forEach(function (section) { section.hidden = day !== 'ALL' && section.getAttribute('data-day') !== day; });
      announce(day === 'ALL' ? 'All week. ' + plural(radarEntries().length, 'scheduled episode') + '.' : radarDay.getAttribute('aria-label'));
      return;
    }
    var libraryMode = event.target.closest ? event.target.closest('[data-library-mode]') : null;
    if (libraryMode && LIBRARY_MODES.indexOf(libraryMode.getAttribute('data-library-mode')) !== -1) {
      state.library.mode = libraryMode.getAttribute('data-library-mode');
      syncHeaderUi();
      if (state.library.mode !== 'seasons') {
        if (state.stats) startTitlesLoad(state.stats.name, state.type);
        else if (state.username && state.statsStatus === 'idle') loadStats(state.username);
      }
      renderLibrary();
      if (state.library.mode === 'seasons' && state.catalog.status === 'idle') startCatalog();
      saveUiState();
      if (state.library.mode === 'pick') drawLibraryPick();
      else {
        var selectedMode = $('[data-library-mode="' + state.library.mode + '"]', dom.viewLibrary);
        if (selectedMode) selectedMode.focus({ preventScroll: true });
      }
      return;
    }
    var genreRow = event.target.closest ? event.target.closest('[data-genre]') : null;
    if (genreRow) {
      openGenre(genreRow.getAttribute('data-genre'), genreRow);
      return;
    }
    var viewButton = event.target.closest ? event.target.closest('[data-view-target], [data-footer-view]') : null;
    if (viewButton) {
      switchView(viewButton.getAttribute('data-view-target') || viewButton.getAttribute('data-footer-view'));
      if (viewButton.hasAttribute('data-footer-view')) focusActiveView();
      return;
    }
    var mediaButton = event.target.closest ? event.target.closest('[data-media-type]') : null;
    if (mediaButton) {
      chooseDivision(mediaButton.getAttribute('data-media-type'));
      return;
    }
    var actionEl = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');
    if (action.indexOf('collection-') === 0) {
      runAsyncAction(function () { return manageCollection(action, actionEl.getAttribute('data-collection-id'), Number(actionEl.getAttribute('data-collection-media')), actionEl.getAttribute('data-collection-type'), actionEl.getAttribute('data-collection-source')); });
    } else if (action === 'open-my-library') {
      state.library.mode = 'browse'; switchView('library'); renderLibrary(); $('#libraryUsername').focus();
    } else if (action === 'retry-my-schedule') {
      ensureScheduleLibrary(); renderRadar();
    } else if (action === 'retry-discover') {
      startDiscover(true);
    } else if (action === 'retry-catalog') {
      startCatalog(true, true);
    } else if (action === 'catalog-prev' || action === 'catalog-next') {
      state.catalog.page = Math.max(1, state.catalog.page + (action === 'catalog-next' ? 1 : -1));
      startCatalog(false, true);
    } else if (action === 'footer-top') {
      focusActiveView();
    } else if (action === 'pick-unfiltered' || action === 'pick-library') {
      var source = action === 'pick-library' ? 'ALL' : state.library.pick.source;
      state.library.pick = freshLibrary().pick;
      state.library.pick.source = source;
      renderLibrary();
      drawLibraryPick();
    } else if (action === 'pick-title') {
      drawLibraryPick();
    } else if (action === 'library-reset') {
      state.library = freshLibrary(state.library.mode);
      renderLibrary();
      var reset = $('[data-action="library-reset"]', dom.viewLibrary);
      if (reset) reset.focus({ preventScroll: true });
    } else if (action === 'library-prev' || action === 'library-next') {
      state.library.page += action === 'library-next' ? 1 : -1;
      renderLibraryResults(true);
    } else if (action === 'retry-library') {
      if (state.stats) startTitlesLoad(state.stats.name, state.type);
      renderLibrary();
    } else if (action === 'radar-prev' || action === 'radar-next' || action === 'radar-today') {
      changeRadarWeek(action === 'radar-prev' ? -1 : action === 'radar-next' ? 1 : 0);
    } else if (action === 'retry-radar') {
      startRadarLoad(new Date(state.radar.weekStart));
    } else if (action === 'retry-ann') {
      startAnnLoad(true);
    } else if (action === 'close-genre') {
      closeGenre();
    } else if (action === 'open-media') {
      openMediaBoard(actionEl.getAttribute('data-media-id'));
    } else if (action === 'open-archive') {
      openArchiveDialog();
    } else if (action === 'close-archive') {
      closeArchiveDialog();
    } else if (action === 'new-board') {
      startNewBoard();
    } else if (action === 'copy-share') {
      copyShareLink();
    } else if (action === 'save-shared-copy') {
      saveSharedCopy();
    } else if (action === 'open-saved') {
      openSavedBoard(actionEl.getAttribute('data-media-id'));
    } else if (action === 'delete-saved') {
      deleteSavedBoard(actionEl.getAttribute('data-media-id'));
    } else if (action === 'retry-stats') {
      loadStats(state.username);
    } else if (action === 'focus-stats') {
      focusStatsInput();
    } else if (action === 'retry-search') {
      retrySearch();
    } else if (action === 'retry-characters') {
      retryCharacters();
    } else if (action === 'load-more') {
      if (state.board && !state.board.loading && state.board.hasNext) {
        loadBoardCharacters((state.board.page || 0) + 1);
      }
    } else if (action === 'open-move') {
      var card = actionEl.closest('.char-card');
      if (card) openMoveMenu(card, actionEl.getAttribute('data-char-id'));
    } else if (action === 'unassign') {
      unassignCharacter(actionEl.getAttribute('data-char-id'));
    } else if (action === 'move-char') {
      chooseMoveTarget(actionEl.getAttribute('data-char-id'), actionEl.getAttribute('data-target-row'));
    }
  }

  function onDocumentSubmit (event) {
    if (event.target && event.target.closest && event.target.closest('#confirmDialog')) return;
    if (event.target && event.target.id === 'catalogForm') {
      event.preventDefault();
      var fields = event.target.elements;
      if (!event.target.checkValidity()) return;
      ['season', 'genre', 'format', 'score', 'sort'].forEach(function (key) { state.catalog[key] = fields.namedItem(key).value; });
      state.catalog.year = Number(fields.namedItem('year').value);
      state.catalog.page = 1; startCatalog(false, true);
    } else if (event.target && (event.target.id === 'statsForm' || event.target.id === 'libraryProfileForm')) {
      event.preventDefault();
      var statsInput = $('input[name="username"]', event.target);
      loadStats(statsInput ? statsInput.value : state.username);
    } else if (event.target && event.target.id === 'tierSearchForm') {
      event.preventDefault();
      var searchInput = document.getElementById('tierSearchInput');
      if (searchInput) beginSearch(searchInput.value, true);
    }
  }

  function onDocumentInput (event) {
    if (!event.target) return;
    if (event.target.id === 'librarySearch') {
      state.library.search = event.target.value;
      state.library.page = 1;
      renderLibraryResults();
    } else if (event.target.id === 'statsUsername' || event.target.id === 'libraryUsername') {
      state.username = event.target.value;
      saveUiState();
    } else if (event.target.id === 'tierSearchInput') {
      if (state.view === 'tiers' && state.tierMode === 'search') beginSearch(event.target.value, false);
    }
  }

  function onDocumentChange (event) {
    if (event.target && event.target.hasAttribute('data-profile-source')) { changeProfileSource(event.target.value); return; }
    if (event.target && event.target.id === 'radar-list-status') {
      state.radar.listStatus = event.target.value; renderRadar(); saveUiState(); return;
    }
    if (event.target && event.target.id === 'collectionSelect') {
      state.library.collectionId = event.target.value; renderLibrary(); return;
    }
    var libraryKey = event.target && event.target.getAttribute('data-library-filter');
    if (['status', 'genre', 'format', 'year', 'score', 'sort'].indexOf(libraryKey) !== -1) {
      state.library[libraryKey] = event.target.value;
      state.library.page = 1;
      renderLibraryResults();
      return;
    }
    var pickKey = event.target && event.target.getAttribute('data-pick-filter');
    if (['source', 'genre', 'format', 'mood', 'limit'].indexOf(pickKey) !== -1) {
      if (pickKey === 'source') state.library.pick = freshLibrary().pick;
      state.library.pick[pickKey] = event.target.value;
      state.library.pick.id = null;
      renderLibrary();
      announce(plural(pickCandidates().length, state.library.pick.source === 'PLANNING' ? 'matching planned title' : 'matching title') + '.');
      return;
    }
    var key = event.target && event.target.getAttribute('data-genre-filter');
    if (!state.genre || ['status', 'format', 'sort'].indexOf(key) === -1) return;
    state.genre[key] = event.target.value;
    renderGenrePanel(key);
  }

  function onDocumentKeydown (event) {
    if (event.key === 'Escape') {
      if (state.drag) {
        event.preventDefault();
        cancelDrag(true);
        return;
      }
      if (moveMenu) {
        event.preventDefault();
        closeMoveMenu(true);
        return;
      }
      if (state.genre && state.view === 'stats' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        closeGenre();
        return;
      }
    }
    var genreRow = event.target && event.target.closest ? event.target.closest('[data-genre]') : null;
    if (genreRow && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openGenre(genreRow.getAttribute('data-genre'), genreRow);
      return;
    }
    var card = event.target && event.target.closest ? event.target.closest('.char-card') : null;
    if (card && event.target === card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openMoveMenu(card, card.getAttribute('data-char-id'));
    }
  }

  function onDocumentPointerDown (event) {
    if (moveMenu && !moveMenu.contains(event.target) && !(event.target.closest && event.target.closest('[data-action="open-move"]'))) {
      closeMoveMenu(false);
    }
    if (event.target.closest && event.target.closest('.move-menu')) return;
    beginDragCandidate(event);
  }

  function onWindowScroll () {
    if (moveMenu) closeMoveMenu(false);
  }

  function onWindowResize () {
    if (moveMenu) closeMoveMenu(false);
  }

  function onWindowBlur () {
    cancelDrag(false);
  }

  function onImageError (event) {
    var image = event.target;
    if (image && image.tagName === 'IMG') image.classList.add('is-broken');
  }

  function onDocumentContextMenu (event) {
    if (state.drag && state.drag.active) event.preventDefault();
  }

  function onHashChange () {
    var hash = location.hash || '';
    if (hash.indexOf('#board=') !== 0) return;
    closeMoveMenu(false);
    cancelDrag(false);
    closeArchiveDialog();
    try {
      var board = boardFromHash(hash);
      state.board = board;
      if (state.type !== board.type) state.genre = null;
      state.type = board.type;
      state.tierMode = 'board';
      state.tierFatal = null;
      state.view = 'tiers';
      syncHeaderUi();
      saveUiState();
      renderTiers();
      updateDocumentTitle();
      window.scrollTo(0, 0);
      announce('Shared board loaded. Save a copy to keep it.');
    } catch (error) {
      state.board = null;
      state.tierMode = 'search';
      state.tierFatal = {
        title: 'This share link is unreadable.',
        body: 'The share data is incomplete or from an unsupported version. Start a new board; no profile request was made for this link.'
      };
      state.view = 'tiers';
      clearShareHash();
      syncHeaderUi();
      renderTiers();
      updateDocumentTitle();
      announce('This share link is unreadable. No AniList request was made.');
    }
  }

  function bindEvents () {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('submit', onDocumentSubmit);
    document.addEventListener('input', onDocumentInput);
    document.addEventListener('change', onDocumentChange);
    document.addEventListener('keydown', onDocumentKeydown);
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('error', onImageError, true);
    document.addEventListener('contextmenu', onDocumentContextMenu);
    window.addEventListener('scroll', onWindowScroll, true);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('hashchange', onHashChange);
    if (dom.confirm) dom.confirm.addEventListener('close', onConfirmClose);
  }

  /* ── initial routing ───────────────────────────────────────── */

  function applySharedHash (hash, initial) {
    try {
      var shared = boardFromHash(hash);
      state.board = shared;
      if (state.type !== shared.type) state.genre = null;
      state.type = shared.type;
      state.tierMode = 'board';
      state.tierFatal = null;
      state.view = 'tiers';
      syncHeaderUi();
      if (initial) saveUiState();
      renderTiers();
      updateDocumentTitle();
      if (initial) {
        announce('Shared board loaded. Save a copy to keep it.');
      } else {
        window.scrollTo(0, 0);
        announce('Shared board loaded. Save a copy to keep it.');
      }
      return true;
    } catch (error) {
      state.board = null;
      state.tierMode = 'search';
      state.tierFatal = {
        title: 'This share link is unreadable.',
        body: 'The share data is incomplete or from an unsupported version. Start a new board; no profile request was made for this link.'
      };
      state.view = 'tiers';
      clearShareHash();
      syncHeaderUi();
      renderTiers();
      updateDocumentTitle();
      announce('This share link is unreadable. No AniList request was made.');
      return true;
    }
  }

  function initialize () {
    cacheDom();
    state.collections = loadCollections();
    loadBoardsFromStorage();
    bindEvents();
    tickClock();
    window.setInterval(tickClock, 30000);

    var ui = loadUiState();
    if (ui) {
      state.type = ui.type;
      state.source = ui.source;
      state.username = ui.username;
      state.library.mode = ui.libraryMode;
      state.radar.scope = ui.radarScope;
      state.radar.listStatus = ui.radarListStatus;
    }

    var handledHash = false;
    if (location.hash && location.hash.indexOf('#board=') === 0) {
      handledHash = applySharedHash(location.hash, true);
    }

    if (!handledHash) {
      if (ui && ui.view === 'tiers' && ui.activeMediaId && state.boards[String(ui.activeMediaId)]) {
        try {
          var board = normalizeBoardRecord(state.boards[String(ui.activeMediaId)], { shared: false });
          state.board = board;
          state.type = board.type;
          state.tierMode = 'board';
          state.view = 'tiers';
        } catch (error) {
          state.board = null;
          state.tierMode = 'search';
          state.view = 'tiers';
        }
      } else if (ui) {
        state.view = ui.view;
        state.tierMode = 'search';
      }
      syncHeaderUi();
      saveUiState();
      if (state.view === 'tiers') renderTiers();
      else if (state.view === 'radar') { ensureScheduleLibrary(); startRadarLoad(); }
      else if (state.view === 'library') {
        renderLibrary();
        if (state.library.mode === 'seasons') startCatalog();
        else if (state.username) loadStats(state.username);
      }
      else renderStats();
    }
    updateDocumentTitle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }




})();
