import { spawn } from 'node:child_process';

function collect(proc, name) {
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  return new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${name} exited with ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}`));
    });
  });
}

export async function ffmpeg(args) {
  const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  await collect(proc, 'ffmpeg');
}

export async function probe(file) {
  const proc = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  await collect(proc, 'ffprobe');
  const info = JSON.parse(out);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const [n, d] = (v?.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    duration: Number(info.format.duration || v?.duration || 0),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: d ? n / d : 0,
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
  };
}

// Frames (PNG or JPEG buffers) written in order become an H.264 clip at their native size
// (normalizeClip fits it to the project size). width/height are accepted for compatibility and ignored.
export function spawnEncoder({ out, fps }) {
  const proc = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(fps),
    '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  const done = collect(proc, 'ffmpeg encoder');
  let failed = null;
  done.catch((e) => { failed = e; });
  // A dying encoder shows up as EPIPE on stdin; the useful error is ffmpeg's, reported via `done`.
  proc.stdin.on('error', () => {});
  return {
    write(buf) {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => {
        proc.stdin.write(buf, (err) => {
          if (!err) resolve();
          else done.then(() => reject(new Error('ffmpeg encoder closed its input early')), reject);
        });
      });
    },
    async close() {
      proc.stdin.end();
      await done;
    },
  };
}
