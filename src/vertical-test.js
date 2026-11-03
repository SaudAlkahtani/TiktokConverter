import { assertColorInput } from './color-safety.js';

function rateNumber(value) {
  if (typeof value === 'number') return value;
  const [numerator, denominator = '1'] = String(value || '').split('/').map(Number);
  return denominator > 0 ? numerator / denominator : 0;
}

export function verticalTestProfile(media) {
  const sourceFps = rateNumber(media.averageFrameRate) || rateNumber(media.fps);
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) throw new Error('The source frame rate could not be read.');
  const fps = sourceFps >= 45 ? 60 : 30;
  const bitrateMbps = fps === 60 ? 25 : 15;
  const colorCheck = assertColorInput(media, { allowHdr: true, allowBt2020Sdr: true });
  return { sourceFps, fps, bitrateMbps, colorCheck };
}

export function buildVerticalTestArgs(input, output, media, profile = verticalTestProfile(media)) {
  const hdr = profile.colorCheck === 'hdr-bt2020';
  const wideSdr = profile.colorCheck === 'sdr-bt2020';
  const colorFilter = hdr
    ? `zscale=pin=bt2020:tin=${media.colorTransfer}:min=bt2020nc:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=2,zscale=t=bt709:m=bt709:r=limited,`
    : wideSdr ? `zscale=pin=bt2020:tin=${media.colorTransfer}:min=bt2020nc:p=bt709:t=bt709:m=bt709:r=limited,` : '';
  const bitrate = `${profile.bitrateMbps}M`;
  return ['-hide_banner', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', colorFilter + `scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${profile.fps},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-b:v', bitrate, '-maxrate', bitrate,
    '-bufsize', `${profile.bitrateMbps * 2}M`, '-profile:v', 'high', '-level:v', profile.fps === 60 ? '4.2' : '4.1',
    '-g', String(profile.fps * 2), '-r', String(profile.fps), '-fps_mode', 'cfr',
    '-pix_fmt', 'yuv420p', '-tag:v', 'avc1', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', output];
}
