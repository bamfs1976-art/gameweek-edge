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
/* Involved in this share of his club's goals and he is carrying the attack.
   Thirty per cent is where the community draws it and it is a sane line: a
   fifth of a squad's goals from one of eleven starters is ordinary, a third
   is dependency. */
/* FPL lets you own at most three players from any one club. It is the one
   constraint that turns a club preview from a ranking into a decision, and
   the threads ignored it entirely — a hierarchy of six with no hint that
   half of them cannot travel together. */
export const CLUB_CAP = 3;

export const TALISMAN_SHARE = 0.30;
/* Below this the denominator is too small to divide by — two goals from a
   squad makes everyone who scored a talisman. */
export const TALISMAN_MIN_GOALS = 20;

/* Pre-season, last season's totals arrive attached to whichever club a
   player is at NOW, so a summer signing brings another club's numbers with
   him. Every angle that rests on a RATE — how often he banked defensive
   points, whether he attacked from a defender's shirt — then describes a
   role at a club he has left, and printing it unqualified states it as a
   present-tense property.

   This is live and contested rather than theoretical: on Elliot Anderson's
   move to City one analyst reads his defensive contribution as "hard to
   replicate", another as "a completely different asset at City". We cannot
   settle that, and we should not sound as though we have. */
export const MOVED_NOTE = ' — but that was at his previous club, so it is a ' +
  'role that has to survive the move';

/* The angles that describe a ROLE from a rate, and so travel badly. Set-piece
   duty is deliberately not here: its order fields are set by the club he is
   at now, making it the one angle that is current for a new signing. */
export const CARRIED_TAGS = new Set(['defensive floor', 'out of position']);

export function angles(p) {
  const out = [];
  const moved = !!p.newClub;
  if (p.oop && p.oop.level > 0) {
    out.push({ tag: 'out of position', note: (p.oop.label ||
      'attacking returns on a defender\'s tariff') + (moved ? MOVED_NOTE : '') });
  }
  if (p.defconRate != null && p.defconRate >= 0.45) {
    out.push({ tag: 'defensive floor', note: 'banks defensive-contribution points ' +
      'in roughly ' + Math.round(p.defconRate * 100) + '% of starts, clean sheet or not' +
      (moved ? MOVED_NOTE : '') });
  }
  /* Set-piece duty is the exception and deliberately carries no caveat: the
     order fields are set by the club a player is at now, so for a new
     signing it is the one angle here that is actually current. */
  if (p.setPieces) out.push({ tag: 'set pieces', note: p.setPieces });
  /* THE TALISMAN. Share of the club's goals a player was directly involved
     in — the thing the rate-based axes cannot see, because a good rate at a
     club that scores freely is a different asset from a good rate at a club
     that only scores through one man. It cuts both ways and the note says
     so: he is the route into the attack, and he is also the single point of
     failure when he blanks or sits out. */
  /* For a signing this one is not merely uncertain, it is arithmetic on two
     different clubs: his goals sit in both the numerator and the squad total
     he is measured against, having been scored for somebody else. A caveat
     cannot rescue a number that was never about this squad, so it is dropped
     rather than hedged. */
  if (!moved && p.teamShare != null && p.teamShare >= TALISMAN_SHARE) {
    out.push({ tag: 'talisman', note: 'involved in ' + Math.round(p.teamShare * 100) +
      '% of the goals this squad scored — the way into the attack, and the ' +
      'thing that breaks when he does not play' });
  }
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
    /* The squad rules cap you at three players from one club, so "5 names
       clear our bar" is not a shopping list — it is a shortlist you have to
       cut. Saying the number without saying the cap invites a selection the
       game will not let you make, and the whole point of ranking a club's
       assets is deciding which of them you can actually afford a slot for. */
    const over = majors > CLUB_CAP
      ? ` You can only own ${CLUB_CAP} from one club, so this is a shortlist to cut, not a list to buy.`
      : '';
    return { verdict: 'load-up', text: 'A club to take multiple assets from — ' +
      `${majors} names clear our bar on returns, minutes and fixtures together.${over}` };
  }
  if (majors === 1 && watch >= 1) {
    return { verdict: 'one-and-cover', text: 'Take the standout and stop there. ' +
      'The supporting cast is watchlist material, not a second slot.' };
  }
  /* Depth without a standout. Every rule above keys off MAJORS, so a club
     with six watchlist names and nobody clearing all three counts fell
     through to "nothing clears the bar" — printed directly under six green
     lights, which is a thread contradicting itself in the space of two posts.
     Several credible options and no obvious buy is a real and different
     verdict: you are choosing on fixtures, not on a name. */
  if (watch >= 3) {
    return { verdict: 'deep-no-standout', text: `${watch} names clear two of the three ` +
      'counts and none clears all three — a squad to take one from on the fixtures, ' +
      'rather than a club with an obvious buy.' };
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
/* ── Two records the fixture ticker cannot give ──────────────
   Both go silent rather than guess: below their sample floor the engine
   returns null, and a thread saying nothing about a club's home form is
   better than one saying it off four games. */
const VENUE_WORD = { home: 'at home', away: 'on the road' };
function venueLine(venue, split) {
  if (!venue || !split) return null;
  /* Only worth a line when the two halves disagree. "Scores more at home and
     concedes more at home" is the interesting shape — a club that is simply
     better at home is every club. */
  const att = venue.attack, def = venue.defence;
  if (att === 'level' && def === 'level') return null;
  const h = split.home, a = split.away;
  const num = (v) => (v == null ? '—' : v.toFixed(2));
  const shape = (att !== 'level' && def !== 'level' && att === def)
    ? `Scores more AND concedes more ${VENUE_WORD[att]}.`
    : att !== 'level'
      ? `Scores more ${VENUE_WORD[att]}.`
      : `Tighter ${VENUE_WORD[def === 'home' ? 'home' : 'away']}.`;
  return `${shape} Home ${num(h.gfpg)} for / ${num(h.gapg)} against, away ${num(a.gfpg)} / ${num(a.gapg)}.`;
}
/* Does a kind fixture become a clean sheet? Said only when the answer is no —
   a side that converts its easy games is what the ticker already implies, so
   confirming it adds a line and no information. */
/* How far behind the cheaper player may sit and still be worth the saving.
   Deliberately tight: the grade's scores are 0-1, so 0.12 is about a tenth of
   the whole scale. Loosen it and the thread starts recommending the cheap
   player at every club, which is the failure mode of every "value pick" post. */
const CLOSE_ENOUGH = 0.12;
const MIN_SAVING = 3;               /* tenths of a million */
function cheaperAlternative(graded) {
  const own = graded.filter((g) => g.grade.status.key !== 'avoid' && g.now_cost != null);
  let best = null;
  for (const dear of own) {
    for (const cheap of own) {
      if (cheap.element_type !== dear.element_type) continue;
      const saving = dear.now_cost - cheap.now_cost;
      if (saving < MIN_SAVING) continue;
      const d = dear.grade.returns + dear.grade.minutes;
      const c = cheap.grade.returns + cheap.grade.minutes;
      if (c < d - CLOSE_ENOUGH) continue;
      if (!best || saving > best.saving) best = { dear, cheap, saving, gap: d - c };
    }
  }
  if (!best) return null;
  const { dear, cheap, saving, gap } = best;
  const pos = POS[dear.element_type];
  const shortfall = gap <= 0
    ? 'and grades no worse on returns or minutes'
    : `and gives up ${(gap * 50).toFixed(0)}% of a band on returns and minutes`;
  return `${cheap.web_name} (${money(cheap.now_cost)} ${pos}) does ${dear.web_name}'s `
    + `(${money(dear.now_cost)}) job for ${money(saving)} less, ${shortfall}. `
    + `The saving is only worth taking if you have somewhere better to spend it.`;
}

const KIND_CS_POOR = 0.3;
function kindLine(kind, ahead) {
  if (!kind || kind.csr >= KIND_CS_POOR) return null;
  const pct = Math.round(kind.csr * 100);
  const tail = ahead
    ? ` ${ahead} of the next six ${ahead === 1 ? 'is' : 'are'} against the same kind of attack, so a blank there is the pattern, not bad luck.`
    : '';
  return `Only ${plural(kind.cs, 'clean sheet')} in ${kind.games} against bottom-half attacks (${pct}%).${tail}`;
}

export function buildThread(club) {
  const { name, fullName, players = [], scored, conceded, avgDifficulty,
    fixtures = [], congestion = 0, europe = null, manager = null, played = null,
    venue = null, split = null, kind = null, kindAhead = null,
    defconData = true, joinData = true } = club;
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
      'Every asset graded on returns, minutes and fixtures.',
      /* Say what the read cannot see. Defensive contribution is the frame
         most of the community is using this season — a centre-back's case is
         routinely made entirely on it — and FPL has published no values yet.
         A thread that ranks on clean sheets alone while staying silent about
         that looks confident about the exact thing it is blind to. */
      defconData ? null
        : 'Defensive contribution is not in the data yet, so a defender\u2019s ' +
          'floor is read from clean sheets alone here — the DEFCON case for a ' +
          'centre-back cannot be checked until FPL publishes it.',
      /* The same discipline for signings. Where join dates are published, a
         new arrival's rate-based angles are marked individually and this line
         never appears; where they are not, any rate in the thread might be a
         different club's, and the reader is owed that once, up front. */
      joinData ? null
        : 'Last season’s rates arrive attached to a player’s current club, and this ' +
          'feed does not say when anyone signed — so where a summer move has happened, ' +
          'a rate below describes a role at the club he left.'
    ].filter(Boolean) });

  posts.push({ kind: 'baseline', title: 'Baseline',
    lines: [
      hasBaseline ? `Scored ${scored}, conceded ${conceded}.`
        : 'No results yet — the read below is fixtures, minutes and last season\'s rates.',
      avgDifficulty != null
        ? `Opening run averages ${avgDifficulty.toFixed(1)} of 5 on our difficulty scale.` : null,
      venueLine(venue, split),
      /* The line a fixture ticker cannot write. A run of green cells is a
         claim about the opponents; whether this defence converts one is a
         claim about this club, and the two come apart. Printed only when it
         disagrees with the ticker — a side that cashes its kind fixtures is
         what everyone already assumes, and saying it adds nothing. */
      kindLine(kind, kindAhead),
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

  /* The hierarchy prints TAGS, never notes — which is where the "at his
     previous club" caveat lives, so on the first run it marked a summer
     signing's defensive floor everywhere except the one post a reader
     actually screenshots. A footnote marker carries it without turning six
     one-line rows into six paragraphs. */
  const top = hierarchy.slice(0, 6);
  const carried = (p) => p.newClub && p.angles.some((a) => CARRIED_TAGS.has(a.tag));
  posts.push({ kind: 'hierarchy', title: 'Hierarchy',
    lines: top.map((p) =>
      `${p.grade.status.light} ${p.web_name} (${money(p.now_cost)} ${POS[p.element_type]})` +
      (p.grade.avail ? ` — ${p.grade.avail.label}` : '') +
      (p.angles.length ? ` — ${p.angles.map((a) =>
        a.tag + (carried(p) && CARRIED_TAGS.has(a.tag) ? '*' : '')).join(', ')}` : ''))
      .concat(top.some(carried)
        ? ['* measured at his previous club — he signed since last season started, ' +
           'so that is a role which still has to survive the move.']
        : []),
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
  /* If more clear the bar than you are allowed to own, say which three. A
     ranking that stops short of the cap leaves the reader to do the one
     piece of arithmetic the thread exists to do for them. */
  const ownable = hierarchy.filter((p) =>
    ['major', 'watchlist'].includes(p.grade.status.key) && !p.grade.avail);
  const capLine = ownable.length > CLUB_CAP
    ? `If you want ${CLUB_CAP}: ${ownable.slice(0, CLUB_CAP)
      .map((p) => `${p.web_name} (${money(p.now_cost)})`).join(', ')}.`
    : null;
  /* The one post the hand-written threads do best: two players doing the same
     job at the same club, and whether the dearer one is worth the money. The
     versions doing the rounds assert it — "same clean sheet potential for
     £0.5m less" — where the grade already holds the comparison, so ours can
     show the gap rather than claim there isn't one.

     Silent unless the case is real, which is the house rule everywhere else
     in this file. Three conditions, and all of them must hold:
       · same position, because a defender does not free money for a forward;
       · at least £0.3m apart, below which the saving buys nothing anyway;
       · the cheaper one within CLOSE_ENOUGH of the dearer on returns and
         minutes combined — a genuinely worse player is not a bargain.
     The line reports the shortfall rather than hiding it. "As good for less"
     is the claim that gets a manager burned; "nearly as good, and here is
     how much nearly" is the one they can act on. */
  const alt = cheaperAlternative(graded);
  if (alt) posts.push({ kind: 'value', title: 'Same job, less money', lines: [alt] });

  posts.push({ kind: 'takeaway', title: 'Takeaway',
    lines: [verdict.text, angleLine, capLine].filter(Boolean) });

  return { club: name, fullName, verdict, posts, graded: hierarchy.length };
}
