/*
 * Local visual check without ffmpeg: render one key frame per scene to
 * scripts/recap/out/preview-*.png. Uses recap.json if present, else the
 * template's built-in sample data.
 *
 * Run: node scripts/recap/preview.mjs
 *      node scripts/recap/preview.mjs --template template-rotation.html \
 *                                     --data rotation.json --name rotation
 *
 * Scene times come from the template's own SCENES list rather than a copy
 * kept here, so a retimed video previews at the right moments without this
 * file being touched.
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const outDir = join(HERE, 'out');
mkdirSync(outDir, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const templateFile = arg('template', 'template.html');
const prefix = arg('name', 'preview');
const dataPath = join(HERE, arg('data', 'recap.json'));
const recap = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, 'utf8')) : null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(data => { window.__RENDER__ = true; if (data) window.__RECAP__ = data; }, recap);
await page.goto('file://' + join(HERE, templateFile));
await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await page.waitForTimeout(400);

/* Mid-scene for each scene the template declares — the most representative
   frame, rather than a boundary where something is still animating in. */
const scenes = await page.evaluate(() => (window.RECAP_SCENES || []).map(s => ({ id: s.id, t: s.t + s.d * 0.7 })));
if (!scenes.length) { console.error('Template exposes no RECAP_SCENES.'); process.exit(1); }
for (const s of scenes) {
  await page.evaluate(tt => window.seek(tt), s.t);
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(outDir, `${prefix}-${s.id}.png`) });
}
await browser.close();
console.error(`Wrote ${prefix}-*.png (${scenes.map(s => s.id).join(', ')}) to ` + outDir);
