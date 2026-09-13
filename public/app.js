const jobsEl = document.querySelector('#jobs');
const emptyEl = document.querySelector('#empty');
const template = document.querySelector('#job-template');
const profile = document.querySelector('#profile');
const form = document.querySelector('#upload-form');
const fileInput = document.querySelector('#video-file');
const fileLabel = document.querySelector('#file-label');
const uploadStatus = document.querySelector('#upload-status');
const encoderLabels = { cpu: 'CPU Quality', amd: 'AMD Fast', nvidia: 'NVIDIA Fast' };
const encoderHints = {
  cpu: 'CPU: high-quality HEVC, slow preset, CRF 18.',
  amd: 'AMD: HEVC quality preset, QP 18/20. GPU checked before export; 10-bit, odd dimensions or unavailable hardware fall back to CPU.',
  nvidia: 'NVIDIA: HEVC P6 / HQ, CQ 18. Supports RTX 4070 Ti and 10-bit output. GPU checked before export; unsupported files or unavailable hardware fall back to CPU.'
};
const encoderRadios = [...document.querySelectorAll('input[name="encoder"]')];
const selectedEncoder = () => encoderRadios.find(r => r.checked)?.value || 'cpu';
const updateEncoderHint = () => { document.querySelector('#encoder-hint').textContent = encoderHints[selectedEncoder()]; };
try {
  const saved = localStorage.getItem('video-encoder');
  const radio = encoderRadios.find(r => r.value === saved);
  if (radio) radio.checked = true;
} catch { /* Storage can be disabled; per-upload selection still works. */ }
updateEncoderHint();
encoderRadios.forEach(radio => radio.addEventListener('change', () => {
  updateEncoderHint();
  try { localStorage.setItem('video-encoder', selectedEncoder()); } catch { /* Optional preference. */ }
}));
const bytes = (n=0) => n < 1024 ** 2 ? `${Math.round(n/1024)} KB` : `${(n/1024**2).toFixed(1)} MB`;
const render = (jobs) => {
  jobsEl.replaceChildren(); emptyEl.hidden = jobs.length > 0;
  for (const job of jobs) {
    const node = template.content.cloneNode(true); const el = node.querySelector('.job');
    node.querySelector('h3').textContent = job.sourceName;
    const requested = job.options?.encoder || 'cpu';
    const actual = job.media?.encoder || job.encoder;
    const encoderText = actual ? `${encoderLabels[actual]}${actual !== requested ? ' (fallback)' : ''}` : `${encoderLabels[requested]}${job.status === 'processing' ? ' · checking compatibility' : ' selected'}`;
    node.querySelector('.metadata').textContent = `${bytes(job.bytes)} · ${encoderText} · queued ${new Date(job.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    const status = node.querySelector('.status'); status.textContent = job.status; status.classList.add(job.status);
    node.querySelector('.bar span').style.width = `${job.progress || 0}%`;
    const detail = node.querySelector('.detail');
    detail.textContent = job.status === 'failed' ? job.error : job.status === 'complete' ? `Finished · ${job.media.width}×${job.media.height} · ${bytes(job.media.bytes)} · HEVC · 60fps · ${job.media.timestampScale === 2 ? 'half speed' : 'normal speed'}` : job.status === 'processing' && job.progress === 99 ? 'Finalizing MP4…' : `${job.progress || 0}% ${job.status === 'processing' ? 'rendered' : 'waiting'}`;
    const warnings = node.querySelector('.warnings');
    const notices = job.media?.warnings || job.warnings || [];
    if (notices.length) { warnings.hidden = false; warnings.textContent = notices.join(' '); }
    const link = node.querySelector('.download'); if (job.downloadable) { link.hidden=false; link.href=`/api/jobs/${job.id}/download`; }
    jobsEl.append(node);
  }
};
fetch('/api/health').then(r=>r.json()).then((health)=>{ profile.textContent = `${health.profile.name}  |  CPU / AMD / NVIDIA  |  AAC ${health.profile.audioBitrate} stereo  |  up to ${(health.uploadLimitBytes / 1024 ** 3).toFixed(0)} GB per upload`; document.querySelector('#speed').value = String(health.profile.timestampScale); });
fileInput.addEventListener('change', () => { fileLabel.textContent = fileInput.files[0]?.name || 'Choose a video'; });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  const button = form.querySelector('button');
  button.disabled = true; uploadStatus.textContent = `Uploading ${file.name}…`;
  try {
    const settings = new URLSearchParams({ speed: document.querySelector('#speed').value, sharpen: String(document.querySelector('#sharpen').checked), encoder: selectedEncoder() });
    const response = await fetch(`/api/uploads?${settings}`, { method: 'POST', body: new FormData(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    uploadStatus.textContent = `${result.job.sourceName} · ${result.source.width}×${result.source.height} accepted. Output will keep these dimensions.`;
    form.reset(); fileLabel.textContent = 'Choose a video';
  } catch (error) { uploadStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
const stream = new EventSource('/api/events'); stream.onmessage = ({data}) => render(JSON.parse(data));
stream.onerror = () => { profile.textContent = 'Worker disconnected — make sure npm start is running.'; };
