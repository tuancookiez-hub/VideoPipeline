import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, probe } from '../src/ffmpeg.mjs';
import * as video from '../src/engines/video.mjs';
import * as image from '../src/engines/image.mjs';
import * as collage from '../src/engines/collage.mjs';
import { hyperframesArgs } from '../src/engines/hyperframes.mjs';

const project = { width: 320, height: 180, fps: 10 };
let dir;
let inputs;

function ctxFor(name) {
  const workDir = join(dir, name);
  mkdirSync(workDir, { recursive: true });
  return { project, workDir, chrome: null, log: () => {} };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vp-media-'));
  inputs = {
    video: join(dir, 'in.mp4'),
    still: join(dir, 'still.png'),
  };
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', inputs.video]);
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x360', '-frames:v', '1', inputs.still]);
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('video trims scene.trim to the requested length and keeps audio', async () => {
  const { clip } = await video.render({ src: inputs.video, trim: [1, 3] }, ctxFor('video-trim'));
  const info = await probe(clip);
  assert.ok(Math.abs(info.duration - 2) <= 0.1, `duration ${info.duration}`);
  assert.equal(info.hasAudio, true);
});

test('video honours scene.duration when no trim is given', async () => {
  const { clip } = await video.render({ src: inputs.video, duration: 1.5 }, ctxFor('video-dur'));
  const info = await probe(clip);
  assert.ok(Math.abs(info.duration - 1.5) <= 0.1, `duration ${info.duration}`);
});

test('image renders scene.duration at project size', async () => {
  const { clip } = await image.render({ src: inputs.still, duration: 2 }, ctxFor('image'));
  const info = await probe(clip);
  assert.ok(Math.abs(info.duration - 2) <= 0.1, `duration ${info.duration}`);
  assert.equal(info.width, 320);
  assert.equal(info.height, 180);
});

test('collage without still or clip gives a placeholder card of scene.duration', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.VP_COLLAGE_DIR;
  const { clip } = await collage.render({ engine: 'collage', prompt: 'paper crane takes off', duration: 1.5 }, ctxFor('collage-card'));
  const info = await probe(clip);
  assert.ok(Math.abs(info.duration - 1.5) <= 0.1, `duration ${info.duration}`);
  assert.equal(info.width, 320);
});

test('collage with still falls back to the paper look of scene.duration', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.VP_COLLAGE_DIR;
  const { clip } = await collage.render({ engine: 'collage', still: inputs.still, duration: 2 }, ctxFor('collage-still'));
  const info = await probe(clip);
  assert.ok(Math.abs(info.duration - 2) <= 0.1, `duration ${info.duration}`);
  assert.equal(info.height, 180);
});

test('collage clamps the Gemini duration to the script range', () => {
  assert.equal(collage.clampDuration(1), 3);
  assert.equal(collage.clampDuration(5.4), 5);
  assert.equal(collage.clampDuration(12), 10);
});

test('hyperframesArgs pins the CLI version and passes fps and output', () => {
  const args = hyperframesArgs({ src: '/abs/scenes/intro/index.html' }, { workDir: '/abs/work', project: { fps: 24 } });
  assert.deepEqual(args, ['--yes', 'hyperframes@0.8.159', 'render', '/abs/scenes/intro', '-c', 'index.html',
    '-o', '/abs/work/raw.mp4', '-f', '24', '--quiet']);
});
