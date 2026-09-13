const jobsEl = document.querySelector('#jobs');
const emptyEl = document.querySelector('#empty');
const template = document.querySelector('#job-template');
const profile = document.querySelector('#profile');
const form = document.querySelector('#upload-form');
const fileInput = document.querySelector('#video-file');
const fileLabel = document.querySelector('#file-label');
const uploadStatus = document.querySelector('#upload-status');
const bytes = (n=0) => n < 1024 ** 2 ? `${Math.round(n/1024)} KB` : `${(n/1024**2).toFixed(1)} MB`;
const render = (jobs) => {
  jobsEl.replaceChildren(); emptyEl.hidden = jobs.length > 0;
  for (const job of jobs) {
    const node = template.content.cloneNode(true); const el = node.querySelector('.job');
    node.querySelector('h3').textContent = job.sourceName;
    node.querySelector('.metadata').textContent = `${bytes(job.bytes)} · queued ${new Date(job.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    const status = node.querySelector('.status'); status.textContent = job.status; status.classList.add(job.status);
    node.querySelector('.bar span').style.width = `${job.progress || 0}%`;
    const detail = node.querySelector('.detail');
    detail.textContent = job.status === 'failed' ? job.error : job.status === 'complete' ? `Finished · ${job.media.width}×${job.media.height} · ${bytes(job.media.bytes)} · HEVC · 60fps · ${job.media.timestampScale === 2 ? 'half speed' : 'normal speed'}` : job.status === 'processing' && job.progress === 99 ? 'Finalizing MP4…' : `${job.progress || 0}% ${job.status === 'processing' ? 'rendered' : 'waiting'}`;
    const warnings = node.querySelector('.warnings');
    if (job.media?.warnings?.length) { warnings.hidden = false; warnings.textContent = job.media.warnings.join(' '); }
    const link = node.querySelector('.download'); if (job.downloadable) { link.hidden=false; link.href=`/api/jobs/${job.id}/download`; }
    jobsEl.append(node);
  }
};
fetch('/api/health').then(r=>r.json()).then((health)=>{ profile.textContent = `${health.profile.name}  |  High quality (CRF ${health.profile.crf})  |  AAC ${health.profile.audioBitrate} stereo  |  up to ${(health.uploadLimitBytes / 1024 ** 3).toFixed(0)} GB per upload`; document.querySelector('#speed').value = String(health.profile.timestampScale); });
fileInput.addEventListener('change', () => { fileLabel.textContent = fileInput.files[0]?.name || 'Choose a video'; });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  const button = form.querySelector('button');
  button.disabled = true; uploadStatus.textContent = `Uploading ${file.name}…`;
  try {
    const settings = new URLSearchParams({ speed: document.querySelector('#speed').value, sharpen: String(document.querySelector('#sharpen').checked) });
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
