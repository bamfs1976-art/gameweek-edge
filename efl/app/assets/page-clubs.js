/* Fantasy EFL — club picker.

   Fantasy EFL asks for two clubs, which is a smaller decision space than
   the player picks and a much less examined one. Everything here is
   clubScore() from model.js — the same function the dashboard's club card
   uses — so the ranked list and the featured card can never disagree.

   The written rationale is not decoration. It is `Recommendation.summary`,
   built from the same weighted factors that produced the number, which is
   what stops the rating being an opaque score with a sentence bolted on. */

import { loadSnapshot } from './provider.js';
import { buildContext, clubScore, runSummary, ordinal, CLUB_WEIGHTS } from './model.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, emptyState, fdrCell, fdrLegend,
  methodNote, divisionBadge, formStrip, fmtDay, DIVISION_LABELS
} from './ui.js';

initTheme();

const state = { search: '', division: 'all', sort: 'score' };
let ctx = null;
let rows = [];

start();

async function start() {
  mount('best', '<div role="status" aria-live="polite"><span class="sr-only">Loading clubs</span>'
    + '<div class="grid g-2"><div class="skel skel-card"></div><div class="skel skel-card"></div></div></div>');
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    const note = document.getElementById('data-note');
    if (note) note.textContent = `${snapshot.source.label} · round ${snapshot.currentRound} · `
      + `${snapshot.clubs.length} clubs.`;
    ctx = buildContext(snapshot);
    mount('legend', fdrLegend());
    mount('method', methodNote(
      `A club's modelled rating combines recent form (${pct('form')}), goals conceded in the last `
      + `five (${pct('defence')}), goals scored in the last five (${pct('attack')}), the next three `
      + `fixtures (${pct('fixtures')}) and how many of them are at home (${pct('home')}). Every `
      + 'input is normalised inside the club\'s own division, so a League Two club is measured '
      + 'against League Two — which is what makes a rating of 78 mean the same thing in all three.'));

    rows = ctx.clubs.map((club) => ({
      club,
      rec: clubScore(ctx, club),
      r3: runSummary(ctx, club.id, 3),
      r5: runSummary(ctx, club.id, 5),
      r6: runSummary(ctx, club.id, 6)
    }));

    setupFilters();
    renderBest();
    render();
  } catch (err) {
    mount('best', errorState(err, 'retry'));
    mount('table', '');
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

const pct = (key) => `${Math.round(CLUB_WEIGHTS[key] * 100)}%`;

/* ── Filters ────────────────────────────────────────────── */

function setupFilters() {
  document.getElementById('filters').hidden = false;
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on('f-search', 'input', (e) => { state.search = e.target.value.trim().toLowerCase(); render(); });
  on('f-division', 'change', (e) => { state.division = e.target.value; renderBest(); render(); });
  on('f-sort', 'change', (e) => { state.sort = e.target.value; render(); });
  on('f-reset', 'click', () => {
    state.search = ''; state.division = 'all'; state.sort = 'score';
    document.getElementById('f-search').value = '';
    document.getElementById('f-division').value = 'all';
    document.getElementById('f-sort').value = 'score';
    renderBest(); render();
  });
}

/* ── Best picks ─────────────────────────────────────────── */

function renderBest() {
  const best = rows
    .filter((r) => state.division === 'all' || r.club.division === state.division)
    .slice().sort((a, b) => b.rec.score - a.rec.score)
    .slice(0, 5);

  if (!best.length) {
    mount('best', emptyState('No clubs to rate', 'The data has no clubs in this division.'));
    return;
  }

  mount('best', `<div class="grid g-auto">${best.map((r, i) => bestCard(r, i)).join('')}</div>`
    + '<p class="sec-note" style="margin-top:11px">Ratings are modelled from results so far and '
    + 'the fixtures ahead. They are a guide to a strong option, not a forecast of one.</p>');
}

function bestCard(r, index) {
  const { club, rec, r3 } = r;
  const next = r3.rounds.find((x) => !x.blank);
  const first = next && next.matches[0];
  const opp = first && ctx.clubById[first.opponentId];
  return `<article class="pick">
    <p class="pick-role">${index === 0 ? 'Top club pick' : `#${index + 1}`}</p>
    <div class="pick-name">${esc(club.name)}</div>
    <div class="pick-meta">
      ${divisionBadge(club.division)}
      <span>${esc(ordinal(club.position))} · ${club.points} pts from ${club.played}</span>
    </div>
    <div class="pick-fix">
      ${first ? fdrCell(first.rating) : fdrCell(null)}
      <span>${first
    ? `${first.home ? 'v' : 'at'} <b>${esc(opp ? opp.name : '—')}</b>`
    : 'Blank round — no fixture'}</span>
      ${first ? `<span class="muted">${esc(fmtDay(first.kickoff))}</span>` : ''}
    </div>
    <p class="pick-why">${esc(rec.summary)}</p>
    <div class="pick-foot">
      <span>${formStrip(club.form)}</span>
      <span class="pick-score" title="Modelled club rating out of 100">${rec.score.toFixed(1)}</span>
    </div>
  </article>`;
}

/* ── Table ──────────────────────────────────────────────── */

const SORTS = {
  score: (r) => r.rec.score,
  form: (r) => r.club.last5.points,
  attack: (r) => r.club.last5.goalsFor,
  /* Fewer conceded is better, so this sorts on the negative — the label in
     the picker says "goals conceded" and the best answer comes first. */
  defence: (r) => -r.club.last5.goalsAgainst,
  cleanSheets: (r) => r.club.last5.cleanSheets,
  r3: (r) => r.r3.quality,
  r5: (r) => r.r5.quality,
  r6: (r) => r.r6.quality,
  position: (r) => -r.club.position
};

function render() {
  const list = rows.filter((r) => {
    if (state.division !== 'all' && r.club.division !== state.division) return false;
    if (state.search && !r.club.name.toLowerCase().includes(state.search)
      && !r.club.short.toLowerCase().includes(state.search)) return false;
    return true;
  }).sort((a, b) => SORTS[state.sort](b) - SORTS[state.sort](a)
    || b.rec.score - a.rec.score
    || a.club.name.localeCompare(b.club.name));

  const count = document.getElementById('result-count');
  count.textContent = list.length
    ? `${list.length} club${list.length === 1 ? '' : 's'} shown.`
    : 'No clubs match those filters.';

  if (!list.length) {
    mount('table', emptyState('Nothing matches those filters',
      'Try clearing the search box or setting the division back to all.'));
    return;
  }

  mount('table', `
    <div class="tscroll">
      <table class="stack-sm">
        <caption class="sr-only">Clubs compared on form, goals, clean sheets, home and away
          records and upcoming fixture difficulty. Fixture ratings run 1 (most favourable) to
          5 (toughest).</caption>
        <thead>
          <tr>
            <th scope="col">Club</th>
            <th scope="col">Last 5</th>
            <th scope="col" class="num">GF</th>
            <th scope="col" class="num">GA</th>
            <th scope="col" class="num">CS</th>
            <th scope="col">Home</th>
            <th scope="col">Away</th>
            <th scope="col">Next</th>
            <th scope="col" class="num">N3</th>
            <th scope="col" class="num">N5</th>
            <th scope="col" class="num">N6</th>
            <th scope="col" class="num">Rating</th>
          </tr>
        </thead>
        <tbody>${list.map(row).join('')}</tbody>
      </table>
    </div>
    <p class="sec-note" style="margin-top:9px">GF, GA and CS are goals scored, goals conceded and
      clean sheets over the club's last five league matches. N3, N5 and N6 are the mean fixture
      difficulty of the next three, five and six rounds — lower is friendlier.</p>`);
}

function row(r) {
  const { club, rec, r3, r5, r6 } = r;
  const next = r3.rounds.find((x) => !x.blank);
  const first = next && next.matches[0];
  const opp = first && ctx.clubById[first.opponentId];
  const notes = [];
  if (r6.doubles) notes.push(`${r6.doubles} double`);
  if (r6.blanks) notes.push(`${r6.blanks} blank`);
  return `<tr>
    <td data-label="Club">
      <span class="t-name">${esc(club.name)}</span>
      <span class="t-sub">${esc(DIVISION_LABELS[club.division])} · ${esc(ordinal(club.position))} ·
        ${club.points} pts${notes.length ? ` · ${esc(notes.join(', '))}` : ''}</span>
    </td>
    <td data-label="Last 5">${formStrip(club.form)}</td>
    <td class="num" data-label="Goals for (last 5)">${club.last5.goalsFor}</td>
    <td class="num" data-label="Goals against (last 5)">${club.last5.goalsAgainst}</td>
    <td class="num" data-label="Clean sheets (last 5)">${club.last5.cleanSheets}</td>
    <td data-label="Home record">${splitText(club.home)}</td>
    <td data-label="Away record">${splitText(club.away)}</td>
    <td data-label="Next fixture">${first
    ? `${fdrCell(first.rating)} <span class="t-sub">${first.home ? 'v' : 'at'}
        ${esc(opp ? opp.short : '???')} · ${esc(fmtDay(first.kickoff))}</span>`
    : `${fdrCell(null)} <span class="t-sub">Blank round</span>`}</td>
    <td class="num" data-label="Next 3">${r3.meanRating.toFixed(1)}</td>
    <td class="num" data-label="Next 5">${r5.meanRating.toFixed(1)}</td>
    <td class="num" data-label="Next 6">${r6.meanRating.toFixed(1)}</td>
    <td class="num" data-label="Modelled rating"><b>${rec.score.toFixed(1)}</b>
      <span class="t-sub">${esc(rec.summary)}</span></td>
  </tr>`;
}

function splitText(split) {
  const gd = split.goalsFor - split.goalsAgainst;
  return `<span class="mono">${split.won}-${split.drawn}-${split.lost}</span>`
    + `<span class="t-sub">${split.goalsFor}:${split.goalsAgainst} (${gd >= 0 ? '+' : ''}${gd})</span>`;
}
