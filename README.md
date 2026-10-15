# VideoPipeline

VideoPipeline renders a film from a scene list. A `project.json` names the scenes in order.
Each scene is rendered by an engine to a clip, normalized to the project's size, fps and audio
format, cached, then joined with optional transitions into one MP4. An optional audio block adds
a music bed, voiceover ducking and loudness normalization. Scenes can come from five Claude Code
skills (HyperFrames, OneTake, Collage B-roll, Claude Animation Base, Lemo Opuscar) or from plain
HTML pages, video files and still images. The pipeline does not vendor code from those skills.

## Quick start

Requirements:

- Node.js 22 or later.
- `ffmpeg` and `ffprobe` on `PATH`.
- Chromium for the browser-rendered engines. `findChrome()` uses the newest
  `/opt/pw-browsers/chromium-*/chrome-linux/chrome`; set `VP_CHROME` to use another binary.
- Optional: network access for `npx` (HyperFrames is fetched on demand), and `python3` plus a
  `VP_COLLAGE_DIR` checkout for generated collage clips.

```sh
npm install
npm run doctor
npm run demo          # examples/starter/project.json -> examples/starter/out/starter.mp4
vp init my-film       # copies the starter project into ./my-film
vp render my-film/project.json
```

`vp` is the `bin` entry in `package.json`; `npm link` puts it on `PATH`, or use `node bin/vp.mjs`.
`npm run demo` renders at full quality (1280x720, 24 fps); add `--draft` for a quick preview.

Real output of `npm run doctor` on the build machine (Chromium present, no optional keys):

```
✓ node                     v22.22.0
✓ ffmpeg                   ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers
✓ ffprobe                  ffprobe version 6.1.1-3ubuntu5 Copyright (c) 2007-2023 the FFmpeg developers
✓ chromium                 /opt/pw-browsers/chromium-1194/chrome-linux/chrome
✓ playwright-core          1.56.1
✓ hyperframes              hyperframes@0.8.159 reachable on npm (0.8.159)
✗ GEMINI_API_KEY           not set
✗ VP_COLLAGE_DIR           not set
✗ VP_OPUSCAR_DIR           not set
✗ VP_HYPERFRAMES_BROWSER   not set
```

A `✗` on an optional row only means that engine is not configured. `doctor` exits 1 only when
node, ffmpeg or ffprobe is missing.

## CLI

```
usage:
  vp render <project.json> [--only a,b] [--force] [--draft]
  vp doctor
  vp init <dir>
```

| command | effect |
|---------|--------|
| `vp render <project.json>` | Render every scene, join them, write `output` and `<output>.report.json`. |
| `--only a,b` | Render only the listed scene ids. Clips are cached; no MP4 or report is written. Unknown ids are an error. |
| `--force` | Ignore cached clips for the selected scenes and render them again. |
| `--draft` | Half width and height (rounded to even), fps capped at 15. Writes `<output>.draft.mp4`. |
| `vp doctor` | Check node, ffmpeg, ffprobe, Chromium, playwright-core, HyperFrames on npm, and the optional env vars. |
| `vp init <dir>` | Copy `examples/starter` into `<dir>`. Refuses a directory that exists and is not empty. |

Exit codes: 0 success; 2 for usage errors and invalid projects (every problem is listed); 1 for
other failures.

## Project file

Top-level keys (validated in `src/config.mjs`):

| key | default | notes |
|-----|---------|-------|
| `title` | required | Non-empty string; the default output name derives from it. |
| `width`, `height` | 1920, 1080 | Positive even integers. |
| `fps` | 30 | 1 to 120. |
| `output` | `out/<title>.mp4` | Relative to the project file. |
| `transition` | `{"type": "none"}` | See below. |
| `audio` | none | See below. |
| `scenes` | required | Non-empty array. |

Unknown keys produce a warning and are ignored.

Scene keys: `id` (required, `^[a-z0-9][a-z0-9-]*$`, unique), `engine` (required), `src`, `still`,
`clip`, `prompt`, `duration` (seconds, > 0), `trim` (`[start, end]`, 0 <= start < end), `zoom`
(image engine only), `timeout` (seconds, > 0; hyperframes render limit, default 600) and `watch`
(cache inputs, see Caching).

**Transitions.** `type` is `none` or one of `fade fadeblack fadewhite wipeleft wiperight wipeup
wipedown slideleft slideright slideup slidedown circlecrop rectcrop distance smoothleft smoothright
smoothup smoothdown circleopen circleclose dissolve pixelize radial hblur zoomin` (ffmpeg `xfade`
names). A non-`none` type needs `duration` > 0, shorter than every scene with a known length.
Transitions overlap, so the film shortens by one transition duration per join.

**Audio.**

```json
"audio": {
  "music": "assets/bed.mp3", "musicVolume": 0.25,
  "voiceover": [{ "src": "vo/1.wav", "at": 2.0 }],
  "duck": true, "loudness": -14, "fadeOut": 1.5
}
```

- `music` loops to the film length and fades out over `fadeOut` seconds.
- Each voiceover line starts at `at` seconds. With `duck` (default true) the music is sidechain-ducked under it.
- Scene audio is kept. The mix is loudness-normalized to `loudness` LUFS (default -14).
- Without an `audio` block the joined video is copied as is.
- Checked at load: `music` and `voiceover` files exist. Value ranges: `musicVolume` 0 to 4 (default 0.25),
  `duck` true or false, `loudness` -70 to -5 LUFS, `fadeOut` 0 or more seconds.

## Engines

| engine | source skill | `src` points to | env vars | notes |
|--------|--------------|-----------------|----------|-------|
| `html` | none (generic seek contract) | a page implementing the seek protocol | none | Chromium |
| `onetake` | feitangyuan/onetake | a page using OneTake's seek contract | none | Chromium; PolyForm licence notice |
| `opuscar` | lemomo-ai/lemo-opuscar | a Lemo Opuscar film page | `VP_OPUSCAR_DIR` (required) | Chromium; captured at 1920x1080 |
| `animation-base` | JohnHeibel/ClaudeAnimationBase | the studio page in a checkout | none | Chromium; frames from `renderAt` |
| `hyperframes` | heygen-com/hyperframes | a composition's `index.html` | `VP_HYPERFRAMES_BROWSER` (optional) | `npx hyperframes@0.8.159 render` |
| `collage` | pyang5166/gbro-collage-broll | `clip`, or `still` + `prompt` | `GEMINI_API_KEY` + `VP_COLLAGE_DIR` for Gemini | three paths, below |
| `video` | any | a video file | none | ffmpeg trim |
| `image` | any | a still image | none | ffmpeg Ken Burns push-in |

Paths are relative to the project file.

**Optional assets only warn.** A failed `<img>`, font, media file or fetch/XHR in an HTML scene is logged as
`capture: optional resource failed: <url> (<reason>)` and the render goes on. A missing document, `<script>`
or `<stylesheet>` stops the render with the URL in the error.

**html.** The page defines `window.__seek(t)`. Its length comes from `window.__meta.dur` unless the
scene sets `duration`. An optional `window.__ready` promise is awaited first. Frames are taken at
`t = i / fps`.

```json
{ "id": "title", "engine": "html", "src": "scenes/title.html" }
```

**onetake.** Same seek contract as `html`, OneTake's own. It prints one PolyForm Noncommercial notice
per process; commercial use needs a licence from the author.

```json
{ "id": "walk", "engine": "onetake", "src": "scenes/walk.html", "duration": 8 }
```

**opuscar.** `VP_OPUSCAR_DIR` must point at a lemo-opuscar checkout. The page is served from a
loopback-only HTTP server (checkout at `/`, film folder at `/@film/`). The engine waits up to 180 s
for `window.READY === true`, then calls `window.render(t)` per frame. Duration is `DUR` unless
`duration` is set. The 1920x1080 capture is letterboxed to the project size.

```json
{ "id": "film", "engine": "opuscar", "src": "scenes/film/index.html" }
```

**animation-base.** `src` is the studio page in a ClaudeAnimationBase checkout, loaded with `?render`.
The engine waits up to 60 s for `window.ready === true`. Duration is `LOOP.len` if defined, else `DUR`.
Each frame is the PNG data URL returned by `window.renderAt(t, 'image/png')`.

```json
{ "id": "host", "engine": "animation-base", "src": "/path/to/ClaudeAnimationBase/studio.html" }
```

**hyperframes.** `src` is the composition's `index.html`. The engine runs
`npx --yes hyperframes@0.8.159 render <dir> -c index.html -o raw.mp4 -f <fps> --quiet` from the
composition's folder (600 s timeout). The browser is `VP_HYPERFRAMES_BROWSER`, then
`HYPERFRAMES_BROWSER_PATH`, then the newest `chromium_headless_shell-*` under `/opt/pw-browsers`.
Variables whose names contain `KEY`, `TOKEN`, `SECRET` or `PASSWORD` are not passed to npx. Ctrl-C, SIGTERM or a timeout kills the whole npx process group.

```json
{ "id": "intro", "engine": "hyperframes", "src": "scenes/intro/index.html" }
```

**collage.** Chosen in this order:

1. `clip` is set: the file is used as a `video` scene (`trim` applies).
2. `GEMINI_API_KEY`, `VP_COLLAGE_DIR` and `still` are all set: runs
   `python3 $VP_COLLAGE_DIR/scripts/generate_video.py --image <still> --aspect-ratio 16:9|9:16 --duration <3..10> --output raw.mp4 -- <prompt>`.
   **The still and frames are uploaded to Google's Gemini API.** The log says so before the upload.
3. Otherwise an offline fallback runs and logs `WARN collage: offline fallback, Gemini needs ...`.
   With `still` it is a paper-toned Ken Burns push-in; without it, a paper-coloured card with the prompt as text.

`duration` is required unless `clip` is set. The Gemini path takes whole seconds from 3 to 10 and the
result is then trimmed or padded to the exact `duration`.

```json
{ "id": "crane", "engine": "collage", "still": "assets/crane.png", "prompt": "paper crane takes off", "duration": 5 }
```

**video.** `trim: [start, end]` selects a range, or `duration` alone takes the first N seconds. Re-encoded
to H.264 with a frame-accurate trim; audio is kept when present.

```json
{ "id": "clip", "engine": "video", "src": "assets/x.mp4", "trim": [1, 4] }
```

**image.** `duration` is required. A slow Ken Burns push-in ends at `zoom` times the original scale (default 1.08).

```json
{ "id": "card", "engine": "image", "src": "assets/card.png", "duration": 3, "zoom": 1.1 }
```

## Writing a deterministic HTML scene

Seek-protocol pages (`html`, `onetake`) must make every frame a pure function of `t`. The capture
calls `window.__seek(t)` for each frame and screenshots after it. Do not use `requestAnimationFrame`,
CSS animations or transitions, `Date.now()`, timers, or an unseeded `Math.random()`.

```html
<!doctype html>
<html><head><meta charset="utf-8">
<style>html, body { margin: 0; height: 100%; overflow: hidden; background: #f4ecdc; }
  #box { position: absolute; top: 40%; width: 10vh; height: 10vh; background: #c8102e; }</style>
</head><body><div id="box"></div>
<script>
  window.__meta = { dur: 3 };            // seconds; scene.duration overrides it
  window.__ready = document.fonts.ready; // optional; awaited before the first frame
  window.__seek = (t) => {               // called once per frame, t = i / fps
    document.getElementById('box').style.left = (Math.min(1, t / 3) * 80) + 'vw';
  };
  window.__seek(0);
</script></body></html>
```

A failed load of the page's document, scripts or stylesheets, or any uncaught page error, stops the
render with that error. Keep the page self-contained or load libraries by relative path.

## Caching

- Clips live in `<project>/.vp-cache/` as `<id>-<W>x<H>p<fps>-<key12>.mp4`. A new key deletes the
  scene's older clips of the same format.
- The key is a SHA-256 over the scene object (paths relative to the project), `width`, `height`, `fps`,
  engine extras, and the bytes of `src`, `still` and `clip`.
- A scene whose `src` sits in the project folder hashes only `src`. Editing `project.json`, or a sibling
  file, re-renders nothing.
- HTML-based engines (`html`, `onetake`, `opuscar`, `animation-base`, `hyperframes`) in a sub-folder hash every
  file in the `src` folder, skipping `node_modules`, `.git`, `.vp-cache`, `out` and `.hyperframes`. Scenes
  that share a folder invalidate each other. Above 2000 files or 200 MB only the named files are hashed, with a warning.
- `watch` adds files or folders to the key for any engine. Entries are relative to the project file; folders
  are walked with the same skip rules. Example: `"watch": ["../assets/brand.css", "shared"]`. Paths are
  checked at load.
- The output, its `.draft.mp4`, and both `.report.json` files are never hashed, wherever they sit.
  Neither is `project.json` itself.
- Files outside a scene's folder invalidate nothing unless they are its `src`, `still`, `clip` or `watch`.
- Changing `transition` or `audio` re-renders no scenes; joining and mixing run on every full render.
- Draft and full renders use different format tags, so they keep separate clips.
- `--force` re-renders the selected scenes. Work dirs live in `.vp-cache/work/run-*`; they are removed on
  success and kept, with their path logged, on failure.
- `.vp-cache/` is safe to delete; it is rebuilt on the next render.

## Licences

- This repository: MIT, per `package.json`. There is no LICENSE file yet.
- The skills keep their own licences, and the pipeline does not vendor their code:
  - HyperFrames (heygen-com/hyperframes): Apache-2.0.
  - OneTake (feitangyuan/onetake): PolyForm Noncommercial 1.0.0. Commercial use needs a licence from the author.
  - Collage B-roll (pyang5166/gbro-collage-broll): MIT.
  - Claude Animation Base (JohnHeibel/ClaudeAnimationBase): MIT.
  - Lemo Opuscar (lemomo-ai/lemo-opuscar): MIT code; its assets carry their own licences.
- Check each checkout's and each asset's licence before publishing or selling a film.

## Development

```sh
npm test              # node --test 'test/*.test.mjs': 61 tests, no network or API keys
```

- `docs/ARCHITECTURE.md` has the module contracts, capture protocols and cache details.
- Fixtures implementing each protocol are in `test/fixtures/`.
