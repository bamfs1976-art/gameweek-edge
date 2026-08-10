/* Fantasy EFL — the weekly dashboard.
   Loads one snapshot, builds one model context, and renders the seven pick
   cards and the fixture snapshot from it. Nothing on this page computes a
   score the other pages would compute differently: the numbers here come
   from the same roundPicks() the finder and the club picker use. */

import { loadSnapshot } from './provider.js';
import {
  buildContext, roundPicks, runSummary, ordinal, buildSquad, squadRationale, playerScore
} from './model.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, emptyState, fdrCell, fdrLegend,
  divisionBadge, homeAwayBadge, availabilityBadge, formStrip, fmtDay, DIVISION_LABELS
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
    renderSnapshot(ctx);
  } catch (err) {
    mount('picks-grid', errorState(err, 'retry-picks'));
    mount('squad-body', '');
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
      ${availabilityBadge(p.availability)}
    </div>
    ${fixtureLine(rec.next, ctx)}
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
    ${fixtureLine(rec.next, ctx)}
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
    ${fixtureLine(rec.next, ctx)}
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

function fixtureLine(rated, ctx) {
  if (!rated) {
    return '<div class="pick-fix">' + fdrCell(null) + '<span>Blank round — no fixture</span></div>';
  }
  const opp = ctx.clubById[rated.opponentId];
  return '<div class="pick-fix">'
    + fdrCell(rated.rating)
    + homeAwayBadge(rated.home)
    + `<span>${rated.home ? 'v' : 'at'} <b>${esc(opp ? opp.name : '—')}</b></span>`
    + `<span class="muted">${esc(fmtDay(rated.kickoff))}</span>`
    + '</div>';
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
      Ratings are modelled; the shape and the club limit are the game's rules.</p>`);

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
