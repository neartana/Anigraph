# Anigraph — next-agent handoff

## Current status

Anigraph is deployed at https://anigraph-phi.vercel.app on Vercel project
`near19/anigraph`, connected to `neartana/Anigraph`. Root package scripts use Node24;
`npm run build` copies only the three app files into ignored `dist/`. `api/app.js`
reuses the unchanged Node request listener. An unnamed `/api/(.*)` rewrite preserves
the strict MAL query allowlist; function duration is 60s. Deployment checks 11/11,
existing server 14/14 and news-image 7/7 passed. Production HTTP smoke checks 11/11
passed, including real MAL derF profile/manga list, ANN headlines, MIME types,
invalid inputs, and source-path 404s. A real AniList Neartana profile also loaded
in the production browser. Evidence is ignored `qa/artifacts/acceptance-22/`.
Caches and upstream queues are per warm function instance, not shared globally.
Showcase assets remain on GitHub, outside the deployed app's static allowlist.

Showcase playback now uses `media/index.html`, with WebM (VP9/Opus) and the original
MP4 (H.264/AAC). Both played to completion in the in-app browser. GitHub's file viewer
does not preview the MP4; README now uses a full animated GIF and explicit download
links. The renderer reproduces the WebM/GIF as well. Serve the player with a plain
static server or open its HTML locally; the app's allowlisted Node server does not
serve `media/`. The concise root README links detailed notes in `docs/DEVELOPMENT.md`.
`LICENSE` is MIT (2026 neartana); third-party artwork/data remain outside that grant.
No product code changed in this playback/documentation pass.

A 30-second 1080p motion-graphics showcase is in `media/anigraph-showcase.mp4`,
with a poster and editable SVG/FFmpeg renderer in `media/showcase/`. Six real app
screenshots and capture provenance are included; tier rankings are an isolated demo.
The original synthesized soundtrack is quiet and unclipped. Final FFmpeg checks
decoded all 900 frames plus audio successfully (H.264, 1920x1080, 30fps, AAC 48kHz).
Scene and transition contact sheets were inspected. Rendering intermediates are
ignored; no product code changed or app regression suite was rerun for this addition.

MyAnimeList is now a second profile source in Stats and Library. `state.source` persists
as `anilist` (legacy default) or `mal`; changing it clears the profile and invalidates
in-flight work. `server.js` serves fixed `/api/mal/profile` and `/api/mal/list` proxies,
validates usernames/type/300-entry offsets, strips unused list fields, bounds responses
to 3 MiB, coalesces requests, caches five minutes (64 entries), and serializes MAL reads
at <=1/second. This uses public MAL web endpoints, not Jikan or a credentialed API.
MAL needs the Node server; static/file AniList behavior remains intact.
`normalizeMalEntry` adapts statuses, /10 scores, counts and recorded dates. The browser
waits for every list page, deduplicates IDs, then derives charts and totals. Reported
profile days are preserved; unavailable metadata stays unknown. MAL statistics set
`scoreScale:100` so even a library containing only low scores bins correctly.
Rows retain source IDs. `entryLink` chooses their actual source; recommendation seeds
query AniList `idMal_in`, catalog exclusions use `idMal`, and My Schedule compares its
new `malId` field for MAL users. Collections use owner `mal:<username>` for MAL while
legacy AniList owners remain unchanged; item source participates in duplicate/removal
keys so colliding MAL/AniList IDs can coexist. Genre vocabulary is checked before MAL
discovery's AniList fallback. Tier boards/catalogs still use AniList normally.
`qa/mal.mjs` passes 37 proxy/browser checks; evidence is `acceptance-21/`. Existing
Library 65, new-feature 63 and Stats-layout 62 checks also pass. Live derF MAL profile,
231 anime / 1 manga entries and AniList's MAL-ID recommendation mapping were verified.
These are observations, not hardcoded source counts. Preview restarted on 5174.

The latest Stats layout pass uses a smaller avatar/name and compact leading-title covers,
four label-first summary cards (two columns on phones), and aligned chart pairs:
scores/status, genres/formats, release/start years, then Top titles. Chart DOM order follows
the same reading order. The username field has a visible surface and clear focus treatment.
The full uncropped banner, all data and genre keyboard behavior are preserved.
`node qa/stats-layout.mjs` passes 62 responsive/loading/keyboard checks at 320–1440px;
`node qa/acceptance.mjs 16` passes 33 chart-value/geometry/accessibility regressions.
Evidence is in `qa/artifacts/acceptance-20/`. Full-suite and other-browser checks were not run.

The app at the repository root implements the original requests plus ANN Wire:

1. Stats has seven panels: the six original SVG charts plus an image-led Top titles list,
   with an episodes-watched or chapters-read caption, backed by two public query types.
2. The AniList profile banner is shown when the user has one. It now preserves the full
   natural image ratio and fades into the page at the bottom, replacing the fixed crop.
3. Interface copy was reduced to essentials.
4. The palette uses AniList blue: ink #0A121E, panel #101B2A, rule #223248,
   paper #F2F5F8, muted #8B9BB0, accent #3DB4F2, violet #8CA8FF.
5. Clicking a genre in either division opens its returned public titles, including
   planning/zero-progress entries, with status/format filters and progress/title/year
   sorting. Keyboard focus survives title loading and chart resizing; Escape closes.
6. News has five headlines, excerpts, relative times, attribution and direct source
   links on headlines/thumbnails. server.js serves the app and proxies only
   ANN's fixed news RSS feed, with 10-minute caching, coalescing, a 1-request/second
   ceiling and upstream Retry-After handling. file:// and plain static servers show
   WIRE OFFLINE without blocking stats or boards.
7. F4 Airing Radar is implemented as the third AIRING view: Monday-to-Sunday local
   weeks, episode/time labels, 30-second countdown updates and previous/next/this-week
   controls. It is global anime scheduling, independent of profiles and the selected
   division. The division switch is hidden in Radar and restored on return.
8. The taste design pass gives charts readable sans headings, explanatory captions,
   12px axes, consistent blue bars with peak emphasis, honest 10-point score ranges,
   busiest-year insights, a thin status stack with counts/percentages, and ranked
   genre/title rows. Phone genre/title rows put their labels above wider bars.
   Status colors, all source values, tooltips, genre actions and keyboard focus remain.
   A single-year chart now labels only the actual year and centers its tick on its bar.
9. Real artwork is now present in the profile's leading titles, Top titles, genre results,
   Airing Radar and ANN Wire. UserTitles/AiringRadar include coverImage in their existing
   queries; exact media IDs retain their cover URLs. Title rankings are semantic HTML with
   posters, progress bars and existing numeric labels/tooltips. No ResizeObserver redraw is
   needed for that HTML panel, preserving title-link focus across resizing.
   Radar uses vertical day groups with three/two/one image cards per row by viewport.
   Artwork has a reserved 2:3 ratio (ANN 16:9), lazy/async loading and existing broken-image
   fallbacks. Adjacent title text remains readable when artwork is missing or blocked.
   The ANN server reads bounded Open Graph metadata from at most five validated feed-linked
   news pages, exposing optional imageUrl. Each article has a two-second/512-KiB limit,
   within an eight-second enrichment deadline; all ANN requests remain <=1/second.
   Redirects stay disabled and text headlines survive image failures. The client timeout is
   25 seconds and the news session cache key is ann:news:images, avoiding old text-only cache.
10. The browser-comment cleanup removes the top PUBLIC FEED/local-clock rail entirely,
   labels the news section only NEWS, and caps all news artwork at 160px (96px on phones).
   Below the desktop sidebar breakpoint, thumbnails sit beside article copy instead of
   expanding to the full page width. News/Radar relative times and board save times remain.
11. The second browser-comment cleanup removes all decorative chart frame numbers,
   the Find on AniList news buttons and their unused search handler, and repeated ANN
   tags on articles. Headlines and thumbnails open each article's validated source URL.

12. Navigation is centered across the viewport, with unnumbered 14px labels. The six
   aggregate charts use shorter 160px plots and tighter padding. Above 900px cards now
   form equal-width, equal-height pairs: Score/Genres, Status/Release, Formats/Start.
   Smaller screens use one column. Genre rows retain 44px phone touch targets.
13. Top genres now caps its chart slot at 230px to match the Score distribution card.
   All ten rows remain available through vertical scrolling; Tab scrolls focused rows
   into view and Enter/Escape preserve the existing drill-down and focus behavior.

14. Genre labels are 12px, with 11px numeric text; scrollbars are thin muted blue-gray
   on navy, with a blue hover in engines using the WebKit styling. Shared corner tokens
   are 6/8/10px. Decorative section/card/header/list dividers were removed, while chart
   axes, focus indicators and control boundaries remain. Formats matches Start years.
15. The self-improvement pass keeps genre column headings visible while scrolling,
   using a sticky HTML header above the interactive SVG rows. Formats now has the same
   insight hierarchy as the other charts: the leading format's percentage of recorded
   format entries, its label and count. Division/week controls have 44px touch height.
   Remaining profile, tier-intro and command-section divider lines were removed;
   input boundaries and focus indicators remain. No dependencies or queries were added.

16. LIBRARY is the fourth main view, with Browse and Pick for Me as inner modes. It
   shares the Stats profile and UserTitles data. UserTitles now requests chunk variables,
   hasNextChunk, score(format: POINT_100) and duration, fetching until the final chunk.
   The shared parser deduplicates media IDs across chunks, so genre drill-downs and
   Top titles also receive the full returned public collection. Library uses a cover
   grid, searches all title aliases, combines status/genre/format/year/score filters,
   sorts by title/score/year/progress and displays 48 cards per page. Filters run locally.
   Pick for Me draws from the whole library by default, with optional PLANNING source
   and genre/format/mood/length constraints (user explicitly approved whole-library picks);
   rerolls avoid the previous result when another candidate exists. Anime limits use
   per-episode/film duration and manga uses chapters, excluding unknown lengths only
   when constrained. It uses the same artwork, escaping and safe URL helpers.
   Library/mode/username/division restore on reload; profile reload uses the shared cache.
   Public lists still load when profile statistics are private. Collection errors never
   present partial pages as a complete library; 429 retry waits for Retry-After.
   Profile/division changes invalidate stale page/pick/filter state. Nav is four equal
   columns below 900px, with the existing 14px labels and centered desktop alignment.

17. The shared footer now has brand copy, four section buttons, direct AniList/ANN
   credits, copyright and Back to top, on a rounded panel without divider lines.
   Footer buttons use data-footer-view and the existing view switch, leaving the four
   data-view-target header tabs intact. Both navigation groups track aria-current.
   Footer navigation and Back to top focus the active header tab and scroll to top,
   preserving URL hashes. Source credits use HTTPS, _blank and noopener/noreferrer.

18. Both Pick for Me buttons now draw immediately and focus/scroll to the result.
   The header button previously only opened the mode and appeared inert. The user
   explicitly approved whole-library picks after confirming their anime Planning list
   was empty. PICK FROM defaults to ALL (whole library); PLANNING remains a strict
   optional source. Changing source clears picker restrictions and stale results.
   Source options, mood counts, genre and format choices reflect the chosen pool.
   Zero-match filters offer CLEAR FILTERS & PICK, preserving the selected source.
   Empty Planning offers PICK FROM MY LIBRARY, switching source explicitly before drawing.
   Results include their real list status; no private/missing entries are invented.

19. Radar opens on today's local date in the current week, or Monday for other weeks.
   A date strip shows each day's episode count and an All week option. Selecting a day
   only hides/reveals existing groups: no extra network request, rerender or lost focus.
   The strip scrolls within the phone layout; controls retain visible keyboard focus.
   Cards use larger 18px local times, readable episode numbers, bigger covers and 3/2/1
   columns with a single column below 720px. Aired labels are muted and the 30-second clock
   updates that styling too. Long titles clamp to three lines with full link text/title.
   Week navigation, timezone/date math, pagination and source links remain in place.

20. Four requested additions are implemented without extra main navigation tabs:
   - Radar has ALL ANIME / MY SCHEDULE, a Watching/Planning filter, the loaded profile name
     and a Next up card for the earliest future eligible airing in the selected week. It
     loads the complete ANIME collection even when the saved division is MANGA, includes
     Repeating under Watching, restores its scope/list filter, and advances Next up on the
     existing 30-second clock without refetching. Empty/loading/error states remain honest.
   - Library DISCOVER uses the three highest personal POINT_100 scores as seeds for AniList
     community recommendations, with favorite-genre overlap in ranking. Sparse results use
     a genre catalog fallback. Every loaded library ID is excluded; wrong-type/adult/invalid
     candidates are ignored. Cards explain their actual seed score or matched genre.
   - Library SEASONS is profile-independent anime browsing: season/year, genre (from live
     GenreCollection), format, minimum average score and sort, with 24-card pagination.
     The division switch hides only for this anime-only mode and returns afterwards.
   - Library COLLECTIONS supports create/rename/delete, adding from Browse/Discover/Seasons,
     removing items and mixed anime/manga groups filtered by division. Storage key is
     anigraph:v1:collections, separate from boards and scoped to the loaded username.
     Data is validated/escaped, writes fail visibly without changing memory, blank renames
     cannot erase groups, and deletion requires the existing dialog confirmation.
   Catalog optional null filters must be OMITTED from the GraphQL document: AniList returned
   400/500 for explicit null operator arguments. catalogQuery builds the fixed allowlisted
   argument set; all values stay variables. gql's optional force flag is used only for new
   explicit retry actions so malformed cached responses can recover. Invalid/repeated library
   pages now evict their bad cache entry; My Schedule retries can therefore recover too.
   discardCachedQuery also replaces Radar's equivalent cache eviction. No server/dependencies.

Latest feature verification: qa/artifacts/acceptance-19/ contains 63/63 new-feature checks,
65/65 Library regressions and 9/9 real-data checks. The full browser run is full-results.json
(346/347); the only failure was the 300ms search debounce count under concurrent Chrome
tests. An isolated 11/11 item-3 follow-up passed and is results.json. Full report and follow-up
are both retained. Coverage includes 320/390/768/985/1440px, safety/escaping, local storage
errors, blank names, CRUD/cancel/reload/profile scope, stale requests, cache/rate recovery,
Next up rollover, cold profile loading and file:// Seasons. Live Neartana discovery returned
24 new anime and 24 manga outside its 37/820-title complete collections; My Schedule matched
two real weekly episodes among its watching/planning anime. Counts are observations, not
fixed expectations. Query probes: qa/feature-schema.mjs and qa/feature-live.mjs. The root
also inspected live Seasons/Discover/My Schedule in the in-app browser. Other engines and
physical-device touch remain unchecked. Collections do not sync or update AniList.

Latest Radar verification: 20/20 focused layout/day-navigation checks and 49/49 Radar
regressions passed in Chrome 155. Evidence: qa/artifacts/acceptance-18/ (320–1440px,
keyboard, empty days/weeks, countdown, cache, retry/rate, capped pagination, DST, file://
and real 130-episode schedule with matching artwork). The initial live-image check assumed
all days were visible; it now selects All week before measuring every cover. Initial report
is retained separately, and the complete follow-up Radar run passes. The full site suite
and other browser engines were not rerun. No query, dependency or server changes.

Latest picker verification: 25/25 action/source, 20/20 recovery, 65/65 Library and 24/24
live-data checks passed in Chrome. Both divisions cover mouse/Enter, focus/announcements,
rerolls, source restrictions, phone controls, empty Planning recovery, pagination, cache,
error/rate states and file://. Evidence: qa/artifacts/acceptance-17/. Root used the actual
prominent button on Neartana's 37-title anime library (0 planned), drawing Gurren Lagann
and then Toaru Majutsu no Index. No new queries/dependencies. Full site suite and other
browser engines were not rerun for this fix. The earlier filter-only fix is recorded in
acceptance-16; it did not address the header button or empty anime Planning pool.

Latest footer verification: 23/23 focused Chrome checks passed, covering 320/390/768/
985/1224/1440px, 44px controls, source URLs, all views, keyboard Enter, focus and hash
preservation. Evidence: qa/artifacts/acceptance-15/footer-results.json and screenshots.
Root also inspected the live footer and tested Back to top. The full suite and other
engines were not rerun for this scoped addition. index.html/styles.css/app.js changed.

Previous verification: 347/347 regression checks (full run plus successful follow-ups for
items 12 and 16), 65/65 feature fixtures, 22/22 live library checks and 127/127 layout
checks passed in Chrome 155. Evidence is qa/artifacts/acceptance-14/: results.json,
summary.md, library-results.json, library-live.json and genre-style-results.json.
The frozen pre-pagination chart fixture now explicitly declares a final chunk; one
live genre timeout passed on follow-up. Initial/follow-up reports are kept separately.
The live Neartana collection returned 37 anime entries (0 planned, one chunk) and 820
manga entries (3 planned, two chunks). Root personally exercised the new screens,
filters and real picks in the in-app browser. New feature layouts cover 320–1440px,
and actual cover screenshots cover 390/768/985/1224/1440px. Other browser engines and
physical-device touch remain untested. server.js is unchanged; no dependencies added.

Previous verification: 177/177 regression checks (including Radar) plus 127/127 layout and
genre checks passed in Chrome 155. Evidence: qa/artifacts/acceptance-13/results.json,
summary.md and genre-style-results.json. The new checks cover real-data format shares,
sticky headings, forward/reverse keyboard scrolling and 44px division controls across
five widths and both divisions. Root also checked live stats/genre focus and all three
week controls at 44px; the live Radar loaded 130 schedules. Other engines and the full
board suite were not rerun. app.js and styles.css changed; server.js is unchanged.

Previous verification: 128/128 focused regression checks plus 87/87 layout/genre checks
passed in Chrome 155. Evidence: qa/artifacts/acceptance-12/results.json, summary.md and
genre-style-results.json, with screenshots across five widths and both divisions.
Root personally tested the live last-genre action, Escape/focus and themed scrollbar.
Only styles.css changed in the app; no data, API or server changes.

Previous follow-up: 51/51 genre-size checks passed in Chrome 155 for both divisions at
1440/1224/985/768/390px. Evidence and screenshots: qa/artifacts/acceptance-11/.
Only styles.css changed in the app for this follow-up; no data or API changes.

Previous verification is 128/128 focused regression checks plus 71/71 compact-layout checks
in Chrome 155, in qa/artifacts/acceptance-10/results.json, summary.md and compact-results.json.
Frozen Neartana anime/manga comparisons at 1440/1224/985/768/390px confirm unchanged
statistics, values and tooltips, centered navigation, no card overlap and smaller panels.
Root also tested the live manga profile and keyboard genre open/close/focus in the preview.
The full suite and other browser engines were not rerun for this presentation pass.
Previous panel/news cleanup evidence is qa/artifacts/acceptance-9/results.json, summary.md, cleanup-preview.json
and source-sha256.json. Real Neartana manga screenshots cover 1224, 985 and 390px.
Root also checked the live preview: seven panels, no decorative frame captions, no Find
buttons, timestamp-only news metadata and matching headline/image source URLs.
The preceding full browser run passed 347/347; it was not repeated for this cleanup.
Its evidence remains in qa/artifacts/acceptance-8/results.json, summary.md and ui-review-geometry.json.
The 25 new browser-comment checks cover all four revisions at 1440/985/768/390 widths.
Final proof is acceptance-8/1440-review-neartana-manga-profile.png, captured from the
running 5174 preview with Neartana/Manga, 817 titles, the full banner and five news images.
Previous artwork acceptance (322/322), 14/14 proxy checks and 7/7 targeted ANN image
checks remain in acceptance-7/. Server source was unchanged in this UI pass.
The artwork pass adds 40 browser checks covering exact media/image matches, loading,
responsive bounds, missing/unsafe/404/corrupt fallbacks and title-link focus on resize.
Settled image screenshots are in qa/artifacts/design-images-after/; the clean desktop
viewport proof is 1440-anime-profile.png. Live Radar returned 130 schedules over three
pages (50/50/30), each matched to its source media ID and cover. Root personally tested
Neartana's live manga profile, loaded all three leading covers and five ANN images,
filtered its Romance titles, checked the live Radar and restored Manga/Romance/All filters.
Previous chart design evidence (282/282) remains in acceptance-6/.
The 33 chart checks compare frozen real-data snapshots,
numeric/tooltips invariants, label bounds/contrast and all three viewport sizes, genre
pointer/keyboard interaction, and single-year axes. Before/after screenshots are in
qa/artifacts/design-before/ and qa/artifacts/design-after/. Root also personally tested
live anime/manga switching, combined genre filters, sorting, empty results and keyboard
open/close/focus in the in-app browser, and inspected the responsive screenshots.
Previous Radar evidence (249/249) is in acceptance-5/, including radar-live.json.
The 45 Radar checks cover malformed-cache recovery, countdowns,
pagination, keyboard focus, navigation, caps, state preservation, file://, responsive
layouts and both 167/169-hour DST weeks. Previous ANN evidence (204/204) is in acceptance-4/.
Previous genre evidence remains in acceptance-3/ (175/175), and the earlier 113/113
baseline remains in acceptance-2/.
Do not re-run that suite blindly after changes; update it instead.

The news-enabled Node preview was restarted and is running at http://127.0.0.1:5174/
(PORT=5174). node server.js defaults to 5173; use PORT=5174 for this preview address.
The current running process includes ANN image enrichment (exec session 53729).
The proxy uses https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us because
ANN redirected the bare feed there with the descriptive User-Agent. Redirects remain
disabled. The desktop summary uses two rows when the wire sidebar narrows the record,
so large values do not overlap.

## Genre request (implemented)

Verbatim from the user:

> and for genre's on both anime and manga, when you click that it shown all of
> manga on that category and add filter to categorize it

Interpretation: on the GENRES / 010 chart, for both divisions, clicking a genre
should open a drill-down listing every title the user has in that genre (from
their public list), with filter and sort controls to categorize the results.

This request is implemented. The user then supplied ANIGRAPH.md, selected ANN Wire,
and subsequently asked to continue. This pass adds the next item, F4 Airing Radar.
F5 Contrarian Score Map is the next unfinished roadmap item; F6 Pick for Me and the
additional My Library feature are now implemented. Full pagination returned 462 Action
anime titles and 254 Action manga titles for derF in acceptance-14. These can differ from statistics and
can change with the public lists; they are not hard-coded in the app.

## Files

- index.html — static shell
- styles.css — design system and layouts
- app.js — API, state, charts, search, tier board, persistence and sharing
- server.js — optional Node static server and ANN news proxy
- ANIGRAPH.md — attached product brief and roadmap, with implementation status
- README.md — run instructions and documented limits
- qa/ — optional Chrome CDP verification harness; qa/acceptance.mjs is the suite
- NEXT_AGENT.md — this file

## How to run

    node server.js

Open http://127.0.0.1:5173/ or open index.html directly (file:// is verified).
News requires the Node server. A plain Python static server still supports all
AniList features, with the wire offline. Node 24 is used for verification.
Verification harness:

    node qa/smoke.mjs
    node qa/acceptance.mjs
    node qa/server.mjs

Real public handles for testing: derF (rich anime+manga), matchai (has a banner),
iamkisei (empty).

## Airing Radar implementation

- AIRING_RADAR_QUERY uses Page.airingSchedules, 50 per page, sorted by TIME and ID.
  Page bounds are exclusive, so the query receives local Monday seconds minus one
  and next Monday seconds. Client validation also filters into [Monday, next Monday).
- Follow only pageInfo.hasNextPage; AniList's total/lastPage values are unreliable.
  The ten-page cap is disclosed with the actual returned count when reached.
- Week/day arithmetic uses local Date.setDate, including 167/169-hour DST weeks.
  Countdown labels use elapsed time; times/grouping use the browser timezone.
- Existing gql session caching handles all pages. Re-entering Radar reuses valid
  cached responses without extending their TTL. Invalid Page shapes evict only the
  offending page's cache entry so Retry Schedule can recover immediately.
- Sequence guards prevent older week responses from replacing a newer selection.
  HTTP 429 cooldown survives week/view changes; no uncached request bypasses it.
- No profile, board, share payload, backend route or dependency was added for Radar.
  Existing UI persistence now accepts view=radar. file:// uses direct AniList reads.
- Current live Jakarta week (19–25 October 2026) returned 129 schedules over three
  pages (50/50/29), without exceptions. Past weeks may be incomplete per AniList.

## Implementation reference for the genre drill-down

### 1. Extend the title query

In app.js, USER_TITLES_QUERY currently requests only progress, media id, title,
format, episodes and chapters. Add:

- entry field: status
- media fields: genres, startDate { year }

Keep the shared MediaListCollection query and its chunk pagination. Do not add a separate
query for genres; reuse the complete collection. Cache is keyed by query and variables.

### 2. Keep all public-list entries, not only the top 8

The current parser is parseTitleRows (around line 1163). Rename or replace it
with parseTitleEntries that:

- dedupes by media id, keeps the entry with the highest progress
- keeps entries even when progress is 0 or the list status is PLANNING
- returns an object per entry:
  { id, title, progress, total, format, status, year, genres }

total is episodes for anime and chapters for manga, or null when AniList has no
count. genres must remain an array of strings. status is the list entry status
(CURRENT, COMPLETED, PLANNING, PAUSED, DROPPED, REPEATING).

Then change the titles bucket shape:

- freshTitlesBucket returns { status: 'idle', entries: [], rows: [], error: null, seq: 0 }
- startTitlesLoad resets entries as well as rows
- loadTitles sets bucket.entries from parseTitleEntries and derives
  bucket.rows as the top 8 entries with progress greater than 0, sorted by
  progress desc then title. The existing TOP TITLES chart keeps using rows.
- titlesSummary keeps using bucket.rows.

### 3. Make the GENRES chart interactive

renderHorizontalChart currently builds rows for both FORMATS and GENRES. For
spec.kind === 'genres' only:

- wrap each row in an SVG group with class chart-genre-row, role="button",
  tabindex="0", data-genre="<genre name>", and an aria-label such as
  "Action, 417 entries. Show all titles."
- mark the inner text, line and rect elements aria-hidden="true" so the group
  label is the accessible name
- add cursor:pointer and a visible focus style for .chart-genre-row

Important: chartSvg currently emits aria-hidden="true" for every chart. Give it
an optional interactive flag. Pass true only for genres; all other charts must
stay hidden from the accessibility tree.

### 4. Genre panel state and markup

Add state.genre, initially null, and a module-level genreTriggerEl.

When a genre is opened:

    state.genre = { name: <genre>, status: 'ALL', format: 'ALL', sort: 'PROGRESS' }

Add a host after the chart grid in statsSuccessMarkup:

    '<div id="genreDrilldown">' + (state.genre ? genrePanelMarkup() : '') + '</div>'

genrePanelMarkup must render, from the current division's bucket.entries:

- header: GENRE label, genre name (h2 id="genrePanelTitle" tabindex="-1"),
  public-list count, CLOSE button with data-action="close-genre"
- filters: three selects with data-genre-filter="status", "format", "sort"
  - status options: ALL plus only the statuses present in this genre
  - format options: ALL plus only the formats present in this genre
  - sort options: PROGRESS, TITLE, YEAR
- list: one hairline row per matching title with title, format / year,
  progress (and / total when known), and status
- states: loading (bucket.status === 'loading'), unavailable
  (bucket.status === 'error'), empty ("No public titles in this genre."),
  and filtered-empty ("No titles match this filter.")

Use esc and escAttr for every dynamic string. Never fabricate counts: the header
count is the number of public-list entries actually returned for that genre, not
the statistics genre count.

### 5. Rendering and focus

Add renderGenrePanel(focusKey):

- update only #genreDrilldown from genrePanelMarkup
- if focusKey is passed, focus that filter select after render
- otherwise focus the panel heading so the panel scrolls into view

Use renderGenrePanel for open, close and filter changes. Do not re-render the
whole stats view for a filter change; that would restart chart work and lose
position. A full renderStats(false) is already triggered when the titles query
finishes, and that will include the panel if state.genre is set.

### 6. Event wiring

Add to the existing delegated handlers in app.js:

- click: if the target is inside [data-genre], call openGenre(name, element);
  handle data-action="close-genre"
- keydown: Enter or Space on [data-genre] opens it; Escape closes the panel
  when state.genre is set (check drag and move-menu handling first)
- change: [data-genre-filter] updates state.genre[key] and calls
  renderGenrePanel(key)

Reset state.genre to null when a new profile load starts and when the division
changes, so a stale panel never survives a user or division switch.

### 7. CSS

Add a genre panel section to styles.css, consistent with the current rules:

- panel background var(--panel), 1px var(--rule) border, 2px radius
- hairline list rows, mono metadata, no shadows, no gradients, no pills
- filters as flat selects (dark background, 1px rule border, blue focus ring)
- list max-height around 60vh with overflow-y auto
- responsive: filters wrap and rows stack cleanly at 720px and 390px
- .chart-genre-row cursor pointer and a visible focus outline

### 8. Verify

Update qa/acceptance.mjs, then run the full suite and save new evidence under
qa/artifacts/acceptance-3/. Add checks for:

- clicking a genre in ANIME shows only anime entries whose genres include it
- switching to MANGA and clicking a genre shows only manga entries for it
- status, format and sort filters change the visible rows
- keyboard: Tab or focus a genre row, Enter opens the panel, Escape closes it
- loading and empty-title states
- no page horizontal scroll at 390 with the panel open
- no new console errors and no new external origins

Real data to expect once the query is extended: derF ANIME Action has 417
statistics entries but the public list may return fewer; derF MANGA entries
include genres such as Action, Adventure and Comedy. Report the real returned
count, not the statistics count.

## Constraints and gotchas

- No build step, no framework, no JS dependencies. Keep classic script tags.
- Public AniList GraphQL only. No OAuth, no API key, no backend.
- Keep the existing blue palette and the reduced copy. Do not add marketing copy.
- Keep the existing error handling and the sessionStorage 5-minute cache.
- MediaListCollection is fetched with perChunk: 500 until hasNextChunk is false.
  Never restore the old first-chunk-only shortcut. Returned public counts may still
  differ from statistics; never invent missing/private entries.
- Private lists return no entries. The panel must show the unavailable or empty
  state, not an error dump.
- SVG tabindex and focus outlines work in Chrome; the QA harness is Chrome CDP
  only. Real-device mobile Safari remains untested.
- Event delegation lives in onDocumentClick, onDocumentKeydown and
  onDocumentChange; add cases there instead of binding per node.
- Run node --check app.js after edits.
- Keep the existing share, tier board, drag and keyboard behaviour intact.

## Definition of done

- Clicking any genre in either division opens a list of that division's public
  titles in that genre, with status, format and sort filters.
- Keyboard and pointer both work; Escape closes; focus is reasonable.
- Empty, loading, private and filtered-empty states are honest and specific.
- 1440, 768 and 390 layouts stay clean with no page-level horizontal scroll.
- qa/acceptance.mjs is updated and the full suite passes with new evidence in
  qa/artifacts/acceptance-3/.
- README.md is updated to describe the genre drill-down.

## Shared tasks

- task-1 and task-2 are completed.
- task-3 is complete: qa/acceptance.mjs and acceptance-3 evidence include 62 new
  genre checks. The QA teammate's write scope was qa/ only.
- The ANN extension is complete: updated acceptance-4 evidence adds wire/browser
  coverage and qa/server.mjs proxy assertions. Future roadmap tools were not requested.
- The Radar extension is complete: a QA teammate updated only qa/, and a read-only
  reviewer inspected app.js/index.html/styles.css. The next roadmap item is F5;
  F5, F7 and F8 remain deferred; the later library pass implemented F6 Pick for Me.
- App files are the Lead's or implementer's scope; QA must not edit app files.
