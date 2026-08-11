/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — yellow-card accumulation and suspension risk.

   The EFL suspends a player for accumulating yellow cards, on a ladder with
   deadlines: reach five bookings by your club's 19th league match and you
   miss one game; ten by the 37th and you miss two; fifteen at any point and
   you miss three. The count is CUMULATIVE and does not reset when a ban is
   served — a player who served a ban at five is next in trouble at ten, not
   at five again.

   ── WHERE THE RULE CAME FROM ───────────────────────────────
   The ladder is the one in the sibling Bookings Desk project
   (`data/leagues.py`), which documents its evidence and its limits in
   docs/suspension-rules.md. It is a league rule rather than anybody's data,
   and it applies to all three EFL divisions, which is why this app can use
   it while using none of that project's Championship-only, last-season
   numbers.

   ── WHERE THE COUNT COMES FROM ─────────────────────────────
   The official Fantasy EFL feed publishes `yellowCards` per player, and the
   app already carries it in `Player.stats.yellowCards`. So this needs no new
   data source at all: the input is live, current, and covers all 72 clubs.

   ── WHY THIS DOES NOT CHANGE ANY SCORE ─────────────────────
   Deliberately. A ban costs a player the round AFTER the booking, not the
   round you are picking. Marking a player down today for a match he will
   miss next week would be scoring the wrong week, and the availability
   multiplier already handles a player who is suspended NOW.

   What it is instead is a planning signal, shown next to the player: he may
   be missing next round, and whether that costs you anything depends on how
   freely the official game lets you change your side — which this app does
   not claim to know. The interface says exactly that rather than pretending
   the answer is obvious.

   One thing this file deliberately does NOT try to be: a prediction. It
   reports how many bookings a player is from a ban. It does not estimate
   his chance of getting one.
   ═══════════════════════════════════════════════════════════ */

/**
 * The accumulation ladder. `at` bookings earns `ban` matches, but only if
 * the count is reached by the club's `by`th league match; `by: null` means
 * the rung applies all season.
 */
export const SUSPENSION_LADDER = {
  cumulative: true,
  rungs: [
    { at: 5, ban: 1, by: 19 },
    { at: 10, ban: 2, by: 37 },
    { at: 15, ban: 3, by: null }
  ]
};

export const RISK_LEVELS = {
  /* Not near a rung, or no rung can still be reached. */
  clear: { key: 'clear', label: 'No ban risk', rank: 0 },
  /* Two or three away — worth knowing when planning a run of rounds. */
  watch: { key: 'watch', label: 'Nearing a ban', rank: 1 },
  /* One booking away. The one that changes a decision. */
  onEdge: { key: 'onEdge', label: 'One booking from a ban', rank: 2 },
  /* Already serving one, per the availability feed. */
  suspended: { key: 'suspended', label: 'Suspended', rank: 3 }
};

/** How close counts as "worth flagging" once you are past one away. */
const WATCH_WITHIN = 3;

/**
 * How close a player is to an accumulation ban.
 *
 * @param {Object} player            a Player, needing `stats.yellowCards`
 * @param {number|null} matchesPlayed the club's league matches played, used
 *   only for the rung deadlines. Null when the source does not publish it —
 *   in which case every rung is treated as still reachable, which is the
 *   safe direction to be wrong in: it over-warns rather than under-warns.
 * @returns {{level:string, label:string, rank:number, yellows:number|null,
 *            awayFromBan:number|null, nextRung:Object|null, banMatches:number|null,
 *            note:string, known:boolean}}
 */
export function suspensionRisk(player, matchesPlayed) {
  const p = player || {};
  const status = (p.availability && p.availability.status) || 'available';
  const yellows = p.stats ? p.stats.yellowCards : null;

  /* Already serving one. The feed's own status outranks any arithmetic we
     could do — it knows about red cards and disciplinary bans too. */
  if (status === 'suspended') {
    return {
      ...RISK_LEVELS.suspended,
      level: 'suspended',
      yellows: yellows == null ? null : yellows,
      awayFromBan: 0,
      nextRung: null,
      banMatches: null,
      known: true,
      note: 'Currently suspended, so unavailable this round.'
    };
  }

  /* No card data is not zero cards. A source that does not publish yellows
     must produce "unknown", not a confident all-clear. */
  if (yellows == null || !Number.isFinite(Number(yellows))) {
    return {
      ...RISK_LEVELS.clear,
      level: 'clear',
      yellows: null,
      awayFromBan: null,
      nextRung: null,
      banMatches: null,
      known: false,
      note: 'This data source does not publish yellow cards, so ban risk is unknown.'
    };
  }

  const count = Number(yellows);
  const played = Number.isFinite(Number(matchesPlayed)) ? Number(matchesPlayed) : null;

  /* The next rung is the first one the player has NOT yet reached and whose
     deadline has not passed. A rung whose deadline is behind the club can no
     longer trigger, however few bookings short of it he is — which is why
     this is a search rather than "the next number up". */
  const nextRung = SUSPENSION_LADDER.rungs.find((rung) => count < rung.at
    && (rung.by == null || played == null || played <= rung.by)) || null;

  if (!nextRung) {
    return {
      ...RISK_LEVELS.clear,
      level: 'clear',
      yellows: count,
      awayFromBan: null,
      nextRung: null,
      banMatches: null,
      known: true,
      note: count >= SUSPENSION_LADDER.rungs[SUSPENSION_LADDER.rungs.length - 1].at
        ? `On ${count} bookings, past every accumulation rung for the season.`
        : `On ${count} bookings, with every remaining rung's deadline passed.`
    };
  }

  const awayFromBan = nextRung.at - count;
  const level = awayFromBan <= 1 ? 'onEdge' : awayFromBan <= WATCH_WITHIN ? 'watch' : 'clear';
  /* "a 3-match ban" — the compound adjective stays singular however many
     matches it is. `matches` is only ever the plural noun, in prose. */
  const deadline = nextRung.by == null
    ? 'at any point this season'
    : `by the club's ${nextRung.by}th league match`;

  return {
    ...RISK_LEVELS[level],
    level,
    yellows: count,
    awayFromBan,
    nextRung,
    banMatches: nextRung.ban,
    known: true,
    note: awayFromBan <= 1
      ? `On ${count} bookings — one more, ${deadline}, means a `
        + `${nextRung.ban}-match ban and a missed round.`
      : `On ${count} bookings. ${awayFromBan} more, ${deadline}, would mean a `
        + `${nextRung.ban}-match ban.`
  };
}

/** Short text for a badge. Kept separate from `note` so a table cell and a
 *  sentence can differ without either being rewritten. */
export function riskBadgeText(risk) {
  if (!risk || !risk.known) return null;
  if (risk.level === 'suspended') return 'Suspended';
  if (risk.level === 'onEdge') return '1 from a ban';
  if (risk.level === 'watch') return `${risk.awayFromBan} from a ban`;
  return null;
}

/** The ladder, as rows a table can render. */
export function ladderRows() {
  return SUSPENSION_LADDER.rungs.map((rung) => ({
    at: rung.at,
    ban: rung.ban,
    by: rung.by,
    text: rung.by == null
      ? `${rung.at} bookings at any point in the season`
      : `${rung.at} bookings by the club's ${rung.by}th league match`
  }));
}
