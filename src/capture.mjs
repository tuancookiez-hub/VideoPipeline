import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { CHROME_ARGS, findChrome } from './chrome.mjs';
import { spawnEncoder } from './ffmpeg.mjs';

// What each protocol needs from the page. Engines pick one protocol; see docs/ARCHITECTURE.md.
// `duration` is an expression evaluated in page scope, so top-level `const DUR` works as well as window.DUR.
const SPECS = {
  seek: {
    hook: '__seek',
    what: 'seek-protocol scene',
    duration: 'window.__meta?.dur',
    durationHint: 'define window.__meta.dur',
    ready: async (page, ms) => {
      if (!(await page.evaluate(() => '__ready' in window))) return;
      await timed(page.evaluate(() => window.__ready), ms, `window.__ready did not resolve within ${ms} ms`);
    },
    frame: async (page, t) => {
      await page.evaluate((t) => window.__seek(t), t);
      return page.screenshot({ type: 'png' });
    },
  },
  render: {
    hook: 'render',
    what: 'render-protocol scene',
    duration: 'typeof DUR !== "undefined" ? DUR : undefined',
    durationHint: 'define DUR (a top-level const or window.DUR)',
    ready: (page, ms) => waitPage(page, () => typeof window.render === 'function' && window.READY === true, ms, 'window.render / window.READY === true never became true'),
    frame: async (page, t) => {
      await page.evaluate((t) => window.render(t), t);
      return page.screenshot({ type: 'png' });
    },
  },
  abase: {
    hook: 'renderAt',
    what: 'animation-base scene',
    duration: 'typeof LOOP !== "undefined" && LOOP ? LOOP.len : (typeof DUR !== "undefined" ? DUR : undefined)',
    durationHint: 'define DUR (a top-level const or window.DUR)',
    ready: (page, ms) => waitPage(page, () => window.ready === true, ms, 'window.ready never became true'),
    frame: async (page, t) => {
      const url = await page.evaluate((t) => window.renderAt(t, 'image/png'), t);
      if (typeof url !== 'string' || !url.startsWith('data:')) throw new Error('renderAt must return a data URL');
      return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    },
  },
};

// Resource types whose failure makes the page unusable (the reference renderer does the same).
// Any other failed subresource (image, font, media, fetch, xhr) is logged and the capture goes on.
const FATAL_TYPES = new Set(['document', 'script', 'stylesheet']);

function timed(promise, ms, msg) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(msg)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function waitPage(page, predicate, ms, msg) {
  try {
    await page.waitForFunction(predicate, null, { timeout: ms });
  } catch {
    throw new Error(`${msg} within ${ms} ms`);
  }
}

// file:// for project pages; http(s) URLs pass through (opuscar serves its pages over http).
// abase pages take the `?render` flag, as their own renderer does.
function pageUrl(src, protocol, query) {
  const u = /^https?:\/\//.test(src) ? new URL(src) : pathToFileURL(src);
  const parts = [u.search.slice(1), protocol === 'abase' ? 'render' : '', query ?? ''].filter(Boolean);
  u.search = parts.length ? `?${parts.join('&')}` : '';
  return u.href;
}

// frameTimeoutMs bounds each hook call + screenshot; timeoutMs bounds the page becoming ready.
export async function captureHtml({ src, protocol, width, height, fps, duration, out, chrome, timeoutMs = 60000, frameTimeoutMs = 30000, log, query }) {
  const spec = SPECS[protocol];
  if (!spec) throw new Error(`unknown capture protocol "${protocol}". Known: ${Object.keys(SPECS).join(', ')}`);
  // Errors from the page (JS exceptions, failed loads) are recorded as they happen and reported first.
  const problems = [];
  const check = () => { if (problems.length) throw problems[0]; };
  const failed = (type, url, reason) => {
    if (FATAL_TYPES.has(type)) problems.push(new Error(`failed to load ${url} (${reason})`));
    else log?.(`capture: optional resource failed: ${url} (${reason})`);
  };

  const browser = await chromium.launch({ executablePath: chrome ?? findChrome(), args: CHROME_ARGS });
  let enc = null;
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => problems.push(new Error(`page error: ${e.message}`)));
    page.on('response', (r) => {
      const url = r.url();
      if (r.status() < 400 || /\/favicon\.ico$/.test(new URL(url).pathname)) return;
      failed(r.request().resourceType(), url, r.status());
    });
    page.on('requestfailed', (r) => {
      const url = r.url(), reason = r.failure()?.errorText ?? 'request failed';
      if (!/^(file|https?):/.test(url) || /favicon/.test(url) || reason === 'net::ERR_ABORTED') return;
      failed(r.resourceType(), url, reason);
    });
    try {
      await page.goto(pageUrl(src, protocol, query), { waitUntil: 'load' });
      check();
      const hasHook = () => page.evaluate((name) => typeof window[name] === 'function', spec.hook);
      try {
        await spec.ready(page, timeoutMs);
      } catch (e) {
        check();
        if (!(await hasHook())) throw new Error(`page does not define window.${spec.hook} — not a ${spec.what}`);
        throw e;
      }
      check();
      if (!(await hasHook())) throw new Error(`page does not define window.${spec.hook} — not a ${spec.what}`);
      await page.evaluate(() => document.fonts.ready);
      const dur = duration ?? (await page.evaluate(spec.duration));
      if (!(dur > 0)) throw new Error(`unknown duration: set scene.duration or ${spec.durationHint}`);

      const n = Math.round(dur * fps);
      const every = Math.max(1, Math.floor(n / 4));
      mkdirSync(dirname(out), { recursive: true });
      enc = spawnEncoder({ out, width, height, fps });
      for (let i = 0; i < n; i++) {
        const t = i / fps;
        const buf = await timed(spec.frame(page, t), frameTimeoutMs, `frame ${i} (t=${t.toFixed(2)}s) timed out after ${frameTimeoutMs} ms`);
        check();
        await enc.write(buf);
        if ((i + 1) % every === 0 || i + 1 === n) log?.(`capture ${protocol}: ${i + 1}/${n} frames`);
      }
      const closing = enc;
      enc = null;
      await closing.close();
      return { out, frames: n, duration: dur };
    } catch (e) {
      throw problems.length ? problems[0] : e;
    }
  } finally {
    if (enc) await enc.close().catch(() => {});
    await browser.close();
  }
}
