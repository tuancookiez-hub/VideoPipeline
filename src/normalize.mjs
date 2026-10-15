import { ffmpeg, probe } from './ffmpeg.mjs';

const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart'];

export async function normalizeClip(input, out, { width, height, fps, duration } = {}) {
  const info = await probe(input);
  const target = duration ?? info.duration;
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${fps}`,
    'setsar=1',
    'format=yuv420p',
  ];
  if (duration > info.duration) {
    vf.push(`tpad=stop_mode=clone:stop_duration=${(duration - info.duration + 0.1).toFixed(3)}`);
  }

  const args = ['-i', input];
  if (info.hasAudio) {
    args.push('-map', '0:v:0', '-map', '0:a:0',
      '-vf', vf.join(','), '-af', 'aresample=48000,aformat=channel_layouts=stereo,apad');
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-map', '0:v:0', '-map', '1:a:0', '-vf', vf.join(','));
  }
  // -t cuts the apad/anullsrc tails and any overlong video to the exact length
  args.push('-t', target.toFixed(3), ...ENC, out);
  await ffmpeg(args);
  return { out, duration: (await probe(out)).duration };
}
