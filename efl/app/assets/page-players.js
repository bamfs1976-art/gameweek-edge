/* Fantasy EFL — player finder.

   Roughly a thousand players in the sample dataset, and a real feed would
   not be much larger. That is small enough to score once on load and filter
   in memory, which is why there is no request per keystroke here: the whole
   dataset is already in the page, and the only cost of a filter is a
   re-render of at most one page of rows.

   Sorting and filtering both live in `state`, and every render is a pure
   function of it. Pagination is 25 rows, which keeps the DOM small on a
   phone without hiding the interesting tail behind an infinite scroll. */

import { loadSnapshot } from './provider.js';
import { buildContext, playerScore, differentialScore, POSITION_NAMES, ordinal } from './model.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, emptyState, fdrCell, fdrLegend,
  methodNote, divisionBadge, homeAwayBadge, availabilityBadge, meter, fmtDay, DIVISION_LABELS
} from './ui.js';

initTheme();

const PAGE_SIZE = 25;
const state = {
  search: '', division: 'all', position: 'all', club: 'all',
  availability: 'all', sort: 'score', page: 1
};
let ctx = null;
let rows = [];       // every player, scored once

start();

async function start() {
  mount('table', '<div role="status" aria-live="polite"><span class="sr-only">Loading players</span>'
    + '<div class="card">' + Array.from({ length: 8 }, () => '<div class="skel skel-line"></div>').join('')
    + '</div></div>');
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    const note = document.getElementById('data-note');
    if (note) note.textContent = `${snapshot.source.label} · round ${snapshot.currentRound} · `
      + `${snapshot.players.length} players.`;
    ctx = buildContext(snapshot);
    mount('legend', fdrLegend());
    mount('method', methodNote(
      'A player\'s modelled pick rating combines recent form (30%), starts and minutes (22%), '
      + 'goals, assists and clean sheets weighted by position (20%), the next fixture (20%) and '
      + 'home advantage (8%). Availability is then applied as a multiplier, so an injured player '
      + 'is not merely marked down — he drops out of contention.'));

    rows = ctx.players.map((p) => {
      const rec = playerScore(ctx, p);
      return {
        rec,
        player: p,
        club: ctx.clubById[p.clubId],
        differential: differentialScore(ctx, p),
        formPoints: p.last5.reduce((s, m) => s + m.points, 0),
        formApps: p.last5.filter((m) => m.minutes > 0).length
      };
    });

    setupFilters();
    render();
  } catch (err) {
    mount('table', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

/* ── Filters ────────────────────────────────────────────── */

function setupFilters() {
  document.getElementById('filters').hidden = false;
  fillClubs();

  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on('f-search', 'input', (e) => { state.search = e.target.value.trim().toLowerCase(); state.page = 1; render(); });
  on('f-division', 'change', (e) => {
    state.division = e.target.value; state.club = 'all'; state.page = 1; fillClubs(); render();
  });
  on('f-position', 'change', (e) => { state.position = e.target.value; state.page = 1; render(); });
  on('f-club', 'change', (e) => { state.club = e.target.value; state.page = 1; render(); });
  on('f-availability', 'change', (e) => { state.availability = e.target.value; state.page = 1; render(); });
  on('f-sort', 'change', (e) => { state.sort = e.target.value; state.page = 1; render(); });
  on('f-reset', 'click', () => {
    Object.assign(state, {
      search: '', division: 'all', position: 'all', club: 'all',
      availability: 'all', sort: 'score', page: 1
    });
    ['f-search', 'f-division', 'f-position', 'f-club', 'f-availability', 'f-sort']
      .forEach((id) => {
        const el = document.getElementById(id);
        el.value = id === 'f-search' ? '' : (id === 'f-sort' ? 'score' : 'all');
      });
    fillClubs();
    render();
  });
}

function fillClubs() {
  const sel = document.getElementById('f-club');
  const clubs = ctx.clubs
    .filter((c) => state.division === 'all' || c.division === state.division)
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="all">All clubs</option>'
    + clubs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  sel.value = state.club;
}

/* ── Filter + sort ──────────────────────────────────────── */

const SORTS = {
  score: (r) => r.rec.score,
  form: (r) => (r.formApps ? r.formPoints / r.formApps : -1),
  goals: (r) => r.player.goals,
  assists: (r) => r.player.assists,
  cleanSheets: (r) => r.player.cleanSheets,
  minutes: (r) => r.player.minutes,
  starts: (r) => r.player.starts,
  /* Fixture sorts ascending in difficulty — a rating of 1 is the best
     answer to "sort by fixture", so it is inverted here rather than making
     the user reason about direction. A blank round sorts last. */
  fixture: (r) => (r.rec.next ? 6 - r.rec.next.rating : -1),
  differential: (r) => r.differential.score
};

const SORT_LABELS = {
  score: 'modelled pick rating', form: 'form over the last five', goals: 'goals',
  assists: 'assists', cleanSheets: 'clean sheets', minutes: 'minutes', starts: 'starts',
  fixture: 'next fixture difficulty (easiest first)', differential: 'differential score'
};

function filtered() {
  const q = state.search;
  return rows.filter((r) => {
    const p = r.player;
    if (state.division !== 'all' && p.division !== state.division) return false;
    if (state.position !== 'all' && p.position !== state.position) return false;
    if (state.club !== 'all' && p.clubId !== state.club) return false;
    const status = p.availability.status;
    if (state.availability === 'available' && status !== 'available') return false;
    if (state.availability === 'risk' && status !== 'available' && status !== 'doubtful') return false;
    if (state.availability === 'out' && (status === 'available' || status === 'doubtful')) return false;
    if (q) {
      const hay = `${p.name} ${r.club ? r.club.name : ''} ${r.club ? r.club.short : ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => SORTS[state.sort](b) - SORTS[state.sort](a)
    || b.rec.score - a.rec.score
    || a.player.name.localeCompare(b.player.name));
}

/* ── Render ─────────────────────────────────────────────── */

function render() {
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (state.page > pages) state.page = pages;
  const slice = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  const count = document.getElementById('result-count');
  count.textContent = list.length
    ? `${list.length} player${list.length === 1 ? '' : 's'} match, sorted by ${SORT_LABELS[state.sort]}.`
    : 'No players match those filters.';

  if (!list.length) {
    mount('table', emptyState('Nothing matches those filters',
      'Try clearing the search box, widening the division, or setting availability back to any status.'));
    mount('pager', '');
    return;
  }

  mount('table', `
    <div class="tscroll">
      <table class="stack-sm">
        <caption class="sr-only">Players ranked by ${esc(SORT_LABELS[state.sort])}. Fixture
          difficulty runs 1 (most favourable) to 5 (toughest).</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Club</th>
            <th scope="col">Last 5</th>
            <th scope="col" class="num">Starts</th>
            <th scope="col" class="num">Mins</th>
            <th scope="col" class="num">G</th>
            <th scope="col" class="num">A</th>
            <th scope="col" class="num">CS</th>
            <th scope="col">Next</th>
            <th scope="col">Status</th>
            <th scope="col" class="num">Rating</th>
          </tr>
        </thead>
        <tbody>${slice.map(row).join('')}</tbody>
      </table>
    </div>`);

  mount('pager', pages > 1 ? `
    <div class="pager">
      <button type="button" id="prev" ${state.page === 1 ? 'disabled' : ''}>← Previous</button>
      <span class="pager-status" aria-live="polite">Page ${state.page} of ${pages}</span>
      <button type="button" id="next" ${state.page === pages ? 'disabled' : ''}>Next →</button>
    </div>` : '');

  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  if (prev) prev.addEventListener('click', () => { state.page -= 1; render(); scrollToTable(); });
  if (next) next.addEventListener('click', () => { state.page += 1; render(); scrollToTable(); });
}

function scrollToTable() {
  const el = document.getElementById('table');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
}

function row(r) {
  const p = r.player;
  const rec = r.rec;
  const club = r.club;
  const perApp = r.formApps ? r.formPoints / r.formApps : 0;
  /* The form meter is normalised against 12 points an appearance — a strong
     return in any fantasy game of this shape, and a fixed ceiling so the bar
     means the same thing on every row. */
  const formLabel = r.formApps
    ? `${r.formPoints} points from ${r.formApps} appearance${r.formApps === 1 ? '' : 's'} in the last five rounds`
    : 'No minutes in the last five rounds';
  const showCS = p.position === 'GK' || p.position === 'DEF';

  return `<tr>
    <td data-label="Player">
      <span class="t-name">${esc(p.name)}</span>
      <span class="t-sub">${esc(POSITION_NAMES[p.position])} · ${esc(DIVISION_LABELS[p.division])}</span>
    </td>
    <td data-label="Club">${esc(club ? club.name : '—')}
      <span class="t-sub">${club ? esc(ordinal(club.position)) : ''}</span></td>
    <td data-label="Last 5">${meter(Math.min(1, perApp / 12), r.formApps ? perApp.toFixed(1) : '—', formLabel)}</td>
    <td class="num" data-label="Starts">${p.starts}</td>
    <td class="num" data-label="Minutes">${p.minutes}</td>
    <td class="num" data-label="Goals">${p.goals}</td>
    <td class="num" data-label="Assists">${p.assists}</td>
    <td class="num" data-label="Clean sheets">${showCS ? p.cleanSheets : '<span class="muted">—</span>'}</td>
    <td data-label="Next fixture">${nextCell(rec.next)}</td>
    <td data-label="Status">${availabilityBadge(p.availability)}
      ${r.differential.score >= 55 ? `<span class="t-sub" title="${esc(r.differential.note)}">${esc(r.differential.label)} ${r.differential.score.toFixed(0)}</span>` : ''}</td>
    <td class="num" data-label="Modelled rating"><b>${rec.score.toFixed(1)}</b>
      <span class="t-sub">${esc(rec.summary)}</span></td>
  </tr>`;
}

function nextCell(next) {
  if (!next) return `${fdrCell(null)} <span class="t-sub">No fixture</span>`;
  const opp = ctx.clubById[next.opponentId];
  return `<span style="display:inline-flex;align-items:center;gap:5px">${fdrCell(next.rating)}
    ${homeAwayBadge(next.home)}</span>
    <span class="t-sub">${esc(opp ? opp.short : '???')} · ${esc(fmtDay(next.kickoff))}</span>`;
}
