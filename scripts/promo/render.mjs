/*
 * Render the evergreen feature/USP promo (scripts/promo/template.html)
 * into a 1080x1080 MP4 with the recap's music track, snipped to fit.
 *
 * Requires: playwright (chromium) + ffmpeg-static.
 * Run: node scripts/promo/render.mjs
 * Output: scripts/promo/out/promo.mp4
 */
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { synthBed } from '../recap/music.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECAP = join(HERE, '..', 'recap');
const FPS = 30;
const outDir = join(HERE, 'out');
const framesDir = join(outDir, 'frames');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(() => { window.__RENDER__ = true; });
await page.goto('file://' + join(HERE, 'template.html'));
await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await page.waitForTimeout(400);

const duration = (await page.evaluate(() => window.RECAP_DURATION)) || 20;
const total = Math.round(duration * FPS);
for (let f = 0; f < total; f++) {
  await page.evaluate(t => window.seek(t), f / FPS);
  await page.screenshot({ path: join(framesDir, `frame-${String(f).padStart(4, '0')}.png`) });
}
await browser.close();
console.error(`Captured ${total} frames.`);

/* Audio: reuse a supplied track (promo folder, then recap folder), else synth. */
let audio = ['music.mp3', 'music.m4a', 'music.wav'].map(f => join(HERE, f))
  .concat(['music.mp3', 'music.m4a', 'music.wav'].map(f => join(RECAP, f)))
  .find(existsSync);
if (!audio) { audio = join(outDir, 'music.wav'); synthBed(audio); console.error('Synthesised music bed.'); }
else console.error('Using audio: ' + audio);

const out = join(outDir, 'promo.mp4');
const fadeOutStart = Math.max(0, duration - 1.5).toFixed(2);
const ff = spawnSync(ffmpegPath || 'ffmpeg', [
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
