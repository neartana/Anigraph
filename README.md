# Anigraph

Anime and manga statistics from AniList or MyAnimeList, plus a personal library and local tier-list maker.
Vanilla HTML, CSS and classic JavaScript. No build step, no framework, no runtime dependencies.

## Run

From this directory:

    node server.js

Then open <http://127.0.0.1:5173/>. Node 24 or newer runs the dependency-free static
server and ANN news proxy. Set `PORT` to use a different port.

For stats and tier lists without news, a plain static server also works:

    python -m http.server 5173 --bind 127.0.0.1

You can also open <code>index.html</code> directly with a double-click. The app has been
verified over <code>file://</code>; live AniList reads and local boards work there. Clipboard
access can be blocked on <code>file://</code> in some browsers, so the share action falls back
to a selectable link dialog.

## What it contains

- **Stats** — select AniList or MyAnimeList and enter a public username. The record covers anime or manga with a
  four-value summary, six hand-drawn SVG charts (score distribution, status, formats, genres,
  release years, start years) and a top-titles panel showing the most-watched anime episodes
  or most-read manga chapters. Profile banners display the full uncropped image with a
  bottom fade into the page. Division
  changes are instant for the statistics; the public title list is fetched separately.
  Real cover art accompanies the leading profile titles, ranked progress rows and genre
  results. The title rankings use a responsive image list; the six aggregate charts remain SVG.
  A compact profile and four labeled summary cards lead into the charts. Summary cards
  become two columns on phones. Charts pair scores/status, genres/formats and release/start
  years on desktop, with matching reading order and a single column on smaller screens.
  Softly rounded surfaces and spacing separate sections. The centered navigation uses
  larger labels without decorative numbers.
  Top genres uses a bounded scroll area; scroll inside it to reach all ten genres.
  Its column headings stay visible while scrolling. Formats highlights the leading
  format's share of recorded format entries, label and count.
  Click a genre (or focus it and press Enter or Space) to see that division's public-list
  titles, including planned titles. Filter by list status and format, or sort by progress,
  title, or release year (newest first, unknown years last). Close or Escape returns focus
  to the genre chart.
- **MyAnimeList support** — Stats and Library share a source selector. Public MAL anime
  and manga lists work with genre browsing, library filters, Pick for Me, Discover,
  collections and My Schedule. Source links open on MAL; catalog discoveries retain
  their AniList links. Same usernames and numeric IDs from the two sites stay separate.
  MAL requires `node server.js`; no login or API key is needed. The server reads only
  fixed public MAL profile/list URLs, with bounded responses, pagination, five-minute
  caching and one upstream request per second. Private or blocked lists show an error.
  MAL charts use the complete returned list, with personal /10 scores converted to /100.
  Days watched comes from the public profile when available. Missing dates or episode
  durations remain unknown, so constrained duration picks may exclude MAL titles.
  MAL's public web endpoints can change; the integration reports failures without
  presenting a partial list as complete. AniList still works on static servers and `file://`.
- **My Library** — open LIBRARY and load a public username, or reuse the profile loaded
  in Stats. Browse covers for the complete public anime or manga collection. Search
  Romaji, English or native titles; combine status, genre, format, release-year and
  personal-score filters. Sort by title, score, year or progress. Pages show 48 cards
  while filtering always searches the complete loaded collection.
- **Pick for Me** — inside LIBRARY, choose PICK FOR ME to draw immediately from your
  whole public library. PICK FROM can limit the pool to Planning instead.
  Combine genre, format, mood and length preferences. Anime length is the actual
  episode/film duration; manga uses maximum chapter count. Unknown lengths are excluded
  when a limit is selected. Mood uses genre groups, and another draw avoids the previous
  title when multiple candidates remain. Each result has its real cover and AniList link.
- **Discover for Me** — choose DISCOVER in Library for new anime or manga based on your
  three highest-rated titles and favorite genres. AniList community recommendations are
  ranked with your genre preferences; genre-based picks fill sparse results. Known library
  titles are excluded across the complete collection. Each card explains why it was chosen.
- **Seasonal Explorer** — choose SEASONS in Library to browse anime without loading a
  profile. Choose a season/year, genre, format, minimum average score and sort order, then
  apply filters. Previous/next pages use the same filters. Real covers and AniList links remain.
- **Custom Collections** — choose COLLECTIONS in Library to create, rename or delete
  personal groups. Save titles from Browse, Discover or Seasons; remove them from a group
  without changing AniList. Groups can mix anime and manga, with the division switch filtering
  their contents. They belong to the loaded profile and are saved only in this browser.
- **Tier lists** — search an anime or manga, load its cast, and rank characters into S/A/B/C/D
  or back into unassigned. Boards auto-save locally, support mouse and touch dragging, keyboard
  moves through a per-card menu, and share through a URL hash.
- **News** — five latest news headlines, compact publisher thumbnails, short excerpts, relative publication times,
  outbound article links and attribution to Anime News Network. Headlines and thumbnails
  open the original source article directly.
  The wire sits beside stats on desktop and below them on smaller screens. With a plain
  static server or <code>file://</code>, it shows WIRE OFFLINE and a direct ANN link;
  stats and tier lists continue to work.
- **Airing radar** — open AIRING for a Monday-to-Sunday anime schedule in your browser's
  timezone, with episode numbers, local airing times and countdowns. Day-by-day groups of
  cards show the scheduled title's own cover art. Radar opens on today; select another day
  using the date strip with episode counts, or choose All week. The strip scrolls on phones.
  Larger time labels, episode numbers and muted Aired labels make the cards easier to scan.
  Long titles have compact previews with their full accessible text and hover title retained.
  Browse previous/next weeks or return to
  THIS WEEK. Countdown labels update every 30 seconds without refetching.
  The schedule is independent of the selected profile and division; returning to Stats or
  Tier lists restores the division. Title links open AniList. This view also works from
  <code>file://</code> and does not need the news proxy.
- **My Schedule** — choose MY SCHEDULE in Radar to show only the loaded profile's Watching,
  Repeating and Planning anime. Filter Watching/Planning separately. A Next up card shows
  the earliest future matching airing for the chosen week, with date, time, episode and
  countdown; it advances when an episode airs. The complete anime library loads even when
  the main division is manga. The source/list filter restores on reload.
- **Footer** — shared rounded footer with links to all four views, AniList/Anime News
  Network credits, copyright and Back to top. Footer navigation returns keyboard focus
  to the active header tab; Back to top preserves existing share hashes.

## Data source

All profile data comes from the public AniList GraphQL API:

    POST https://graphql.anilist.co

Requests use no Authorization header, no API key and no cookies. There is no backend and no
database for AniList data. Cover art is loaded from AniList's CDN and news images from
Anime News Network. The only other external resource is Google Fonts (Zen Kaku Gothic New
and JetBrains Mono). Artwork uses reserved aspect ratios, lazy loading and broken-image
fallbacks; missing art never removes its title or progress values.

The statistics view uses the public User statistics query plus a MediaListCollection query
shared by Top titles, genre drill-down, Library and Pick for Me. Collection requests follow
hasNextChunk until the final batch, with 500 entries per chunk and deduplication by media
ID. Scores use POINT_100. These fields follow AniList's
[collection](https://anilist.gitbook.io/anilist-apiv2-docs/docs/reference/object/medialistcollection)
and [score](https://anilist.gitbook.io/anilist-apiv2-docs/docs/reference/object/medialist)
references. Successful GraphQL
responses are cached in sessionStorage for five minutes. The cache key is the query plus
variables; a reload of the same view in the same tab can be served from cache. HTTP 429
responses show a visible Retry-After countdown and a retry action. Network and GraphQL
failures carry typed status/message information back to the UI.

Seasonal browsing and recommendation fallbacks share a bounded 24-title catalog query.
Unused filters are omitted from the GraphQL document because AniList rejects some null
filter arguments. Explicit retries bypass bad cached responses and respect Retry-After.
Collections use <code>anigraph:v1:collections</code> in localStorage, separate from tier
boards. Clearing browser storage removes them; there is no account or device sync.

News comes only from ANN's canonical RSS endpoint,
<https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us>, through the local
<code>GET /api/ann/news</code> proxy. The server caches it for ten minutes, shares simultaneous
fetches, makes at most one upstream request per second and honors ANN's HTTP 429 Retry-After.
The browser also caches successful news for five minutes. The UI shows a countdown before
retrying rate-limited news. The server reads metadata from up to five feed-linked ANN news
pages to obtain each article's own image. It returns only headlines, excerpts (up to 200
characters) and optional image URLs; it never mirrors article bodies. Article reads are
sequential, capped at 512 KiB and two seconds each, with an eight-second enrichment budget.
Unavailable images leave text headlines intact. Cold news loads can take a few seconds
longer while images are resolved. HTTPS publisher hosts and raster-image paths are validated
on both server and client; upstream redirects remain disabled. The server exposes only the
three public app files and the fixed news route.

## Storage and sharing

- Boards: localStorage key <code>anigraph:v1:boards</code>, an object keyed by AniList media id.
  Each entry stores board metadata plus the character snapshot (id, name, image), tier id lists
  and the unassigned pool, so a saved board reopens without a character request.
- UI state: <code>anigraph:v1:ui</code> remembers the last division, username, view and the
  board that was open, plus Browse/Pick mode. A reload restores the exact local board;
  Library reloads its remembered profile through the shared cache.
- Share links: base64url JSON in <code>#board=...</code>. The payload carries
  <code>v, m, t, tiers, pool, chars</code> plus optional display metadata (division, native
  title, cover, format, year, community score). Opening a link renders the snapshot with no
  GraphQL requests and shows the "Shared board — save a copy?" banner. Copying the share link
  on a local board leaves the address bar alone; save a copy to make the board local.
- Character cap: 100 characters per board. Artists are fetched 25 at a time, up to five pages
  and the 100-character cap.

## Deliberate limits

- Library and genre counts reflect the complete returned public collection, including
  Planning; they can differ from AniList statistics. Private entries remain unavailable.
  An interrupted or malformed multi-chunk response shows an error and retry rather than
  presenting a partial collection as complete. Public lists can be browsed even when
  that user's statistics are private. Collection filters stay in memory during navigation;
  a reload resets filters. Mood is based on genres, not a recommendation model.
- Airing radar follows AniList's <code>hasNextPage</code> flag, up to ten pages of 50
  schedules per week; a visible note appears if more may be available. AniList may omit
  past airing data, so an empty historical week is not proof that nothing aired.
  Week boundaries use local calendar dates, including daylight-saving changes. Times and
  release plans reflect AniList's schedule and can change.
- Live AniList private profiles are served by the public API as 404, exactly like unknown
  usernames, so they cannot be reliably distinguished in the browser. The app has a specific
  "This record is sealed." state for a profile that returns null statistics, but in ordinary
  live use a private account will appear as "No such profile." rather than inventing certainty.
- The optional Query D ("your score for the selected title") is not implemented. It is a
  stretch item; the stats and tier board work without an OAuth identity.
- Touch dragging requires a short hold (220 ms) before moving. This keeps ordinary vertical
  page scrolling usable when your finger starts on a character card.
- Browser support targets current Chrome, Edge, Firefox and Safari: dialog, Pointer Events,
  ResizeObserver and sessionStorage are used. No polyfills are bundled.

## Files

- <code>index.html</code> — static shell, shared masthead, dialogs and live region.
- <code>styles.css</code> — the broadcast design system, chart/board layouts and breakpoints.
- <code>app.js</code> — API/cache layer, typed errors, SVG charts, search, board state,
  drag/keyboard interaction, local persistence, share encoding and ANN Wire.
- <code>server.js</code> — optional local static server and cached ANN RSS proxy.
- <code>ANIGRAPH.md</code> — product brief and roadmap; later phases remain deferred.
- <code>qa/</code> — optional development-only browser harness and evidence, not required to
  run the app. It uses Node 24 and an installed Chrome; browser code has no JS dependencies.

## Verification notes

The four feature additions passed **63/63 focused checks**, **65/65 Library regressions**
and **9/9 live feature checks** in Chrome 155. Coverage includes both discovery divisions,
complete-list exclusion, real recommendation reasons, filtered/paginated seasons,
profile-scoped mixed-media collections, storage failure and malformed snapshots, personal
schedules, Next up rollover, cold profile loading, retry/rate states and 320–1440px layouts.
The full browser run passed 346/347; its timing-sensitive search debounce assertion passed
on a separate 11/11 rerun. Both reports are retained in <code>qa/artifacts/acceptance-19/</code>.
New catalog queries were also checked against the live AniList API. Other browser engines
and cross-device collection sync were not tested; collections are deliberately local only.

The Radar layout update passed **20/20 day-navigation/layout checks** and **49/49 Radar
regression checks**, including real schedules/artwork, keyboard access, 320–1440px layouts,
week pagination/cache, countdowns, error/retry states, file:// and daylight-saving weeks.
Evidence: <code>qa/artifacts/acceptance-18/</code>. Run <code>node qa/radar-layout.mjs</code>
and <code>node qa/acceptance.mjs 15</code>. The full site suite and other browser engines
were not rerun for this scoped update.

The whole-library picker fix passed **25/25 action/source checks**, **20/20 filter recovery
checks**, **65/65 Library checks** and **24/24 live-data checks** in Chrome. Both Pick for
Me buttons draw immediately and focus the result. Whole library is the default; Planning
remains a strict optional source. Empty Planning offers an explicit whole-library action.
Moods show counts, and clearing restrictions keeps the selected source. Root also used
the prominent button to draw and reroll actual anime from Neartana's 37-title library,
which has no Planning entries. Evidence: <code>qa/artifacts/acceptance-17/</code>.
The full site suite and other browser engines were not rerun for this fix.

The footer passed **23/23 focused checks** at 320–1440px for layout, touch sizes,
source links, navigation, keyboard focus and hash-preserving Back to top. Evidence is
in <code>qa/artifacts/acceptance-15/</code>. The full suite was not rerun for this addition.

My Library and Pick for Me passed **65/65 feature checks**, **22/22 live-data checks**
and **347/347 regression checks** (full run plus successful follow-ups for genre and
frozen-chart fixtures). Evidence is in <code>qa/artifacts/acceptance-14/</code>.
Coverage includes complete pagination, duplicates, aliases, combined filters, eligible
draws, reroll behavior, unknown lengths, private/empty/malformed lists, HTTP 429 recovery,
stale profiles, cache/reload, file:// and 320–1440px layouts. Real Neartana data returned
37 anime entries with no Planning entries and 820 manga entries with three Planning
entries at this run; these are observed source counts, not fixed app expectations.

The self-improvement pass passed **177/177 regression checks plus 127/127 layout and
genre checks** in Chrome 155, including sticky headings, forward/reverse keyboard access,
calculated format shares, touch sizing and Radar behavior. Evidence is in
<code>qa/artifacts/acceptance-13/</code>. Root also checked the live profile and schedule.

The aligned-card and softer-surface update passed **128/128 regression checks plus
87/87 layout/genre checks** in Chrome 155, covering both divisions at five widths,
matching card edges, smaller text, themed scrollbars and keyboard access. Evidence is in
<code>qa/artifacts/acceptance-12/</code>. Other browser engines and the full suite were
not rerun for this CSS update.

The genre-height follow-up passed **51/51 focused checks** for both divisions across
390–1440px, including scrolling, keyboard activation and restored focus. Evidence is in
<code>qa/artifacts/acceptance-11/</code>.

Earlier layout verification: **128/128 focused regression checks plus 71/71 compact-layout
checks passed** in Chrome 155. These cover unchanged chart data, label bounds/contrast,
genre controls, centered navigation and smaller panels across anime/manga and five widths
from 390 to 1440px. Evidence and before/after Neartana screenshots are in
<code>qa/artifacts/acceptance-10/</code>. The preceding full browser run
passed **347/347 checks**, over a local server and from <code>file://</code>; it was not
repeated for this presentation pass. The optional QA harness lives
under <code>qa/</code>:

    node qa/acceptance.mjs
    node qa/server.mjs

The proxy assertions pass **14/14**. A separate live check returned five real ANN headlines.
Evidence is in <code>qa/artifacts/acceptance-8/</code>: results.json, summary.md,
console-network-evidence.json and screenshots at 1440, 768 and 390 CSS px. The suite covers
the revised seven-panel statistics view, genre drill-downs for both divisions (status/format
filters, all sorts, keyboard/focus, loading/private/empty states and returned-list counts),
the top-titles progress panel, the profile banner,
the AniList-blue palette, the reduced interface copy, mouse/touch drag, keyboard-only moves,
reload restore, a fresh-profile share link with zero GraphQL requests, reduced motion, offline
recovery, rate-limit countdown, mocked private states, file:// and the request allowlist.
ANN coverage includes the real local proxy path with controlled RSS, cache expiry, loading,
empty/offline/rate-limit states, direct source links, long headlines and
large desktop summary values. Proxy checks cover parsing, static-file boundaries, ten-minute
caching, concurrent requests, bounded bodies and upstream rate limits. The first ANN live URL
redirected to an edition-specific feed, so the server pins its verified canonical target.
Airing Radar adds 45 checks for local week grouping, pagination, deduplication, countdown
ticks, navigation/cache expiry, malformed-response retry recovery, HTTP 429, the page cap,
board/division preservation, file:// and both 167/169-hour daylight-saving weeks. Live
Radar rendered 129 episodes across three pages for 19–25 October 2026 in Asia/Jakarta;
the count is returned data, not a fixed value. Screenshots cover 1440, 768 and 390 CSS px.
The chart design pass adds 33 checks for unchanged source values, labels and tooltips,
SVG bounds, text contrast, responsive sizing, genre interaction/focus, and single-year
axes. Charts now use readable headings, consistent blue bars, score-range and peak-year
insights, status percentages, and ranked genre/title rows with wider plots on phones.
Before/after captures are in <code>qa/artifacts/design-before/</code> and
<code>qa/artifacts/design-after/</code>.
The artwork pass adds 40 browser checks for exact source/media-ID matches, actual image
loading, reserved aspect ratios, responsive title/genre/Radar layouts, resize focus,
missing/unsafe/404/corrupt image fallbacks and unchanged chart/progress data. Seven additional
ANN image checks cover bounded metadata parsing, publisher URL guards, deadlines,
rate limits, caching and text-only degradation. Updated settled screenshots are in
<code>qa/artifacts/design-images-after/</code>. The live Radar check returned 130 schedules
over three pages at this run; this is current source data rather than a fixed expectation.
The browser-comment pass adds 25 checks at 1440, 985, 768 and 390 CSS px for the removed
feed/time rail, full uncropped banner with bottom fade, NEWS-only heading and compact
news thumbnails. The unchanged server's 14 proxy and seven image checks remain recorded
in <code>qa/artifacts/acceptance-7/</code>.
Only Chrome was covered; private-profile and 429 responses were simulated where the public API
cannot produce them.
