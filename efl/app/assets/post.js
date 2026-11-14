/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — the weekly discussion post.

   A short post to paste into Reddit or Discord: the model's seven with one
   sentence each, the captain, the two clubs and the round's blanks and
   doubles. First person and plain, because it is written to start a
   conversation, not to sell anything. Every line says "modelled" where a
   number appears, and nothing in it is phrased as a forecast.

   The source line is OFF by default. A post that links to the site that
   wrote it reads as an advert in most communities, so it is the reader's
   choice to add one.

   Pure functions; dev/test-efl-post.mjs runs them in Node. The image card
   is drawn in the page from cardModel(), which is tested here too.
   ═══════════════════════════════════════════════════════════ */

import { buildSquad, roundPicks, POSITION_NAMES } from './model.js';

export const SITE_LINE = 'gameweekedge.co.uk/fantasy-efl';
export const DISCORD_LIMIT = 2000;
const POSITION_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

/** This round's blanks and doubles, as club names. */
export function roundBlanksDoubles(ctx) {
  const count = new Map(ctx.clubs.map((c) => [c.id, 0]));
  for (const f of ctx.fixtures) {
    if (f.round !== ctx.currentRound) continue;
    count.set(f.homeId, (count.get(f.homeId) || 0) + 1);
    count.set(f.awayId, (count.get(f.awayId) || 0) + 1);
  }
  const name = (id) => (ctx.clubById[id] ? ctx.clubById[id].name : id);
  const blanks = [...count].filter(([, n]) => n === 0).map(([id]) => name(id)).sort();
  const doubles = [...count].filter(([, n]) => n > 1).map(([id]) => name(id)).sort();
  return { blanks, doubles };
}

/** Up to `max` names, then "and N more". */
export function nameList(names, max = 6) {
  if (!names.length) return 'none';
  if (names.length <= max) return joinAnd(names);
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
function joinAnd(list) {
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** "v Norwich City (H)" or "at Norwich City (A)", every match in the round. */
function fixtureWords(ctx, rec) {
  const list = (rec.fixtures && rec.fixtures.length) ? rec.fixtures : (rec.next ? [rec.next] : []);
  if (!list.length) return 'no game';
  return list.map((f) => {
    const opp = ctx.clubById[f.opponentId];
    return `${f.home ? 'v' : 'at'} ${opp ? opp.name : 'unknown'} (${f.home ? 'H' : 'A'})`;
  }).join(' and ');
}

/** Everything the post and the card say, in one structure. */
export function postModel(ctx, opts = {}) {
  const scored = opts.scored;
  const squad = buildSquad(ctx, { scored });
  if (!squad || !squad.picks.length) return null;
  const picks = roundPicks(ctx, { scored });
  const clubs = (picks.allClubs || []).filter((c) => c.run && c.run.rounds[0] && !c.run.rounds[0].blank).slice(0, 2);
  const rows = squad.picks.slice()
    .sort((a, b) => POSITION_ORDER[a.player.position] - POSITION_ORDER[b.player.position] || b.score - a.score)
    .map((rec) => {
      const club = ctx.clubById[rec.player.clubId];
      return {
        id: rec.player.id,
        position: rec.player.position,
        name: rec.player.name,
        club: club ? club.name : '',
        clubShort: club ? club.short : '',
        fixtures: fixtureWords(ctx, rec),
        double: rec.fixtures && rec.fixtures.length > 1,
        score: rec.score,
        reason: rec.summary,
        captain: squad.captain && squad.captain.player.id === rec.player.id
      };
    });
  const captain = rows.find((r) => r.captain) || rows[0];
  return {
    round: ctx.currentRound,
    formation: squad.formation ? squad.formation.id || '' : '',
    rows,
    captain,
    clubs: clubs.map((c) => ({ name: c.club.name, reason: c.summary })),
    clubCount: ctx.clubs.length,
    ...roundBlanksDoubles(ctx)
  };
}

/* Past this many clubs a list of names stops helping: a midweek round
   where half the league plays twice is better said as a count. */
export const LIST_LIMIT = 12;

/** The round's blanks and doubles as one sentence. */
export function roundNote(model) {
  const total = model.clubCount || 72;
  const part = (list, verb) => (list.length > LIST_LIMIT
    ? `${list.length} of ${total} clubs ${verb}`
    : `${verb === 'play twice' ? 'Doubles' : 'Blanks'}: ${nameList(list)}`);
  return `${part(model.doubles, 'play twice')}. ${part(model.blanks, 'have no game')}.`;
}

/**
 * The post as text. Reddit and Discord both read this markdown; the
 * Discord version is kept under Discord's 2,000 character limit by
 * dropping the reason sentences, longest first, until it fits.
 * @param {Object} model   postModel()
 * @param {{flavour?:'reddit'|'discord', sourceLine?:boolean}} opts
 */
export function postText(model, opts = {}) {
  if (!model) return '';
  const flavour = opts.flavour === 'discord' ? 'discord' : 'reddit';
  const build = (withReasons) => {
    const lines = [];
    lines.push(`**Fantasy EFL round ${model.round}: my modelled seven**`, '');
    lines.push('These come from a model rating form, minutes, output and fixtures. They are ratings, not forecasts, so treat them as a starting point.'
      + (model.formation ? ` Shape: ${model.formation}.` : ''), '');
    for (const r of model.rows) {
      const head = `- **${r.position}** ${r.name} (${r.club}), ${r.fixtures}${r.captain ? ' **(C)**' : ''}`;
      lines.push(withReasons.has(r.id) ? `${head}. ${r.reason}` : `${head}.`);
    }
    lines.push('');
    /* Reddit joins lines that are not separated by a blank one; Discord
       keeps them. So the summary lines get a gap on Reddit only. */
    const gap = flavour === 'reddit' ? [''] : [];
    lines.push(`**Captain:** ${model.captain.name}. The highest modelled rating in the seven with a fixture that suits the armband.`, ...gap);
    if (model.clubs.length) lines.push(`**Clubs:** ${joinAnd(model.clubs.map((c) => c.name))}.`, ...gap);
    lines.push(`**Round ${model.round}:** ${roundNote(model)}`);
    lines.push('', 'Who is everyone else going with this week?');
    if (opts.sourceLine) lines.push('', `Ratings: ${SITE_LINE}`);
    return lines.join('\n');
  };
  const all = new Set(model.rows.map((r) => r.id));
  let text = build(all);
  if (flavour === 'discord') {
    const byLength = model.rows.slice().sort((a, b) => b.reason.length - a.reason.length);
    for (const r of byLength) {
      if (text.length <= DISCORD_LIMIT) break;
      all.delete(r.id);
      text = build(all);
    }
  }
  return text;
}

/* ── The image card ──────────────────────────────────────── */

export const CARD = { width: 1080, height: 1350 };

/**
 * What the card shows, row by row, with nothing about pixels. The page
 * draws it; this decides it, so the content is testable without a canvas.
 */
export function cardModel(model) {
  if (!model) return null;
  return {
    title: `Fantasy EFL round ${model.round}`,
    subtitle: 'My modelled seven',
    rows: model.rows.map((r) => ({
      position: r.position,
      positionName: POSITION_NAMES[r.position],
      name: r.name,
      club: r.club,
      fixture: r.fixtures,
      rating: r.score.toFixed(1),
      captain: r.captain
    })),
    clubs: model.clubs.map((c) => c.name),
    footer: 'Modelled ratings, not forecasts',
    site: SITE_LINE
  };
}
