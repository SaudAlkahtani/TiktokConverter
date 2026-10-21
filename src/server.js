import path from "node:path";
import fs from "node:fs/promises";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { config, isLocalBotApi } from "./config.js";
import { JobQueue } from "./queue.js";
import { startTelegram } from "./telegram.js";

const app = Fastify({ logger: true });
const queue = new JobQueue();
await queue.prepare();
await app.register(fastifyStatic, { root: path.join(config.root, "public"), prefix: "/" });

app.get("/api/health", async () => ({ ok: true, botConfigured: Boolean(config.token), localBotApi: isLocalBotApi, profile: { name: "TikTok same resolution / 60fps / half speed", bitrate: config.export.bitrate, codec: config.export.videoCodec, audioBitrate: config.export.audioBitrate } }));
app.get("/api/jobs", async () => queue.snapshot());
app.get("/api/jobs/:id/download", async (request, reply) => {
  const job = queue.get(request.params.id);
  if (!job?.outputPath) return reply.code(404).send({ error: "Export not available" });
  try { await fs.access(job.outputPath); } catch { return reply.code(404).send({ error: "Output was removed" }); }
  return reply.download(job.outputPath, path.basename(job.outputPath));
});
app.get("/api/events", (request, reply) => {
  reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (jobs) => reply.raw.write(`data: ${JSON.stringify(jobs)}\n\n`);
  send(queue.snapshot()); queue.on("update", send); request.raw.on("close", () => queue.off("update", send));
});

await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`Dashboard: http://127.0.0.1:${config.port}`);
if (!config.token) console.log(`Telegram bot disabled: put the token for ${config.botUsername} in .env and restart.`);
else {
  try { await startTelegram(queue); console.log(`Telegram bot active: ${config.botUsername}`); }
  catch (error) { console.error(`Telegram bot was not started: ${error.message}`); process.exitCode = 1; }
}
