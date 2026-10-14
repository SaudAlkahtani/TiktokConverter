import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setupNavigation } from '../public/navigation.js';
import { subscribeToJobs } from '../src/events.js';

test('rapid navigation closes the stream once and blocks repeat/current-page clicks', () => {
  const handlers = {}, lifecycle = {};
  let starts = 0, closes = 0;
  setupNavigation({nav:{addEventListener:(name,fn)=>handlers[name]=fn},window:{addEventListener:(name,fn)=>lifecycle[name]=fn},startStream:()=>{starts++;return {close:()=>closes++};}});
  const click=(current=false,extras={})=>{let prevented=false;handlers.click({target:{closest:()=>({getAttribute:()=>current?'page':null})},button:0,preventDefault:()=>prevented=true,...extras});return prevented;};
  assert.equal(click(true),true); assert.equal(closes,0);
  assert.equal(click(false,{ctrlKey:true}),false); assert.equal(closes,0);
  assert.equal(click(),false); assert.equal(click(),true); assert.equal(closes,1);
  lifecycle.pagehide(); assert.equal(closes,1);
  lifecycle.pageshow(); assert.equal(starts,2);
  assert.equal(click(),false); assert.equal(closes,2);
});

test('live queue subscribers are released on connection close or error', () => {
 const queue=new EventEmitter();queue.snapshot=()=>[];
 for(const reason of ['close','error']) {
  const response=new EventEmitter();response.write=()=>{};
  subscribeToJobs(queue,response);assert.equal(queue.listenerCount('update'),1);
  response.emit(reason);assert.equal(queue.listenerCount('update'),0);
 }
});
