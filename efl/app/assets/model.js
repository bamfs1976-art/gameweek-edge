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

export const PLAYER_WEIGHTS = {
  form: 0.30,        // Fantasy points in the last five rounds
  minutes: 0.22,     // starts and minutes — the floor under everything else
  output: 0.20,      // goals, assists, clean sheets, weighted by position
  fixture: 0.20,     // next fixture's modelled difficulty
  home: 0.08         // playing at home
};
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

/* The "form differential" model. There is no Fantasy EFL ownership feed, so
   this is explicitly NOT a differential in the ownership sense — it is an
   editorial one: strong recent output at a club that gets less attention.
   The interface labels it as modelled every time it appears. */
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

/** Per-90 attacking and defensive return, weighted the way the position is
 *  actually scored: a defender's clean sheets matter, a forward's do not. */
function rawOutput(p) {
  const per90 = (v) => safeDiv(v, Math.max(90, p.minutes)) * 90;
  const g = per90(p.goals);
  const a = per90(p.assists);
  const cs = safeDiv(p.cleanSheets, Math.max(1, p.starts));
  if (p.position === 'GK') return cs * 1.0 + a * 0.3;
  if (p.position === 'DEF') return cs * 0.7 + g * 0.9 + a * 0.6;
  if (p.position === 'MID') return g * 1.0 + a * 0.8 + cs * 0.15;
  return g * 1.0 + a * 0.55;
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
 *  current round, or the next one after it if this round is blank. */
export function nextFixture(ctx, clubId) {
  const all = ctx.upcomingByClub[clubId] || [];
  const f = all.find((x) => x.round >= ctx.currentRound);
  return f ? fixtureRating(ctx, clubId, f) : null;
}

/* ── Player score ────────────────────────────────────────── */

/**
 * Score a player as a pick for the current round.
 * @returns {import('./types.js').Recommendation & {player:Object, next:Object|null}}
 */
export function playerScore(ctx, player) {
  const club = ctx.clubById[player.clubId];
  const next = nextFixture(ctx, player.clubId);
  const norms = ctx.playerNorms;

  const played = club ? Math.max(1, club.played) : 1;
  const startShare = clamp01(safeDiv(player.starts, played));
  const minuteShare = clamp01(safeDiv(player.minutes, played * 90));
  const values = {
    form: norms.form[player.id] == null ? 0.5 : norms.form[player.id],
    minutes: clamp01(startShare * 0.65 + minuteShare * 0.35),
    output: norms.output[player.id] == null ? 0.5 : norms.output[player.id],
    /* A blank round is not a neutral fixture. Nothing to play in scores 0. */
    fixture: next ? clamp01(1 - next.difficulty) : 0,
    home: next && next.home ? 1 : 0
  };

  const factors = Object.entries(PLAYER_WEIGHTS).map(([key, weight]) => ({
    key,
    label: PLAYER_FACTOR_LABELS[key],
    value: values[key],
    weight,
    note: playerFactorNote(key, values[key], player, club, next)
  }));

  const weighted = factors.reduce((s, f) => s + f.value * f.weight, 0);
  const availability = player.availability || { status: 'available' };
  const multiplier = AVAILABILITY_MULTIPLIER[availability.status] == null
    ? 1 : AVAILABILITY_MULTIPLIER[availability.status];
  const score = Math.round(clamp01(weighted) * multiplier * 1000) / 10;

  return {
    kind: 'player',
    id: player.id,
    player,
    next,
    score,
    factors,
    availabilityMultiplier: multiplier,
    summary: buildSummary(factors, availability, next)
  };
}

const PLAYER_FACTOR_LABELS = {
  form: 'Recent form',
  minutes: 'Starts and minutes',
  output: 'Goals, assists and clean sheets',
  fixture: 'Next fixture',
  home: 'Home advantage'
};

function playerFactorNote(key, value, player, club, next) {
  const played = club ? Math.max(1, club.played) : 1;
  if (key === 'form') {
    const apps = player.last5.filter((m) => m.minutes > 0).length;
    const pts = player.last5.reduce((s, m) => s + m.points, 0);
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
function buildSummary(factors, availability, next) {
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
  return sentence;
}

/* ── Differential ────────────────────────────────────────── */

/**
 * A MODELLED, EDITORIAL differential — not an ownership one.
 *
 * No public feed publishes Fantasy EFL ownership, and inventing a
 * percentage would be worse than having none, so this ranks players on
 * strong recent output at clubs that get less of the attention: lower
 * division, lower down the table. It is labelled as modelled everywhere it
 * is shown, and `ownership` stays null in the data.
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
      + `${divisionName(div)}. Not an ownership figure; no Fantasy EFL ownership feed exists.`
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

/* ── Round picks ─────────────────────────────────────────── */

/**
 * The seven cards on the dashboard: one per position, a differential, a club
 * and a captain. Everything is computed from the same scores the finder and
 * the club picker show, so the dashboard can never disagree with them.
 */
export function roundPicks(ctx, opts = {}) {
  const minMinutesShare = opts.minMinutesShare == null ? 0.35 : opts.minMinutesShare;
  const scored = ctx.players
    .map((p) => playerScore(ctx, p))
    .filter((r) => r.next)              // a player with no fixture is not a pick
    .sort((a, b) => b.score - a.score);

  const eligible = scored.filter((r) => {
    const club = ctx.clubById[r.player.clubId];
    const played = club ? Math.max(1, club.played) : 1;
    return r.player.availability.status === 'available'
      && r.player.minutes / (played * 90) >= minMinutesShare;
  });

  const byPosition = (pos) => eligible.find((r) => r.player.position === pos) || null;

  /* Captain: the strongest available pick with a fixture that is not
     stacked against them. The band cut is explicit rather than a tie-break
     hidden inside the sort — a captain in a rated-5 fixture is a different
     decision, and the model should not make it quietly. */
  const captain = eligible.find((r) => r.next.rating <= 3
    && (r.player.position === 'MID' || r.player.position === 'FWD'))
    || eligible.find((r) => r.next.rating <= 3)
    || eligible[0] || null;

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
