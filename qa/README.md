# qa/ - Anigraph browser QA harness

Dependency-free Chrome DevTools Protocol harness. Node 24 (global WebSocket), installed Chrome, python for serving. No npm installs.

Generated screenshots, logs and result captures stay local. The frozen JSON inputs used
by these scripts are included in version control so the checks can be reproduced.

## Current acceptance commands

`node qa/mal.mjs` writes `qa/artifacts/acceptance-21/`: 37 checks for normalization,
explicit score scales, complete pagination, proxy input/body/rate/error handling,
MAL library/picker/genre links, recommendation/schedule ID mapping, source-scoped
collections, mixed-source ID collisions, reload persistence and 320–1440px layouts.
The original Library (65), four-feature (63) and Stats-layout (62) suites were rerun
after this integration. The full acceptance suite and non-Chrome browsers were not run.

Stats layout evidence is in `qa/artifacts/acceptance-20/`: `node qa/stats-layout.mjs`
passes 62 checks for both divisions at seven widths, compact artwork, summary cards,
loading placeholders, aligned chart pairs, overflow and keyboard genre actions.
`node qa/acceptance.mjs 16` passes 33 existing source-value, geometry, contrast and
genre-focus checks. Panel data comparisons use IDs so intentional layout reordering
does not change the data contract. This is focused coverage, not a new full-suite run.

Latest feature evidence is in `qa/artifacts/acceptance-19/`. New commands:

```text
node qa/new-features.mjs
node qa/feature-personal-live.mjs
node qa/feature-live.mjs
node qa/library.mjs
```

The focused suite has 63 checks for Discover/Seasons/Collections/My Schedule, including
320–1440px layouts, safe data/URLs, local storage and rate/retry failures, cold-profile
flows, source filtering and Next up rollover. The live suite has nine checks using Neartana
and current AniList catalog data. Library has 65 checks. The 347-check full run passed
346 initially; its timing-sensitive search debounce check passed in the 11-check item-3
follow-up. See `full-results.json` and `results.json` respectively; both runs are retained.
The historical acceptance-7 notes below describe the earlier artwork/proxy baseline.

```text
node qa/acceptance.mjs
node qa/server.mjs
node qa/news-images.mjs
```

The browser suite writes current evidence to `qa/artifacts/acceptance-7/`: `results.json`,
`summary.md`, screenshots, and console/network captures. It retains the original app,
genre, ANN Wire, and Airing Radar regressions and adds image identity, loading, fallbacks, and layout coverage. ANN checks
include the real local Node proxy with a controlled RSS upstream.

The latest full run passed **322/322 browser checks** in Chrome 155 and **14/14 proxy
checks**, plus **7/7 ANN image enrichment checks**. Image/layout coverage adds 40 browser checks to the previous 282. The original chart design coverage accounts for 33 checks, and Radar for 45. The live Jakarta week of 19–25 October
2026 returned 130 schedules over three pages (50, 50, 30); counts can change with AniList.

`node qa/server.mjs` runs 14 dependency-free proxy checks without Chrome or live upstream
requests and writes `qa/artifacts/acceptance-7/server-results.json`. It covers RSS parsing,
safe links, bounded excerpts, static-file access, request coalescing, cache expiry, rate
limits, and failures. `node qa/news-images.mjs` adds seven isolated checks for publisher metadata parsing, trusted image paths, content types and body bounds, cache/coalescing, one request per second, article 429 handling, and the total eight-second enrichment deadline.

Run selected browser items with a comma-separated argument:

```text
node qa/acceptance.mjs 12,13
node qa/acceptance.mjs 14
node qa/acceptance.mjs 15
node qa/acceptance.mjs 16
node qa/acceptance.mjs 17
```

| Item | Coverage and selectors |
| --- | --- |
| 12 | Live anime/manga genre rows: SVG `[data-genre]`, `#genreDrilldown`, `#genrePanelTitle`, `[data-genre-filter="status"]`, `[data-genre-filter="format"]`, `[data-genre-filter="sort"]`, `.genre-title-row[data-media-id]`, and `[data-action="close-genre"]`. Checks all returned matching titles, filters/sorts, counts, keyboard focus, and 1440/768/390 layouts. |
| 13 | Controlled genre fixtures using the same selectors: loading/private/empty/filter-empty states, zero progress, deduplication, escaping, unknown totals/years, and focus across asynchronous loads and chart resizing. |
| 14 | ANN Wire: `#annWire`, `.ann-wire`, `.ann-news-item`, `.ann-news-link`, `.ann-news-time`, `.ann-news-summary`, `.ann-status`, `[data-action="find-ann"][data-news-index]`, and `[data-action="retry-ann"]`. Checks the Node proxy path, independent stats loading, safe output, explicit AniList search, cache expiry, empty/offline/429 recovery, responsive layouts, and `file://` fallback. |
| 15 | Airing Radar: `[data-view-target="radar"]`, `#viewRadar`, `#radarTitle`, `.radar-week`, `.radar-timezone`, `.radar-day[data-day]`, `.radar-episode[data-schedule-id]`, `.radar-title-link`, `.radar-airing-time`, `.radar-countdown[data-radar-airing]`, and `[data-action="radar-prev|radar-next|radar-today|retry-radar"]`. Controlled multi-page fixtures verify local grouping, query bounds, countdown updates, cache expiry, safe titles/links, week navigation, empty/error/429 recovery, the 500-schedule cap, state preservation, 1440/768/390 layouts, `file://`, and 167/169-hour DST weeks. |

Item 16 uses frozen real derF ANIME and MANGA responses from
`artifacts/design-before/data.json`. It verifies unchanged summaries, chart totals,
ranked values, score/status/year/genre-mean tooltips, SVG label bounds and overlaps,
at least 11px text with AA contrast, viewport fit at 1440/768/390, genre pointer
and keyboard activation with focus restoration, and single-year release/start axes.
Top Titles now uses semantic HTML rows with retained labels, values, per-row tooltips, and progress tracks; the aggregate charts retain their SVG checks. It writes `chart-design-geometry.json` and chart screenshots for both divisions.

Item 17 checks real derF ANIME/MANGA artwork against the exact returned media IDs,
including all eight title covers, the three profile covers, and every returned Action
entry. It confirms actual decoded cover pixels, lazy/async decorative images with no
referrer, portrait slot reservation at 1440/768/390, readable row bounds, and genre
keyboard opening/closing. A held image and missing/script/credentialed/404/corrupt
fixtures verify stable geometry, visible fallbacks, and unchanged values. Evidence is
`images-live-data.json`, `images-geometry.json`, `images-fallback.json`, and image
screenshots. Item 14 also validates ANN article-to-image matching through the real
proxy; item 15 validates each live Radar image against its schedule/media ID and
source cover with responsive screenshots.

Filtered runs overwrite the current `results.json` and `summary.md`; run the full suite last
to leave complete acceptance evidence. `radar-live.json` records live AniList schedule pages, their rendered count, and the artwork ID/source pairs. `ann-live-proxy.json` records a separate read-only live preview
check, and `source-sha256.json` records the verified source hashes.

Before screenshots and the frozen source responses are retained in
`qa/artifacts/design-before/`; the image pass starts from `design-images-before/`. `node qa/design-capture.mjs after` captures current real
derF ANIME and MANGA at 1440, 768, and 390 using the running preview on port 5174 and
writes `qa/artifacts/design-after/`, including full genre and title panels at 390.
`node qa/design-capture.mjs images-after` saves the settled image pass in `design-images-after/`, including viewport profile captures with real ANN images. It scrolls and waits for lazy title/ANN images before the full-page shot. Its self-check requires four summary values, seven
chart panels, eight title labels, and no uncaught browser exception for each division.

Run the Phase 1 self-check:   node qa/smoke.mjs
Artifacts: qa/artifacts/ (PNG screenshots, smoke-results.json)

Files:
- qa/cdp.mjs      CDP client + Chrome launch + python static server (import it from test scripts)
- qa/smoke.mjs    self-check proving every harness capability
- qa/fixtures/    tiny fixture page used by the smoke test
- qa/anilist-probe.mjs  AniList GraphQL API shape probe (unknown/private user shapes)

Harness API (qa/cdp.mjs):
- launchChrome({ headless, extraArgs }) -> browser; browser.version, browser.newPage(), browser.newContext(), browser.close()
- serveDir(dir) -> { url, origin, port, close() }  (python -m http.server, free port)
- fileUrl(path) -> file:// URL
- browser.newPage({ url }) -> page
- page: goto, reload, evaluate(fn, ...args), waitFor(fn, opts), waitForSelector, waitForEvent,
  screenshot(file, { fullPage }), setViewport({ width, height, deviceScaleFactor, mobile, touch }),
  setReducedMotion(bool), setOffline(bool), localStorage(), setLocalStorage(obj), clearLocalStorage(),
  mouseDrag(from, to), touchDrag(from, to), tap(x, y), key(name), mouse(type, x, y),
  route(pattern, handler), clearRoutes(), url(), title(), close()
- page.events: console[], consoleErrors[], exceptions[], logEntries[], requests[], responses[], failed[]
- route handler: return { status, headers, body } to fulfill, or null to continue (for 429/Retry-After and private-profile simulation)
- isolated browser context = fresh profile storage, for share-link tests

AniList probe:   node qa/anilist-probe.mjs   -> artifacts/anilist-api-shapes.json (2 API requests)
Browser CORS evidence: artifacts/browser-cors-check.json

## Historical evidence

- `qa/artifacts/acceptance/` — original Phase 2 browser evidence.
- `qa/artifacts/acceptance-2/` — blue redesign, profile banner, and top-title progress (113/113).
- `qa/artifacts/acceptance-3/` — genre drill-down and its regressions (175/175).
- `qa/artifacts/acceptance-4/` — ANN Wire and its regressions (204/204 browser, 14/14 proxy).
- `qa/artifacts/acceptance-5/` — Airing Radar and its regressions (249/249 browser, 14/14 proxy).
- `qa/artifacts/acceptance-6/` — chart design and its regressions (282/282 browser, 14/14 proxy).

These directories are retained as historical snapshots; the current acceptance command
writes to `qa/artifacts/acceptance-7/`.
