/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — club usage: the five-uses-a-season limit.

   Every club can be one of your two weekly club picks five times a
   season, and the game does not make it easy to see how many you have
   left. This file keeps the count and says which clubs are worth a use in
   the next three rounds and which are worth saving.

   ── THE LOG ────────────────────────────────────────────────
   Kept in this browser only, one entry per round:

     { schemaVersion: 1, season: '2026-27',
       rounds: { "15": ["club-a", "club-b"], "16": ["club-c"] } }

   Keyed by round rather than as a running total, so a mistake is fixed by
   editing the round it happened in, and the count is always re-derived
   rather than trusted. Each season gets its own storage key, so August
   starts clean without deleting last season.

   ── SPEND OR SAVE ──────────────────────────────────────────
   A club with N uses left should spend them on its N best rounds. So for
   each club the rounds in view (up to twelve) are ranked by fixture
   opportunity, the same roundOpportunity() the player model uses, which
   counts a double as two chances. If one of the next three rounds is in
   that club's top N, spending now is consistent with saving for the best;
   if all of its top N lie later, the use is worth keeping.

   That is only asked of clubs worth picking at all: the top twelve of the
   72 on this round's modelled club rating. Every rating here is modelled,
   and the page says so.

   Pure functions; dev/test-efl-clubs.mjs runs them in Node.
   ═══════════════════════════════════════════════════════════ */

import { clubScore, fixtureRun, roundOpportunity } from './model.js';

export const SCHEMA_VERSION = 1;
export const CLUB_SEASON_USES = 5;
export const CLUBS_PER_ROUND = 2;
/* How far ahead the spend-or-save read looks, and how many clubs it
   considers worth a pick. */
export const PLAN_WINDOW = 12;
export const NOW_WINDOW = 3;
export const CONTENDERS = 12;
/* Fixture opportunities closer than this count as the same. */
export const EVEN_SPREAD = 0.05;

/** "2026-27": the season a date falls in. Seasons turn over on 1 July. */
export function seasonFor(now) {
  const d = new Date(now == null ? Date.now() : now);
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const storageKey = (season) => `ge-efl-club-usage-${season}`;

/** An empty log for a season. */
export function emptyLog(season) {
  return { schemaVersion: SCHEMA_VERSION, season, rounds: {} };
}

/**
 * Read a stored log. Never throws. Drops bad rounds, repeated clubs and
 * anything past two clubs a round; unknown club ids are dropped only when
 * a set of known ids is passed.
 */
export function normaliseLog(raw, season, knownIds) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = emptyLog(season || (typeof src.season === 'string' ? src.season : seasonFor()));
  const rounds = src.rounds && typeof src.rounds === 'object' ? src.rounds : {};
  for (const [key, list] of Object.entries(rounds)) {
    const round = Number(key);
    if (!Number.isInteger(round) || round < 1 || round > 99 || !Array.isArray(list)) continue;
    const ids = [...new Set(list.filter((x) => typeof x === 'string' && x)
      .filter((x) => !knownIds || knownIds.has(x)))].slice(0, CLUBS_PER_ROUND);
    if (ids.length) out.rounds[String(round)] = ids;
  }
  return out;
}

/** Uses so far, per club id. */
export function usageCounts(log) {
  const counts = {};
  for (const ids of Object.values(log.rounds)) for (const id of ids) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

export function usesLeft(log, clubId) {
  return Math.max(0, CLUB_SEASON_USES - (usageCounts(log)[clubId] || 0));
}

/**
 * Set one round's clubs. Refuses, with a reason, rather than recording a
 * sixth use: the official game would not accept it either.
 * @returns {{log:Object, error:string|null}}
 */
export function setRound(log, round, clubIds, clubNames = {}) {
  const ids = [...new Set((clubIds || []).filter(Boolean))];
  if (!Number.isInteger(round) || round < 1) return { log, error: 'Pick a round.' };
  if (ids.length > CLUBS_PER_ROUND) return { log, error: `Only ${CLUBS_PER_ROUND} clubs a round.` };
  const without = { ...log, rounds: { ...log.rounds } };
  delete without.rounds[String(round)];
  const counts = usageCounts(without);
  const over = ids.filter((id) => (counts[id] || 0) >= CLUB_SEASON_USES);
  if (over.length) {
    const names = over.map((id) => clubNames[id] || id).join(' and ');
    return { log, error: `${names} ${over.length === 1 ? 'has' : 'have'} no uses left this season.` };
  }
  if (ids.length) without.rounds[String(round)] = ids;
  return { log: without, error: null };
}

/* ── Spend or save ───────────────────────────────────────── */

/**
 * The read for every club.
 * @returns {Array<{club, score, used, left, verdict:'spend'|'save'|'hold'|'exhausted',
 *   bestRounds:number[], nextBest:Object|null, reason:string, contender:boolean, rec:Object}>}
 */
export function clubPlan(ctx, log, opts = {}) {
  const counts = usageCounts(log);
  const window = opts.window || PLAN_WINDOW;
  const scored = ctx.clubs.map((club) => ({ club, rec: clubScore(ctx, club) }))
    .sort((a, b) => b.rec.score - a.rec.score);
  const contenders = new Set(scored.slice(0, opts.contenders || CONTENDERS).map((s) => s.club.id));

  return scored.map(({ club, rec }) => {
    const used = counts[club.id] || 0;
    const left = Math.max(0, CLUB_SEASON_USES - used);
    const rounds = fixtureRun(ctx, club.id, window).map((r) => ({
      round: r.round, double: r.double, blank: r.blank, opportunity: roundOpportunity(r.matches)
    }));
    const ranked = rounds.filter((r) => !r.blank).slice()
      .sort((a, b) => b.opportunity - a.opportunity || a.round - b.round);
    const best = ranked.slice(0, left);
    const bestRounds = best.map((r) => r.round).sort((a, b) => a - b);
    const soon = rounds.slice(0, NOW_WINDOW).map((r) => r.round);
    const spendSoon = best.filter((r) => soon.includes(r.round)).sort((a, b) => a.round - b.round);
    const nextBest = best.slice().sort((a, b) => a.round - b.round)[0] || null;
    const contender = contenders.has(club.id);
    /* When every fixture in view rates about the same (as it does while the
       feed publishes too little to separate opponents) the ranking above is
       only "earliest first". That is no reason to spend or to save, so it
       is said plainly rather than dressed up as one. */
    const opps = ranked.map((r) => r.opportunity);
    const even = opps.length > 0 && Math.max(...opps) - Math.min(...opps) < EVEN_SPREAD;

    let verdict; let reason;
    const describe = (r) => `round ${r.round}${r.double ? ' (double)' : ''}`;
    if (!left) {
      verdict = 'exhausted';
      reason = `All ${CLUB_SEASON_USES} uses spent.`;
    } else if (!contender) {
      verdict = 'hold';
      reason = `Not among the ${opts.contenders || CONTENDERS} top-rated clubs this round.`;
    } else if (even) {
      verdict = 'spend';
      reason = `${left} use${left === 1 ? '' : 's'} left. Its fixtures in view rate about evenly, `
        + 'so there is no stronger round to save it for.';
    } else if (spendSoon.length) {
      verdict = 'spend';
      reason = `${left} use${left === 1 ? '' : 's'} left, and ${describe(spendSoon[0])} is one of its best `
        + `${left === 1 ? 'round' : `${Math.min(left, ranked.length)} rounds`} in the next ${rounds.length}.`;
    } else if (nextBest) {
      verdict = 'save';
      reason = `${left} use${left === 1 ? '' : 's'} left, and its better fixtures come later, from ${describe(nextBest)}.`;
    } else {
      verdict = 'hold';
      reason = 'No fixtures in view.';
    }
    return { club, rec, score: rec.score, used, left, verdict, bestRounds, nextBest, reason, contender, rounds };
  });
}

/**
 * The model's club pick for this round, checked against the log. Pass the
 * id roundPicks() chose; without one, the top of the plan stands in.
 * @returns {{pick:Object|null, exhausted:boolean, alternative:Object|null}}
 */
export function checkModelClub(plan, modelClubId) {
  const pick = (modelClubId && plan.find((p) => p.club.id === modelClubId)) || plan[0] || null;
  if (!pick || pick.left > 0) return { pick, exhausted: false, alternative: null };
  return { pick, exhausted: true, alternative: plan.find((p) => p.left > 0 && p !== pick) || null };
}

/** This round's logged clubs, with any problem stated. */
export function roundStatus(log, round) {
  const ids = log.rounds[String(round)] || [];
  return { ids, complete: ids.length === CLUBS_PER_ROUND };
}

/* ── Storage ─────────────────────────────────────────────
   Given the store rather than reaching for window.localStorage, so the
   three pages that read the log share one reader and Node can test it. */

export function readLog(storage, season, knownIds) {
  try {
    const raw = storage && storage.getItem(storageKey(season));
    return normaliseLog(raw ? JSON.parse(raw) : null, season, knownIds);
  } catch (_) { return emptyLog(season); }
}

export function writeLog(storage, log) {
  try { storage.setItem(storageKey(log.season), JSON.stringify(log)); return true; }
  catch (_) { return false; }
}
