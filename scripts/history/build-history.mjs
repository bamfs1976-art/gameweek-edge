/* Reduces ten seasons of raw vaastav gameweek CSV (~45MB) to one compact
 * derived artefact: data/fpl-history.json.
 *
 * The rule this file exists to enforce: the browser never sees a gameweek row.
 * ~250k player-fixture records become ~4k player careers, each a fixed-order
 * numeric array per season. Arrays rather than objects because the key names
 * would otherwise outweigh the data several times over.
 *
 * What it deliberately does NOT do:
 *   - It does not read vaastav's `xP` column. That column is filled in after
 *     the match (its own README says so), so anything derived from it carries
 *     lookahead bias. dev/fetch-vaastav.mjs drops it for the same reason.
 *   - It does not compute priors, weights or projections. Those are modelling
 *     decisions and belong with the model, not the dataset. This file emits
 *     facts; scripts/history/priors.mjs turns facts into a prior.
 *
 * Usage:
 *   node scripts/history/fetch-seasons.mjs     # once
 *   node scripts/history/build-history.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEASONS, parseCsv, num, str, normName, detectEra, POS } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'dev', 'fixtures', 'vaastav');
const OUT_DIR = join(ROOT, 'data');
const OUT = join(OUT_DIR, 'fpl-history.json');

/* Fixed column order for each season's numeric array. Consumers read this
   from the artefact's own `cols` field rather than hardcoding it, so adding a
   column here does not silently shift meaning downstream. */
const COLS = [
  'm',    /* minutes                                            */
  'ap',   /* appearances (minutes > 0)                          */
  'st',   /* starts — 0 before 2022-23, see era.starts          */
  'pts',  /* total points                                       */
  'p2',   /* sum of squared per-appearance points (→ sd)        */
  'g', 'a', 'cs', 'gc', 'bo', 'sv', 'yc', 'rc', 'og', 'pm', 'ps',
  'xg',   /* expected goals — 0 before 2022-23, see era.xg      */
  'xa',
  'xgc',
  'dc',   /* defensive contribution — 2025-26 only, see era.defcon */
  'v0',   /* price at first appearance, tenths of £m            */
  'v1',   /* price at last appearance                           */
  'hp', 'hap',  /* home points / home appearances               */
  'awp', 'awap',/* away points / away appearances               */
  'r10',  /* gameweeks returning >= 10 points (a haul)          */
  'r5',   /* gameweeks returning >= 5 points (a return)         */
  'bl',   /* appearances returning <= 2 points (a blank)        */
  'mx',   /* best single gameweek                               */
  'pos',  /* element_type that season (positions get reclassified) */
  'tm',   /* team id that season                                */
];
const C = Object.fromEntries(COLS.map((c, i) => [c, i]));

const round = (n, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/* ── Team names ──────────────────────────────────────────────────────── */

function loadTeams() {
  const p = join(SRC, 'master_team_list.csv');
  if (!existsSync(p)) return {};
  const { index, rows } = parseCsv(readFileSync(p, 'utf8'));
  const out = {};
  for (const r of rows) {
    const season = str(r[index.season]);
    const id = num(r[index.team]);
    const name = str(r[index.team_name]);
    if (!season || !id) continue;
    (out[season] ||= {})[id] = name;
  }
  return out;
}

/* ── Per-season ingest ───────────────────────────────────────────────── */

/* players_raw.csv is the identity spine: element (per-season id) → code (the
   permanent FPL player id) plus element_type and team. merged_gw.csv before
   2022-23 has neither position nor team, so this is not optional. */
function loadRoster(season) {
  const p = join(SRC, season, 'players_raw.csv');
  if (!existsSync(p)) return null;
  const { index, rows } = parseCsv(readFileSync(p, 'utf8'));
  const need = ['id', 'code', 'element_type', 'first_name', 'second_name'];
  for (const k of need) {
    if (index[k] === undefined) {
      throw new Error(`${season}/players_raw.csv missing column '${k}'`);
    }
  }
  const byElement = new Map();
  for (const r of rows) {
    const id = num(r[index.id]);
    const code = num(r[index.code]);
    if (!id || !code) continue;
    byElement.set(id, {
      code,
      pos: num(r[index.element_type]),
      team: index.team !== undefined ? num(r[index.team]) : 0,
      name: normName(`${str(r[index.first_name])} ${str(r[index.second_name])}`),
    });
  }
  return byElement;
}

function blankSeason() {
  const a = new Array(COLS.length).fill(0);
  a[C.v0] = 0; a[C.v1] = 0;
  return a;
}

function ingestSeason(season, players, teams) {
  const gwPath = join(SRC, season, 'merged_gw.csv');
  if (!existsSync(gwPath)) return null;
  const roster = loadRoster(season);
  if (!roster) return null;

  const { header, index, rows } = parseCsv(readFileSync(gwPath, 'utf8'));
  const era = detectEra(header);
  const gwCol = index.GW !== undefined ? index.GW : index.round;

  /* Count DISTINCT gameweeks, not the highest number. 2019-20 ran 1-29 then
     jumped to 39-47 after the COVID suspension, so its max is 47 while it is
     still a normal 38-gameweek season. */
  const gwSeen = new Set();
  let maxGw = 0, unmatched = 0, seen = 0;
  /* First appearance wins v0, last wins v1 — so the pair brackets the
     player's price journey without storing a per-gameweek series. */
  const firstGw = new Map(), lastGw = new Map();

  for (const r of rows) {
    const el = num(r[index.element]);
    const info = roster.get(el);
    if (!info) { unmatched++; continue; }
    seen++;

    const code = info.code;
    let p = players.get(code);
    if (!p) {
      p = { c: code, n: info.name, p: info.pos, s: {} };
      players.set(code, p);
    }
    /* Later seasons overwrite: the current name and position are the ones a
       user searching in 2026-27 will recognise. */
    p.n = info.name || p.n;
    p.p = info.pos || p.p;

    const s = (p.s[season] ||= blankSeason());
    const gw = num(r[gwCol]);
    gwSeen.add(gw);
    if (gw > maxGw) maxGw = gw;

    const mins = num(r[index.minutes]);
    const pts = num(r[index.total_points]);
    const val = num(r[index.value]);
    const home = str(r[index.was_home]).toLowerCase() === 'true';

    s[C.m] += mins;
    s[C.pts] += pts;
    s[C.g] += num(r[index.goals_scored]);
    s[C.a] += num(r[index.assists]);
    s[C.cs] += num(r[index.clean_sheets]);
    s[C.gc] += num(r[index.goals_conceded]);
    s[C.bo] += num(r[index.bonus]);
    s[C.sv] += num(r[index.saves]);
    s[C.yc] += num(r[index.yellow_cards]);
    s[C.rc] += num(r[index.red_cards]);
    s[C.og] += num(r[index.own_goals]);
    s[C.pm] += num(r[index.penalties_missed]);
    s[C.ps] += num(r[index.penalties_saved]);
    if (era.starts) s[C.st] += num(r[index.starts]);
    if (era.xg) {
      s[C.xg] += num(r[index.expected_goals]);
      s[C.xa] += num(r[index.expected_assists]);
    }
    if (era.xgc) s[C.xgc] += num(r[index.expected_goals_conceded]);
    if (era.defcon) s[C.dc] += num(r[index.defensive_contribution]);

    if (pts >= 10) s[C.r10]++;
    if (pts >= 5) s[C.r5]++;
    if (pts > s[C.mx]) s[C.mx] = pts;

    /* Only played gameweeks count toward appearance-based rates. An unused
       sub scoring 0 is not a blank — it is an absence, and folding the two
       together would make every rotation risk look like a bad player. */
    if (mins > 0) {
      s[C.ap]++;
      s[C.p2] += pts * pts;
      if (pts <= 2) s[C.bl]++;
      if (home) { s[C.hp] += pts; s[C.hap]++; }
      else { s[C.awp] += pts; s[C.awap]++; }
    }

    if (val > 0) {
      const fk = `${code}`;
      if (!firstGw.has(fk) || gw < firstGw.get(fk)) { firstGw.set(fk, gw); s[C.v0] = val; }
      if (!lastGw.has(fk) || gw >= lastGw.get(fk)) { lastGw.set(fk, gw); s[C.v1] = val; }
    }

    s[C.pos] = info.pos;
    s[C.tm] = info.team;
  }

  return {
    era,
    gws: gwSeen.size,
    maxGw,
    rows: seen,
    unmatched,
    teams: teams[season] || {},
  };
}

/* ── Build ───────────────────────────────────────────────────────────── */

const main = () => {
  const teams = loadTeams();
  const players = new Map();
  const seasons = {};

  for (const season of SEASONS) {
    const meta = ingestSeason(season, players, teams);
    if (!meta) { process.stdout.write(`${season}: no data, skipped\n`); continue; }
    seasons[season] = {
      era: meta.era,
      gws: meta.gws,
      teams: meta.teams,
    };
    /* Flag any season whose gameweek numbering is not 1..n, so a consumer
       plotting by gameweek number knows there is a gap. */
    if (meta.maxGw !== meta.gws) seasons[season].gwGap = meta.maxGw;
    const flags = Object.entries(meta.era).filter(([, v]) => v).map(([k]) => k).join(',') || 'basic';
    process.stdout.write(
      `${season}: ${meta.rows.toLocaleString()} rows, ${meta.gws} GWs, era[${flags}]` +
      (meta.unmatched ? `, ${meta.unmatched} unmatched` : '') + '\n',
    );
  }

  /* Drop the long tail. A player with under 90 career minutes cannot support
     any per-90 rate worth showing, and they are more than half the rows. */
  const MIN_CAREER_MINUTES = 90;
  const kept = [];
  for (const p of players.values()) {
    let mins = 0;
    for (const s of Object.values(p.s)) mins += s[C.m];
    if (mins < MIN_CAREER_MINUTES) continue;
    for (const key of Object.keys(p.s)) {
      const a = p.s[key];
      if (a[C.m] <= 0 && a[C.ap] <= 0) { delete p.s[key]; continue; }
      for (let i = 0; i < a.length; i++) a[i] = round(a[i]);
    }
    if (Object.keys(p.s).length) kept.push(p);
  }
  kept.sort((a, b) => a.c - b.c);

  const artefact = {
    v: 1,
    built: new Date().toISOString().slice(0, 10),
    source: {
      name: 'vaastav/Fantasy-Premier-League',
      url: 'https://github.com/vaastav/Fantasy-Premier-League',
      licence: 'MIT',
      note: "vaastav's own xP column is deliberately not read — it is filled post-match and would carry lookahead bias.",
    },
    cols: COLS,
    seasons,
    players: kept,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(artefact));
  const bytes = statSizeOf(OUT);

  process.stdout.write(
    `\n${kept.length.toLocaleString()} careers → ${OUT} (${(bytes / 1e6).toFixed(2)}MB)\n`,
  );

  /* Sanity: if the code-based join were broken, careers would fragment and
     the all-time list would be full of one-season players. */
  const top = kept
    .map((p) => ({
      n: p.n,
      pts: Object.values(p.s).reduce((t, s) => t + s[C.pts], 0),
      seasons: Object.keys(p.s).length,
    }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 8);
  process.stdout.write('\nAll-time points (join sanity check):\n');
  for (const t of top) {
    process.stdout.write(`  ${String(t.pts).padStart(5)}  ${t.n} (${t.seasons} seasons)\n`);
  }
};

function statSizeOf(p) {
  return readFileSync(p).length;
}

main();
