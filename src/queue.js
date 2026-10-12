import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "./config.js";
import { render, RenderCancelledError } from "./ffmpeg.js";

export class JobQueue extends EventEmitter {
  constructor() { super(); this.jobs = []; this.running = false; this.activeJobId = null; this.activeAbortController = null; }
  snapshot() { return this.jobs.map(({ sourcePath, outputPath, ...job }) => ({ ...job, downloadable: Boolean(outputPath) })); }
  emitUpdate() { this.emit("update", this.snapshot()); }
  add({ sourcePath, sourceName, bytes, chatId, messageId, userId, method = 'return' }) {
    const job = { id: randomUUID(), sourcePath, sourceName, bytes, chatId, messageId, userId, method, origin: chatId == null ? "local" : "telegram", status: "queued", progress: 0, createdAt: new Date().toISOString(), outputPath: null };
    // Append so the oldest waiting upload always starts next (FIFO).
    this.jobs.push(job); this.emitUpdate(); this.pump(); return job;
  }
  get(id) { return this.jobs.find((job) => job.id === id); }
  clearActive() {
    const active = this.jobs.filter((job) => job.status === "queued" || job.status === "processing");
    const processing = active.some((job) => job.status === "processing");
    for (const job of active) job.cancelled = true;
    this.jobs = this.jobs.filter((job) => job.status !== "queued" && job.status !== "processing");
    if (processing) this.activeAbortController?.abort();
    if (active.length) this.emitUpdate();
    return { cleared: active.length, cancelledProcessing: processing };
  }
  clearCompleted() {
    const completed = this.jobs.filter((job) => job.status === "complete");
    this.jobs = this.jobs.filter((job) => job.status !== "complete");
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
      const outputPath = path.join(config.directories.output, `${safeBase}_hevc_60fps_${job.id.slice(0, 8)}.mp4`);
      job.media = await render({ input: job.sourcePath, output: outputPath, signal: this.activeAbortController.signal, onProgress: (progress) => { job.progress = progress; this.emitUpdate(); } });
      job.outputPath = outputPath; job.progress = 100; job.status = "complete"; job.completedAt = new Date().toISOString(); this.emitUpdate();
      this.emit("complete", job);
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
