#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { cp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../src/chrome.mjs';
import { ConfigError, loadProject } from '../src/config.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const USAGE = `usage:
  vp render <project.json> [--only a,b] [--force] [--draft]
  vp doctor
  vp init <dir>`;

async function render(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      only: { type: 'string' },
      force: { type: 'boolean', default: false },
      draft: { type: 'boolean', default: false },
    },
  });
  if (positionals.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const project = loadProject(positionals[0]);
  const only = values.only?.split(',').map((s) => s.trim()).filter(Boolean);
  // Loaded lazily so `doctor` and `init` still work while a module is missing or broken.
  const { renderProject } = await import('../src/pipeline.mjs');
  await renderProject(project, { only, force: values.force, draft: values.draft });
  return 0;
}

async function tool(name, args) {
  try {
    const { stdout } = await run(name, args, { timeout: 20000 });
    return { ok: true, detail: stdout.split('\n')[0].trim() };
  } catch {
    return { ok: false, detail: 'not found' };
  }
}

async function playwrightVersion() {
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, 'node_modules', 'playwright-core', 'package.json'), 'utf8'));
    return { ok: true, detail: pkg.version };
  } catch {
    return { ok: false, detail: 'not installed (run npm install)' };
  }
}

function chromium() {
  try {
    return { ok: true, detail: findChrome() };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function hyperframes() {
  const r = await tool('npx', ['--no-install', 'hyperframes', '--version']);
  return r.ok ? r : { ok: true, detail: 'hyperframes CLI: fetched on demand via npx' };
}

async function doctor() {
  const major = Number(process.versions.node.split('.')[0]);
  const rows = [
    { name: 'node', ok: major >= 22, detail: `v${process.versions.node}${major >= 22 ? '' : ' (need >= 22)'}`, fatal: true },
    { name: 'ffmpeg', ...(await tool('ffmpeg', ['-version'])), fatal: true },
    { name: 'ffprobe', ...(await tool('ffprobe', ['-version'])), fatal: true },
    { name: 'chromium', ...chromium() },
    { name: 'playwright-core', ...(await playwrightVersion()) },
    { name: 'hyperframes', ...(await hyperframes()) },
    { name: 'GEMINI_API_KEY', ok: Boolean(process.env.GEMINI_API_KEY), detail: process.env.GEMINI_API_KEY ? 'set' : 'not set' },
    { name: 'VP_COLLAGE_DIR', ok: Boolean(process.env.VP_COLLAGE_DIR), detail: process.env.VP_COLLAGE_DIR ? 'set' : 'not set' },
  ];
  for (const r of rows) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(18)} ${r.detail}`);
  }
  const fatal = rows.some((r) => r.fatal && !r.ok);
  return fatal ? 1 : 0;
}

async function isNonEmptyDir(dir) {
  try {
    return (await readdir(dir)).length > 0;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function init(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  if (positionals.length !== 1) {
    console.error('usage: vp init <dir>');
    return 2;
  }
  const dest = resolve(positionals[0]);
  if (await isNonEmptyDir(dest)) {
    console.error(`refusing to init: ${dest} exists and is not empty`);
    return 1;
  }
  const skip = (src) => !/[\\/](\.vp-cache|out)([\\/]|$)/.test(src);
  await cp(join(ROOT, 'examples', 'starter'), dest, { recursive: true, filter: skip });
  console.log(`created ${dest}\nnext: vp render ${join(dest, 'project.json')}`);
  return 0;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'render': return render(rest);
    case 'doctor': return doctor();
    case 'init': return init(rest);
    case undefined:
    case '-h':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      console.error(`unknown command: ${cmd}\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`config error: ${err.problems.length} problem(s) in project:`);
    for (const p of err.problems) console.error(`  - ${p}`);
    process.exitCode = 2;
  } else {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}
