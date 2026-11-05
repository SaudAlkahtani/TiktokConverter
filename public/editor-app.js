import { setupNavigation } from './navigation.js';
import { deleteTimelineTrack, linkTimelineSegment, locateTimelineTime, moveTimelineSegment, moveTimelineSegmentTo, restoreTimelineTrack, splitTimelineSegment, timelineDuration, timelineOffset, trimTimelineSegment, unlinkTimelineSegment } from './editor-timeline.js';

const $ = (selector) => document.querySelector(selector);
const source = $('#editor-source'), video = $('#editor-video'), sourceVideo = $('#source-video'), canvas = $('#editor-canvas');
const stage = $('#preview-stage'), context = canvas.getContext('2d');
const voice = $('#voice-file'), voicePreview = $('#voice-preview'), voiceMonitor = $('#voice-monitor'), pip = $('#pip-file'), pipPreview = $('#pip-preview');
const message = $('#editor-message'), regionsEl = $('#regions'), jobsEl = $('#editor-job-list');
const state = { regions: [], motionTitles: [], keepClear: null, tool: 'blur', drag: null, voiceUrl: null, pipUrl: null, duration: 0,
  sources: [], segments: [], selectedSegment: 0, selectedTrack: 'video', activeSegment: 0, activeSourceIndex: -1,
  projectTime: 0, seeking: false, pendingSourceTime: null, resumeAfterLoad: false, history: [], future: [] };
const number = (selector) => Number($(selector).value);
const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const timecode = (seconds) => `${clock(seconds)}:${String(Math.floor((seconds % 1) * 60)).padStart(2, '0')}`;
const snapshotTimeline = () => ({ segments: state.segments.map(segment => ({ ...segment })), selectedSegment: state.selectedSegment,
  selectedTrack: state.selectedTrack, projectTime: state.projectTime,
  regions: state.regions.map(region => ({ ...region })), keepClear: state.keepClear ? { ...state.keepClear } : null,
  motionTitles: state.motionTitles.map(title => ({...title})) });
function rememberTimeline() {
  state.history.push(snapshotTimeline());
  if (state.history.length > 100) state.history.shift();
  state.future = [];
}
function restoreSnapshot(snapshot) {
  video.pause();
  state.segments = snapshot.segments.map(segment => ({ ...segment }));
  state.selectedSegment = snapshot.selectedSegment; state.selectedTrack = snapshot.selectedTrack;
  state.regions = snapshot.regions.map(region => ({ ...region })); state.keepClear = snapshot.keepClear;
  state.motionTitles = (snapshot.motionTitles || []).map(title => ({...title}));
  renderRegions(); renderMotionTitles(); renderTimeline();
  if (state.segments.length) { $('#preview-placeholder').hidden = true; seekProject(Math.min(snapshot.projectTime, state.duration - 0.001)); }
  else { state.projectTime = 0; state.activeSegment = 0; state.activeSourceIndex = -1;
    video.removeAttribute('src'); video.load(); $('#preview-placeholder').hidden = false; updateTimelinePosition(); }
}
function undoTimeline() {
  if (!state.history.length) return;
  state.future.push(snapshotTimeline()); restoreSnapshot(state.history.pop());
  message.textContent = 'Reverted the last timeline edit.';
}
function redoTimeline() {
  if (!state.future.length) return;
  state.history.push(snapshotTimeline()); restoreSnapshot(state.future.pop());
  message.textContent = 'Restored the timeline edit.';
}
const setObject = (file, target, key) => {
  if (state[key]) URL.revokeObjectURL(state[key]);
  state[key] = file ? URL.createObjectURL(file) : null;
  target.src = state[key] || '';
};
const normalized = (event) => {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
};
const rectBetween = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
function redraw() {
  const base = state.sources[state.segments[0]?.sourceIndex] || state.sources[state.activeSourceIndex];
  const width = base?.width || video.videoWidth || 1, height = base?.height || video.videoHeight || 1;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0, 0, width, height);
  const paint = (rect, color) => {
    context.fillStyle = color; context.strokeStyle = color.replace('0.25', '0.95'); context.lineWidth = Math.max(3, width / 400);
    context.fillRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
    context.strokeRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
  };
  for (const region of state.regions) if (region.start <= state.projectTime && region.end >= state.projectTime) paint(region, 'rgba(255,86,134,0.25)');
  if (state.keepClear) paint(state.keepClear, 'rgba(100,235,185,0.25)');
  if (state.drag) paint(rectBetween(state.drag.start, state.drag.end), state.tool === 'blur' ? 'rgba(255,86,134,0.25)' : 'rgba(100,235,185,0.25)');
  updateMotionPreview();
}
function updateMotionPreview() {
  const preview = $('#motion-preview');
  const title = state.motionTitles.find(item => item.start <= state.projectTime && item.end > state.projectTime);
  preview.replaceChildren();
  preview.className = title?.position || '';
  if (!title) return;
  const label = document.createElement('span'); label.textContent = title.text;
  label.style.color = title.color;
  label.style.background = title.background ? 'rgba(0,0,0,.62)' : 'transparent';
  preview.append(label);
}
function renderMotionTitles() {
  const list = $('#motion-list'); list.replaceChildren();
  state.motionTitles.forEach((title, index) => {
    const row = document.createElement('div'); row.className = 'editor-region-row';
    const label = document.createElement('span'); label.textContent = `${title.text} · ${title.start.toFixed(2)}–${title.end.toFixed(2)}s`;
    const remove = document.createElement('button'); remove.className = 'queue-button'; remove.type = 'button'; remove.textContent = 'Remove';
    remove.onclick = () => { rememberTimeline(); state.motionTitles.splice(index, 1); renderMotionTitles(); };
    row.append(label, remove); list.append(row);
  });
  if (!state.motionTitles.length) list.textContent = 'No titles yet.';
  updateMotionPreview();
}
function renderRegions() {
  regionsEl.replaceChildren();
  for (const [index, region] of state.regions.entries()) {
    const row = document.createElement('div'); row.className = 'editor-region-row';
    const label = document.createElement('span'); label.textContent = `Blur ${index + 1} · ${clock(region.start)}–${clock(region.end)}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.className = 'queue-button';
    remove.onclick = () => { state.regions.splice(index, 1); renderRegions(); redraw(); };
    row.append(label, remove); regionsEl.append(row);
  }
  if (state.keepClear) {
    const row = document.createElement('div'); row.className = 'editor-region-row';
    const label = document.createElement('span'); label.textContent = 'Keep clear · protects your face from auto blur';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.className = 'queue-button';
    remove.onclick = () => { state.keepClear = null; renderRegions(); redraw(); };
    row.append(label, remove); regionsEl.append(row);
  }
  if (!regionsEl.childElementCount) regionsEl.textContent = 'No manual blur areas yet.';
}
function inspectSource(url) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement('video'); probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const result = { duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight };
      probe.removeAttribute('src'); probe.load();
      if (!Number.isFinite(result.duration) || result.duration <= 0 || !result.width || !result.height) reject(new Error('The browser could not read this video.'));
      else resolve(result);
    };
    probe.onerror = () => reject(new Error('The browser could not preview this video. Try an MP4 or MOV source.'));
    probe.src = url;
  });
}
function renderBin() {
  const list = $('#project-clips'), selector = $('#bin-source');
  list.replaceChildren(); selector.replaceChildren();
  state.sources.forEach((item, index) => {
    const option = document.createElement('option'); option.value = String(index); option.textContent = item.file.name; selector.append(option);
    const row = document.createElement('button'); row.type = 'button'; row.className = 'editor-source-item';
    const name = document.createElement('strong'); name.textContent = `${index + 1}. ${item.file.name}`;
    const detail = document.createElement('small'); detail.textContent = `${item.width}×${item.height} · ${timecode(item.duration)}`;
    row.append(name, detail);
    row.onclick = () => { selector.value = String(index); updateBinRange(); };
    list.append(row);
  });
  $('#source-details').textContent = state.sources.length ? `${state.sources.length} video${state.sources.length === 1 ? '' : 's'} imported` : 'No videos imported';
  $('#source-metadata').textContent = `${state.sources.length} sources`;
  $('#bin-add').disabled = !state.sources.length;
  $('#bin-add-all').disabled = !state.sources.length;
  if (state.sources.length) { selector.value = String(state.sources.length - 1); updateBinRange(); }
}
function updateBinRange() {
  const item = state.sources[Number($('#bin-source').value)];
  if (!item) return;
  $('#bin-in').value = '0';
  $('#bin-out').value = String(Number(item.duration.toFixed(4)));
  $('#bin-in').max = String(item.duration); $('#bin-out').max = String(item.duration);
  sourceVideo.pause(); sourceVideo.hidden = false; sourceVideo.src = item.url; sourceVideo.load();
  $('#source-placeholder').hidden = true;
}
function addClips(clips) {
  if (!clips.length) return;
  rememberTimeline();
  state.segments.push(...clips);
  state.selectedSegment = state.segments.length - clips.length; state.selectedTrack = 'video';
  renderTimeline(); seekProject(timelineOffset(state.segments, state.selectedSegment));
  $('#preview-placeholder').hidden = true;
  message.textContent = `Added ${clips.length} clip${clips.length === 1 ? '' : 's'} to the merged timeline.`;
}
function updateTimelinePosition() {
  const duration = timelineDuration(state.segments);
  $('#editor-time').textContent = `${timecode(state.projectTime)} / ${timecode(duration)}`;
  $('#editor-scrub').value = duration ? String(Math.round(state.projectTime / duration * 1000)) : '0';
  $('#timeline-playhead').style.left = `${duration ? state.projectTime / duration * 100 : 0}%`;
}
function seekProject(seconds) {
  const point = locateTimelineTime(state.segments, seconds);
  if (!point) return;
  state.activeSegment = point.index;
  state.projectTime = point.projectTime;
  const segment = state.segments[point.index], item = state.sources[segment.sourceIndex];
  const target = Math.min(point.sourceTime, Math.max(0, item.duration - 0.001));
  if (state.activeSourceIndex !== segment.sourceIndex) {
    state.resumeAfterLoad = !video.paused;
    state.activeSourceIndex = segment.sourceIndex;
    state.pendingSourceTime = target;
    state.seeking = true;
    video.src = item.url; video.load();
  } else {
    state.seeking = Math.abs(video.currentTime - target) >= 0.0005;
    if (state.seeking) video.currentTime = target;
  }
  updateTimelinePosition();
  redraw(); syncPreviews();
}
function renderTrack(id, label, start, end) {
  const track = $(id); track.replaceChildren();
  if (!state.segments.length || end <= start) return;
  const total = timelineDuration(state.segments), from = Math.max(0, start), to = Math.min(total, end);
  if (to <= from) return;
  const block = document.createElement('span'); block.className = 'track-asset-block'; block.textContent = label;
  block.style.left = `${from / total * 100}%`; block.style.width = `${(to - from) / total * 100}%`;
  track.append(block);
}
function updateSelectedTrim() {
  const segment = state.segments[state.selectedSegment];
  const enabled = Boolean(segment);
  for (const id of ['#clip-in', '#clip-out', '#clip-apply']) $(id).disabled = !enabled;
  $('#clip-in').value = enabled ? String(segment.start) : '';
  $('#clip-out').value = enabled ? String(segment.end) : '';
  if (enabled) {
    const duration = state.sources[segment.sourceIndex].duration;
    $('#clip-in').max = String(duration); $('#clip-out').max = String(duration);
  }
}
function renderTimeline() {
  const total = timelineDuration(state.segments), clips = $('#timeline-clips');
  const width = Math.ceil(Math.max(700, total * number('#timeline-zoom'), state.segments.length * 36));
  $('#timeline-board').style.setProperty('--timeline-width', `${width}px`);
  const offsets = [];
  for (let index = 0, position = 0; index < state.segments.length; index++) {
    offsets.push(position);
    position += state.segments[index].end - state.segments[index].start;
  }
  state.duration = total;
  state.projectTime = Math.min(state.projectTime, total);
  if (total) {
    const count = state.regions.length;
    state.regions = state.regions.filter(region => region.start < total).map(region => ({ ...region, end: Math.min(region.end, total) }));
    if (count !== state.regions.length) renderRegions();
    for (const selector of ['#blur-start','#voice-start','#pip-start']) if (number(selector) > total) $(selector).value = String(total);
    for (const selector of ['#blur-end','#pip-end']) if ($(selector).value && number(selector) > total) $(selector).value = String(total);
  } else {
    state.regions = []; renderRegions();
  }
  $('#blur-end').placeholder = `End (${Math.floor(total)}s)`;
  $('#pip-end').placeholder = `End (${Math.floor(total)}s)`;
  clips.replaceChildren();
  const camera = $('#timeline-camera'); camera.replaceChildren();
  const ruler = $('#timeline-ruler'); ruler.replaceChildren();
  if (total) {
    const rawStep = 120 * total / width;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= rawStep) || magnitude * 10;
    for (let tick = 0; tick <= Math.ceil(total / step); tick++) {
      const position = tick * step;
      if (position > total) break;
      const mark = document.createElement('span'); mark.className = 'ruler-tick';
      mark.style.left = `${position / total * 100}%`; mark.textContent = clock(position);
      ruler.append(mark);
    }
  }
  state.segments.forEach((segment, index) => {
    const sourceName = state.sources[segment.sourceIndex]?.file.name || 'Source video';
    for (const [track, container] of [['video', clips], ['audio', camera]]) {
      const enabled = track === 'video' ? segment.videoEnabled !== false : segment.audioEnabled !== false;
      const active = index === state.selectedSegment && (segment.linked !== false || state.selectedTrack === track);
      const clip = document.createElement('button'); clip.type = 'button';
      clip.className = `timeline-clip${track === 'audio' ? ' timeline-audio-clip' : ''}${active ? ' selected' : ''}${segment.linked !== false ? ' paired' : ''}${enabled ? '' : ' missing'}`;
      clip.style.flexGrow = String(segment.end - segment.start); clip.style.flexBasis = '0';
      clip.title = `${track === 'video' ? 'Video' : 'Camera audio'} clip ${index + 1}: ${enabled ? sourceName : 'removed'}, ${timecode(segment.start)} to ${timecode(segment.end)}${segment.linked === false ? ', unlinked' : ', linked'}`;
      clip.setAttribute('aria-label', clip.title);
      const name = document.createElement('strong'); name.textContent = enabled ? (track === 'audio' ? `♫ ${sourceName}` : sourceName) : `${track === 'audio' ? 'Audio' : 'Video'} removed`;
      const times = document.createElement('small'); times.textContent = `${segment.linked === false ? 'Unlinked' : 'Linked'} · ${timecode(segment.start)}–${timecode(segment.end)}`;
      clip.append(name, times);
      clip.draggable = true;
      clip.addEventListener('dragstart', event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-gym-editor-clip', String(index)); });
      clip.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
      clip.addEventListener('drop', event => {
        event.preventDefault();
        const dragged = event.dataTransfer.getData('application/x-gym-editor-clip');
        if (!dragged) return;
        const from = Number(dragged);
        const next = moveTimelineSegmentTo(state.segments, from, index);
        if (!next || from === index) return;
        rememberTimeline(); video.pause(); state.segments = next; state.selectedSegment = index; state.selectedTrack = track;
        renderTimeline(); seekProject(timelineOffset(next, index));
      });
      clip.onclick = event => {
        video.pause(); state.selectedSegment = index; state.selectedTrack = track;
        const rect = clip.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(0.999, (event.clientX - rect.left) / rect.width));
        seekProject(offsets[index] + fraction * (segment.end - segment.start)); renderTimeline();
      };
      container.append(clip);
    }
  });
  const voiceLength = number('#voice-out') || voiceMonitor.duration || state.duration;
  renderTrack('#timeline-voice', 'Voice', voice.files[0] ? number('#voice-start') : state.duration,
    voice.files[0] ? Math.min(state.duration, number('#voice-start') + Math.max(0, voiceLength - number('#voice-in'))) : state.duration);
  renderTrack('#timeline-pip', 'Overlay', pip.files[0] ? number('#pip-start') : state.duration,
    $('#pip-end').value ? number('#pip-end') : state.duration);
  $('#timeline-summary').textContent = total ? `${state.sources.length} source${state.sources.length === 1 ? '' : 's'} · ${state.segments.length} clips · ${timecode(total)} sequence` : 'Import videos, then add ranges to the timeline';
  $('#timeline-split').disabled = !total;
  $('#timeline-remove').disabled = !total;
  const selected = state.segments[state.selectedSegment];
  $('#timeline-unlink').disabled = !selected || selected.linked === false;
  $('#timeline-link').disabled = !selected || selected.linked !== false || selected.videoEnabled === false || selected.audioEnabled === false;
  $('#timeline-restore-track').disabled = !selected || (state.selectedTrack === 'video' ? selected.videoEnabled !== false : selected.audioEnabled !== false);
  $('#timeline-undo').disabled = !state.history.length;
  $('#timeline-redo').disabled = !state.future.length;
  $('#timeline-left').disabled = state.selectedSegment <= 0;
  $('#timeline-right').disabled = state.selectedSegment >= state.segments.length - 1;
  $('#timeline-restore').disabled = !total;
  $('#bin-add').disabled = !state.sources.length;
  $('#bin-add-all').disabled = !state.sources.length;
  updateSelectedTrim();
  updateTimelinePosition();
}
function refreshPlayback() {
  if (!state.segments.length || state.seeking) return;
  const segment = state.segments[state.activeSegment];
  if (video.currentTime >= segment.end - 1 / 120) {
    if (!video.paused && state.activeSegment < state.segments.length - 1) {
      seekProject(timelineOffset(state.segments, state.activeSegment + 1));
      return;
    }
    state.projectTime = timelineDuration(state.segments);
    if (!video.paused) video.pause();
  } else if (video.currentTime >= segment.start - 0.05) {
    state.projectTime = timelineOffset(state.segments, state.activeSegment) + Math.max(0, video.currentTime - segment.start);
  }
  updateTimelinePosition(); redraw(); syncPreviews();
}
function monitorFrames() {
  if (video.paused) return;
  refreshPlayback();
  if (!video.paused && video.requestVideoFrameCallback) video.requestVideoFrameCallback(monitorFrames);
}
source.addEventListener('change', async () => {
  const files = [...source.files]; source.value = '';
  if (!files.length) return;
  message.textContent = `Reading ${files.length} video${files.length === 1 ? '' : 's'}…`;
  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const details = await inspectSource(url);
      state.sources.push({ file, url, ...details });
    } catch (error) {
      URL.revokeObjectURL(url);
      message.textContent = `${file.name}: ${error.message}`;
    }
  }
  renderBin(); renderTimeline();
  if (state.sources.length) message.textContent = `${state.sources.length} videos ready. Add full videos or choose any In/Out range.`;
});
$('#bin-source').addEventListener('change', updateBinRange);
$('#bin-add').onclick = () => {
  const sourceIndex = Number($('#bin-source').value), item = state.sources[sourceIndex];
  if (!item) return;
  const start = number('#bin-in'), end = number('#bin-out');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > item.duration + .05 || end - start < .08) {
    message.textContent = 'Choose a valid In/Out range of at least 0.08 seconds within the selected source.'; return;
  }
  addClips([{ sourceIndex, start: Number(start.toFixed(4)), end: Number(Math.min(end, item.duration).toFixed(4)), videoEnabled: true, audioEnabled: true, linked: true }]);
};
$('#bin-add-all').onclick = () => {
  const clips = state.sources.flatMap((item, sourceIndex) => item.duration >= .08
    ? [{ sourceIndex, start: 0, end: Number(item.duration.toFixed(4)), videoEnabled: true, audioEnabled: true, linked: true }] : []);
  if (!clips.length) { message.textContent = 'Import a video that is at least 0.08 seconds long.'; return; }
  addClips(clips);
};
$('#source-mark-in').onclick = () => { if (state.sources.length) $('#bin-in').value = String(Number(sourceVideo.currentTime.toFixed(4))); };
$('#source-mark-out').onclick = () => { if (state.sources.length) $('#bin-out').value = String(Number(sourceVideo.currentTime.toFixed(4))); };
video.addEventListener('loadedmetadata', () => {
  const first = state.sources[state.segments[0]?.sourceIndex] || state.sources[state.activeSourceIndex];
  const aspect = first ? first.width / first.height : video.videoWidth / video.videoHeight;
  stage.style.width = `${Math.min(stage.parentElement.clientWidth - 36, Math.round(window.innerHeight * 0.75 * aspect))}px`;
  stage.style.minHeight = '0'; stage.style.aspectRatio = first ? `${first.width} / ${first.height}` : `${video.videoWidth} / ${video.videoHeight}`;
  if (state.pendingSourceTime !== null) {
    const target = state.pendingSourceTime; state.pendingSourceTime = null;
    if (Math.abs(video.currentTime - target) >= .0005) video.currentTime = target;
    else { state.seeking = false; refreshPlayback(); if (state.resumeAfterLoad) { state.resumeAfterLoad = false; video.play().catch(() => {}); } }
  }
  redraw();
});
video.addEventListener('timeupdate', refreshPlayback);
video.addEventListener('seeked', () => {
  state.seeking = false; refreshPlayback();
  if (state.resumeAfterLoad) { state.resumeAfterLoad = false; video.play().catch(() => {}); }
});
$('#editor-play').addEventListener('click', () => {
  if (!state.segments.length) return;
  if (!video.paused) { video.pause(); return; }
  if (state.projectTime >= timelineDuration(state.segments) - 0.02) seekProject(0);
  video.play().catch(() => {});
});
video.addEventListener('play', () => { $('#editor-play').textContent = 'Pause'; if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(monitorFrames); });
video.addEventListener('pause', () => { $('#editor-play').textContent = 'Play'; });
$('#editor-scrub').addEventListener('input', (event) => { if (state.segments.length) seekProject(timelineDuration(state.segments) * Number(event.target.value) / 1000); });
$('#timeline-zoom').addEventListener('input', renderTimeline);
for (const [selector, direction] of [['#editor-step-back',-1],['#editor-step-forward',1]]) $(selector).onclick = () => {
  if (!state.segments.length) return;
  video.pause(); seekProject(state.projectTime + direction / 60);
};
$('#timeline-ruler').addEventListener('click', (event) => {
  if (!state.segments.length) return;
  video.pause();
  const rect = event.currentTarget.getBoundingClientRect();
  seekProject(timelineDuration(state.segments) * Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
});
$('#timeline-split').onclick = () => {
  if (!state.segments.length) return;
  video.pause();
  const point = locateTimelineTime(state.segments, state.projectTime);
  const next = splitTimelineSegment(state.segments, point.index, point.sourceTime);
  if (!next) { message.textContent = 'Move the playhead at least 0.08 seconds inside a clip before splitting.'; return; }
  rememberTimeline();
  state.segments = next; state.selectedSegment = point.index + 1;
  seekProject(state.projectTime); renderTimeline(); message.textContent = `Split created. ${next.length} clips on the timeline.`;
};
$('#timeline-remove').onclick = () => {
  const selected = state.segments[state.selectedSegment];
  const next = deleteTimelineTrack(state.segments, state.selectedSegment, state.selectedTrack);
  if (!next) { message.textContent = 'That track is already empty.'; return; }
  rememberTimeline();
  video.pause(); state.segments = next; state.selectedSegment = Math.min(state.selectedSegment, next.length - 1);
  if (next.length) seekProject(Math.min(state.projectTime, timelineDuration(next) - 0.01));
  else { state.projectTime = 0; state.activeSegment = 0; state.activeSourceIndex = -1;
    video.removeAttribute('src'); video.load(); $('#preview-placeholder').hidden = false; }
  renderTimeline();
  message.textContent = selected.linked === false && next.length === state.history.at(-1).segments.length
    ? `Removed only the selected ${state.selectedTrack} track. The other track remains.`
    : `Removed the timeline clip. ${next.length} clips remain.`;
};
$('#timeline-unlink').onclick = () => {
  const next = unlinkTimelineSegment(state.segments, state.selectedSegment);
  if (!next) return;
  rememberTimeline(); state.segments = next; renderTimeline(); message.textContent = 'Video and camera audio unlinked. Select either row, then Delete removes only that row.';
};
$('#timeline-link').onclick = () => {
  const next = linkTimelineSegment(state.segments, state.selectedSegment);
  if (!next) { message.textContent = 'Restore both video and audio before linking them.'; return; }
  rememberTimeline(); state.segments = next; renderTimeline(); message.textContent = 'Video and camera audio linked.';
};
$('#timeline-restore-track').onclick = () => {
  const next = restoreTimelineTrack(state.segments, state.selectedSegment, state.selectedTrack);
  if (!next) return;
  rememberTimeline(); state.segments = next; renderTimeline(); syncPreviews();
  message.textContent = `Restored the selected ${state.selectedTrack} from its source file.`;
};
$('#timeline-undo').onclick = undoTimeline;
$('#timeline-redo').onclick = redoTimeline;
for (const [selector, direction] of [['#timeline-left',-1],['#timeline-right',1]]) $(selector).onclick = () => {
  const next = moveTimelineSegment(state.segments, state.selectedSegment, direction);
  if (!next) return;
  rememberTimeline();
  video.pause(); state.segments = next; state.selectedSegment += direction;
  seekProject(timelineOffset(next, state.selectedSegment)); renderTimeline();
};
$('#clip-apply').onclick = () => {
  const segment = state.segments[state.selectedSegment];
  if (!segment) return;
  const duration = state.sources[segment.sourceIndex].duration;
  const next = trimTimelineSegment(state.segments, state.selectedSegment, number('#clip-in'), number('#clip-out'), duration);
  if (!next) { message.textContent = 'Set In and Out within the source video, with at least 0.08 seconds between them.'; return; }
  rememberTimeline();
  video.pause(); state.segments = next;
  renderTimeline(); seekProject(timelineOffset(next, state.selectedSegment));
  message.textContent = 'Selected clip trimmed. The source video is unchanged.';
};
$('#timeline-restore').onclick = () => {
  if (!state.segments.length) return;
  rememberTimeline();
  video.pause(); state.segments = []; state.selectedSegment = 0; state.activeSegment = 0; state.projectTime = 0;
  state.activeSourceIndex = -1; video.removeAttribute('src'); video.load();
  $('#preview-placeholder').hidden = false;
  renderTimeline(); message.textContent = 'Timeline cleared. Imported videos remain in the project bin.';
};
document.addEventListener('keydown', (event) => {
  if (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable]')) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'z') {
    event.preventDefault(); if (event.shiftKey) redoTimeline(); else undoTimeline(); return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.shiftKey && key === 'r' && !$('#timeline-split').disabled) { event.preventDefault(); $('#timeline-split').click(); return; }
  if (event.shiftKey && key === 'g' && !$('#timeline-unlink').disabled) { event.preventDefault(); $('#timeline-unlink').click(); return; }
  if (event.shiftKey && key === 'l' && !$('#timeline-link').disabled) { event.preventDefault(); $('#timeline-link').click(); return; }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !$('#timeline-remove').disabled) { event.preventDefault(); $('#timeline-remove').click(); return; }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seekProject(state.projectTime + (event.key === 'ArrowLeft' ? -1 : 1) / 60); return; }
  if (event.code === 'Space' && state.segments.length) { event.preventDefault(); $('#editor-play').click(); }
});
for (const [button, tool] of [['#mark-blur','blur'],['#mark-clear','clear']]) $(button).onclick = () => {
  state.tool = tool; $('#mark-blur').classList.toggle('selected', tool === 'blur'); $('#mark-clear').classList.toggle('selected', tool === 'clear');
};
canvas.addEventListener('pointerdown', (event) => {
  if (!state.duration) return;
  video.pause(); canvas.setPointerCapture(event.pointerId);
  const point = normalized(event); state.drag = { start: point, end: point }; redraw();
});
canvas.addEventListener('pointermove', (event) => { if (!state.drag) return; state.drag.end = normalized(event); redraw(); });
canvas.addEventListener('pointerup', (event) => {
  if (!state.drag) return;
  const rect = rectBetween(state.drag.start, normalized(event)); state.drag = null;
  if (rect.w < 0.01 || rect.h < 0.01) { redraw(); return; }
  if (state.tool === 'clear') state.keepClear = rect;
  else {
    const start = number('#blur-start'), end = $('#blur-end').value ? number('#blur-end') : state.duration;
    if (start < 0 || end <= start || end > state.duration + 0.1) { message.textContent = 'Choose a valid blur time range.'; redraw(); return; }
    if (state.regions.length >= 20) { message.textContent = 'Maximum 20 blur areas.'; redraw(); return; }
    state.regions.push({ ...rect, start, end });
  }
  renderRegions(); redraw();
});
voice.addEventListener('change', () => {
  setObject(voice.files[0], voicePreview, 'voiceUrl');
  voiceMonitor.src = state.voiceUrl || ''; voiceMonitor.hidden = !voice.files[0];
  $('#voice-in').value = '0'; $('#voice-out').value = '';
  renderTimeline();
});
$('#voice-mark-in').onclick = () => { if (voice.files[0]) { $('#voice-in').value = String(Number(voiceMonitor.currentTime.toFixed(4))); renderTimeline(); } };
$('#voice-mark-out').onclick = () => { if (voice.files[0]) { $('#voice-out').value = String(Number(voiceMonitor.currentTime.toFixed(4))); renderTimeline(); } };
voiceMonitor.addEventListener('loadedmetadata', renderTimeline);
$('#voice-in').addEventListener('change', renderTimeline);
$('#voice-out').addEventListener('change', renderTimeline);
pip.addEventListener('change', () => { setObject(pip.files[0], pipPreview, 'pipUrl'); syncPreviews(); renderTimeline(); });
for (const [id, output, suffix] of [['#original-volume','#original-level','%'],['#voice-volume','#voice-level','%'],['#pip-size','#pip-size-label','%']]) {
  $(id).addEventListener('input', () => { $(output).textContent = $(id).value + suffix; syncPreviews(); });
}
$('#pip-position').addEventListener('change', syncPreviews);
$('#pip-start').addEventListener('change', () => { syncPreviews(); renderTimeline(); });
$('#pip-end').addEventListener('change', () => { syncPreviews(); renderTimeline(); });
$('#voice-start').addEventListener('change', () => { syncPreviews(); renderTimeline(); });
$('#motion-add').onclick = () => {
  const text = $('#motion-text').value.trim(), start = number('#motion-start'), end = number('#motion-end');
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > state.duration + 0.1) {
    message.textContent = 'Enter title text and a valid time range inside the timeline.'; return;
  }
  if (state.motionTitles.length >= 30) { message.textContent = 'The edit can hold up to 30 motion titles.'; return; }
  rememberTimeline();
  state.motionTitles.push({text, start, end, position: $('#motion-position').value,
    color: $('#motion-color').value, background: $('#motion-background').checked, fontSize: 72});
  renderMotionTitles(); message.textContent = 'Motion title added to the sequence.';
};
function editSettings(remap) {
  return {
    autoFaces: $('#auto-faces').checked, keepClear: state.keepClear, blurRegions: state.regions,
    segments: state.segments.map(segment => ({ ...segment, sourceIndex: remap ? remap.get(segment.sourceIndex) : segment.sourceIndex })),
    voiceStart: number('#voice-start'), voiceIn: number('#voice-in'), voiceOut: $('#voice-out').value ? number('#voice-out') : null,
    voiceVolume: number('#voice-volume') / 100, originalVolume: number('#original-volume') / 100,
    pipStart: number('#pip-start'), pipEnd: $('#pip-end').value ? number('#pip-end') : state.duration,
    pipWidth: number('#pip-size') / 100, pipPosition: $('#pip-position').value,
    motionTitles: state.motionTitles, destination: 'both', encoder: $('#editor-encoder').value
  };
}
function currentPlan() {
  return {version: 1, sources: state.sources.map(item => item.file.name),
    voice: voice.files[0]?.name || null, pip: pip.files[0]?.name || null, settings: editSettings()};
}
$('#plan-generate').onclick = () => { $('#editor-plan').value = JSON.stringify(currentPlan(), null, 2); message.textContent = 'Edit plan ready. You can change the JSON and apply it.'; };
$('#plan-download').onclick = () => {
  const data = $('#editor-plan').value || JSON.stringify(currentPlan(), null, 2);
  try { JSON.parse(data); } catch { message.textContent = 'Fix the JSON before downloading the plan.'; return; }
  const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'gym-edit-plan.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#plan-apply').onclick = () => {
  try {
    const plan = JSON.parse($('#editor-plan').value);
    if (plan.version !== 1 || !Array.isArray(plan.sources) || plan.sources.length !== state.sources.length ||
      plan.sources.some((name, index) => name !== state.sources[index].file.name))
      throw new Error('Import the source videos listed in this plan, in the same order, before applying it.');
    const settings = plan.settings;
    if (!settings || !Array.isArray(settings.segments) || !settings.segments.length ||
      settings.segments.some(segment => !Number.isInteger(segment.sourceIndex) || !state.sources[segment.sourceIndex] ||
        !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 ||
        segment.end <= segment.start || segment.end > state.sources[segment.sourceIndex].duration + 0.1))
      throw new Error('The plan contains an invalid timeline clip.');
    if (!Array.isArray(settings.blurRegions) || !Array.isArray(settings.motionTitles || []) ||
      (settings.motionTitles || []).some(title => !title || typeof title.text !== 'string' ||
        !Number.isFinite(title.start) || !Number.isFinite(title.end) || title.end <= title.start ||
        title.end > timelineDuration(settings.segments) + 0.1))
      throw new Error('The plan needs valid blur and title lists.');
    rememberTimeline(); video.pause();
    state.segments = settings.segments.map(segment => ({...segment}));
    state.regions = settings.blurRegions.map(region => ({...region}));
    state.keepClear = settings.keepClear || null;
    state.motionTitles = (settings.motionTitles || []).map(title => ({...title}));
    state.selectedSegment = 0; state.selectedTrack = 'video';
    $('#auto-faces').checked = settings.autoFaces === true;
    for (const [id, value] of [['#voice-start',settings.voiceStart],['#voice-in',settings.voiceIn],['#voice-out',settings.voiceOut],
      ['#voice-volume',settings.voiceVolume == null ? null : settings.voiceVolume * 100],
      ['#original-volume',settings.originalVolume == null ? null : settings.originalVolume * 100],
      ['#pip-start',settings.pipStart],['#pip-end',settings.pipEnd],['#pip-size',settings.pipWidth == null ? null : settings.pipWidth * 100],
      ['#pip-position',settings.pipPosition],['#editor-encoder',settings.encoder]]) {
      $(id).value = value == null ? '' : String(value);
    }
    $('#original-level').textContent = `${$('#original-volume').value}%`;
    $('#voice-level').textContent = `${$('#voice-volume').value}%`;
    $('#pip-size-label').textContent = `${$('#pip-size').value}%`;
    renderRegions(); renderMotionTitles(); renderTimeline(); seekProject(0);
    message.textContent = 'Edit plan applied. Review the sequence and export when ready.';
  } catch (error) { message.textContent = error.message; }
};
function syncPreviews() {
  const active = state.segments[state.activeSegment];
  video.style.visibility = active?.videoEnabled === false ? 'hidden' : 'visible';
  video.muted = active?.audioEnabled === false;
  video.volume = number('#original-volume') / 100;
  const voiceTime = state.projectTime - number('#voice-start') + number('#voice-in');
  const voiceOut = $('#voice-out').value ? number('#voice-out') : voicePreview.duration;
  if (voice.files[0] && voiceTime >= number('#voice-in') && voiceTime < Math.min(voiceOut, voicePreview.duration)) {
    voicePreview.volume = Math.min(1, number('#voice-volume') / 100);
    if (Math.abs(voicePreview.currentTime - voiceTime) > 0.4) voicePreview.currentTime = voiceTime;
    if (!video.paused) voicePreview.play().catch(() => {});
  } else voicePreview.pause();
  const pipTime = state.projectTime - number('#pip-start');
  const visible = pip.files[0] && pipTime >= 0 && state.projectTime <= ($('#pip-end').value ? number('#pip-end') : state.duration) && pipTime < pipPreview.duration;
  pipPreview.hidden = !visible;
  if (visible) {
    pipPreview.style.width = `${$('#pip-size').value}%`;
    const pos = $('#pip-position').value;
    pipPreview.style.left = pos.endsWith('left') ? '2.5%' : 'auto'; pipPreview.style.right = pos.endsWith('right') ? '2.5%' : 'auto';
    pipPreview.style.top = pos.startsWith('top') ? '2.5%' : 'auto'; pipPreview.style.bottom = pos.startsWith('bottom') ? '2.5%' : 'auto';
    if (Math.abs(pipPreview.currentTime - pipTime) > 0.4) pipPreview.currentTime = pipTime;
    if (!video.paused) pipPreview.play().catch(() => {});
  } else pipPreview.pause();
}
video.addEventListener('play', syncPreviews);
video.addEventListener('pause', () => { voicePreview.pause(); pipPreview.pause(); });
$('#editor-submit').addEventListener('click', async () => {
  if (!state.sources.length || !state.segments.length || !Number.isFinite(state.duration) || !state.duration) { message.textContent = 'Add at least one source range to the timeline first.'; return; }
  const usedSources = [...new Set(state.segments.map(segment => segment.sourceIndex))];
  const uploadIndex = new Map(usedSources.map((sourceIndex, index) => [sourceIndex, index]));
  const settings = editSettings(uploadIndex);
  const form = new FormData();
  for (const index of usedSources) { const item = state.sources[index]; form.append('source', item.file, item.file.name); }
  if (voice.files[0]) form.append('voice', voice.files[0]);
  if (pip.files[0]) form.append('pip', pip.files[0]);
  form.append('settings', JSON.stringify(settings));
  const button = $('#editor-submit'); button.disabled = true; message.textContent = `Uploading ${usedSources.length} used source videos and edit assets…`;
  try {
    const response = await fetch('/api/editor/jobs', { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not queue the edit.');
    message.textContent = `Edit #${data.id.slice(0,8)} queued. Its platform exports will follow in the same processing list.`;
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});
fetch('/api/editor/encoders').then((response) => response.json()).then((available) => {
  $('#encoder-status').textContent = `Available: CPU${available.nvidia ? ' · NVIDIA NVENC' : ''}${available.amd ? ' · AMD AMF' : ''}. Auto chooses the first working hardware encoder.`;
  $('#editor-encoder').querySelector('[value="nvidia"]').disabled = !available.nvidia;
  $('#editor-encoder').querySelector('[value="amd"]').disabled = !available.amd;
  if (!available.faceDetection) {
    $('#auto-faces').checked = false;
    $('#face-status').textContent = 'Install Python, OpenCV and NumPy to enable automatic face detection on this machine. Manual blur areas still work.';
  }
}).catch(() => { $('#encoder-status').textContent = 'Hardware detection unavailable. CPU encoding remains available.'; });
function renderJobs(allJobs) {
  const jobs = allJobs.filter((job) => job.origin === 'editor');
  $('#editor-empty').hidden = jobs.length > 0; jobsEl.replaceChildren();
  for (const job of jobs) {
    const card = document.createElement('article'); card.className = 'job';
    const top = document.createElement('div'); top.className = 'job-top';
    const name = document.createElement('h3'); name.textContent = `${job.platform === 'editor' ? 'Edited master' : job.platform === 'tiktok' ? 'TikTok export' : 'Instagram export'} · ${job.sourceName}`;
    const status = document.createElement('span'); status.className = `status ${job.status}`; status.textContent = job.status;
    top.append(name, status);
    const bar = document.createElement('div'); bar.className = 'bar'; const fill = document.createElement('span'); fill.style.width = `${job.progress || 0}%`; bar.append(fill);
    const bottom = document.createElement('div'); bottom.className = 'job-bottom';
    const detail = document.createElement('span'); detail.className = 'detail';
    const color = job.media?.colorCheck === 'untagged-sdr-assumed' ? 'source color untagged; Rec.709 assumed'
      : job.media?.colorCheck === 'hdr-bt2020' ? 'HDR mapped to Rec.709' : job.media ? 'Rec.709 tags checked' : '';
    detail.textContent = job.status === 'failed' ? job.error : `${job.progress || 0}% · ${job.media?.width || ''}${job.media ? '×' + job.media.height : ''}${job.media?.encoder ? ' · ' + job.media.encoder : ''}${color ? ' · ' + color : ''}`;
    bottom.append(detail);
    if (job.downloadable) { const download = document.createElement('a'); download.className = 'download'; download.href = `/api/jobs/${job.id}/download`; download.textContent = job.platform === 'editor' ? 'Download edited master' : 'Download export'; bottom.append(download); }
    card.append(top, bar, bottom); jobsEl.append(card);
  }
}
setupNavigation({ nav: $('.platform-nav'), window, location, startStream: () => {
  const stream = new EventSource('/api/events'); stream.onmessage = ({ data }) => renderJobs(JSON.parse(data)); return stream;
} });
