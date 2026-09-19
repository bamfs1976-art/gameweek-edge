/* Fantasy EFL — the weekly dashboard.
   Loads one snapshot, builds one model context, and renders the seven pick
   cards and the fixture snapshot from it. Nothing on this page computes a
   score the other pages would compute differently: the numbers here come
   from the same roundPicks() the finder and the club picker use. */

import { loadSnapshot } from './provider.js';
import {
  buildContext, roundPicks, runSummary, ordinal, buildSquad, squadRationale, playerScore,
  maxCaptainRead, squadAdvice, slotLayout
} from './model.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, emptyState, fdrCell, fdrLegend,
  divisionBadge, homeAwayBadge, availabilityBadge, formStrip, fmtDay, suspensionBadge,
  DIVISION_LABELS
} from './ui.js';

initTheme();

const DIVISIONS = ['championship', 'league-one', 'league-two'];
/* Scoring every player is the expensive step and three sections want it, so
   it happens once and is passed around. */
let scoredPlayers = null;
let context = null;
let oneClubChip = false;

start();

async function start() {
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    const note = document.getElementById('data-note');
    if (note) {
      note.textContent = `${snapshot.source.label} · round ${snapshot.currentRound} · `
        + `${snapshot.clubs.length} clubs and ${snapshot.players.length} players loaded. `
        + 'All ratings and scores on this site are modelled.';
    }
    const ctx = buildContext(snapshot);
    context = ctx;
    scoredPlayers = ctx.players.map((p) => playerScore(ctx, p));
    renderPicks(ctx);
    renderSquad();
    renderMine();
    renderSnapshot(ctx);
  } catch (err) {
    mount('picks-grid', errorState(err, 'retry-picks'));
    mount('squad-body', '');
    mount('mine-body', '');
    mount('snapshot-body', '');
    const retry = document.getElementById('retry-picks');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

/* ── This round's picks ─────────────────────────────────── */

function renderPicks(ctx) {
  const picks = roundPicks(ctx, { scored: scoredPlayers });
  const cards = [
    playerCard('Best goalkeeper', picks.goalkeeper, ctx),
    playerCard('Best defender', picks.defender, ctx),
    playerCard('Best midfielder', picks.midfielder, ctx),
    playerCard('Best forward', picks.forward, ctx),
    differentialCard(picks.differential, ctx),
    clubCard(picks.club, ctx),
    captainCard(picks.captain, ctx)
  ].filter(Boolean);

  if (!cards.length) {
    mount('picks-grid', emptyState('No picks available yet',
      'Picks need played fixtures to rate form and upcoming fixtures to rate difficulty. '
      + 'Neither is in the data yet.'));
    return;
  }
  mount('picks-grid', `<div class="grid g-auto">${cards.join('')}</div>`
    + `<p class="sec-note" style="margin-top:11px">Scores are a modelled 0-100 rating built from `
    + `form, minutes, output, fixture and home advantage, weighted as set out in the `
    + `<a href="/fantasy-efl/how-to-play/#model" style="color:var(--efl)">model note</a>. `
    + `They rank the options against stated criteria; they do not predict points.</p>`);
}

function playerCard(role, rec, ctx) {
  if (!rec) {
    return card(role, emptyState('No qualifying player',
      'Every candidate is either unavailable or short of minutes this round.'));
  }
  const p = rec.player;
  const club = ctx.clubById[p.clubId];
  return card(role, `
    <div class="pick-name">${esc(p.name)}</div>
    <div class="pick-meta">
      <span class="badge">${esc(p.position)}</span>
      ${divisionBadge(p.division)}
      <span>${esc(club ? club.name : '—')}</span>
      ${availabilityBadge(p.availability)}${suspensionBadge(rec.suspension)}
    </div>
    ${fixtureLine(rec.fixtures || rec.next, ctx)}
    <p class="pick-why">${esc(rec.summary)}</p>
    <div class="pick-foot">
      <span>${formStrip(club ? club.form : [])}</span>
      <span class="pick-score" title="Modelled pick rating out of 100">${rec.score.toFixed(1)}</span>
    </div>`);
}

function captainCard(rec, ctx) {
  if (!rec) return card('Best captain', emptyState('No captain suggestion', 'No available player has a fixture this round.'));
  const p = rec.player;
  const club = ctx.clubById[p.clubId];
  return card('Best captain', `
    <div class="pick-name">${esc(p.name)}</div>
    <div class="pick-meta">
      <span class="badge">${esc(p.position)}</span>
      ${divisionBadge(p.division)}
      <span>${esc(club ? club.name : '—')}</span>
      ${availabilityBadge(p.availability)}
    </div>
    ${fixtureLine(rec.fixtures || rec.next, ctx)}
    <p class="pick-why">${esc(rec.summary)} Highest-rated available pick with a fixture rated
      ${rec.next ? rec.next.rating : '—'} or better, which is what a captaincy needs before
      anything else.</p>
    <div class="pick-foot">
      <span>${formStrip(club ? club.form : [])}</span>
      <span class="pick-score" title="Modelled pick rating out of 100">${rec.score.toFixed(1)}</span>
    </div>`);
}

function differentialCard(rec, ctx) {
  if (!rec) return card('Best differential', emptyState('No differential', 'Nothing clears the form threshold this round.'));
  const p = rec.player;
  const club = ctx.clubById[p.clubId];
  return card('Best differential', `
    <div class="pick-name">${esc(p.name)}</div>
    <div class="pick-meta">
      <span class="badge">${esc(p.position)}</span>
      ${divisionBadge(p.division)}
      <span>${esc(club ? club.name : '—')}</span>
      ${availabilityBadge(p.availability)}
    </div>
    ${fixtureLine(rec.fixtures || rec.next, ctx)}
    <p class="pick-why">${esc(rec.summary)}</p>
    <p class="pick-why" style="color:var(--text-3)"><b>Form differential ${rec.differential.score.toFixed(0)}</b>
      — a modelled, editorial measure of good recent output at a club that gets less attention.
      It is <b>not</b> an ownership figure: the official game publishes ownership for clubs (see
      the <a href="/fantasy-efl/clubs/" style="color:var(--efl)">club picker</a>) but not for
      players, so this stands in for it and says so.</p>
    <div class="pick-foot">
      <span>${esc(club ? `${ordinal(club.position)} in ${DIVISION_LABELS[club.division]}` : '')}</span>
      <span class="pick-score">${rec.score.toFixed(1)}</span>
    </div>`);
}

function clubCard(rec, ctx) {
  if (!rec) return card('Best club pick', emptyState('No club rating', 'No club has enough played fixtures to rate.'));
  const c = rec.club;
  const next = rec.run.rounds.find((r) => !r.blank);
  const first = next && next.matches[0];
  return card('Best club pick', `
    <div class="pick-name">${esc(c.name)}</div>
    <div class="pick-meta">
      ${divisionBadge(c.division)}
      <span>${esc(ordinal(c.position))} · ${c.points} pts from ${c.played}</span>
    </div>
    ${fixtureLine(first, ctx)}
    <p class="pick-why">${esc(rec.summary)}</p>
    <div class="pick-foot">
      <span>${formStrip(c.form)}</span>
      <span class="pick-score" title="Modelled club rating out of 100">${rec.score.toFixed(1)}</span>
    </div>`);
}

/* `rated` may be one fixture or the whole round. A double gets a line per
   match and says so: two chances to return is why the pick is there. */
function fixtureLine(rated, ctx) {
  const list = Array.isArray(rated) ? rated.filter(Boolean) : (rated ? [rated] : []);
  if (!list.length) {
    return '<div class="pick-fix">' + fdrCell(null) + '<span>Blank round — no fixture</span></div>';
  }
  const one = (r) => {
    const opp = ctx.clubById[r.opponentId];
    return '<div class="pick-fix">'
      + fdrCell(r.rating)
      + homeAwayBadge(r.home)
      + `<span>${r.home ? 'v' : 'at'} <b>${esc(opp ? opp.name : '—')}</b></span>`
      + `<span class="muted">${esc(fmtDay(r.kickoff))}</span>`
      + '</div>';
  };
  if (list.length === 1) return one(list[0]);
  return '<div class="pick-fix"><span class="t-sub"><b>Double round — '
    + list.length + ' matches</b></span></div>' + list.map(one).join('');
}

function card(role, body) {
  return `<article class="pick"><p class="pick-role">${esc(role)}</p>${body}</article>`;
}

/* ── Build your seven ───────────────────────────────────── */

function renderSquad() {
  const ctx = context;
  const squad = buildSquad(ctx, { scored: scoredPlayers, oneClubChip });

  if (!squad) {
    mount('squad-body', emptyState('No legal seven can be built',
      'Every formation needs a goalkeeper and six outfielders from at least four clubs, '
      + 'all available and all with a fixture this round. The data does not currently '
      + 'support one.'));
    return;
  }

  const order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  const cards = squad.picks.slice()
    .sort((a, b) => order[a.player.position] - order[b.player.position] || b.score - a.score)
    .map((r) => squadCard(r, r === squad.captain))
    .join('');

  const clubsUsed = Object.keys(squad.clubCounts).length;
  const divisions = new Set(squad.picks.map((r) => r.player.division)).size;

  mount('squad-body', `
    <div class="squad-bar">
      <span class="sb-stat">Formation <b>${esc(squad.formation.id)}</b></span>
      <span class="sb-stat">Combined rating <b>${squad.total.toFixed(1)}</b></span>
      <span class="sb-stat"><b>${clubsUsed}</b> clubs · <b>${divisions}</b> of 3 divisions</span>
      <label class="squad-toggle">
        <input type="checkbox" id="one-club-chip" ${oneClubChip ? 'checked' : ''}>
        One-club chip
        <span class="sr-only">lifts the two-players-per-club limit</span>
      </label>
    </div>
    <div class="squad">${cards}</div>
    <p class="sec-note" style="margin-top:11px">${esc(squadRationale(ctx, squad))}
      ${oneClubChip
    ? 'The two-per-club limit is lifted, so this is the side to play a one-club chip on.'
    : 'Limited to two players per club, as the game requires.'}
      Ratings are modelled; the shape and the club limit are the game's rules.</p>
    ${chipPanel(ctx, squad)}`);

  const toggle = document.getElementById('one-club-chip');
  if (toggle) {
    toggle.addEventListener('change', (e) => {
      oneClubChip = e.target.checked;
      renderSquad();
      /* Focus survives the re-render, so a keyboard user is not thrown back
         to the top of the page by their own checkbox. */
      const again = document.getElementById('one-club-chip');
      if (again) again.focus();
    });
  }
}

/* Both of the game's chips, side by side, each with the model's read on
   whether this is the round to spend it.

   The verdict is a WORD as well as a colour, because a colour on its own is
   not a signal a screen reader or a colourblind reader can use. */
const CHIP_VERDICT_LABEL = { play: 'Play it', consider: 'Worth a look', hold: 'Hold' };

function chipPanel(ctx, squad) {
  const read = maxCaptainRead(ctx, squad);
  const clubsUsed = Object.keys(squad.clubCounts).length;

  const maxCaptain = read ? `
    <article class="chip-card chip-${esc(read.verdict)}">
      <p class="chip-head">
        <span class="chip-name">Max Captain</span>
        <span class="chip-verdict">${esc(CHIP_VERDICT_LABEL[read.verdict])}</span>
      </p>
      <p class="chip-say">${esc(read.summary)}</p>
      <ul class="chip-why">${read.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="chip-rule">Two a season, one in each half. It hands the armband to your
        highest scorer once every one of your seven has finished playing, so the captain
        call stops being a call.</p>
    </article>` : '';

  const oneClub = `
    <article class="chip-card chip-${oneClubChip ? 'play' : 'hold'}">
      <p class="chip-head">
        <span class="chip-name">One Club</span>
        <span class="chip-verdict">${oneClubChip ? 'Modelled on' : 'Modelled off'}</span>
      </p>
      <p class="chip-say">${oneClubChip
    ? `The seven above ignores the two-per-club limit and uses ${clubsUsed} club${clubsUsed === 1 ? '' : 's'}.`
    : 'The seven above keeps to two players per club. Switch the chip on in the bar above to see the side it would buy you.'}</p>
      <p class="chip-rule">Once a season. It lifts the two-players-per-club limit for one
        round, so it pays when one club has a run of fixtures worth stacking.</p>
    </article>`;

  return `<div class="chips">${maxCaptain}${oneClub}</div>
    <p class="sec-note" style="margin-top:9px">Chip reads are this model's opinion of your
      own seven, not the game's advice. The official game is the authority on how many chips
      you hold and when they reset.</p>`;
}

/* ── Your seven ─────────────────────────────────────────
   Seven selects rather than a search box. A search is the obvious build and
   it is the wrong one here: the game asks for a fixed shape, so the slots
   ARE the interface, and a native select is the control a phone, a keyboard
   and a screen reader all already know how to drive. Grouping the options
   by club is what makes a thousand players navigable — you know which club
   you are picking from before you know which player. */

const MINE_KEY = 'ge-efl-squad';
const POSITION_LABEL = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };

function loadMine() {
  try {
    const raw = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, 7) : [];
  } catch (_) { return []; }           /* private mode, or somebody edited it */
}
function saveMine(ids) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(ids)); } catch (_) { /* private mode */ }
}

let mineIds = [];

function playerOptions(ctx, position, selectedId) {
  const byClub = new Map();
  for (const p of ctx.players) {
    if (p.position !== position) continue;
    const club = ctx.clubById[p.clubId];
    const key = club ? club.name : 'Other';
    if (!byClub.has(key)) byClub.set(key, []);
    byClub.get(key).push(p);
  }
  const groups = [...byClub.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return `<option value="">Not picked</option>` + groups.map(([club, list]) => {
    const opts = list.sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
      const flag = p.availability.status === 'available' ? '' : ' (' + p.availability.status + ')';
      return `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}${esc(flag)}</option>`;
    }).join('');
    return `<optgroup label="${esc(club)}">${opts}</optgroup>`;
  }).join('');
}

function renderMine() {
  const ctx = context;
  mineIds = loadMine();
  const advice = squadAdvice(ctx, mineIds, { scored: scoredPlayers, oneClubChip, limit: 3 });
  const best = buildSquad(ctx, { scored: scoredPlayers, oneClubChip });

  const filled = advice.picks.map((r) => r.player);
  const counts = {};
  for (const p of filled) counts[p.position] = (counts[p.position] || 0) + 1;
  const used = new Set();
  const slotValue = (pos) => {
    const hit = filled.find((p) => p.position === pos && !used.has(p.id));
    if (hit) used.add(hit.id);
    return hit ? hit.id : '';
  };
  const slots = slotLayout(counts).map((pos, i) => {
    const id = 'mine-slot-' + i;
    return `<div class="mine-slot">
      <label for="${id}">${esc(POSITION_LABEL[pos])}</label>
      <select id="${id}" data-slot="${i}" data-pos="${pos}">${playerOptions(ctx, pos, slotValue(pos))}</select>
    </div>`;
  }).join('');

  const empty = !advice.count;
  const gap = Math.round((best.total - advice.total) * 10) / 10;

  const verdict = empty
    ? '<p class="sec-note">Pick your side above and this will rate it, check it against the rules '
      + 'and tell you the one change worth making.</p>'
    : `<div class="squad-bar">
        <span class="sb-stat">Your rating <b>${advice.total.toFixed(1)}</b></span>
        <span class="sb-stat">Model's best <b>${best.total.toFixed(1)}</b></span>
        <span class="sb-stat">${advice.complete
    ? (gap <= 0 ? 'You are level with it' : `<b>${gap.toFixed(1)}</b> behind it`)
    : `<b>${advice.count}</b> of 7 picked`}</span>
      </div>`;

  const problems = [];
  for (const issue of advice.issues) problems.push(issue);
  for (const r of advice.unavailable) problems.push(`${r.player.name} is ${r.player.availability.status}`);
  for (const r of advice.blanking) problems.push(`${r.player.name} has no fixture this round`);
  if (advice.unknown.length) problems.push(`${advice.unknown.length} saved pick(s) are no longer in the game`);

  const problemList = problems.length
    ? `<div class="chip-card chip-consider" style="margin-top:11px">
        <p class="chip-head"><span class="chip-name">Worth fixing first</span></p>
        <ul class="chip-why">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>`
    : '';

  let swapBlock = '';
  if (advice.complete && advice.swaps.length) {
    swapBlock = `<div class="swaps">${advice.swaps.map((s, i) => `
      <article class="swap${i === 0 ? ' swap-top' : ''}">
        <p class="swap-move">
          <span class="swap-out">${esc(s.out.player.name)}</span>
          <span class="swap-arrow" aria-hidden="true">→</span>
          <span class="sr-only">out, replaced by</span>
          <span class="swap-in">${esc(s.in.player.name)}</span>
          <span class="swap-gain">+${s.gain.toFixed(1)}</span>
        </p>
        <p class="swap-why">${esc(s.reason)}</p>
      </article>`).join('')}</div>
      <p class="sec-note" style="margin-top:9px">One change at a time, ranked by what each gains.
        Every one of these leaves a side the game would accept: the shape stays legal and the
        two-per-club limit holds.</p>`;
  } else if (advice.complete && advice.legal) {
    swapBlock = `<div class="chip-card chip-play" style="margin-top:11px">
      <p class="chip-head"><span class="chip-name">No change worth making</span>
        <span class="chip-verdict">Hold</span></p>
      <p class="chip-say">The model cannot find a single swap that would raise this side. Save your
        moves for a week that needs them.</p></div>`;
  }

  const chipRead = advice.complete && advice.legal
    ? maxCaptainRead(ctx, { picks: advice.picks, captain: advice.picks.reduce((a, b) => (b.score > a.score ? b : a)), clubCounts: advice.clubCounts })
    : null;
  const chipBlock = chipRead
    ? `<div class="chip-card chip-${esc(chipRead.verdict)}" style="margin-top:11px">
        <p class="chip-head"><span class="chip-name">Max Captain, on your side</span>
          <span class="chip-verdict">${esc(CHIP_VERDICT_LABEL[chipRead.verdict])}</span></p>
        <p class="chip-say">${esc(chipRead.summary)}</p>
        <ul class="chip-why">${chipRead.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>`
    : '';

  mount('mine-body', `
    <div class="mine-grid">${slots}</div>
    <div class="mine-actions">
      <button type="button" class="btn btn-ghost btn-sm" id="mine-copy">Start from the model's seven</button>
      <button type="button" class="btn btn-ghost btn-sm" id="mine-clear">Clear</button>
    </div>
    ${verdict}${problemList}${swapBlock}${chipBlock}`);

  const body = document.getElementById('mine-body');
  if (!body) return;

  body.querySelectorAll('select[data-slot]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const ids = [...body.querySelectorAll('select[data-slot]')].map((s) => s.value).filter(Boolean);
      /* A player picked into two slots is a slip, not a squad. Keep the
         first and let the change stand rather than silently reverting it. */
      saveMine([...new Set(ids)]);
      const focused = sel.id;
      renderMine();
      const again = document.getElementById(focused);
      if (again) again.focus();
    });
  });

  const copy = document.getElementById('mine-copy');
  if (copy) {
    copy.addEventListener('click', () => {
      saveMine(best.picks.map((r) => r.player.id));
      renderMine();
      const first = document.querySelector('#mine-body select[data-slot]');
      if (first) first.focus();
    });
  }
  const clear = document.getElementById('mine-clear');
  if (clear) {
    clear.addEventListener('click', () => {
      saveMine([]);
      renderMine();
      const first = document.querySelector('#mine-body select[data-slot]');
      if (first) first.focus();
    });
  }
}

function squadCard(rec, isCaptain) {
  const p = rec.player;
  const club = context.clubById[p.clubId];
  const next = rec.next;
  const opp = next && context.clubById[next.opponentId];
  return `<article class="sq-card sq-${esc(p.position)} ${isCaptain ? 'is-captain' : ''}">
    <p class="sq-pos"><span>${esc(p.position)}</span>
      ${isCaptain ? '<span class="sq-armband" title="Captain — points doubled">C</span>' : ''}</p>
    <p class="sq-name">${esc(p.name)}</p>
    <p class="sq-meta">${esc(club ? club.name : '—')} · ${esc(DIVISION_LABELS[p.division])}</p>
    ${rec.suspension.level === 'onEdge' ? `<p class="sq-meta" style="color:var(--red)">${esc(rec.suspension.note)}</p>` : ''}
    <div class="sq-foot">
      <span>${next ? fdrCell(next.rating) : fdrCell(null)}
        <span class="sq-meta">${next ? esc((opp ? opp.short : '???') + (next.home ? ' (H)' : ' (A)')) : 'Blank'}</span></span>
      <span class="sq-score" title="Modelled pick rating out of 100">${rec.score.toFixed(1)}</span>
    </div>
  </article>`;
}

/* ── Fixture snapshot ───────────────────────────────────── */

function renderSnapshot(ctx) {
  const blocks = DIVISIONS.map((div) => {
    const clubs = ctx.clubs.filter((c) => c.division === div)
      .map((c) => ({ club: c, run: runSummary(ctx, c.id, 3) }))
      .sort((a, b) => b.run.quality - a.run.quality)
      .slice(0, 6);
    if (!clubs.length) return '';
    return `
      <div class="card">
        <div class="sec-head" style="margin-bottom:9px">
          <h3 class="sec-title">${esc(DIVISION_LABELS[div])}</h3>
          <span class="sec-note">Best next three</span>
        </div>
        <div class="tscroll" style="border:0">
          <table class="stack-sm">
            <caption class="sr-only">Next three fixtures for the six best-rated
              ${esc(DIVISION_LABELS[div])} clubs</caption>
            <thead>
              <tr>
                <th scope="col">Club</th>
                <th scope="col">Next</th>
                <th scope="col">+1</th>
                <th scope="col">+2</th>
                <th scope="col" class="num">Avg</th>
              </tr>
            </thead>
            <tbody>${clubs.map((row) => snapshotRow(ctx, row)).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }).filter(Boolean).join('');

  if (!blocks) {
    mount('snapshot-body', emptyState('No upcoming fixtures', 'The fixture list has no rounds ahead of the current one.'));
    return;
  }
  mount('snapshot-body',
    `<div class="grid g-2">${blocks}</div>`
    + `<div style="margin-top:11px">${fdrLegend()}</div>`);
}

function snapshotRow(ctx, { club, run }) {
  const cells = run.rounds.map((r) => {
    if (r.blank) {
      return `<td data-label="Round ${r.round}">${fdrCell(null)}
        <span class="t-sub">Blank</span></td>`;
    }
    const inner = r.matches.map((m) => {
      const opp = ctx.clubById[m.opponentId];
      return `${fdrCell(m.rating)} <span class="t-sub">${esc(opp ? opp.short : '???')}
        (${m.home ? 'H' : 'A'})${m.postponed ? ' · rearranged' : ''}</span>`;
    }).join(' ');
    return `<td data-label="Round ${r.round}">${inner}${r.double ? '<span class="t-sub"><b>Double round</b></span>' : ''}</td>`;
  }).join('');
  return `<tr>
      <td data-label="Club"><span class="t-name">${esc(club.name)}</span>
        <span class="t-sub">${esc(ordinal(club.position))} · ${club.points} pts</span></td>
      ${cells}
      <td class="num" data-label="Average difficulty">${run.meanRating.toFixed(1)}</td>
    </tr>`;
}
