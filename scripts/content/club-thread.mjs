/*
 * Club preview thread — one club, ready to post.
 *
 *   node scripts/content/club-thread.mjs --club ARS
 *   node scripts/content/club-thread.mjs --all            # every club, one file each
 *   FPL_API=http://127.0.0.1:8700/api/fpl node scripts/content/club-thread.mjs --club ARS
 *
 * Writes scripts/content/threads/<club>.txt (ready to paste, one post per
 * block) and <club>.json (the structured version, for a card later).
 *
 * Like the daily card, every number comes from the SHARED ENGINE. The one
 * that matters most is congestion: these threads live or die on the
 * rotation call, and where the hand-written versions say "monitor preseason
 * lineups", the congestion model has an actual midweek calendar and an
 * actual discount to apply.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEngine, buildIndex, fixtureContext, fetchFpl } from './model.mjs';
import { buildThread } from './club.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'threads');
const API = (process.env.FPL_API || 'https://fantasy.premierleague.com/api').replace(/\/$/, '');
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };
const ALL = process.argv.includes('--all');
const WANT = (arg('club') || '').toUpperCase();

if (!ALL && !WANT) {
  console.error('Usage: node scripts/content/club-thread.mjs --club ARS   (or --all)');
  process.exit(1);
}

const [boot, fixtures] = await Promise.all([
  fetchFpl(API, 'bootstrap-static/'), fetchFpl(API, 'fixtures/')]);
const E = loadEngine();
const idx = buildIndex(boot, fixtures);
E.setRules(E.fplRules(boot));
const { next, runs } = fixtureContext(E, idx);
const teamName = (id) => (idx.teams[id] && (idx.teams[id].short_name || idx.teams[id].name)) || '—';

/* Matches played per club, so minutes security is measured against how much
   football there has actually been rather than against a full season. */
const teamGames = {};
idx.fixtures.filter((f) => f.finished).forEach((f) => {
  teamGames[f.team_h] = (teamGames[f.team_h] || 0) + 1;
  teamGames[f.team_a] = (teamGames[f.team_a] || 0) + 1;
});

/* Season goals for and against, from finished fixtures. */
const goals = {};
idx.fixtures.filter((f) => f.finished).forEach((f) => {
  const h = goals[f.team_h] = goals[f.team_h] || { scored: 0, conceded: 0 };
  const a = goals[f.team_a] = goals[f.team_a] || { scored: 0, conceded: 0 };
  h.scored += f.team_h_score || 0; h.conceded += f.team_a_score || 0;
  a.scored += f.team_a_score || 0; a.conceded += f.team_h_score || 0;
});

/* Congestion: how loaded a club's midweek calendar is over the coming
   window, on 0..1. The app's own euro-fixtures feed is the source when it is
   reachable; without it the honest answer is zero rather than a guess, and
   the thread says "no unusual midweek load in the window we can see". */
async function congestionByTeam() {
  const startGw = (boot.events || []).find((e) => !e.finished)?.id || 1;
  const base = API.replace(/\/api\/fpl$/, '');
  try {
    const r = await fetch(`${base}/api/euro-fixtures?from=${startGw}&n=6`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return {};
    const data = await r.json();
    const per = {};
    (data.rows || []).forEach((row) => {
      const t = Number(row.team ?? row.team_id);
      if (Number.isFinite(t)) per[t] = (per[t] || 0) + 1;
    });
    /* Six extra midweek games in a six-gameweek window is maximal load. */
    Object.keys(per).forEach((t) => { per[t] = Math.min(1, per[t] / 6); });
    return per;
  } catch (_) { return {}; }
}
const congestion = await congestionByTeam();

/* Out-of-position benchmarks are league-wide medians, so they are computed
   once over every player rather than per club. Returns {} when the season is
   too young to have any, and oopFlag then returns null for everyone — the
   angle simply goes unmentioned rather than being guessed at. */
const oopMarks = E.oopBenchmarks(idx.elements);

/* How often a player clears the defensive-contribution threshold in a start.
   The same dcHitProb the expected-points model uses, so the thread and the
   app cannot disagree about whether a centre-back has a floor. */
function defconRate(e) {
  const per90 = parseFloat(e.defensive_contribution_per_90 || '0');
  if (!(per90 > 0)) return null;
  const thr = e.element_type === 2 ? 10 : 12;      /* DEF 10, MID/FWD 12 */
  return E.dcHitProb(per90, thr);
}

/* Set-piece duty, phrased for a thread. angles() has always looked for this
   and nothing ever supplied it, so the tag was unreachable code for as long
   as it existed — twenty clubs generated, never once printed. The duty is
   sitting on the bootstrap: penalties first, because it is the most reliable
   goal in football, then free-kicks, then corners. */
function setPieceNote(e) {
  const sp = E.setPieceConfidence(e);
  if (!sp || !sp.roles.length) return null;
  return sp.roles.join(' and ') + ' — ' + sp.value + '% confidence on the duty';
}

function clubData(teamId) {
  const t = idx.teams[teamId];
  const run = (runs[teamId] || []).slice(0, 6);
  const avgDifficulty = run.length
    ? run.reduce((a, r) => a + r.difficulty, 0) / run.length : null;
  const g = goals[teamId] || {};
  const nf = next[teamId];

  const players = idx.elements
    .filter((e) => e.team === teamId && (e.status === 'a' || !e.status))
    .map((e) => ({
      web_name: e.web_name, element_type: e.element_type, now_cost: e.now_cost,
      minutes: e.minutes || 0, starts: e.starts || 0, goals: e.goals_scored || 0,
      assists: e.assists || 0, teamGames: teamGames[teamId] || 0,
      /* Clean sheets are a return for a defender the way a goal is for a
         forward, so the grade needs them as well as the attacking numbers. */
      cleanSheets: e.clean_sheets || 0,
      xp: nf ? E.nativeXP(e, nf) : null,
      oop: E.oopFlag(e, oopMarks),
      defconRate: defconRate(e),
      setPieces: setPieceNote(e),
      avgDifficulty, congestion: congestion[teamId] || 0
    }))
    /* Anyone with no football behind them cannot be graded honestly. */
    .filter((p) => p.minutes > 0 || p.now_cost >= 45)
    .slice(0, 24);

  /* Pre-season there are no finished fixtures, so a goals tally would be a
     truthful-looking "0 scored, 0 conceded" — which is worse than saying
     nothing, and pre-season is exactly when these threads run. */
  const played = teamGames[teamId] || 0;
  return {
    name: t.short_name || t.name, fullName: t.name,
    scored: played ? (g.scored ?? null) : null,
    conceded: played ? (g.conceded ?? null) : null,
    played,
    avgDifficulty, congestion: congestion[teamId] || 0,
    europe: (congestion[teamId] || 0) > 0.15 ? 'Midweek European' : null,
    fixtures: run.map((r) => ({ gw: r.event, opp: teamName(r.opp), home: r.home,
      difficulty: +r.difficulty.toFixed(1) })),
    players
  };
}

function toText(thread) {
  return thread.posts.map((p, i) =>
    `${i + 1}/${thread.posts.length}  ${p.title}\n\n` +
    p.lines.map((l) => `• ${l}`).join('\n')
  ).join('\n\n———\n\n') + '\n\n#FPL\n';
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const targets = Object.values(idx.teams)
  .filter((t) => ALL || (t.short_name || '').toUpperCase() === WANT ||
    (t.name || '').toUpperCase() === WANT);

if (!targets.length) {
  console.error(`No club matched "${WANT}". Known: ` +
    Object.values(idx.teams).map((t) => t.short_name).join(', '));
  process.exit(1);
}

let wrote = 0;
for (const t of targets) {
  const thread = buildThread(clubData(t.id));
  const slug = (t.short_name || t.name).toLowerCase().replace(/[^a-z0-9]/g, '');
  writeFileSync(join(OUT, slug + '.txt'), toText(thread));
  writeFileSync(join(OUT, slug + '.json'), JSON.stringify(thread, null, 2));
  wrote++;
  if (!ALL) {
    console.log(toText(thread));
    console.log(`— ${thread.graded} assets graded · verdict: ${thread.verdict.verdict}`);
  }
}
if (ALL) console.log(`✓ ${wrote} club threads → ${OUT}`);

/* Why the defensive-floor angle never fires, answered with numbers instead of
   arithmetic done in my head. It has printed nothing across every club we have
   generated, including the two players whose entire case is DEFCON volume, and
   the threshold in club.mjs (0.45) was picked before anyone had seen the real
   distribution. Run with --defcon to see what the league actually looks like. */
if (process.argv.includes('--defcon')) {
  const q = (arr, p) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const named = { 2: 'DEF', 3: 'MID', 4: 'FWD' };
  console.log('\n── defensive contribution, players with 450+ minutes ──');
  for (const t of [2, 3, 4]) {
    const pool = idx.elements.filter((e) => e.element_type === t && (e.minutes || 0) >= 450);
    const per90 = pool.map((e) => parseFloat(e.defensive_contribution_per_90 || '0'));
    const present = per90.filter((v) => v > 0);
    const rates = pool.map(defconRate).filter((v) => v != null);
    const thr = t === 2 ? 10 : 12;
    /* "Empty" and "zero" are different diagnoses with different fixes, and
       dcRate90's fallback only fires on the first — parseFloat('0') is 0, not
       NaN, so a populated zero silently defeats it. */
    const absent = pool.filter((e) => e.defensive_contribution_per_90 == null).length;
    const literalZero = pool.filter((e) => e.defensive_contribution_per_90 != null &&
      parseFloat(e.defensive_contribution_per_90) === 0).length;
    const totals = pool.map((e) => parseInt(e.defensive_contribution, 10) || 0).filter((v) => v > 0);
    console.log(`${named[t]}  n=${pool.length}  with a per-90 figure: ${present.length}`);
    console.log(`   per90 field: absent ${absent}, present-but-zero ${literalZero}`);
    console.log(`   season TOTAL defensive_contribution > 0: ${totals.length}` +
      (totals.length ? `  median ${q(totals, 0.5)}  max ${q(totals, 1)}` : ''));
    if (totals.length) {
      const derived = pool.map((e) => ((parseInt(e.defensive_contribution, 10) || 0) * 90) / (e.minutes || 1))
        .filter((v) => v > 0);
      console.log(`   derived per90 (total*90/mins)  median ${q(derived, 0.5).toFixed(2)}` +
        `  p75 ${q(derived, 0.75).toFixed(2)}  p90 ${q(derived, 0.9).toFixed(2)}  max ${q(derived, 1).toFixed(2)}`);
      const dr = derived.map((v) => E.dcHitProb(v, thr));
      console.log(`   derived dcHitProb  median ${q(dr, 0.5).toFixed(3)}  p90 ${q(dr, 0.9).toFixed(3)}` +
        `  max ${q(dr, 1).toFixed(3)}   clears 0.45: ${dr.filter((r) => r >= 0.45).length}`);
    }
    if (!present.length) { console.log('   no usable per-90 field'); continue; }
    console.log(`   per90  min ${q(present, 0).toFixed(2)}  median ${q(present, 0.5).toFixed(2)}` +
      `  p75 ${q(present, 0.75).toFixed(2)}  p90 ${q(present, 0.9).toFixed(2)}  max ${q(present, 1).toFixed(2)}` +
      `   (threshold ${thr})`);
    console.log(`   dcHitProb  median ${q(rates, 0.5).toFixed(3)}  p75 ${q(rates, 0.75).toFixed(3)}` +
      `  p90 ${q(rates, 0.9).toFixed(3)}  max ${q(rates, 1).toFixed(3)}`);
    for (const bar of [0.30, 0.40, 0.45, 0.55]) {
      console.log(`   clears ${bar.toFixed(2)}: ${rates.filter((r) => r >= bar).length} of ${rates.length}`);
    }
    const top = pool.map((e) => ({ n: e.web_name, r: defconRate(e) })).filter((x) => x.r != null)
      .sort((a, b) => b.r - a.r).slice(0, 5);
    console.log('   highest: ' + top.map((x) => `${x.n} ${x.r.toFixed(2)}`).join(', '));
  }
}
