/*
 * Render scripts/recap/recap.json into a 1080x1080 MP4 using the
 * deterministic seek(t) timeline in template.html: screenshot every
 * frame at 30fps, then encode with ffmpeg.
 *
 * Requires: playwright (chromium) + ffmpeg on PATH.
 * Run: node scripts/recap/render.mjs
 *      node scripts/recap/render.mjs --template template-rotation.html \
 *                                    --data rotation.json --name rotation
 * Output: scripts/recap/out/{name}.mp4  (default recap-gw{n})
 *
 * The template, its data file and the output name are all arguments so a
 * second video is a template plus a JSON file, not a second renderer. The
 * audio bed, the frame capture and the encode are shared by every video in
 * the series — which is the point: one track, one look, many subjects.
 */
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { synthBed } from './music.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const templateFile = arg('template', 'template.html');
const dataFile = arg('data', 'recap.json');
const recap = JSON.parse(readFileSync(join(HERE, dataFile), 'utf8'));
const name = arg('name', 'recap-gw' + recap.gw);
const outDir = join(HERE, 'out');
const framesDir = join(outDir, 'frames');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(data => { window.__RENDER__ = true; window.__RECAP__ = data; }, recap);
await page.goto('file://' + join(HERE, templateFile));
await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await page.waitForTimeout(500); // let player photos / crests settle

const duration = (await page.evaluate(() => window.RECAP_DURATION)) || 20;
const total = Math.round(duration * FPS);
for (let f = 0; f < total; f++) {
  await page.evaluate(t => window.seek(t), f / FPS);
  await page.screenshot({ path: join(framesDir, `frame-${String(f).padStart(4, '0')}.png`) });
}
await browser.close();
console.error(`Captured ${total} frames.`);

/* Audio bed: prefer a supplied track (music.mp3 / .m4a / .wav next to
   this script), otherwise synthesise the original royalty-free bed. */
let audio = ['music.mp3', 'music.m4a', 'music.wav'].map(f => join(HERE, f)).find(existsSync);
if (!audio) { audio = join(outDir, 'music.wav'); synthBed(audio); console.error('Synthesised music bed.'); }
else console.error('Using supplied audio: ' + audio);

const out = join(outDir, `${name}.mp4`);
const ffBin = ffmpegPath || 'ffmpeg';
/* Snip the audio to the video length with a short fade in and a clean
   fade-out at the end (so a longer track ends gracefully, not cut dead). */
const fadeOutStart = Math.max(0, duration - 1.5).toFixed(2);
const ff = spawnSync(ffBin, [
  '-y', '-framerate', String(FPS),
  '-i', join(framesDir, 'frame-%04d.png'),
  '-i', audio,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k',
  '-af', `afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeOutStart}:d=1.5`,
  '-t', String(duration), '-shortest',
  out
], { stdio: 'inherit' });
if (ff.error) { console.error('ffmpeg spawn error:', ff.error.message); process.exit(1); }
if (ff.status !== 0) { console.error('ffmpeg exited with status', ff.status); process.exit(1); }
rmSync(framesDir, { recursive: true, force: true });
console.error(`Wrote ${out}`);
