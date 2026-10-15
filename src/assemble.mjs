import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ffmpeg, probe } from './ffmpeg.mjs';
import { videoDuration } from './normalize.mjs';

const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart'];

const quote = (p) => `'${resolve(p).replaceAll("'", "'\\''")}'`;

export async function joinClips(clips, { transition = { type: 'none' }, out } = {}) {
  if (clips.length === 0) throw new Error('joinClips: no clips');
  if (clips.length === 1) {
    await ffmpeg(['-i', clips[0].path, '-c', 'copy', out]);
  } else if (!transition || transition.type === 'none') {
    await concat(clips, out);
  } else {
    await xfadeJoin(clips, transition, out);
  }
  await alignAudio(out);
  return { out, duration: await videoDuration(out) };
}

// AAC priming and pads can leave the audio 20-30 ms longer than the video; cut it to the video length.
async function alignAudio(file) {
  const tmp = `${file}.align.mp4`;
  const V = (await videoDuration(file)).toFixed(3);
  await ffmpeg(['-i', file, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
    '-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', V, '-movflags', '+faststart', tmp]);
  await rename(tmp, file);
}

async function concat(clips, out) {
  const dir = await mkdtemp(join(tmpdir(), 'vp-concat-'));
  try {
    const list = join(dir, 'list.txt');
    await writeFile(list, clips.map((c) => `file ${quote(c.path)}`).join('\n') + '\n');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function xfadeJoin(clips, { type, duration: d }, out) {
  const shortest = Math.min(...clips.map((c) => c.duration));
  if (!(d > 0) || d >= shortest) {
    throw new Error(`transition duration ${d}s must be shorter than the shortest clip (${shortest}s)`);
  }
  const parts = [];
  let v = '[0:v]';
  let a = '[0:a]';
  let before = clips[0].duration;
  for (let i = 1; i < clips.length; i++) {
    const offset = before - i * d;
    const last = i === clips.length - 1;
    const vo = last ? '[vout]' : `[v${i}]`;
    const ao = last ? '[aout]' : `[a${i}]`;
    parts.push(`${v}[${i}:v]xfade=transition=${type}:duration=${d}:offset=${offset.toFixed(3)}${vo}`);
    parts.push(`${a}[${i}:a]acrossfade=d=${d}${ao}`);
    v = vo;
    a = ao;
    before += clips[i].duration;
  }
  const inputs = clips.flatMap((c) => ['-i', c.path]);
  await ffmpeg([...inputs, '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]', ...ENC, out]);
}

export async function mixAudio(video, audio, out) {
  if (!audio || !Object.values(audio).some(Boolean)) {
    await ffmpeg(['-i', video, '-c', 'copy', out]);
    return { out };
  }
  const { music, musicVolume = 0.25, voiceover = [], duck = true, loudness = -14, fadeOut = 1.5 } = audio;
  const info = await probe(video);
  const V = (await videoDuration(video)).toFixed(3);
  const inputs = ['-i', video];
  const filters = [];
  let idx = 1;

  if (info.hasAudio) {
    filters.push('[0:a]aresample=48000,aformat=channel_layouts=stereo[sa]');
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo:d=${V}[sa]`);
  }

  if (music) {
    inputs.push('-stream_loop', '-1', '-i', music);
    const st = Math.max(0, Number(V) - fadeOut).toFixed(3);
    filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${V},asetpts=PTS-STARTPTS,` +
      `volume=${musicVolume},afade=t=out:st=${st}:d=${fadeOut}[mu]`);
    idx++;
  }

  voiceover.forEach((line, j) => {
    inputs.push('-i', line.src);
    const ms = Math.round(line.at * 1000);
    filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[vo${j}]`);
    idx++;
  });

  let voBus = null;
  if (voiceover.length > 1) {
    const labels = voiceover.map((_, j) => `[vo${j}]`).join('');
    filters.push(`${labels}amix=inputs=${voiceover.length}:normalize=0:duration=longest[vobus]`);
    voBus = '[vobus]';
  } else if (voiceover.length === 1) {
    filters.push('[vo0]anull[vobus]');
    voBus = '[vobus]';
  }

  const mixIns = ['[sa]'];
  if (music) {
    if (duck && voBus) {
      filters.push(`${voBus}asplit=2[vosc][vomix]`);
      filters.push('[mu][vosc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[mud]');
      mixIns.push('[mud]');
      voBus = '[vomix]';
    } else {
      mixIns.push('[mu]');
    }
  }
  if (voBus) mixIns.push(voBus);

  if (mixIns.length > 1) {
    filters.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:normalize=0:duration=longest[mix]`);
  } else {
    filters.push('[sa]anull[mix]');
  }
  filters.push(`[mix]loudnorm=I=${loudness}:TP=-1.5:LRA=11,aresample=48000,apad[aout]`);

  await ffmpeg([...inputs, '-filter_complex', filters.join(';'),
    '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', V, '-movflags', '+faststart', out]);
  return { out };
}
