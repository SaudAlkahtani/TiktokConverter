import { spawn } from 'node:child_process';
import { config } from './config.js';

const variants = {
  nvidia: { hevc: 'hevc_nvenc', h264: 'h264_nvenc' },
  amd: { hevc: 'hevc_amf', h264: 'h264_amf' },
  cpu: { hevc: 'libx265', h264: 'libx264' }
};
const checks = new Map();

function smokeTest(encoder) {
  return new Promise((resolve) => {
    const child = spawn(config.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=128x128:r=1',
      '-frames:v', '2', '-pix_fmt', 'yuv420p', '-c:v', encoder, '-f', 'null', '-'
    ], { windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => child.kill(), 12000);
    child.once('error', () => { clearTimeout(timeout); resolve(false); });
    child.once('close', (code) => { clearTimeout(timeout); resolve(code === 0); });
  });
}

export function encoderAvailable(encoder) {
  if (!checks.has(encoder)) checks.set(encoder, smokeTest(encoder));
  return checks.get(encoder);
}

export async function encoderCapabilities() {
  const [nvidia, amd] = await Promise.all(['nvidia', 'amd'].map(async (vendor) =>
    (await encoderAvailable(variants[vendor].hevc)) && (await encoderAvailable(variants[vendor].h264))));
  return { cpu: true, nvidia, amd };
}

export async function selectEncoder(choice, codec) {
  if (!['hevc', 'h264'].includes(codec) || !['auto', 'cpu', 'nvidia', 'amd'].includes(choice)) throw new Error('Choose Auto, CPU, NVIDIA or AMD encoding.');
  if (choice === 'cpu') return { choice, encoder: variants.cpu[codec] };
  if (choice !== 'auto') {
    const encoder = variants[choice][codec];
    if (!await encoderAvailable(encoder)) throw new Error(`${choice.toUpperCase()} ${codec.toUpperCase()} encoding is unavailable on this machine or FFmpeg build.`);
    return { choice, encoder };
  }
  for (const vendor of ['nvidia', 'amd']) {
    const encoder = variants[vendor][codec];
    if (await encoderAvailable(encoder)) return { choice: vendor, encoder };
  }
  return { choice: 'cpu', encoder: variants.cpu[codec] };
}
