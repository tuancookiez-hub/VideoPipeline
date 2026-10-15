import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const HTML_ENGINES = new Set(['html', 'onetake', 'opuscar', 'animation-base', 'hyperframes']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.vp-cache', 'out', '.hyperframes']);
const FILE_FIELDS = ['src', 'still', 'clip'];
const MAX_FILES = 2000;
const MAX_BYTES = 200 * 1024 * 1024;

function isRegularFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function hashFile(hash, file) {
  return new Promise((resolvePromise, reject) => {
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', resolvePromise)
      .on('error', reject);
  });
}

// Every file under `root`, or null when there are more than MAX_FILES files or MAX_BYTES bytes.
async function listTree(root) {
  const files = [];
  let bytes = 0;
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(full);
      } else if (isRegularFile(full)) {
        bytes += statSync(full).size;
        files.push(full);
        if (files.length > MAX_FILES || bytes > MAX_BYTES) return null;
      }
    }
  }
  return files;
}

// Mirrors the mode choice in engines/collage.mjs (that file is not imported here on purpose).
function collageMode(scene) {
  if (scene.clip) return 'clip';
  return process.env.GEMINI_API_KEY && process.env.VP_COLLAGE_DIR && scene.still ? 'gemini' : 'fallback';
}

// Files whose bytes go into the key, as [relative name, absolute path] sorted by name.
async function hashedFiles(scene, project, log) {
  const found = new Set(FILE_FIELDS.map((f) => scene[f]).filter((p) => typeof p === 'string' && isRegularFile(p)));
  if (HTML_ENGINES.has(scene.engine) && typeof scene.src === 'string') {
    const dir = dirname(scene.src);
    const tree = await listTree(dir);
    if (tree) for (const f of tree) found.add(f);
    else log(`WARN cache: ${scene.id}: ${dir} has more than ${MAX_FILES} files or ${MAX_BYTES / 2 ** 20} MB; hashing ${scene.src} only, so edits to its other files will not invalidate the cache`);
  }
  return [...found]
    .map((abs) => [relative(project.dir, abs), abs])
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

// Async because asset bytes are streamed into the hash, not read whole (videos and large stills).
// Paths are relative to project.dir so moving the project keeps its cache.
export async function sceneKey(scene, project, { log = console.log } = {}) {
  const portable = { ...scene };
  for (const f of FILE_FIELDS) {
    if (typeof scene[f] === 'string') portable[f] = relative(project.dir, scene[f]);
  }
  const extra = {};
  if (scene.engine === 'collage') extra.collageMode = collageMode(scene);
  if (scene.engine === 'opuscar') extra.opuscarDir = process.env.VP_OPUSCAR_DIR ?? null;

  const hash = createHash('sha256');
  hash.update(JSON.stringify({ scene: portable, width: project.width, height: project.height, fps: project.fps, ...extra }));
  for (const [name, abs] of await hashedFiles(scene, project, log)) {
    hash.update(`\0${name}\0`);
    await hashFile(hash, abs);
  }
  return hash.digest('hex');
}

const formatTag = (project) => `${project.width}x${project.height}p${project.fps}`;

export function cachedClipPath(project, scene, key) {
  return join(project.dir, '.vp-cache', `${scene.id}-${formatTag(project)}-${key.slice(0, 12)}.mp4`);
}

// Removes older clips of the same scene and format, so draft and full renders keep their own clip.
// Only exact `<id>-<format>-<12 hex>.mp4` names match, so scene "a" never touches "a-b".
export async function pruneClips(project, scene, keepPath) {
  const dir = join(project.dir, '.vp-cache');
  const re = new RegExp(`^${scene.id}-${formatTag(project)}-[0-9a-f]{12}\\.mp4$`);
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if (re.test(name) && p !== keepPath) await rm(p, { force: true });
  }
}
