# VideoPipeline architecture

VideoPipeline turns a **project file** (a JSON scene list) into one finished MP4.
Each scene is rendered by an **engine**, normalized to the project format, then
the clips are joined (with optional transitions) and an audio bed is mixed in.

```
project.json ──► config.loadProject ──► for each scene:
                                           cache hit? ──yes──► reuse clip
                                              │no
                                           engines[scene.engine].render(scene, ctx)  → raw clip
                                           normalize.normalizeClip(raw)              → uniform clip
                 assemble.joinClips(clips, transition) ──► assemble.mixAudio(...) ──► output.mp4
```

Runtime: Node >= 22, ESM (`.mjs`), no TypeScript, no build step.
Only runtime dependency: `playwright-core@1.56.1` (matches the pre-installed
Chromium build 1194). ffmpeg/ffprobe come from the system PATH.

## Engines

| engine           | source skill            | how it renders                                            |
|------------------|-------------------------|-----------------------------------------------------------|
| `html`           | (generic contract)      | capture.mjs, protocol `seek`                              |
| `onetake`        | feitangyuan/onetake     | capture.mjs, protocol `seek` (OneTake's own contract)     |
| `opuscar`        | lemomo-ai/lemo-opuscar  | capture.mjs, protocol `render`                            |
| `animation-base` | JohnHeibel/ClaudeAnimationBase | capture.mjs, protocol `abase`                      |
| `hyperframes`    | heygen-com/hyperframes  | native CLI: `npx hyperframes render`                      |
| `collage`        | pyang5166/gbro-collage-broll | supplied clip, or Gemini script, or offline fallback |
| `video`          | any                     | trims an existing video file                              |
| `image`          | any                     | still image with slow Ken Burns push-in                   |

We never vendor code from the skill repos. HTML scenes load their own libraries
by relative path; engines that need a skill checkout read its location from an
env var (`VP_COLLAGE_DIR`). OneTake is PolyForm Noncommercial: the `onetake`
engine prints a one-line licence warning when used.

## Capture protocols (src/capture.mjs)

All use the Chromium found by `chrome.findChrome()`, deviceScaleFactor 1,
frames t = i / fps for i in [0, round(duration*fps)). Frames are PNG piped into
`ffmpeg.spawnEncoder`, which encodes them at their native size; normalize.mjs
then fits them to the project format (letterbox, never stretch). The viewport is
the project size, except Opuscar, which is captured at 1920×1080 like its own
renderer (served from a loopback-only http server rooted at `$VP_OPUSCAR_DIR`).
All protocols await `document.fonts.ready`, fail fast on a page error or on a
document/script/stylesheet that fails to load, and time out a frame hook after
`frameTimeoutMs` (default 30 s). Other failed subresources (image, font, media, fetch, xhr)
are logged through `log` as `capture: optional resource failed: <url> (<reason>)` and the capture goes on.

| protocol | ready                                   | duration (if scene.duration unset) | per frame                                           |
|----------|-----------------------------------------|------------------------------------|-----------------------------------------------------|
| `seek`   | `await window.__ready` (if defined)     | `window.__meta.dur`                | `await window.__seek(t)` then viewport screenshot   |
| `render` | `window.READY === true` (like openDemo) | `DUR` (const or window prop)       | `await window.render(t)` then viewport screenshot   |
| `abase`  | load `src?render`, wait `window.ready === true` (60 s) | `LOOP ? LOOP.len : DUR` (page-scope consts) | `window.renderAt(t, ...)` returns an image data URL; decode and use it as the frame |

Exact arguments for Opuscar (query params) and ClaudeAnimationBase (`renderAt`
args) must match their own renderers: `refs/lemo-opuscar/core/render/*.mjs`,
`refs/ClaudeAnimationBase/render.mjs`.

## Module contracts

All paths are absolute after `loadProject`.

### src/chrome.mjs  (done)
- `findChrome(): string` — `$VP_CHROME`, else newest `/opt/pw-browsers/chromium-*/chrome-linux/chrome`; throws if none.
- `CHROME_ARGS: string[]` — flags for headless software WebGL.

### src/ffmpeg.mjs  (done)
- `ffmpeg(args: string[]): Promise<void>` — runs `ffmpeg -hide_banner -loglevel error -y ...args`; rejects with stderr.
- `probe(file): Promise<{duration, width, height, fps, hasAudio}>`
- `spawnEncoder({out, fps}): {write(buf): Promise<void>, close(): Promise<void>}` — PNG frames on stdin → H.264 yuv420p CRF 18 at native size (padded to even dims); write() rejects with ffmpeg's own error if it dies.

### src/capture.mjs
- `captureHtml({src, protocol, width, height, fps, duration?, out, chrome, timeoutMs?, frameTimeoutMs?, query?, log?}): Promise<{out, frames, duration}>` — `timeoutMs` bounds the ready wait.

### src/engines/<name>.mjs
- `export async function render(scene, ctx): Promise<{clip: string}>`
- `ctx = {project, workDir, chrome, log}`; `workDir` is a scratch dir for this scene; write the raw clip inside it.
- Raw clip can be any size/fps/with or without audio; normalize fixes it.
- `src/engines/index.mjs` (done) maps engine name → module (lazy import).

### src/normalize.mjs
- `normalizeClip(input, out, {width, height, fps, duration?}): Promise<{out, duration}>`
  scale to fit + pad (letterbox, black), exact fps, setsar=1, yuv420p, libx264 CRF 18;
  audio always present: AAC 48 kHz stereo, silent track generated when the input has none;
  if `duration` given, trim/pad (hold last frame) to exactly that length.

### src/assemble.mjs
- `joinClips(clips: {path, duration}[], {transition: {type: 'none'|'fade'|'fadeblack'|...xfade names, duration}, out}): Promise<{out, duration}>`
  `none` → concat demuxer (stream copy is fine because clips are uniform);
  otherwise xfade + acrossfade chain with offsets computed from durations.
- `mixAudio(video, audio: {music?, musicVolume=0.25, voiceover?: {src, at}[], duck=true, loudness=-14, fadeOut=1.5}, out): Promise<{out}>`
  keeps the clips' own audio, loops/trims music to video length with fade-out, places
  voiceover lines with adelay, ducks music under voiceover (sidechaincompress) when duck,
  final loudnorm to `loudness` LUFS; video stream copied.

### src/config.mjs
- `loadProject(file): Project` — resolve relative paths against the project file's dir, apply defaults, validate; throws `ConfigError` listing every problem.
  Scene keys: `id engine src still clip prompt duration trim zoom timeout watch` (unknown keys warn). `timeout` > 0 seconds; `watch` is an array of existing files or folders (resolved). Audio levels are checked when present: `musicVolume` 0–4, `duck` boolean, `loudness` −70…−5, `fadeOut` ≥ 0.

```jsonc
{
  "title": "demo",                 // required
  "width": 1920, "height": 1080, "fps": 30,     // defaults
  "output": "out/<title>.mp4",     // default
  "transition": {"type": "fade", "duration": 0.5},   // default {"type":"none"}
  "audio": {"music": "assets/bed.mp3", "voiceover": [{"src": "vo/1.wav", "at": 2.0}]},
  "scenes": [
    {"id": "intro", "engine": "hyperframes", "src": "scenes/intro/index.html"},
    {"id": "walk",  "engine": "onetake", "src": "scenes/walk.html", "duration": 8},
    {"id": "crane", "engine": "collage", "still": "assets/crane.png", "prompt": "paper crane takes off", "duration": 5},
    {"id": "host",  "engine": "animation-base", "src": "/path/ClaudeAnimationBase/studio.html"},
    {"id": "film",  "engine": "opuscar", "src": "scenes/film/index.html"},
    {"id": "clip",  "engine": "video", "src": "assets/x.mp4", "trim": [1, 4]},
    {"id": "card",  "engine": "image", "src": "assets/card.png", "duration": 3}
  ]
}
```
Scene ids must be unique and match `^[a-z0-9][a-z0-9-]*$`. `src` required for every
engine except `collage`. `duration` (seconds, > 0) required for `image` and for a
`collage` without `clip`.

### src/cache.mjs
- `async sceneKey(scene, project, {log}): Promise<string>` — sha256 over scene JSON (with `watch` relative), project width/height/fps, and the streamed bytes of the scene's files: `src`, `still`, `clip`, plus `watch` entries (folders walked recursively).
  - Root-level `src` (`dirname(src) === project.dir`): only `src` (and `watch`). Project.json and siblings are not hashed.
  - Sub-folder `src`: every file under its folder, skipping node_modules, .git, .vp-cache, out, .hyperframes. Above 2000 files / 200 MB the folder is skipped with a warning.
  - Always excluded from every walk: `project.file`, `project.output`, `<output>.report.json`, the draft path (`<name>.draft.mp4`) and its `.report.json`.
  - Collage keys include which path runs (clip / gemini / fallback). Paths in the key are relative to the project dir.
  - `draftPath(output)` is exported from cache.mjs and shared with pipeline.mjs.
- Cache dir: `<projectDir>/.vp-cache/`; normalized clip stored as `<id>-<W>x<H>p<fps>-<key12>.mp4`; older clips of the same scene and format are pruned. Each run works in its own `.vp-cache/work/run-*` dir.

### src/pipeline.mjs
- `renderProject(project, {only?: string[], force?, draft?, log?}): Promise<{output, scenes: {id, clip, duration, cached}[]}>`
  `draft` halves width/height (rounded to even) and caps fps at 15; draft output goes to `<name>.draft.mp4`.
  Writes `<output>.report.json` next to the output.

### bin/vp.mjs
- `vp render <project.json> [--only a,b] [--force] [--draft]`
- `vp doctor` — reports node, ffmpeg, chromium, playwright-core, hyperframes CLI availability, `GEMINI_API_KEY` set?, `VP_COLLAGE_DIR` set?
- `vp init <dir>` — copies `examples/starter` to a new project dir.

## Tests
`node --test test/` — fast (tiny 320×180, ~1 s scenes, 10 fps), no network, no API keys.
Tests use fixture HTML pages in `test/fixtures/` that implement each protocol.
