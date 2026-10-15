import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, probe } from '../src/ffmpeg.mjs';
import { normalizeClip } from '../src/normalize.mjs';
import { joinClips, mixAudio } from '../src/assemble.mjs';

const W = 320;
const H = 180;
const FPS = 10;

describe('normalize, join and mix', () => {
  let dir;
  const f = (name) => join(dir, name);
  const near = (a, b, tol = 0.1) => assert.ok(Math.abs(a - b) <= tol, `expected ${a} ~ ${b} (±${tol})`);

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vp-test-'));
    const src = (args, out) => ffmpeg([...args, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out]);
    await src(['-f', 'lavfi', '-i', 'testsrc2=s=400x400:r=25:d=3',
      '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=3'], f('square.mp4'));
    await src(['-f', 'lavfi', '-i', 'color=c=red:s=640x200:r=24:d=2'], f('silent.mp4'));
    await src(['-f', 'lavfi', '-i', 'testsrc2=s=640x200:r=24:d=4',
      '-f', 'lavfi', '-i', 'sine=f=660:r=44100:d=4'], f('wide.mp4'));
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=220:r=48000:d=1', f('music.wav')]);
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=880:r=48000:d=0.5', f('vo.wav')]);
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('normalizeClip', () => {
    const opts = { width: W, height: H, fps: FPS };

    test('exact size, fps and audio from odd-sized 25 fps input', async () => {
      const r = await normalizeClip(f('square.mp4'), f('n-square.mp4'), opts);
      const p = await probe(r.out);
      assert.equal(p.width, W);
      assert.equal(p.height, H);
      near(p.fps, FPS, 0.01);
      assert.ok(p.hasAudio);
      near(p.duration, 3);
      near(r.duration, 3);
    });

    test('silent input gets a silent audio track and is padded to duration', async () => {
      const r = await normalizeClip(f('silent.mp4'), f('n-silent.mp4'), { ...opts, duration: 3 });
      const p = await probe(r.out);
      assert.equal(p.width, W);
      assert.equal(p.height, H);
      assert.ok(p.hasAudio);
      near(p.duration, 3);
    });

    test('longer input is trimmed to duration', async () => {
      const r = await normalizeClip(f('wide.mp4'), f('n-wide.mp4'), { ...opts, duration: 2 });
      const p = await probe(r.out);
      assert.equal(p.width, W);
      assert.ok(p.hasAudio);
      near(p.duration, 2);
    });
  });

  describe('joinClips', () => {
    let a;
    let b;
    let c;
    before(async () => {
      const opts = { width: W, height: H, fps: FPS };
      a = await normalizeClip(f('square.mp4'), f('ja.mp4'), opts);
      b = await normalizeClip(f('silent.mp4'), f('jb.mp4'), opts);
      c = await normalizeClip(f('wide.mp4'), f('jc.mp4'), { ...opts, duration: 2 });
    });

    test('single clip is copied', async () => {
      const r = await joinClips([{ path: a.out, duration: a.duration }], { out: f('j-single.mp4') });
      near(r.duration, a.duration);
    });

    test('transition none concatenates to the sum of durations', async () => {
      const clips = [a, b, c].map((x) => ({ path: x.out, duration: x.duration }));
      const r = await joinClips(clips, { transition: { type: 'none' }, out: f('j-none.mp4') });
      near(r.duration, 7);
      const p = await probe(r.out);
      assert.equal(p.width, W);
      assert.ok(p.hasAudio);
    });

    test('fade transition subtracts overlap for each join', async () => {
      const d = 0.5;
      const clips = [a, b, c].map((x) => ({ path: x.out, duration: x.duration }));
      const r = await joinClips(clips, { transition: { type: 'fade', duration: d }, out: f('j-fade.mp4') });
      near(r.duration, 7 - 2 * d, 0.15);
      assert.ok((await probe(r.out)).hasAudio);
    });

    test('transition longer than the shortest clip throws', async () => {
      const clips = [a, b].map((x) => ({ path: x.out, duration: x.duration }));
      await assert.rejects(
        joinClips(clips, { transition: { type: 'fade', duration: 2.5 }, out: f('j-bad.mp4') }),
        /transition duration 2\.5s must be shorter than the shortest clip \(2(\.0+)?s\)/,
      );
    });
  });

  describe('mixAudio', () => {
    test('music and voiceover over a video keep its duration and have audio', async () => {
      const out = f('mix-full.mp4');
      const video = f('ja.mp4');
      const { out: mixed } = await mixAudio(video, {
        music: f('music.wav'),
        voiceover: [{ src: f('vo.wav'), at: 1 }],
      }, out);
      const p = await probe(mixed);
      const v = await probe(video);
      assert.ok(p.hasAudio);
      assert.equal(p.width, v.width);
      near(p.duration, v.duration);
    });

    test('voiceover only, without ducking, keeps duration', async () => {
      const out = f('mix-vo.mp4');
      await mixAudio(f('ja.mp4'), { voiceover: [{ src: f('vo.wav'), at: 0 }, { src: f('vo.wav'), at: 2 }], duck: false }, out);
      const p = await probe(out);
      assert.ok(p.hasAudio);
      near(p.duration, 3);
    });

    test('no audio config copies the input', async () => {
      const out = f('mix-copy.mp4');
      await mixAudio(f('ja.mp4'), undefined, out);
      const p = await probe(out);
      assert.ok(p.hasAudio);
      near(p.duration, 3);
      await mixAudio(f('ja.mp4'), {}, f('mix-copy2.mp4'));
      near((await probe(f('mix-copy2.mp4'))).duration, 3);
    });
  });
});
