/*
 * Render scripts/recap/recap.json into a 1080x1080 MP4 using the
 * deterministic seek(t) timeline in template.html: screenshot every
 * frame at 30fps, then encode with ffmpeg.
 *
 * Requires: playwright (chromium) + ffmpeg on PATH.
 * Run: node scripts/recap/render.mjs
 * Output: scripts/recap/out/recap-gw{n}.mp4
 */
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const recap = JSON.parse(readFileSync(join(HERE, 'recap.json'), 'utf8'));
const outDir = join(HERE, 'out');
const framesDir = join(outDir, 'frames');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(data => { window.__RENDER__ = true; window.__RECAP__ = data; }, recap);
await page.goto('file://' + join(HERE, 'template.html'));
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

const out = join(outDir, `recap-gw${recap.gw}.mp4`);
const ffBin = ffmpegPath || 'ffmpeg';
const ff = spawnSync(ffBin, [
  '-y', '-framerate', String(FPS),
  '-i', join(framesDir, 'frame-%04d.png'),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-r', String(FPS), out
], { stdio: 'inherit' });
if (ff.error) { console.error('ffmpeg spawn error:', ff.error.message); process.exit(1); }
if (ff.status !== 0) { console.error('ffmpeg exited with status', ff.status); process.exit(1); }
rmSync(framesDir, { recursive: true, force: true });
console.error(`Wrote ${out}`);
