import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTOSAVE_KEY, createProject, parseProject, relinkProject, serializeProject,
  saveAutosave, loadAutosave, clearAutosave} from '../public/editor-project.js';

const source = {name:'exercise.mp4',size:40_000,lastModified:1_760_000_000_000};
const sound = {name:'voice.mp4',size:8_000,lastModified:1_760_000_001_000};
const plan = () => ({version:1,sources:[source.name],voice:null,pip:null,settings:{segments:[
  {sourceIndex:0,start:0,end:4,videoEnabled:true,audioEnabled:false}],
  audioClips:[],blurRegions:[],motionTitles:[],originalVolume:.25,encoder:'auto',destination:'both'}});
const project = () => createProject(plan(), {sources:[source],name:'Leg day'});
const memoryStorage = () => {
  const values = new Map();
  return {getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};

test('project round trips save edit decisions and media descriptions without retaining files', () => {
  const video = {...source,arrayBuffer:()=>{throw new Error('Media bytes must never be read');}, privateData:'not metadata'};
  const original = plan();
  const saved = createProject(original,{sources:[video],name:'  Leg day  '});
  const restored = parseProject(serializeProject(saved));
  assert.equal(restored.name,'Leg day');
  assert.deepEqual(restored.plan,original);
  assert.deepEqual(restored.media.sources,[source]);
  assert.ok(Number.isFinite(Date.parse(restored.savedAt)));
  assert.ok(!serializeProject(saved).includes('privateData'));
  original.settings.segments[0].end=1;
  assert.equal(saved.plan.settings.segments[0].end,4);
});

test('relink restores original source order, detached audio references, voice and overlay', () => {
  const original = plan(); original.sources.push(sound.name);
  original.voice=sound.name; original.pip=source.name;
  original.settings.audioClips=[{sourceIndex:1,start:1,end:6,timelineStart:0,volume:1}];
  const saved=createProject(original,{sources:[source,sound],voice:sound,pip:source});
  const relinked=relinkProject(saved,[sound,source,{name:'unused.mp4',size:1}]);
  assert.deepEqual(relinked.sources,[source,sound]);
  assert.equal(relinked.sources[relinked.plan.settings.audioClips[0].sourceIndex],sound);
  assert.equal(relinked.voice,sound); assert.equal(relinked.pip,source);
  assert.notEqual(relinked.plan,saved.plan);
});

test('relink refuses missing, changed-size and ambiguous media instead of using a wrong file', () => {
  const saved=project();
  assert.throws(()=>relinkProject(saved,[]),/Missing media: exercise/);
  assert.throws(()=>relinkProject(saved,[{...source,size:41_000}]),/original file/);
  assert.throws(()=>relinkProject(saved,[source,{...source,lastModified:5}]),/More than one/);
  assert.equal(relinkProject(saved,[{...source,lastModified:5}]).sources[0].lastModified,5);
});

test('legacy edit plan stays compatible and relinks media by unambiguous file name', () => {
  const original=plan(); original.sources=['videos/exercise.mp4']; original.voice='voice.mp4'; original.outputDir='exports';
  const parsed=parseProject(JSON.stringify(original));
  assert.equal(parsed.media.sources[0].size,null);
  assert.equal(parsed.plan.outputDir,'exports');
  assert.deepEqual(relinkProject(parsed,[source,sound]).sources,[source]);
  assert.equal(relinkProject(parsed,[source,sound]).voice,sound);
  assert.throws(()=>relinkProject(parsed,[source,{...source,size:50_000},sound]),/More than one/);
});

test('invalid versions, malformed JSON, media mismatches and binary settings are rejected', () => {
  assert.throws(()=>parseProject('{bad'),/not valid JSON/);
  assert.throws(()=>parseProject({...project(),version:99}),/different editor version/);
  assert.throws(()=>createProject(plan(),{sources:[]}),/do not match/);
  assert.throws(()=>createProject(plan(),{sources:[{...source,name:'wrong.mp4'}]}),/does not match/);
  assert.throws(()=>parseProject({...plan(),settings:{segments:[{sourceIndex:3,start:0,end:1}]}}),/unknown source/);
  assert.throws(()=>createProject({...plan(),settings:{file:new Uint8Array(100)}},{sources:[source]}),/JSON edit data only/);
  assert.throws(()=>parseProject('{"version":1,"sources":[],"settings":{"__proto__":{"bad":true}}}'),/unsupported property/);
});

test('autosave stores only a valid project and can be read or explicitly cleared', () => {
  const storage=memoryStorage();
  assert.equal(loadAutosave(storage),null);
  saveAutosave(project(),storage);
  assert.equal(loadAutosave(storage).name,'Leg day');
  assert.ok(storage.getItem(AUTOSAVE_KEY).includes('gym-editor-project'));
  clearAutosave(storage);
  assert.equal(loadAutosave(storage),null);
});

test('corrupt autosaves and blocked/full browser storage give recoverable guidance', () => {
  const storage=memoryStorage(); storage.setItem(AUTOSAVE_KEY,'{broken');
  assert.throws(()=>loadAutosave(storage),/saved edit could not be restored/);
  assert.throws(()=>saveAutosave(project(),{getItem(){},setItem(){throw new Error('QuotaExceeded');}}),/Download a project file/);
  assert.throws(()=>loadAutosave({getItem(){throw new Error('SecurityError');},setItem(){}}),/downloaded project file/);
  assert.throws(()=>saveAutosave(project(),{}),/Browser storage is unavailable/);
});
