const frame = value => Math.round(value * 60) / 60;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function snapTime(time, boundaries, tolerance, enabled = true) {
  const target = Math.max(0, time);
  const nearest = enabled ? boundaries.reduce((best, point) =>
    Math.abs(point - target) < Math.abs(best - target) ? point : best, Infinity) : Infinity;
  return Number((Math.abs(nearest - target) <= tolerance ? nearest : frame(target)).toFixed(4));
}

export function trimVideoEdge(clip, edge, delta, sourceDuration) {
  if (!clip || !['start', 'end'].includes(edge) || !Number.isFinite(delta)) return null;
  const next = {...clip};
  if (edge === 'start') next.start = clamp(frame(clip.start + delta), 0, clip.end - .08);
  else next.end = clamp(frame(clip.end + delta), clip.start + .08, sourceDuration);
  next.start = Number(next.start.toFixed(4)); next.end = Number(next.end.toFixed(4));
  return next;
}

export function trimAudioEdge(clip, edge, delta, sourceDuration) {
  if (!clip || !['start', 'end'].includes(edge) || !Number.isFinite(delta)) return null;
  const next = {...clip};
  if (edge === 'start') {
    const shift = clamp(frame(delta), Math.max(-clip.start, -clip.timelineStart), clip.end - clip.start - .08);
    next.start += shift; next.timelineStart += shift;
  } else next.end = clamp(frame(clip.end + delta), clip.start + .08, sourceDuration);
  for (const key of ['start', 'end', 'timelineStart']) next[key] = Number(next[key].toFixed(4));
  return next;
}
