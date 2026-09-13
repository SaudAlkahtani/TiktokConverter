import { config } from './config.js';

export const encoderNames = { cpu: 'CPU Quality', amd: 'AMD Fast', nvidia: 'NVIDIA Fast' };
export const isEncoder = (value) => typeof value === 'string' && Object.hasOwn(encoderNames, value);
export const isTenBit = (media) => /10|12|16|p010/.test(media.pixelFormat || '');

export function encoderPixelFormat(media, encoder) {
  if (media.width % 2 || media.height % 2) return isTenBit(media) ? 'yuv444p10le' : 'yuv444p';
  return isTenBit(media) ? (encoder === 'nvidia' ? 'p010le' : 'yuv420p10le') : 'yuv420p';
}

export function encoderArgs(encoder) {
  if (!isEncoder(encoder)) throw new Error('Choose CPU, AMD, or NVIDIA encoding.');
  const gop = ['-g', String(config.export.gop)];
  if (encoder === 'amd') return ['-c:v', 'hevc_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20', ...gop];
  if (encoder === 'nvidia') return ['-c:v', 'hevc_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-spatial-aq', '1', '-rc-lookahead', '20', ...gop];
  return ['-c:v', 'libx265', '-preset', config.export.preset, '-crf', String(config.export.crf), ...gop, '-x265-params', 'log-level=error:pools=4'];
}

// Test the real device at the source dimensions, not just whether FFmpeg lists
// an encoder. Never silently reduce bit depth or round dimensions to fit a GPU.
export async function selectEncoder(media, requested, check) {
  if (!isEncoder(requested)) throw new Error('Choose CPU, AMD, or NVIDIA encoding.');
  const fallback = (reason) => ({ encoder: 'cpu', warnings: [`${encoderNames[requested]}: ${reason} Using CPU Quality instead.`] });
  if (requested === 'cpu') return { encoder: 'cpu', warnings: [] };
  if (media.width % 2 || media.height % 2) return fallback('Exact odd dimensions require the CPU profile.');
  if (requested === 'amd' && isTenBit(media)) return fallback('This AMD profile supports 8-bit output only; preserving your 10-bit precision.');
  try {
    await check(requested, media);
    return { encoder: requested, warnings: [] };
  } catch {
    return fallback('The GPU compatibility check failed. Check that the matching GPU, current vendor driver, and FFmpeg encoder are installed.');
  }
}

export async function encodeWithFallback(selection, encode, notify = () => {}) {
  let encoder = selection.encoder;
  const warnings = [...selection.warnings];
  notify({ encoder, warnings: [...warnings] });
  try { await encode(encoder); }
  catch (error) {
    if (encoder === 'cpu') throw error;
    warnings.push(`${encoderNames[encoder]} export failed; retrying once with CPU Quality. If this repeats, check your GPU driver.`);
    encoder = 'cpu';
    notify({ encoder, warnings: [...warnings] });
    await encode(encoder);
  }
  return { encoder, warnings };
}
