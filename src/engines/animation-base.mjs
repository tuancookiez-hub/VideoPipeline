import { join } from 'node:path';
import { captureHtml } from '../capture.mjs';

export async function render(scene, ctx) {
  const { width, height, fps } = ctx.project;
  const out = join(ctx.workDir, 'raw.mp4');
  await captureHtml({ src: scene.src, protocol: 'abase', width, height, fps, duration: scene.duration, out, chrome: ctx.chrome, log: ctx.log });
  return { clip: out };
}
