/*
 * Point-in-time FPL availability flags for past seasons, from fplcache
 * (github.com/Randdalf/fplcache, public domain): the bootstrap-static
 * response, cached four times a day since April 2021.
 *
 * For every gameweek of a season this takes the LAST snapshot taken before
 * the deadline (first kickoff minus 90 minutes, read off the vaastav rows)
 * and keeps, for every player who carried a flag, his status and his
 * chance of playing. That is what a manager could see at the deadline, which
 * is exactly what the minutes model may learn from: no lookahead.
 *
 *   git clone --filter=blob:none --no-checkout https://github.com/Randdalf/fplcache.git <dir>
 *   node dev/fetch-flags.mjs <dir> 2022-23 2023-24 2024-25 2025-26
 *
 * Writes dev/fixtures/flags/<season>.json (committed, small):
 *   { source, gws: { "<gw>": { snapshot, flags: { "<element>": [status, chance] } } } }
 * Unflagged players (status 'a', no chance set) are omitted.
 *
 * Needs `git` and `xz` on the path. Blobs are fetched on demand, about
 * 150 snapshots per season.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRows } from './minutes-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [cacheDir, ...seasons] = process.argv.slice(2);
if (!cacheDir || !seasons.length) { console.error('usage: node dev/fetch-flags.mjs <fplcache clone> <season>...'); process.exit(1); }

const git = (...a) => execFileSync('git', ['-C', cacheDir, ...a], { maxBuffer: 1 << 28 });
const files = git('ls-tree', '-r', '--name-only', 'HEAD', 'cache').toString().split('\n').filter((f) => f.endsWith('.json.xz'));
/* cache/YYYY/M/D/HHMM.json.xz, UTC (the GitHub Action's clock). */
const snaps = files.map((f) => {
  const m = f.match(/cache\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{2})(\d{2})\.json\.xz$/);
  return m ? { f, t: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) } : null;
}).filter(Boolean).sort((a, b) => a.t - b.t);

function readSnap(f) {
  const xz = git('show', 'HEAD:' + f);
  return JSON.parse(execFileSync('xz', ['-dc'], { input: xz, maxBuffer: 1 << 28 }).toString());
}

for (const season of seasons) {
  const csv = join(ROOT, 'dev', 'fixtures', 'vaastav', season, 'merged_gw.csv');
  if (!existsSync(csv)) { console.error(`missing ${csv}: run node dev/fetch-vaastav.mjs ${season}`); continue; }
  const firstKick = {};
  for (const r of loadRows(csv)) { const t = Date.parse(r.t); if (!firstKick[r.gw] || t < firstKick[r.gw]) firstKick[r.gw] = t; }
  const out = { source: 'github.com/Randdalf/fplcache (public domain), last snapshot before each deadline', gws: {} };
  let kept = 0;
  for (const gw of Object.keys(firstKick).map(Number).sort((a, b) => a - b)) {
    const deadline = firstKick[gw] - 90 * 60e3;
    let pick = null;
    for (const s of snaps) { if (s.t <= deadline) pick = s; else break; }
    /* A snapshot more than two days old is not "what a manager saw". */
    if (!pick || deadline - pick.t > 2 * 864e5) { console.log(`  ${season} GW${gw}: no snapshot within two days of the deadline, skipped`); continue; }
    const boot = readSnap(pick.f);
    const flags = {};
    for (const e of boot.elements || []) {
      const ch = e.chance_of_playing_next_round;
      if (e.status !== 'a' || ch != null) flags[e.id] = [e.status, ch == null ? null : ch];
    }
    out.gws[gw] = { snapshot: new Date(pick.t).toISOString(), flags };
    kept += Object.keys(flags).length;
  }
  mkdirSync(join(ROOT, 'dev', 'fixtures', 'flags'), { recursive: true });
  writeFileSync(join(ROOT, 'dev', 'fixtures', 'flags', season + '.json'), JSON.stringify(out));
  console.log(`• ${season}: ${Object.keys(out.gws).length} gameweeks, ${kept} player flags`);
}
