import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHtml } from '../src/capture.mjs';
import { ffmpeg, probe } from '../src/ffmpeg.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const base = { width: 320, height: 180, fps: 10 };
const tmp = () => mkdtempSync(join(tmpdir(), 'vp-capture-'));

for (const [protocol, file] of [['seek', 'seek.html'], ['render', 'render.html'], ['abase', 'abase.html']]) {
  test(`${protocol} protocol renders a 1 s clip that moves`, async () => {
    const dir = tmp();
    const out = join(dir, 'raw.mp4');
    const r = await captureHtml({ ...base, src: join(FIXTURES, file), protocol, out, timeoutMs: 30000 });
    assert.equal(r.frames, 10);
    const info = await probe(out);
    assert.ok(Math.abs(info.duration - 1) <= 0.15, `duration ${info.duration}`);
    assert.equal(info.width, 320);
    assert.equal(info.height, 180);

    const first = join(dir, 'first.png');
    const last = join(dir, 'last.png');
    await ffmpeg(['-i', out, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', first]);
    await ffmpeg(['-i', out, '-vf', 'select=eq(n\\,9)', '-frames:v', '1', last]);
    assert.notDeepEqual(readFileSync(first), readFileSync(last));
  });
}

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
