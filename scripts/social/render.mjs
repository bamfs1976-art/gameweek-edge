/*
 * Evergreen social cards — render each template in this folder to a PNG in
 * assets/social/.
 *
 *   node scripts/social/render.mjs                    all cards
 *   node scripts/social/render.mjs defcon-explainer   just one
 *
 * These are the cards with no live data behind them: the rules of the game,
 * the tier comparison. They are committed to the repo rather than generated
 * on demand, because the content pack attaches them by filename and a social
 * post shouldn't wait on a headless browser.
 *
 * Deliberately mirrors scripts/content/render.mjs — same launch, same font
 * guard, same CHROMIUM_PATH escape hatch for environments that keep the
 * browser outside node_modules.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'assets', 'social');

/* filename stem → output name and canvas. 1200² matches the comparison card
   already in assets/social/, which is the one these sit beside in a feed. */
const CARDS = [
  { stem: 'defcon-explainer', out: 'gwe-defcon-explainer.png', width: 1200, height: 1200 },
];

const only = process.argv[2];
const todo = only ? CARDS.filter((c) => c.stem === only) : CARDS;
if (!todo.length) {
  console.error(`No card named "${only}". Known: ${CARDS.map((c) => c.stem).join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

for (const card of todo) {
  const page = await browser.newPage({
    viewport: { width: card.width, height: card.height }, deviceScaleFactor: 1,
  });
  await page.goto('file://' + join(HERE, card.stem + '.html'));
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 15000 });
  /* The fonts promise resolves as the faces land; give the reflow a beat
     before the shutter, or the first render catches mid-relayout metrics. */
  await page.waitForTimeout(250);

  /* Two ways this card can fail quietly, both of which have happened, and
     neither of which is visible in an exit code — so assert on them rather
     than trusting the screenshot. */
  const checked = await page.evaluate(() => {
    const el = document.querySelector('.card');
    /* Measured against the padding box, not the border box. Content that
       spills into the bottom padding is still inside the canvas, so a
       scrollHeight check calls it clean while the card visibly crowds its
       own edge — which is what the first pass of this layout did. */
    const pad = parseFloat(getComputedStyle(el).paddingBottom);
    const last = el.lastElementChild.getBoundingClientRect().bottom;
    return { faces: window.__FACES__ || 0, over: Math.round(last - (el.clientHeight - pad)) };
  });
  if (!checked.faces) {
    console.error(`✗ ${card.stem}: no webfaces loaded — this would ship in the fallback face.`);
    console.error('  Run: node scripts/social/fetch-fonts.mjs');
    process.exitCode = 1; await page.close(); continue;
  }
  if (checked.over > 0) {
    console.error(`✗ ${card.stem}: content runs ${checked.over}px past the padding box — trim the layout.`);
    process.exitCode = 1; await page.close(); continue;
  }

  await page.screenshot({ path: join(OUT, card.out) });
  await page.close();
  console.log(`✓ assets/social/${card.out}  (${card.width}×${card.height}, ${checked.faces} faces)`);
}

await browser.close();
