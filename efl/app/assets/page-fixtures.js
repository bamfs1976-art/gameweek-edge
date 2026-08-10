/* Fantasy EFL — fixture ticker and planner.

   The ticker is a club-per-row grid because that is the shape of the
   question: "who has a good run", not "what is on this Saturday". Filtering
   is client-side over an already-loaded snapshot — 72 clubs and a few
   hundred fixtures is small, and a round trip per filter change would make
   the page feel worse for no benefit. */

import { loadSnapshot } from './provider.js';
import { buildContext, fixtureRun, runSummary, ordinal } from './model.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, emptyState, fdrCell, fdrLegend,
  methodNote, divisionBadge, fmtDay, DIVISION_LABELS
} from './ui.js';

initTheme();

const state = { division: 'all', club: 'all', fromRound: null, window: 6 };
let ctx = null;

start();

async function start() {
  mount('ticker', '<div role="status" aria-live="polite"><span class="sr-only">Loading fixtures</span>'
    + '<div class="card"><div class="skel skel-line"></div><div class="skel skel-line"></div>'
    + '<div class="skel skel-line"></div><div class="skel skel-line"></div>'
    + '<div class="skel skel-line"></div></div></div>');
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    const note = document.getElementById('data-note');
    if (note) note.textContent = `${snapshot.source.label} · round ${snapshot.currentRound}.`;
    ctx = buildContext(snapshot);
    state.fromRound = ctx.currentRound;
    mount('legend', fdrLegend());
    mount('method', methodNote(
      'Congestion is flagged where a club plays twice inside four days or more than once in a '
      + 'round. Rearranged matches are marked where the data carries them.'));
    setupFilters();
    render();
  } catch (err) {
    mount('ticker', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

/* ── Filters ────────────────────────────────────────────── */

function setupFilters() {
  const form = document.getElementById('filters');
  form.hidden = false;

  const roundSel = document.getElementById('f-round');
  const maxRound = ctx.fixtures.reduce((m, f) => Math.max(m, f.round), ctx.currentRound);
  for (let r = ctx.currentRound; r <= maxRound; r += 1) {
    const opt = document.createElement('option');
    opt.value = String(r);
    opt.textContent = `Round ${r}${r === ctx.currentRound ? ' (current)' : ''}`;
    roundSel.appendChild(opt);
  }
  roundSel.value = String(ctx.currentRound);

  fillClubs();

  document.getElementById('f-division').addEventListener('change', (e) => {
    state.division = e.target.value;
    state.club = 'all';
    fillClubs();
    render();
  });
  document.getElementById('f-club').addEventListener('change', (e) => {
    state.club = e.target.value;
    render();
  });
  roundSel.addEventListener('change', (e) => {
    state.fromRound = Number(e.target.value);
    render();
  });
  document.getElementById('f-window').addEventListener('change', (e) => {
    state.window = Number(e.target.value);
    render();
  });
  document.getElementById('f-reset').addEventListener('click', () => {
    state.division = 'all'; state.club = 'all';
    state.fromRound = ctx.currentRound; state.window = 6;
    document.getElementById('f-division').value = 'all';
    document.getElementById('f-round').value = String(ctx.currentRound);
    document.getElementById('f-window').value = '6';
    fillClubs();
    render();
  });
}

function fillClubs() {
  const sel = document.getElementById('f-club');
  const clubs = ctx.clubs
    .filter((c) => state.division === 'all' || c.division === state.division)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="all">All clubs</option>'
    + clubs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  sel.value = state.club;
}

/* ── Ticker ─────────────────────────────────────────────── */

function visibleClubs() {
  return ctx.clubs.filter((c) =>
    (state.division === 'all' || c.division === state.division)
    && (state.club === 'all' || c.id === state.club));
}

/* The model's fixtureRun() always starts at the current round; the ticker
   lets you scroll forward, so it re-slices from the chosen start. */
function runFrom(clubId, from, n) {
  const offset = from - ctx.currentRound;
  return fixtureRun(ctx, clubId, offset + n).slice(offset);
}

function render() {
  const clubs = visibleClubs();
  if (!clubs.length) {
    mount('ticker', emptyState('No clubs match those filters',
      'Try widening the division filter or resetting.'));
    mount('runs', '');
    return;
  }

  const rounds = [];
  for (let i = 0; i < state.window; i += 1) rounds.push(state.fromRound + i);

  const rows = clubs.map((club) => {
    const run = runFrom(club.id, state.fromRound, state.window);
    const flags = congestion(run);
    const played = run.flatMap((r) => r.matches);
    const mean = played.length
      ? 1 + (played.reduce((s, m) => s + m.difficulty, 0) / played.length) * 4 : null;
    const cells = run.map((r) => cell(r)).join('');
    return `<tr>
      <td data-label="Club">
        <span class="t-name">${esc(club.name)}</span>
        <span class="t-sub">${esc(DIVISION_LABELS[club.division])} · ${esc(ordinal(club.position))}${flags ? ` · ${esc(flags)}` : ''}</span>
      </td>
      ${cells}
      <td class="num" data-label="Average difficulty">${mean == null ? '—' : mean.toFixed(1)}</td>
    </tr>`;
  }).join('');

  mount('ticker', `
    <div class="tscroll">
      <table class="stack-sm">
        <caption class="sr-only">Fixture difficulty for rounds ${rounds[0]} to
          ${rounds[rounds.length - 1]}. Each cell gives the opponent, home or away, and a
          difficulty rating from 1 (most favourable) to 5 (toughest).</caption>
        <thead>
          <tr>
            <th scope="col">Club</th>
            ${rounds.map((r) => `<th scope="col">R${r}</th>`).join('')}
            <th scope="col" class="num">Avg</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="sec-note" style="margin-top:9px">${clubs.length} club${clubs.length === 1 ? '' : 's'}
      shown, rounds ${rounds[0]}–${rounds[rounds.length - 1]}. Lower average is a friendlier run.</p>`);

  renderRuns();
}

function cell(round) {
  if (round.blank) {
    return `<td data-label="Round ${round.round}">${fdrCell(null)}
      <span class="t-sub">Blank round</span></td>`;
  }
  const inner = round.matches.map((m) => {
    const opp = ctx.clubById[m.opponentId];
    return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:6px">
      ${fdrCell(m.rating)}
      <span class="t-sub" style="margin:0">${esc(opp ? opp.short : '???')}
        (${m.home ? 'H' : 'A'})</span></span>`;
  }).join('');
  const flag = round.double
    ? '<span class="t-sub"><b>Double round</b></span>'
    : (round.matches.some((m) => m.postponed) ? '<span class="t-sub">Rearranged</span>' : '');
  return `<td data-label="Round ${round.round}">${inner}${flag}</td>`;
}

/** Short turnarounds and doubles — the two things that change whether a
 *  player is likely to start, rather than how hard the match is. */
function congestion(run) {
  const kickoffs = run.flatMap((r) => r.matches.map((m) => new Date(m.kickoff).getTime()))
    .filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const doubles = run.filter((r) => r.double).length;
  const blanks = run.filter((r) => r.blank).length;
  let tight = 0;
  for (let i = 1; i < kickoffs.length; i += 1) {
    if (kickoffs[i] - kickoffs[i - 1] <= 4 * 86400000) tight += 1;
  }
  const parts = [];
  if (doubles) parts.push(`${doubles} double`);
  if (blanks) parts.push(`${blanks} blank`);
  if (tight) parts.push(`${tight} short turnaround${tight === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/* ── Best upcoming runs ─────────────────────────────────── */

function renderRuns() {
  const clubs = ctx.clubs.filter((c) => state.division === 'all' || c.division === state.division);
  const rows = clubs.map((club) => ({
    club,
    r3: runSummary(ctx, club.id, 3),
    r5: runSummary(ctx, club.id, 5),
    r6: runSummary(ctx, club.id, 6)
  })).sort((a, b) => b.r6.quality - a.r6.quality).slice(0, 12);

  if (!rows.length) { mount('runs', ''); return; }

  mount('runs', `
    <div class="tscroll">
      <table class="stack-sm">
        <caption class="sr-only">The twelve clubs with the most favourable fixture runs,
          measured over the next three, five and six rounds from the current one.</caption>
        <thead>
          <tr>
            <th scope="col">Club</th>
            <th scope="col">Division</th>
            <th scope="col" class="num">Next 3</th>
            <th scope="col" class="num">Next 5</th>
            <th scope="col" class="num">Next 6</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>${rows.map(runRow).join('')}</tbody>
      </table>
    </div>
    <p class="sec-note" style="margin-top:9px">Ratings are the mean difficulty across every match
      in the window, on the same 1-5 scale as the ticker. Measured from round
      ${ctx.currentRound} regardless of the ticker's start round, so the ranking always answers
      "who has the best run from here".</p>`);
}

function runRow({ club, r3, r5, r6 }) {
  const notes = [];
  if (r6.doubles) notes.push(`${r6.doubles} double round${r6.doubles === 1 ? '' : 's'}`);
  if (r6.blanks) notes.push(`${r6.blanks} blank round${r6.blanks === 1 ? '' : 's'}`);
  const next = r3.rounds.find((r) => !r.blank);
  const first = next && next.matches[0];
  return `<tr>
    <td data-label="Club"><span class="t-name">${esc(club.name)}</span>
      <span class="t-sub">${esc(ordinal(club.position))} · ${club.points} pts${first
    ? ` · next ${first.home ? 'v' : 'at'} ${esc((ctx.clubById[first.opponentId] || {}).short || '???')} ${esc(fmtDay(first.kickoff))}` : ''}</span></td>
    <td data-label="Division">${divisionBadge(club.division)}</td>
    <td class="num" data-label="Next 3">${r3.meanRating.toFixed(1)}</td>
    <td class="num" data-label="Next 5">${r5.meanRating.toFixed(1)}</td>
    <td class="num" data-label="Next 6">${r6.meanRating.toFixed(1)}</td>
    <td data-label="Notes">${notes.length ? esc(notes.join(', ')) : '<span class="muted">—</span>'}</td>
  </tr>`;
}

