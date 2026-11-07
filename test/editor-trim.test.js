import test from 'node:test';
import assert from 'node:assert/strict';
import {snapTime, trimAudioEdge, trimVideoEdge} from '../public/editor-trim.js';
import {deleteTimelineTrack} from '../public/editor-timeline.js';

test('left audio trim keeps its right edge fixed and clamps against source and project starts', () => {
  const audio = {start:2,end:8,timelineStart:3,volume:1};
  const trimmed = trimAudioEdge(audio,'start',1,10);
  assert.deepEqual([trimmed.start,trimmed.end,trimmed.timelineStart], [3,8,4]);
  assert.equal(trimmed.timelineStart + trimmed.end - trimmed.start,9);
  const extended = trimAudioEdge(audio,'start',-9,10);
  assert.deepEqual([extended.start,extended.timelineStart], [0,1]);
  assert.equal(audio.start,2);
});

test('video and audio trim edges stay inside source and retain a usable range', () => {
  assert.equal(trimVideoEdge({start:2,end:8},'end',20,10).end,10);
  assert.equal(trimVideoEdge({start:2,end:8},'start',20,10).start,7.92);
  assert.equal(trimAudioEdge({start:2,end:8,timelineStart:0},'start',-4,10).start,2);
  assert.equal(trimAudioEdge({start:2,end:8,timelineStart:0},'end',20,10).end,10);
});

test('snapping chooses the closest cut only within the screen tolerance and otherwise uses a frame', () => {
  assert.equal(snapTime(3.03,[1,3,4],.05),3);
  assert.equal(snapTime(3.03,[1,3,4],.01),3.0333);
  assert.equal(snapTime(3.03,[1,3,4],.05,false),3.0333);
  assert.equal(snapTime(-1,[],.05),0);
});

test('empty preserved gaps can be removed after the detached audio is shortened', () => {
  const video = {start:0,end:2,videoEnabled:true,audioEnabled:false,linked:false};
  const gap = {start:0,end:1,videoEnabled:false,audioEnabled:false,preserveGap:true,linked:false};
  assert.deepEqual(deleteTimelineTrack([video,gap],1,'video'),[video]);
});
