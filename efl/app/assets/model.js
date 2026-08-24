/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — the models.

   Three of them, and all three are deliberately simple enough to argue
   with:

     fixtureRating()  how hard a club's next match looks, 1 (easiest) to
                      5 (hardest)
     playerScore()    how strong a weekly pick a player looks, 0-100
     clubScore()      how strong one of the two club picks looks, 0-100

   ── WHY EVERY WEIGHT IS IN ONE TABLE ───────────────────────
   Each model is a weighted sum of inputs that are each normalised to 0-1,
   with the weights in an exported table at the top. Two consequences, both
   intended: the weights can be re-tuned without touching any scoring code,
   and every score can explain itself, because the contribution of each
   input is just `weight × value` and can be sorted and read out in English.
   That is what `Recommendation.factors` and `.summary` are.

   ── DIVISION-AWARE NORMALISATION ───────────────────────────
   Every input is min-maxed WITHIN THE CLUB'S OWN DIVISION. A League Two
   side conceding 0.9 a game is measured against League Two, not against the
   Championship. Without that, "best fixtures" collapses into "lowest
   division", and cross-division comparison — the thing Fantasy EFL asks of
   you that no Premier League game does — stops working.

   ── WHAT THESE MODELS ARE NOT ──────────────────────────────
   They are not predictions and they carry no claim of accuracy. They rank
   the options in front of you against stated criteria. Where the interface
   uses a number, it says "modelled"; where it uses a word, the word is
   "favourable" or "strong option", never "will".
   ═══════════════════════════════════════════════════════════ */

/** @typedef {import('./types.js')} */

import { statPoints } from './tariff.js';
import { suspensionRisk } from './suspension.js';

/* ── Weight tables ────────────────────────────────────────
   Change a number here and the whole app changes with it. Each table sums
   to 1 so a score stays inside 0-100 and a factor's contribution is
   directly readable as a share of the total. */

export const FIXTURE_WEIGHTS = {
  /* How good the opponent is overall — points per game is the least
     gameable single summary of that. */
  opponentPointsPerGame: 0.50,
  /* Their defence, because a clean sheet pick lives or dies on it. */
  opponentDefence: 0.28,
  /* Their attack, because a defender's clean sheet and a goalkeeper's save
     points care about who is shooting at them. */
  opponentAttack: 0.22
};
/* Applied AFTER the opponent index, in index units (the index runs 0-1
   across a division). 0.10 is a fifth of a difficulty band each way, so
   home advantage moves a borderline fixture by one band and never more. */
export const HOME_ADVANTAGE = 0.10;

/* ── Player weights, and where these numbers came from ─────
   These were guesses once. They are not any more.

   Measured on 83,698 real Fantasy EFL player-gameweek records (35 rounds
   of a completed season, published by the official game), walk-forward
   over rounds 6-35: for each of 52,158 player-rounds, build a predictor
   from prior rounds only and correlate it with the points actually scored
   in the NEXT round.

       last-5 mean MINUTES        +0.515   ← the strongest thing there is
       last-5 total points        +0.494
       season start rate          +0.461
       last-5 points/appearance   +0.447
       season points/appearance   +0.408
       last-5 points PER 90       +0.065   ← very nearly worthless

   Two conclusions are written into the table below.

   MINUTES OUTWEIGH FORM. This model previously had form at 0.30 and
   minutes at 0.22, which is the FPL habit and the wrong way round for this
   game. A player averaging under 30 minutes across his last five returns
   0.59 points the following round; one averaging 75+ returns 4.25. Nothing
   else in the dataset separates players like that.

   PER-90 IS A TRAP, and the app was already right to avoid it: it flatters
   a substitute who scores in a twenty-minute cameo. Form here is points per
   APPEARANCE (+0.447), never per 90 (+0.065). */
export const PLAYER_WEIGHTS = {
  minutes: 0.34,     // starts and minutes — the floor, and the best single signal
  form: 0.26,        // fantasy points per appearance in the last five rounds
  output: 0.16,      // the tariff value of a player's output, per 90
  fixture: 0.16,     // next fixture's modelled difficulty
  home: 0.08         // playing at home
};

/* ── Position emphasis ────────────────────────────────────
   A flat fixture weight and a flat home weight are both wrong, and the same
   dataset says by how much.

   HOME ADVANTAGE is not one number. Mean points per appearance, home vs
   away:  GK +0.7%   DEF +6.0%   MID +8.9%   FWD +14.3%.
   A goalkeeper barely notices where he is playing. A forward notices a lot.

   FIXTURE DIFFICULTY matters roughly twice as much at the back. Across all
   positions, mean points move 4.10 → 3.49 from the easiest band to the
   hardest — about 17%. But clean-sheet rate for goalkeepers and defenders
   moves 36.3% → 19.0%, which is nearly half, and a clean sheet is five
   points. The fixture IS the pick for a defender; for a forward it is one
   input among several.

   These are multipliers on the base weights above. Applied, the result is
   renormalised so each position's weights still sum to 1 and a score stays
   comparable across positions — see positionWeights(). */
export const POSITION_EMPHASIS = {
  GK: { fixture: 1.70, home: 0.10 },
  DEF: { fixture: 1.60, home: 0.65 },
  MID: { fixture: 0.85, home: 1.00 },
  FWD: { fixture: 0.70, home: 1.60 }
};

/**
 * The weight table for one position: base weights, emphasis applied,
 * renormalised to sum to 1.
 * @param {'GK'|'DEF'|'MID'|'FWD'} position
 */
export function positionWeights(position) {
  const emphasis = POSITION_EMPHASIS[position] || {};
  const scaled = {};
  let total = 0;
  for (const [key, weight] of Object.entries(PLAYER_WEIGHTS)) {
    scaled[key] = weight * (emphasis[key] == null ? 1 : emphasis[key]);
    total += scaled[key];
  }
  for (const key of Object.keys(scaled)) scaled[key] /= total;
  return scaled;
}
/* Availability is a MULTIPLIER, not another weighted input. An injured
   player with perfect form is not "slightly worse" — he is not a pick. */
export const AVAILABILITY_MULTIPLIER = {
  available: 1,
  doubtful: 0.72,
  injured: 0.12,
  suspended: 0.08,
  unavailable: 0.10
};

export const CLUB_WEIGHTS = {
  form: 0.28,        // points in the last five
  attack: 0.17,      // goals scored in the last five
  defence: 0.20,     // goals conceded in the last five
  fixtures: 0.28,    // modelled quality of the next three
  home: 0.07         // how many of the next three are at home
};

/* The "form differential" model. The official game publishes ownership for
   CLUBS but not for players, so at player level this is explicitly NOT a
   differential in the ownership sense — it is an editorial one: strong
   recent output at a club that gets less attention. The interface labels it
   as modelled every time it appears. */
export const DIFFERENTIAL_WEIGHTS = { output: 0.6, obscurity: 0.4 };
/* How much of the football conversation each division gets. Not a quality
   judgement — a visibility one, and the only place in this file where the
   divisions are deliberately not treated as equals. */
export const DIVISION_PROMINENCE = { championship: 1, 'league-one': 0.5, 'league-two': 0.25 };

export const RATING_LABELS = {
  1: 'Very favourable',
  2: 'Favourable',
  3: 'Even',
  4: 'Tough',
  5: 'Very tough'
};

export const POSITION_NAMES = {
  GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward'
};

export const AVAILABILITY_LABELS = {
  available: 'Available',
  doubtful: 'Doubtful',
  injured: 'Injured',
  suspended: 'Suspended',
  unavailable: 'Unavailable'
};

/* ── small helpers ────────────────────────────────────── */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const safeDiv = (a, b) => (b ? a / b : 0);

/** Min-max a map of id → number into id → 0-1. A flat input maps to 0.5,
 *  which is the honest answer: nothing separates them. */
function normalise(values) {
  const nums = Object.values(values).filter((v) => Number.isFinite(v));
  if (!nums.length) return {};
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min;
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = span === 0 ? 0.5 : clamp01((v - min) / span);
  }
  return out;
}

/**
 * Everything the scoring functions need, computed once per snapshot.
 * Pages call this and pass the result around; nothing recomputes it per row.
 *
 * @param {{clubs:Object[], players:Object[], fixtures:Object[], currentRound:number}} snapshot
 * @param {{fixtureWeights?:Object}} [opts]
 */
export function buildContext(snapshot, opts = {}) {
  const fixtureWeights = { ...FIXTURE_WEIGHTS, ...(opts.fixtureWeights || {}) };
  const clubs = snapshot.clubs || [];
  const players = snapshot.players || [];
  const fixtures = (snapshot.fixtures || []).slice()
    .sort((a, b) => a.round - b.round || String(a.kickoff).localeCompare(String(b.kickoff)));
  const currentRound = snapshot.currentRound || 1;

  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));
  const divisions = [...new Set(clubs.map((c) => c.division))];

  /* Opponent index: one 0-1 number per club describing how hard it is to
     play, normalised inside its own division. Every fixture rating in the
     app is this number plus a home/away shift, which is why the rating can
     be explained in one sentence. */
  const opponentIndex = {};
  const divisionStats = {};
  for (const div of divisions) {
    const inDiv = clubs.filter((c) => c.division === div);
    const ppg = {}; const defence = {}; const attack = {};
    for (const c of inDiv) {
      ppg[c.id] = safeDiv(c.points, c.played);
      /* Inverted: 1 means the meanest defence in the division, so every
         input points the same way (higher = harder opponent). */
      defence[c.id] = -safeDiv(c.goalsAgainst, c.played);
      attack[c.id] = safeDiv(c.goalsFor, c.played);
    }
    const nPpg = normalise(ppg);
    const nDef = normalise(defence);
    const nAtt = normalise(attack);
    const raw = {};
    for (const c of inDiv) {
      raw[c.id] = fixtureWeights.opponentPointsPerGame * nPpg[c.id]
        + fixtureWeights.opponentDefence * nDef[c.id]
        + fixtureWeights.opponentAttack * nAtt[c.id];
    }
    /* Re-spread the composite across the full 0-1 range. Three averaged
       inputs cluster around the middle; without this every fixture in the
       league would come out a 3, which is a scale that tells you nothing. */
    const spread = normalise(raw);
    for (const c of inDiv) {
      opponentIndex[c.id] = spread[c.id];
    }

    /* Club-form inputs, also division-local. */
    const formPts = {}; const attackL5 = {}; const defenceL5 = {};
    for (const c of inDiv) {
      formPts[c.id] = safeDiv(c.last5.points, Math.max(1, c.last5.played));
      attackL5[c.id] = safeDiv(c.last5.goalsFor, Math.max(1, c.last5.played));
      defenceL5[c.id] = -safeDiv(c.last5.goalsAgainst, Math.max(1, c.last5.played));
    }
    divisionStats[div] = {
      form: normalise(formPts),
      attack: normalise(attackL5),
      defence: normalise(defenceL5),
      clubCount: inDiv.length
    };
  }

  /* Fixtures each club still has to play, in order. A club can hold two in
     one round (a rearranged match) or none (a cup weekend); both are kept
     as they are rather than flattened, because both change a pick. */
  const upcomingByClub = {};
  for (const f of fixtures) {
    if (f.finished || f.round < currentRound) continue;
    (upcomingByClub[f.homeId] || (upcomingByClub[f.homeId] = [])).push(f);
    (upcomingByClub[f.awayId] || (upcomingByClub[f.awayId] = [])).push(f);
  }

  const playersByClub = {};
  for (const p of players) (playersByClub[p.clubId] || (playersByClub[p.clubId] = [])).push(p);

  /* How many matches a club has actually played, which is the denominator
     under every "share of available minutes" in the model.

     It cannot just be `club.played`. The official feed's public documents
     carry a league position and a form string but no played count, so
     `club.played` is 0 there — and dividing by that turns the single
     strongest signal in the whole model into either a divide-by-one (every
     player looks ever-present) or a zero (nobody does). Both are wrong in a
     way that is invisible until someone notices the squad builder returning
     nothing.

     So it is the largest of what we know: the club's own count, the number
     of finished fixtures we hold for it, and the busiest player's
     appearances. Taking the max keeps every share inside 0-1 and degrades
     to something sensible on a source that publishes only one of the three. */
  const playedByClub = {};
  /* The same three numbers WITHOUT the floor of one. The floor above is
     there so nothing divides by zero, and it is also what makes "no
     football has been played yet" indistinguishable from "one match has" —
     which cost the first round of a season before anyone noticed. Keeping
     the unfloored maximum costs one variable and answers the question. */
  let playedEvidence = 0;
  for (const c of clubs) {
    const finished = fixtures.filter((f) => f.finished && (f.homeId === c.id || f.awayId === c.id)).length;
    const squad = playersByClub[c.id] || [];
    const busiest = squad.reduce((m, p) => Math.max(m, p.appearances || 0), 0);
    playedEvidence = Math.max(playedEvidence, c.played || 0, finished, busiest);
    playedByClub[c.id] = Math.max(1, c.played || 0, finished, busiest);
  }

  const ctx = {
    snapshot,
    clubs,
    players,
    fixtures,
    currentRound,
    clubById,
    divisions,
    opponentIndex,
    divisionStats,
    upcomingByClub,
    playersByClub,
    playedByClub,
    /* False only before a ball has been kicked all season. */
    seasonStarted: playedEvidence > 0,
    fixtureWeights
  };

  /* Player-level normalisation needs the fixture ratings, so it runs last.
     Form and output are normalised within division AND position: a
     goalkeeper's points are not on the same scale as a forward's, and
     pretending otherwise is how every "best player" list ends up all
     forwards. */
  ctx.playerNorms = buildPlayerNorms(ctx);
  return ctx;
}

function buildPlayerNorms(ctx) {
  const groups = {};
  for (const p of ctx.players) {
    const key = `${p.division}|${p.position}`;
    (groups[key] || (groups[key] = [])).push(p);
  }
  const form = {}; const output = {};
  for (const list of Object.values(groups)) {
    const formRaw = {}; const outRaw = {};
    for (const p of list) {
      const apps = p.last5.filter((m) => m.minutes > 0).length;
      formRaw[p.id] = safeDiv(p.last5.reduce((s, m) => s + m.points, 0), Math.max(1, apps));
      outRaw[p.id] = rawOutput(p);
    }
    Object.assign(form, normalise(formRaw));
    Object.assign(output, normalise(outRaw));
  }
  return { form, output };
}

/**
 * A player's output, measured in the currency the game actually pays in.
 *
 * This used to be a hand-tuned blend — clean sheets worth 0.7 of a goal for
 * a defender, and so on. There is no need to guess at those ratios now that
 * the tariff is known and verified: the answer to "how much is this
 * player's output worth" is the arithmetic the game itself does. So this
 * runs every season total through statPoints() and returns the result per
 * 90 minutes.
 *
 * That change matters most for midfielders, whose interceptions are worth
 * two points each — the most valuable repeatable stat in the game, and one
 * the old hand-tuned blend could not see at all because it only knew about
 * goals, assists and clean sheets.
 *
 * Stats the active source does not publish are `null` and are skipped, not
 * counted as zero. A source with no tackles data must not make every
 * defender look like one who never tackles.
 */
function rawOutput(p) {
  const minutes = Math.max(90, p.minutes);
  const stats = p.stats || {};
  let points = 0;
  points += statPoints('goals', p.goals, p.position);
  points += statPoints('assists', p.assists, p.position);
  points += statPoints('cleanSheets', p.cleanSheets, p.position);
  for (const [key, value] of Object.entries(stats)) {
    /* Cards and goals conceded are real tariff lines, but they are noise in
       a "how good is his output" measure: they scale with playing time, and
       a defender is not a worse pick for having conceded goals his team
       conceded. Availability and the fixture rating already carry that. */
    if (value == null || key === 'yellowCards' || key === 'redCards' || key === 'goalsConceded') continue;
    points += statPoints(key, value, p.position);
  }
  return safeDiv(points, minutes) * 90;
}

/* ── Fixture rating ──────────────────────────────────────── */

/**
 * Rate one fixture from one club's point of view.
 * @returns {{rating:number, label:string, difficulty:number, opponentId:string,
 *            home:boolean, kickoff:string, round:number, reason:string}}
 */
export function fixtureRating(ctx, clubId, fixture) {
  const home = fixture.homeId === clubId;
  const opponentId = home ? fixture.awayId : fixture.homeId;
  const base = ctx.opponentIndex[opponentId];
  const difficulty = clamp01((base == null ? 0.5 : base) + (home ? -HOME_ADVANTAGE : HOME_ADVANTAGE));
  const rating = difficulty < 0.2 ? 1 : difficulty < 0.4 ? 2 : difficulty < 0.6 ? 3
    : difficulty < 0.8 ? 4 : 5;
  const opponent = ctx.clubById[opponentId];
  const oppName = opponent ? opponent.name : 'Unknown';
  const place = home ? 'at home to' : 'away at';
  const rank = opponent ? ` (${ordinal(opponent.position)} in the division)` : '';
  return {
    rating,
    label: RATING_LABELS[rating],
    difficulty,
    opponentId,
    home,
    kickoff: fixture.kickoff,
    round: fixture.round,
    fixtureId: fixture.id,
    postponed: fixture.status === 'postponed',
    reason: `${RATING_LABELS[rating]}: ${place} ${oppName}${rank}.`
  };
}

/** The next `n` rounds for a club, one entry per round — including the
 *  empty ones. A blank round is a real answer to "what have they got next",
 *  and dropping it silently shifts every later fixture a week early. */
export function fixtureRun(ctx, clubId, n = 6) {
  const all = (ctx.upcomingByClub[clubId] || []);
  const rounds = [];
  for (let r = ctx.currentRound; r < ctx.currentRound + n; r += 1) {
    const inRound = all.filter((f) => f.round === r);
    rounds.push({
      round: r,
      matches: inRound.map((f) => fixtureRating(ctx, clubId, f)),
      blank: inRound.length === 0,
      double: inRound.length > 1
    });
  }
  return rounds;
}

/**
 * One number for a run of fixtures: the mean difficulty across every match
 * in the window. A double counts twice (two chances to score); a blank
 * counts as the worst possible, because for a fantasy manager a week with
 * no game is worse than a hard one.
 *
 * @returns {{rounds:Object[], matches:number, blanks:number, doubles:number,
 *            meanDifficulty:number, meanRating:number, quality:number}}
 */
export function runSummary(ctx, clubId, n = 6) {
  const rounds = fixtureRun(ctx, clubId, n);
  const diffs = [];
  let blanks = 0; let doubles = 0; let matches = 0;
  for (const r of rounds) {
    if (r.blank) { blanks += 1; diffs.push(1); continue; }
    if (r.double) doubles += 1;
    matches += r.matches.length;
    for (const m of r.matches) diffs.push(m.difficulty);
  }
  const meanDifficulty = diffs.length ? diffs.reduce((s, v) => s + v, 0) / diffs.length : 0.5;
  return {
    rounds,
    matches,
    blanks,
    doubles,
    meanDifficulty,
    meanRating: 1 + meanDifficulty * 4,
    quality: 1 - meanDifficulty
  };
}

/** The fixture a manager is actually picking for: the first one in the
 *  current round, or the next one after it if this round is blank.
 *
 *  Kept as the SINGLE fixture for everything that needs one — the row that
 *  says "v Cambridge", the ledger's existing field. What it must not be is
 *  the basis for scoring a round, because in a double round it silently
 *  throws the second match away: see roundFixtures. */
export function nextFixture(ctx, clubId) {
  const all = ctx.upcomingByClub[clubId] || [];
  const f = all.find((x) => x.round >= ctx.currentRound);
  return f ? fixtureRating(ctx, clubId, f) : null;
}

/** EVERY fixture a club has in the round being picked for.
 *
 *  buildContext deliberately keeps two-in-a-round rather than flattening,
 *  "because both change a pick" — and then nextFixture flattened it anyway
 *  for the one thing that actually picks the team. In a double round that
 *  is the whole edge thrown away: two chances to score is the reason a
 *  double is worth planning around at all.
 *
 *  Falls forward exactly as nextFixture does when this round is blank, so a
 *  club with nothing on is still described by the match it does have next
 *  rather than by an empty list. */
export function roundFixtures(ctx, clubId) {
  const all = ctx.upcomingByClub[clubId] || [];
  const inRound = all.filter((f) => f.round === ctx.currentRound);
  const use = inRound.length ? inRound : all.filter((f) => f.round >= ctx.currentRound).slice(0, 1);
  return use.map((f) => fixtureRating(ctx, clubId, f));
}

/** The round's fixtures as one 0-1 opportunity figure.
 *
 *  Each match is a chance at a good return with probability (1 − difficulty),
 *  so a round is the chance of AT LEAST ONE: 1 − Π(1 − oᵢ).
 *
 *  Two properties make this safe to change mid-season. On a single fixture
 *  it is exactly (1 − difficulty) — the arithmetic the model has always
 *  used — so every single round scores identically and nothing needs
 *  re-calibrating or re-grading. And it cannot leave 0-1 by construction,
 *  so no clamp is hiding a number that ran away.
 *
 *  It is also the right SHAPE: two winnable matches (0.8 each) reach 0.96,
 *  a winnable one beside a hard one (0.8, 0.2) reaches 0.84, and two hard
 *  ones (0.2) only 0.36. More football is better, and better still when
 *  both matches are winnable — which is what a manager actually believes. */
export function roundOpportunity(rated) {
  const list = rated || [];
  if (!list.length) return 0;
  let miss = 1;
  for (const m of list) miss *= 1 - clamp01(1 - m.difficulty);
  return clamp01(1 - miss);
}

/* ── Player score ────────────────────────────────────────── */

/**
 * Score a player as a pick for the current round.
 * @returns {import('./types.js').Recommendation & {player:Object, next:Object|null}}
 */
export function playerScore(ctx, player) {
  const club = ctx.clubById[player.clubId];
  /* The whole round, not just the first match of it. `next` stays the
     single fixture for every caller that prints one. */
  const fixtures = roundFixtures(ctx, player.clubId);
  const next = fixtures[0] || null;
  const norms = ctx.playerNorms;

  const values = {
    form: norms.form[player.id] == null ? 0.5 : norms.form[player.id],
    minutes: playingShare(ctx, player).value,
    output: norms.output[player.id] == null ? 0.5 : norms.output[player.id],
    /* A blank round is not a neutral fixture. Nothing to play in scores 0. */
    fixture: roundOpportunity(fixtures),
    /* "Has he got home football this round" — the same question the old
       boolean asked, generalised to a set rather than replaced by one.

       A SHARE was the obvious first move and it is wrong: one home and one
       away scores 0.5, below the 1.0 of a single home match, so adding a
       second match could LOWER a player's rating. A double that makes a
       player worse is the opposite of what a double is, and the first
       version of this change did exactly that until a test compared the
       same player with and without his extra match. */
    home: roundOpportunity(fixtures.map((f) => ({ difficulty: f.home ? 0 : 1 })))
  };

  /* Weights are per-position: a goalkeeper's score leans on his fixture and
     barely notices home advantage, a forward's does the reverse. */
  const weights = positionWeights(player.position);
  const factors = Object.entries(weights).map(([key, weight]) => ({
    key,
    label: PLAYER_FACTOR_LABELS[key],
    value: values[key],
    weight,
    note: playerFactorNote(key, values[key], player, club, next, ctx)
  }));

  const weighted = factors.reduce((s, f) => s + f.value * f.weight, 0);
  const availability = player.availability || { status: 'available' };
  const multiplier = AVAILABILITY_MULTIPLIER[availability.status] == null
    ? 1 : AVAILABILITY_MULTIPLIER[availability.status];
  const score = Math.round(clamp01(weighted) * multiplier * 1000) / 10;

  /* Attached, never weighted. A ban costs the round AFTER the booking, and
     marking a player down today for a match he will miss next week would be
     scoring the wrong week. `suspension.js` argues this at length; the short
     version is that the availability multiplier already covers a player who
     is suspended NOW, and this covers one who might be next round. */
  const suspension = suspensionRisk(player, ctx.playedByClub
    ? ctx.playedByClub[player.clubId] : null);

  return {
    kind: 'player',
    id: player.id,
    player,
    next,
    /* Every match in the round, and how many. A caller that only ever
       reads `next` keeps working; one that wants to SAY "double" now can. */
    fixtures,
    double: fixtures.length > 1,
    score,
    factors,
    suspension,
    availabilityMultiplier: multiplier,
    summary: buildSummary(factors, availability, next, suspension)
  };
}

/**
 * How much of his club's football a player has been on the pitch for, 0-1.
 *
 * This is the model's strongest input (+0.515 against next-round points),
 * so it has to survive a source that publishes less than the sample data
 * does. Minutes are the better measure and the official feed's public
 * documents do not carry them, so the fallback is appearance share —
 * weaker, but honest, and vastly better than reading "no minutes field" as
 * "this player never plays".
 *
 * @returns {{value:number, hasMinutes:boolean, startShare:number, minuteShare:number|null}}
 */
export function playingShare(ctx, player) {
  const played = (ctx.playedByClub && ctx.playedByClub[player.clubId])
    || Math.max(1, player.appearances || 1);
  const startShare = clamp01(safeDiv(player.starts, played));
  if (!player.minutes) {
    return { value: startShare, hasMinutes: false, startShare, minuteShare: null };
  }
  const minuteShare = clamp01(safeDiv(player.minutes, played * 90));
  return {
    value: clamp01(startShare * 0.65 + minuteShare * 0.35),
    hasMinutes: true,
    startShare,
    minuteShare
  };
}

const PLAYER_FACTOR_LABELS = {
  form: 'Recent form',
  minutes: 'Starts and minutes',
  output: 'Goals, assists and clean sheets',
  fixture: 'Next fixture',
  home: 'Home advantage'
};

function playerFactorNote(key, value, player, club, next, ctx) {
  const played = ctx && ctx.playedByClub ? ctx.playedByClub[player.clubId] : Math.max(1, (club && club.played) || 1);
  if (key === 'form') {
    const apps = player.last5.filter((m) => m.minutes > 0).length;
    const pts = player.last5.reduce((s, m) => s + m.points, 0);
    /* No per-match history at all is a property of the SOURCE, not of the
       player — saying "no minutes in the last five" about a regular starter
       because the feed does not publish rounds would be a straight lie. */
    if (!player.last5.length) return `${player.points} points across the season so far`;
    if (!apps) return 'no minutes in the last five rounds';
    return value > 0.7 ? `strong recent form (${pts} points in ${apps} appearances)`
      : value > 0.4 ? `steady recent form (${pts} points in ${apps} appearances)`
        : `quiet lately (${pts} points in ${apps} appearances)`;
  }
  if (key === 'minutes') {
    const share = Math.round((player.starts / played) * 100);
    return value > 0.75 ? `started ${player.starts} of ${played} (${share}%)`
      : value > 0.45 ? `in and out of the side (${player.starts} starts in ${played})`
        : `a rotation option (${player.starts} starts in ${played})`;
  }
  if (key === 'output') {
    if (player.position === 'GK' || player.position === 'DEF') {
      return `${player.cleanSheets} clean sheet${player.cleanSheets === 1 ? '' : 's'}`
        + (player.goals + player.assists
          ? ` plus ${player.goals + player.assists} attacking return${player.goals + player.assists === 1 ? '' : 's'}`
          : '');
    }
    return `${player.goals} goal${player.goals === 1 ? '' : 's'} and ${player.assists} assist${player.assists === 1 ? '' : 's'}`;
  }
  if (key === 'fixture') {
    if (!next) return 'no fixture in this round';
    return `${next.label.toLowerCase()} fixture (rated ${next.rating} of 5)`;
  }
  if (key === 'home') return next && next.home ? 'playing at home' : 'away from home';
  return '';
}

/** Turn the factor table into one sentence: the two strongest contributors,
 *  plus anything the manager must be told regardless of its weight. */
function buildSummary(factors, availability, next, suspension) {
  const ranked = factors.slice()
    .filter((f) => f.value > 0.5 || f.key === 'fixture')
    .sort((a, b) => (b.value * b.weight) - (a.value * a.weight));
  const parts = ranked.slice(0, 2).map((f) => f.note).filter(Boolean);
  if (!parts.length) parts.push('no standout factors this round');
  if (next && next.home && !ranked.some((f) => f.key === 'home')) parts.push('at home');
  let sentence = parts.join(', ');
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
  if (availability.status && availability.status !== 'available') {
    sentence += ` ${AVAILABILITY_LABELS[availability.status]} — ${availability.note}.`;
  }
  /* Only the one that changes a decision goes in the sentence. "Three from a
     ban" is a table fact; "one from a ban" is something to say out loud. */
  if (suspension && suspension.level === 'onEdge') {
    sentence += ` One booking from a ${suspension.banMatches}-match ban.`;
  }
  return sentence;
}

/* ── Differential ────────────────────────────────────────── */

/**
 * A MODELLED, EDITORIAL differential — not an ownership one.
 *
 * ── A CORRECTION THIS FUNCTION USED TO GET WRONG ───────────
 * It used to say "no public feed publishes Fantasy EFL ownership". That is
 * true of PLAYERS and false of CLUBS: the official game publishes a
 * `percentSelected` figure per club, which the club picker now shows as a
 * real number. Nothing public appears to publish it per player.
 *
 * So this stays modelled, because for players there is still nothing to
 * read: it ranks strong recent output at clubs that get less of the
 * attention — lower division, lower down the table. `Player.ownership`
 * stays null unless a source fills it, and the day one does, the finder can
 * show the real figure and retire this.
 */
export function differentialScore(ctx, player) {
  const club = ctx.clubById[player.clubId];
  const div = club ? club.division : player.division;
  const clubCount = (ctx.divisionStats[div] && ctx.divisionStats[div].clubCount) || 24;
  const prominence = DIVISION_PROMINENCE[div] == null ? 0.6 : DIVISION_PROMINENCE[div];
  /* Visibility: which division, and how near the top of it. A leader in
     League Two is more visible than a mid-table club in the same division,
     and less visible than a Championship promotion contender. */
  const tableProfile = club ? 1 - (club.position - 1) / Math.max(1, clubCount - 1) : 0.5;
  const visibility = clamp01(prominence * 0.65 + tableProfile * 0.35);
  const output = ctx.playerNorms.form[player.id] == null ? 0.5 : ctx.playerNorms.form[player.id];
  const score = Math.round(
    clamp01(DIFFERENTIAL_WEIGHTS.output * output
      + DIFFERENTIAL_WEIGHTS.obscurity * (1 - visibility)) * 1000
  ) / 10;
  return {
    score,
    visibility,
    label: score >= 70 ? 'Strong differential' : score >= 55 ? 'Differential' : 'Well covered',
    note: `Modelled from recent output and how much attention the club gets — `
      + `${club ? club.name : 'the club'} sit ${club ? ordinal(club.position) : 'mid-table'} in `
      + `${divisionName(div)}. Not an ownership figure: the official game publishes `
      + `ownership for clubs but not for players, so this is an editorial stand-in.`
  };
}

/* ── Club score ──────────────────────────────────────────── */

/**
 * Score a club as one of the two weekly club picks.
 * @returns {import('./types.js').Recommendation & {club:Object, run:Object}}
 */
export function clubScore(ctx, club, opts = {}) {
  const window = opts.window || 3;
  const stats = ctx.divisionStats[club.division] || { form: {}, attack: {}, defence: {} };
  const run = runSummary(ctx, club.id, window);
  const homeCount = run.rounds.reduce(
    (s, r) => s + r.matches.filter((m) => m.home).length, 0
  );

  const values = {
    form: stats.form[club.id] == null ? 0.5 : stats.form[club.id],
    attack: stats.attack[club.id] == null ? 0.5 : stats.attack[club.id],
    defence: stats.defence[club.id] == null ? 0.5 : stats.defence[club.id],
    fixtures: clamp01(run.quality),
    home: clamp01(safeDiv(homeCount, Math.max(1, run.matches)))
  };

  const factors = Object.entries(CLUB_WEIGHTS).map(([key, weight]) => ({
    key,
    label: CLUB_FACTOR_LABELS[key],
    value: values[key],
    weight,
    note: clubFactorNote(key, values[key], club, run, homeCount)
  }));

  const score = Math.round(clamp01(factors.reduce((s, f) => s + f.value * f.weight, 0)) * 1000) / 10;
  const ranked = factors.slice().sort((a, b) => (b.value * b.weight) - (a.value * a.weight));
  const parts = ranked.slice(0, 3).filter((f) => f.value > 0.45).map((f) => f.note);
  let summary = (parts.length ? parts.join(', ') : ranked[0].note);
  summary = summary.charAt(0).toUpperCase() + summary.slice(1) + '.';
  if (run.blanks) summary += ` ${run.blanks} blank round${run.blanks === 1 ? '' : 's'} in the next ${window}.`;
  if (run.doubles) summary += ` ${run.doubles} double round${run.doubles === 1 ? '' : 's'} in the next ${window}.`;

  return { kind: 'club', id: club.id, club, run, score, factors, summary };
}

const CLUB_FACTOR_LABELS = {
  form: 'Recent form',
  attack: 'Goals scored',
  defence: 'Goals conceded',
  fixtures: 'Upcoming fixtures',
  home: 'Home matches'
};

function clubFactorNote(key, value, club, run, homeCount) {
  const l5 = club.last5;
  if (key === 'form') {
    return value > 0.7 ? `${l5.points} points from the last ${l5.played}`
      : value > 0.4 ? `${l5.points} points from the last ${l5.played} — steady`
        : `only ${l5.points} points from the last ${l5.played}`;
  }
  if (key === 'attack') return `${l5.goalsFor} scored in the last ${l5.played}`;
  if (key === 'defence') {
    return `${l5.goalsAgainst} conceded in the last ${l5.played}`
      + (l5.cleanSheets ? ` with ${l5.cleanSheets} clean sheet${l5.cleanSheets === 1 ? '' : 's'}` : '');
  }
  if (key === 'fixtures') {
    return `next ${run.rounds.length} rated ${run.meanRating.toFixed(1)} of 5 on average`;
  }
  if (key === 'home') return `${homeCount} of the next ${run.matches} at home`;
  return '';
}

/**
 * Has any football been played yet this season?
 *
 * This exists because of a bug that would have cost the season's first
 * round. `playingShare()` measures a player against how much of his club's
 * football he has been on the pitch for, and before a ball is kicked that
 * is 0/0 for everyone. The rotation filters below then read 0 as "never
 * plays" and excluded EVERY player in the game, so the squad builder could
 * not assemble a legal seven and the dashboard had no picks at all.
 *
 * Zero and unknown are different, which is the rule this file applies
 * everywhere else. Before the first whistle the minutes gate has nothing to
 * measure, so it is switched off rather than applied to a column of zeroes.
 * The ranking is unaffected: with no minutes, no form and no output, every
 * player's score is driven by his fixture, which is genuinely the only
 * information anyone has in round one.
 */
export function hasPlayedFootball(ctx) {
  /* buildContext() measures this properly. A context assembled by hand —
     a test, a caller predating the flag — is assumed to be mid-season,
     because that is the state the gate was designed for and defaulting the
     other way would silently switch the rotation filter off in production. */
  if (ctx && typeof ctx.seasonStarted === 'boolean') return ctx.seasonStarted;
  return true;
}

/* ── Round picks ─────────────────────────────────────────── */

/**
 * The seven cards on the dashboard: one per position, a differential, a club
 * and a captain. Everything is computed from the same scores the finder and
 * the club picker show, so the dashboard can never disagree with them.
 */
export function roundPicks(ctx, opts = {}) {
  /* Off before the season starts — see hasPlayedFootball(). */
  const minMinutesShare = hasPlayedFootball(ctx)
    ? (opts.minMinutesShare == null ? 0.35 : opts.minMinutesShare) : 0;
  const scored = (opts.scored || ctx.players.map((p) => playerScore(ctx, p)))
    .filter((r) => r.next)              // a player with no fixture is not a pick
    .slice()
    .sort((a, b) => b.score - a.score);

  const eligible = scored.filter((r) => r.player.availability.status === 'available'
    && playingShare(ctx, r.player).value >= minMinutesShare);

  const byPosition = (pos) => eligible.find((r) => r.player.position === pos) || null;

  /* Captain: the strongest available pick with a fixture that is not
     stacked against them. The band cut is explicit rather than a tie-break
     hidden inside the sort — a captain in a rated-5 fixture is a different
     decision, and the model should not make it quietly.

     THIS USED TO PREFER MIDFIELDERS AND FORWARDS, and that was an FPL
     reflex imported into a game that does not reward it. Measured over
     83,698 real appearances, mean points per appearance run DEF 4.19 >
     GK 4.08 > MID 3.88 > FWD 3.14: the forward is the WORST-scoring
     position in Fantasy EFL, because defenders are paid for clean sheets,
     clearances, blocks and tackles, and a keeper's goal is worth ten. The
     armband now goes to the best-rated available player in a reasonable
     fixture, whatever position that turns out to be. */
  const captain = eligible.find((r) => r.next.rating <= 3) || eligible[0] || null;

  const differentials = eligible
    .map((r) => ({ ...r, differential: differentialScore(ctx, r.player) }))
    .filter((r) => r.score >= 40)
    .sort((a, b) => b.differential.score - a.differential.score);

  const clubs = ctx.clubs
    .map((c) => clubScore(ctx, c))
    .sort((a, b) => b.score - a.score);

  return {
    goalkeeper: byPosition('GK'),
    defender: byPosition('DEF'),
    midfielder: byPosition('MID'),
    forward: byPosition('FWD'),
    differential: differentials[0] || null,
    club: clubs[0] || null,
    captain,
    allPlayers: scored,
    allClubs: clubs
  };
}

/* ── Building a legal seven ──────────────────────────────
   The dashboard's "best goalkeeper, best defender, best midfielder, best
   forward" cards are useful, and they are not a team: they ignore the shape
   the game actually asks for. Fantasy EFL takes seven players in one of
   three formations, with at most two from any one club.

   Those constraints are the whole difficulty of the pick. Without them the
   answer is "the seven highest-rated players", which is usually illegal —
   the top of any form-driven list clusters into two or three clubs having a
   good month. */

/** One goalkeeper and six outfielders, in one of three legal shapes. */
export const FORMATIONS = [
  { id: '1-2-2-2', GK: 1, DEF: 2, MID: 2, FWD: 2 },
  { id: '1-2-3-1', GK: 1, DEF: 2, MID: 3, FWD: 1 },
  { id: '1-3-2-1', GK: 1, DEF: 3, MID: 2, FWD: 1 }
];

/** Two players from any one club, unless the one-club chip is played. */
export const MAX_PER_CLUB = 2;
export const SQUAD_SIZE = 7;

/**
 * Build the best legal seven the model can find.
 *
 * A greedy pass down a sorted list is what most tools do here and it is
 * measurably not optimal: taking the best midfielder can lock you out of
 * two better defenders at the same club. So this is a depth-first search
 * with branch-and-bound over the top candidates in each position — the club
 * cap is the only thing coupling the positions together, so the bound
 * (best-possible remaining, ignoring the cap) is tight and prunes hard.
 *
 * The candidate pool is capped and the node count is capped, both to keep
 * this comfortably inside a frame on a phone. With three formations and a
 * pool of 12 per position it settles in single-digit milliseconds.
 *
 * @param {Object} ctx
 * @param {{oneClubChip?:boolean, exclude?:string[], minMinutesShare?:number,
 *          poolSize?:number, scored?:Object[]}} [opts]
 * @returns {{formation:Object, picks:Object[], captain:Object, total:number,
 *            clubCounts:Object, legal:boolean}|null}
 */
export function buildSquad(ctx, opts = {}) {
  const maxPerClub = opts.oneClubChip ? SQUAD_SIZE : MAX_PER_CLUB;
  const exclude = new Set(opts.exclude || []);
  /* Off before the season starts — see hasPlayedFootball(). */
  const minMinutesShare = hasPlayedFootball(ctx)
    ? (opts.minMinutesShare == null ? 0.35 : opts.minMinutesShare) : 0;
  const poolSize = opts.poolSize == null ? 12 : opts.poolSize;

  const scored = (opts.scored || ctx.players.map((p) => playerScore(ctx, p)))
    .filter((r) => r.next)
    .filter((r) => !exclude.has(r.player.id))
    .filter((r) => r.player.availability.status === 'available')
    .filter((r) => playingShare(ctx, r.player).value >= minMinutesShare)
    .sort((a, b) => b.score - a.score);

  const pools = {};
  for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
    pools[pos] = scored.filter((r) => r.player.position === pos).slice(0, poolSize);
  }

  let best = null;
  for (const formation of FORMATIONS) {
    const result = searchFormation(pools, formation, maxPerClub);
    if (result && (!best || result.total > best.total)) best = { ...result, formation };
  }
  if (!best) return null;

  /* The armband goes to the best-rated player IN the built seven, which is
     not always the best-rated player overall — the club cap may have kept
     him out. Captaining someone you have not picked is not a suggestion. */
  const captain = best.picks.reduce((a, b) => (b.score > a.score ? b : a));
  const clubCounts = {};
  for (const r of best.picks) {
    clubCounts[r.player.clubId] = (clubCounts[r.player.clubId] || 0) + 1;
  }
  return {
    formation: best.formation,
    picks: best.picks,
    captain,
    total: Math.round(best.total * 10) / 10,
    clubCounts,
    legal: best.picks.length === SQUAD_SIZE
  };
}

function searchFormation(pools, formation, maxPerClub) {
  /* Slots as a flat list, hardest position first. Filling the scarce
     positions early makes the bound bite sooner. */
  const slots = [];
  for (const pos of ['GK', 'FWD', 'DEF', 'MID']) {
    for (let i = 0; i < formation[pos]; i += 1) slots.push(pos);
  }
  if (slots.some((pos) => pools[pos].length < formation[pos])) return null;

  /* Best-possible remaining score from slot i onwards, ignoring the club
     cap. An upper bound, so pruning against it is safe. */
  const bound = new Array(slots.length + 1).fill(0);
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    const pos = slots[i];
    const rank = slots.slice(0, i).filter((s) => s === pos).length;
    bound[i] = bound[i + 1] + (pools[pos][rank] ? pools[pos][rank].score : 0);
  }

  let bestTotal = -Infinity;
  let bestPicks = null;
  let nodes = 0;
  const NODE_BUDGET = 200000;
  const counts = {};
  const chosen = [];

  (function descend(slotIndex, startAt, total) {
    if (nodes > NODE_BUDGET) return;
    nodes += 1;
    if (slotIndex === slots.length) {
      if (total > bestTotal) { bestTotal = total; bestPicks = chosen.slice(); }
      return;
    }
    if (total + bound[slotIndex] <= bestTotal) return;    // cannot catch up

    const pos = slots[slotIndex];
    const pool = pools[pos];
    /* Same position twice in a row: only consider candidates after the one
       already taken, so {A,B} is not also explored as {B,A}. */
    const from = (slotIndex > 0 && slots[slotIndex - 1] === pos) ? startAt : 0;
    for (let i = from; i < pool.length; i += 1) {
      const candidate = pool[i];
      const clubId = candidate.player.clubId;
      if ((counts[clubId] || 0) >= maxPerClub) continue;
      counts[clubId] = (counts[clubId] || 0) + 1;
      chosen.push(candidate);
      descend(slotIndex + 1, i + 1, total + candidate.score);
      chosen.pop();
      counts[clubId] -= 1;
    }
  }(0, 0, 0));

  return bestPicks ? { picks: bestPicks, total: bestTotal, nodes } : null;
}

/** Plain-English account of why this seven and not another. */
export function squadRationale(ctx, squad) {
  if (!squad) return '';
  const shared = Object.entries(squad.clubCounts).filter(([, n]) => n > 1)
    .map(([id]) => (ctx.clubById[id] || {}).name).filter(Boolean);
  const divisions = new Set(squad.picks.map((r) => r.player.division));
  const parts = [
    `${squad.formation.id} is the shape that scores highest on this round's ratings`,
    `${divisions.size} of the three divisions represented`
  ];
  if (shared.length) parts.push(`doubling up on ${shared.join(' and ')}`);
  parts.push(`${squad.captain.player.name} takes the armband as the highest-rated player in the seven`);
  return parts.join(', ') + '.';
}

/* ── formatting helpers shared by the views ─────────────── */

export function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
}

export function divisionName(id) {
  return { championship: 'the Championship', 'league-one': 'League One', 'league-two': 'League Two' }[id]
    || id;
}
