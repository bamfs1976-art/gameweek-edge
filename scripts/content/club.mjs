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

/* What a nailed-on player actually racks up over a season — NOT 38 and 3420.
   Nobody plays every minute; a first-choice outfielder lands near thirty
   starts once rest, knocks and the odd suspension are taken out. Measuring
   against the theoretical maximum instead marks every real starter as
   rotation-prone, which on the first run had Saka "worth watching". */
export const FULL_STARTS = 30;
export const FULL_MINUTES = 2700;

/* How hard a fully congested calendar bites into minutes security. Named
   because the rotation post has to be able to undo it to attribute a doubt. */
export const CONGESTION_WEIGHT = 0.35;

/* Minutes security. `congestion` is 0..1 from the congestion model — how
   loaded the club's midweek calendar is — and it is subtracted rather than
   averaged in, because a European tie three days before kick-off does not
   average out against a good start record; it eats into it.

   Before a ball is kicked `teamGames` is 0 while the minutes on file are last
   season's, so the reference has to be a full season. Dividing by "no matches
   yet" instead — which is what a floor of 1 amounts to — scores one substitute
   appearance as an ever-present, and pre-season is when these threads run. */
/* WHO ELSE IS AT THE CLUB FOR THAT SHIRT.

   Minutes read off last season describe a squad that no longer exists. When a
   club sells two centre-backs in a window, the ones who stay are nailed on,
   and their own history cannot say so — it was compiled while the rivals were
   still there. That is the entire premise of a good club preview: "with
   Struijk and Wöber gone, the depth chart is crystal clear".

   The signal is available even though the minutes are historic, because a
   departed player is simply absent from the squad list. So the correction is
   a modest adjustment, not a rewrite: the clear leader of a settled position
   gains, a player in a live contest loses, and everyone else is untouched. */
export const DEPTH_CLEAR_BONUS = 0.12;
export const DEPTH_CONTEST_PENALTY = 0.12;

export function shirtAdjust(p) {
  const s = p.shirt;
  if (!s) return 0;
  if (s.settled && s.leader) return DEPTH_CLEAR_BONUS;
  if (s.contested) return -DEPTH_CONTEST_PENALTY;
  return 0;
}

export function minutesScore(p) {
  const games = p.teamGames || 0;
  const starts = clamp01((p.starts || 0) / (games > 0 ? games : FULL_STARTS));
  const played = clamp01((p.minutes || 0) / (games > 0 ? games * 90 : FULL_MINUTES));
  const base = 0.65 * starts + 0.35 * played;
  return clamp01(base - CONGESTION_WEIGHT * clamp01(p.congestion || 0) + shirtAdjust(p));
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

/* WHAT COUNTS AS A RETURN.

   Goals and assists alone are not the answer, and a comparison made the cost
   obvious: run against Everton, this graded Tarkowski last of six, while the
   hand-written previews lead on him. He is a centre-back who banks defensive
   contributions and clean sheets — on a goal-involvement axis he scores
   roughly nothing by construction, so the ranking could never see him and the
   defensive-floor tag decorated a position it had no power to change.

   So the fallback is measured in POINTS per 90, on the real tariff, and every
   way a player earns them counts:

     GOALS       6 for a keeper or defender, 5 a midfielder, 4 a forward
     ASSISTS     3, flat
     CLEAN SHEET 4 for a keeper or defender, 1 a midfielder, nothing up front
     DEFCON      2 whenever the defensive-contribution threshold is cleared,
                 so a ball-winner has a floor a striker does not

   Appearance points are deliberately excluded: every starter gets them, so
   they separate nobody and would only compress the scale. */
export const GOAL_PTS = { 1: 6, 2: 6, 3: 5, 4: 4 };
export const ASSIST_PTS = 3;
export const CS_PTS = { 1: 4, 2: 4, 3: 1, 4: 0 };
export const DEFCON_PTS = 2;
/* Points per 90, above appearance, that reads as a top-end return — roughly
   an elite midfielder's goal and assist rate. */
export const RETURNS_PTS_SCALE = 3.5;

/* Returns. Prefers the projection; falls back to realised output per 90 when
   the model declines to project (early season, thin sample) so a club thread
   is still possible in July — which is precisely when these threads run. Only
   the fallback is shrunk: a projection has already done its own regressing. */
export function returnsScore(p) {
  if (p.xp != null && Number.isFinite(p.xp)) return clamp01(p.xp / 6);
  const mins = Math.max(0, p.minutes || 0);
  if (!mins) return 0;
  const t = p.element_type || 3;
  const per90 = (n) => (n || 0) / (mins / 90);
  const pts = per90(p.goals) * (GOAL_PTS[t] != null ? GOAL_PTS[t] : 5)
    + per90(p.assists) * ASSIST_PTS
    + per90(p.cleanSheets) * (CS_PTS[t] != null ? CS_PTS[t] : 0)
    + DEFCON_PTS * clamp01(p.defconRate || 0);
  const own = clamp01(pts / RETURNS_PTS_SCALE);
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

/* WHO IS ACTUALLY A ROTATION RISK.

   The first version of this post listed whoever had the lowest minutes score,
   which on a real squad meant fourth-choice keepers and players about to be
   sold. Nobody was ever going to buy them, so warning about them is noise
   dressed as analysis.

   A rotation risk is a tension, not a low number: a player good enough that
   you are tempted, whose minutes are the thing that could ruin it. Weak on
   both counts is not a risk — it is a squad player. Strong on both is not a
   risk either. The post is only worth reading where the two disagree.

   Note this deliberately ignores the grade's minutes veto. A player with real
   returns and no starts is graded `avoid`, and he is also the single most
   important name in this post — he is the trap the whole format exists to
   name. */
export const ROTATION_TEMPT = 0.5;   /* enough returns that someone is tempted */
export const ROTATION_SECURE = 0.7;  /* below this, the minutes are a live question */

export function rotationTension(p) {
  const g = p.grade || {};
  return clamp01(g.returns) * (1 - clamp01(g.minutes));
}

export function rotationRisks(graded, limit = 4) {
  return (graded || [])
    .filter((p) => p.grade && p.grade.returns >= ROTATION_TEMPT &&
      p.grade.minutes < ROTATION_SECURE)
    .sort((a, b) => rotationTension(b) - rotationTension(a))
    .slice(0, limit);
}

/* Why this particular name is on the list — the reader needs the shape of the
   doubt, not just a percentage. Congestion is called out by name where it is
   the cause, because that is the part a hand-written thread cannot see. */
function riskNote(p, congestion = 0) {
  const own = clamp01(p.congestion ?? congestion);
  /* Blame the calendar only where the calendar is the reason: without its
     discount this player would clear the bar. Any weaker test credits
     congestion for doubts it did not cause. */
  if (own > 0 && p.grade.minutes + CONGESTION_WEIGHT * own >= ROTATION_SECURE) {
    return 'and the midweek calendar is what is eating it';
  }
  if (p.grade.minutes < 0.35) return 'so the returns are on a player who does not start';
  return 'on a player whose returns would otherwise buy him';
}

/* AVAILABILITY IS NOT A FILTER.

   The runner used to drop anyone whose status was not 'a', which silently
   removed a club's biggest talking point: a striker who picked up a knock in
   pre-season is exactly what a preview leads on, and the honest line is "wait
   for the press conference", not silence. A doubt is information.

   It is a ceiling rather than a weight, for the same reason the minutes veto
   is: a player who may not be fit cannot be a major target however well he
   projects, and averaging that away is how a confident recommendation gets
   made about someone in a walking boot. */
export const AVAIL = {
  d: { cap: 'watchlist', label: 'fitness doubt' },
  i: { cap: 'avoid', label: 'injured' },
  s: { cap: 'avoid', label: 'suspended' },
  n: { cap: 'avoid', label: 'not in the squad' }
};
export function availability(p) {
  const st = p.status && p.status !== 'a' ? AVAIL[p.status] : null;
  if (!st) return null;
  /* FPL publishes a percentage alongside the flag; a stated 0% is not a
     doubt, it is an absence, and it outranks the softer 'd'. */
  const pct = p.chanceOfPlaying;
  if (st.cap === 'watchlist' && pct != null && pct <= 25) {
    return { cap: 'avoid', label: st.label + ' (' + pct + '%)' };
  }
  return { cap: st.cap, label: st.label + (pct != null ? ' (' + pct + '%)' : '') };
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
  let status = strong === 3 ? STATUS.major
    : strong === 2 ? STATUS.watchlist
      : strong === 1 ? STATUS.monitor : STATUS.avoid;

  /* A flag caps the grade rather than adjusting it — see AVAIL. */
  const avail = availability(p);
  if (avail) {
    const order = ['major', 'watchlist', 'monitor', 'avoid'];
    const capIdx = order.indexOf(avail.cap);
    if (order.indexOf(status.key) < capIdx) status = STATUS[avail.cap];
  }

  const why = [
    returns >= 0.55 ? 'projects well' : 'modest returns',
    minutes >= 0.7 ? 'nailed on' : 'minutes worth watching',
    fixtures >= 0.55 ? 'kind run' : 'awkward run'
  ];
  if (avail) why.unshift(avail.label);
  return { status, minutes, returns, fixtures, why: why.join(', '), avail };
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
  const atRisk = rotationRisks(graded);
  /* Fitness and availability, which the old runner removed from the data
     entirely. A club whose main striker is a doubt has one story, and it is
     not the hierarchy. */
  const flagged = graded.filter((p) => p.grade.avail).slice(0, 4);
  if (flagged.length) {
    posts.push({ kind: 'availability', title: 'Fitness and availability',
      lines: flagged.map((p) =>
        `${p.web_name} (${money(p.now_cost)} ${POS[p.element_type]}) — ${p.grade.avail.label}` +
        (p.grade.avail.cap === 'avoid' ? ', so not a starting-squad pick right now'
          : ', worth the wait if the news is good')),
      rows: flagged.map((p) => ({ name: p.web_name, flag: p.grade.avail.label,
        cap: p.grade.avail.cap })) });
  }

  posts.push({ kind: 'rotation-risk', title: 'Rotation risk',
    lines: [
      congestion > 0.15
        ? `Midweek load is real here — the minutes model marks it ${(congestion * 100).toFixed(0)}% ` +
          'and discounts start probability accordingly.'
        : 'No unusual midweek load in the window we can see.',
      ...(atRisk.length
        ? atRisk.map((p) => `${p.web_name} (${money(p.now_cost)} ${POS[p.element_type]}) — ` +
          `${(p.grade.minutes * 100).toFixed(0)}% minutes security, ${riskNote(p, congestion)}`)
        : ['Nobody here is both worth owning and short of minutes — whatever the ' +
           'risk is at this club, it is not rotation.'])
    ],
    rows: atRisk.map((p) => ({ name: p.web_name, cost: money(p.now_cost),
      position: POS[p.element_type], minutes: +p.grade.minutes.toFixed(2),
      returns: +p.grade.returns.toFixed(2), tension: +rotationTension(p).toFixed(3) })) });

  posts.push({ kind: 'hierarchy', title: 'Hierarchy',
    lines: hierarchy.slice(0, 6).map((p) =>
      `${p.grade.status.light} ${p.web_name} (${money(p.now_cost)} ${POS[p.element_type]})` +
      (p.grade.avail ? ` — ${p.grade.avail.label}` : '') +
      (p.angles.length ? ` — ${p.angles.map((a) => a.tag).join(', ')}` : '')),
    rows: hierarchy.slice(0, 6).map((p) => ({
      name: p.web_name, cost: money(p.now_cost), position: POS[p.element_type],
      status: p.grade.status.key, light: p.grade.status.light,
      angles: p.angles.map((a) => a.tag),
      flag: p.grade.avail ? p.grade.avail.label : null,
      shirt: p.shirt || null,
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
