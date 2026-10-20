# Anigraph motion showcase

[MP4](../anigraph-showcase.mp4) · [WebM](../anigraph-showcase.webm) · [Animated preview](../anigraph-showcase-preview.gif) · [Poster](../anigraph-showcase-poster.jpg)

30 seconds, 1920×1080, 30 fps. A brand intro leads through Stats, Library, Pick for Me,
Discover, Airing Radar and Tier Lists, ending with the GitHub repository address.

## Playback

Clone or download the repository, then open `media/index.html` in your browser.
The [player source](../index.html) offers both video formats and download links.
To serve it over HTTP, run `python -m http.server 5175 --bind 127.0.0.1` from the
repository root and open [the local video player](http://127.0.0.1:5175/media/).
GitHub's repository file viewer may offer only a download for video files; the README
uses an animated GIF so the showcase is visible directly on the repository page.

| File | Format | Purpose |
| --- | --- | --- |
| `anigraph-showcase.mp4` | H.264 High / AAC, 1080p, 30 fps | Video players and browsers with H.264 support |
| `anigraph-showcase.webm` | VP9 Profile 0 / Opus, 1080p, 30 fps | Browser playback, including Chromium builds without H.264 |
| `anigraph-showcase-preview.gif` | 640×360, 8 fps, silent, looping | Full 30-second preview for GitHub Markdown |
| `anigraph-showcase-poster.jpg` | JPEG still | Player poster and static preview |

Both video files include a quiet original synthesized soundtrack.

## Source and credits

`render.mjs` draws deterministic animated SVG frames and encodes them with FFmpeg.
Logo assembly, chart-bar growth, screen entrances, camera drift, transitions and the
timeline are generated from code. Feature images are screenshots of the actual app,
not UI mockups. The tier board shows demonstration rankings in an isolated browser.
The original renderer, motion graphics and synthesized soundtrack are covered by the
repository [license](../../LICENSE). Screenshots contain third-party anime and manga
artwork, titles and service names; those remain the property of their respective owners
and are not sublicensed by the repository license. Capture provenance is recorded in
`assets/provenance.json`.

## Re-render

Node 24+, FFmpeg with libx264/AAC, libvpx-vp9/libopus and GIF palette filters, and Sharp
are needed only for rendering the video.
The application itself keeps its existing dependency-free runtime.

```powershell
cd media/showcase
npm install
# Set this only when ffmpeg is not on PATH.
$env:FFMPEG_PATH = 'C:\path\to\ffmpeg.exe'
npm run preview
npm run render
```

The renderer uses the available Segoe UI/Arial sans-serif fonts. Other platforms may
substitute a similar font. Edit scene timing and copy in `render.mjs`. Intermediate
frames and uncompressed audio go to the ignored `.render/` folder. A full render writes
the MP4, WebM, GIF and poster to `media/`. Preview mode writes only the poster and scene
contact sheet. Output-size assertions keep the GIF below 8 MiB and each video below
95 MiB; encoder errors stop the render.

## Refresh screenshots

Run Anigraph on `http://127.0.0.1:5174/` and have Chrome available to the repository's
existing development capture harness:

```powershell
node media/showcase/assets/capture.mjs
```

This opens isolated browser state, loads public AniList data and updates the six JPEGs
and their provenance. Public profile counts, picks, recommendations and airing schedules
will change over time. It does not modify the user's saved boards or collections.
