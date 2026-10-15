import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadProject } from '../src/config.mjs';
import { cachedClipPath, sceneKey } from '../src/cache.mjs';

async function makeProject(project, files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'vp-config-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  const file = join(dir, 'project.json');
  await writeFile(file, JSON.stringify(project, null, 2));
  return { dir, file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('valid project loads with absolute paths and defaults', async () => {
  const p = await makeProject(
    { title: 'demo', scenes: [{ id: 'a', engine: 'html', src: 'scenes/a.html' }, { id: 'b', engine: 'collage', prompt: 'cranes', duration: 2 }] },
    { 'scenes/a.html': '<html></html>' },
  );
  try {
    const project = loadProject(p.file);
    assert.equal(project.dir, p.dir);
    assert.equal(project.file, p.file);
    assert.equal(project.width, 1920);
    assert.equal(project.height, 1080);
    assert.equal(project.fps, 30);
    assert.deepEqual(project.transition, { type: 'none', duration: 0 });
    assert.equal(project.output, join(p.dir, 'out', 'demo.mp4'));
    assert.equal(project.scenes[0].src, join(p.dir, 'scenes', 'a.html'));
    assert.equal(project.scenes[1].src, undefined);
  } finally {
    await p.cleanup();
  }
});

test('audio and trim paths are resolved against the project dir', async () => {
  const p = await makeProject(
    {
      title: 'audio',
      output: 'final/x.mp4',
      audio: { music: 'bed.mp3', voiceover: [{ src: 'vo/1.wav', at: 2 }] },
      scenes: [{ id: 'clip', engine: 'video', src: 'x.mp4', trim: [1, 4] }],
    },
    { 'bed.mp3': 'x', 'vo/1.wav': 'x', 'x.mp4': 'x' },
  );
  try {
    const project = loadProject(p.file);
    assert.equal(project.audio.music, join(p.dir, 'bed.mp3'));
    assert.equal(project.audio.voiceover[0].src, join(p.dir, 'vo', '1.wav'));
    assert.equal(project.output, join(p.dir, 'final', 'x.mp4'));
    assert.deepEqual(project.scenes[0].trim, [1, 4]);
  } finally {
    await p.cleanup();
  }
});

test('a project with several mistakes reports all of them', async () => {
  const p = await makeProject({
    width: 1281,
    height: 720,
    fps: 0,
    transition: { type: 'fade' },
    audio: { music: 'missing-bed.mp3' },
    scenes: [
      { id: 'dup', engine: 'html', src: 'nope.html' },
      { id: 'dup', engine: 'html', src: 'scenes/a.html' },
      { id: 'Bad Id', engine: 'hyperframes', src: 'scenes/a.html' },
      { id: 'bogus', engine: 'nonexistent', src: 'scenes/a.html' },
      { id: 'card', engine: 'image' },
      { id: 'clip', engine: 'video', src: 'scenes/a.html', trim: [3, 1] },
    ],
  }, { 'scenes/a.html': '<html></html>' });
  try {
    let err;
    try {
      loadProject(p.file);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof ConfigError, 'expected ConfigError');
    const text = err.problems.join('\n');
    for (const expected of [
      'title: required',
      'width: must be a positive even integer',
      'fps: must be a number from 1 to 120',
      'transition: duration must be > 0',
      'audio.music: file not found',
      'duplicate id "dup"',
      'nope.html',
      'id" is required',
      'unknown engine "nonexistent"',
      '"duration" is required for engine image',
      '"trim" must be [a, b]',
    ]) {
      assert.ok(text.includes(expected), `missing problem: ${expected}\n${text}`);
    }
    assert.ok(err.problems.length >= 10);
  } finally {
    await p.cleanup();
  }
});

test('empty scenes array is a problem', async () => {
  const p = await makeProject({ title: 'x', scenes: [] });
  try {
    assert.throws(() => loadProject(p.file), (e) => e instanceof ConfigError && e.problems.some((m) => m.includes('non-empty')));
  } finally {
    await p.cleanup();
  }
});

test('cache key changes when src bytes change and is stable otherwise', async () => {
  const p = await makeProject({ title: 'k', scenes: [{ id: 'a', engine: 'html', src: 'a.html' }] }, { 'a.html': '<p>one</p>' });
  try {
    const project = loadProject(p.file);
    const scene = project.scenes[0];
    const k1 = await sceneKey(scene, project);
    const k2 = await sceneKey(scene, project);
    assert.equal(k1, k2);
    assert.match(k1, /^[0-9a-f]{64}$/);
    assert.equal(cachedClipPath(project, scene, k1), join(p.dir, '.vp-cache', `a-${k1.slice(0, 12)}.mp4`));

    await writeFile(scene.src, '<p>two</p>');
    const k3 = await sceneKey(scene, project);
    assert.notEqual(k3, k1);

    const wider = { ...project, width: 640 };
    assert.notEqual(await sceneKey(scene, wider), k3);
  } finally {
    await p.cleanup();
  }
});
