import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PW_ROOT = '/opt/pw-browsers';

// Flags that let WebGL scenes (three.js, p5 WEBGL) run without a GPU.
export const CHROME_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--allow-file-access-from-files',
  '--hide-scrollbars',
  '--mute-audio',
];

export function findChrome() {
  if (process.env.VP_CHROME) {
    if (!existsSync(process.env.VP_CHROME)) throw new Error(`VP_CHROME points to a missing file: ${process.env.VP_CHROME}`);
    return process.env.VP_CHROME;
  }
  if (existsSync(PW_ROOT)) {
    const builds = readdirSync(PW_ROOT)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) {
      const exe = join(PW_ROOT, b, 'chrome-linux', 'chrome');
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error('No Chromium found. Set VP_CHROME to a Chrome/Chromium executable.');
}
