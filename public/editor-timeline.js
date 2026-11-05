export const timelineDuration = (segments) => segments.reduce((total, segment) => total + segment.end - segment.start, 0);

export function locateTimelineTime(segments, seconds) {
  if (!segments.length) return null;
  const duration = timelineDuration(segments);
  const target = Math.max(0, Math.min(seconds, duration));
  let offset = 0;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const length = segment.end - segment.start;
    if (target < offset + length || index === segments.length - 1) {
      return { index, sourceTime: segment.start + Math.min(length, target - offset), projectTime: target };
    }
    offset += length;
  }
}

export function timelineOffset(segments, index) {
  return timelineDuration(segments.slice(0, index));
}

export function splitTimelineSegment(segments, index, sourceTime) {
  const segment = segments[index];
  if (!segment || sourceTime - segment.start < 0.08 || segment.end - sourceTime < 0.08) return null;
  const cut = Number(sourceTime.toFixed(4));
  return [
    ...segments.slice(0, index),
    { ...segment, end: cut },
    { ...segment, start: cut },
    ...segments.slice(index + 1)
  ];
}

export function trimTimelineSegment(segments, index, start, end, sourceDuration) {
  if (!segments[index] || !Number.isFinite(start) || !Number.isFinite(end) ||
      start < 0 || end > sourceDuration + 0.0001 || end - start < 0.08) return null;
  const next = [...segments];
  next[index] = { ...next[index], start: Number(start.toFixed(4)), end: Number(Math.min(end, sourceDuration).toFixed(4)) };
  return next;
}

export function removeTimelineSegment(segments, index) {
  if (index < 0 || index >= segments.length) return null;
  return segments.filter((_, clipIndex) => clipIndex !== index);
}

export function unlinkTimelineSegment(segments, index) {
  if (!segments[index]) return null;
  const next = [...segments];
  next[index] = { ...next[index], linked: false };
  return next;
}

export function linkTimelineSegment(segments, index) {
  const clip = segments[index];
  if (!clip || clip.videoEnabled === false || clip.audioEnabled === false) return null;
  const next = [...segments];
  next[index] = { ...clip, linked: true };
  return next;
}

export function deleteTimelineTrack(segments, index, track) {
  const clip = segments[index];
  if (!clip || !['video', 'audio'].includes(track)) return null;
  if (clip.linked !== false) return removeTimelineSegment(segments, index);
  const key = track === 'video' ? 'videoEnabled' : 'audioEnabled';
  if (clip[key] === false) return null;
  const changed = { ...clip, [key]: false };
  if (changed.videoEnabled === false && changed.audioEnabled === false && !changed.preserveGap) return removeTimelineSegment(segments, index);
  const next = [...segments];
  next[index] = changed;
  return next;
}

export function restoreTimelineTrack(segments, index, track) {
  const clip = segments[index];
  if (!clip || !['video', 'audio'].includes(track)) return null;
  const next = [...segments];
  next[index] = { ...clip, [track === 'video' ? 'videoEnabled' : 'audioEnabled']: true };
  return next;
}

export function moveTimelineSegment(segments, index, direction) {
  const other = index + direction;
  if (![-1, 1].includes(direction) || index < 0 || other < 0 || other >= segments.length) return null;
  const next = [...segments];
  [next[index], next[other]] = [next[other], next[index]];
  return next;
}

export function moveTimelineSegmentTo(segments, from, to) {
  if (from < 0 || from >= segments.length || to < 0 || to >= segments.length) return null;
  const next = [...segments];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
