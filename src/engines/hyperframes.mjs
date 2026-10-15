import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';

const HF_PACKAGE = 'hyperframes@0.8.159';

// Arguments for `npx`. The composition is rendered from its own directory.
export function hyperframesArgs(scene, ctx) {
  return ['--yes', HF_PACKAGE, 'render', dirname(scene.src), '-c', basename(scene.src),
    '-o', join(ctx.workDir, 'raw.mp4'), '-f', String(ctx.project.fps), '--quiet'];
}

function hyperframesEnv() {
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' };
  if (process.env.VP_HYPERFRAMES_BROWSER) env.HYPERFRAMES_BROWSER_PATH = process.env.VP_HYPERFRAMES_BROWSER;
  return env;
}

export async function render(scene, ctx) {
  await runCli(hyperframesArgs(scene, ctx));
  return { clip: join(ctx.workDir, 'raw.mp4') };
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', args, { env: hyperframesEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    const keep = (d) => { lines.push(...String(d).split('\n').filter(Boolean)); lines.splice(0, Math.max(0, lines.length - 200)); };
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`hyperframes render exited with ${code}:\n${lines.slice(-20).join('\n')}`));
    });
  });
}
