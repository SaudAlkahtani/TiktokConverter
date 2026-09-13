import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "./config.js";
import { render } from "./ffmpeg.js";

export class JobQueue extends EventEmitter {
  constructor() { super(); this.jobs = []; this.running = false; }
  snapshot() { return this.jobs.map(({ sourcePath, outputPath, ...job }) => ({ ...job, downloadable: Boolean(outputPath) })); }
  emitUpdate() { this.emit("update", this.snapshot()); }
  add({ sourcePath, sourceName, bytes, options = {}, source }) {
    const job = { id: randomUUID(), sourcePath, sourceName, bytes, options, source, status: "queued", progress: 0, createdAt: new Date().toISOString(), outputPath: null };
    this.jobs.unshift(job); this.emitUpdate(); this.pump(); return job;
  }
  get(id) { return this.jobs.find((job) => job.id === id); }
  async pump() {
    if (this.running) return;
    const job = this.jobs.find((item) => item.status === "queued");
    if (!job) return;
    this.running = true; job.status = "processing"; job.startedAt = new Date().toISOString(); this.emitUpdate();
    try {
      const safeBase = path.basename(job.sourceName, path.extname(job.sourceName)).replace(/[^a-z0-9_-]/gi, "_").slice(0, 70) || "clip";
      const outputPath = path.join(config.directories.output, `${safeBase}_hevc_60fps_${job.id.slice(0, 8)}.mp4`);
      job.media = await render({ input: job.sourcePath, output: outputPath, options: job.options,
        onEncoder: ({ encoder, warnings }) => { job.encoder = encoder; job.warnings = warnings; job.progress = 0; this.emitUpdate(); },
        onProgress: (progress) => { job.progress = progress; this.emitUpdate(); } });
      job.outputPath = outputPath; job.progress = 100; job.status = "complete"; job.completedAt = new Date().toISOString(); this.emitUpdate();
      this.emit("complete", job);
    } catch (error) {
      job.status = "failed"; job.error = error.message; job.completedAt = new Date().toISOString(); this.emitUpdate(); this.emit("failed", job);
    } finally { this.running = false; this.pump(); }
  }
  async prepare() { await Promise.all(Object.values(config.directories).map((dir) => fs.mkdir(dir, { recursive: true }))); }
}
