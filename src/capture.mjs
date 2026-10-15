import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { CHROME_ARGS, findChrome } from './chrome.mjs';
import { spawnEncoder } from './ffmpeg.mjs';

// What each protocol needs from the page. Engines pick one protocol; see docs/ARCHITECTURE.md.
const SPECS = {
  seek: {
    hook: '__seek',
    what: 'seek-protocol scene',
    duration: () => window.__meta?.dur,
    durationHint: 'define window.__meta.dur',
    ready: async (page, ms) => {
      if (!(await page.evaluate(() => '__ready' in window))) return;
      await timed(page.evaluate(() => window.__ready), ms, 'window.__ready did not resolve');
    },
    frame: async (page, t) => {
      await page.evaluate((t) => window.__seek(t), t);
      return page.screenshot({ type: 'png' });
    },
  },
  render: {
    hook: 'render',
    what: 'render-protocol scene',
    duration: () => window.DUR,
    durationHint: 'define window.DUR',
    ready: async (page, ms) => {
      await waitPage(page, () => window.READY === undefined || window.READY === true, ms, 'window.READY never became true');
      await page.evaluate(() => document.fonts.ready);
    },
    frame: async (page, t) => {
      await page.evaluate((t) => window.render(t), t);
      return page.screenshot({ type: 'png' });
    },
  },
  abase: {
    hook: 'renderAt',
    what: 'animation-base scene',
    duration: () => (window.LOOP ? window.LOOP.len : window.DUR),
    durationHint: 'define window.DUR',
    ready: (page, ms) => waitPage(page, () => window.ready === true, ms, 'window.ready never became true'),
    frame: async (page, t) => {
      const url = await page.evaluate((t) => window.renderAt(t, 'image/png'), t);
      if (typeof url !== 'string' || !url.startsWith('data:')) throw new Error('renderAt must return a data URL');
      return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    },
  },
};

function timed(promise, ms, msg) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${msg} within ${ms} ms`)), ms); });
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

export async function captureHtml({ src, protocol, width, height, fps, duration, out, chrome, timeoutMs = 60000, log, query }) {
  const spec = SPECS[protocol];
  if (!spec) throw new Error(`unknown capture protocol "${protocol}". Known: ${Object.keys(SPECS).join(', ')}`);
  const errors = [];
  const pageError = () => new Error(`page error: ${errors[0]}`);
  const check = () => { if (errors.length) throw pageError(); };

  const browser = await chromium.launch({ executablePath: chrome ?? findChrome(), args: CHROME_ARGS });
  let enc = null;
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(pageUrl(src, protocol, query), { waitUntil: 'load' });
      check();
      await spec.ready(page, timeoutMs);
      check();
      if (!(await page.evaluate((name) => typeof window[name] === 'function', spec.hook))) {
        throw new Error(`page does not define window.${spec.hook} — not a ${spec.what}`);
      }
      const dur = duration ?? (await page.evaluate(spec.duration));
      if (!(dur > 0)) throw new Error(`unknown duration: set scene.duration or ${spec.durationHint}`);

      const n = Math.round(dur * fps);
      const every = Math.max(1, Math.floor(n / 4));
      mkdirSync(dirname(out), { recursive: true });
      enc = spawnEncoder({ out, width, height, fps });
      for (let i = 0; i < n; i++) {
        const buf = await spec.frame(page, i / fps);
        check();
        await enc.write(buf);
        if ((i + 1) % every === 0 || i + 1 === n) log?.(`capture ${protocol}: ${i + 1}/${n} frames`);
      }
      const closing = enc;
      enc = null;
      await closing.close();
      return { out, frames: n, duration: dur };
    } catch (e) {
      throw errors.length ? pageError() : e;
    }
  } finally {
    if (enc) await enc.close().catch(() => {});
    await browser.close();
  }
}
