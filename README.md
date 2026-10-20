# VideoPipeline

## clawd/ — "No After Effects. Just Clawd."

A 12 s, 30 fps character film: Clawd peels off a flat layer in an After Effects-style
workspace, pops into 3D and builds a motion graphic by jumping on the buttons.
Built from the Clawd Motion Lab prompt pack.

| file | role |
| --- | --- |
| `timeline.py` | single source of truth: UI layout in pixels, every event and hop |
| `build_ui.py` | writes the workspace as HTML (`build/ui.html`) |
| `comp.html` | canvas that draws the comp per frame from the playhead time |
| `render_ui.js` | headless Chromium: `ui.png` (3840x2160), 360 comp frames, card/chip textures |
| `scene.py` | Blender 5 scene: floating slabs, Clawd, keycaps, playhead, camera, lights |
| `gpu.py` | picks OptiX/CUDA/HIP if present, else CPU (pass with `-P` on every render) |
| `sound.py` | synthesized soundtrack (numpy, scipy, pedalboard) → `build/sound.wav` |
| `encode.sh` | H.264 CRF 17 + AAC 320k → `build/no_after_effects.mp4` |

Run everything with `BLENDER=/path/to/blender clawd/make_film.sh`.
Requirements: Blender 5, Node with playwright, Python with numpy/scipy/pedalboard, ffmpeg.
`CLAWD_RES` and `CLAWD_SAMPLES` lower the render cost for previews.
