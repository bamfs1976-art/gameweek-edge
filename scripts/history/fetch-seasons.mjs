/* Downloads every available season of the open vaastav FPL dataset into
 * dev/fixtures/vaastav/<season>/ for the history reducer and the multi-season
 * backtest to consume.
 *
 * Two files per season:
 *   merged_gw.csv   one row per player-fixture (the gameweek record)
 *   players_raw.csv one row per player (carries `code`, the stable cross-season
 *                   player id, plus element_type — which merged_gw lacks before
 *                   2022-23, so this is also how older seasons get positions)
 *
 * Both are gitignored. What gets committed is the reduced artefact built by
 * build-history.mjs, not the ~200MB of source CSV.
 *
 * Usage:
 *   node scripts/history/fetch-seasons.mjs              # all seasons, skip cached
 *   node scripts/history/fetch-seasons.mjs 2023-24      # one season
 *   node scripts/history/fetch-seasons.mjs --force      # re-download everything
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEASONS, RAW_BASE, UA } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'dev', 'fixtures', 'vaastav');

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const only = argv.filter((a) => !a.startsWith('--'));
const seasons = only.length ? only : SEASONS;

const FILES = ['merged_gw.csv', 'players_raw.csv'];
const urlFor = (season, file) =>
  file === 'merged_gw.csv'
    ? `${RAW_BASE}/${season}/gws/merged_gw.csv`
    : `${RAW_BASE}/${season}/${file}`;

async function get(url, attempt = 1) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status === 404) return null;            /* season not published yet */
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    /* The dataset lives on raw.githubusercontent, which rate-limits and can be
       firewalled entirely in some CI networks. Back off, then give up quietly
       so a partial fetch still builds. */
    if (attempt >= 4) throw e;
    const wait = 2 ** attempt * 1000;
    process.stdout.write(`  retry ${attempt} in ${wait / 1000}s (${e.message})\n`);
    await new Promise((res) => setTimeout(res, wait));
    return get(url, attempt + 1);
  }
}

const main = async () => {
  let fetched = 0, cached = 0, missing = 0;

  /* One global file: maps (season, team id) → club name, which is how a
     promoted club is identified when building its first-season prior. */
  mkdirSync(OUT, { recursive: true });
  const teamList = join(OUT, 'master_team_list.csv');
  if (force || !existsSync(teamList)) {
    process.stdout.write('master_team_list.csv … ');
    const text = await get(`${RAW_BASE}/master_team_list.csv`);
    if (text === null) { process.stdout.write('not published\n'); missing++; }
    else { writeFileSync(teamList, text); process.stdout.write('ok\n'); fetched++; }
  } else cached++;

  for (const season of seasons) {
    const dir = join(OUT, season);
    mkdirSync(dir, { recursive: true });
    for (const file of FILES) {
      const dest = join(dir, file);
      if (!force && existsSync(dest) && statSync(dest).size > 1024) {
        cached++;
        continue;
      }
      process.stdout.write(`${season}/${file} … `);
      const text = await get(urlFor(season, file));
      if (text === null) {
        process.stdout.write('not published\n');
        missing++;
        continue;
      }
      writeFileSync(dest, text);
      process.stdout.write(`${(text.length / 1e6).toFixed(1)}MB\n`);
      fetched++;
    }
  }
  process.stdout.write(
    `\nFetched ${fetched}, cached ${cached}, unavailable ${missing}. → ${OUT}\n`,
  );
};

main().catch((e) => { console.error(e); process.exit(1); });
