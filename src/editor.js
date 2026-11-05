import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { probe, RenderCancelledError } from './ffmpeg.js';
import { selectEncoder } from './encoders.js';
import { assertColorInput, assertRec709Output } from './color-safety.js';

const between = (number, min, max, label) => {
  const value = Number(number);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
};
const decimal = (number) => Number(number.toFixed(4));
let faceDetectorCheck;

export async function probeSources(inputs) {
  const results = new Array(inputs.length);
  let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(4, inputs.length) }, async () => {
    while (next < inputs.length && !failure) {
      const index = next++;
      try { results[index] = await probe(inputs[index]); }
      catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

export function faceDetectorAvailable() {
  if (!faceDetectorCheck) faceDetectorCheck = new Promise((resolve) => {
    const python = process.env.EDITOR_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const child = spawn(python, ['-c', 'import cv2, numpy'], { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
  return faceDetectorCheck;
}

export function validateEditSettings(raw, sourceDurations) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Editing settings are missing.');
  const durations = Array.isArray(sourceDurations) ? sourceDurations.map(item => typeof item === 'number' ? item : item.duration) : [sourceDurations];
  if (!durations.length || durations.some(duration => !Number.isFinite(duration) || duration <= 0)) throw new Error('Every source video needs a readable duration.');
  const rectangle = (item, label) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label} must be a rectangle.`);
    const x = between(item.x, 0, 1, `${label} x`), y = between(item.y, 0, 1, `${label} y`);
    const w = between(item.w, 0.01, 1, `${label} width`), h = between(item.h, 0.01, 1, `${label} height`);
    if (x + w > 1.001 || y + h > 1.001) throw new Error(`${label} goes outside the video.`);
    return { x: decimal(x), y: decimal(y), w: decimal(w), h: decimal(h) };
  };
  if (!Array.isArray(raw.blurRegions) || raw.blurRegions.length > 20) throw new Error('Choose up to 20 blur rectangles.');
  const sourceSegments = raw.segments ?? [{ sourceIndex: 0, start: 0, end: durations[0] }];
  if (!Array.isArray(sourceSegments) || !sourceSegments.length) throw new Error('Add at least one timeline clip.');
  const segments = sourceSegments.map((segment, index) => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) throw new Error(`Timeline clip ${index + 1} is invalid.`);
    const sourceIndex = Number(segment.sourceIndex ?? 0);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= durations.length) throw new Error(`Timeline clip ${index + 1} refers to an unknown source video.`);
    const sourceDuration = durations[sourceIndex];
    const start = between(segment.start, 0, sourceDuration, `Timeline clip ${index + 1} start`);
    const end = Math.min(sourceDuration, between(segment.end, start, sourceDuration + 0.1, `Timeline clip ${index + 1} end`));
    const videoEnabled = segment.videoEnabled !== false, audioEnabled = segment.audioEnabled !== false;
    const preserveGap = segment.preserveGap === true;
    if (end - start < (preserveGap ? 0.001 : 0.08)) throw new Error(`Timeline clip ${index + 1} is too short.`);
    if (!videoEnabled && !audioEnabled && !preserveGap) throw new Error(`Timeline clip ${index + 1} has neither video nor audio.`);
    return { sourceIndex, start: decimal(start), end: decimal(end), videoEnabled, audioEnabled, preserveGap };
  });
  const baseDuration = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
  const rawAudioClips = raw.audioClips ?? [];
  if (!Array.isArray(rawAudioClips)) throw new Error('The extra audio track must be a list of clips.');
  const audioClips = rawAudioClips.map((clip, index) => {
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) throw new Error(`Audio clip ${index + 1} is invalid.`);
    const sourceIndex = Number(clip.sourceIndex);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= durations.length) throw new Error(`Audio clip ${index + 1} refers to an unknown source.`);
    if (Array.isArray(sourceDurations) && sourceDurations[sourceIndex]?.hasAudio === false) throw new Error(`Audio clip ${index + 1} source has no audio.`);
    const start = between(clip.start, 0, durations[sourceIndex], `Audio clip ${index + 1} start`);
    const end = between(clip.end, start + 0.08, durations[sourceIndex] + 0.001, `Audio clip ${index + 1} end`);
    const timelineStart = between(clip.timelineStart, 0, Number.MAX_SAFE_INTEGER, `Audio clip ${index + 1} timeline position`);
    return { sourceIndex, start: decimal(start), end: decimal(Math.min(end, durations[sourceIndex])),
      timelineStart: decimal(timelineStart), volume: between(clip.volume ?? 1, 0, 2, `Audio clip ${index + 1} volume`) };
  });
  const duration = Math.max(baseDuration, ...audioClips.map(clip => clip.timelineStart + clip.end - clip.start));
  if (duration > baseDuration + 0.0001) {
    const gap = duration - baseDuration;
    // Keep the full detached audio even when the visible video ends earlier.
    for (let remaining = gap; remaining > 0.0001;) {
      const length = Math.min(remaining, durations[0]);
      segments.push({sourceIndex: 0, start: 0, end: decimal(length), videoEnabled: false,
        audioEnabled: false, preserveGap: true});
      remaining -= length;
    }
  }
  const blurRegions = raw.blurRegions.map((region, index) => {
    const bounds = rectangle(region, `Blur region ${index + 1}`);
    const start = between(region.start, 0, duration, 'Blur start');
    const end = between(region.end, start, duration + 0.1, 'Blur end');
    return { ...bounds, start: decimal(start), end: decimal(end) };
  });
  const keepClear = raw.keepClear ? rectangle(raw.keepClear, 'Keep clear') : null;
  const voiceStart = between(raw.voiceStart ?? 0, 0, duration, 'Voice start');
  const voiceIn = between(raw.voiceIn ?? 0, 0, Number.MAX_SAFE_INTEGER, 'Voice in');
  const voiceOut = raw.voiceOut == null || raw.voiceOut === '' ? null
    : between(raw.voiceOut, voiceIn + 0.001, Number.MAX_SAFE_INTEGER, 'Voice out');
  const pipStart = between(raw.pipStart ?? 0, 0, duration, 'Picture in picture start');
  const pipEnd = between(raw.pipEnd ?? duration, pipStart, duration + 0.1, 'Picture in picture end');
  const pipPosition = raw.pipPosition || 'bottom-right';
  if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(pipPosition)) throw new Error('Invalid picture in picture corner.');
  const destination = raw.destination || 'both';
  if (destination !== 'both') throw new Error('The editor exports to TikTok and Instagram together.');
  const encoder = raw.encoder || 'auto';
  if (!['auto', 'cpu', 'nvidia', 'amd'].includes(encoder)) throw new Error('Choose an encoding method.');
  const motionTitles = raw.motionTitles ?? [];
  if (!Array.isArray(motionTitles) || motionTitles.length > 30) throw new Error('Choose up to 30 motion titles.');
  const titles = motionTitles.map((title, index) => {
    if (!title || typeof title !== 'object' || Array.isArray(title)) throw new Error(`Motion title ${index + 1} is invalid.`);
    const text = String(title.text ?? '').trim();
    if (!text || text.length > 160) throw new Error(`Motion title ${index + 1} needs 1–160 characters.`);
    const start = between(title.start, 0, duration, `Motion title ${index + 1} start`);
    const end = between(title.end, start + 0.05, duration + 0.1, `Motion title ${index + 1} end`);
    const position = title.position || 'bottom';
    if (!['top', 'center', 'bottom'].includes(position)) throw new Error(`Motion title ${index + 1} position is invalid.`);
    const color = title.color || '#ffffff';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`Motion title ${index + 1} needs a six-digit hex color.`);
    return { text, start: decimal(start), end: decimal(end), position, color,
      background: title.background !== false,
      fontSize: between(title.fontSize ?? 72, 24, 180, `Motion title ${index + 1} size`) };
  });
  return {
    autoFaces: raw.autoFaces === true,
    keepClear, blurRegions, segments, audioClips,
    voiceStart: decimal(voiceStart), voiceIn: decimal(voiceIn), voiceOut: voiceOut == null ? null : decimal(voiceOut),
    voiceVolume: between(raw.voiceVolume ?? 1, 0, 2, 'Voice volume'),
    originalVolume: between(raw.originalVolume ?? 0.25, 0, 1, 'Original sound'),
    pipStart: decimal(pipStart), pipEnd: decimal(pipEnd),
    pipWidth: between(raw.pipWidth ?? 0.32, 0.15, 0.8, 'Picture in picture size'),
    pipPosition, destination, encoder, motionTitles: titles
  };
}

function runProcess(command, args, signal, progress = () => {}, expectedDuration = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', buffer = '', settled = false;
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('out_time_ms=') && expectedDuration) progress(Math.min(99, Math.round(Number(line.slice(12)) / 1000000 / expectedDuration * 100)));
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once('error', (error) => { settled = true; reject(error); });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (settled) return;
      if (signal?.aborted) reject(new RenderCancelledError());
      else if (code !== 0) reject(new Error(`Editor process failed (${code}): ${stderr.slice(-1400)}`));
      else resolve();
    });
  });
}

export async function createFaceMask(input, output, media, settings, signal) {
  const python = process.env.EDITOR_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(python, [path.join(config.root, 'scripts', 'face-mask.py'), '--ffmpeg', config.ffmpeg,
    '--input', input, '--output', output, '--width', String(media.width), '--height', String(media.height),
    '--settings', JSON.stringify({ blurRegions: settings.blurRegions, keepClear: settings.keepClear })
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-1500); });
  child.stdout.resume();
  const abort = () => child.kill();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', (error) => reject(new Error(`Could not start Python face detection: ${error.message}`)));
      child.once('close', resolve);
    });
    if (signal?.aborted) throw new RenderCancelledError();
    if (code !== 0) throw new Error(`Automatic face detection failed: ${stderr || 'check the Python/OpenCV installation.'}`);
  } finally { signal?.removeEventListener('abort', abort); }
}

export async function hasAudioStream(input) {
  const child = spawn(config.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', input], { windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`Could not inspect audio: ${stderr.slice(-300)}`);
  return stdout.trim().split(/\s+/).includes('audio');
}

const rectPixels = (region, width, height) => ({
  x: Math.min(width - 2, Math.round(region.x * width)), y: Math.min(height - 2, Math.round(region.y * height)),
  w: Math.max(2, Math.round(region.w * width)), h: Math.max(2, Math.round(region.h * height))
});

export function buildEditArgs({ input, inputPaths = [], output, voicePath, pipPath, maskPath, media, pipMedia, settings, videoEncoder }) {
  const args = ['-hide_banner', '-y', '-i', input];
  let next = 1, maskIndex = -1, voiceIndex = -1, pipIndex = -1;
  if (maskPath) { maskIndex = next++; args.push('-i', maskPath); }
  if (voicePath) { voiceIndex = next++; args.push('-i', voicePath); }
  if (pipPath) { pipIndex = next++; args.push('-i', pipPath); }
  const audioSources = new Map();
  for (const clip of settings.audioClips || []) if (!audioSources.has(clip.sourceIndex)) {
    audioSources.set(clip.sourceIndex, next++);
    args.push('-i', inputPaths[clip.sourceIndex]);
  }
  const hdr = ['smpte2084', 'arib-std-b67'].includes(media.colorTransfer);
  const tonemap = hdr ? `zscale=pin=${media.colorPrimaries || 'bt2020'}:tin=${media.colorTransfer}:min=${media.colorSpace || 'bt2020nc'}:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=2,zscale=t=bt709:m=bt709:r=limited,` : '';
  const video = [`[0:v]fps=60,${tonemap}setsar=1,format=yuv420p`];
  const blurring = Boolean(maskPath || settings.blurRegions.length);
  if (blurring) {
    video[0] += ',split=2[clear][blurinput]';
    video.push('[blurinput]boxblur=luma_radius=32:luma_power=5:chroma_radius=32:chroma_power=5[blurred]');
    if (maskPath) video.push(`[${maskIndex}:v]fps=60,scale=${media.width}:${media.height}:flags=neighbor,format=gray[mask]`);
    else {
      const drawboxes = settings.blurRegions.map((region) => {
        const r = rectPixels(region, media.width, media.height);
        return `drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=white:t=fill:enable='between(t,${region.start},${region.end})'`;
      }).join(',');
      video.push(`color=c=black:s=${media.width}x${media.height}:r=60:d=${media.duration + 0.1},${drawboxes},format=gray[mask]`);
    }
    video.push('[blurred][mask]alphamerge[redacted]', '[clear][redacted]overlay=x=0:y=0:shortest=1:format=auto[composite]');
  } else video[0] += '[composite]';
  let videoLabel = 'composite';
  if (pipPath) {
    const maxHeightWidth = pipMedia ? media.height * 0.6 * pipMedia.width / pipMedia.height : media.width;
    const width = Math.max(2, Math.round(Math.min(media.width * settings.pipWidth, maxHeightWidth) / 2) * 2);
    const margin = Math.round(Math.min(media.width, media.height) * 0.025);
    const x = settings.pipPosition.endsWith('right') ? `W-w-${margin}` : String(margin);
    const y = settings.pipPosition.startsWith('bottom') ? `H-h-${margin}` : String(margin);
    video.push(`[${pipIndex}:v]fps=60,scale=${width}:-2,setsar=1,setpts=PTS-STARTPTS+${settings.pipStart}/TB[pip]`);
    video.push(`[${videoLabel}][pip]overlay=x=${x}:y=${y}:eof_action=pass:repeatlast=0:enable='between(t,${settings.pipStart},${settings.pipEnd})'[edited]`);
    videoLabel = 'edited';
  }
  const audio = [];
  if (media.hasAudio) audio.push(`[0:a]volume=${settings.originalVolume},aformat=channel_layouts=stereo,apad,atrim=duration=${media.duration}[original]`);
  if (voicePath) audio.push(`[${voiceIndex}:a]atrim=start=${settings.voiceIn ?? 0}${settings.voiceOut == null ? '' : `:end=${settings.voiceOut}`},asetpts=PTS-STARTPTS,volume=${settings.voiceVolume},aformat=channel_layouts=stereo,adelay=${Math.round(settings.voiceStart * 1000)}:all=1,apad[voice]`);
  const grouped = new Map();
  for (const [index, clip] of (settings.audioClips || []).entries()) {
    if (!grouped.has(clip.sourceIndex)) grouped.set(clip.sourceIndex, []);
    grouped.get(clip.sourceIndex).push(index);
  }
  for (const [sourceIndex, indices] of grouped) if (indices.length > 1)
    audio.push(`[${audioSources.get(sourceIndex)}:a]asplit=${indices.length}${indices.map(index => `[rawextra${index}]`).join('')}`);
  for (const [index, clip] of (settings.audioClips || []).entries()) {
    const raw = grouped.get(clip.sourceIndex).length > 1 ? `rawextra${index}` : `${audioSources.get(clip.sourceIndex)}:a`;
    audio.push(`[${raw}]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${clip.volume},adelay=${Math.round(clip.timelineStart * 1000)}:all=1,apad[extra${index}]`);
  }
  const audioLabels = [media.hasAudio ? 'original' : null, voicePath ? 'voice' : null,
    ...(settings.audioClips || []).map((_, index) => `extra${index}`)].filter(Boolean);
  let audioLabel = audioLabels[0] || null;
  if (audioLabels.length > 1) {
    audio.push(`${audioLabels.map(label => `[${label}]`).join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0:normalize=0[mixed]`);
    audioLabel = 'mixed';
  }
  args.push('-filter_complex', [...video, ...audio].join(';'), '-map', `[${videoLabel}]`);
  if (audioLabel) args.push('-map', `[${audioLabel}]`);
  args.push('-c:v', videoEncoder, '-b:v', '60M', '-maxrate', '80M', '-bufsize', '120M',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-tag:v', 'hvc1', '-g', '60');
  if (audioLabel) args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2');
  args.push('-r', '60', '-fps_mode', 'cfr', '-t', String(media.duration), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output);
  return args;
}

export function buildSequenceArgs({ inputs, media, segments, output, videoEncoder, referenceMedia = media[segments[0].sourceIndex] }) {
  const reference = referenceMedia;
  const width = Math.floor(reference.width / 2) * 2, height = Math.floor(reference.height / 2) * 2;
  const duration = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
  const args = ['-hide_banner', '-y'];
  for (const input of inputs) args.push('-i', input);
  const filters = [];
  const videoPositions = new Map(), audioPositions = new Map();
  segments.forEach((segment, index) => {
    if (segment.videoEnabled !== false) {
      if (!videoPositions.has(segment.sourceIndex)) videoPositions.set(segment.sourceIndex, []);
      videoPositions.get(segment.sourceIndex).push(index);
    }
    if (segment.audioEnabled !== false && media[segment.sourceIndex].hasAudio) {
      if (!audioPositions.has(segment.sourceIndex)) audioPositions.set(segment.sourceIndex, []);
      audioPositions.get(segment.sourceIndex).push(index);
    }
  });
  for (const [sourceIndex, indices] of videoPositions) if (indices.length > 1)
    filters.push(`[${sourceIndex}:v]split=${indices.length}${indices.map(index => `[rawv${index}]`).join('')}`);
  for (const [sourceIndex, indices] of audioPositions) if (indices.length > 1)
    filters.push(`[${sourceIndex}:a]asplit=${indices.length}${indices.map(index => `[rawa${index}]`).join('')}`);
  segments.forEach((segment, index) => {
    const source = media[segment.sourceIndex];
    const clipDuration = segment.end - segment.start;
    if (segment.videoEnabled !== false) {
      const rawVideo = videoPositions.get(segment.sourceIndex).length > 1 ? `rawv${index}` : `${segment.sourceIndex}:v`;
      const hdr = ['smpte2084', 'arib-std-b67'].includes(source.colorTransfer);
      const tonemap = hdr ? `zscale=pin=${source.colorPrimaries || 'bt2020'}:tin=${source.colorTransfer}:min=${source.colorSpace || 'bt2020nc'}:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=2,zscale=t=bt709:m=bt709:r=limited,` : '';
      filters.push(`[${rawVideo}]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS,fps=60,${tonemap}scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[clipv${index}]`);
    } else filters.push(`color=c=black:s=${width}x${height}:r=60:d=${clipDuration},format=yuv420p[clipv${index}]`);
    if (segment.audioEnabled !== false && source.hasAudio) {
      const rawAudio = audioPositions.get(segment.sourceIndex).length > 1 ? `rawa${index}` : `${segment.sourceIndex}:a`;
      filters.push(`[${rawAudio}]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${clipDuration}[clipa${index}]`);
    } else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${clipDuration},asetpts=PTS-STARTPTS[clipa${index}]`);
  });
  filters.push(`${segments.map((_, index) => `[clipv${index}][clipa${index}]`).join('')}concat=n=${segments.length}:v=1:a=1[sequencev][sequencea]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[sequencev]', '-map', '[sequencea]',
    '-c:v', videoEncoder, '-b:v', '60M', '-maxrate', '80M', '-bufsize', '120M', '-g', '60',
    '-r', '60', '-fps_mode', 'cfr', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-t', String(duration),
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output);
  return args;
}

async function assembleSequence({ inputs, media, segments, output, videoEncoder, signal, onProgress }) {
  const referenceMedia = media[segments[0].sourceIndex];
  const batchSize = 8;
  const batches = [];
  const concatList = `${output}.concat.txt`;
  const totalDuration = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
  let completedDuration = 0;
  try {
    for (let offset = 0; offset < segments.length; offset += batchSize) {
      if (signal?.aborted) throw new RenderCancelledError();
      const batch = segments.slice(offset, offset + batchSize);
      const indices = [...new Set(batch.map(segment => segment.sourceIndex))];
      const localSegments = batch.map(segment => ({ ...segment, sourceIndex: indices.indexOf(segment.sourceIndex) }));
      const duration = batch.reduce((total, segment) => total + segment.end - segment.start, 0);
      const batchPath = segments.length <= batchSize ? output : `${output}.part-${String(batches.length).padStart(5, '0')}.mp4`;
      batches.push(batchPath);
      const args = buildSequenceArgs({ inputs: indices.map(index => inputs[index]), media: indices.map(index => media[index]),
        segments: localSegments, output: batchPath, videoEncoder, referenceMedia });
      await runProcess(config.ffmpeg, args, signal,
        value => onProgress(Math.round((completedDuration + duration * value / 100) / totalDuration * 36)), duration);
      completedDuration += duration;
      onProgress(Math.round(completedDuration / totalDuration * 36));
    }
    if (batches.length > 1) {
      // Concat demuxer copies the normalized streams, avoiding a growing filter graph or command line.
      const line = file => `file '${path.resolve(file).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
      await fs.writeFile(concatList, batches.map(line).join('\n') + '\n');
      await runProcess(config.ffmpeg, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
        '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output],
      signal, value => onProgress(36 + Math.round(value * 4 / 100)), totalDuration);
    }
    onProgress(40);
  } finally {
    await Promise.all(batches.filter(file => file !== output).map(file => fs.rm(file, { force: true })));
    await fs.rm(concatList, { force: true });
  }
}

export async function renderEdit({ input, inputPaths, output, voicePath, pipPath, settings, signal, onProgress = () => {} }) {
  const baseProgress = value => onProgress(settings.motionTitles?.length ? Math.round(value * 0.7) : value);
  const inputs = inputPaths || [input];
  const sourceMedia = await probeSources(inputs);
  for (const [index, clip] of (settings.audioClips || []).entries())
    if (!sourceMedia[clip.sourceIndex]?.hasAudio) throw new Error(`Audio clip ${index + 1} source has no audio.`);
  const sourceColorChecks = sourceMedia.map((item, index) => assertColorInput(item, { allowHdr: true, label: `Source ${index + 1}` }));
  const segments = settings.segments || [{ sourceIndex: 0, start: 0, end: sourceMedia[0].duration }];
  const expectedDuration = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
  const pipMedia = pipPath ? await probe(pipPath) : null;
  if (pipMedia) sourceColorChecks.push(assertColorInput(pipMedia, { label: 'Picture-in-picture source' }));
  const selected = await selectEncoder(settings.encoder, 'hevc');
  const maskPath = settings.autoFaces ? `${output}.mask.mkv` : null;
  const sequencePath = `${output}.sequence.mp4`;
  const fullFirstClip = segments.length === 1 && segments[0].sourceIndex === 0 && segments[0].videoEnabled !== false && segments[0].audioEnabled !== false && segments[0].start < 0.0001 && segments[0].end >= sourceMedia[0].duration - 0.0001;
  if (signal?.aborted) throw new RenderCancelledError();
  try {
    let workInput = inputs[0], media = sourceMedia[0];
    if (!fullFirstClip) {
      await assembleSequence({ inputs, media: sourceMedia, segments, output: sequencePath, videoEncoder: selected.encoder,
        signal, onProgress: baseProgress });
      workInput = sequencePath; media = await probe(sequencePath); baseProgress(40);
    }
    if (maskPath) { await createFaceMask(workInput, maskPath, media, settings, signal); baseProgress(fullFirstClip ? 15 : 55); }
    const args = buildEditArgs({ input: workInput, inputPaths: inputs, output, voicePath, pipPath, maskPath, media, pipMedia, settings, videoEncoder: selected.encoder });
    const base = fullFirstClip ? 15 : settings.autoFaces ? 55 : 40;
    await runProcess(config.ffmpeg, args, signal, (value) => baseProgress(base + Math.round(value * (100 - base) / 100)), expectedDuration);
    let result = await probe(output);
    assertRec709Output(result, 'Edited master');
    if (result.width !== media.width || result.height !== media.height || result.fps !== '60/1' || Math.abs(result.duration - expectedDuration) > 0.2) throw new Error('Edited master did not match the timeline resolution, frame rate, or duration.');
    if (settings.motionTitles?.length) {
      const motionOutput = `${output}.remotion.mp4`;
      try {
        const {renderMotionGraphics} = await import('./remotion-render.js');
        await renderMotionGraphics({input: output, output: motionOutput, media: result, titles: settings.motionTitles,
          signal, onProgress: value => onProgress(70 + Math.round(value * 29 / 100))});
        const motionMedia = await probe(motionOutput);
        assertRec709Output(motionMedia, 'Remotion master');
        if (motionMedia.width !== result.width || motionMedia.height !== result.height || motionMedia.fps !== '60/1' ||
          Math.abs(motionMedia.duration - expectedDuration) > 0.2 || motionMedia.audioCodec !== result.audioCodec)
          throw new Error('Remotion changed the edited master dimensions, timing, or audio.');
        await fs.rm(output, {force: true});
        await fs.rename(motionOutput, output);
        result = motionMedia;
      } finally { await fs.rm(motionOutput, {force: true}); }
    }
    const colorCheck = sourceColorChecks.includes('hdr-bt2020') ? 'hdr-bt2020'
      : sourceColorChecks.includes('untagged-sdr-assumed') ? 'untagged-sdr-assumed' : 'rec709';
    return { ...result, encoder: selected.encoder, colorCheck, bytes: (await fs.stat(output)).size, output: path.basename(output) };
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  } finally {
    if (maskPath) await fs.rm(maskPath, { force: true });
    if (!fullFirstClip) await fs.rm(sequencePath, { force: true });
  }
}
