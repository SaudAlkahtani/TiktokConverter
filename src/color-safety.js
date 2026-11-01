const known = (value) => value && value !== 'unknown' && value !== 'unspecified';
const hdrTransfers = new Set(['smpte2084', 'arib-std-b67']);

export function colorProfile(media) {
  const primaries = known(media.colorPrimaries) ? media.colorPrimaries : null;
  const transfer = known(media.colorTransfer) ? media.colorTransfer : null;
  const matrix = known(media.colorSpace) ? media.colorSpace : null;
  if (!primaries && !transfer && !matrix) return 'untagged-sdr-assumed';
  if ([primaries, transfer, matrix].every(value => !value || value === 'bt709')) return 'rec709';
  if (primaries === 'bt2020' && matrix === 'bt2020nc' && hdrTransfers.has(transfer)) return 'hdr-bt2020';
  return 'unsupported';
}

export function assertColorInput(media, { allowHdr = false, label = 'Source' } = {}) {
  const profile = colorProfile(media);
  if (profile === 'rec709' || profile === 'untagged-sdr-assumed' || (allowHdr && profile === 'hdr-bt2020')) return profile;
  const tags = `${media.colorPrimaries || 'untagged'} / ${media.colorTransfer || 'untagged'} / ${media.colorSpace || 'untagged'}`;
  throw new Error(`${label} color profile ${tags} cannot be safely exported as Rec.709 without risking a color or white-balance shift. Export a Rec.709 SDR master from your editor, then upload that master.`);
}

export function assertRec709Output(media, label = 'Export') {
  if (media.colorPrimaries !== 'bt709' || media.colorTransfer !== 'bt709' || media.colorSpace !== 'bt709') {
    throw new Error(`${label} is missing consistent Rec.709 color tags. Check the FFmpeg encoder before using this file.`);
  }
}
