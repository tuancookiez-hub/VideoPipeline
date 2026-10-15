import { readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';

const HF_PACKAGE = 'hyperframes@0.8.159';
const DEFAULT_TIMEOUT_S = 600;
const SECRET = /KEY|TOKEN|SECRET|PASSWORD/i;

// Arguments for `npx`. The composition is rendered from its own directory.
export function hyperframesArgs(scene, ctx) {
  return ['--yes', HF_PACKAGE, 'render', dirname(scene.src), '-c', basename(scene.src),
    '-o', join(ctx.workDir, 'raw.mp4'), '-f', String(ctx.project.fps), '--quiet'];
}

// Newest installed Playwright headless shell, if any.
export function defaultBrowser(browsersDir = '/opt/pw-browsers') {
  let dirs;
  try {
    dirs = readdirSync(browsersDir).filter((d) => /^chromium_headless_shell-\d+$/.test(d));
  } catch {
    return null;
  }
  dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const bin = join(browsersDir, d, 'chrome-linux', 'headless_shell');
    if (existsSync(bin)) return bin;
  }
  return null;
}

// The npx child gets no variable whose name looks like a secret (GEMINI_API_KEY, tokens, passwords).
export function hyperframesEnv(base = process.env, browsersDir) {
  const env = Object.fromEntries(Object.entries(base).filter(([name]) => !SECRET.test(name)));
  env.HYPERFRAMES_NO_TELEMETRY = '1';
  const browser = base.VP_HYPERFRAMES_BROWSER || base.HYPERFRAMES_BROWSER_PATH || defaultBrowser(browsersDir);
  if (browser) env.HYPERFRAMES_BROWSER_PATH = browser;
  return env;
}

export async function render(scene, ctx) {
  await runCli(hyperframesArgs(scene, ctx), {
    env: hyperframesEnv(),
    timeoutS: scene.timeout ?? DEFAULT_TIMEOUT_S,
  });
  return { clip: join(ctx.workDir, 'raw.mp4') };
}

export function runCli(args, { env, timeoutS = DEFAULT_TIMEOUT_S, bin = 'npx' }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const lines = [];
    const keep = (d) => { lines.push(...String(d).split('\n').filter(Boolean)); lines.splice(0, Math.max(0, lines.length - 200)); };
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    const timer = setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); } // whole group: npx and the renderer it started
      reject(new Error(`hyperframes render timed out after ${timeoutS}s:\n${lines.slice(-20).join('\n')}`));
    }, timeoutS * 1000);
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`hyperframes render exited with ${code}:\n${lines.slice(-20).join('\n')}`));
    });
  });
}
