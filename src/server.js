import { subscribeToJobs } from './events.js';
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { JobQueue } from "./queue.js";
import { probe } from "./ffmpeg.js";
import { encoderCapabilities } from './encoders.js';
import { faceDetectorAvailable, hasAudioStream, probeSources, validateEditSettings } from './editor.js';

const app = Fastify({ logger: true });
const queue = new JobQueue();
await queue.prepare();
await app.register(fastifyStatic, { root: path.join(config.root, "public"), prefix: "/" });
await app.register(multipart, { limits: { files: config.maxUploadFiles, fileSize: config.uploadLimitBytes } });

app.get('/both', async (request, reply) => reply.sendFile('both.html'));
app.get('/editor', async (request, reply) => reply.sendFile('editor.html'));
app.get('/instagram', async (request, reply) => reply.sendFile('instagram.html'));
app.get('/tiktok', async (request, reply) => reply.sendFile('index.html'));

const safeName = (name = "video") => path.basename(name).replace(/[^a-z0-9._-]/gi, "_").slice(0, 100) || "video";

app.get("/api/health", async () => ({ ok: true, uploadLimitBytes: config.uploadLimitBytes, maxUploadFiles: config.maxUploadFiles, profile: { name: "HEVC 60fps", codec: config.export.videoCodec, bitrate: config.export.bitrate, gop: config.export.gop, audioBitrate: "256k" } }));
app.get('/api/editor/encoders', async () => ({ ...await encoderCapabilities(), faceDetection: await faceDetectorAvailable() }));
app.get("/api/jobs", async () => queue.snapshot());
app.delete("/api/jobs/active", async (request) => queue.clearActive(request.query.platform));
app.delete("/api/jobs/completed", async (request) => queue.clearCompleted(request.query.platform));
app.post('/api/editor/jobs', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${config.port}`) return reply.code(403).send({ error: 'Open the editor on this local server.' });
  const files = { sources: [] };
  let settingsText = null;
  try {
    for await (const part of request.parts({ limits: { files: Infinity, parts: Infinity, fieldSize: 16 * 1024 * 1024,
      fileSize: config.uploadLimitBytes } })) {
      if (part.type === 'field') {
        if (part.fieldname === 'settings') settingsText = String(part.value);
        continue;
      }
      if (!['source', 'voice', 'pip'].includes(part.fieldname)) throw new Error('Only source, voice and picture-in-picture files are accepted.');
      if (part.fieldname !== 'source' && files[part.fieldname]) throw new Error('Choose at most one voice or picture-in-picture file.');
      const name = safeName(part.filename);
      const filePath = path.join(config.directories.incoming, `${Date.now()}-${randomUUID()}-${name}`);
      const stored = { path: filePath, name };
      if (part.fieldname === 'source') files.sources.push(stored);
      else files[part.fieldname] = stored;
      await pipeline(part.file, fssync.createWriteStream(filePath, { flags: 'wx' }));
      if (part.file.truncated) throw new Error('A file exceeded the configured input limit.');
    }
    if (!files.sources.length) throw new Error('Choose at least one source video first.');
    const sourceMedia = await probeSources(files.sources.map(file => file.path));
    if (sourceMedia.some(media => !Number.isFinite(media.duration) || media.duration <= 0)) throw new Error('Every source needs a readable duration.');
    if (files.pip) await probe(files.pip.path);
    if (files.voice && !await hasAudioStream(files.voice.path)) throw new Error('The voice file has no readable audio track.');
    let raw;
    try { raw = JSON.parse(settingsText || ''); } catch { throw new Error('Editing settings are invalid.'); }
    const settings = validateEditSettings(raw, sourceMedia);
    if (settings.autoFaces && !await faceDetectorAvailable()) throw new Error('Automatic face blur needs Python, OpenCV and NumPy. Install requirements-editor.txt or use manual blur areas.');
    if (settings.encoder !== 'auto' && settings.encoder !== 'cpu') {
      const available = await encoderCapabilities();
      if (!available[settings.encoder]) throw new Error(`${settings.encoder.toUpperCase()} encoding is unavailable on this machine.`);
    }
    const sizes = await Promise.all(files.sources.map(file => fs.stat(file.path)));
    const job = queue.addEditor({ sourcePaths: files.sources.map(file => file.path), sourceName: files.sources[0].name,
      bytes: sizes.reduce((total, stat) => total + stat.size, 0), voicePath: files.voice?.path, pipPath: files.pip?.path, settings });
    return reply.code(202).send({ id: job.id, source: sourceMedia[0], sources: sourceMedia, destination: settings.destination });
  } catch (error) {
    await Promise.all([...files.sources, ...[files.voice, files.pip].filter(Boolean)].map(file => fs.rm(file.path, { force: true })));
    request.log.warn({ err: error }, 'Editor upload rejected');
    return reply.code(error.code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 400).send({ error: error.message.slice(0, 700) });
  }
});
app.post("/api/uploads", async (request, reply) => {
  const platform = request.query.platform || 'tiktok';
  if (!['tiktok', 'instagram', 'both'].includes(platform)) return reply.code(400).send({ error: 'Choose TikTok, Instagram or both.' });
  const accepted = [];
  const rejected = [];
  try {
    for await (const file of request.files()) {
      let target;
      const sourceName = safeName(file.filename);
      try {
        const storedName = `${Date.now()}-${randomUUID()}-${sourceName}`;
        target = path.join(config.directories.incoming, storedName);
        await pipeline(file.file, fssync.createWriteStream(target, { flags: "wx" }));
        if (file.file.truncated) throw new Error("The upload is larger than this server's configured limit.");

        const stat = await fs.stat(target);
        const source = await probe(target);
        const groupId = randomUUID();
        const outputs = platform === 'both'
          ? queue.addCombined({ sourcePath: target, sourceName, bytes: stat.size, groupId })
          : [queue.add({ sourcePath: target, sourceName, bytes: stat.size, platform, groupId })];
        accepted.push({ id: outputs[0].id, sourceName, bytes: stat.size, source, outputs: outputs.map(job => ({ id: job.id, platform: job.platform })) });
      } catch (error) {
        if (target) await fs.rm(target, { force: true });
        const tooLarge = error.code === "FST_REQ_FILE_TOO_LARGE" || error.message.includes("configured limit");
        const unreadable = error.message.includes("No readable video stream") || error.message.startsWith("ffprobe failed");
        rejected.push({ sourceName, error: tooLarge ? "This file exceeds the upload limit." : unreadable ? "FFmpeg could not read this file as a video." : "The upload could not be processed." });
        request.log.warn({ err: error, sourceName }, "Upload was rejected");
      }
    }
    if (!accepted.length) return reply.code(rejected.some((item) => item.error.includes("limit")) ? 413 : 400).send({ error: rejected[0]?.error || "Choose one or more video files first.", rejected });
    // Keep `job` for older clients while exposing every accepted upload.
    return reply.code(202).send({ job: accepted[0], jobs: accepted, rejected });
  } catch (error) {
    request.log.warn({ err: error }, "Upload was rejected");
    const tooLarge = error.code === "FST_REQ_FILE_TOO_LARGE" || error.code === "FST_FILES_LIMIT";
    return reply.code(tooLarge ? 413 : 400).send({ error: tooLarge ? `Upload limit reached (up to ${config.maxUploadFiles} files).` : "The upload could not be processed. Please try another video file.", rejected });
  }
});
app.get("/api/jobs/:id/download", async (request, reply) => {
  const job = queue.get(request.params.id);
  if (!job?.outputPath) return reply.code(404).send({ error: "Export not available" });
  try { await fs.access(job.outputPath); } catch { return reply.code(404).send({ error: "Output was removed" }); }
  const filename = path.basename(job.outputPath).replace(/"/g, "");
  reply.header("Content-Disposition", `attachment; filename="${filename}"`);
  return reply.type("video/mp4").send(fssync.createReadStream(job.outputPath));
});
app.get("/api/events", (request, reply) => {
  reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  subscribeToJobs(queue, reply.raw);
});

await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`Dashboard: http://127.0.0.1:${config.port}`);
