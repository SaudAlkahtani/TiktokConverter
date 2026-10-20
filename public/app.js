import { setupNavigation } from '/navigation.js';
const platform = location.pathname.startsWith('/both') ? 'both' : location.pathname.startsWith('/instagram') ? 'instagram' : 'tiktok';
const jobsEl = document.querySelector('#jobs');
const emptyEl = document.querySelector('#empty');
const template = document.querySelector('#job-template');
const profile = document.querySelector('#profile');
const form = document.querySelector('#upload-form');
const fileInput = document.querySelector('#video-file');
const fileLabel = document.querySelector('#file-label');
const uploadStatus = document.querySelector('#upload-status');
const clearActiveButton = document.querySelector('#clear-active');
const clearCompletedButton = document.querySelector('#clear-completed');
const bytes = (n=0) => n < 1024 ** 2 ? `${Math.round(n/1024)} KB` : `${(n/1024**2).toFixed(1)} MB`;
const render = (jobs) => {
  jobs = jobs.filter(job => platform === "both" ? job.origin === "both" : (job.platform || "tiktok") === platform);
  jobsEl.replaceChildren(); emptyEl.hidden = jobs.length > 0;
  for (const job of jobs) {
    const node = template.content.cloneNode(true); const el = node.querySelector('.job');
    node.querySelector('h3').textContent = `${job.platform === 'instagram' ? 'Instagram' : 'TikTok'} · ${job.sourceName}`;
    node.querySelector('.metadata').textContent = `${bytes(job.bytes)} · queued ${new Date(job.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    const status = node.querySelector('.status'); status.textContent = job.status; status.classList.add(job.status);
    node.querySelector('.bar span').style.width = `${job.progress || 0}%`;
    const detail = node.querySelector('.detail');
    detail.textContent = job.status === 'failed' ? job.error : job.status === 'complete' ? `Finished · ${bytes(job.media?.bytes)} · ${job.platform === "instagram" ? "H.264 · 1080×1920 · 60fps" : "HEVC · 60fps"}` : job.status === 'processing' && job.progress === 99 ? 'Finalizing MP4…' : `${job.progress || 0}% ${job.status === 'processing' ? 'rendered' : 'waiting'}`;
    const link = node.querySelector('.download'); if (job.downloadable) { link.hidden=false; link.href=`/api/jobs/${job.id}/download`; }
    jobsEl.append(node);
  }
};
fetch('/api/health').then(r=>r.json()).then((health)=>{ profile.textContent = platform === "both" ? "One upload → TikTok (timestamp scale 2) + Instagram (1080×1920 / 60 fps, normal speed) · two separate downloads" : platform === "instagram" ? "Reels · 1080×1920 · H.264 · 60 fps · CRF 18 · 12 Mbps ceiling · AAC 128k · 48 kHz stereo" : `${health.profile.name}  |  ${health.profile.codec}  |  ${health.profile.bitrate} target  |  GOP ${health.profile.gop}  |  AAC ${health.profile.audioBitrate} stereo  |  up to ${(health.uploadLimitBytes / 1024 ** 3).toFixed(0)} GB each · ${health.maxUploadFiles} files per batch`; });
fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  fileLabel.textContent = files.length === 0 ? 'Choose videos' : files.length === 1 ? files[0].name : `${files.length} videos selected`;
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const files = [...fileInput.files];
  if (!files.length) return;
  const button = form.querySelector('button');
  button.disabled = true; uploadStatus.textContent = `Uploading ${files.length} video${files.length === 1 ? '' : 's'}…`;
  try {
    const response = await fetch(`/api/uploads?platform=${platform}`, { method: 'POST', body: new FormData(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    const accepted = result.jobs || (result.job ? [result.job] : []);
    const rejected = result.rejected || [];
    uploadStatus.textContent = `${accepted.length} video${accepted.length === 1 ? '' : 's'} added${platform === "both" ? " · two exports per file" : ""} in first-in, first-out order.${rejected.length ? ` ${rejected.length} could not be added.` : ''}`;
    form.reset(); fileLabel.textContent = 'Choose videos';
  } catch (error) { uploadStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
const clearJobs = async (kind, button) => {
  const isActive = kind === 'active';
  const message = isActive
    ? 'Cancel and remove every queued or processing job for this platform? Source and exported files will stay on this computer.'
    : 'Remove all completed conversion records for this platform? Exported files will stay on this computer.';
  if (!window.confirm(message)) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/jobs/${kind}?platform=${platform}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not clear the records.');
    uploadStatus.textContent = result.cleared
      ? `${result.cleared} ${isActive ? 'active job' : 'completed conversion'}${result.cleared === 1 ? '' : 's'} cleared. Files were kept.`
      : `No ${isActive ? 'active jobs' : 'completed conversions'} to clear.`;
  } catch (error) { uploadStatus.textContent = error.message; }
  finally { button.disabled = false; }
};
clearActiveButton.addEventListener('click', () => clearJobs('active', clearActiveButton));
clearCompletedButton.addEventListener('click', () => clearJobs('completed', clearCompletedButton));
setupNavigation({
  nav: document.querySelector('.platform-nav'), window, location,
  startStream: () => {
    const stream = new EventSource('/api/events');
    stream.onmessage = ({data}) => render(JSON.parse(data));
    stream.onerror = () => { profile.textContent = 'Worker disconnected — reconnecting…'; };
    return stream;
  }
});
