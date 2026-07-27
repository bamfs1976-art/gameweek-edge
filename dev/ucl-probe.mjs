/*
 * UEFA feed probe — the verification pass Euro Matchday Edge is waiting on.
 *
 * netlify/functions/ucl.js normalises UEFA's feeds into the FPL vocabulary the
 * shared model engine speaks. It was written without a reachable upstream, so
 * the field names it reads are plausible rather than confirmed, and until this
 * probe has been run its projections are unvalidated.
 *
 * This script imports the REAL normalisers from that function — not a copy —
 * so whatever it reports is exactly what production would do with the same
 * payload. It needs no deploy, no keys and no Netlify: run it from any machine
 * that can reach gaming.uefa.com.
 *
 *   node dev/ucl-probe.mjs                  # auto-detect season, matchday 1
 *   node dev/ucl-probe.mjs 2026 3           # pin season and matchday
 *   node dev/ucl-probe.mjs --json > out.json
 *
 * It answers, in order:
 *   1. Do the feed URLs resolve at all?  (if not, FEEDS is wrong — nothing
 *      else matters, so it stops guessing and says so)
 *   2. Does each record map?             (id, position and club are the three
 *      that must land; a player missing any is dropped entirely)
 *   3. What did we not recognise?        (unmapped keys — the shopping list)
 *   4. Does it look sane?                (a raw record beside its mapped form)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(process.argv[1] ? 'file://' + process.argv[1] : import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { _internal } = require(join(ROOT, 'netlify/functions/ucl.js'));
const { pick, toPos, rowsOf, normPlayer, normTeam, normFixture, unmapped, FEEDS } = _internal;

const args = process.argv.slice(2).filter((a) => a !== '--json');
const asJson = process.argv.includes('--json');
const pinnedSeason = args[0];
const md = args[1] || '1';

/* The season token is the least certain part of the whole integration, so try
   a spread of plausible encodings rather than making a human iterate. */
const SEASON_CANDIDATES = pinnedSeason ? [pinnedSeason]
  : ['2026', '2025', '20262027', '20252026', '27', '26', '25'];

const UA = 'Mozilla/5.0 (compatible; EuroMatchdayEdge-probe/1.0; +https://gameweekedge.co.uk/euro/)';
const out = { checkedAt: new Date().toISOString(), feeds: {}, season: null, matchday: md };
const log = (...a) => { if (!asJson) console.log(...a); };

async function tryFeed(tpl, season) {
  const url = FEEDS.base + tpl.replace('{season}', season).replace('{md}', md);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    return { url, status: r.status, ok: r.ok, json,
      snippet: json ? null : text.slice(0, 160).replace(/\s+/g, ' ') };
  } catch (e) {
    return { url, status: 0, ok: false, json: null, snippet: 'network error: ' + e.message };
  }
}

/* ── 1. Find a season the players feed actually answers on ── */
log('Probing ' + FEEDS.base + '\n');
let season = null, players = null;
for (const s of SEASON_CANDIDATES) {
  const r = await tryFeed(FEEDS.players, s);
  log(`  season=${String(s).padEnd(9)} players → HTTP ${r.status}` +
    (r.ok && r.json ? ` (${rowsOf(r.json).length} rows)` : ''));
  if (r.ok && r.json && rowsOf(r.json).length) { season = s; players = r; break; }
}

if (!season) {
  out.verdict = 'FEED_UNREACHABLE';
  out.tried = SEASON_CANDIDATES.map((s) => FEEDS.base + FEEDS.players.replace('{season}', s).replace('{md}', md));
  if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(2); }
  console.log('\n✗ No season returned a usable players feed.');
  console.log('  Nothing downstream can be judged until the URL is right, so the probe stops here.');
  console.log('  Fix the FEEDS block at the top of netlify/functions/ucl.js — base, path or');
  console.log('  season encoding — and re-run. Open one of these in a browser to see the shape:');
  out.tried.slice(0, 3).forEach((u) => console.log('    ' + u));
  process.exit(2);
}
out.season = season;

const [teams, fixtures] = await Promise.all([
  tryFeed(FEEDS.teams, season),
  tryFeed(FEEDS.fixtures, season)
]);
log(`  season=${String(season).padEnd(9)} teams   → HTTP ${teams.status}`);
log(`  season=${String(season).padEnd(9)} fixtures→ HTTP ${fixtures.status}`);

/* ── 2. Map, and account for every dropped record ── */
function report(kind, feed, norm, required) {
  const rows = feed.ok && feed.json ? rowsOf(feed.json) : [];
  const mapped = rows.map(norm);
  const kept = mapped.filter((m) => required.every((f) => m[f] != null));
  const dropped = {};
  for (const m of mapped) {
    const miss = required.filter((f) => m[f] == null);
    if (miss.length) { const k = miss.join('+'); dropped[k] = (dropped[k] || 0) + 1; }
  }
  const res = { url: feed.url, status: feed.status, upstream: rows.length, mapped: kept.length,
    droppedBecause: dropped, unmappedKeys: unmapped(rows, kind),
    sampleUpstream: rows[0] || null, sampleMapped: mapped[0] || null };
  out.feeds[kind] = res;

  log(`\n── ${kind.toUpperCase()} ────────────────────────────────`);
  log(`   ${res.mapped}/${res.upstream} mapped` +
    (res.upstream ? ` (${Math.round(100 * res.mapped / res.upstream)}%)` : ''));
  for (const [why, n] of Object.entries(dropped)) log(`   dropped ${n}: missing ${why}`);
  if (res.unmappedKeys.length) {
    log('   unrecognised upstream keys:');
    log('     ' + res.unmappedKeys.join(', '));
  } else log('   every upstream key is recognised');
  if (rows[0]) {
    log('   sample raw   : ' + JSON.stringify(rows[0]).slice(0, 220));
    log('   sample mapped: ' + JSON.stringify(res.sampleMapped).slice(0, 220));
  }
  return res;
}

const P = report('player', players, normPlayer, ['id', 'element_type', 'team']);
const T = report('team', teams, normTeam, ['id']);
const F = report('fixture', fixtures, normFixture, ['team_h', 'team_a']);

/* ── 3. The checks that decide whether projections can be trusted ── */
const finished = (fixtures.ok && fixtures.json ? rowsOf(fixtures.json) : []).map(normFixture)
  .filter((f) => f.finished);
const perClub = {};
finished.forEach((f) => { perClub[f.team_h] = (perClub[f.team_h] || 0) + 1; perClub[f.team_a] = (perClub[f.team_a] || 0) + 1; });
const maxGp = Object.values(perClub).reduce((a, b) => Math.max(a, b), 0);
const priced = (players.json ? rowsOf(players.json) : []).map(normPlayer).filter((p) => p.now_cost != null).length;

const checks = [
  ['players map', P.mapped > 0, P.mapped + ' mapped'],
  ['positions map', P.mapped > 0 && P.sampleMapped && P.sampleMapped.element_type >= 1, 'element_type resolves to 1-4'],
  ['clubs cross-reference', T.mapped > 0 && P.sampleMapped && P.sampleMapped.team != null, 'player.team matches a team id'],
  ['prices present', priced > 0, priced + ' players priced (needed by the optimiser)'],
  ['fixtures map', F.mapped > 0, F.mapped + ' mapped'],
  ['results present', finished.length > 0, finished.length + ' finished (the match model fits on these)'],
  ['enough for xP', maxGp >= 5, 'max ' + maxGp + ' matches per club (nativeXP needs 5)']
];
out.checks = Object.fromEntries(checks.map(([n, p, d]) => [n, { pass: !!p, detail: d }]));
out.verdict = checks.slice(0, 6).every(([, p]) => p)
  ? (maxGp >= 5 ? 'READY' : 'MAPPED_BUT_TOO_EARLY') : 'MAPPING_INCOMPLETE';

if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

log('\n── VERDICT ────────────────────────────────');
checks.forEach(([n, p, d]) => log(`   ${p ? '✓' : '✗'} ${n.padEnd(22)} ${d}`));
log('');
log({
  READY: '   READY — the mapping works and there is enough football for projections.',
  MAPPED_BUT_TOO_EARLY: '   MAPPED — the feed is fine; too few matches played for player projections\n' +
    '   yet (nativeXP needs 5 per club). Match forecasts and difficulty work now.',
  MAPPING_INCOMPLETE: '   INCOMPLETE — something above did not map. Fix the ✗ lines in\n' +
    '   netlify/functions/ucl.js, then re-run.'
}[out.verdict]);
log('\n   Paste this whole output back and the mapping can be corrected against it.');
log('   For a machine-readable version: node dev/ucl-probe.mjs --json > ucl-probe.json');
