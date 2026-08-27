/* ═══════════════════════════════════════════════════════════
   MATCHDAY EDGE — the rules engine.

   ── WHY THIS FILE EXISTS AT ALL ────────────────────────────
   Every screen in this app is a different question asked of the same
   rulebook. "Can I still field this squad?" is the squad builder. "Can I
   still bring him in?" is the sub panel. "What does this move cost me?" is
   the transfer planner. If each screen answers from its own copy of the
   rules, they will disagree — and they will disagree quietly, at the worst
   possible moment, which for this game is a Tuesday night with the first
   kick-off ten minutes away.

   So: one module, no dependencies, every constant frozen, every validator
   reading from the constants rather than from a literal typed inline. A
   rule change is a one-line edit here and nowhere else.

   ── WHAT IT WILL AND WILL NOT DO ───────────────────────────
   Validators REPORT, they do not BLOCK. Every one returns
   `{ ok, breaches: [...] }` with a machine-readable code and a sentence
   fit to show a human. The builder is meant to let you assemble an illegal
   squad and stare at the red strip while you fix it — being told "no" with
   no explanation, mid-thought, is how you end up doing the planning in a
   spreadsheet instead.

   ── WHAT IS NOT IN HERE ────────────────────────────────────
   Kick-off clock times. The deadline DATES below are from the published
   rules; the hour of each deadline and the day-by-day split of a matchday
   come from the fixture feed, because those are the parts that move. Nothing
   in this file should ever need a network call to be right.

   Source: the official 2026/27 rules page (updated 1 June 2026), as
   transcribed in the design brief, version 0.2.
   ═══════════════════════════════════════════════════════════ */

/* ── Squad shape ──────────────────────────────────────────── */

export const SQUAD_SIZE = 15;
export const XI_SIZE = 11;
export const BENCH_SIZE = 4;

export const POSITIONS = Object.freeze(['GK', 'DEF', 'MID', 'FWD']);

/** Exactly this many of each, no latitude. */
export const SQUAD_SHAPE = Object.freeze({ GK: 2, DEF: 5, MID: 5, FWD: 3 });

/** The XI is a floor-and-ceiling problem: minimums are the rule, maximums
    fall out of how many of each position the squad may contain. */
export const XI_MIN = Object.freeze({ GK: 1, DEF: 3, MID: 2, FWD: 1 });
export const XI_MAX = Object.freeze({ GK: 1, DEF: 5, MID: 5, FWD: 3 });

/* ── Matchdays and stages ─────────────────────────────────── */

export const MATCHDAY_COUNT = 17;

/* Budget and the per-club cap are both properties of the STAGE, not of the
   matchday, which is why they live here rather than in a 17-row table. The
   cap rising through the knockouts is the single most consequential number
   in the game — it is what makes loading one surviving club legal. */
export const STAGES = Object.freeze([
  Object.freeze({ key: 'league',  label: 'League phase',   mds: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]), clubCap: 3, budget: 100.0 }),
  Object.freeze({ key: 'playoff', label: 'Play-offs',      mds: Object.freeze([9, 10]),                  clubCap: 4, budget: 105.0 }),
  Object.freeze({ key: 'r16',     label: 'Round of 16',    mds: Object.freeze([11, 12]),                 clubCap: 4, budget: 105.0 }),
  Object.freeze({ key: 'qf',      label: 'Quarter-finals', mds: Object.freeze([13, 14]),                 clubCap: 5, budget: 105.0 }),
  Object.freeze({ key: 'sf',      label: 'Semi-finals',    mds: Object.freeze([15, 16]),                 clubCap: 6, budget: 105.0 }),
  Object.freeze({ key: 'final',   label: 'Final',          mds: Object.freeze([17]),                     clubCap: 8, budget: 105.0 }),
]);

/* Deadline DATES only — see the note at the top of the file about clock
   times. Indexed by matchday minus one. */
export const DEADLINES = Object.freeze([
  '2026-09-08', '2026-10-13', '2026-10-20', '2026-11-03', '2026-11-24', '2026-12-08',
  '2027-01-19', '2027-01-27', '2027-02-16', '2027-02-23', '2027-03-09', '2027-03-16',
  '2027-04-06', '2027-04-13', '2027-04-27', '2027-05-04', '2027-06-05',
]);

/* The two matchdays that are a single block of football: the last league
   round kicks off as one, and the final is one game. Both consequences are
   the same — there is no gap to make changes in. */
export const SINGLE_BLOCK_MDS = Object.freeze([8, 17]);

/* ── Transfers ────────────────────────────────────────────── */

/* Three windows where the squad may be rebuilt from nothing. These are also
   the three matchdays on which a chip is worthless, which is not a
   coincidence and is why one list drives both. */
export const UNLIMITED_TRANSFER_MDS = Object.freeze([1, 9, 11]);

/* The league phase pays two a week; the knockouts pay an irregular
   allowance that tracks how much of the field has just been eliminated. */
export const LEAGUE_FREE_TRANSFERS = 2;
export const KNOCKOUT_FREE_TRANSFERS = Object.freeze({
  10: 2, 12: 3, 13: 5, 14: 3, 15: 5, 16: 3, 17: 5,
});

export const MAX_CARRY = 1;
export const HIT_COST = 4;

/* Prices are frozen until the MD2 deadline and start moving on points from
   MD3 — the fact that makes an early Wildcard a waste. */
export const PRICE_LOCK_THROUGH_MD = 2;

/* ── In-matchday changes ──────────────────────────────────── */

export const MAX_IN_MATCHDAY_SUBS = 4;

/* ── Chips ────────────────────────────────────────────────── */

export const CHIPS = Object.freeze({
  wildcard: Object.freeze({
    key: 'wildcard',
    label: 'Wildcard',
    unlimitedTransfers: true,
    budgetApplies: true,
    squadPersists: true,
  }),
  limitless: Object.freeze({
    key: 'limitless',
    label: 'Limitless',
    unlimitedTransfers: true,
    budgetApplies: false,
    squadPersists: false,
  }),
});

/* ── Scoring ──────────────────────────────────────────────── */

export const SCORING = Object.freeze({
  appearance: 1,
  sixtyMinutes: 1,
  sixtyMinutesThreshold: 60,
  goalOutsideBox: 1,
  assist: 3,
  ballsRecoveredPer: 3,
  ballsRecoveredPoints: 1,
  playerOfTheMatch: 3,
  penaltyWon: 2,
  penaltyConceded: -1,
  penaltyMissed: -2,
  yellowCard: -1,
  redCard: -3,
  ownGoal: -2,
  goal: Object.freeze({ GK: 6, DEF: 6, MID: 5, FWD: 4 }),
  cleanSheet: Object.freeze({ GK: 4, DEF: 4, MID: 1, FWD: 0 }),
  cleanSheetMinutes: 60,
  penaltySave: 5,
  savesPer: 3,
  savesPoints: 1,
  concededPer: 2,
  concededPoints: -1,
  /* Only these two are docked for goals let in. A midfielder shipping four
     loses nothing; he simply does not get his clean-sheet point. */
  concededPositions: Object.freeze(['GK', 'DEF']),
});

/* ═══════════════════════════════════════════════════════════
   QUERIES — the calendar
   ═══════════════════════════════════════════════════════════ */

export function isMatchday(md) {
  return Number.isInteger(md) && md >= 1 && md <= MATCHDAY_COUNT;
}

function assertMatchday(md) {
  if (!isMatchday(md)) throw new RangeError(`matchday out of range: ${md}`);
  return md;
}

/** The stage descriptor a matchday belongs to. */
export function stageFor(md) {
  assertMatchday(md);
  return STAGES.find((s) => s.mds.includes(md));
}

export function budgetFor(md) {
  return stageFor(md).budget;
}

/** The per-club cap, which is the number that changes what a squad may be. */
export function clubCapFor(md) {
  return stageFor(md).clubCap;
}

export function deadlineFor(md) {
  assertMatchday(md);
  return DEADLINES[md - 1];
}

/** True for the two matchdays with no gap to act in: MD8 and the final. */
export function isSingleBlock(md) {
  assertMatchday(md);
  return SINGLE_BLOCK_MDS.includes(md);
}

/** Subs and a captain switch between days exist everywhere else. */
export function inMatchdayChangesAllowed(md) {
  return !isSingleBlock(md);
}

/** Prices are frozen through the MD2 deadline and move from MD3. */
export function pricesLocked(md) {
  assertMatchday(md);
  return md <= PRICE_LOCK_THROUGH_MD;
}

/** The first matchday whose deadline has not passed, or null once the
    season is done. Compares dates as ISO strings, which sorts correctly. */
export function nextMatchdayAfter(isoDate) {
  const md = DEADLINES.findIndex((d) => d >= isoDate);
  return md === -1 ? null : md + 1;
}

/* ═══════════════════════════════════════════════════════════
   QUERIES — transfers
   ═══════════════════════════════════════════════════════════ */

export function isUnlimitedTransferMd(md) {
  assertMatchday(md);
  return UNLIMITED_TRANSFER_MDS.includes(md);
}

/** The allowance before any carry-over. Infinity on an unlimited matchday,
    which is the honest value and makes the hit calculator fall out for free. */
export function baseFreeTransfers(md) {
  assertMatchday(md);
  if (isUnlimitedTransferMd(md)) return Infinity;
  if (stageFor(md).key === 'league') return LEAGUE_FREE_TRANSFERS;
  return KNOCKOUT_FREE_TRANSFERS[md];
}

/**
 * How many unused transfers survive into `md`. Three ways to get nothing:
 * you are in the knockouts, you played a chip last matchday, or what you
 * are carrying is not a finite number — which is what "unused" amounts to
 * after an unlimited window.
 */
export function carryInto(md, { unused = 0, chipPlayedPrevMd = null } = {}) {
  assertMatchday(md);
  if (md === 1) return 0;
  if (stageFor(md).key !== 'league') return 0;
  if (chipPlayedPrevMd) return 0;
  if (!Number.isFinite(unused) || unused <= 0) return 0;
  return Math.min(MAX_CARRY, Math.floor(unused));
}

/** Everything you may spend this matchday without taking a hit. */
export function freeTransfersFor(md, opts = {}) {
  const base = baseFreeTransfers(md);
  if (!Number.isFinite(base)) return base;
  return base + carryInto(md, opts);
}

/** Each move beyond the free allowance costs four off the overall score. */
export function transferHitCost(made, free) {
  if (!Number.isFinite(free)) return 0;
  const over = Math.max(0, Math.floor(made) - Math.floor(free));
  return over * HIT_COST;
}

/**
 * The break-even the transfer planner exists to show: a move is worth
 * making when the expected points it adds clear what it costs.
 */
export function transferIsWorthIt(xpGain, made, free) {
  return xpGain > transferHitCost(made, free);
}

/* ═══════════════════════════════════════════════════════════
   QUERIES — chips
   ═══════════════════════════════════════════════════════════ */

/**
 * Whether a chip may be played on a matchday. Returns a reason rather than
 * a bare false, because "greyed out" with no explanation is the thing that
 * sends you to the official rules page mid-plan.
 */
export function canPlayChip(chip, md, { wildcardPlayedMd = null, limitlessPlayedMd = null } = {}) {
  if (!CHIPS[chip]) return { ok: false, code: 'UNKNOWN_CHIP', message: `No such chip: ${chip}` };
  if (!isMatchday(md)) return { ok: false, code: 'BAD_MATCHDAY', message: `Matchday out of range: ${md}` };

  /* An unlimited-transfer window already gives you everything a Wildcard
     gives you, so the game does not let you burn one there. */
  if (isUnlimitedTransferMd(md)) {
    return {
      ok: false,
      code: 'UNLIMITED_WINDOW',
      message: `MD${md} already has unlimited transfers — a chip here buys you nothing.`,
    };
  }

  const playedMd = chip === 'wildcard' ? wildcardPlayedMd : limitlessPlayedMd;
  if (playedMd) {
    return {
      ok: false,
      code: 'ALREADY_PLAYED',
      message: `${CHIPS[chip].label} was played on MD${playedMd}. It is a one-shot chip.`,
    };
  }
  return { ok: true, code: 'OK', message: `${CHIPS[chip].label} is available on MD${md}.` };
}

/** The matchdays a chip token may be dropped on — everything else greys out. */
export function legalChipMatchdays(chip, played = {}) {
  const out = [];
  for (let md = 1; md <= MATCHDAY_COUNT; md++) {
    if (canPlayChip(chip, md, played).ok) out.push(md);
  }
  return out;
}

/**
 * Playing a chip cancels transfers already made that matchday and refunds
 * their hits. Worth its own function because the ordering is a genuine trap:
 * take two hits, then Wildcard, and you have paid nothing.
 */
export function chipCancelsTransfers(chip) {
  return Boolean(CHIPS[chip]);
}

/* ═══════════════════════════════════════════════════════════
   FORMATIONS
   ═══════════════════════════════════════════════════════════ */

/** Every XI that satisfies the minimums and fits inside a legal squad. */
export const LEGAL_FORMATIONS = Object.freeze((() => {
  const out = [];
  for (let def = XI_MIN.DEF; def <= XI_MAX.DEF; def++) {
    for (let mid = XI_MIN.MID; mid <= XI_MAX.MID; mid++) {
      const fwd = XI_SIZE - 1 - def - mid;
      if (fwd < XI_MIN.FWD || fwd > XI_MAX.FWD) continue;
      out.push(Object.freeze({ GK: 1, DEF: def, MID: mid, FWD: fwd, label: `${def}-${mid}-${fwd}` }));
    }
  }
  return out;
})());

export function countPositions(players) {
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of players) {
    if (counts[p.pos] === undefined) continue;
    counts[p.pos] += 1;
  }
  return counts;
}

export function isLegalFormation(counts) {
  const total = POSITIONS.reduce((n, pos) => n + (counts[pos] || 0), 0);
  if (total !== XI_SIZE) return false;
  return POSITIONS.every((pos) => {
    const n = counts[pos] || 0;
    return n >= XI_MIN[pos] && n <= XI_MAX[pos];
  });
}

export function formationLabel(counts) {
  return `${counts.DEF || 0}-${counts.MID || 0}-${counts.FWD || 0}`;
}

/* ═══════════════════════════════════════════════════════════
   VALIDATORS

   All of them return the same shape:
     { ok, breaches: [{ code, message, ...detail }], ...context }
   ═══════════════════════════════════════════════════════════ */

/**
 * The squad, against the matchday it is meant for. `chip` switches the
 * budget off for Limitless — and only the budget: the club cap still binds,
 * which is the detail that makes the what-if squad useful rather than a
 * fantasy of eleven strikers from one club.
 */
export function validateSquad(squad, md, { chip = null } = {}) {
  const breaches = [];
  const players = Array.isArray(squad) ? squad : [];
  const budgetApplies = !chip || CHIPS[chip]?.budgetApplies !== false;
  const budget = budgetApplies ? budgetFor(md) : Infinity;
  const clubCap = clubCapFor(md);

  if (players.length !== SQUAD_SIZE) {
    breaches.push({
      code: 'SQUAD_SIZE',
      message: `${players.length} of ${SQUAD_SIZE} players picked.`,
      have: players.length, need: SQUAD_SIZE,
    });
  }

  const seen = new Set();
  for (const p of players) {
    if (seen.has(p.id)) {
      breaches.push({ code: 'DUPLICATE_PLAYER', message: `${p.name || p.id} is in the squad twice.`, id: p.id });
    }
    seen.add(p.id);
    if (!POSITIONS.includes(p.pos)) {
      breaches.push({ code: 'UNKNOWN_POSITION', message: `${p.name || p.id} has no recognised position (${p.pos}).`, id: p.id });
    }
  }

  const counts = countPositions(players);
  for (const pos of POSITIONS) {
    if (counts[pos] !== SQUAD_SHAPE[pos]) {
      breaches.push({
        code: 'POSITION_COUNT',
        message: `${counts[pos]} ${pos}, needs exactly ${SQUAD_SHAPE[pos]}.`,
        pos, have: counts[pos], need: SQUAD_SHAPE[pos],
      });
    }
  }

  const clubCounts = {};
  for (const p of players) clubCounts[p.club] = (clubCounts[p.club] || 0) + 1;
  for (const [club, n] of Object.entries(clubCounts)) {
    if (n > clubCap) {
      breaches.push({
        code: 'CLUB_CAP',
        message: `${n} from ${club}, and ${stageFor(md).label} allows ${clubCap}.`,
        club, have: n, cap: clubCap,
      });
    }
  }

  /* Prices are one decimal place; summing them in binary floating point is
     how you get 99.99999999999999 and a budget breach that is not real. */
  const spend = Math.round(players.reduce((n, p) => n + (Number(p.price) || 0), 0) * 10) / 10;
  if (budgetApplies && spend > budget) {
    breaches.push({
      code: 'BUDGET',
      message: `${spend.toFixed(1)}m spent of ${budget.toFixed(1)}m.`,
      spend, budget, over: Math.round((spend - budget) * 10) / 10,
    });
  }

  return {
    ok: breaches.length === 0,
    breaches,
    counts,
    clubCounts,
    clubCap,
    spend,
    budget,
    remaining: budgetApplies ? Math.round((budget - spend) * 10) / 10 : Infinity,
    stage: stageFor(md).key,
  };
}

/**
 * The starting eleven. `squad` is optional; pass it and every starter is
 * checked for actually being in the squad, which is the mistake a drag-and-
 * drop pitch view makes possible.
 */
export function validateXI(xi, { squad = null } = {}) {
  const breaches = [];
  const players = Array.isArray(xi) ? xi : [];

  if (players.length !== XI_SIZE) {
    breaches.push({
      code: 'XI_SIZE',
      message: `${players.length} of ${XI_SIZE} starters picked.`,
      have: players.length, need: XI_SIZE,
    });
  }

  const seen = new Set();
  for (const p of players) {
    if (seen.has(p.id)) breaches.push({ code: 'DUPLICATE_PLAYER', message: `${p.name || p.id} is in the XI twice.`, id: p.id });
    seen.add(p.id);
  }

  if (squad) {
    const ids = new Set(squad.map((p) => p.id));
    for (const p of players) {
      if (!ids.has(p.id)) {
        breaches.push({ code: 'NOT_IN_SQUAD', message: `${p.name || p.id} is not in your 15.`, id: p.id });
      }
    }
  }

  const counts = countPositions(players);
  for (const pos of POSITIONS) {
    const n = counts[pos];
    if (n < XI_MIN[pos]) {
      breaches.push({
        code: 'POSITION_MIN',
        message: `${n} ${pos} in the XI, minimum ${XI_MIN[pos]}.`,
        pos, have: n, min: XI_MIN[pos],
      });
    } else if (n > XI_MAX[pos]) {
      breaches.push({
        code: 'POSITION_MAX',
        message: `${n} ${pos} in the XI, maximum ${XI_MAX[pos]}.`,
        pos, have: n, max: XI_MAX[pos],
      });
    }
  }

  return {
    ok: breaches.length === 0,
    breaches,
    counts,
    formation: formationLabel(counts),
    legal: isLegalFormation(counts),
  };
}

/**
 * The gap between day one and day two: up to four swaps, and only for a
 * bench player whose club has not kicked off yet.
 *
 * `clubHasPlayed` is a predicate rather than a list because the caller
 * knows the fixture feed and this module deliberately does not.
 */
export function validateSubs({ md, xi = [], bench = [], subs = [], clubHasPlayed = () => false }) {
  const breaches = [];

  if (!inMatchdayChangesAllowed(md)) {
    breaches.push({
      code: 'NO_CHANGE_WINDOW',
      message: `MD${md} kicks off as one block — there is no gap to make changes in.`,
      md,
    });
  }

  if (subs.length > MAX_IN_MATCHDAY_SUBS) {
    breaches.push({
      code: 'TOO_MANY_SUBS',
      message: `${subs.length} swaps, and the limit is ${MAX_IN_MATCHDAY_SUBS}.`,
      have: subs.length, max: MAX_IN_MATCHDAY_SUBS,
    });
  }

  const byId = new Map([...xi, ...bench].map((p) => [p.id, p]));
  const xiIds = new Set(xi.map((p) => p.id));
  const benchIds = new Set(bench.map((p) => p.id));
  const outSeen = new Set();
  const inSeen = new Set();

  for (const sub of subs) {
    const out = byId.get(sub.out);
    const inc = byId.get(sub.in);

    if (!xiIds.has(sub.out)) {
      breaches.push({ code: 'OUT_NOT_STARTING', message: `${out?.name || sub.out} is not in your XI.`, id: sub.out });
    }
    if (!benchIds.has(sub.in)) {
      breaches.push({ code: 'IN_NOT_BENCH', message: `${inc?.name || sub.in} is not on your bench.`, id: sub.in });
    }
    if (outSeen.has(sub.out)) {
      breaches.push({ code: 'DUPLICATE_SUB', message: `${out?.name || sub.out} is subbed out twice.`, id: sub.out });
    }
    if (inSeen.has(sub.in)) {
      breaches.push({ code: 'DUPLICATE_SUB', message: `${inc?.name || sub.in} is subbed in twice.`, id: sub.in });
    }
    outSeen.add(sub.out);
    inSeen.add(sub.in);

    /* The rule that catches people out: the player coming ON must still be
       to play. A bench player whose club is already done is not available,
       however many points he scored. */
    if (inc && clubHasPlayed(inc.club)) {
      breaches.push({
        code: 'IN_ALREADY_PLAYED',
        message: `${inc.name || inc.id}'s club has already played — he cannot come in.`,
        id: inc.id, club: inc.club,
      });
    }
  }

  /* The resulting shape has to stand on its own. */
  const resulting = xi
    .filter((p) => !outSeen.has(p.id))
    .concat(subs.map((s) => byId.get(s.in)).filter(Boolean));
  const counts = countPositions(resulting);
  if (resulting.length === XI_SIZE && !isLegalFormation(counts)) {
    breaches.push({
      code: 'ILLEGAL_FORMATION',
      message: `Those swaps leave you ${formationLabel(counts)}, which is not a legal shape.`,
      counts,
    });
  }

  return {
    ok: breaches.length === 0,
    breaches,
    resulting,
    counts,
    formation: formationLabel(counts),
    /* Stated rather than implied: whatever he does on day two, a player you
       took out scores nothing. */
    subbedOutScoreZero: [...outSeen],
    /* And the price of touching anything at all. */
    autoSubsDisabled: subs.length > 0,
  };
}

/**
 * Switching the armband between days. One way only, and only onto a player
 * still to kick off.
 */
export function validateCaptainChange({
  md, from, to, xi = [], clubHasPlayed = () => false, alreadyChanged = false,
}) {
  const breaches = [];

  if (!inMatchdayChangesAllowed(md)) {
    breaches.push({
      code: 'NO_CHANGE_WINDOW',
      message: `MD${md} kicks off as one block — the armband is set at the deadline.`,
      md,
    });
  }
  if (alreadyChanged) {
    breaches.push({
      code: 'ALREADY_CHANGED',
      message: 'The captain has already been switched this matchday. You cannot change back.',
    });
  }

  const target = xi.find((p) => p.id === to);
  if (!target) {
    breaches.push({ code: 'NOT_IN_XI', message: 'You can only captain a player in your starting XI.', id: to });
  } else if (clubHasPlayed(target.club)) {
    breaches.push({
      code: 'TARGET_ALREADY_PLAYED',
      message: `${target.name || target.id} has already played — he cannot take the armband.`,
      id: target.id, club: target.club,
    });
  }
  if (from === to) {
    breaches.push({ code: 'NO_OP', message: 'That player is already your captain.', id: to });
  }

  return { ok: breaches.length === 0, breaches, autoSubsDisabled: breaches.length === 0 };
}

/* ═══════════════════════════════════════════════════════════
   AUTO-SUBS

   What the game does for you if you leave it alone — and only if you leave
   it alone. One manual change anywhere in the matchday and none of this
   runs, which is the trade the sub panel has to put in front of you.
   ═══════════════════════════════════════════════════════════ */

/**
 * @param xi     starting eleven, in order
 * @param bench  the four, in priority order (the spare GK is found by
 *               position, not by slot, so bench order means what it says)
 * @param played predicate: did this player id play any minutes?
 */
export function applyAutoSubs({ xi = [], bench = [], played = () => false, manualChangesMade = false }) {
  if (manualChangesMade) {
    return {
      applied: false,
      reason: 'MANUAL_CHANGES',
      message: 'You made a change during the matchday, so auto-subs are off.',
      xi: [...xi], bench: [...bench], subs: [],
    };
  }

  const nextXi = [...xi];
  const nextBench = [...bench];
  const subs = [];

  const swap = (starter, replacement, reason) => {
    nextXi[nextXi.indexOf(starter)] = replacement;
    nextBench[nextBench.indexOf(replacement)] = starter;
    subs.push({ out: starter.id, in: replacement.id, reason });
  };

  /* The keeper is a special case with no formation question attached: there
     is one spare, and he either played or he did not. */
  const startingGk = nextXi.find((p) => p.pos === 'GK');
  if (startingGk && !played(startingGk.id)) {
    const benchGk = nextBench.find((p) => p.pos === 'GK');
    if (benchGk && played(benchGk.id)) swap(startingGk, benchGk, 'GK');
  }

  /* Outfielders come off the bench in priority order, and only if the shape
     survives. A third centre-half cannot replace your only forward. */
  for (const starter of xi) {
    if (starter.pos === 'GK') continue;
    if (played(starter.id)) continue;
    if (!nextXi.includes(starter)) continue;

    for (const candidate of nextBench) {
      if (candidate.pos === 'GK') continue;
      if (!played(candidate.id)) continue;
      if (!nextBench.includes(candidate)) continue;

      const trial = nextXi.map((p) => (p === starter ? candidate : p));
      if (!isLegalFormation(countPositions(trial))) continue;

      swap(starter, candidate, 'OUTFIELD');
      break;
    }
  }

  return {
    applied: subs.length > 0,
    reason: subs.length ? 'AUTO_SUBBED' : 'NOTHING_TO_DO',
    message: subs.length ? `${subs.length} auto-sub${subs.length === 1 ? '' : 's'}.` : 'No auto-subs were needed.',
    xi: nextXi,
    bench: nextBench,
    subs,
  };
}

/* ═══════════════════════════════════════════════════════════
   SCORING
   ═══════════════════════════════════════════════════════════ */

/**
 * One player's matchday, itemised. The breakdown is not decoration — the
 * debrief is built from it, and a total with no lines behind it is a number
 * you cannot argue with or learn from.
 *
 * Extra time counts towards minutes and stats, but the appearance and clean
 * sheet are each paid once however long the game ran.
 */
export function scorePlayer(stats = {}, pos) {
  if (!POSITIONS.includes(pos)) throw new RangeError(`unknown position: ${pos}`);
  const S = SCORING;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const minutes = n(stats.minutes);
  const conceded = n(stats.goalsConceded);
  const lines = [];
  const add = (key, label, points) => { if (points) lines.push({ key, label, points }); };

  if (minutes > 0) {
    add('appearance', 'Appearance', S.appearance);
    if (minutes >= S.sixtyMinutesThreshold) add('sixty', '60 minutes', S.sixtyMinutes);
  }

  const goals = n(stats.goals);
  add('goals', `Goal${goals === 1 ? '' : 's'}`, goals * S.goal[pos]);
  add('goalsOutsideBox', 'Goal from outside the box', n(stats.goalsOutsideBox) * S.goalOutsideBox);
  add('assists', 'Assist', n(stats.assists) * S.assist);
  add('ballsRecovered', 'Balls recovered', Math.floor(n(stats.ballsRecovered) / S.ballsRecoveredPer) * S.ballsRecoveredPoints);
  if (stats.playerOfTheMatch) add('potm', 'Player of the Match', S.playerOfTheMatch);
  add('penaltiesWon', 'Penalty won', n(stats.penaltiesWon) * S.penaltyWon);
  add('penaltiesConceded', 'Penalty conceded', n(stats.penaltiesConceded) * S.penaltyConceded);
  add('penaltiesMissed', 'Penalty missed', n(stats.penaltiesMissed) * S.penaltyMissed);
  add('yellowCards', 'Yellow card', n(stats.yellowCards) * S.yellowCard);
  add('redCards', 'Red card', n(stats.redCards) * S.redCard);
  add('ownGoals', 'Own goal', n(stats.ownGoals) * S.ownGoal);

  const cleanSheet = minutes >= S.cleanSheetMinutes && conceded === 0;
  if (cleanSheet) add('cleanSheet', 'Clean sheet', S.cleanSheet[pos]);

  if (pos === 'GK') {
    add('penaltySaves', 'Penalty save', n(stats.penaltySaves) * S.penaltySave);
    add('saves', 'Saves', Math.floor(n(stats.saves) / S.savesPer) * S.savesPoints);
  }
  if (S.concededPositions.includes(pos)) {
    add('conceded', 'Goals conceded', Math.floor(conceded / S.concededPer) * S.concededPoints);
  }

  return {
    total: lines.reduce((t, l) => t + l.points, 0),
    lines,
    cleanSheet,
    played: minutes > 0,
  };
}

/** A captain scores double. Stated once, here, rather than at every call site. */
export const CAPTAIN_MULTIPLIER = 2;

export function scoreLineup({ xi = [], bench = [], captain = null, stats = {}, subbedOut = [] }) {
  const zeroed = new Set(subbedOut);
  let total = 0;
  const rows = [];
  for (const p of xi) {
    const scored = zeroed.has(p.id)
      ? { total: 0, lines: [], cleanSheet: false, played: false }
      : scorePlayer(stats[p.id] || {}, p.pos);
    const multiplier = p.id === captain ? CAPTAIN_MULTIPLIER : 1;
    const points = scored.total * multiplier;
    rows.push({ id: p.id, pos: p.pos, points, multiplier, ...scored });
    total += points;
  }
  return { total, rows, bench: bench.map((p) => p.id) };
}
