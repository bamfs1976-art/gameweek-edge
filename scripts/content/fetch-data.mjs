/*
 * Daily content — build today's candidates and pick the story.
 *
 * Writes scripts/content/content.json (the chosen story plus the data the
 * card needs) and updates scripts/content/history.json so tomorrow's run
 * knows what today said.
 *
 *   node scripts/content/fetch-data.mjs
 *   FPL_API=http://127.0.0.1:8700/api/fpl node scripts/content/fetch-data.mjs
 *
 * The candidates are computed with the SHARED ENGINE — the same nativeXP,
 * plsimRatings and fixture-difficulty code that ships in the app, lifted out
 * of index.html at run time. That is deliberate and non-negotiable: content
 * that disagreed with the app would be worse than no content, and the only
 * way to guarantee it cannot is to run the identical functions rather than a
 * convenient reimplementation.
 *
 * Exits 0 and writes `published=false` when nothing clears the bar. A quiet
 * day is a correct outcome, not a failure, and the workflow reads that flag
 * rather than treating silence as a broken run.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { buildEngine } from '../extract-engine.mjs';
import { selectStory, remember } from './stories.mjs';
import { priceVerdicts, differentials, templateRisks, valuePicks, purplePatches, fixtureSwings }
  from './candidates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const API = (process.env.FPL_API || 'https://fantasy.premierleague.com/api').replace(/\/$/, '');
const OUT = join(HERE, 'content.json');
const HISTORY = join(HERE, 'history.json');
const NOW = Date.now();


async function get(path) {
  const r = await fetch(`${API}/${path}`, {
    headers: { 'User-Agent': 'gameweek-edge-content/1.0', Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

/* ── the shared engine ─────────────────────────────────────────── */
function loadEngine() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  new vm.Script(buildEngine(readFileSync(join(ROOT, 'index.html'), 'utf8'))).runInContext(ctx);
  return ctx.window.GEEngine;
}

/* ── the index the engine expects ──────────────────────────────── */
function buildIndex(boot, fixtures) {
  const teams = {};
  (boot.teams || []).forEach((t) => { teams[t.id] = t; });
  return { raw: boot, teams, elements: boot.elements || [], fixtures: fixtures || [],
    events: boot.events || [] };
}

/* Each club's next unplayed fixture in the shape nativeXP wants, plus the
   run of fixtures after it for the swing and purple-patch stories. */
function fixtureContext(E, idx) {
  const R = E.plsimRatings(idx, idx.fixtures);
  const BM = (E.PLSIM.BASE_H + E.PLSIM.BASE_A) / 2;
  const played = {};
  idx.fixtures.filter((f) => f.finished).forEach((f) => {
    played[f.team_h] = (played[f.team_h] || 0) + 1;
    played[f.team_a] = (played[f.team_a] || 0) + 1;
  });

  const upcoming = idx.fixtures.filter((f) => !f.finished && f.event != null)
    .sort((a, b) => a.event - b.event);
  const runs = {};                       /* team → [{event, difficulty, opp, home}] */
  const next = {};
  for (const f of upcoming) {
    const m = E.plsimMatch(R, f.team_h, f.team_a);
    if (!m) continue;
    const add = (team, opp, home, lam, cs) => {
      (runs[team] = runs[team] || []).push({
        event: f.event, opp, home,
        difficulty: (E.fdrAttack(lam) + E.fdrDefence(cs)) / 2
      });
      if (next[team] == null) {
        next[team] = { lam, cs, lamAvg: BM * R.att[team], gp: played[team] || 0, congest: 0,
          opp, home, difficulty: (E.fdrAttack(lam) + E.fdrDefence(cs)) / 2 };
      }
    };
    add(f.team_h, f.team_a, true, m.hx, m.csH);
    add(f.team_a, f.team_h, false, m.ax, m.csA);
  }
  return { R, next, runs };
}

/* ── run ────────────────────────────────────────────────────────── */
const [boot, fixtures] = await Promise.all([get('bootstrap-static/'), get('fixtures/')]);
const E = loadEngine();
const idx = buildIndex(boot, fixtures);
E.setRules(E.fplRules(boot));
const teamName = (id) => (idx.teams[id] && (idx.teams[id].short_name || idx.teams[id].name)) || '—';

const { next, runs } = fixtureContext(E, idx);
const xp = {};
idx.elements.forEach((e) => {
  const nf = next[e.team];
  if (!nf) return;
  const v = E.nativeXP(e, nf);
  if (v != null && Number.isFinite(v)) xp[e.id] = v;
});

const candidates = [
  ...priceVerdicts(idx, xp, teamName),
  ...differentials(idx, xp, teamName),
  ...templateRisks(idx, next, teamName),
  ...valuePicks(idx, teamName),
  ...purplePatches(runs, teamName),
  ...fixtureSwings(runs, teamName)
];

/* Hours until the next deadline, for the timeliness term. */
const upcomingEvent = (boot.events || []).find((e) => !e.finished && e.deadline_time);
const hoursToDeadline = upcomingEvent
  ? (new Date(upcomingEvent.deadline_time).getTime() - NOW) / 3600000
  : null;

const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, 'utf8')) : [];
const result = selectStory(candidates, { history, now: NOW, hoursToDeadline });

const payload = {
  generatedAt: new Date(NOW).toISOString(),
  season: boot.events && boot.events.length ? undefined : undefined,
  gameweek: upcomingEvent ? upcomingEvent.id : null,
  hoursToDeadline: hoursToDeadline == null ? null : +hoursToDeadline.toFixed(1),
  playersWithXp: Object.keys(xp).length,
  considered: result.considered,
  published: !!result.pick,
  reason: result.rejected,
  story: result.pick || null,
  runnersUp: result.runnersUp.map((r) => ({ kind: r.kind, headline: r.headline,
    total: +r.total.toFixed(3) }))
};

mkdirSync(HERE, { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2));
if (result.pick) writeFileSync(HISTORY, JSON.stringify(remember(history, result.pick, NOW), null, 2));

const ghOut = process.env.GITHUB_OUTPUT;
if (ghOut) appendFileSync(ghOut, `published=${payload.published}\nkind=${result.pick ? result.pick.kind : 'none'}\n`);

console.log(`candidates: ${result.considered} · xP for ${payload.playersWithXp} players` +
  (hoursToDeadline == null ? ' · no deadline set' : ` · ${hoursToDeadline.toFixed(1)}h to deadline`));
if (result.pick) {
  const p = result.pick;
  console.log(`\n✓ ${p.label}: ${p.headline}`);
  console.log(`  score ${p.total.toFixed(3)} = magnitude ${p.magnitude.toFixed(2)}` +
    ` · timeliness ${p.timeliness.toFixed(2)} · novelty ${p.novelty.toFixed(2)}`);
  if (payload.runnersUp.length) {
    console.log('  runners-up: ' + payload.runnersUp.map((r) => `${r.headline} (${r.total})`).join(', '));
  }
} else {
  console.log(`\n· nothing published — ${result.rejected}`);
}
