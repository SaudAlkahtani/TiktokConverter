import { setupNavigation } from './navigation.js';

const $ = (selector) => document.querySelector(selector);
const source = $('#editor-source'), video = $('#editor-video'), canvas = $('#editor-canvas');
const stage = $('#preview-stage'), context = canvas.getContext('2d');
const voice = $('#voice-file'), voicePreview = $('#voice-preview'), pip = $('#pip-file'), pipPreview = $('#pip-preview');
const message = $('#editor-message'), regionsEl = $('#regions'), jobsEl = $('#editor-job-list');
const state = { regions: [], keepClear: null, tool: 'blur', drag: null, sourceUrl: null, voiceUrl: null, pipUrl: null, duration: 0 };
const number = (selector) => Number($(selector).value);
const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
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
  const width = video.videoWidth || 1, height = video.videoHeight || 1;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0, 0, width, height);
  const paint = (rect, color) => {
    context.fillStyle = color; context.strokeStyle = color.replace('0.25', '0.95'); context.lineWidth = Math.max(3, width / 400);
    context.fillRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
    context.strokeRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
  };
  for (const region of state.regions) if (region.start <= video.currentTime && region.end >= video.currentTime) paint(region, 'rgba(255,86,134,0.25)');
  if (state.keepClear) paint(state.keepClear, 'rgba(100,235,185,0.25)');
  if (state.drag) paint(rectBetween(state.drag.start, state.drag.end), state.tool === 'blur' ? 'rgba(255,86,134,0.25)' : 'rgba(100,235,185,0.25)');
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
source.addEventListener('change', () => {
  const file = source.files[0]; if (!file) return;
  state.duration = 0;
  setObject(file, video, 'sourceUrl'); video.load();
  $('#preview-placeholder').hidden = true; $('#source-details').textContent = file.name;
  state.regions = []; state.keepClear = null; renderRegions();
});
video.addEventListener('loadedmetadata', () => {
  state.duration = video.duration;
  const aspect = video.videoWidth / video.videoHeight;
  stage.style.width = `${Math.min(stage.parentElement.clientWidth - 36, Math.round(window.innerHeight * 0.75 * aspect))}px`;
  stage.style.minHeight = '0'; stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  $('#blur-end').placeholder = `End (${Math.floor(state.duration)}s)`;
  $('#pip-end').placeholder = `End (${Math.floor(state.duration)}s)`;
  redraw();
});
video.addEventListener('timeupdate', () => {
  $('#editor-time').textContent = `${clock(video.currentTime)} / ${clock(state.duration)}`;
  if (state.duration) $('#editor-scrub').value = String(Math.round(video.currentTime / state.duration * 1000));
  redraw(); syncPreviews();
});
$('#editor-play').addEventListener('click', () => video.paused ? video.play().catch(() => {}) : video.pause());
video.addEventListener('play', () => { $('#editor-play').textContent = 'Pause'; });
video.addEventListener('pause', () => { $('#editor-play').textContent = 'Play'; });
$('#editor-scrub').addEventListener('input', (event) => { if (state.duration) video.currentTime = state.duration * Number(event.target.value) / 1000; });
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
voice.addEventListener('change', () => setObject(voice.files[0], voicePreview, 'voiceUrl'));
pip.addEventListener('change', () => { setObject(pip.files[0], pipPreview, 'pipUrl'); syncPreviews(); });
for (const [id, output, suffix] of [['#original-volume','#original-level','%'],['#voice-volume','#voice-level','%'],['#pip-size','#pip-size-label','%']]) {
  $(id).addEventListener('input', () => { $(output).textContent = $(id).value + suffix; syncPreviews(); });
}
$('#pip-position').addEventListener('change', syncPreviews);
$('#pip-start').addEventListener('change', syncPreviews);
$('#pip-end').addEventListener('change', syncPreviews);
$('#voice-start').addEventListener('change', syncPreviews);
function syncPreviews() {
  video.volume = number('#original-volume') / 100;
  const voiceTime = video.currentTime - number('#voice-start');
  if (voice.files[0] && voiceTime >= 0 && voiceTime < voicePreview.duration) {
    voicePreview.volume = Math.min(1, number('#voice-volume') / 100);
    if (Math.abs(voicePreview.currentTime - voiceTime) > 0.4) voicePreview.currentTime = voiceTime;
    if (!video.paused) voicePreview.play().catch(() => {});
  } else voicePreview.pause();
  const pipTime = video.currentTime - number('#pip-start');
  const visible = pip.files[0] && pipTime >= 0 && video.currentTime <= ($('#pip-end').value ? number('#pip-end') : state.duration) && pipTime < pipPreview.duration;
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
  if (!source.files[0] || !Number.isFinite(state.duration) || !state.duration) { message.textContent = 'Choose a readable source video first.'; return; }
  const settings = {
    autoFaces: $('#auto-faces').checked, keepClear: state.keepClear, blurRegions: state.regions,
    voiceStart: number('#voice-start'), voiceVolume: number('#voice-volume') / 100,
    originalVolume: number('#original-volume') / 100,
    pipStart: number('#pip-start'), pipEnd: $('#pip-end').value ? number('#pip-end') : state.duration,
    pipWidth: number('#pip-size') / 100, pipPosition: $('#pip-position').value,
    destination: 'both', encoder: $('#editor-encoder').value
  };
  const form = new FormData(); form.append('source', source.files[0]);
  if (voice.files[0]) form.append('voice', voice.files[0]);
  if (pip.files[0]) form.append('pip', pip.files[0]);
  form.append('settings', JSON.stringify(settings));
  const button = $('#editor-submit'); button.disabled = true; message.textContent = 'Uploading source and edit assets…';
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
    detail.textContent = job.status === 'failed' ? job.error : `${job.progress || 0}% · ${job.media?.width || ''}${job.media ? '×' + job.media.height : ''}${job.media?.encoder ? ' · ' + job.media.encoder : ''}`;
    bottom.append(detail);
    if (job.downloadable) { const download = document.createElement('a'); download.className = 'download'; download.href = `/api/jobs/${job.id}/download`; download.textContent = job.platform === 'editor' ? 'Download edited master' : 'Download export'; bottom.append(download); }
    card.append(top, bar, bottom); jobsEl.append(card);
  }
}
setupNavigation({ nav: $('.platform-nav'), window, location, startStream: () => {
  const stream = new EventSource('/api/events'); stream.onmessage = ({ data }) => renderJobs(JSON.parse(data)); return stream;
} });
