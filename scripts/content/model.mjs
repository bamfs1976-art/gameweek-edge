/*
 * Daily content — the model bits both runners need.
 *
 * The daily card and the club threads ask the same three things of the
 * model: load the shared engine, shape the data the way the engine expects,
 * and work out each club's fixture context. Extracted the moment there were
 * two callers rather than after they had drifted apart — two copies of
 * "how do we build the index" is exactly how the card and the thread end up
 * quoting different numbers for the same club.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { buildEngine } from '../extract-engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function fetchFpl(api, path) {
  const r = await fetch(`${api}/${path}`, {
    headers: { 'User-Agent': 'gameweek-edge-content/1.0', Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

/* ── the shared engine ─────────────────────────────────────────── */
export function loadEngine() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  new vm.Script(buildEngine(readFileSync(join(ROOT, 'index.html'), 'utf8'))).runInContext(ctx);
  return ctx.window.GEEngine;
}

/* ── the index the engine expects ──────────────────────────────── */
export function buildIndex(boot, fixtures) {
  const teams = {};
  (boot.teams || []).forEach((t) => { teams[t.id] = t; });
  return { raw: boot, teams, elements: boot.elements || [], fixtures: fixtures || [],
    events: boot.events || [] };
}

/* Each club's next unplayed fixture in the shape nativeXP wants, plus the
   run of fixtures after it for the swing and purple-patch stories. */
export function fixtureContext(E, idx) {
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

