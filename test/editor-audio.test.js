import test from 'node:test';
import assert from 'node:assert/strict';
import {audioEnd, extendWithGap, moveAudioClip, splitAudioClip} from '../public/editor-audio.js';

test('A2 audio splits without shortening its total timeline span', () => {
  const full = [{id:'a',sourceIndex:1,start:0,end:10,timelineStart:0,volume:1}];
  const split = splitAudioClip(full, 'a', 4, () => 'b');
  assert.deepEqual(split.map(clip => [clip.start,clip.end,clip.timelineStart]), [[0,4,0],[4,10,4]]);
  assert.equal(audioEnd(split[1]), 10);
  assert.equal(full[0].end, 10);
  assert.equal(splitAudioClip(full, 'a', 0.01), null);
});

test('audio can move and extend the project with a black video gap', () => {
  const clips = [{id:'a',sourceIndex:1,start:0,end:2,timelineStart:0,volume:1}];
  const moved = moveAudioClip(clips,'a',3);
  assert.equal(moved[0].timelineStart,3);
  assert.equal(clips[0].timelineStart,0);
  const segments = [{sourceIndex:0,start:0,end:1,videoEnabled:true,audioEnabled:true}];
  const extended = extendWithGap(segments, audioEnd(moved[0]), 1, 2);
  assert.equal(extended.length,3);
  assert.ok(extended.slice(1).every(segment => segment.preserveGap && !segment.videoEnabled && !segment.audioEnabled));
  assert.equal(extended.reduce((duration, clip) => duration + clip.end - clip.start, 0),5);
});
