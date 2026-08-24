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
import { buildContext, playerScore, differentialScore, POSITION_NAMES, ordinal, PLAYER_WEIGHTS } from './model.js';
import { POSITION_COLUMNS, TARIFF, statPoints } from './tariff.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, emptyState, fdrCell, fdrLegend,
  methodNote, divisionBadge, homeAwayBadge, availabilityBadge, meter, statCell, fmtDay,
  suspensionBadge, DIVISION_LABELS
} from './ui.js';

initTheme();

const PAGE_SIZE = 25;
const pc = (key) => `${Math.round(PLAYER_WEIGHTS[key] * 100)}%`;
const state = {
  search: '', division: 'all', position: 'all', club: 'all',
  availability: 'all', banRisk: 'all', sort: 'score', page: 1
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
      `A player's modelled pick rating combines starts and minutes (${pc('minutes')}), recent `
      + `form (${pc('form')}), the tariff value of his output (${pc('output')}), the next fixture `
      + `(${pc('fixture')}) and home advantage (${pc('home')}) — then scales the fixture and home `
      + 'weights by position, because a goalkeeper barely notices where he is playing and a '
      + 'forward notices a lot. Availability is applied as a multiplier, so an injured player '
      + 'is not merely marked down; he drops out of contention. The weights are set from '
      + 'measured correlations on 83,698 real Fantasy EFL appearances rather than picked by '
      + 'feel — see the guide for the numbers.'));

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
  on('f-ban', 'change', (e) => { state.banRisk = e.target.value; state.page = 1; render(); });
  on('f-sort', 'change', (e) => { state.sort = e.target.value; state.page = 1; render(); });
  on('f-reset', 'click', () => {
    Object.assign(state, {
      search: '', division: 'all', position: 'all', club: 'all',
      availability: 'all', banRisk: 'all', sort: 'score', page: 1
    });
    ['f-search', 'f-division', 'f-position', 'f-club', 'f-availability', 'f-ban', 'f-sort']
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
  differential: (r) => r.differential.score,
  /* Most bookings first — the players a manager is most likely to lose. */
  bookings: (r) => (r.player.stats && r.player.stats.yellowCards != null
    ? r.player.stats.yellowCards : -1)
};

const SORT_LABELS = {
  score: 'modelled pick rating', form: 'form over the last five', goals: 'goals',
  assists: 'assists', cleanSheets: 'clean sheets', minutes: 'minutes', starts: 'starts',
  fixture: 'next fixture difficulty (easiest first)', differential: 'differential score',
  bookings: 'yellow cards, most first'
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
    /* Ban risk is a separate axis from availability on purpose: a player one
       booking away is available THIS round and may not be next. */
    if (state.banRisk === 'safe' && r.rec.suspension.level === 'onEdge') return false;
    if (state.banRisk === 'edge' && r.rec.suspension.level !== 'onEdge') return false;
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

  const columns = activeColumns();
  mount('table', `
    <div class="tscroll">
      <table class="stack-sm">
        <caption class="sr-only">Players ranked by ${esc(SORT_LABELS[state.sort])}. Each stat
          shows what it was worth in Fantasy EFL points in brackets. Fixture difficulty runs
          1 (most favourable) to 5 (toughest).</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Club</th>
            <th scope="col">Last 5</th>
            <th scope="col" class="num">Starts</th>
            ${columns.map((key) => `<th scope="col" class="num" title="${esc(columnTitle(key))}">`
    + `${esc(TARIFF[key].short)}</th>`).join('')}
            <th scope="col">Next</th>
            <th scope="col">Status</th>
            <th scope="col" class="num">Rating</th>
          </tr>
        </thead>
        <tbody>${slice.map((r) => row(r, columns)).join('')}</tbody>
      </table>
    </div>
    <p class="sec-note" style="margin-top:9px">${state.position === 'all'
    ? 'Showing the stats every position is paid for. <b>Filter to a single position</b> to see '
      + 'what that position actually scores from — a defender\'s clearances, blocks and tackles, '
      + 'or a midfielder\'s interceptions.'
    : `Showing the stats a ${esc(POSITION_NAMES[state.position].toLowerCase())} is paid for. `
      + 'The bracket after each number is what it was worth in points.'}</p>`);

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

/* ── Position-aware columns ─────────────────────────────
   A defender is paid for clearances, blocks and tackles; a midfielder for
   interceptions; a forward for neither. Showing every column to every row
   makes a forty-column table in which most cells mean "not applicable" and
   look exactly like "none".

   So the column set follows the position filter. With no filter, only the
   stats every position is paid for are shown — because a column that means
   "zero" on one row and "not applicable" on the next is worse than no
   column at all. */
function activeColumns() {
  return POSITION_COLUMNS[state.position] || POSITION_COLUMNS.ALL;
}

function columnTitle(key) {
  const rule = TARIFF[key];
  return rule ? `${rule.label} — ${rule.describe}` : key;
}

/** The raw season value behind a tariff key, or null where unpublished. */
function statValue(p, key) {
  if (key === 'minutes') return p.minutes;
  if (key === 'goals') return p.goals;
  if (key === 'assists') return p.assists;
  if (key === 'cleanSheets') return p.cleanSheets;
  return p.stats ? p.stats[key] : null;
}

/**
 * Minutes are the one stat whose season total cannot be run through the
 * tariff directly: the rule is per appearance (under 60 pays 1, 60+ pays 2),
 * so 2,700 minutes is not "one appearance worth 2". Appearance points are
 * counted from starts and substitute outings instead.
 */
function minutesCell(p) {
  const appearancePoints = p.starts * 2 + Math.max(0, p.appearances - p.starts);
  if (!p.minutes) return '<span class="mono">0</span>';
  const title = `${p.minutes} minutes across ${p.appearances} appearance`
    + `${p.appearances === 1 ? '' : 's'} — ${appearancePoints} appearance points `
    + '(60 minutes or more pays 2, less pays 1)';
  return `<span class="mono" title="${esc(title)}">${p.minutes} `
    + `<span class="attr-pos" aria-label="worth plus ${appearancePoints} appearance points">`
    + `(+${appearancePoints})</span></span>`;
}

function row(r, columns) {
  const p = r.player;
  const rec = r.rec;
  const club = r.club;
  const perApp = r.formApps ? r.formPoints / r.formApps : 0;
  /* The form meter is normalised against 12 points an appearance — a strong
     return in any fantasy game of this shape, and a fixed ceiling so the bar
     means the same thing on every row. */
  const formLabel = r.formApps
    ? `${r.formPoints} points from ${r.formApps} appearance${r.formApps === 1 ? '' : 's'} in the last five rounds`
    : 'No per-match history published for this player';

  const statCells = columns.map((key) => {
    const label = TARIFF[key].label;
    const inner = key === 'minutes'
      ? minutesCell(p)
      : statCell(key, statValue(p, key), p.position);
    return `<td class="num" data-label="${esc(label)}">${inner}</td>`;
  }).join('');

  return `<tr>
    <td data-label="Player">
      <span class="t-name">${esc(p.name)}</span>
      <span class="t-sub">${esc(POSITION_NAMES[p.position])} · ${esc(DIVISION_LABELS[p.division])}</span>
    </td>
    <td data-label="Club">${esc(club ? club.name : '—')}
      <span class="t-sub">${club ? esc(ordinal(club.position)) : ''}</span></td>
    <td data-label="Last 5">${meter(Math.min(1, perApp / 12), r.formApps ? perApp.toFixed(1) : '—', formLabel)}</td>
    <td class="num" data-label="Starts">${p.starts}</td>
    ${statCells}
    <td data-label="Next fixture">${nextCell(rec.next, rec.fixtures)}</td>
    <td data-label="Status">${availabilityBadge(p.availability)}${suspensionBadge(rec.suspension)}
      ${r.differential.score >= 55 ? `<span class="t-sub" title="${esc(r.differential.note)}">${esc(r.differential.label)} ${r.differential.score.toFixed(0)}</span>` : ''}</td>
    <td class="num" data-label="Modelled rating"><b>${rec.score.toFixed(1)}</b>
      <span class="t-sub">${esc(rec.summary)}</span></td>
  </tr>`;
}

/* Every match in the round, not just the first. A double is the reason to
   pick a player at all that week, and a column showing one of his two
   fixtures reads as though he has one. */
function nextCell(next, fixtures) {
  const list = (fixtures && fixtures.length) ? fixtures : (next ? [next] : []);
  if (!list.length) return `${fdrCell(null)} <span class="t-sub">No fixture</span>`;
  const one = (f) => {
    const opp = ctx.clubById[f.opponentId];
    return `<span style="display:inline-flex;align-items:center;gap:5px">${fdrCell(f.rating)}
      ${homeAwayBadge(f.home)}</span>
      <span class="t-sub">${esc(opp ? opp.short : '???')} · ${esc(fmtDay(f.kickoff))}</span>`;
  };
  if (list.length === 1) return one(list[0]);
  return `<span class="t-sub"><b>Double round</b></span><br>${list.map(one).join('<br>')}`;
}
