import { join } from 'node:path';
import { ffmpeg } from '../ffmpeg.mjs';

// Ken Burns push-in. Input is upscaled to 2x so zoompan does not jitter.
// `extraFilters` (optional) is appended after the zoom, e.g. a look.
export async function kenBurns({ src, out, width, height, fps, duration, zoom = 1.08, extraFilters = [] }) {
  const frames = Math.round(duration * fps);
  const [w2, h2] = [width * 2, height * 2];
  const z = `1+(${zoom}-1)*on/${frames}`;
  const filters = [
    `scale=${w2}:${h2}:force_original_aspect_ratio=increase`,
    `crop=${w2}:${h2}`,
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
    ...extraFilters,
    'setsar=1',
    'format=yuv420p',
  ];
  await ffmpeg(['-i', src, '-vf', filters.join(','), '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(fps), '-an', out]);
  return out;
}

export async function render(scene, ctx) {
  const { width, height, fps } = ctx.project;
  const clip = await kenBurns({
    src: scene.src,
    out: join(ctx.workDir, 'raw.mp4'),
    width,
    height,
    fps,
    duration: scene.duration,
    zoom: scene.zoom ?? 1.08,
  });
  return { clip };
}
