import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { captureHtml } from '../capture.mjs';

// Opuscar pages load their library by absolute URL (/core/lib.js), so they need an http root.
// Serves VP_OPUSCAR_DIR at / and the film's folder at /@film/.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' };
const MOUNT = '/@film/';

async function serve(root, filmDir) {
  const server = createServer(async (req, res) => {
    let rel;
    try { rel = decodeURIComponent(req.url.split(/[?#]/)[0]); } catch { res.writeHead(400).end(); return; }
    const [base, path] = rel.startsWith(MOUNT) ? [filmDir, rel.slice(MOUNT.length)] : [root, rel];
    const file = resolve(base, '.' + sep + path.replace(/^\/+/, ''));
    if (file !== base && !file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return server;
}

export async function render(scene, ctx) {
  const root = process.env.VP_OPUSCAR_DIR;
  if (!root) throw new Error('opuscar engine needs VP_OPUSCAR_DIR = path to a lemo-opuscar checkout');
  const { width, height, fps } = ctx.project;
  const out = join(ctx.workDir, 'raw.mp4');
  const server = await serve(resolve(root), dirname(resolve(scene.src)));
  try {
    const { port } = server.address();
    const src = `http://127.0.0.1:${port}${MOUNT}${encodeURIComponent(basename(scene.src))}`;
    await captureHtml({ src, protocol: 'render', width, height, fps, duration: scene.duration, out, chrome: ctx.chrome, log: ctx.log });
  } finally {
    server.close();
  }
  return { clip: out };
}
