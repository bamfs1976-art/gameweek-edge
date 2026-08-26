/*
 * Render EVERY studio card and report which ones throw.
 *
 * The gallery paints each preview inside `try{...}catch(_){}`, so a card
 * whose renderer throws leaves an empty box and says nothing — the same
 * silent-swallow the spec builders have, one layer down. Reported: all 25
 * cards build, and they do not display.
 *
 * This builds the specs exactly as the studio does, renders each one, and
 * prints the error for the ones that fail. Mock fixtures, no network.
 *
 * Run: node dev/shot-all.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'www'), FIX = join(ROOT, 'dev/fixtures');
const PORT = 8098;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const picksFixture = () => JSON.parse(readFileSync(join(FIX, 'fpl-mock-picks.json'), 'utf8'));
const LIVE_MISSING = picksFixture().picks.find((p) => p.position === 3).element;
const liveBody = () => JSON.stringify({
  elements: picksFixture().picks.filter((p) => p.element !== LIVE_MISSING)
    .map((p, i) => ({ id: p.element, stats: { total_points: 2, bps: 40 - i,
      bonus: i === 0 ? 3 : i === 1 ? 2 : i === 2 ? 1 : 0,
      defensive_contribution: i % 2 === 0 ? 12 : 4, minutes: 90 } })) });

const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const json = (s) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(s); };
  if (p === '/api/fpl/bootstrap-static') return json(readFileSync(join(FIX, 'fpl-mock-bootstrap.json')));
  if (p === '/api/fpl/fixtures') return json(readFileSync(join(FIX, 'fpl-mock-fixtures.json')));
  if (/^\/api\/fpl\/entry\/\d+$/.test(p)) return json(JSON.stringify({ id: 1, name: 'Real Treforys' }));
  if (/^\/api\/fpl\/event\/\d+\/live$/.test(p)) return json(liveBody());
  if (/^\/api\/fpl\/entry\/\d+\/event\/\d+\/picks$/.test(p)) return json(readFileSync(join(FIX, 'fpl-mock-picks.json')));
  const abs = join(WWW, p === '/' ? '/index.html' : p);
  if (!existsSync(abs) || !extname(abs)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(abs)] || 'text/plain' });
  res.end(readFileSync(abs));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  .catch(() => chromium.launch());
const page = await browser.newPage();
await page.addInitScript(() => { try { localStorage.setItem('ge-mid', '1234567'); } catch (_) {} });
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const b = await boot();
  const fixtures = await loadFixtures();
  const ev = b.events.filter((e) => e.data_checked).pop();
  const live = ev ? await loadLive(ev.id) : null;
  const me = ev ? await socMeGw(ev.id).catch(() => null) : null;
  let specs;
  try { specs = socialSpecs(b, fixtures, live, me); } catch (e) { return { err: e.message }; }
  try { await socPreloadImages(specs); } catch (_) {}
  /* Render at the SAME scale the gallery uses, because a bug that only
     bites at a fraction is still a bug the reader sees. */
  return { err: null, n: specs.length, rows: specs.map((sp) => {
    try { const cv = renderSocialCard(sp, 0.34); return { id: sp.id, kind: sp.kind, ok: !!cv, w: cv.width, h: cv.height }; }
    catch (e) { return { id: sp.id, kind: sp.kind, ok: false, err: String(e && e.message || e) }; }
  }) };
});

await browser.close();
server.close();
if (out.err) { console.error('specs failed to build: ' + out.err); process.exit(1); }
const bad = out.rows.filter((r) => !r.ok);
console.log(out.n + ' specs built, ' + (out.n - bad.length) + ' rendered, ' + bad.length + ' threw');
console.log('');
for (const r of out.rows) console.log('  ' + (r.ok ? 'ok    ' : 'THREW ') + r.id.padEnd(22) + (r.kind || '').padEnd(10) + (r.err || (r.w + 'x' + r.h)));
process.exit(bad.length ? 1 : 0);
