# Starter project

Renders fully offline with no API keys: two HTML scenes and one collage scene
(the collage engine falls back to an offline placeholder when no key or skill
checkout is configured).

```sh
node bin/vp.mjs render examples/starter/project.json --draft
```

Output: `examples/starter/out/starter.draft.mp4` (full quality: drop `--draft`).

## Swapping in other engines

Each entry in `scenes` is one scene. Paths are relative to the project file.
Replace or add scene objects like these (one per engine):

```json
{ "id": "title", "engine": "html", "src": "scenes/title.html" }
{ "id": "walk", "engine": "onetake", "src": "scenes/walk.html", "duration": 8 }
{ "id": "film", "engine": "opuscar", "src": "scenes/film/index.html" }
{ "id": "host", "engine": "animation-base", "src": "/path/to/ClaudeAnimationBase/studio.html" }
{ "id": "intro", "engine": "hyperframes", "src": "scenes/intro/index.html" }
{ "id": "crane", "engine": "collage", "still": "assets/crane.png", "prompt": "paper crane takes off", "duration": 5 }
{ "id": "clip", "engine": "video", "src": "assets/x.mp4", "trim": [1, 4] }
{ "id": "card", "engine": "image", "src": "assets/card.png", "duration": 3 }
```

- `html`: any page that implements the seek protocol (`window.__meta.dur`, `window.__seek(t)`).
- `onetake`: OneTake's own seek contract. Prints a licence notice (PolyForm Noncommercial).
- `opuscar`: Lemo Opuscar; `src` is the page it renders with `window.render(t)`.
- `animation-base`: Claude Animation Base; `src` points at a studio page in your checkout.
- `hyperframes`: a HyperFrames composition, rendered with `npx hyperframes render` (fetched on demand).
- `collage`: give `clip` to use an existing video, or `prompt` (+ `VP_COLLAGE_DIR` and `GEMINI_API_KEY`) for generated B-roll. `duration` is required without `clip`.
- `video`: trims an existing file; `trim` is `[start, end]` in seconds.
- `image`: a still with a slow push-in; `duration` is required.

Run `node bin/vp.mjs doctor` to see which engines are ready on this machine.
