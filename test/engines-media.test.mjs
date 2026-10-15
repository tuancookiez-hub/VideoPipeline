import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpeg, probe } from '../src/ffmpeg.mjs';
import * as video from '../src/engines/video.mjs';
import * as image from '../src/engines/image.mjs';
import * as collage from '../src/engines/collage.mjs';
import { defaultBrowser, hyperframesArgs, hyperframesEnv, runCli } from '../src/engines/hyperframes.mjs';

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

test('collageArgs ends options before the prompt so a dash-led prompt stays positional', () => {
  const args = collage.collageArgs({ still: '/abs/a.png', duration: 4, prompt: '-dash start' },
    { project, workDir: '/abs/work', collageDir: '/abs/collage' });
  assert.deepEqual(args, ['/abs/collage/scripts/generate_video.py', '--image', '/abs/a.png',
    '--aspect-ratio', '16:9', '--duration', '4', '--output', '/abs/work/raw.mp4', '--', '-dash start']);
});

test('collageArgs uses the default prompt and a portrait ratio for tall projects', () => {
  const args = collage.collageArgs({ still: '/abs/a.png', duration: 20 },
    { project: { width: 180, height: 320 }, workDir: '/w', collageDir: '/c' });
  assert.equal(args[args.length - 1], 'paper collage animation');
  assert.equal(args[args.indexOf('--aspect-ratio') + 1], '9:16');
  assert.equal(args[args.indexOf('--duration') + 1], '10');
});

test('missingForGemini names only the unset requirements', () => {
  const env = { GEMINI_API_KEY: 'secret-value', VP_COLLAGE_DIR: '/c' };
  assert.deepEqual(collage.missingForGemini({ still: '/a.png' }, env), []);
  assert.deepEqual(collage.missingForGemini({ prompt: 'x' }, env), ['scene.still']);
  assert.deepEqual(collage.missingForGemini({ still: '/a.png' }, { VP_COLLAGE_DIR: '/c' }), ['GEMINI_API_KEY']);
  assert.deepEqual(collage.missingForGemini({}, {}), ['GEMINI_API_KEY', 'VP_COLLAGE_DIR', 'scene.still']);
});

describe('hyperframes child environment', () => {
  const base = {
    PATH: '/usr/bin', HOME: '/home/u', HTTPS_PROXY: 'http://proxy:3128', NODE_EXTRA_CA_CERTS: '/ca.pem',
    npm_config_registry: 'https://registry.npmjs.org', GEMINI_API_KEY: 'g-secret', GITHUB_TOKEN: 't-secret',
    AWS_SECRET_ACCESS_KEY: 's-secret', DB_PASSWORD: 'p-secret', HYPERFRAMES_LOG: 'debug',
  };
  let browsers;

  before(() => {
    browsers = join(dir, 'browsers');
    for (const v of ['1100', '1194']) {
      mkdirSync(join(browsers, `chromium_headless_shell-${v}`, 'chrome-linux'), { recursive: true });
      writeFileSync(join(browsers, `chromium_headless_shell-${v}`, 'chrome-linux', 'headless_shell'), '');
    }
    mkdirSync(join(browsers, 'chromium_headless_shell-1300', 'chrome-linux'), { recursive: true });
  });

  test('drops secret-like variables and keeps PATH, HOME, proxy, npm and HYPERFRAMES_*', () => {
    const env = hyperframesEnv(base, browsers);
    for (const name of ['GEMINI_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD']) {
      assert.equal(env[name], undefined, name);
    }
    assert.ok(!Object.values(env).includes('g-secret'));
    for (const name of ['PATH', 'HOME', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'npm_config_registry', 'HYPERFRAMES_LOG']) {
      assert.equal(env[name], base[name], name);
    }
    assert.equal(env.HYPERFRAMES_NO_TELEMETRY, '1');
  });

  test('defaults the browser to the newest headless shell that exists', () => {
    assert.equal(defaultBrowser(browsers), join(browsers, 'chromium_headless_shell-1194', 'chrome-linux', 'headless_shell'));
    assert.equal(hyperframesEnv(base, browsers).HYPERFRAMES_BROWSER_PATH,
      join(browsers, 'chromium_headless_shell-1194', 'chrome-linux', 'headless_shell'));
    assert.equal(defaultBrowser(join(dir, 'missing')), null);
    assert.equal(hyperframesEnv(base, join(dir, 'missing')).HYPERFRAMES_BROWSER_PATH, undefined);
  });

  test('VP_HYPERFRAMES_BROWSER overrides the default', () => {
    const env = hyperframesEnv({ ...base, VP_HYPERFRAMES_BROWSER: '/custom/shell' }, browsers);
    assert.equal(env.HYPERFRAMES_BROWSER_PATH, '/custom/shell');
  });

  test('runCli kills the child and throws when the timeout passes', async () => {
    const started = Date.now();
    await assert.rejects(runCli(['30'], { env: process.env, timeoutS: 0.2, bin: 'sleep' }), /timed out after 0.2s/);
    assert.ok(Date.now() - started < 5000);
  });

  test('SIGINT to the parent kills the render group, so no grandchild outlives it', async () => {
    const work = mkdtempSync(join(tmpdir(), 'vp-sigint-'));
    const pidFile = join(work, 'pid');
    const mod = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'engines', 'hyperframes.mjs');
    const script = `import(${JSON.stringify(mod)}).then((m) => m.runCli(['-c', 'sleep 30 & echo $! > "$PIDFILE"; wait'], `
      + `{ env: process.env, timeoutS: 60, bin: 'sh' }).catch(() => {}))`;
    const parent = spawn(process.execPath, ['-e', script], { env: { ...process.env, PIDFILE: pidFile }, stdio: 'ignore' });
    try {
      const deadline = Date.now() + 10000;
      while (!existsSync(pidFile) || !readFileSync(pidFile, 'utf8').trim()) {
        assert.ok(Date.now() < deadline, 'child never started');
        await new Promise((ok) => setTimeout(ok, 50));
      }
      const grandchild = Number(readFileSync(pidFile, 'utf8'));
      parent.kill('SIGINT');
      const [code, signal] = await once(parent, 'exit');
      assert.equal(signal, 'SIGINT', `parent exit code ${code}`);
      const alive = () => { try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${grandchild}/stat`, 'utf8')); } catch { return false; } };
      const until = Date.now() + 5000;
      while (alive() && Date.now() < until) await new Promise((ok) => setTimeout(ok, 50));
      assert.equal(alive(), false, 'grandchild still running');
    } finally {
      parent.kill('SIGKILL');
      rmSync(work, { recursive: true, force: true });
    }
  });
});
