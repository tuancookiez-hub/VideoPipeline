import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, probe } from '../src/ffmpeg.mjs';
import { loadProject } from '../src/config.mjs';
import { renderProject } from '../src/pipeline.mjs';

const silent = () => {};
let dir;
let project;

const FX_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><script src="fx.js"></script></head>
<body style="margin:0;background:#101018;overflow:hidden">
<div id="box" style="position:absolute;top:40px;left:0;width:60px;height:60px;background:#e33"></div>
</body></html>
`;

const FX_SCRIPT = (speed) => `window.__ready = Promise.resolve();
window.__meta = { dur: 1 };
window.__seek = (t) => { document.getElementById('box').style.left = (t * ${speed}) + 'px'; };
`;

function streamDurations(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', file], { encoding: 'utf8' });
  const byType = {};
  for (const s of JSON.parse(out).streams) byType[s.codec_type] = parseFloat(s.duration);
  return byType;
}

const cacheFiles = () => readdirSync(join(dir, '.vp-cache'));

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vp-pipeline-'));
  for (const sub of ['img', 'audio', 'scenes']) mkdirSync(join(dir, sub));
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1', join(dir, 'img', 'a.png')]);
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=640x360', '-frames:v', '1', join(dir, 'img', 'b.png')]);
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', join(dir, 'audio', 'bed.wav')]);
  writeFileSync(join(dir, 'scenes', 'fx.html'), FX_PAGE);
  writeFileSync(join(dir, 'scenes', 'fx.js'), FX_SCRIPT(200));
  project = {
    title: 'pipe',
    width: 320,
    height: 180,
    fps: 10,
    output: 'out/film.mp4',
    transition: { type: 'fade', duration: 0.3 },
    audio: { music: 'audio/bed.wav' },
    scenes: [
      { id: 'a', engine: 'image', src: 'img/a.png', duration: 1 },
      { id: 'fx', engine: 'html', src: 'scenes/fx.html' },
      { id: 'b', engine: 'image', src: 'img/b.png', duration: 1.5 },
    ],
  };
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2));
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('full render: duration is sum minus transitions, audio matches video, report written, work dir removed', async () => {
  const p = loadProject(join(dir, 'project.json'));
  const result = await renderProject(p, { log: silent });
  assert.equal(result.output, join(dir, 'out', 'film.mp4'));

  const info = await probe(result.output);
  assert.equal(info.width, 320);
  assert.equal(info.height, 180);
  assert.ok(Math.abs(info.duration - 2.9) <= 0.1, `duration ${info.duration}`);
  assert.ok(info.hasAudio);
  const s = streamDurations(result.output);
  assert.ok(Math.abs(s.audio - s.video) <= 0.05, `audio ${s.audio} vs video ${s.video}`);

  const report = JSON.parse(readFileSync(`${result.output}.report.json`, 'utf8'));
  assert.ok(Math.abs(report.durationSeconds - 2.9) <= 0.1);
  assert.deepEqual(report.scenes.map((x) => x.id), ['a', 'fx', 'b']);
  assert.ok(report.scenes.every((x) => x.cached === false));

  const runs = readdirSync(join(dir, '.vp-cache', 'work')).filter((n) => n.startsWith('run-'));
  assert.deepEqual(runs, []);
});

test('second run is fully cached', async () => {
  const p = loadProject(join(dir, 'project.json'));
  const result = await renderProject(p, { log: silent });
  assert.ok(result.scenes.every((s) => s.cached), JSON.stringify(result.scenes));
});

test('editing a sibling script invalidates only the html scene', async () => {
  writeFileSync(join(dir, 'scenes', 'fx.js'), FX_SCRIPT(240));
  const p = loadProject(join(dir, 'project.json'));
  const result = await renderProject(p, { log: silent });
  const cached = Object.fromEntries(result.scenes.map((s) => [s.id, s.cached]));
  assert.deepEqual(cached, { a: true, fx: false, b: true });
});

test('only renders the selected scenes and returns no output; unknown ids are rejected', async () => {
  const p = loadProject(join(dir, 'project.json'));
  const result = await renderProject(p, { only: ['a'], log: silent });
  assert.equal(result.output, null);
  assert.deepEqual(result.scenes.map((s) => s.id), ['a']);
  await assert.rejects(renderProject(p, { only: ['nope'], log: silent }), /unknown scene id/);
});

test('draft writes <name>.draft.mp4 at half size and keeps one clip per scene and format', async () => {
  const p = loadProject(join(dir, 'project.json'));
  const result = await renderProject(p, { draft: true, log: silent });
  assert.equal(result.output, join(dir, 'out', 'film.draft.mp4'));
  const info = await probe(result.output);
  assert.equal(info.width, 160);
  assert.equal(info.height, 90);
  const fxClips = cacheFiles().filter((n) => /^fx-\d+x\d+p\d+-[0-9a-f]{12}\.mp4$/.test(n));
  assert.equal(fxClips.length, 2, fxClips.join(', '));
  assert.equal(fxClips.filter((n) => n.startsWith('fx-160x90p')).length, 1, fxClips.join(', '));
});

describe('project at the root with its output next to the scene', () => {
  let rootDir;

  before(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'vp-root-'));
    writeFileSync(join(rootDir, 'index.html'), `<!doctype html><script>
      window.__meta = { dur: 1 };
      window.__ready = Promise.resolve();
      window.__seek = (t) => { document.body.style.background = t > 0.5 ? '#fff' : '#000'; };
    </script>`);
    writeFileSync(join(rootDir, 'project.json'), JSON.stringify({
      title: 'root', width: 320, height: 180, fps: 10, output: 'final.mp4',
      scenes: [{ id: 'a', engine: 'html', src: 'index.html' }],
    }, null, 2));
  });

  after(() => {
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
  });

  test('render twice: the output, its draft and their reports do not invalidate the cache', async () => {
    const p = loadProject(join(rootDir, 'project.json'));
    const first = await renderProject(p, { log: silent });
    assert.equal(first.scenes[0].cached, false);
    assert.ok(existsSync(join(rootDir, 'final.mp4')));
    await renderProject(p, { draft: true, log: silent });
    assert.ok(existsSync(join(rootDir, 'final.draft.mp4')));
    const second = await renderProject(p, { log: silent });
    assert.deepEqual(second.scenes.map((s) => s.cached), [true]);
  });
});
