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
import { startTelegram, redactTelegramError } from "./telegram.js";
import { TikTokBrowser } from './tiktok-browser.js';
import { TikTokDrafts } from './tiktok-drafts.js';

const app = Fastify({ logger: true });
const queue = new JobQueue();
const telegramState = { configured: Boolean(config.token), status: config.token ? "starting" : "disabled" };
let telegram;
const tiktokBrowser=new TikTokBrowser();
const tiktokDrafts=await new TikTokDrafts(tiktokBrowser).load();
await queue.prepare();
await app.register(fastifyStatic, { root: path.join(config.root, "public"), prefix: "/" });
await app.register(multipart, { limits: { files: config.maxUploadFiles, fileSize: config.uploadLimitBytes } });

const safeName = (name = "video") => path.basename(name).replace(/[^a-z0-9._-]/gi, "_").slice(0, 100) || "video";

app.get("/api/health", async () => ({ ok: true, uploadLimitBytes: config.uploadLimitBytes, maxUploadFiles: config.maxUploadFiles, telegram: telegramState, tiktok: {account:config.tiktok.handle || null,publishingConfigured:Boolean(config.tiktok.handle && config.tiktok.ownerIds.size),browserOpen:Boolean(tiktokBrowser.context)}, profile: { name: 'Vertical TikTok export', codec: 'H.264', highFpsBitrate: '25M', lowFpsBitrate: '15M', audioBitrate: '256k' } }));
const localTikTokRequest=(request)=>request.headers['x-converter-local']==='1' && request.headers.origin===`http://127.0.0.1:${config.port}`;
app.post('/api/tiktok/connect',async(request,reply)=>{if(!localTikTokRequest(request))return reply.code(403).send({error:'Use the local dashboard.'});try{return await tiktokBrowser.connect();}catch(error){return reply.code(400).send({error:error.message});}});
app.post('/api/tiktok/inspect',async(request,reply)=>{if(!localTikTokRequest(request))return reply.code(403).send({error:'Use the local dashboard.'});try{return {controls:await tiktokBrowser.inventory()};}catch(error){return reply.code(400).send({error:error.message});}});
app.get("/api/jobs", async () => queue.snapshot());
app.delete("/api/jobs/active", async () => queue.clearActive());
app.delete("/api/jobs/completed", async () => queue.clearCompleted());
app.post("/api/uploads", async (request, reply) => {
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
        const job = queue.add({ sourcePath: target, sourceName, bytes: stat.size });
        accepted.push({ id: job.id, sourceName, bytes: stat.size, source });
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
  const send = (jobs) => reply.raw.write(`data: ${JSON.stringify(jobs)}\n\n`);
  send(queue.snapshot()); queue.on("update", send); request.raw.on("close", () => queue.off("update", send));
});

app.addHook("onClose", async () => { await telegram?.stop(); await tiktokBrowser.close(); });
await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`Dashboard: http://127.0.0.1:${config.port}`);
startTelegram(queue, { state: telegramState, tiktokDrafts }).then((worker) => { telegram = worker; }).catch((error) => {
  telegramState.status = "failed"; telegramState.error = redactTelegramError(error);
  console.error("Telegram not ready:", telegramState.error);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { queue.clearActive(); await app.close(); });
