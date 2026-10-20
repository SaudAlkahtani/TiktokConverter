import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { probe, RenderCancelledError } from './ffmpeg.js';
import { selectEncoder } from './encoders.js';

const between = (number, min, max, label) => {
  const value = Number(number);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
};
const decimal = (number) => Number(number.toFixed(4));
let faceDetectorCheck;

export function faceDetectorAvailable() {
  if (!faceDetectorCheck) faceDetectorCheck = new Promise((resolve) => {
    const python = process.env.EDITOR_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const child = spawn(python, ['-c', 'import cv2, numpy'], { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
  return faceDetectorCheck;
}

export function validateEditSettings(raw, duration) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Editing settings are missing.');
  const rectangle = (item, label) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label} must be a rectangle.`);
    const x = between(item.x, 0, 1, `${label} x`), y = between(item.y, 0, 1, `${label} y`);
    const w = between(item.w, 0.01, 1, `${label} width`), h = between(item.h, 0.01, 1, `${label} height`);
    if (x + w > 1.001 || y + h > 1.001) throw new Error(`${label} goes outside the video.`);
    return { x: decimal(x), y: decimal(y), w: decimal(w), h: decimal(h) };
  };
  if (!Array.isArray(raw.blurRegions) || raw.blurRegions.length > 20) throw new Error('Choose up to 20 blur rectangles.');
  const blurRegions = raw.blurRegions.map((region, index) => {
    const bounds = rectangle(region, `Blur region ${index + 1}`);
    const start = between(region.start, 0, duration, 'Blur start');
    const end = between(region.end, start, duration + 0.1, 'Blur end');
    return { ...bounds, start: decimal(start), end: decimal(end) };
  });
  const keepClear = raw.keepClear ? rectangle(raw.keepClear, 'Keep clear') : null;
  const voiceStart = between(raw.voiceStart ?? 0, 0, duration, 'Voice start');
  const pipStart = between(raw.pipStart ?? 0, 0, duration, 'Picture in picture start');
  const pipEnd = between(raw.pipEnd ?? duration, pipStart, duration + 0.1, 'Picture in picture end');
  const pipPosition = raw.pipPosition || 'bottom-right';
  if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(pipPosition)) throw new Error('Invalid picture in picture corner.');
  const destination = raw.destination || 'both';
  if (!['tiktok', 'instagram', 'both'].includes(destination)) throw new Error('Choose a destination.');
  const encoder = raw.encoder || 'auto';
  if (!['auto', 'cpu', 'nvidia', 'amd'].includes(encoder)) throw new Error('Choose an encoding method.');
  return {
    autoFaces: raw.autoFaces === true,
    keepClear, blurRegions,
    voiceStart: decimal(voiceStart),
    voiceVolume: between(raw.voiceVolume ?? 1, 0, 2, 'Voice volume'),
    originalVolume: between(raw.originalVolume ?? 0.25, 0, 1, 'Original sound'),
    pipStart: decimal(pipStart), pipEnd: decimal(pipEnd),
    pipWidth: between(raw.pipWidth ?? 0.32, 0.15, 0.8, 'Picture in picture size'),
    pipPosition, destination, encoder
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

export function buildEditArgs({ input, output, voicePath, pipPath, maskPath, media, pipMedia, settings, videoEncoder }) {
  const args = ['-hide_banner', '-y', '-i', input];
  let next = 1, maskIndex = -1, voiceIndex = -1, pipIndex = -1;
  if (maskPath) { maskIndex = next++; args.push('-i', maskPath); }
  if (voicePath) { voiceIndex = next++; args.push('-i', voicePath); }
  if (pipPath) { pipIndex = next++; args.push('-i', pipPath); }
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
  if (voicePath) audio.push(`[${voiceIndex}:a]volume=${settings.voiceVolume},aformat=channel_layouts=stereo,adelay=${Math.round(settings.voiceStart * 1000)}:all=1,apad,atrim=duration=${media.duration}[voice]`);
  let audioLabel = null;
  if (media.hasAudio && voicePath) { audio.push('[original][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]'); audioLabel = 'mixed'; }
  else if (media.hasAudio) audioLabel = 'original';
  else if (voicePath) audioLabel = 'voice';
  args.push('-filter_complex', [...video, ...audio].join(';'), '-map', `[${videoLabel}]`);
  if (audioLabel) args.push('-map', `[${audioLabel}]`);
  args.push('-c:v', videoEncoder, '-b:v', '60M', '-maxrate', '80M', '-bufsize', '120M',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-tag:v', 'hvc1', '-g', '60');
  if (audioLabel) args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2');
  args.push('-t', String(media.duration), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output);
  return args;
}

export async function renderEdit({ input, output, voicePath, pipPath, settings, signal, onProgress = () => {} }) {
  const media = await probe(input);
  const pipMedia = pipPath ? await probe(pipPath) : null;
  const selected = await selectEncoder(settings.encoder, 'hevc');
  const maskPath = settings.autoFaces ? `${output}.mask.mkv` : null;
  if (signal?.aborted) throw new RenderCancelledError();
  try {
    if (maskPath) { onProgress(1); await createFaceMask(input, maskPath, media, settings, signal); onProgress(15); }
    const args = buildEditArgs({ input, output, voicePath, pipPath, maskPath, media, pipMedia, settings, videoEncoder: selected.encoder });
    await runProcess(config.ffmpeg, args, signal, (value) => onProgress(15 + Math.round(value * 0.85)), media.duration);
    const result = await probe(output);
    if (result.width !== media.width || result.height !== media.height || result.fps !== '60/1' || Math.abs(result.duration - media.duration) > 0.2) throw new Error('Edited master did not preserve the source resolution and duration at 60 fps.');
    return { ...result, encoder: selected.encoder, bytes: (await fs.stat(output)).size, output: path.basename(output) };
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  } finally { if (maskPath) await fs.rm(maskPath, { force: true }); }
}
