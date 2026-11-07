// Project files contain edit decisions and file descriptions, never media bytes.
export const PROJECT_FORMAT = 'gym-editor-project';
export const PROJECT_VERSION = 1;
export const AUTOSAVE_KEY = 'gym-editor.project.autosave.v1';
const MAX_JSON_LENGTH = 5_000_000;
const plainObject = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fileName = name => String(name).split(/[\\/]/).at(-1);

function copyJson(value, label = 'Project', depth = 0) {
  if (depth > 40) throw new Error(`${label} is nested too deeply.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => copyJson(item, label, depth + 1));
  if (!plainObject(value)) throw new Error(`${label} must contain JSON edit data only; media files cannot be saved inside a project.`);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`${label} contains an unsupported property.`);
    result[key] = copyJson(item, label, depth + 1);
  }
  return result;
}

function validName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${label} needs a file name.`);
  return value;
}

function validatePlan(raw) {
  if (!plainObject(raw) || raw.version !== 1) throw new Error('This edit plan version is not supported. Use a version 1 edit plan.');
  if (!Array.isArray(raw.sources)) throw new Error('The project needs a source video list.');
  const sources = raw.sources.map((name, index) => validName(name, `Source ${index + 1}`));
  if (!plainObject(raw.settings)) throw new Error('The project is missing its editing settings.');
  const settings = copyJson(raw.settings, 'Editing settings');
  for (const field of ['segments', 'audioClips', 'blurRegions', 'motionTitles']) {
    if (settings[field] != null && !Array.isArray(settings[field])) throw new Error(`The project ${field} must be a list.`);
  }
  for (const [kind, clips] of [['Timeline', settings.segments || []], ['Audio', settings.audioClips || []]]) {
    for (const [index, clip] of clips.entries()) {
      const sourceIndex = clip?.sourceIndex ?? (kind === 'Timeline' ? 0 : undefined);
      if (!plainObject(clip) || !Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= sources.length)
        throw new Error(`${kind} clip ${index + 1} refers to an unknown source video.`);
      if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end <= clip.start)
        throw new Error(`${kind} clip ${index + 1} has invalid source In/Out points.`);
      if (kind === 'Audio' && (!Number.isFinite(clip.timelineStart) || clip.timelineStart < 0))
        throw new Error(`Audio clip ${index + 1} needs a nonnegative timeline position.`);
      if (kind === 'Audio' && clip.volume != null && (!Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 2))
        throw new Error(`Audio clip ${index + 1} volume must be between 0 and 2.`);
    }
  }
  const asset = (value, label) => value == null ? null : validName(value, label);
  const result = {version: 1, sources, voice: asset(raw.voice, 'Voice recording'), pip: asset(raw.pip, 'Overlay video'), settings};
  if (raw.outputDir != null) result.outputDir = validName(raw.outputDir, 'Output folder');
  return result;
}

export function describeMedia(file) {
  if (!file || typeof file.name !== 'string') throw new Error('Choose the local media file before saving this project.');
  const name = validName(file.name, 'Media');
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`The size of ${name} is not readable.`);
  return {name, size: file.size,
    lastModified: Number.isSafeInteger(file.lastModified) && file.lastModified >= 0 ? file.lastModified : null};
}

function validateDescriptor(raw, expected, label) {
  if (!plainObject(raw) || raw.name !== fileName(expected)) throw new Error(`${label} does not match the project's media list.`);
  for (const field of ['size', 'lastModified']) if (raw[field] != null && (!Number.isSafeInteger(raw[field]) || raw[field] < 0))
    throw new Error(`${label} has invalid ${field} metadata.`);
  return {name: raw.name, size: raw.size ?? null, lastModified: raw.lastModified ?? null};
}

function legacyMedia(plan) {
  const descriptor = name => ({name: fileName(name), size: null, lastModified: null});
  return {sources: plan.sources.map(descriptor), voice: plan.voice ? descriptor(plan.voice) : null,
    pip: plan.pip ? descriptor(plan.pip) : null};
}

export function createProject(plan, {sources = [], voice = null, pip = null, name = 'Untitled gym edit'} = {}) {
  const cleanPlan = validatePlan(plan);
  if (sources.length !== cleanPlan.sources.length) throw new Error('The imported source videos do not match this project.');
  const media = {sources: sources.map(describeMedia), voice: voice ? describeMedia(voice) : null,
    pip: pip ? describeMedia(pip) : null};
  return parseProject({format: PROJECT_FORMAT, version: PROJECT_VERSION,
    name, savedAt: new Date().toISOString(), plan: cleanPlan, media});
}

export function parseProject(value) {
  let raw = value;
  if (typeof raw === 'string') {
    if (raw.length > MAX_JSON_LENGTH) throw new Error('This project file is too large. Open an edit plan containing settings and media names only.');
    try { raw = JSON.parse(raw); }
    catch { throw new Error('This project file is not valid JSON. Choose a saved .gymedit.json project or edit plan.'); }
  }
  if (!plainObject(raw)) throw new Error('Choose a saved editor project or a version 1 edit plan.');
  if (raw.format == null && raw.version === 1 && Array.isArray(raw.sources)) {
    const plan = validatePlan(raw);
    return {format: PROJECT_FORMAT, version: PROJECT_VERSION, name: 'Imported edit plan',
      savedAt: null, plan, media: legacyMedia(plan)};
  }
  if (raw.format !== PROJECT_FORMAT) throw new Error('This file is not a Gym Editor project or edit plan.');
  if (raw.version !== PROJECT_VERSION) throw new Error('This project was saved by a different editor version. Update the editor before opening it.');
  const plan = validatePlan(raw.plan);
  if (!plainObject(raw.media) || !Array.isArray(raw.media.sources) || raw.media.sources.length !== plan.sources.length)
    throw new Error('This project is missing its source media descriptions.');
  const media = {sources: raw.media.sources.map((item, index) => validateDescriptor(item, plan.sources[index], `Source ${index + 1}`))};
  for (const role of ['voice', 'pip']) {
    if (plan[role]) media[role] = validateDescriptor(raw.media[role], plan[role], role === 'voice' ? 'Voice recording' : 'Overlay video');
    else {
      if (raw.media[role] != null) throw new Error(`The project has an unexpected ${role} media description.`);
      media[role] = null;
    }
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : 'Untitled gym edit';
  const savedAt = raw.savedAt == null ? null : raw.savedAt;
  if (savedAt != null && (typeof savedAt !== 'string' || !Number.isFinite(Date.parse(savedAt)))) throw new Error('This project has an invalid saved date.');
  return {format: PROJECT_FORMAT, version: PROJECT_VERSION, name, savedAt, plan, media};
}

export function serializeProject(project) {
  const serialized = JSON.stringify(parseProject(project), null, 2);
  if (serialized.length > MAX_JSON_LENGTH) throw new Error('This project file is too large. Save edit decisions and media names only.');
  return serialized;
}

export function relinkProject(project, files) {
  const clean = parseProject(project);
  const available = Array.from(files || []);
  const find = descriptor => {
    if (!descriptor) return null;
    const matches = available.filter(file => file?.name === descriptor.name && (descriptor.size == null || file.size === descriptor.size));
    if (!matches.length) throw new Error(`Missing media: ${descriptor.name}${descriptor.size == null ? '' : ` (${descriptor.size} bytes)`}. Select the original file to relink it.`);
    if (matches.length > 1) throw new Error(`More than one selected file matches ${descriptor.name}. Select only the intended original file.`);
    return matches[0];
  };
  return {plan: clean.plan, sources: clean.media.sources.map(find), voice: find(clean.media.voice), pip: find(clean.media.pip)};
}

function browserStorage(storage) {
  try {
    const resolved = storage ?? globalThis.localStorage;
    if (!resolved || typeof resolved.getItem !== 'function' || typeof resolved.setItem !== 'function') throw new Error();
    return resolved;
  } catch { throw new Error('Browser storage is unavailable. Download a project file to save your edit.'); }
}

export function saveAutosave(project, storage) {
  const serialized = serializeProject(project);
  try { browserStorage(storage).setItem(AUTOSAVE_KEY, serialized); }
  catch (error) {
    if (error.message?.startsWith('Browser storage')) throw error;
    throw new Error('The browser could not save this edit. Its storage may be full or blocked. Download a project file.');
  }
  return parseProject(serialized);
}

export function loadAutosave(storage) {
  let saved;
  try { saved = browserStorage(storage).getItem(AUTOSAVE_KEY); }
  catch { throw new Error('The browser could not read the saved edit. You can still open a downloaded project file.'); }
  if (saved == null) return null;
  try { return parseProject(saved); }
  catch (error) { throw new Error(`The saved edit could not be restored: ${error.message}`); }
}

export function clearAutosave(storage) {
  try { browserStorage(storage).removeItem(AUTOSAVE_KEY); }
  catch { throw new Error('The browser could not clear the saved edit.'); }
}
