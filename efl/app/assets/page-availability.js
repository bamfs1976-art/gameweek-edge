/* Fantasy EFL — the availability hub.

   One list, grouped by club, most serious flag first. Clubs with nothing
   flagged are still named, in one line at the end, because "no reported
   issues" is the answer a manager came to check for most of the 72. */

import { loadSnapshot } from './provider.js';
import { buildContext, POSITION_NAMES } from './model.js';
import { buildFlags, FLAG_RANK, FLAG_LABELS, ago } from './availability.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, emptyState, divisionBadge,
  flagBadge, flagDetail, DIVISION_LABELS
} from './ui.js';

initTheme();

const DIVISIONS = ['championship', 'league-one', 'league-two'];
const DEFAULTS = { search: '', division: 'all', club: 'all', status: 'all' };
const state = { ...DEFAULTS };
let ctx = null;
let flags = null;
let meta = null;
let feedAt = null;

start();

async function start() {
  mount('list', '<div role="status" aria-live="polite"><span class="sr-only">Loading availability</span>'
    + '<div class="card">' + Array.from({ length: 6 }, () => '<div class="skel skel-line"></div>').join('')
    + '</div></div>');
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    ctx = buildContext(snapshot);
    meta = snapshot.availability || { loaded: false };
    feedAt = snapshot.source && snapshot.source.generatedAt;
    flags = buildFlags(ctx, { feedCheckedAt: feedAt });
    const note = document.getElementById('data-note');
    if (note) note.textContent = `${snapshot.source.label} · round ${snapshot.currentRound} · `
      + `${flags.size} players flagged across ${ctx.clubs.length} clubs.`;
    readUrl();
    setupFilters();
    render();
  } catch (err) {
    mount('list', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

/* ?club=<id> and ?division=<id> deep-link from a club page or a share. */
function readUrl() {
  try {
    const q = new URLSearchParams(window.location.search);
    const div = q.get('division');
    if (DIVISIONS.includes(div)) state.division = div;
    const club = q.get('club');
    if (club && ctx.clubById[club]) {
      state.club = club;
      state.division = ctx.clubById[club].division;
    }
  } catch (_) { /* no location */ }
}

function setupFilters() {
  document.getElementById('filters').hidden = false;
  document.getElementById('f-division').value = state.division;
  fillClubs();
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on('f-search', 'input', (e) => { state.search = e.target.value.trim().toLowerCase(); render(); });
  on('f-division', 'change', (e) => { state.division = e.target.value; state.club = 'all'; fillClubs(); render(); });
  on('f-club', 'change', (e) => { state.club = e.target.value; render(); });
  on('f-status', 'change', (e) => { state.status = e.target.value; render(); });
  on('f-reset', 'click', () => {
    Object.assign(state, DEFAULTS);
    document.getElementById('f-search').value = '';
    document.getElementById('f-division').value = 'all';
    document.getElementById('f-status').value = 'all';
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

function statusMatches(flag) {
  if (state.status === 'all') return true;
  if (state.status === 'news') return flag.status === 'out' || flag.status === 'doubt' || flag.status === 'suspended';
  return flag.status === state.status;
}

function render() {
  renderSummary();
  const q = state.search;
  const clubs = ctx.clubs
    .filter((c) => state.division === 'all' || c.division === state.division)
    .filter((c) => state.club === 'all' || c.id === state.club)
    .slice()
    .sort((a, b) => DIVISIONS.indexOf(a.division) - DIVISIONS.indexOf(b.division) || a.name.localeCompare(b.name));

  const groups = [];
  const clean = [];
  let total = 0;
  for (const club of clubs) {
    const players = (ctx.playersByClub[club.id] || [])
      .map((p) => ({ p, f: flags.get(p.id) }))
      .filter(({ f }) => f && statusMatches(f))
      .filter(({ p }) => !q || `${p.name} ${club.name} ${club.short}`.toLowerCase().includes(q))
      .sort((a, b) => FLAG_RANK[b.f.status] - FLAG_RANK[a.f.status] || a.p.name.localeCompare(b.p.name));
    if (players.length) { groups.push({ club, players }); total += players.length; }
    else if (!q) clean.push(club);
  }

  document.getElementById('result-count').textContent = total
    ? `${total} flagged player${total === 1 ? '' : 's'} at ${groups.length} club${groups.length === 1 ? '' : 's'}.`
    : 'No flagged players match those filters.';

  if (!groups.length) {
    const single = state.club !== 'all' && ctx.clubById[state.club];
    mount('list', emptyState(single ? `No reported issues for ${single.name}` : 'Nothing flagged',
      `Feed read ${ago(feedAt)}. ${state.status === 'all' ? '' : 'Try setting status back to all flags. '}`
      + 'A club with no flag can still name a surprise team, so check the club\'s own news before the deadline.'));
    return;
  }

  const cards = groups.map(({ club, players }) => `
    <article class="card av-club">
      <div class="sec-head" style="margin-bottom:9px">
        <h2 class="sec-title">${esc(club.name)}</h2>
        <span>${divisionBadge(club.division)}</span>
      </div>
      <ul class="av-list">${players.map(({ p, f }) => `
        <li class="av-item">
          <div>
            <span class="t-name">${esc(p.name)}</span>
            <span class="t-sub">${esc(POSITION_NAMES[p.position])}</span>
            ${flagDetail(f)}
          </div>
          <div>${flagBadge(f)}</div>
        </li>`).join('')}
      </ul>
    </article>`).join('');

  const cleanLine = clean.length && state.status === 'all'
    ? `<div class="card" style="margin-top:4px"><p class="av-clean"><b>No flags (${clean.length}):</b>
        ${clean.map((c) => esc(c.name)).join(', ')}. Feed read ${esc(ago(feedAt))}.</p></div>`
    : '';
  mount('list', cards + cleanLine);
}

function renderSummary() {
  const counts = { out: 0, doubt: 0, suspended: 0, rotation: 0, fit: 0 };
  const inScope = (p) => (state.division === 'all' || p.division === state.division)
    && (state.club === 'all' || p.clubId === state.club);
  for (const p of ctx.players) {
    const f = flags.get(p.id);
    if (f && inScope(p)) counts[f.status] += 1;
  }
  const parts = ['out', 'doubt', 'suspended', 'rotation']
    .map((k) => `<span>${esc(FLAG_LABELS[k])} <b>${counts[k]}</b></span>`);
  if (counts.fit) parts.push(`<span>${esc(FLAG_LABELS.fit)} <b>${counts.fit}</b></span>`);
  const manual = meta && meta.loaded
    ? `<span>Team news entries in force <b>${meta.active}</b>${meta.updatedAt ? `, last edited ${esc(ago(meta.updatedAt))}` : ''}</span>`
    : '<span>Team news file not loaded, so these flags come from the feed and the model only</span>';
  const scope = state.club !== 'all' && ctx.clubById[state.club]
    ? ctx.clubById[state.club].name
    : state.division === 'all' ? 'All three divisions' : DIVISION_LABELS[state.division];
  mount('summary', `<p class="av-summary"><span><b>${esc(scope)}</b></span>${parts.join('')}</p>
    <p class="av-summary">${manual}<span>Feed read <b>${esc(ago(feedAt))}</b></span></p>`);
}
