/*
 * Club preview threads — one club, six posts.
 *
 * The format the FPL accounts run every pre-season: baseline, key asset,
 * attacking target, rotation risk, hierarchy, takeaway. Twenty clubs is
 * twenty threads, which is why it is worth generating rather than writing.
 *
 * The part worth doing properly is the GRADE. Those threads award a status
 * per player — major target, watchlist, monitor, avoid — and the status is
 * the whole payload: it is what a reader screenshots and what they act on.
 * Awarding it on a hunch is how you end up telling people to buy a player
 * who starts every third week.
 *
 * So a grade here is three independent questions, and a player has to answer
 * more than one of them well:
 *
 *   RETURNS  will he score points? (projected points, or realised per-90
 *            output when the sample is too thin to project)
 *   MINUTES  will he be on the pitch? (start share, and — the bit the hand-
 *            written threads guess at — the congestion model's read on
 *            midweek European football)
 *   FIXTURES is the run ahead kind? (our own match model, not the seeding)
 *
 * Strong on all three is a major target. Strong on two is a watchlist name.
 * One is a monitor. Weak on minutes caps everything regardless of the rest,
 * because points-per-appearance is meaningless if he does not appear —
 * exactly the trap "high squad depth, rotation is real" is pointing at.
 *
 * Pure: data in, thread out. No network, no clock.
 */

export const STATUS = {
  major:     { key: 'major',     light: '🟢🟢🟢', label: 'Major target' },
  watchlist: { key: 'watchlist', light: '🟢',     label: 'Watchlist' },
  monitor:   { key: 'monitor',   light: '🟡',     label: 'Monitor' },
  avoid:     { key: 'avoid',     light: '🔴',     label: 'Avoid' }
};

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const money = (c) => '£' + (c / 10).toFixed(1) + 'm';
const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* A full season, used as the reference when the current one has not started. */
export const SEASON_GAMES = 38;

/* Minutes security. `congestion` is 0..1 from the congestion model — how
   loaded the club's midweek calendar is — and it is subtracted rather than
   averaged in, because a European tie three days before kick-off does not
   average out against a good start record; it eats into it.

   Before a ball is kicked `teamGames` is 0 while the minutes on file are last
   season's, so the reference has to be a full season. Dividing by "no matches
   yet" instead — which is what a floor of 1 amounts to — scores one substitute
   appearance as an ever-present, and pre-season is when these threads run. */
export function minutesScore(p) {
  const games = (p.teamGames || 0) > 0 ? p.teamGames : SEASON_GAMES;
  const starts = clamp01((p.starts || 0) / games);
  const played = clamp01((p.minutes || 0) / (games * 90));
  const base = 0.65 * starts + 0.35 * played;
  return clamp01(base - 0.35 * clamp01(p.congestion || 0));
}

/* How much realised output is worth trusting. A per-90 rate off a handful of
   substitute appearances is not evidence: one goal and one assist in 152
   minutes is a better rate than any established forward's and means nothing,
   yet it is enough to put a teenager above Saka in a hierarchy. So the rate is
   shrunk toward an ordinary one in proportion to the football behind it — at
   RETURNS_PRIOR_MINUTES a player's own rate carries half the weight, and a
   cameo carries almost none. */
export const RETURNS_PRIOR = 0.25;         /* the score of an unremarkable contributor */
export const RETURNS_PRIOR_MINUTES = 900;  /* ten full matches */

/* Returns. Prefers the projection; falls back to realised output per 90 when
   the model declines to project (early season, thin sample) so a club thread
   is still possible in July — which is precisely when these threads run. Only
   the fallback is shrunk: a projection has already done its own regressing. */
export function returnsScore(p) {
  if (p.xp != null && Number.isFinite(p.xp)) return clamp01(p.xp / 6);
  const mins = Math.max(0, p.minutes || 0);
  if (!mins) return 0;
  const own = clamp01(((p.goals || 0) + (p.assists || 0)) / (mins / 90) / 0.8);
  const w = mins / (mins + RETURNS_PRIOR_MINUTES);
  return clamp01(w * own + (1 - w) * RETURNS_PRIOR);
}

/* Fixtures, on our own 1 (easiest) to 5 (hardest) scale. */
export function fixtureScore(p) {
  const d = p.avgDifficulty;
  if (d == null || !Number.isFinite(d)) return 0.5;
  return clamp01((4.5 - d) / 2.5);
}

/* WHY a player is worth naming, beyond the score.

   The sharpest club previews do not just rank assets — they say what the
   angle is. "Target Palace for Muñoz's out-of-position attack and CB
   defensive-action volume, not pure clean sheets" is a better take than any
   ordering, because it tells you what you are buying and what would break it.

   Two angles carry most of that, and both are things the model knows and a
   hand-written thread has to eyeball:

   OUT OF POSITION  a defender scored on a defender's tariff while attacking
                    like a midfielder. The most exploitable classification in
                    the game, and the reason one full-back is worth naming
                    over another at the same price.
   DEFENSIVE ACTION the defensive-contribution floor. A centre-back who
                    clears and intercepts enough banks points in games his
                    team concedes in — which is precisely the case for buying
                    a defender whose clean-sheet odds are ordinary. */
export function angles(p) {
  const out = [];
  if (p.oop && p.oop.level > 0) {
    out.push({ tag: 'out of position', note: p.oop.label ||
      'attacking returns on a defender\'s tariff' });
  }
  if (p.defconRate != null && p.defconRate >= 0.45) {
    out.push({ tag: 'defensive floor', note: 'banks defensive-contribution points ' +
      'in roughly ' + Math.round(p.defconRate * 100) + '% of starts, clean sheet or not' });
  }
  if (p.setPieces) out.push({ tag: 'set pieces', note: p.setPieces });
  return out;
}

export function grade(p) {
  const minutes = minutesScore(p);
  const returns = returnsScore(p);
  const fixtures = fixtureScore(p);

  /* The minutes veto. Not a weighting — a ceiling. A player who will not
     start cannot be a target however good he is when he plays, and softening
     this into an average is what produces the confident recommendation of a
     rotation victim. */
  if (minutes < 0.35) {
    return { status: STATUS.avoid, minutes, returns, fixtures,
      why: 'minutes are not secure enough to recommend' };
  }

  const strong = [returns >= 0.55, minutes >= 0.7, fixtures >= 0.55].filter(Boolean).length;
  const status = strong === 3 ? STATUS.major
    : strong === 2 ? STATUS.watchlist
      : strong === 1 ? STATUS.monitor : STATUS.avoid;

  const why = [
    returns >= 0.55 ? 'projects well' : 'modest returns',
    minutes >= 0.7 ? 'nailed on' : 'minutes worth watching',
    fixtures >= 0.55 ? 'kind run' : 'awkward run'
  ].join(', ');
  return { status, minutes, returns, fixtures, why };
}

/* The club-level verdict the threads end on: is this a team to load up on,
   or somewhere to shop for one cheap enabler? Decided by how many genuinely
   gradeable assets it has, not by how good the best one is — a club with one
   great player and nothing else is an enabler source, however good he is. */
export function clubVerdict(graded) {
  const majors = graded.filter((g) => g.grade.status.key === 'major').length;
  const watch = graded.filter((g) => g.grade.status.key === 'watchlist').length;
  const cheap = graded.filter((g) => g.now_cost <= 45 &&
    ['major', 'watchlist'].includes(g.grade.status.key)).length;

  if (majors >= 2) {
    return { verdict: 'load-up', text: 'A club to take multiple assets from — ' +
      `${majors} names clear our bar on returns, minutes and fixtures together.` };
  }
  if (majors === 1 && watch >= 1) {
    return { verdict: 'one-and-cover', text: 'Take the standout and stop there. ' +
      'The supporting cast is watchlist material, not a second slot.' };
  }
  if (cheap >= 1) {
    return { verdict: 'enabler-source', text: 'Treat this as a budget enabler source ' +
      'rather than a team to load up on — the value is in the cheap end.' };
  }
  return { verdict: 'avoid', text: 'Nothing here clears the bar on all three counts. ' +
    'Worth monitoring rather than buying.' };
}

/* Build the thread. Returns posts as structured data — the runner turns them
   into text — so the same thread can later become a card without rewriting
   the reasoning. */
export function buildThread(club) {
  const { name, fullName, players = [], scored, conceded, avgDifficulty,
    fixtures = [], congestion = 0, europe = null, manager = null, played = null } = club;
  /* A baseline needs football behind it. Absent one, say so — a zeroed
     tally reads as a fact rather than as an absence. */
  const hasBaseline = scored != null && conceded != null && (played == null || played > 0);

  const graded = players
    .map((p) => ({ ...p, angles: angles(p),
      grade: grade({ ...p, congestion: p.congestion ?? congestion }) }))
    .sort((a, b) => (b.grade.returns + b.grade.minutes) - (a.grade.returns + a.grade.minutes));

  const rank = { major: 0, watchlist: 1, monitor: 2, avoid: 3 };
  const hierarchy = [...graded].sort((a, b) =>
    rank[a.grade.status.key] - rank[b.grade.status.key] ||
    (b.grade.returns - a.grade.returns));

  const attackers = graded.filter((p) => p.element_type >= 3);
  const verdict = clubVerdict(graded);

  const posts = [];

  posts.push({ kind: 'hook', title: `${fullName || name} — the FPL read`,
    lines: [
      manager ? `${manager} in charge.` : null,
      hasBaseline ? `${scored} scored, ${conceded} conceded.` : 'No competitive football yet this season.',
      europe ? `${europe} football means midweek games and rotation to price in.` : null,
      'Every asset graded on returns, minutes and fixtures.'
    ].filter(Boolean) });

  posts.push({ kind: 'baseline', title: 'Baseline',
    lines: [
      hasBaseline ? `Scored ${scored}, conceded ${conceded}.`
        : 'No results yet — the read below is fixtures, minutes and last season\'s rates.',
      avgDifficulty != null
        ? `Opening run averages ${avgDifficulty.toFixed(1)} of 5 on our difficulty scale.` : null,
      fixtures.length
        ? fixtures.slice(0, 5).map((f) => `GW${f.gw} ${f.home ? 'vs' : 'at'} ${f.opp}`).join('  ·  ')
        : null
    ].filter(Boolean) });

  const key = hierarchy[0];
  if (key) {
    posts.push({ kind: 'key-asset', title: `Key asset — ${key.web_name} (${money(key.now_cost)} ${POS[key.element_type]})`,
      lines: [
        key.minutes != null
          ? `${plural(key.minutes, 'minute')}, ${plural(key.goals || 0, 'goal')}, ` +
            `${plural(key.assists || 0, 'assist')}.` : null,
        key.xp != null ? `Projects ${key.xp.toFixed(2)} points next gameweek.` : null,
        ...key.angles.map((a) => `${a.tag}: ${a.note}.`),
        `${key.grade.status.light} ${key.grade.status.label} — ${key.grade.why}.`
      ].filter(Boolean), player: key.web_name, status: key.grade.status.key });
  }

  const att = attackers[0];
  if (att && att.web_name !== (key && key.web_name)) {
    posts.push({ kind: 'attacking-target', title: `Attacking target — ${att.web_name} (${money(att.now_cost)} ${POS[att.element_type]})`,
      lines: [
        `${plural(att.goals || 0, 'goal')}, ${plural(att.assists || 0, 'assist')} ` +
          `in ${plural(att.minutes || 0, 'minute')}.`,
        `${att.grade.status.light} ${att.grade.status.label} — ${att.grade.why}.`
      ], player: att.web_name, status: att.grade.status.key });
  }

  /* Rotation risk is the post where the model earns its place: the hand-
     written versions say "monitor preseason lineups", which is advice to go
     and do the work yourself. */
  const atRisk = graded.filter((p) => p.grade.minutes < 0.6).slice(0, 4);
  posts.push({ kind: 'rotation-risk', title: 'Rotation risk',
    lines: [
      congestion > 0.15
        ? `Midweek load is real here — the minutes model marks it ${(congestion * 100).toFixed(0)}% ` +
          'and discounts start probability accordingly.'
        : 'No unusual midweek load in the window we can see.',
      ...(atRisk.length
        ? atRisk.map((p) => `${p.web_name} — ${(p.grade.minutes * 100).toFixed(0)}% minutes security`)
        : ['Nobody in the squad reads as a rotation trap on current evidence.'])
    ] });

  posts.push({ kind: 'hierarchy', title: 'Hierarchy',
    lines: hierarchy.slice(0, 6).map((p) =>
      `${p.grade.status.light} ${p.web_name} (${money(p.now_cost)} ${POS[p.element_type]})` +
      (p.angles.length ? ` — ${p.angles.map((a) => a.tag).join(', ')}` : '')),
    rows: hierarchy.slice(0, 6).map((p) => ({
      name: p.web_name, cost: money(p.now_cost), position: POS[p.element_type],
      status: p.grade.status.key, light: p.grade.status.light,
      angles: p.angles.map((a) => a.tag),
      returns: +p.grade.returns.toFixed(2), minutes: +p.grade.minutes.toFixed(2),
      fixtures: +p.grade.fixtures.toFixed(2)
    })) });

  /* Name the angle in the takeaway. "Buy this club" is a ranking; "buy this
     club for X, not Y" is the thing worth reading. */
  const named = hierarchy.filter((p) => p.angles.length &&
    ['major', 'watchlist'].includes(p.grade.status.key)).slice(0, 2);
  const who = named.map((p) => `${p.web_name}'s ${p.angles[0].tag}`).join(' and ');
  const tail = named.some((p) => p.angles.some((a) => a.tag === 'defensive floor'))
    ? ' — points that do not need a clean sheet.' : '.';
  /* On a club we have just said not to buy, "the angle is X" reads as a
     contradiction one line after the verdict. The angle is still worth naming
     there — it is simply the thing that would change the verdict, not a
     reason to override it. */
  const angleLine = !named.length ? null
    : verdict.verdict === 'avoid'
      ? `If that changes, it changes through ${who}${tail}`
      : `The angle is ${who}${tail}`;
  posts.push({ kind: 'takeaway', title: 'Takeaway',
    lines: [verdict.text, angleLine].filter(Boolean) });

  return { club: name, fullName, verdict, posts, graded: hierarchy.length };
}
