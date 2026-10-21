import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "./config.js";
import { render, RenderCancelledError } from "./ffmpeg.js";
import { renderEdit } from './editor.js';

export class JobQueue extends EventEmitter {
  constructor() { super(); this.jobs = []; this.running = false; this.activeJobId = null; this.activeAbortController = null; }
  snapshot() { return this.jobs.map(({ sourcePath, outputPath, editor, ...job }) => ({ ...job, downloadable: Boolean(outputPath) })); }
  emitUpdate() { this.emit("update", this.snapshot()); }
  add({ sourcePath, sourceName, bytes, platform = "tiktok", origin = platform, groupId = null, timestampScale, encoder = 'cpu' }) {
    const job = { id: randomUUID(), sourcePath, sourceName, bytes, platform, origin, groupId, timestampScale, encoder, status: "queued", progress: 0, createdAt: new Date().toISOString(), outputPath: null };
    // Append so the oldest waiting upload always starts next (FIFO).
    this.jobs.push(job); this.emitUpdate(); this.pump(); return job;
  }
  addCombined({ sourcePath, sourceName, bytes, origin = 'both', groupId = randomUUID(), encoder = 'cpu' }) {
    return [
      this.add({ sourcePath, sourceName, bytes, platform: 'tiktok', origin, groupId, timestampScale: 2, encoder: 'cpu' }),
      this.add({ sourcePath, sourceName, bytes, platform: 'instagram', origin, groupId, encoder })
    ];
  }
  addEditor({ sourcePath, sourceName, bytes, voicePath, pipPath, settings }) {
    const job = { id: randomUUID(), sourcePath, sourceName, bytes, platform: 'editor', origin: 'editor', status: 'queued', progress: 0,
      createdAt: new Date().toISOString(), outputPath: null, editSummary: { destination: settings.destination, encoder: settings.encoder,
        autoFaces: settings.autoFaces, blurRegions: settings.blurRegions.length, voice: Boolean(voicePath), pip: Boolean(pipPath) },
      editor: { voicePath, pipPath, settings } };
    this.jobs.push(job); this.emitUpdate(); this.pump(); return job;
  }
  get(id) { return this.jobs.find((job) => job.id === id); }
  clearActive(platform) {
    const active = this.jobs.filter((job) => (!platform || (['both', 'editor'].includes(platform) ? job.origin === platform : job.platform === platform)) && (job.status === "queued" || job.status === "processing"));
    const processing = active.some((job) => job.status === "processing");
    for (const job of active) job.cancelled = true;
    this.jobs = this.jobs.filter((job) => !active.includes(job));
    if (processing) this.activeAbortController?.abort();
    if (active.length) this.emitUpdate();
    return { cleared: active.length, cancelledProcessing: processing };
  }
  clearCompleted(platform) {
    const completed = this.jobs.filter((job) => job.status === "complete" && (!platform || (['both', 'editor'].includes(platform) ? job.origin === platform : job.platform === platform)));
    this.jobs = this.jobs.filter((job) => !completed.includes(job));
    if (completed.length) this.emitUpdate();
    return { cleared: completed.length };
  }
  async pump() {
    if (this.running) return;
    const job = this.jobs.find((item) => item.status === "queued");
    if (!job) return;
    this.running = true; this.activeJobId = job.id; this.activeAbortController = new AbortController();
    job.status = "processing"; job.startedAt = new Date().toISOString(); this.emitUpdate();
    try {
      const safeBase = path.basename(job.sourceName, path.extname(job.sourceName)).replace(/[^a-z0-9_-]/gi, "_").slice(0, 70) || "clip";
      const outputPath = path.join(config.directories.output, `${safeBase}_${job.platform}_${job.id.slice(0, 8)}.mp4`);
      if (job.platform === 'editor') {
        job.media = await renderEdit({ input: job.sourcePath, output: outputPath, voicePath: job.editor.voicePath, pipPath: job.editor.pipPath,
          settings: job.editor.settings, signal: this.activeAbortController.signal, onProgress: (progress) => { job.progress = progress; this.emitUpdate(); } });
      } else {
        job.media = await render({ input: job.sourcePath, output: outputPath, platform: job.platform, timestampScale: job.timestampScale, encoder: job.encoder,
          signal: this.activeAbortController.signal, onProgress: (progress) => { job.progress = progress; this.emitUpdate(); } });
      }
      job.outputPath = outputPath; job.progress = 100; job.status = "complete"; job.completedAt = new Date().toISOString(); this.emitUpdate();
      this.emit("complete", job);
      if (job.platform === 'editor' && !job.cancelled) {
        this.addCombined({ sourcePath: outputPath, sourceName: job.sourceName, bytes: job.media.bytes,
          origin: 'editor', groupId: job.id, encoder: job.editor.settings.encoder });
      }
    } catch (error) {
      if (!job.cancelled && !(error instanceof RenderCancelledError)) {
        job.status = "failed"; job.error = error.message; job.completedAt = new Date().toISOString(); this.emitUpdate(); this.emit("failed", job);
      }
    } finally {
      if (this.activeJobId === job.id) { this.activeJobId = null; this.activeAbortController = null; }
      this.running = false; this.pump();
    }
  }
  async prepare() { await Promise.all(Object.values(config.directories).map((dir) => fs.mkdir(dir, { recursive: true }))); }
}
