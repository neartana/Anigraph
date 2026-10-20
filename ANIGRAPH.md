# ANIGRAPH — Brief, Build Spec & Roadmap

**Status:** P0, genre drill-downs, ANN Wire, Airing Radar, My Library and Pick for Me are implemented.
My Schedule, Discover for Me, Seasonal Explorer and browser-local Custom Collections are
also implemented as requested extensions. See README.md for their behavior and acceptance-19
for verification; their current implementation supersedes any earlier roadmap-only wording.
F5, F7–F8 and the P2–P3/parked features remain roadmap items. The accepted AniList-blue palette
in the app supersedes the original red palette below.
The seven statistics panels have also received a taste design pass: stronger headings,
clear score ranges, status shares, consistent chart colors and readable ranked rows on
desktop and phones. Data and controls remain unchanged; acceptance is 282/282 browser
checks plus 14/14 proxy checks (qa/artifacts/acceptance-6/).
The subsequent artwork pass adds real AniList covers to profile/title/genre/schedule
records and publisher-supplied ANN news images, with responsive layouts and safe fallbacks.
The browser-comment pass removes the feed/time rail, shows full banners with a bottom
fade, labels the news section NEWS and uses compact news thumbnails.
The next cleanup removes decorative panel numbers, repeated ANN tags and the news-to-search
action; headlines and thumbnails link directly to their source article. The latest layout
pass centers the unnumbered navigation and compacts all six aggregate panels without
stretching short cards. Verification is 128/128 focused regression checks plus 71/71
layout checks (acceptance-10/); the preceding full run passed 347/347 (acceptance-8/).
Top genres subsequently matches the score card's height with a scrollable ten-row list;
51/51 focused checks passed for both divisions at five widths (acceptance-11/).
The latest styling update aligns desktop stat cards in pairs, reduces genre type,
themes scrollbars, softens corners and removes decorative dividers. It passed 128/128
focused regression checks plus 87/87 layout/genre checks (acceptance-12/).
The self-improvement follow-up adds sticky genre columns, a source-derived leading-format
share and 44px division/week controls. It passed 177/177 regression checks plus 127/127
layout/genre checks (acceptance-13/).
My Library and Pick for Me now share a fully paginated public collection. Library adds
cover browsing, alias search, combined filters and sorting; the picker draws from
Planning with genre/format/mood/length preferences. Verification passed 347 regression
checks (with successful follow-ups), 65 feature checks, 22 live checks and 127 layout
checks in acceptance-14/. No dependencies or server routes were added.
A shared footer adds section navigation, source credits, copyright and Back to top;
23/23 focused checks passed across six widths (acceptance-15/).
The unchanged server's
14/14 proxy and 7/7 targeted ANN image checks remain in acceptance-7/.
**Deliverable:** one web app that (a) graphs an AniList user's anime/manga stats,
(b) builds character tier lists per title, and (c) grows into a small suite of read-only
AniList tools plus an Anime News Network wire.
**How to use this doc:** it is the single source of truth. §12 is a paste-ready prompt for a
coding agent; §9 defines what ships when.

---

## 1. Product

| | |
|---|---|
| Who | AniList users who like numbers and rankings |
| Job 1 | Enter any public username → see your anime/manga stats as graphs |
| Job 2 | Pick an anime or manga → drag its characters into S/A/B/C/D tiers → save & share |
| Job 3 (P1+) | Stay current: ANN headlines + an airing radar, inside the same shell |

Non-goals: social network, MAL import, a second watch tracker. AniList already tracks; we read.

---

## 2. Non-negotiable constraints

- No build step, no framework, no JS dependencies. Plain HTML/CSS/JS.
- Classic `<script>` tags (not `type="module"`) so P0 also runs from `file://`.
- Data: AniList GraphQL + Anime News Network only. No API keys, no analytics, no database.
- OAuth is **not** used in P0/P1. Read-only public data. (OAuth is P3, §9.)
- External resources: AniList/ANN artwork and Google Fonts only. No chart library —
  aggregate charts are hand-rolled SVG, with a semantic image list for title progress.
- Persistence: `localStorage`. Sharing: URL hash. Cache: `sessionStorage`, 5-minute TTL.
- Rate limits respected everywhere (AniList ~90 req/min; ANN ~1 req/s). Handle HTTP 429 with
  `Retry-After` and a visible countdown + retry action.
- Never fabricate data. Missing field → em dash or an explicit empty state.

---

## 3. Architecture & files

```
index.html      # shell, panels, templates
styles.css      # design tokens + all styling
app.js          # everything else (classic script)
server.js       # P1: static file server + ANN proxy (/api/ann/*)
ANIGRAPH.md     # this document
```

`app.js` sections, in order: `gql`/`annFetch`, cache, error mapping, SVG chart helpers,
stats view, tier-list view, news wire, UI helpers (states, focus, a11y).

`server.js` exists only because ANN sends no CORS headers (§4.3). Without it the app must
still work: every network feature other than the news panel is direct-to-AniList.

---

## 4. Data layer

### 4.1 AniList GraphQL

- Endpoint: `POST https://graphql.anilist.co`, headers `Content-Type: application/json`,
  body `{ "query": "...", "variables": {...} }`. No `Authorization` header.
- One helper `gql(query, variables)` → returns `data`, caches successful results in
  `sessionStorage` under `anigraph:cache:<sha of query+vars>` for 300 s, throws a typed error
  carrying the GraphQL message, HTTP status and `Retry-After`.
- Limits: ~90 requests/min, `perPage` max 50, list chunks max 500. Cache is shared by stats,
  search, characters, and every later feature.
- Unknown username → `User` is `null` with a `"Not Found"` error. Private profile → `statistics`
  null. These are two different messages, not a generic failure.

### 4.2 Queries

**A — user statistics (P0)**
```graphql
query UserStats($name: String) {
  User(name: $name) {
    id name
    avatar { medium }
    statistics {
      anime {
        count meanScore minutesWatched episodesWatched
        scores { score count }
        statuses { status count }
        formats { format count }
        genres { genre count meanScore }
        releaseYears { releaseYear count }
        startYears { startYear count }
      }
      manga {
        count meanScore chaptersRead volumesRead
        scores { score count }
        statuses { status count }
        formats { format count }
        genres { genre count meanScore }
        releaseYears { releaseYear count }
        startYears { startYear count }
      }
    }
  }
}
```

**B — media search (P0)**
```graphql
query SearchMedia($q: String, $type: MediaType) {
  Page(page: 1, perPage: 12) {
    media(search: $q, type: $type, sort: SEARCH_MATCH) {
      id type
      title { romaji english native }
      coverImage { large }
      format episodes chapters averageScore
      startDate { year }
    }
  }
}
```

**C — characters of a media (P0)**
```graphql
query MediaCharacters($id: Int, $page: Int) {
  Media(id: $id) {
    id
    title { romaji english native }
    coverImage { large }
    averageScore
    characters(page: $page, perPage: 25, sort: [ROLE, RELEVANCE, ID]) {
      pageInfo { currentPage hasNextPage }
      edges {
        role
        node { id name { full native } image { large medium } favourites }
      }
    }
  }
}
```

**D — complete personal collection (My Library and Pick for Me)**
```graphql
query UserTitles($name: String, $type: MediaType, $chunk: Int!) {
  MediaListCollection(userName: $name, type: $type, chunk: $chunk, perChunk: 500) {
    hasNextChunk
    lists { entries {
      progress status score(format: POINT_100)
      media {
        id title { romaji english native } coverImage { large }
        format episodes duration chapters genres startDate { year }
      }
    } }
  }
}
```
Public lists only. Follow hasNextChunk and deduplicate across every chunk. This query
also serves Top titles and genre drill-downs. Library filters the complete collection
locally and displays 48 cards per page. Pick for Me draws only from PLANNING, filters
genre/format/mood/length, and avoids an immediate repeat when possible. Anime limits use
duration per episode/film; manga limits use chapter counts, with unknown lengths excluded
only when a limit is set. Null, malformed or interrupted collections show an honest
empty/error state. F5 community comparison remains unimplemented.

**Later features reuse:** `Media.nextAiringEpisode`, `Page.airingSchedules`, `Media.relations`,
`Page.staff` / `Staff.characters` / `Staff.staffMedia`, `Page.reviews`, `Media.rankings`,
`Media.recommendations`, `Media.externalLinks`, `Media.stats`. Exact per-feature mapping is in §5.4.

### 4.3 Anime News Network (news + encyclopedia)

Two different things, often confused:

| Source | What it gives | Endpoint (verify paths) |
|---|---|---|
| ANN RSS | Headlines — this is "news" | `animenewsnetwork.com/news/rss.xml`, `/all/rss.xml`, `/interest/rss.xml` |
| ANN Encyclopedia API | XML records: staff, cast, alt titles, genres, ANN rating | `cdn.animenewsnetwork.com/encyclopedia/api.xml?title=…` |

Neither is known to send CORS headers, hence the proxy in `server.js`:

- `GET /api/ann/news` → parse RSS and bounded article-image metadata → JSON:
  `{ title, link, publishedAt, summary, source, imageUrl? }`. Images come from each news
  article's publisher metadata; missing images preserve text headlines.
- `GET /api/ann/title?q=` → parse encyclopedia XML → JSON (roadmap, not implemented).
- Both: 10-minute in-memory cache, descriptive `User-Agent`, max 1 request/second.
- Etiquette: headline + link + short excerpt only, with visible "via Anime News Network"
  attribution. Never mirror article bodies.
- Fallback: proxy unreachable (e.g. `file://`) → panel shows `WIRE OFFLINE — open ann.net`,
  and nothing else in the app is blocked.

---

## 5. Features

### 5.1 Stats view (P0)

- Command bar: username input + **Load** + Anime/Manga segmented toggle. Enter submits.
  Last username and type persist in `localStorage`.
- Loading: skeleton panels matching final shapes (no spinners).
- Header: avatar, display name, caption `PROFILE / {name}`.
- Summary strip (hairline-divided cells, not floating cards) — 4 values per mode:
  Anime: Titles, Mean Score, Episodes, Days Watched (`minutesWatched/1440`);
  Manga: Titles, Mean Score, Chapters, Volumes.
- Six SVG charts, each in a captioned panel:
  `SCORE DISTRIBUTION` (10–100 bins) · `STATUS` · `FORMATS` · `GENRES / 010` (top 10 by count,
  mean score as secondary mono value) · `RELEASE YEARS` · `START YEARS`.
- Chart rules: SVG `viewBox`, flat fills from tokens, 1px rules, mono 11px axes, `<title>` per
  bar, one grow animation on mount, `aria-label` summary per panel, single column under 900px.
- Zero data → friendly empty panel per chart. Error → not found / private / rate limited /
  network, each with exactly one action.

### 5.2 Tier list view (P0)

- Search field, 300 ms debounce (Query B). Results: cover grid with title (romaji → english →
  native), format + year, average score. The header's Anime/Manga toggle applies here too.
- Selecting a title opens the board: cover, title, format/year, community average score,
  **Saved boards** switcher, **New board**.
- Characters: first 25 auto-loaded (Query C) into the **UNASSIGNED** pool as 3:4 cards
  (image + name). "Load more characters" → next page, max 5 pages (125). Board cap: 100 characters.
- Board: fixed tiers **S, A, B, C, D** + UNASSIGNED. Huge mono letter, hairline divider, drop zone.
- Drag & drop via **Pointer Events** (must work on touch, so no HTML5 DnD): drag → valid rows
  highlight → drop appends or reorders within a row; Escape cancels; `×` returns a card to the pool.
- Keyboard: every card focusable, with a **move** button opening an S/A/B/C/D/UNASSIGNED menu;
  arrows + Enter + Escape; visible focus ring throughout.
- Auto-save on every change; character snapshots stored with the board so it restores offline.
- Share: **Copy share link** → base64url JSON in `#board=…`; opening a hash renders the board
  with zero API calls plus a "Shared board — save a copy?" banner.

### 5.3 ANN Wire panel (P1)

Stats view, beside the charts. Five latest headlines: relative time, compact thumbnail,
and direct source links on the headline and image, with "via Anime News Network"
attribution below the list. Repeated source tags and the Find on AniList action were
removed following browser feedback. Encyclopedia enrichment (F11) remains a roadmap item.

### 5.4 Feature catalogue — every idea, with phase

| # | Feature | Pitch | Key API | Effort | Phase |
|---|---|---|---|---|---|
| F1 | Stats dashboard | Your anime/manga numbers as graphs | A | S | **P0** |
| F2 | Character tier lists | Rank characters of any title, save & share | B, C | M | **P0** |
| F3 | ANN Wire | Anime news headlines in-app | ANN RSS proxy | S | **P1** |
| F4 | Airing Radar | Week board of current shows + next-episode countdowns, local time | `Media.nextAiringEpisode`, `Page.airingSchedules` | S | **P1** |
| F5 | Contrarian Score Map | Where your scores disagree with the crowd, and your correlation | D + `Media.averageScore/meanScore/stats` | S–M | **P1** |
| F6 | Pick for Me | Genre/format/mood/length → random planned anime or manga with its cover and source link | D | S | **P1 — implemented** |
| F7 | Hidden Gems | High score, low popularity — underrated per tag/year | `Page.media(sort: SCORE_DESC, popularity_lesser)` + `rankings` | S | **P1** |
| F8 | Blind-spot Finder | "You own no horror — here are 5 acclaimed ones" | A + `Page.media(tag_in, sort: SCORE_DESC)` | S–M | **P1** |
| F9 | Year in Review poster | Shareable recap: hours, top genres, longest binge, blind spot | A only | S | **P2** |
| F10 | Franchise Mapper | Relation graph → full watch-order tree, flags what's missing from your list | `Media.relations` (recursive) | M | **P2** |
| F11 | ANN encyclopedia chips | Staff/cast/rating AniList lacks, on the board header | ANN `/api/ann/title` | S | **P2** |
| F12 | Seiyuu Explorer | Everything your favourite voice actor is in, joined against your list | `Page.staff`, `Staff.characters`, `Staff.staffMedia` | M | **P2** |
| F13 | Character Bracket | Head-to-head tournament seeded by favourites; shareable bracket | `Page.characters`, `Character.favourites` | S–M | **P2** |
| F14 | Review Digest | Review-score histogram + top reviewers per title | `Page.reviews(mediaId)` | S | **P2** |
| F15 | What to Read First | Manga whose adaptation cut content | `source`, `relations`, chapters vs episodes | M | **P2** |
| F16 | Six Degrees | Shortest path between two titles via relations/staff/genres | BFS over relations + `Page.staff` | L | **P3** |
| F17 | Keyboard list editor | Bulk score/status edits, private lists | OAuth implicit grant + `SaveMediaListEntry` | M | **P3** |
| F18 | Notifications / following feed | Airing and activity notifications | OAuth + `Notification`, `Page.activities` | M | **P3** |
| F19 | Community tier-list gallery | Vote and browse public boards | Needs a backend | L | Parked |
| F20 | Cover palette wall | Poster shelf grouped by dominant colour | Canvas + image CORS risk | M | Parked |
| F21 | My Library | Complete public collection, cover grid, search, combined filters, sorting and page controls | D | M | **P1 — implemented** |

Rule: each new feature lands as a view or panel in the same shell, reusing the API cache, chart
helpers and design tokens. No new app, no new dependency.

---

## 6. Design system — "late-night anime broadcast" (binding)

Direction: a restrained dark broadcast control panel with anime eyecatch framing, subtitle
typography and episode-index numbers. Not a SaaS dashboard, not cyberpunk neon, no wallpapers.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0B0D12` | page background |
| `--panel` | `#11151D` | panel surface |
| `--rule` | `#242A38` | 1px hairlines, dividers |
| `--paper` | `#F2F0EA` | primary text |
| `--muted` | `#8B93A7` | captions, secondary |
| `--accent` | `#FF4D5A` | emphasis only (≤5% of screen) |
| `--teal` / `--violet` / `--amber` | `#4FD1C5` / `#A78BFA` / `#E8B25C` | chart series |

- Radii 2–4px. **No** box shadows, gradients, glassmorphism, pills, emoji.
- Type: **Zen Kaku Gothic New** (400/500/700/900) for UI/headings — covers Japanese glyphs for
  native titles; **JetBrains Mono** (400/500) for labels, numbers, captions, tier letters.
  Google Fonts with `display=swap`. The default system font is never the design.
- Layout: max-width 1200px; 24px gutter desktop / 16px mobile; 12-column grid. Summary values in
  clamp(40–72px). Chart panels use readable headings and short captions without decorative numbers.
- Tier board: anime magazine ranking chart — tier letters clamp(56–96px) mono, hairline rows,
  3:4 character cards.
- Motion: 30 ms entry stagger, bars grow once, drag lift with 1.5° rotation, 160 ms ease-out;
  `prefers-reduced-motion` disables stagger and growth.
- Accessibility: WCAG AA contrast, 2px accent `:focus-visible` ring, semantic headings, labeled
  inputs, `aria-live` for loading/errors, keyboard-operable tier moves.
- Responsive: verify 1440 / 768 / 390. Charts stack under 900px; summary strip 2×2 under 720px;
  tier rows scroll horizontally with a sticky letter column under 600px.

---

## 7. States & copy

Terse, catalogue-like, no exclamation marks. Required states: empty (how to start) · user not
found · private profile · rate limited (countdown) · network error (retry) · zero-data chart ·
no search results · no saved boards · proxy offline (news only) · shared-board banner.

---

## 8. Persistence & share formats

```
anigraph:v1:prefs   { username, type }                     # restored on reload
anigraph:v1:boards  { "<mediaId>": Board }                 # one entry per saved board
Board = {
  mediaId, title, coverImage, updatedAt,
  tiers: { S:[charId], A:[], B:[], C:[], D:[] },
  pool:  [charId],
  chars: { "<charId>": { name, image } }                   # snapshot, so boards restore offline
}
Share hash: #board=<base64url(JSON)>
  { v:1, m:mediaId, t:title,
    tiers:{S:[],A:[],B:[],C:[],D:[]}, pool:[],
    chars:[[id,name,image], ...] }
Cache: anigraph:cache:<sha> -> { at, data }   # sessionStorage, TTL 300s
```
Caps: 100 characters per board (bounds the share URL); keep share payloads under ~12 KB.
Opening a shared hash renders without API calls and offers "save a copy".

---

## 9. Roadmap

**P0 — MVP (ships alone):** F1 stats + F2 tier lists. Files: `index.html`, `styles.css`, `app.js`.
*Done when:* a real username renders real numbers and all six charts; a title loads characters;
drag/drop + keyboard moves work; reload restores the board; share link reproduces it in a fresh
browser profile; no console errors; works from `file://` and a local server; 390px clean.

**P1 — quick wins:** F3 ANN Wire (+ `server.js` proxy), F4 Airing Radar, F5 Contrarian Score Map,
F6 Tonight's Pick, F7 Hidden Gems, F8 Blind-spot Finder.
*Done when:* each is a panel/view in the same shell, each has empty + error states, and the app
still works with the proxy absent.

**P2 — depth:** F9 Year in Review poster, F10 Franchise Mapper, F11 ANN encyclopedia chips,
F12 Seiyuu Explorer, F13 Character Bracket, F14 Review Digest, F15 What to Read First.
*Done when:* each reuses the existing cache/chart/token layer with no new dependency.

**P3 — needs auth or heavy graph work:** F16 Six Degrees, F17 OAuth keyboard list editor,
F18 Notifications/following feed.

**Parked:** F19 (needs a backend), F20 (image CORS), MAL import, i18n, comments, PNG export.

---

## 10. Acceptance criteria

1. Real public username → real numbers; Anime/Manga toggle updates cards and charts.
2. Unknown user / private profile / rate limit / offline each show their own state with one action.
3. Title search returns real results; selecting one loads characters with images.
4. A character can be dragged to S with a mouse and with touch emulation.
5. Reload restores the exact board from `localStorage`.
6. Keyboard-only: move a card between tiers via the menu; focus ring always visible.
7. A share link in a fresh profile (empty `localStorage`) reproduces the board with no refetch.
8. No console errors; network requests only to `anilist.co`, `fonts.googleapis.com`/`gstatic.com`,
   and — when the proxy is used — the local `/api/ann/*` routes.
9. 390px wide: no page-level horizontal scroll.
10. `prefers-reduced-motion`: no stagger or grow animations.
11. Works served locally and opened via `file://` (P0 features; news shows the offline state).

---

## 11. Out of scope

OAuth/login (until P3), private profiles, watch-tracking writes, MAL import, comments, PNG export,
recommendation ML, user-to-user comparison, i18n, any backend beyond the ANN proxy.

---

## 12. Paste-ready build prompt (P0 + optional P1 news)

```text
Build "Anigraph" per ANIGRAPH.md sections 3-8. Ship P0 (F1 stats, F2 tier lists) first.

Stack: plain HTML/CSS/JS, no build step, no framework, no JS libraries. Files: index.html,
styles.css, app.js. Classic script tags so file:// works. Google Fonts only.
Data: AniList public GraphQL (POST https://graphql.anilist.co, no auth) using queries A-C from
section 4.2, cached in sessionStorage for 5 minutes, HTTP 429 handled with Retry-After.
No OAuth, no backend (P0), no data fabrication.

Views: section 5.1 (command bar, summary strip, six hand-rolled SVG charts, per-chart empty and
error states) and section 5.2 (debounced media search, paginated characters, S/A/B/C/D board
with UNASSIGNED pool, Pointer-Event drag & drop, keyboard move menu, localStorage auto-save,
base64url share links in the URL hash).
Design: section 6 tokens and rules are binding — "late-night anime broadcast", no SaaS defaults.
States/copy: section 7. Data shapes and caps: section 8.

Process: build in four phases - shell+API+cards, charts, tier board, persistence+share+polish -
smoke-testing after each. If the design-taste-frontend (tasteskill v2) skill is available, load
it, write a 5-line design brief, then build and run a screenshot look-and-fix loop at 1440/768/390.
Verify all of section 10 before declaring done. Report files, how to run, and anything skipped.

Optional P1 add-on: section 4.3 + 5.3 ANN Wire with server.js proxy; the app must still work
when the proxy is unavailable.
```

---

## 13. Risks & open questions

| Risk | Impact | Mitigation |
|---|---|---|
| Query fields unverified against the live schema (`startYears`, `MediaListCollection` privacy) | A chart or the score chip may error | Drop the affected chart/chip; nothing else depends on it |
| ANN CORS + exact RSS/encyclopedia paths unverified | News proxy may need path/parse changes | Proxy is isolated in `server.js`; app degrades to "WIRE OFFLINE" |
| AniList ~90 req/min | Late-phase features (F10, F16) can exhaust it | Shared 5-min cache; cap BFS depth; page limits |
| Share URL length with large boards | Truncated links | 100-character cap per board |
| File:// + proxy | News can't load | Explicit offline state; P0 unaffected |
| OAuth client registration needed for P3 | F17/F18 blocked | Keep them last, independent of P0-P2 |
