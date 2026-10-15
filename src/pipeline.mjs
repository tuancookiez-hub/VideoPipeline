import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { findChrome } from './chrome.mjs';
import { cachedClipPath, pruneClips, sceneKey } from './cache.mjs';
import { joinClips, mixAudio } from './assemble.mjs';
import { probe } from './ffmpeg.mjs';
import { getEngine } from './engines/index.mjs';
import { normalizeClip } from './normalize.mjs';

const CHROME_ENGINES = new Set(['html', 'onetake', 'opuscar', 'animation-base']);

const even = (n) => Math.max(2, 2 * Math.round(n / 2));
const round2 = (n) => Math.round(n * 100) / 100;
const draftPath = (output) => output.replace(/(\.mp4)?$/i, '.draft.mp4');

function formatFor(project, draft) {
  if (!draft) return { width: project.width, height: project.height, fps: project.fps };
  return { width: even(project.width / 2), height: even(project.height / 2), fps: Math.min(project.fps, 15) };
}

function selectScenes(scenes, only) {
  if (!only || only.length === 0) return scenes;
  const ids = new Set(scenes.map((s) => s.id));
  const unknown = only.filter((id) => !ids.has(id));
  if (unknown.length) throw new Error(`unknown scene id(s) for --only: ${unknown.join(', ')}`);
  return scenes.filter((s) => only.includes(s.id));
}

// Chromium is looked up at most once, and only when a scene that needs it is actually rendered.
function chromeProvider() {
  let state = null;
  return (engine) => {
    if (!CHROME_ENGINES.has(engine)) return undefined;
    if (state === null) {
      try {
        state = { path: findChrome() };
      } catch (err) {
        state = { error: err };
      }
    }
    if (state.error) throw state.error;
    return state.path;
  };
}

async function renderScene(scene, eff, { force, chromeFor, log, runDir }) {
  const key = await sceneKey(scene, eff, { log });
  const clip = cachedClipPath(eff, scene, key);
  if (!force && existsSync(clip)) {
    const { duration } = await probe(clip);
    return { id: scene.id, engine: scene.engine, clip, duration, cached: true, renderSeconds: 0 };
  }
  const started = Date.now();
  const workDir = join(runDir, scene.id);
  await mkdir(workDir, { recursive: true });
  const chrome = chromeFor(scene.engine);
  const engine = await getEngine(scene.engine);
  const { clip: raw } = await engine.render(scene, { project: eff, workDir, chrome, log });
  const tmp = join(workDir, 'normalized.mp4');
  const { duration } = await normalizeClip(raw, tmp, {
    width: eff.width,
    height: eff.height,
    fps: eff.fps,
    duration: scene.duration,
  });
  await rename(tmp, clip);
  await pruneClips(eff, scene, clip);
  const renderSeconds = (Date.now() - started) / 1000;
  return { id: scene.id, engine: scene.engine, clip, duration, cached: false, renderSeconds };
}

async function renderRun(project, eff, { only, force, draft, log, runDir, format, selected }) {
  const chromeFor = chromeProvider();
  const results = [];
  for (const [i, scene] of selected.entries()) {
    const label = `[${i + 1}/${selected.length}] ${scene.id} (${scene.engine})`;
    let result;
    try {
      result = await renderScene(scene, eff, { force, chromeFor, log, runDir });
    } catch (err) {
      throw new Error(`scene "${scene.id}" failed: ${err.message}`, { cause: err });
    }
    log(`${label} … ${result.cached ? 'cached' : `${result.renderSeconds.toFixed(1)}s rendered`}`);
    results.push(result);
  }

  if (only) {
    for (const r of results) log(`  ${r.id}: ${r.clip}`);
    return { output: null, scenes: results };
  }

  const joined = join(runDir, 'joined.mp4');
  await joinClips(results.map((r) => ({ path: r.clip, duration: r.duration })), { transition: project.transition, out: joined });

  const output = draft ? draftPath(project.output) : project.output;
  await mkdir(dirname(output), { recursive: true });
  if (project.audio) await mixAudio(joined, project.audio, output);
  else await copyFile(joined, output);

  const info = await probe(output);
  const report = {
    output,
    format,
    durationSeconds: round2(info.duration),
    scenes: results.map(({ id, engine, clip, duration, cached, renderSeconds }) => ({
      id, engine, clip, duration: round2(duration), cached, renderSeconds: round2(renderSeconds),
    })),
  };
  await writeFile(`${output}.report.json`, JSON.stringify(report, null, 2) + '\n');
  log(`wrote ${output} (${report.durationSeconds}s)`);
  return { output, scenes: results };
}

export async function renderProject(project, { only, force = false, draft = false, log = console.log } = {}) {
  const format = formatFor(project, draft);
  const eff = { ...project, ...format };
  const selected = selectScenes(project.scenes, only);

  // Each run gets its own work dir, so two runs of one project do not share scratch files.
  const workParent = join(project.dir, '.vp-cache', 'work');
  await mkdir(workParent, { recursive: true });
  const runDir = await mkdtemp(join(workParent, 'run-'));

  let result;
  try {
    result = await renderRun(project, eff, { only, force, draft, log, runDir, format, selected });
  } catch (err) {
    log(`work dir kept for inspection: ${runDir}`);
    throw err;
  }
  await rm(runDir, { recursive: true, force: true });
  return result;
}
