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
  jobsEl.replaceChildren(); emptyEl.hidden = jobs.length > 0;
  for (const job of jobs) {
    const node = template.content.cloneNode(true); const el = node.querySelector('.job');
    node.querySelector('h3').textContent = job.sourceName;
    node.querySelector('.metadata').textContent = `${bytes(job.bytes)} · ${job.origin || 'local'} · queued ${new Date(job.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    const status = node.querySelector('.status'); status.textContent = job.status; status.classList.add(job.status);
    node.querySelector('.bar span').style.width = `${job.progress || 0}%`;
    const detail = node.querySelector('.detail');
    detail.textContent = job.status === 'failed' ? job.error : job.status === 'complete' ? `Finished · ${bytes(job.media?.bytes)} · ${job.media?.width}×${job.media?.height} · H.264 · ${job.media?.fps === '60/1' ? '60' : '30'}fps · ${job.media?.targetVideoBitrateMbps} Mb/s target${job.telegramStatus ? ` · Telegram ${job.telegramStatus}` : ''}` : job.status === 'processing' && job.progress === 99 ? 'Finalizing MP4…' : `${job.progress || 0}% ${job.status === 'processing' ? 'rendered' : 'waiting'}`;
    const link = node.querySelector('.download'); if (job.downloadable) { link.hidden=false; link.href=`/api/jobs/${job.id}/download`; }
    jobsEl.append(node);
  }
};
const updateHealth = () => fetch('/api/health').then(r=>r.json()).then((health)=>{ profile.textContent = `Welcome! TikTok exports are 1080×1920 H.264. 60 fps sources use 60 fps, 25 Mb/s and half speed; lower frame rates use 30 fps, 15 Mb/s and normal speed. AAC 256 kb/s · up to ${(health.uploadLimitBytes / 1024 ** 3).toFixed(0)} GB per file${health.telegram ? ` · Telegram: ${health.telegram.status}` : ''}`; }).catch(() => {});
updateHealth(); setInterval(updateHealth, 10000);
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
    const response = await fetch('/api/uploads', { method: 'POST', body: new FormData(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    const accepted = result.jobs || (result.job ? [result.job] : []);
    const rejected = result.rejected || [];
    uploadStatus.textContent = `${accepted.length} video${accepted.length === 1 ? '' : 's'} added in first-in, first-out order.${rejected.length ? ` ${rejected.length} could not be added.` : ''}`;
    form.reset(); fileLabel.textContent = 'Choose videos';
  } catch (error) { uploadStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
const clearJobs = async (kind, button) => {
  const isActive = kind === 'active';
  const message = isActive
    ? 'Cancel and remove every queued or processing job? Source and exported files will stay on this computer.'
    : 'Remove all completed conversion records? Exported files will stay on this computer.';
  if (!window.confirm(message)) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/jobs/${kind}`, { method: 'DELETE' });
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
const stream = new EventSource('/api/events'); stream.onmessage = ({data}) => render(JSON.parse(data));
for(const action of ['connect','inspect'])document.querySelector(`#tiktok-${action}`).addEventListener('click',async()=>{
  const status=document.querySelector('#tiktok-status');status.textContent='Opening/checking the local TikTok browser…';
  try{const response=await fetch(`/api/tiktok/${action}`,{method:'POST',headers:{'X-Converter-Local':'1'}});const result=await response.json();if(!response.ok)throw new Error(result.error);
    status.textContent=result.message || 'Visible controls captured. Calibrate the adapter before enabling posting.';
    if(result.controls){const output=document.querySelector('#tiktok-controls');output.hidden=false;output.textContent=JSON.stringify(result.controls,null,2);}
  }catch(error){status.textContent=error.message;}
});
stream.onerror = () => { profile.textContent = 'Worker disconnected — make sure npm start is running.'; };
