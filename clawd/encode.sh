#!/usr/bin/env bash
# H.264 High CRF 17, 30 fps, soft vignette, the WAV muxed as AAC 320k, +faststart.
# usage: encode.sh [out.mp4] [frame pattern] [sound.wav]   (defaults: the Clawd film)
set -euo pipefail
BUILD="$(cd "$(dirname "$0")/../build" && pwd)"
OUT="${1:-$BUILD/no_after_effects.mp4}"
FRAMES="${2:-$BUILD/frames/f_%04d.png}"
WAV="${3:-$BUILD/sound.wav}"
ffmpeg -v error -y -framerate 30 -i "$FRAMES" -i "$WAV" \
  -vf "scale=1920:1080:flags=lanczos,vignette=angle=PI/6" \
  -c:v libx264 -profile:v high -crf 17 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 320k -movflags +faststart -shortest "$OUT"
echo "wrote $OUT"
