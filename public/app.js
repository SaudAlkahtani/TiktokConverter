const jobsEl = document.querySelector('#jobs');
const emptyEl = document.querySelector('#empty');
const template = document.querySelector('#job-template');
const profile = document.querySelector('#profile');
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
    detail.textContent = job.status === 'failed' ? job.error : job.status === 'complete' ? `Finished · ${bytes(job.media?.bytes)} · ${job.media?.width}×${job.media?.height} · 60fps` : `${job.progress || 0}% ${job.status === 'processing' ? 'rendered' : 'waiting'}`;
    const link = node.querySelector('.download'); if (job.downloadable) { link.hidden=false; link.href=`/api/jobs/${job.id}/download`; }
    jobsEl.append(node);
  }
};
fetch('/api/health').then(r=>r.json()).then((health)=>{ const transport = health.localBotApi ? 'LOCAL 4K BOT API READY' : 'STANDARD TELEGRAM LIMITS'; profile.textContent = `${health.profile.name}  |  HEVC/hvc1  |  ${health.profile.bitrate} target  |  AAC ${health.profile.audioBitrate} stereo  |  ${transport}`; });
const stream = new EventSource('/api/events'); stream.onmessage = ({data}) => render(JSON.parse(data));
stream.onerror = () => { profile.textContent = 'Worker disconnected — make sure npm start is running.'; };
