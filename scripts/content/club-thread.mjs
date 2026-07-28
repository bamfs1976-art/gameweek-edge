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
