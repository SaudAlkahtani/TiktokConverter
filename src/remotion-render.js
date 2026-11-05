import fs from 'node:fs/promises';
import fssync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {makeCancelSignal, renderMedia, selectComposition} from '@remotion/renderer';

const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../remotion/entry.jsx');

export function browserExecutable() {
  if (process.env.REMOTION_BROWSER_PATH) return process.env.REMOTION_BROWSER_PATH;
  if (process.platform !== 'win32') return undefined;
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const root of roots) for (const suffix of ['Google/Chrome/Application/chrome.exe',
    'Microsoft/Edge/Application/msedge.exe', 'BraveSoftware/Brave-Browser/Application/brave.exe']) {
    const candidate = path.join(root, suffix);
    if (fssync.existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function serveMedia(input) {
  const stat = await fs.stat(input);
  const secret = randomUUID();
  const server = http.createServer((request, response) => {
    if (new URL(request.url, 'http://localhost').pathname !== `/media/${secret}`) {
      response.writeHead(404).end(); return;
    }
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Range');
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', 'video/mp4');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    let start = 0, end = stat.size - 1;
    if (match) {
      start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
        response.writeHead(416, {'Content-Range': `bytes */${stat.size}`}).end(); return;
      }
      response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    response.setHeader('Content-Length', end - start + 1);
    response.writeHead(match ? 206 : 200);
    if (request.method === 'HEAD') response.end();
    else fssync.createReadStream(input, {start, end}).on('error', () => response.destroy()).pipe(response);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {url: `http://127.0.0.1:${server.address().port}/media/${secret}`,
    close: () => new Promise(resolve => server.close(resolve))};
}

export async function renderMotionGraphics({input, output, media, titles, signal, onProgress = () => {}}) {
  if (!titles?.length) throw new Error('Add at least one Remotion title.');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-remotion-'));
  const mediaServer = await serveMedia(input);
  const {cancelSignal, cancel} = makeCancelSignal();
  const abort = () => cancel();
  signal?.addEventListener('abort', abort, {once: true});
  try {
    const serveUrl = await bundle({entryPoint: entry, outDir: path.join(folder, 'bundle')});
    const props = {videoUrl: mediaServer.url, titles, width: media.width, height: media.height,
      fps: 60, durationFrames: Math.max(1, Math.round(media.duration * 60))};
    const browser = browserExecutable();
    const composition = await selectComposition({serveUrl, id: 'GymEdit', inputProps: props, browserExecutable: browser});
    await renderMedia({serveUrl, composition, inputProps: props, outputLocation: output, codec: 'h264',
      colorSpace: 'bt709', imageFormat: 'png', videoBitrate: '60M', audioBitrate: '256k',
      browserExecutable: browser, cancelSignal, onProgress: ({progress}) => onProgress(Math.round(progress * 100))});
  } finally {
    signal?.removeEventListener('abort', abort);
    await mediaServer.close();
    await fs.rm(folder, {recursive: true, force: true});
  }
}
