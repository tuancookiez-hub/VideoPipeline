#!/usr/bin/env bash
# The whole film: UI + comp frames, the .blend, the render, the sound, the encode.
# Env: BLENDER (path to blender), CLAWD_RES (render %, default 100), CLAWD_SAMPLES (default 64)
set -euo pipefail
cd "$(dirname "$0")"
BLENDER="${BLENDER:-blender}"
python3 build_ui.py
node render_ui.js                       # needs playwright (or swap in puppeteer)
"$BLENDER" -b --factory-startup -P scene.py
"$BLENDER" -b ../build/scene.blend -P gpu.py -a
python3 sound.py
./encode.sh
