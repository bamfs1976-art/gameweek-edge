/*
 * Render one Social Studio card to a PNG, from the committed mock data.
 *
 * Written to answer "show me what the card looks like" without a browser,
 * a linked team, or any call to FPL. It serves the same canned bootstrap,
 * fixtures, picks and live payloads dev/test-ui.mjs uses, builds the specs
 * exactly as the studio does, and saves whichever card you name.
 *
 * THE DATA IS THE MOCK FIXTURE, NOT ANYBODY'S REAL TEAM. The names and
 * scores on the output are the harness's, so the picture shows LAYOUT and
 * nothing else. Reading it as a report on a real gameweek would be reading
 * the instrument as the world.
 *
 * Run: node dev/shot-card.mjs [card-id] [outfile]
 *      node dev/shot-card.mjs your-gameweek /tmp/card.png
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'www');
const FIX = join(ROOT, 'dev/fixtures');
const CARD = process.argv[2] || 'your-gameweek';
const OUT = process.argv[3] || join(ROOT, 'card.png');
const PORT = 8099;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const picksFixture = () => JSON.parse(readFileSync(join(FIX, 'fpl-mock-picks.json'), 'utf8'));
const LIVE_MISSING = picksFixture().picks.find((p) => p.position === 3).element;
/* Same derivation as the test harness, so the picture matches what the
   suite asserts rather than a second, prettier set of numbers. */
const liveBody = () => JSON.stringify({
  elements: picksFixture().picks
    .filter((p) => p.element !== LIVE_MISSING)
    .map((p, i) => ({ id: p.element, stats: {
      total_points: 2, bps: 40 - i,
      bonus: i === 0 ? 3 : i === 1 ? 2 : i === 2 ? 1 : 0,
      defensive_contribution: i % 2 === 0 ? 12 : 4, minutes: 90,
    } })),
});
const entryBody = (id) => JSON.stringify({ id: Number(id), name: 'Real Treforys',
  player_first_name: 'A', player_last_name: 'Manager', summary_overall_points: 120 });

const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const json = (s) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(s); };
  if (p === '/api/fpl/bootstrap-static') return json(readFileSync(join(FIX, 'fpl-mock-bootstrap.json')));
  if (p === '/api/fpl/fixtures') return json(readFileSync(join(FIX, 'fpl-mock-fixtures.json')));
  if (/^\/api\/fpl\/entry\/\d+$/.test(p)) return json(entryBody(p.split('/').pop()));
  if (/^\/api\/fpl\/event\/\d+\/live$/.test(p)) return json(liveBody());
  if (/^\/api\/fpl\/entry\/\d+\/event\/\d+\/picks$/.test(p)) return json(readFileSync(join(FIX, 'fpl-mock-picks.json')));
  let f = p === '/' ? '/index.html' : p;
  const abs = join(WWW, f);
  if (!existsSync(abs) || !extname(abs)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(abs)] || 'text/plain' });
  res.end(readFileSync(abs));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  .catch(() => chromium.launch());
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const out = await page.evaluate(async (id) => {
  const b = await boot();
  const fixtures = await loadFixtures();
  const ev = b.events.filter((e) => e.data_checked).pop();
  if (!ev) return { err: 'no scored gameweek in the fixture' };
  const live = await loadLive(ev.id);
  const me = await socMeGw(ev.id).catch(() => null);
  const specs = socialSpecs(b, fixtures, live, me);
  const spec = specs.find((s) => s.id === id);
  if (!spec) return { err: 'card "' + id + '" did not build. Built: ' + specs.map((s) => s.id).join(', ') };
  /* Photos and crests are fetched by the studio before it draws; without
     this the discs render empty and the picture misrepresents the card. */
  try { await socPreloadImages([spec]); } catch (_) {}
  const cv = renderSocialCard(spec, 1);
  return { err: null, title: spec.title, png: cv.toDataURL('image/png') };
}, CARD);

await browser.close();
server.close();
if (out.err) { console.error('FAILED: ' + out.err); process.exit(1); }
writeFileSync(OUT, Buffer.from(out.png.split(',')[1], 'base64'));
console.log('wrote ' + OUT + '  —  "' + out.title + '"');
if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
console.log('NOTE: mock fixture data. This shows the layout, not a real gameweek.');
