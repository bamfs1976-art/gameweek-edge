/*
 * Fetch a real historical FPL season from the open vaastav dataset
 * (github.com/vaastav/Fantasy-Premier-League, MIT licensed) for use as a
 * backtest fixture. Downloads gws/merged_gw.csv — one row per player-fixture,
 * with the real underlying stats AND the realised total_points — which is
 * exactly the ground truth dev/backtest-vaastav.mjs needs to grade the model
 * on real actuals instead of a synthetic generator.
 *
 * Usage:
 *   node dev/fetch-vaastav.mjs [season]      # default 2023-24
 *
 * Writes:
 *   dev/fixtures/vaastav/<season>/merged_gw.csv          (full, gitignored)
 *   dev/fixtures/vaastav/<season>/merged_gw.sample.csv   (trimmed, committed)
 *
 * The committed sample keeps only the columns the backtest uses and a
 * deterministic 1-in-5 slice of players, so a real-data backtest runs in CI
 * with no network. Run this script to pull the full season for a fuller run.
 *
 * NOTE: the FPL/GitHub network may be firewalled in CI — this is a local
 * developer step. The backtest degrades gracefully to the committed sample.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const season = process.argv[2] || '2023-24';
const URL = `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/${season}/gws/merged_gw.csv`;

/* Columns the backtest consumes (see backtest-vaastav.mjs). We deliberately
   DROP vaastav's own `xP` column — its README warns it is filled post-match
   and carries lookahead bias, so it must not leak into a pre-deadline test. */
const KEEP = [
  'element', 'name', 'position', 'GW', 'minutes', 'total_points', 'starts',
  'goals_scored', 'assists', 'bonus', 'saves', 'expected_goals', 'expected_assists',
  'expected_goals_conceded', 'yellow_cards', 'red_cards', 'own_goals', 'penalties_missed',
];
const SAMPLE_MODULO = 5;   /* keep elements where id % 5 === 0 */

function parseCsvLine(line) {
  const out = []; let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f); return out;
}
const csvCell = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

const main = async () => {
  process.stdout.write(`Fetching ${URL}\n`);
  const r = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0 (GameweekEdge backtest)' } });
  if (!r.ok) { console.error(`HTTP ${r.status} — season ${season} not found?`); process.exit(1); }
  const text = await r.text();
  const dir = join(ROOT, 'dev', 'fixtures', 'vaastav', season);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'merged_gw.csv'), text);

  const lines = text.split('\n').filter((l) => l.length);
  const head = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(KEEP.map((k) => [k, head.indexOf(k)]));
  const missing = KEEP.filter((k) => idx[k] < 0);
  if (missing.length) { console.error('Missing expected columns: ' + missing.join(', ')); process.exit(1); }

  const elIdx = idx.element;
  const outRows = [KEEP.join(',')];
  let kept = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const el = parseInt(cells[elIdx], 10);
    if (!Number.isFinite(el) || el % SAMPLE_MODULO !== 0) continue;
    outRows.push(KEEP.map((k) => csvCell(cells[idx[k]] ?? '')).join(','));
    kept++;
  }
  writeFileSync(join(dir, 'merged_gw.sample.csv'), outRows.join('\n') + '\n');
  process.stdout.write(`Wrote full (${lines.length - 1} rows) + sample (${kept} rows, 1-in-${SAMPLE_MODULO} players) to ${dir}\n`);
};
main().catch((e) => { console.error(e); process.exit(1); });
