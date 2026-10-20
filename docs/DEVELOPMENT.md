# Development notes

Implementation and verification reference for contributors. Start with the
[project README](../README.md) for installation and features, or the
[QA guide](../qa/README.md) for the browser harness.

## Architecture

Anigraph has no frontend framework, bundler, or application runtime dependencies.
`index.html` loads `styles.css` and the classic `app.js` script. The browser owns view
state, data normalization, SVG charts, library filtering, tier-board interaction, local
persistence, and share encoding. Event delegation handles clicks, changes, and keyboard
input; existing shared helpers escape text and validate external URLs.

`server.js` uses Node's standard library. It binds to loopback and serves an explicit
app-file allowlist rather than exposing the repository. Fixed JSON proxy routes are:

| Route | Responsibility |
| --- | --- |
| `GET /api/ann/news` | Cached ANN headlines, excerpts, article links, and optional images |
| `GET /api/mal/profile` | Public MAL profile metadata |
| `GET /api/mal/list` | A normalized page of a public MAL anime or manga list |

AniList requests go directly from the browser to `https://graphql.anilist.co`; the
Node server is required for MAL and news. No OAuth identity, database, or provider
account-write operation is implemented.

### Vercel hosting

`npm run build` recreates the checked `dist/` directory and copies only the HTML,
CSS, and browser script for CDN delivery. `api/app.js` exports the existing server's
request listener as a Node.js 24 function, preserving the same validation, upstream
limits, and error responses. The unnamed `/api/(.*)` rewrite keeps routing captures
out of MAL's query string. The function has a 60-second execution limit.

Proxy caches, in-flight request coalescing, and upstream queues belong to a warm
function instance. They reset on cold starts and do not coordinate across instances.
QA files, renderer sources, videos, environment files, and local Vercel settings are
excluded from deployment. `npm run test:vercel` checks the adapter and build allowlist.

## Public-data contracts

### AniList

- Profile statistics and the public title collection use separate queries. Top titles,
  genre results, Library, and Pick for Me share the complete title collection.
- `MediaListCollection` follows `hasNextChunk` with 500 entries per chunk and deduplicates
  by media ID. Interrupted or malformed pagination is an error, never a complete-looking
  partial list. Include Planning and zero-progress entries.
- Personal scores are requested as `POINT_100`. Genre counts can differ from statistics
  because the public collection and aggregate statistics are different provider results.
- Successful GraphQL responses are cached in `sessionStorage` for five minutes, keyed
  by query and variables. Typed network/GraphQL errors reach the UI; HTTP 429 responses
  retain `Retry-After`, a visible countdown, and an explicit retry action.
- Catalog queries return 24 titles per page. Omit unused filter arguments from the
  GraphQL document instead of sending null operator values: AniList rejected some null
  filters during live verification. Argument names are allowlisted; values stay variables.
- Explicit retries can evict malformed cached responses. Sequence guards prevent an old
  profile, division, or week response from replacing the active view.

AniList returns some private profiles as 404, like unknown usernames. Do not infer a
private account from that response. Null statistics have a dedicated unavailable state;
a public list can still be browsed when profile statistics are unavailable.

### MyAnimeList

The local proxy reads fixed public MAL profile/list URLs, not Jikan or a credentialed
API. It validates usernames, anime/manga types, and 300-entry offsets, rejects arbitrary
upstream URLs, bounds responses to 3 MiB, coalesces concurrent reads, caches for five
minutes with at most 64 entries, and serializes upstream requests to at most one/second.
Private, blocked, oversized, and malformed responses produce visible failures.

`normalizeMalEntry` maps statuses, /10 scores, progress, and recorded dates. The browser
waits for every list page, deduplicates IDs, then derives statistics. MAL uses an explicit
/100 score scale after conversion so low scores still bin correctly. Reported profile
days are retained when available. Missing dates and episode durations remain unknown.

Source identity participates in collection ownership and item keys: a MAL and AniList
title with the same numeric ID are different items. Legacy AniList owners are preserved;
MAL owners use `mal:<username>`. Profile changes invalidate in-flight work. MAL source
links open MAL. Discovery seeds map through AniList `idMal_in`, candidate exclusions use
`idMal`, and My Schedule matches the MAL ID supplied by AniList's schedule metadata.
Tier boards and catalog browsing continue to use AniList.

### News

The server pins ANN's canonical feed:
`https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us`.
It caches for ten minutes, coalesces requests, enforces at most one upstream request per
second, and respects `Retry-After`. The browser caches successful news for five minutes.

Image enrichment reads up to five feed-linked articles sequentially. Each read has a
512 KiB/two-second bound, within an eight-second total enrichment budget. Feed bodies
are bounded to 2 MiB. HTTPS publisher hosts and raster-image paths are validated;
upstream redirects stay disabled. Only headlines, excerpts up to 200 characters, links,
and optional image URLs are returned. Article bodies are not mirrored. Missing imagery
leaves the text headline usable. Cold loads may take a few seconds longer.

## Library and scheduling behavior

- Browse filters the complete loaded list locally and displays 48 cards per page. Search
  considers available Romaji, English, and native titles. In-memory filters reset on reload.
- Pick for Me defaults to the whole library, with Planning as an explicit strict source.
  Another draw avoids the previous title when multiple candidates remain. Anime length
  means episode/film minutes; manga length means total chapters. Unknown lengths are
  excluded only when a length limit is selected. Mood is a genre grouping.
- Discover seeds from the three highest personal scores, ranks AniList community
  recommendations using genre preferences, and fills sparse results from the catalog.
  Exclude known titles across the complete library; ignore invalid, wrong-type, or adult
  candidates. Recommendation reasons describe the seed or matched genre actually used.
- Seasonal Explorer is profile-independent and anime-only. Its pages preserve the applied
  season/year/filter/sort parameters.
- Radar uses local Monday-to-Monday calendar boundaries, including 167/169-hour daylight
  saving weeks. Query bounds use Monday minus one second and next Monday; client validation
  also enforces the local half-open week. Follow `pageInfo.hasNextPage`, not unreliable
  totals. Fetch at most ten pages of 50 schedules and disclose the cap when reached.
- Radar opens on today in the current week, or Monday in another week. Day selection
  reveals existing groups without new requests. Countdowns update every 30 seconds.
  Missing past airing data is not proof that nothing aired.
- My Schedule loads the profile's complete anime list even when the main division is
  manga, then matches Watching/Repeating and Planning titles. Next up advances on the
  same clock. Schedules reflect provider data and can change.

## Storage and sharing

| Storage key | Contents |
| --- | --- |
| `anigraph:v1:boards` | Local boards keyed by AniList media ID, metadata, character snapshots, tier IDs, and unassigned pool |
| `anigraph:v1:collections` | Profile-scoped named collections, including source-aware anime/manga items |
| `anigraph:v1:ui` | Last profile/source, division, view, active board, Library mode, and schedule preferences |
| `anigraph:v1:cache:*` | Five-minute session cache keyed by query and variables |

Boards and collections are browser-local. They do not synchronize or update provider
accounts. Storage writes fail visibly; invalid snapshots and blank collection names must
not silently destroy an existing save.

Board links encode base64url JSON in `#board=...`. Versioned payloads include `v`, `m`,
`t`, `tiers`, `pool`, and `chars`, with optional display metadata. A link renders its
snapshot without a GraphQL request and offers to save a local copy. Copying a local
board's share link leaves the address bar unchanged. Boards cap at 100 characters;
character fetching uses pages of 25, up to five pages within that cap.

## Interaction and compatibility

Keep the existing keyboard genre activation, Escape handling, and focus restoration
when changing chart or dialog rendering. Board cards support pointer dragging and a
keyboard move menu. Touch dragging starts after a 220 ms hold so ordinary vertical
scrolling remains usable. Image slots preserve their aspect ratio and fall back without
hiding title text or progress values. The profile banner retains its full natural ratio
with a bottom fade.

Browser support targets current Chrome, Edge, Firefox, and Safari, using dialog,
Pointer Events, ResizeObserver, and web storage without bundled polyfills. Recorded
browser verification used Chrome 155. Other engines and physical-device touch were not
verified. The optional roadmap query for the signed-in user's score is not implemented;
there is no OAuth identity.

## Verification workflow

Use Node 24+. Browser checks also need installed Chrome and Python for the harness's
static server. `CHROME_PATH` can select Chrome and `PYTHON` can select Python. No npm
install is required for application checks.

```sh
node --check app.js
node --check server.js
node qa/server.mjs
node qa/news-images.mjs
node qa/mal.mjs
node qa/library.mjs
node qa/new-features.mjs
node qa/stats-layout.mjs
```

Run checks appropriate to the changed behavior. Additional focused entry points include
`qa/picker-action.mjs`, `qa/picker-recovery.mjs`, `qa/radar-layout.mjs`, `qa/footer.mjs`,
and `qa/genre-size.mjs`. `node qa/acceptance.mjs` runs the broader browser suite;
comma-separated item arguments select narrower coverage, such as
`node qa/acceptance.mjs 15,16` for Radar and chart regressions.

Live probes (`qa/library-live.mjs`, `qa/feature-live.mjs`, and
`qa/feature-personal-live.mjs`) read current provider data. Counts and recommendations
are observations, not fixed test expectations. Private-profile and rate-limit cases are
simulated where live public APIs cannot reliably produce them.

Generated screenshots, logs, and result reports go under `qa/artifacts/` and are ignored
by Git. Required frozen JSON fixtures are tracked. See the [QA guide](../qa/README.md)
for script details, selectors, and historical evidence locations; those local generated
evidence paths are not published screenshot galleries.

### Recorded baseline

These are previously recorded results, not a claim that every suite was rerun for a
documentation or media change:

| Change | Recorded verification |
| --- | --- |
| MAL integration | 37 focused checks; 65 Library, 63 new-feature, and 62 Stats-layout regressions |
| Compact Stats layout | 62 responsive/loading/keyboard checks, plus 33 chart-value/geometry regressions |
| Discover, Seasons, Collections, My Schedule | 63 focused checks, 65 Library regressions, and 9 live checks |
| Picker action/source repair | 25 action/source, 20 filter recovery, 65 Library, and 24 live checks |
| Radar layout | 20 day-navigation/layout checks and 49 Radar regressions |
| Footer | 23 layout, navigation, and focus checks |
| Broader browser baseline | 347 checks passed across the full run and successful focused follow-ups |
| ANN proxy and images | 14 proxy and 7 metadata/image checks |

The later feature full run initially passed 346/347; its timing-sensitive 300 ms search
debounce assertion passed in an isolated 11/11 follow-up. Initial and follow-up reports
were retained locally. Responsive checks span 320–1440px depending on the suite. These
results do not establish non-Chrome or cross-device compatibility.

## Showcase video

The [motion source guide](../media/showcase/README.md) describes rendering and capture.
The optional renderer uses Sharp and FFmpeg, separate from the dependency-free app.
Screenshots contain real app data and externally owned artwork; the tier-board rankings
are an isolated demonstration. Capture provenance is tracked beside the screenshot
assets. Rendering intermediates stay in the ignored `media/showcase/.render/` folder.
