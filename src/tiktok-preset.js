// Locked to the TikTok conversion method at Git commit 6378e68e7011e93ae16ff5ea3e39f24428ad0860.
// Keep this argument list and test/tiktok-preset.test.js in sync if the method is intentionally changed.
export const TIKTOK_PRESET = Object.freeze({
  timestampScale: 2,
  videoCodec: 'libx265',
  bitrate: '20M',
  gop: 60,
  sharpen: 'unsharp=3:3:0.4:3:3:0.4',
  audioBitrate: '256k'
});

const environmentSettings = {
  VIDEO_TIMESTAMP_SCALE: String(TIKTOK_PRESET.timestampScale),
  VIDEO_CODEC: TIKTOK_PRESET.videoCodec,
  VIDEO_BITRATE: TIKTOK_PRESET.bitrate,
  VIDEO_GOP: String(TIKTOK_PRESET.gop),
  VIDEO_SHARPEN: TIKTOK_PRESET.sharpen
};

export function assertTikTokPresetEnvironment(env = process.env) {
  for (const [key, expected] of Object.entries(environmentSettings)) {
    const value = env[key]?.trim();
    if (value && value !== expected) {
      throw new Error(`${key} must be ${expected}; TikTok exports are locked to commit 6378e68.`);
    }
  }
}

export function buildTikTokArgs(input, output) {
  return [
    '-hide_banner', '-y', '-itsscale', '2', '-i', input,
    '-map', '0:v:0', '-map', '0:a?',
    '-vf', 'fps=60,unsharp=3:3:0.4:3:3:0.4',
    '-c:v', 'libx265', '-b:v', '20M', '-g', '60',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-tag:v', 'hvc1', '-movflags', '+faststart', '-write_tmcd', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-progress', 'pipe:1', '-nostats', output
  ];
}
