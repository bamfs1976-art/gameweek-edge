/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — the scoring tariff.

   ── WHERE THIS CAME FROM, AND HOW FAR TO TRUST IT ──────────
   This app used to decline to state the tariff, on the grounds that
   guessing at another game's rules in public is worse than saying "look it
   up". That was the right call while it was a guess. It is no longer a
   guess: the values below were checked against 83,698 real player-gameweek
   records published by the official game (35 rounds of a completed season)
   by recomputing every row's score from its raw stats and comparing with
   the official `points` figure.

       83,688 of 83,698 rows reproduce EXACTLY — 99.99%.
       The ten misses are all off-by-one, consistent with post-match stat
       corrections landing after the points were banked.

   That is strong enough to build on and to publish, and weak enough that
   the guide says so: a tariff can change between seasons, and the official
   game is the authority. Nothing in this file is scraped from, or owned by,
   anyone else — it is a description of published game rules, arrived at by
   checking arithmetic against published results.

   ── WHY IT LIVES IN ITS OWN FILE ───────────────────────────
   Three consumers, and they must never drift apart:
     · model.js       scores a player's output in the currency the game
                      actually pays in, rather than in FPL's
     · page-players.js shows what each stat was WORTH, in the cell
     · the guide      prints the table

   ── WHAT IT CHANGES ABOUT PICKING A TEAM ───────────────────
   Two things, and both run against Premier League instinct:

   1. A goal is worth DOUBLE to a goalkeeper what it is to a forward
      (10 vs 5), and defenders are paid for clearances, blocks and tackles
      while midfielders are paid two points for every interception.
   2. Measured across those same 83,698 rows, mean points per appearance
      run DEF 4.19 > GK 4.08 > MID 3.88 > FWD 3.14. The forward is the
      worst-scoring position in this game. Any model that inherits FPL's
      "captain your best forward" reflex is wrong here, and this file is
      why.
   ═══════════════════════════════════════════════════════════ */

/** Goals, by the position of the scorer. */
export const GOAL_POINTS = { GK: 10, DEF: 7, MID: 6, FWD: 5 };

/**
 * Every scoring stat, as a rule that can be applied, printed and explained.
 *
 *   per      points awarded for each `every` of this stat
 *   every    the divisor (1 = every one)
 *   positions which positions are paid for it; null means all
 *   label/short  what to call it in prose and in a column heading
 */
export const TARIFF = {
  minutes: {
    label: 'Minutes played', short: 'Mins', positions: null,
    describe: 'Up to 60 minutes +1, 60 minutes or more +2'
  },
  goals: {
    label: 'Goals', short: 'G', positions: null,
    describe: 'GK +10, DEF +7, MID +6, FWD +5'
  },
  hatTricks: { per: 5, every: 1, label: 'Hat-tricks', short: 'HT', positions: null, describe: '+5 on top of the goals' },
  assists: { per: 3, every: 1, label: 'Assists', short: 'A', positions: null, describe: '+3 each' },
  cleanSheets: {
    per: 5, every: 1, label: 'Clean sheets', short: 'CS', positions: ['GK', 'DEF'],
    describe: '+5, and only with 60 minutes or more'
  },
  goalsConceded: {
    per: -1, every: 2, label: 'Goals conceded', short: 'GC', positions: ['GK', 'DEF'],
    describe: '−1 for every 2'
  },
  saves: { per: 2, every: 3, label: 'Saves', short: 'Sv', positions: ['GK'], describe: '+2 for every 3' },
  penaltySaves: { per: 5, every: 1, label: 'Penalty saves', short: 'PS', positions: ['GK'], describe: '+5 each' },
  clearances: { per: 1, every: 4, label: 'Clearances', short: 'Clr', positions: ['DEF'], describe: '+1 for every 4' },
  blocks: { per: 1, every: 2, label: 'Blocks', short: 'Blk', positions: ['DEF'], describe: '+1 for every 2' },
  tackles: { per: 1, every: 2, label: 'Tackles', short: 'Tck', positions: ['DEF'], describe: '+1 for every 2' },
  interceptions: {
    per: 2, every: 1, label: 'Interceptions', short: 'Int', positions: ['MID'],
    describe: '+2 each — the single most valuable repeatable stat in the game'
  },
  keyPasses: { per: 1, every: 2, label: 'Key passes', short: 'KP', positions: ['MID', 'FWD'], describe: '+1 for every 2' },
  shotsOnTarget: { per: 1, every: 1, label: 'Shots on target', short: 'SoT', positions: ['MID', 'FWD'], describe: '+1 each' },
  penaltyMisses: { per: -3, every: 1, label: 'Penalty misses', short: 'PM', positions: null, describe: '−3 each' },
  ownGoals: { per: -3, every: 1, label: 'Own goals', short: 'OG', positions: null, describe: '−3 each' },
  yellowCards: { per: -1, every: 1, label: 'Yellow cards', short: 'YC', positions: null, describe: '−1 each' },
  redCards: { per: -3, every: 1, label: 'Red cards', short: 'RC', positions: null, describe: '−3 each' }
};

/** Does this position get paid for this stat at all? */
export function scoresFor(stat, position) {
  const rule = TARIFF[stat];
  if (!rule) return false;
  return rule.positions == null || rule.positions.indexOf(position) !== -1;
}

/**
 * What a stat was worth. The two irregular rules — minutes and goals — are
 * handled explicitly rather than bent into the `per/every` shape, because a
 * rule that needs a special case is clearer as one.
 *
 * @param {string} stat   key in TARIFF
 * @param {number} value  the raw count
 * @param {'GK'|'DEF'|'MID'|'FWD'} position
 * @param {number} [minutes] required for clean sheets, which need 60+
 * @returns {number} points, or 0 when this position is not paid for it
 */
export function statPoints(stat, value, position, minutes) {
  const v = Number(value) || 0;
  if (!scoresFor(stat, position)) return 0;
  if (stat === 'minutes') return v >= 60 ? 2 : v > 0 ? 1 : 0;
  if (stat === 'goals') return v * (GOAL_POINTS[position] || 0);
  /* A clean sheet under 60 minutes pays nothing. The stat still happened,
     which is why the UI shows the value with no bracket rather than hiding
     the row — "it happened and it was worth nothing" is information. */
  if (stat === 'cleanSheets' && minutes != null && minutes < 60) return 0;
  const rule = TARIFF[stat];
  if (!rule || rule.per == null) return 0;
  /* Negative rules floor towards zero the same way positive ones do: two
     goals conceded is −1, three is still −1. */
  const units = Math.floor(v / rule.every);
  return units * rule.per;
}

/**
 * Score one appearance from its raw stats. Used to grade the sample data
 * against the same rules the real game uses, so a sample player's points
 * column is arithmetic rather than another invention.
 */
export function scoreAppearance(stats, position) {
  const minutes = Number(stats.minutes) || 0;
  if (minutes <= 0) return 0;
  let total = statPoints('minutes', minutes, position);
  for (const stat of Object.keys(TARIFF)) {
    if (stat === 'minutes') continue;
    if (stats[stat] == null) continue;
    total += statPoints(stat, stats[stat], position, minutes);
  }
  return total;
}

/* Which stats a manager actually wants to see for each position, in the
   order they should appear. Showing a defender's shots on target and a
   forward's clearances is how a table becomes forty columns of nothing. */
export const POSITION_COLUMNS = {
  GK: ['minutes', 'goals', 'assists', 'saves', 'penaltySaves', 'cleanSheets', 'goalsConceded'],
  DEF: ['minutes', 'goals', 'assists', 'cleanSheets', 'goalsConceded', 'clearances', 'blocks', 'tackles'],
  MID: ['minutes', 'goals', 'assists', 'interceptions', 'keyPasses', 'shotsOnTarget'],
  FWD: ['minutes', 'goals', 'assists', 'keyPasses', 'shotsOnTarget'],
  /* The mixed view: only what every position is paid for, so a column never
     means "zero" for one row and "not applicable" for the next. */
  ALL: ['minutes', 'goals', 'assists']
};

/* Measured over the same 83,698 appearances. Published on the guide page
   because it is the single most counter-intuitive fact about this game, and
   because it is the justification for the captain rule in model.js. */
export const MEASURED_POINTS_PER_APPEARANCE = { DEF: 4.19, GK: 4.08, MID: 3.88, FWD: 3.14 };
