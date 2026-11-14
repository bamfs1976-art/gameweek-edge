/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — deeper player stats and the modelled captain range.

   ── WHAT THE OFFICIAL FEED CAN AND CANNOT SUPPORT ───────────
   The official game's public feed publishes SEASON TOTALS: appearances,
   points, goals, assists, clean sheets, and the defensive stats the
   tariff pays for. It does not publish minutes or per-match history.

   So, from the official feed:
     · points per appearance        yes
     · defensive contributions      yes (clearances, blocks, tackles,
                                    interceptions, per appearance)
     · points per 90                no: needs minutes
     · home and away splits         no: needs per-match history
   Every function here returns null for what its source cannot answer, and
   the pages print that as a dash with the reason, never as a zero.

   ── NORMALISED WITHIN DIVISION ─────────────────────────────
   A League Two defender's points per appearance is compared with League
   Two defenders, never with the Championship. divisionPercentiles() is
   the only cross-player comparison in this file, and it is division- and
   position-local by construction, as the rest of the model is.

   ── THE CAPTAIN RANGE IS MODELLED, NOT A FORECAST ───────────
   captainRange() gives a low, middle and high outcome for one round, each
   built from stated parts: a scoring rate, the fixture rating, and a
   "good day" and "quiet day" defined by the tariff for that position. It
   says what those parts imply; it does not claim to know what happens.
   ═══════════════════════════════════════════════════════════ */

import { statPoints, MEASURED_POINTS_PER_APPEARANCE } from './tariff.js';
import { playingShare, roundFixtures, AVAILABILITY_MULTIPLIER } from './model.js';

export const DEFENSIVE_KEYS = ['clearances', 'blocks', 'tackles', 'interceptions'];
/** Fewer appearances than this and a rate is too noisy to rank. */
export const MIN_APPS = 3;
/** How hard a short record is pulled towards its position's average. */
export const PRIOR_WEIGHT = 3;

/* ── Rates ───────────────────────────────────────────────── */

/**
 * The rates for one player. null wherever the source cannot answer.
 * @returns {{perApp:number|null, per90:number|null, defActions:number|null,
 *   defPerApp:number|null, defPoints:number|null, defPointsPerApp:number|null,
 *   shrunkPerApp:number}}
 */
export function playerRates(p) {
  const apps = p.appearances || 0;
  const perApp = apps ? p.points / apps : null;
  const per90 = p.minutes >= 90 ? p.points / (p.minutes / 90) : null;

  const stats = p.stats || {};
  const published = DEFENSIVE_KEYS.filter((k) => stats[k] != null);
  const defActions = published.length ? published.reduce((s, k) => s + stats[k], 0) : null;
  /* Points the tariff pays for those actions, for this position. Worked
     out from season totals, so it can run a point or two above the sum of
     per-match scores, where the game rounds down each match. */
  const paid = published.map((k) => statPoints(k, stats[k], p.position)).filter((v) => v != null);
  const defPoints = paid.length ? paid.reduce((s, v) => s + v, 0) : null;

  const prior = MEASURED_POINTS_PER_APPEARANCE[p.position] || 3.8;
  const shrunkPerApp = (p.points + PRIOR_WEIGHT * prior) / (apps + PRIOR_WEIGHT);

  return {
    perApp,
    per90,
    defActions,
    defPerApp: apps && defActions != null ? defActions / apps : null,
    defPoints,
    defPointsPerApp: apps && defPoints != null ? defPoints / apps : null,
    shrunkPerApp
  };
}

/**
 * Percentile (0-100, higher is better) of a rate within each player's own
 * division and position. Players under MIN_APPS are left out.
 * @param {Object[]} players
 * @param {(p:Object)=>number|null} rate
 * @returns {Map<string, number>}
 */
export function divisionPercentiles(players, rate) {
  const groups = new Map();
  for (const p of players) {
    if ((p.appearances || 0) < MIN_APPS) continue;
    const v = rate(p);
    if (v == null || !Number.isFinite(v)) continue;
    const key = p.division + '|' + p.position;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: p.id, v });
  }
  const out = new Map();
  for (const list of groups.values()) {
    list.sort((a, b) => a.v - b.v);
    const n = list.length;
    list.forEach((item, i) => {
      /* Ties share the higher rank, so equal players read equal. */
      let j = i;
      while (j + 1 < n && list[j + 1].v === item.v) j += 1;
      out.set(item.id, n === 1 ? 100 : Math.round((j / (n - 1)) * 100));
    });
  }
  return out;
}

/** "Top 8% in League One defenders" style words for a percentile. */
export function percentileWords(pct) {
  if (pct == null) return '';
  if (pct >= 50) return `top ${Math.max(1, 100 - pct)}%`;
  return `bottom ${Math.max(1, pct)}%`;
}

/**
 * Home and away from per-match history, where the source publishes it.
 * The official feed does not, so this returns null there.
 */
export function homeAwaySplit(ctx, p) {
  const history = (p.last5 || []).filter((m) => m.minutes > 0);
  if (!history.length) return null;
  const side = { home: { apps: 0, points: 0 }, away: { apps: 0, points: 0 } };
  for (const m of history) {
    const f = ctx.fixtures.find((x) => x.round === m.round && (x.homeId === p.clubId || x.awayId === p.clubId));
    if (!f) continue;
    const s = f.homeId === p.clubId ? side.home : side.away;
    s.apps += 1;
    s.points += m.points;
  }
  if (!side.home.apps && !side.away.apps) return null;
  const rate = (s) => (s.apps ? s.points / s.apps : null);
  return {
    home: { ...side.home, perApp: rate(side.home) },
    away: { ...side.away, perApp: rate(side.away) },
    window: history.length
  };
}

/* ── Captain range ───────────────────────────────────────── */

/**
 * A "good day" by the tariff, per match, before the fixture is applied.
 * Each is a sentence of the scoring rules, not a fitted number:
 *   GK   60+ minutes (2), clean sheet (5), six saves (4)
 *   DEF  60+ minutes (2), clean sheet (5), defensive points (3), an assist (3)
 *   MID  60+ minutes (2), a goal (6), an assist (3), two shots on target (2)
 *   FWD  60+ minutes (2), a goal (5), an assist (3), two shots on target (2)
 */
export const GOOD_DAY = { GK: 11, DEF: 13, MID: 13, FWD: 12 };
export const GOOD_DAY_WORDS = {
  GK: 'a clean sheet and six saves',
  DEF: 'a clean sheet, defensive points and an assist',
  MID: 'a goal, an assist and two shots on target',
  FWD: 'a goal, an assist and two shots on target'
};

/** A fixture as a multiplier around 1: 1.3 for the easiest, 0.7 for the hardest. */
export const fixtureFactor = (difficulty) => 0.7 + 0.6 * (1 - difficulty);

/**
 * Low, middle and high modelled outcomes for one round, as a captain
 * (doubled) and as a player.
 *
 * middle  the player's scoring rate (pulled towards his position's average
 *         while his record is short) times the fixture factor, per match
 * high    the larger of a tariff good day and twice his rate, times the
 *         fixture factor, per match
 * low     appearance points only (2 for a nailed starter, 1 for a likely
 *         one, 0 otherwise), per match
 * Availability scales all three, so an injured player's range collapses.
 */
export function captainRange(ctx, player) {
  const fixtures = roundFixtures(ctx, player.clubId)
    .filter((f) => f.round === ctx.currentRound);
  const rates = playerRates(player);
  const share = playingShare(ctx, player).value;
  const status = (player.availability && player.availability.status) || 'available';
  const avail = AVAILABILITY_MULTIPLIER[status] == null ? 1 : AVAILABILITY_MULTIPLIER[status];
  const rate = rates.shrunkPerApp;
  const quiet = share >= 0.7 ? 2 : share >= 0.35 ? 1 : 0;

  let low = 0; let mid = 0; let high = 0;
  for (const f of fixtures) {
    const k = fixtureFactor(f.difficulty);
    low += quiet;
    mid += rate * k;
    high += Math.max(GOOD_DAY[player.position] || 12, rate * 2) * k;
  }
  const round1 = (v) => Math.round(v * avail * 10) / 10;
  const r = { low: round1(low), mid: round1(mid), high: round1(high) };
  return {
    player,
    fixtures,
    matches: fixtures.length,
    rate,
    share,
    status,
    single: r,
    captain: { low: r.low * 2, mid: Math.round(r.mid * 20) / 10, high: Math.round(r.high * 20) / 10 },
    goodDay: GOOD_DAY_WORDS[player.position] || ''
  };
}
