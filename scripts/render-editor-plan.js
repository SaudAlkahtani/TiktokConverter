import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from '../src/config.js';
import {hasAudioStream, probeSources, renderEdit, validateEditSettings} from '../src/editor.js';
import {render} from '../src/ffmpeg.js';

const planPath = process.argv[2] && path.resolve(process.argv[2]);
if (!planPath) {
  console.error('Usage: npm run editor:plan -- path/to/gym-edit-plan.json');
  process.exit(2);
}

const root = path.dirname(planPath);
const resolveFile = value => path.resolve(root, value);
const name = value => path.basename(value, path.extname(value)).replace(/[^a-z0-9_-]/gi, '_').slice(0, 64) || 'edit';
const aborter = new AbortController();
process.once('SIGINT', () => aborter.abort());

try {
  const plan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
  if (plan.version !== 1 || !Array.isArray(plan.sources) || !plan.sources.length ||
    plan.sources.some(item => typeof item !== 'string' || !item.trim()))
    throw new Error('The plan needs version 1 and a nonempty sources list.');
  const inputs = plan.sources.map(resolveFile);
  await Promise.all(inputs.map(file => fs.access(file)));
  const sourceMedia = await probeSources(inputs);
  const settings = validateEditSettings(plan.settings, sourceMedia);
  const voicePath = plan.voice ? resolveFile(plan.voice) : null;
  const pipPath = plan.pip ? resolveFile(plan.pip) : null;
  if (voicePath && !await hasAudioStream(voicePath)) throw new Error('Voice file has no readable audio track.');
  if (pipPath) await fs.access(pipPath);
  const outputDir = plan.outputDir ? resolveFile(plan.outputDir) : config.directories.output;
  await fs.mkdir(outputDir, {recursive: true});
  const prefix = `${name(plan.sources[0])}_${randomUUID().slice(0, 8)}`;
  const outputs = {
    master: path.join(outputDir, `${prefix}_master.mp4`),
    tiktok: path.join(outputDir, `${prefix}_tiktok.mp4`),
    instagram: path.join(outputDir, `${prefix}_instagram.mp4`)
  };
  console.log(`Editing ${inputs.length} source video(s) with ${settings.segments.length} timeline clips and ${settings.motionTitles.length} Remotion title(s).`);
  await renderEdit({inputPaths: inputs, output: outputs.master, voicePath, pipPath, settings,
    signal: aborter.signal, onProgress: value => process.stdout.write(`\rMaster ${value}%   `)});
  process.stdout.write('\n');
  for (const platform of ['tiktok', 'instagram']) {
    await render({input: outputs.master, output: outputs[platform], platform, signal: aborter.signal,
      onProgress: value => process.stdout.write(`\r${platform} ${value}%   `)});
    process.stdout.write('\n');
  }
  const summary = path.join(outputDir, `${prefix}_outputs.json`);
  await fs.writeFile(summary, JSON.stringify({plan: planPath, outputs}, null, 2) + '\n');
  console.log(`Finished: ${summary}`);
} catch (error) {
  console.error(`Edit plan failed: ${error.message}`);
  process.exitCode = 1;
}
