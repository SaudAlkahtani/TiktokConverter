import {timelineDuration} from './editor-timeline.js';

export const audioEnd = clip => clip.timelineStart + clip.end - clip.start;

export function splitAudioClip(clips, id, time, makeId = () => crypto.randomUUID()) {
  const index = clips.findIndex(clip => clip.id === id);
  if (index < 0) return null;
  const clip = clips[index];
  const offset = time - clip.timelineStart;
  if (offset < 0.08 || clip.end - clip.start - offset < 0.08) return null;
  const cut = Number((clip.start + offset).toFixed(4));
  return [...clips.slice(0, index), {...clip, end: cut},
    {...clip, id: makeId(), start: cut, timelineStart: Number(time.toFixed(4))}, ...clips.slice(index + 1)];
}

export function moveAudioClip(clips, id, timelineStart) {
  if (!Number.isFinite(timelineStart) || timelineStart < 0) return null;
  const index = clips.findIndex(clip => clip.id === id);
  if (index < 0) return null;
  return clips.map((clip, position) => position === index ? {...clip, timelineStart: Number(timelineStart.toFixed(4))} : clip);
}

export function extendWithGap(segments, end, sourceIndex, sourceDuration) {
  const next = segments.map(segment => ({...segment}));
  let remaining = end - timelineDuration(next);
  if (remaining <= 0.0001) return next;
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return null;
  while (remaining > 0.0001) {
    const length = Math.min(remaining, sourceDuration);
    next.push({sourceIndex, start: 0, end: Number(length.toFixed(4)),
      videoEnabled: false, audioEnabled: false, linked: false, preserveGap: true});
    remaining -= length;
  }
  return next;
}
