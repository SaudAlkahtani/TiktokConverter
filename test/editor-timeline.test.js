import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteTimelineTrack, linkTimelineSegment, locateTimelineTime, moveTimelineSegment, moveTimelineSegmentTo, removeTimelineSegment, restoreTimelineTrack, splitTimelineSegment, timelineDuration, trimTimelineSegment, unlinkTimelineSegment } from '../public/editor-timeline.js';

test('timeline splits, removes, and reorders source ranges without changing the source', () => {
  const original = [{ start: 0, end: 10 }];
  const split = splitTimelineSegment(original, 0, 4);
  assert.deepEqual(split, [{ start: 0, end: 4 }, { start: 4, end: 10 }]);
  assert.deepEqual(original, [{ start: 0, end: 10 }]);
  assert.equal(splitTimelineSegment(split, 1, 4.01), null);
  assert.equal(removeTimelineSegment(split, 0).length, 1);
  assert.deepEqual(removeTimelineSegment(original, 0), []);
  const moved = moveTimelineSegment(split, 1, -1);
  assert.deepEqual(moved, [{ start: 4, end: 10 }, { start: 0, end: 4 }]);
  assert.equal(timelineDuration(moved), 10);
  assert.deepEqual(locateTimelineTime(moved, 7), { index: 1, sourceTime: 1, projectTime: 7 });
  assert.deepEqual(splitTimelineSegment([{sourceIndex: 3,start: 0,end: 2}],0,1),
    [{sourceIndex: 3,start: 0,end: 1},{sourceIndex: 3,start: 1,end: 2}]);
  assert.deepEqual(trimTimelineSegment([{sourceIndex:3,start:0,end:2}],0,.25,1.75,2),
    [{sourceIndex:3,start:.25,end:1.75}]);
  assert.equal(trimTimelineSegment(original,0,9.99,10,10),null);
  assert.deepEqual(moveTimelineSegmentTo([{sourceIndex:0,start:0,end:1},{sourceIndex:1,start:0,end:1},
    {sourceIndex:2,start:0,end:1}],0,2).map(clip=>clip.sourceIndex),[1,2,0]);
  assert.equal(splitTimelineSegment([{sourceIndex:0,start:0,end:10}],0,5)?.length,2);
});

test('linked video and audio separate, delete independently, restore and relink', () => {
  const original = [{sourceIndex:0,start:0,end:2,videoEnabled:true,audioEnabled:true,linked:true}];
  assert.deepEqual(deleteTimelineTrack(original,0,'audio'),[]);
  const unlinked = unlinkTimelineSegment(original,0);
  assert.equal(unlinked[0].linked,false);
  const videoOnly = deleteTimelineTrack(unlinked,0,'audio');
  assert.equal(videoOnly[0].videoEnabled,true);
  assert.equal(videoOnly[0].audioEnabled,false);
  assert.equal(linkTimelineSegment(videoOnly,0),null);
  const paired = linkTimelineSegment(restoreTimelineTrack(videoOnly,0,'audio'),0);
  assert.equal(paired[0].linked,true);
  assert.deepEqual(original,[{sourceIndex:0,start:0,end:2,videoEnabled:true,audioEnabled:true,linked:true}]);
  const audioOnly = deleteTimelineTrack(unlinked,0,'video');
  assert.equal(audioOnly[0].videoEnabled,false);
  assert.equal(audioOnly[0].audioEnabled,true);
  assert.equal(deleteTimelineTrack(audioOnly,0,'audio').length,0);
});
