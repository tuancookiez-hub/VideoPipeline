import { join } from 'node:path';
import { captureHtml } from '../capture.mjs';

let warned = false;

export async function render(scene, ctx) {
  if (!warned) {
    warned = true;
    (ctx.log ?? console.warn)('onetake: PolyForm Noncommercial licence — commercial use needs a separate licence from the author');
  }
  const { width, height, fps } = ctx.project;
  const out = join(ctx.workDir, 'raw.mp4');
  await captureHtml({ src: scene.src, protocol: 'seek', width, height, fps, duration: scene.duration, out, chrome: ctx.chrome, log: ctx.log });
  return { clip: out };
}
