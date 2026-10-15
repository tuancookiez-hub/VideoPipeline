import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHtml } from '../src/capture.mjs';
import { ffmpeg, probe } from '../src/ffmpeg.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const base = { width: 320, height: 180, fps: 10 };
const tmp = () => mkdtempSync(join(tmpdir(), 'vp-capture-'));

// Mean luma (0-255) of the first frame of a clip, from a 1x1 area-averaged scale.
function firstFrameLuma(file) {
  return new Promise((ok, bad) => execFile('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'select=eq(n\\,0),scale=1:1:flags=area,format=gray', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' }, (err, stdout) => (err ? bad(err) : ok(stdout[0]))));
}

// Each fixture's own size: the seek and render pages capture the 320x180 viewport, abase returns its 640x360 canvas.
for (const [protocol, file, [w, h]] of [['seek', 'seek.html', [320, 180]], ['render', 'render.html', [320, 180]], ['abase', 'abase.html', [640, 360]]]) {
  test(`${protocol} protocol renders a 1 s clip that moves at native size ${w}x${h}`, async () => {
    const dir = tmp();
    const out = join(dir, 'raw.mp4');
    const r = await captureHtml({ ...base, src: join(FIXTURES, file), protocol, out, timeoutMs: 30000 });
    assert.equal(r.frames, 10);
    const info = await probe(out);
    assert.ok(Math.abs(info.duration - 1) <= 0.15, `duration ${info.duration}`);
    assert.equal(info.width, w);
    assert.equal(info.height, h);

    const first = join(dir, 'first.png');
    const last = join(dir, 'last.png');
    await ffmpeg(['-i', out, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', first]);
    await ffmpeg(['-i', out, '-vf', 'select=eq(n\\,9)', '-frames:v', '1', last]);
    assert.notDeepEqual(readFileSync(first), readFileSync(last));
  });
}

test('render protocol waits for READY: the first frame is not blank', async () => {
  const out = join(tmp(), 'raw.mp4');
  await captureHtml({ ...base, src: join(FIXTURES, 'render.html'), protocol: 'render', out, timeoutMs: 30000 });
  assert.ok((await firstFrameLuma(out)) > 128, 'first frame was captured before READY');
});

test('a throwing __seek rejects with the page error message', async () => {
  const dir = tmp();
  const src = join(dir, 'bad.html');
  writeFileSync(src, `<!doctype html><script>
    window.__meta = { dur: 1 };
    window.__ready = Promise.resolve();
    window.__seek = (t) => { if (t > 0) throw new Error('boom at t=' + t); };
  </script>`);
  await assert.rejects(
    captureHtml({ ...base, src, protocol: 'seek', out: join(dir, 'raw.mp4'), timeoutMs: 30000 }),
    /boom at t=0\.1/,
  );
});

test('a frame that never returns is cut off after frameTimeoutMs', async () => {
  const dir = tmp();
  const src = join(dir, 'hang.html');
  writeFileSync(src, `<!doctype html><script>
    window.__meta = { dur: 1 };
    window.__ready = Promise.resolve();
    window.__seek = () => new Promise(() => {});
  </script>`);
  await assert.rejects(
    captureHtml({ ...base, src, protocol: 'seek', out: join(dir, 'raw.mp4'), timeoutMs: 30000, frameTimeoutMs: 500 }),
    /frame 0 \(t=0\.00s\) timed out/,
  );
});

test('an encoder that fails reports ffmpeg\'s error, not EPIPE', async () => {
  // The output path is an existing directory, so ffmpeg refuses to open it and exits while frames are still coming.
  await assert.rejects(
    captureHtml({ ...base, src: join(FIXTURES, 'seek.html'), protocol: 'seek', out: tmp(), timeoutMs: 30000 }),
    /ffmpeg encoder exited with \d+: .*Unable to choose an output format/s,
  );
});

test('a missing script on a file:// page fails the capture with its URL', async () => {
  const dir = tmp();
  const src = join(dir, 'missing-script.html');
  writeFileSync(src, `<!doctype html><script src="missing.js"></script><script>window.__meta={dur:1};window.__ready=Promise.resolve();window.__seek=()=>{};</script>`);
  await assert.rejects(
    captureHtml({ ...base, src, protocol: 'seek', out: join(dir, 'raw.mp4'), timeoutMs: 30000 }),
    /failed to load file:\/\/\/.*missing\.js \(net::ERR_FILE_NOT_FOUND\)/,
  );
});

test('a 404 script on an http page fails the capture with its URL and status', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><script src="/core/lib.js"></script><script>window.__meta={dur:1};window.__ready=Promise.resolve();window.__seek=()=>{};</script>`);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const { port } = server.address();
    await assert.rejects(
      captureHtml({ ...base, src: `http://127.0.0.1:${port}/`, protocol: 'seek', out: join(tmp(), 'raw.mp4'), timeoutMs: 30000 }),
      new RegExp(`failed to load http://127\\.0\\.0\\.1:${port}/core/lib\\.js \\(404\\)`),
    );
  } finally {
    server.close();
  }
});

test('a top-level page error fails the capture', async () => {
  const dir = tmp();
  const src = join(dir, 'load-error.html');
  writeFileSync(src, `<!doctype html><script>window.DUR = 1; throw new Error('load boom');</script>`);
  await assert.rejects(
    captureHtml({ ...base, src, protocol: 'render', out: join(dir, 'raw.mp4'), timeoutMs: 30000 }),
    /page error: load boom/,
  );
});

test('a page without the protocol hook is rejected with a clear message', async () => {
  await assert.rejects(
    captureHtml({ ...base, src: join(FIXTURES, 'seek.html'), protocol: 'render', out: join(tmp(), 'raw.mp4'), timeoutMs: 3000 }),
    /page does not define window\.render — not a render-protocol scene/,
  );
});

test('an unknown duration is rejected with a clear message', async () => {
  const dir = tmp();
  const src = join(dir, 'nodur.html');
  writeFileSync(src, `<!doctype html><script>window.__ready = Promise.resolve(); window.__seek = () => {};</script>`);
  await assert.rejects(
    captureHtml({ ...base, src, protocol: 'seek', out: join(dir, 'raw.mp4'), timeoutMs: 30000 }),
    /unknown duration: set scene\.duration or define window\.__meta\.dur/,
  );
});
