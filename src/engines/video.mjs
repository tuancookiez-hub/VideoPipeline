import { join } from 'node:path';
import { ffmpeg } from '../ffmpeg.mjs';

// Frame-accurate trim: -ss/-t after -i decode and discard, then re-encode.
export async function render(scene, ctx) {
  const clip = join(ctx.workDir, 'raw.mp4');
  const [start, end] = scene.trim ?? [0, undefined];
  const args = ['-i', scene.src, '-map', '0:v:0', '-map', '0:a?'];
  if (start) args.push('-ss', String(start));
  if (end !== undefined) args.push('-t', String(end - start));
  else if (scene.duration) args.push('-t', String(scene.duration));
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', clip);
  await ffmpeg(args);
  return { clip };
}
