import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ENGINE_NAMES } from './engines/index.mjs';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const TRANSITIONS = new Set(('none fade fadeblack fadewhite wipeleft wiperight wipeup wipedown slideleft slideright ' +
  'slideup slidedown circlecrop rectcrop distance smoothleft smoothright smoothup smoothdown circleopen circleclose ' +
  'dissolve pixelize radial hblur zoomin').split(' '));
const TOP_KEYS = new Set(['title', 'width', 'height', 'fps', 'output', 'transition', 'audio', 'scenes']);
const SCENE_KEYS = new Set(['id', 'engine', 'src', 'still', 'clip', 'prompt', 'duration', 'trim', 'zoom', 'timeout', 'watch']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

export class ConfigError extends Error {
  constructor(problems) {
    super(`invalid project:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function isFile(p) {
  return existsSync(p) && statSync(p).isFile();
}

function checkFile(problems, label, p) {
  if (!isFile(p)) problems.push(`${label}: file not found: ${p}`);
}

function warnUnknown(warnings, label, obj, known) {
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) warnings.push(`${label}: unknown key "${key}" (ignored)`);
  }
}

function absolutize(obj, keys, dir) {
  const out = { ...obj };
  for (const k of keys) if (typeof out[k] === 'string') out[k] = resolve(dir, out[k]);
  return out;
}

function readRaw(abs) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new ConfigError([`${abs}: cannot read or parse JSON (${err.message})`]);
  }
  if (!isObj(raw)) throw new ConfigError([`${abs}: top level must be a JSON object`]);
  return raw;
}

function validateTransition(problems, t) {
  if (!isObj(t) || !isStr(t.type)) {
    problems.push('transition: must be an object with a "type" string');
    return { type: 'none', duration: 0 };
  }
  if (!TRANSITIONS.has(t.type)) {
    problems.push(`transition: unknown type "${t.type}" (known: ${[...TRANSITIONS].join(', ')})`);
  }
  if (t.type !== 'none' && !(isNum(t.duration) && t.duration > 0)) {
    problems.push(`transition: duration must be > 0 when type is "${t.type}"`);
  }
  return { type: t.type, duration: t.duration ?? 0 };
}

// A transition overlaps both neighbours, so it must be shorter than every scene whose length is known.
function checkTransitionFits(problems, transition, scenes) {
  if (transition.type === 'none' || !isNum(transition.duration)) return;
  for (const s of scenes) {
    if (isObj(s) && isNum(s.duration) && transition.duration >= s.duration) {
      problems.push(`transition: duration ${transition.duration} must be shorter than scene "${s.id}" (${s.duration} s)`);
    }
  }
}

const AUDIO_LEVELS = [
  ['musicVolume', (v) => isNum(v) && v >= 0 && v <= 4, 'a number from 0 to 4'],
  ['duck', (v) => typeof v === 'boolean', 'true or false'],
  ['loudness', (v) => isNum(v) && v >= -70 && v <= -5, 'a number from -70 to -5 (LUFS)'],
  ['fadeOut', (v) => isNum(v) && v >= 0, 'a number >= 0 (seconds)'],
];

function validateAudioLevels(problems, audio) {
  for (const [key, ok, what] of AUDIO_LEVELS) {
    if (audio[key] !== undefined && !ok(audio[key])) problems.push(`audio.${key}: must be ${what} (got ${JSON.stringify(audio[key])})`);
  }
}

function validateAudio(problems, audio, dir) {
  if (!isObj(audio)) {
    problems.push('audio: must be an object');
    return undefined;
  }
  validateAudioLevels(problems, audio);
  const out = absolutize(audio, ['music'], dir);
  if (audio.music !== undefined) {
    if (!isStr(audio.music)) problems.push('audio.music: must be a file path string');
    else checkFile(problems, 'audio.music', out.music);
  }
  if (audio.voiceover !== undefined) {
    if (!Array.isArray(audio.voiceover)) {
      problems.push('audio.voiceover: must be an array');
      return out;
    }
    out.voiceover = audio.voiceover.map((line, i) => {
      const label = `audio.voiceover[${i}]`;
      if (!isObj(line) || !isStr(line.src)) {
        problems.push(`${label}: needs a "src" file path`);
        return line;
      }
      if (!(isNum(line.at) && line.at >= 0)) problems.push(`${label}: "at" must be a number >= 0`);
      checkFile(problems, label, resolve(dir, line.src));
      return absolutize(line, ['src'], dir);
    });
  }
  return out;
}

function validateTrim(problems, label, trim) {
  const ok = Array.isArray(trim) && trim.length === 2 && trim.every(isNum) && trim[0] >= 0 && trim[0] < trim[1];
  if (!ok) problems.push(`${label}: "trim" must be [a, b] with 0 <= a < b`);
}

// Each entry is a file or folder, relative to the project file; returns the resolved paths.
function validateWatch(problems, label, watch, dir) {
  if (!Array.isArray(watch) || !watch.every(isStr)) {
    problems.push(`${label}: "watch" must be an array of file or folder paths`);
    return undefined;
  }
  const paths = watch.map((p) => resolve(dir, p));
  paths.forEach((p, i) => {
    if (!existsSync(p)) problems.push(`${label} watch[${i}]: not found: ${p}`);
  });
  return paths;
}

function validateScene(problems, warnings, scene, index, dir, seenIds) {
  const label = isObj(scene) && isStr(scene.id) ? `scene "${scene.id}"` : `scenes[${index}]`;
  if (!isObj(scene)) {
    problems.push(`${label}: must be an object`);
    return scene;
  }
  warnUnknown(warnings, label, scene, SCENE_KEYS);
  if (!isStr(scene.id) || !ID_RE.test(scene.id)) {
    problems.push(`${label}: "id" is required and must match ${ID_RE}`);
  } else if (seenIds.has(scene.id)) {
    problems.push(`${label}: duplicate id "${scene.id}"`);
  } else {
    seenIds.add(scene.id);
  }
  const engine = scene.engine;
  if (!ENGINE_NAMES.includes(engine)) {
    problems.push(`${label}: unknown engine ${JSON.stringify(engine)} (known: ${ENGINE_NAMES.join(', ')})`);
  }
  if (scene.src === undefined) {
    if (engine !== 'collage') problems.push(`${label}: "src" is required for engine ${engine}`);
  } else if (!isStr(scene.src)) {
    problems.push(`${label}: "src" must be a file path string`);
  } else {
    checkFile(problems, `${label} src`, resolve(dir, scene.src));
  }
  for (const key of ['still', 'clip']) {
    if (scene[key] === undefined) continue;
    if (!isStr(scene[key])) problems.push(`${label}: "${key}" must be a file path string`);
    else checkFile(problems, `${label} ${key}`, resolve(dir, scene[key]));
  }
  if (scene.prompt !== undefined && typeof scene.prompt !== 'string') {
    problems.push(`${label}: "prompt" must be a string`);
  }
  const needsDuration = engine === 'image' || (engine === 'collage' && scene.clip === undefined);
  if (scene.duration === undefined) {
    if (needsDuration) problems.push(`${label}: "duration" is required for engine ${engine}${engine === 'collage' ? ' without a clip' : ''}`);
  } else if (!(isNum(scene.duration) && scene.duration > 0)) {
    problems.push(`${label}: "duration" must be a number > 0`);
  }
  if (scene.trim !== undefined) validateTrim(problems, label, scene.trim);
  if (scene.timeout !== undefined && !(isNum(scene.timeout) && scene.timeout > 0)) {
    problems.push(`${label}: "timeout" must be a number > 0 (seconds)`);
  }
  const out = absolutize(scene, ['src', 'still', 'clip'], dir);
  if (scene.watch !== undefined) {
    const watch = validateWatch(problems, label, scene.watch, dir);
    if (watch) out.watch = watch;
  }
  return out;
}

function validateTop(problems, raw) {
  if (!isStr(raw.title)) problems.push('title: required non-empty string');
  const width = raw.width ?? 1920;
  const height = raw.height ?? 1080;
  const fps = raw.fps ?? 30;
  for (const [name, v] of [['width', width], ['height', height]]) {
    if (!Number.isInteger(v) || v <= 0 || v % 2 !== 0) problems.push(`${name}: must be a positive even integer (got ${JSON.stringify(v)})`);
  }
  if (!(isNum(fps) && fps >= 1 && fps <= 120)) problems.push(`fps: must be a number from 1 to 120 (got ${JSON.stringify(fps)})`);
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) problems.push('scenes: must be a non-empty array');
  return { width, height, fps };
}

export function loadProject(file) {
  const abs = resolve(file);
  const dir = dirname(abs);
  const raw = readRaw(abs);
  const problems = [];
  const warnings = [];
  warnUnknown(warnings, 'project', raw, TOP_KEYS);
  const { width, height, fps } = validateTop(problems, raw);

  const title = isStr(raw.title) ? raw.title : 'untitled';
  const outputName = `out/${title.replace(/[^\w.-]+/g, '_')}.mp4`;
  if (raw.output !== undefined && !isStr(raw.output)) problems.push('output: must be a path string');
  const output = resolve(dir, isStr(raw.output) ? raw.output : outputName);

  const transition = validateTransition(problems, raw.transition ?? { type: 'none' });
  const audio = raw.audio === undefined ? undefined : validateAudio(problems, raw.audio, dir);

  const seenIds = new Set();
  const scenes = Array.isArray(raw.scenes)
    ? raw.scenes.map((s, i) => validateScene(problems, warnings, s, i, dir, seenIds))
    : [];
  checkTransitionFits(problems, transition, scenes);

  if (problems.length) throw new ConfigError(problems);
  return { ...raw, title, width, height, fps, output, transition, audio, scenes, dir, file: abs, warnings };
}
