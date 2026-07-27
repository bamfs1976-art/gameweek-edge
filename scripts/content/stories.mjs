/*
 * Daily content — the story selector.
 *
 * The app already computes more than enough to post every day. What it has
 * never had is an answer to "which of today's numbers is worth posting?",
 * and that is the whole job of this file. Everything else in the pipeline is
 * plumbing; this is the part that decides whether the output is useful or
 * noise.
 *
 * A pipeline that posts the strongest-xP-player every day would be worthless
 * by the third day. So a candidate is scored on three things, and the third
 * matters as much as the first:
 *
 *   MAGNITUDE  — how big is the effect? A 0.1 xP gap between two £5.5m mids
 *                is not a story; a 1.4 gap is. Each kind normalises its own
 *                effect onto 0..1 so kinds can be compared at all.
 *   TIMELINESS — is it worth saying TODAY? A chip roadmap matters in the days
 *                before a deadline and not on a Tuesday in an international
 *                break. A fixture swing matters when the swing is imminent.
 *   NOVELTY    — have we said this recently? Posting the same take about the
 *                same player three days running is how a feed loses people.
 *                Recency is penalised per (kind, subject) from a history file.
 *
 * Pure by design — no network, no filesystem, no clock of its own — so the
 * ranking can be tested exhaustively offline. `now` and `history` come in as
 * arguments precisely so the tests can pin behaviour that would otherwise
 * depend on the day it ran.
 */

/* Weights. Magnitude leads, but not by so much that a big number can be
   repeated forever: a top-magnitude story told yesterday loses to a decent
   one that is fresh, which is the behaviour a daily feed needs. */
export const W = { magnitude: 0.5, timeliness: 0.2, novelty: 0.3 };

/* How long a (kind, subject) pairing stays stale, in days. Shorter than it
   looks: the same PLAYER can headline again in a week, but the same player
   in the same FORMAT needs longer to feel new. */
export const NOVELTY_DAYS = 10;

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const DAY = 86400000;

/* ── Novelty ────────────────────────────────────────────────────────
   1 when this exact story has never run, decaying to 0 the more recently
   it did. Linear rather than exponential so "how long until I can repeat
   this" has an answer a human can predict: NOVELTY_DAYS. */
export function novelty(candidate, history, now) {
  const key = candidate.kind + '::' + candidate.subject;
  const seen = (history || []).filter((h) => h.key === key);
  if (!seen.length) return 1;
  const last = Math.max(...seen.map((h) => Number(h.at) || 0));
  if (!last) return 1;
  const days = (now - last) / DAY;
  if (days >= NOVELTY_DAYS) return 1;
  if (days <= 0) return 0;
  return clamp01(days / NOVELTY_DAYS);
}

/* ── Timeliness ─────────────────────────────────────────────────────
   Every kind declares when it is worth saying, as a function of how many
   hours remain until the deadline. Two shapes cover all of them:

   - DEADLINE-DRIVEN (team news, captaincy, chip calls): rises as the
     deadline approaches, because that is when the decision is made.
   - EVERGREEN (season value, fixture runs): flat. A purple patch is as
     true on a Tuesday as on a Friday, and pretending otherwise would
     starve the feed mid-week, which is exactly when it needs filling.

   A missing deadline (pre-season, between seasons) collapses everything to
   evergreen rather than to zero — otherwise the pipeline would go silent in
   July, which is when a fantasy audience is actually paying most attention. */
export const TIMELINESS = {
  deadline: (hoursToDeadline) => {
    if (hoursToDeadline == null) return 0.55;
    if (hoursToDeadline < 0) return 0.15;           /* deadline gone; stale */
    if (hoursToDeadline <= 24) return 1;
    if (hoursToDeadline <= 72) return 0.8;
    if (hoursToDeadline <= 120) return 0.5;
    return 0.3;
  },
  evergreen: () => 0.6
};

/* ── The kinds ──────────────────────────────────────────────────────
   Each declares how to turn its own raw effect into a 0..1 magnitude, and
   which timeliness shape it follows. `norm` is deliberately explicit per
   kind: an xP gap, an ownership share and a difficulty swing are not
   comparable until someone decides what "big" means for each, and that
   decision belongs here in the open rather than buried in a sort. */
export const KINDS = {
  'price-verdict': {
    label: 'Best at the price',
    /* Gap in xP between the best option in a price band and the next. A
       full point of xP is a decisive verdict; below ~0.25 it is a coin toss
       and not worth a post. */
    norm: (e) => clamp01(e.gap / 1.0),
    timeliness: TIMELINESS.deadline
  },
  'fixture-swing': {
    label: 'Fixture swing',
    /* Change in average fixture difficulty over the coming run, on the 1-5
       scale. A full band (1.0) is a genuine swing; 2+ is dramatic. */
    norm: (e) => clamp01(e.swing / 1.5),
    timeliness: TIMELINESS.evergreen
  },
  differential: {
    label: 'Differential',
    /* Rewards high xP at low ownership. Both matter: a 2%-owned player with
       nothing to say is not a differential, he is just unowned. */
    norm: (e) => clamp01((e.xp / 7) * (1 - clamp01(e.ownership / 25))),
    timeliness: TIMELINESS.deadline
  },
  'template-risk': {
    label: 'Template risk',
    /* A heavily-owned player with a bad run. The pain is proportional to how
       many people own him AND how bad it gets. */
    norm: (e) => clamp01((clamp01(e.ownership / 60)) * (clamp01((e.difficulty - 3) / 2))),
    timeliness: TIMELINESS.deadline
  },
  value: {
    label: 'Value pick',
    /* Points per million against the positional median — the honest version
       of the PPM lists, which rank on raw totals and so always crown the
       cheapest player who happened to start. */
    norm: (e) => clamp01((e.ppm - e.medianPpm) / Math.max(0.5, e.medianPpm * 0.6)),
    timeliness: TIMELINESS.evergreen
  },
  'purple-patch': {
    label: 'Purple patch',
    /* A run of easy fixtures. Magnitude is how much easier than average,
       scaled by how long the run lasts — three easy games beats one. */
    norm: (e) => clamp01(((3 - e.avgDifficulty) / 1.5) * clamp01(e.weeks / 5)),
    timeliness: TIMELINESS.evergreen
  },
  'chip-window': {
    label: 'Chip window',
    /* Only worth saying when a chip window is actually near. */
    norm: (e) => clamp01(e.edge / 15),
    timeliness: TIMELINESS.deadline
  }
};

/* Score one candidate. Returns the total plus its parts, because a ranking
   nobody can explain is a ranking nobody will trust — the parts are carried
   into content.json and shown when the pipeline reports what it chose. */
export function score(candidate, { history = [], now = 0, hoursToDeadline = null } = {}) {
  const kind = KINDS[candidate.kind];
  if (!kind) return null;
  const magnitude = clamp01(kind.norm(candidate.effect || {}));
  const timeliness = clamp01(kind.timeliness(hoursToDeadline));
  const fresh = novelty(candidate, history, now);
  const total = W.magnitude * magnitude + W.timeliness * timeliness + W.novelty * fresh;
  /* `sub` rides along with the rest of the candidate via the spread. */
  return { ...candidate, label: kind.label, magnitude, timeliness, novelty: fresh, total };
}

/* The floor a story must clear to be published at all.

   This is the most important number in the file. Without it the pipeline
   posts something every single day regardless of whether anything happened,
   and a feed that says nothing loudly is worse than a feed that stays quiet.
   Silence is a valid output. */
export const MIN_SCORE = 0.45;

/* Rank every candidate and return the winner plus the runners-up.

   Returns `null` for `pick` when nothing clears MIN_SCORE — the caller is
   expected to publish nothing at all in that case, not to fall back to the
   least-bad option. */
export function selectStory(candidates, opts = {}) {
  const scored = (candidates || [])
    .map((c) => score(c, opts))
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);

  const pick = scored.length && scored[0].total >= MIN_SCORE ? scored[0] : null;
  return {
    pick,
    runnersUp: scored.slice(pick ? 1 : 0, pick ? 4 : 3),
    considered: scored.length,
    rejected: pick ? null : (scored[0]
      ? 'best candidate scored ' + scored[0].total.toFixed(3) + ', below the ' +
        MIN_SCORE + ' floor — nothing worth posting today'
      : 'no candidates were produced')
  };
}

/* Fold the chosen story into the history the next run will read. Kept small
   and append-only: the file is a log of what was said and when, nothing more,
   and it is trimmed so a year of daily runs does not become the slowest part
   of the pipeline. */
export function remember(history, pick, now, keep = 200) {
  if (!pick) return history || [];
  const entry = { key: pick.kind + '::' + pick.subject, at: now, headline: pick.headline };
  return [entry, ...(history || [])].slice(0, keep);
}
