/*
 * Daily content — render the chosen story to a 1080×1080 PNG and write the
 * post copy beside it.
 *
 *   node scripts/content/render.mjs
 *   node scripts/content/render.mjs --data content.json --out out/
 *
 * Reads scripts/content/content.json (written by fetch-data.mjs) and emits
 * out/card.png + out/post.txt + out/post.json.
 *
 * Exits 0 and writes nothing when the selector chose silence. A quiet day is
 * a correct outcome; the workflow checks for the files rather than treating
 * their absence as a failure.
 *
 * Still image, so no ffmpeg and no frame loop — the one real difference from
 * the recap/promo renderers, which this otherwise deliberately mirrors.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { draft } from './copy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const DATA = join(HERE, arg('data', 'content.json'));
const OUT = join(HERE, arg('out', 'out'));

if (!existsSync(DATA)) {
  console.error('No ' + DATA + ' — run scripts/content/fetch-data.mjs first.');
  process.exit(1);
}
const payload = JSON.parse(readFileSync(DATA, 'utf8'));

if (!payload.published || !payload.story) {
  console.log('· nothing to render — ' + (payload.reason || 'no story was selected'));
  rmSync(OUT, { recursive: true, force: true });
  process.exit(0);
}

const post = draft(payload);
if (!post) {
  console.error('Story kind "' + payload.story.kind + '" has no copy writer in copy.mjs.');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(`window.__DATA__ = ${JSON.stringify(payload)};`);
await page.goto('file://' + join(HERE, 'template.html'));
/* Web fonts decide the layout, so waiting for the network alone would
   screenshot a page mid-reflow in the display face's fallback. */
await page.waitForFunction('window.__READY__ === true', null, { timeout: 15000 }).catch(() => {});
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await page.waitForTimeout(250);

await page.screenshot({ path: join(OUT, 'card.png') });

/* The card must not silently clip its own headline. */
const overflow = await page.evaluate(() => {
  const c = document.getElementById('card');
  return { w: c.scrollWidth > 1080, h: c.scrollHeight > 1080, height: c.scrollHeight };
});
await browser.close();

writeFileSync(join(OUT, 'post.txt'), post.text + '\n');
writeFileSync(join(OUT, 'post.json'), JSON.stringify(post, null, 2));

const s = payload.story;
console.log(`✓ ${s.label}: ${s.headline}`);
console.log(`  card  → ${join(OUT, 'card.png')}`);
console.log(`  post  → ${post.length} chars${post.withinXLimit ? '' : ' (over 280 — trim before posting)'}`);
console.log(`  score ${post.scoreBreakdown.total} (magnitude ${post.scoreBreakdown.magnitude}` +
  ` · timeliness ${post.scoreBreakdown.timeliness} · novelty ${post.scoreBreakdown.novelty})`);
if (overflow.h || overflow.w) {
  console.warn(`  ! content overflows the card (${overflow.height}px tall) — check card.png`);
}
