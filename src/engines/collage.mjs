import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { ffmpeg } from '../ffmpeg.mjs';
import * as video from './video.mjs';
import { kenBurns } from './image.mjs';

const run = promisify(execFile);
const PAPER = '0xefe6d2';
const INK = '0x3b3128';

export async function render(scene, ctx) {
  const log = ctx.log || console.log;
  if (scene.clip) return video.render({ ...scene, src: scene.clip }, ctx);
  const missing = missingForGemini(scene);
  if (!missing.length) return generate(scene, ctx, log);
  log(`WARN collage: offline fallback, Gemini needs ${missing.join(', ')}`);
  return scene.still ? paperStill(scene, ctx) : placeholderCard(scene, ctx);
}

// Names only, never values: which of the three requirements for a Gemini clip is unset.
export function missingForGemini(scene, env = process.env) {
  return [['GEMINI_API_KEY', env.GEMINI_API_KEY], ['VP_COLLAGE_DIR', env.VP_COLLAGE_DIR], ['scene.still', scene.still]]
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function aspectRatio({ width, height }) {
  return width >= height ? '16:9' : '9:16';
}

// The script accepts an integer duration between 3 and 10 seconds.
export function clampDuration(d) {
  return Math.min(10, Math.max(3, Math.round(d)));
}

// Argv for generate_video.py. Options come first; `--` ends them so a prompt like "-x" stays positional.
export function collageArgs(scene, { project, workDir, collageDir }) {
  return [join(collageDir, 'scripts', 'generate_video.py'), '--image', scene.still,
    '--aspect-ratio', aspectRatio(project), '--duration', String(clampDuration(scene.duration)),
    '--output', join(workDir, 'raw.mp4'), '--', scene.prompt || 'paper collage animation'];
}

async function generate(scene, ctx, log) {
  const clip = join(ctx.workDir, 'raw.mp4');
  const args = collageArgs(scene, { project: ctx.project, workDir: ctx.workDir, collageDir: process.env.VP_COLLAGE_DIR });
  log(`collage: uploading frames to the Gemini API (model via ${args[0]})`);
  try {
    await run('python3', args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const tail = `${err.stdout || ''}${err.stderr || ''}`.trim().split('\n').slice(-20).join('\n');
    throw new Error(`collage generate_video.py failed:\n${tail || err.message}`);
  }
  return { clip };
}

// Paper look on top of the Ken Burns still: warm curve, grain, slight desaturation.
async function paperStill(scene, ctx) {
  const { width, height, fps } = ctx.project;
  const clip = await kenBurns({
    src: scene.still,
    out: join(ctx.workDir, 'raw.mp4'),
    width,
    height,
    fps,
    duration: scene.duration,
    extraFilters: [
      'eq=saturation=0.88:contrast=1.04',
      'colorbalance=rs=0.07:gs=0.03:bs=-0.09:rm=0.05:bm=-0.05',
      'noise=alls=10:allf=t+u',
    ],
  });
  return { clip };
}

// A system sans font: fontconfig's default for "sans", else any TTF/OTF under /usr/share/fonts.
function fontFile() {
  try {
    const f = execFileSync('fc-match', ['-f', '%{file}', 'sans'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (f && existsSync(f)) return f;
  } catch { /* fc-match missing: scan below */ }
  try {
    const found = execFileSync('find', ['/usr/share/fonts', '-type', 'f', '(', '-name', '*.ttf', '-o', '-name', '*.otf', ')'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').find(Boolean);
    return found || null;
  } catch {
    return null;
  }
}

// Filtergraph option values need ':', '\' and "'" escaped.
function escapeOpt(s) {
  return s.replace(/[\\:']/g, (c) => `\\${c}`);
}

function wrap(text, max = 26) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

async function placeholderCard(scene, ctx) {
  const { width, height, fps } = ctx.project;
  const clip = join(ctx.workDir, 'raw.mp4');
  const font = fontFile();
  const filters = [];
  if (scene.prompt && font) {
    const lines = wrap(scene.prompt).split('\n');
    const size = Math.max(16, Math.round(height / 14));
    const lineH = Math.round(size * 1.3);
    const top = `(h-${lines.length * lineH})/2`;
    lines.forEach((line, i) => {
      const textPath = join(ctx.workDir, `card-${i}.txt`);
      writeFileSync(textPath, line);
      filters.push(`drawtext=fontfile='${escapeOpt(font)}':textfile='${escapeOpt(textPath)}':fontsize=${size}` +
        `:fontcolor=${INK}:x=(w-text_w)/2:y=${top}+${i * lineH}`);
    });
  }
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${PAPER}:s=${width}x${height}:r=${fps}:d=${scene.duration}`,
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    '-frames:v', String(Math.round(scene.duration * fps)),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', clip]);
  return { clip };
}
