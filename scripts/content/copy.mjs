/*
 * Daily content — the post copy.
 *
 * Deliberately deterministic rather than generated. The numbers on the card
 * come from the model, and copy that restated them loosely — "massive
 * fixture swing!!" over a 0.4 difficulty change — would undermine the one
 * thing this account has that the bigger ones do not, which is that the
 * figures are defensible. Every sentence here is a template with model
 * values slotted in, so the post cannot claim more than the card shows.
 *
 * It is also free and offline, which matters for something that runs daily.
 * `netlify/functions/ai.js` is available if you later want a livelier voice,
 * but it should rewrite this text, never invent the numbers.
 *
 * Voice follows BRAND.md: calm, plain English, British spelling, no hype,
 * nothing gambling-adjacent, never "nailed on" or "guaranteed".
 */

const pct = (v) => v.toFixed(1) + '%';

/* One writer per kind. Each returns { text, alt } — alt is the image
   description, which is not optional: an account posting a data card every
   day with no alt text is excluding exactly the people most likely to read
   carefully. */
const WRITERS = {
  'price-verdict': (d, s) => ({
    text: [
      `${d.position} at ${d.band} — our model's order:`,
      '',
      ...d.rows.map((r, i) => `${i + 1}. ${r.name} (${r.team}) — ${r.xp.toFixed(2)} xP`),
      '',
      `${d.rows[0].name} leads by ${(d.rows[0].xp - d.rows[1].xp).toFixed(2)} projected points.`,
      d.rows[0].owned < 10 ? `Owned by just ${pct(d.rows[0].owned)}.` : ''
    ].filter(Boolean).join('\n'),
    alt: `Table ranking ${d.position}s priced at ${d.band} by projected points. ` +
      d.rows.map((r) => `${r.name} of ${r.team}, ${r.xp.toFixed(2)}`).join('. ') + '.'
  }),

  differential: (d) => ({
    text: [
      `${d.name} (${d.team}) — ${pct(d.owned)} owned.`,
      '',
      `${d.xp.toFixed(2)} projected points next gameweek at ${d.cost}.`,
      'Low ownership is only worth having when the projection backs it up.'
    ].join('\n'),
    alt: `${d.name} of ${d.team}, a ${d.position} costing ${d.cost}, projected ` +
      `${d.xp.toFixed(2)} points at ${pct(d.owned)} ownership.`
  }),

  'template-risk': (d) => ({
    text: [
      `${pct(d.owned)} of managers own ${d.name}.`,
      '',
      `He plays ${d.home ? '' : 'away to '}${d.opponent} — difficulty ${d.difficulty.toFixed(1)} of 5.`,
      'Owning him is not the risk. Owning him without knowing this is.'
    ].join('\n'),
    alt: `${d.name} of ${d.team} is owned by ${pct(d.owned)} and faces ${d.opponent}, ` +
      `rated ${d.difficulty.toFixed(1)} out of 5 for difficulty.`
  }),

  value: (d) => ({
    text: [
      `${d.name} (${d.team}) — ${d.ppm.toFixed(1)} points per £m.`,
      '',
      `${d.points} points at ${d.cost}. The ${d.position} median is ${d.medianPpm.toFixed(1)}.`,
      'Measured against his own position, not the whole league — a £4.0m defender ' +
        'will always flatter a raw points-per-million table.'
    ].join('\n'),
    alt: `${d.name} of ${d.team} has returned ${d.points} points at ${d.cost}, ` +
      `${d.ppm.toFixed(1)} per million against a ${d.position} median of ${d.medianPpm.toFixed(1)}.`
  }),

  'purple-patch': (d) => ({
    text: [
      `${d.team} — ${d.fixtures.length} fixtures averaging ${d.avgDifficulty.toFixed(1)} difficulty.`,
      '',
      ...d.fixtures.map((f) => `GW${f.gw}  ${f.home ? 'vs' : 'at'} ${f.opp}  (${f.difficulty.toFixed(1)})`),
      '',
      'Difficulty is from our match model, not the published seeding.'
    ].join('\n'),
    alt: `${d.team}'s next ${d.fixtures.length} fixtures, averaging ` +
      `${d.avgDifficulty.toFixed(1)} out of 5 for difficulty: ` +
      d.fixtures.map((f) => `gameweek ${f.gw} ${f.home ? 'versus' : 'away to'} ${f.opp}`).join(', ') + '.'
  }),

  'fixture-swing': (d) => ({
    text: [
      `${d.team}'s fixtures ease off.`,
      '',
      `Next three average ${d.before.toFixed(1)}. The three after average ${d.after.toFixed(1)}.`,
      '',
      ...d.fixtures.map((f) => `GW${f.gw}  ${f.home ? 'vs' : 'at'} ${f.opp}  (${f.difficulty.toFixed(1)})`),
      '',
      'Worth knowing before you buy, not after.'
    ].join('\n'),
    alt: `${d.team}'s fixture difficulty falls from ${d.before.toFixed(1)} across the next ` +
      `three gameweeks to ${d.after.toFixed(1)} across the three after.`
  }),

  'chip-window': (d) => ({
    text: [`${d.chip} window: ${d.note}`].join('\n'),
    alt: `Chip planning card for the ${d.chip}.`
  })
};

/* Hashtags are per-kind rather than a fixed block: the same five tags on
   every post is what a bot looks like. */
const TAGS = {
  'price-verdict': ['#FPL', '#FPLCommunity'],
  differential: ['#FPL', '#FPLDifferentials'],
  'template-risk': ['#FPL', '#FPLTemplate'],
  value: ['#FPL', '#FPLValue'],
  'purple-patch': ['#FPL', '#FPLFixtures'],
  'fixture-swing': ['#FPL', '#FPLFixtures'],
  'chip-window': ['#FPL', '#FPLChips']
};

export function draft(payload) {
  const s = payload && payload.story;
  if (!s) return null;
  const writer = WRITERS[s.kind];
  if (!writer) return null;
  const { text, alt } = writer(s.data || {}, s);
  const tags = (TAGS[s.kind] || ['#FPL']).join(' ');
  const body = `${text}\n\n${tags}`;

  return {
    kind: s.kind,
    headline: s.headline,
    text: body,
    alt,
    /* X's limit. Reported rather than enforced by truncation — silently
       cutting a post mid-number would be worse than flagging it. */
    length: body.length,
    withinXLimit: body.length <= 280,
    scoreBreakdown: {
      total: +s.total.toFixed(3), magnitude: +s.magnitude.toFixed(2),
      timeliness: +s.timeliness.toFixed(2), novelty: +s.novelty.toFixed(2)
    }
  };
}
