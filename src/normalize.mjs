import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffmpeg, probe } from './ffmpeg.mjs';

const run = promisify(execFile);

const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart'];

// Length of the first video stream. Audio can run longer (AAC priming, pads), so timing uses this.
export async function videoDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=duration', '-of', 'csv=p=0', file]);
  const d = Number(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : (await probe(file)).duration;
}

export async function normalizeClip(input, out, { width, height, fps, duration } = {}) {
  const info = await probe(input);
  const videoLen = await videoDuration(input);
  const target = duration ?? videoLen;
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${fps}`,
    'setsar=1',
    'format=yuv420p',
  ];
  if (target > videoLen) {
    vf.push(`tpad=stop_mode=clone:stop_duration=${(target - videoLen + 0.1).toFixed(3)}`);
  }

  const args = ['-i', input];
  if (info.hasAudio) {
    args.push('-map', '0:v:0', '-map', '0:a:0',
      '-vf', vf.join(','), '-af', 'aresample=48000,aformat=channel_layouts=stereo,apad');
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-map', '0:v:0', '-map', '1:a:0', '-vf', vf.join(','));
  }
  // -t cuts the apad/anullsrc tails and any overlong audio or video to the exact length
  args.push('-t', target.toFixed(3), ...ENC, out);
  await ffmpeg(args);
  return { out, duration: await videoDuration(out) };
}
