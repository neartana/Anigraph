# Anigraph motion showcase

[Watch the video](../anigraph-showcase.mp4) · [Poster](../anigraph-showcase-poster.jpg)

30 seconds, 1920×1080, 30 fps. The MP4 uses H.264 video and a quiet original
synthesized AAC soundtrack. A brand intro leads through Stats, Library, Pick for Me,
Discover, Airing Radar and Tier Lists, ending with the GitHub repository address.

`render.mjs` draws deterministic animated SVG frames and encodes them with FFmpeg.
Logo assembly, chart-bar growth, screen entrances, camera drift, transitions and the
timeline are generated from code. Feature images are screenshots of the actual app,
not UI mockups. The tier board shows demonstration rankings in an isolated browser.
Artwork remains attributed to its original owners through the app's data sources;
capture provenance is in `assets/provenance.json`.

## Re-render

Node 24+, FFmpeg with libx264/AAC, and Sharp are needed only for rendering the video.
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
frames and uncompressed audio go to the ignored `.render/` folder. The final MP4 and
poster are written to `media/`.

## Refresh screenshots

Run Anigraph on `http://127.0.0.1:5174/` and have Chrome available to the repository's
existing development capture harness:

```powershell
node media/showcase/assets/capture.mjs
```

This opens isolated browser state, loads public AniList data and updates the six JPEGs
and their provenance. Public profile counts, picks, recommendations and airing schedules
will change over time. It does not modify the user's saved boards or collections.
