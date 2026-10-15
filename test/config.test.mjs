import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
    assert.equal(cachedClipPath(project, scene, k1), join(p.dir, '.vp-cache', `a-1920x1080p30-${k1.slice(0, 12)}.mp4`));

    await writeFile(scene.src, '<p>two</p>');
    const k3 = await sceneKey(scene, project);
    assert.notEqual(k3, k1);

    const wider = { ...project, width: 640 };
    assert.notEqual(await sceneKey(scene, wider), k3);
  } finally {
    await p.cleanup();
  }
});

test('unknown top-level and scene keys are warnings, not errors', async () => {
  const p = await makeProject(
    { title: 'w', duraton: 3, scenes: [{ id: 'a', engine: 'html', src: 'a.html', duraton: 2 }] },
    { 'a.html': '<html></html>' },
  );
  try {
    const project = loadProject(p.file);
    assert.ok(project.warnings.some((w) => w.includes('project: unknown key "duraton"')), project.warnings.join('\n'));
    assert.ok(project.warnings.some((w) => w.includes('scene "a": unknown key "duraton"')), project.warnings.join('\n'));
  } finally {
    await p.cleanup();
  }
});

test('transition type must be a known xfade name and shorter than every known scene duration', async () => {
  const bad = await makeProject({
    title: 't',
    transition: { type: 'bounce', duration: 0.5 },
    scenes: [{ id: 'a', engine: 'image', src: 'a.png', duration: 1 }],
  }, { 'a.png': 'x' });
  const short = await makeProject({
    title: 't',
    transition: { type: 'wipeleft', duration: 1.5 },
    scenes: [{ id: 'a', engine: 'image', src: 'a.png', duration: 1 }, { id: 'b', engine: 'image', src: 'a.png', duration: 2 }],
  }, { 'a.png': 'x' });
  try {
    assert.throws(() => loadProject(bad.file), (e) => e instanceof ConfigError && e.problems.some((m) => m.includes('unknown type "bounce"')));
    assert.throws(() => loadProject(short.file), (e) => e instanceof ConfigError && e.problems.some((m) => m.includes('scene "a" (1 s)')));
  } finally {
    await bad.cleanup();
    await short.cleanup();
  }
});

test('cache key is stable when the project directory is moved', async () => {
  const p = await makeProject(
    { title: 'move', scenes: [{ id: 'a', engine: 'html', src: 'scenes/a.html' }] },
    { 'scenes/a.html': '<p>a</p>', 'scenes/lib.js': 'var x = 1;' },
  );
  const moved = await mkdtemp(join(tmpdir(), 'vp-moved-'));
  try {
    const before = loadProject(p.file);
    const k1 = await sceneKey(before.scenes[0], before);
    await cp(p.dir, moved, { recursive: true });
    const after = loadProject(join(moved, 'project.json'));
    assert.equal(await sceneKey(after.scenes[0], after), k1);
  } finally {
    await rm(moved, { recursive: true, force: true });
    await p.cleanup();
  }
});

test('sibling files of an html scene change its key; node_modules and out do not', async () => {
  const p = await makeProject(
    { title: 'sib', scenes: [{ id: 'a', engine: 'html', src: 'scenes/a.html' }] },
    { 'scenes/a.html': '<p>a</p>', 'scenes/lib.js': 'var x = 1;' },
  );
  try {
    const project = loadProject(p.file);
    const scene = project.scenes[0];
    const k1 = await sceneKey(scene, project);
    await mkdir(join(p.dir, 'scenes', 'node_modules'), { recursive: true });
    await mkdir(join(p.dir, 'scenes', 'out'), { recursive: true });
    await writeFile(join(p.dir, 'scenes', 'node_modules', 'x.js'), 'x');
    await writeFile(join(p.dir, 'scenes', 'out', 'x.mp4'), 'x');
    assert.equal(await sceneKey(scene, project), k1);
    await writeFile(join(p.dir, 'scenes', 'lib.js'), 'var x = 2;');
    assert.notEqual(await sceneKey(scene, project), k1);
  } finally {
    await p.cleanup();
  }
});

test('opuscar key includes VP_OPUSCAR_DIR; collage key includes its path mode but never the key value', async () => {
  const keys = ['VP_OPUSCAR_DIR', 'GEMINI_API_KEY', 'VP_COLLAGE_DIR'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const p = await makeProject(
    {
      title: 'env',
      scenes: [
        { id: 'op', engine: 'opuscar', src: 'op/index.html' },
        { id: 'col', engine: 'collage', still: 'still.png', duration: 3 },
      ],
    },
    { 'op/index.html': '<p>op</p>', 'still.png': 'png' },
  );
  try {
    const project = loadProject(p.file);
    const [op, col] = project.scenes;
    delete process.env.VP_OPUSCAR_DIR;
    delete process.env.GEMINI_API_KEY;
    delete process.env.VP_COLLAGE_DIR;
    const opA = await sceneKey(op, project);
    const colFallback = await sceneKey(col, project);

    process.env.VP_OPUSCAR_DIR = '/some/checkout';
    assert.notEqual(await sceneKey(op, project), opA);

    process.env.GEMINI_API_KEY = 'secret-one';
    process.env.VP_COLLAGE_DIR = '/some/collage';
    const colGemini = await sceneKey(col, project);
    assert.notEqual(colGemini, colFallback);
    process.env.GEMINI_API_KEY = 'secret-two';
    assert.equal(await sceneKey(col, project), colGemini, 'key value must not reach the hash');
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await p.cleanup();
  }
});

test('timeout must be a number > 0 and watch must name existing files or folders', async () => {
  const p = await makeProject({
    title: 'tw',
    scenes: [
      { id: 'a', engine: 'hyperframes', src: 'a.html', timeout: 0 },
      { id: 'b', engine: 'html', src: 'a.html', watch: ['missing.css'] },
      { id: 'c', engine: 'html', src: 'a.html', watch: 'lib' },
    ],
  }, { 'a.html': '<p>a</p>', 'lib/x.js': 'x' });
  try {
    let err;
    try { loadProject(p.file); } catch (e) { err = e; }
    assert.ok(err instanceof ConfigError);
    const text = err.problems.join('\n');
    assert.match(text, /scene "a": "timeout" must be a number > 0/);
    assert.match(text, /scene "b" watch\[0\]: not found: .*missing\.css/);
    assert.match(text, /scene "c": "watch" must be an array/);
  } finally {
    await p.cleanup();
  }
});

test('valid timeout and watch are kept, watch resolved against the project dir', async () => {
  const p = await makeProject(
    { title: 'tw2', scenes: [{ id: 'a', engine: 'html', src: 'scenes/a.html', timeout: 90, watch: ['shared', 'shared.css'] }] },
    { 'scenes/a.html': '<p>a</p>', 'shared/x.js': 'x', 'shared.css': 'p{}' },
  );
  try {
    const project = loadProject(p.file);
    assert.equal(project.scenes[0].timeout, 90);
    assert.deepEqual(project.scenes[0].watch, [join(p.dir, 'shared'), join(p.dir, 'shared.css')]);
  } finally {
    await p.cleanup();
  }
});

test('audio levels are validated when present', async () => {
  const bad = await makeProject({
    title: 'au',
    audio: { musicVolume: 5, duck: 'yes', loudness: -4, fadeOut: -1 },
    scenes: [{ id: 'a', engine: 'image', src: 'a.png', duration: 1 }],
  }, { 'a.png': 'x' });
  const good = await makeProject({
    title: 'au',
    audio: { musicVolume: 0, duck: false, loudness: -70, fadeOut: 0 },
    scenes: [{ id: 'a', engine: 'image', src: 'a.png', duration: 1 }],
  }, { 'a.png': 'x' });
  try {
    let err;
    try { loadProject(bad.file); } catch (e) { err = e; }
    assert.ok(err instanceof ConfigError);
    for (const key of ['musicVolume', 'duck', 'loudness', 'fadeOut']) {
      assert.ok(err.problems.some((m) => m.startsWith(`audio.${key}: must be`)), `missing ${key}: ${err.problems.join('\n')}`);
    }
    assert.equal(loadProject(good.file).audio.loudness, -70);
  } finally {
    await bad.cleanup();
    await good.cleanup();
  }
});

test('a root-level scene hashes only its src and watch: project.json and sibling files do not invalidate it', async () => {
  const p = await makeProject(
    { title: 'root', scenes: [{ id: 'a', engine: 'html', src: 'a.html', watch: ['lib'] }] },
    { 'a.html': '<p>a</p>', 'lib/x.js': 'x', 'other.html': '<p>o</p>' },
  );
  try {
    const k1 = await sceneKey(loadProject(p.file).scenes[0], loadProject(p.file));
    await writeFile(p.file, JSON.stringify({ title: 'root 2', scenes: [{ id: 'a', engine: 'html', src: 'a.html', watch: ['lib'] }, { id: 'b', engine: 'html', src: 'other.html' }] }));
    const edited = loadProject(p.file);
    assert.equal(await sceneKey(edited.scenes[0], edited), k1, 'project.json edit');
    await writeFile(join(p.dir, 'other.html'), '<p>changed</p>');
    assert.equal(await sceneKey(edited.scenes[0], edited), k1, 'sibling edit');
    await writeFile(join(p.dir, 'lib', 'x.js'), 'y');
    assert.notEqual(await sceneKey(edited.scenes[0], edited), k1, 'watched folder edit');
  } finally {
    await p.cleanup();
  }
});

test('a sub-folder scene honours watch files and folders outside its folder', async () => {
  const p = await makeProject(
    { title: 'sub', scenes: [{ id: 'a', engine: 'html', src: 'scenes/a.html', watch: ['shared.css', 'assets'] }] },
    { 'scenes/a.html': '<p>a</p>', 'shared.css': 'p{}', 'assets/font/f.woff2': 'f' },
  );
  try {
    const project = loadProject(p.file);
    const scene = project.scenes[0];
    const k1 = await sceneKey(scene, project);
    await writeFile(join(p.dir, 'shared.css'), 'p{color:red}');
    const k2 = await sceneKey(scene, project);
    assert.notEqual(k2, k1, 'watched file');
    await writeFile(join(p.dir, 'assets', 'font', 'f.woff2'), 'g');
    assert.notEqual(await sceneKey(scene, project), k2, 'watched folder');
  } finally {
    await p.cleanup();
  }
});

test('output, draft and report files are never hashed, even inside the scene folder; .vp-cache is skipped', async () => {
  const p = await makeProject(
    { title: 'out', output: 'scenes/final.mp4', scenes: [{ id: 'a', engine: 'html', src: 'scenes/a.html' }] },
    { 'scenes/a.html': '<p>a</p>', 'scenes/lib.js': 'x' },
  );
  try {
    const project = loadProject(p.file);
    const scene = project.scenes[0];
    const k1 = await sceneKey(scene, project);
    for (const name of ['final.mp4', 'final.mp4.report.json', 'final.draft.mp4', 'final.draft.mp4.report.json']) {
      await writeFile(join(p.dir, 'scenes', name), `changed ${name}`);
    }
    await mkdir(join(p.dir, 'scenes', '.vp-cache'), { recursive: true });
    await writeFile(join(p.dir, 'scenes', '.vp-cache', 'x.mp4'), 'x');
    assert.equal(await sceneKey(scene, project), k1);
  } finally {
    await p.cleanup();
  }
});
