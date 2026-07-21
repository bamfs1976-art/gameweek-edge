/*
 * Local visual check without ffmpeg: render one key frame per scene to
 * scripts/recap/out/preview-*.png. Uses recap.json if present, else the
 * template's built-in sample data.
 *
 * Run: node scripts/recap/preview.mjs
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const outDir = join(HERE, 'out');
mkdirSync(outDir, { recursive: true });
const dataPath = join(HERE, 'recap.json');
const recap = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, 'utf8')) : null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(data => { window.__RENDER__ = true; if (data) window.__RECAP__ = data; }, recap);
await page.goto('file://' + join(HERE, 'template.html'));
await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await page.waitForTimeout(400);

for (const [t, name] of [[1.4, 'intro'], [6.2, 'hauls'], [12, 'dream'], [16, 'numbers'], [19, 'outro']]) {
  await page.evaluate(tt => window.seek(tt), t);
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(outDir, `preview-${name}.png`) });
}
await browser.close();
console.error('Wrote preview-*.png to ' + outDir);
