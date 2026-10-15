import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';

function isRegularFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// Async because asset bytes are streamed into the hash, not read whole (videos and large stills).
export async function sceneKey(scene, project) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ scene, width: project.width, height: project.height, fps: project.fps }));
  for (const field of ['src', 'still', 'clip']) {
    const file = scene[field];
    if (typeof file !== 'string' || !isRegularFile(file)) continue;
    hash.update(`\0${field}\0`);
    await new Promise((resolvePromise, reject) => {
      createReadStream(file)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', resolvePromise)
        .on('error', reject);
    });
  }
  return hash.digest('hex');
}

export function cachedClipPath(project, scene, key) {
  return join(project.dir, '.vp-cache', `${scene.id}-${key.slice(0, 12)}.mp4`);
}
