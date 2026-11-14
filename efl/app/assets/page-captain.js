/* Fantasy EFL — captain comparison.

   Two players side by side on the modelled low, middle and high captain
   returns from stats.js. Defaults to the model's captain and the next best
   in its seven, and ?a=<id>&b=<id> deep-links any pair. */

import { loadSnapshot } from './provider.js';
import { buildContext, playerScore, buildSquad, POSITION_NAMES } from './model.js';
import { buildFlags, isWarning } from './availability.js';
import { captainRange, playerRates, divisionPercentiles, percentileWords } from './stats.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, fdrCell, homeAwayBadge, fmtDay,
  flagBadge, flagDetail, DIVISION_LABELS
} from './ui.js';

initTheme();

let ctx = null;
let flags = null;
let pct = null;
const chosen = { a: null, b: null };

start();

async function start() {
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    ctx = buildContext(snapshot);
    flags = buildFlags(ctx, { feedCheckedAt: snapshot.source && snapshot.source.generatedAt });
    pct = divisionPercentiles(ctx.players, (p) => playerRates(p).perApp);
    const scored = ctx.players.map((p) => playerScore(ctx, p));
    const squad = buildSquad(ctx, { scored });
    const ranked = squad ? squad.picks.slice().sort((x, y) => y.score - x.score) : [];
    const byId = new Map(ctx.players.map((p) => [p.id, p]));
    let q = null;
    try { q = new URLSearchParams(window.location.search); } catch (_) { /* none */ }
    chosen.a = (q && byId.get(q.get('a'))) || (squad && squad.captain && squad.captain.player) || null;
    chosen.b = (q && byId.get(q.get('b'))) || (ranked.find((r) => !chosen.a || r.player.id !== chosen.a.id) || {}).player || null;
    setupSearch('a');
    setupSearch('b');
    render();
  } catch (err) {
    mount('cmp-body', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

function setupSearch(slot) {
  const input = document.getElementById(`cmp-${slot}`);
  input.disabled = false;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { mount(`cmp-${slot}-results`, ''); return; }
    const hits = ctx.players.filter((p) => {
      const club = ctx.clubById[p.clubId];
      return `${p.name} ${club ? club.name : ''}`.toLowerCase().includes(q);
    }).slice(0, 6);
    mount(`cmp-${slot}-results`, hits.map((p) => `<li><button type="button" class="btn btn-ghost btn-sm" data-id="${esc(p.id)}">
      ${esc(p.name)} · ${esc(ctx.clubById[p.clubId] ? ctx.clubById[p.clubId].short : '')} · ${esc(p.position)}</button></li>`).join('')
      || '<li class="sec-note">No player matches that.</li>');
    document.querySelectorAll(`#cmp-${slot}-results button`).forEach((b) => b.addEventListener('click', () => {
      chosen[slot] = ctx.players.find((p) => p.id === b.getAttribute('data-id'));
      input.value = '';
      mount(`cmp-${slot}-results`, '');
      render();
      try {
        const url = new URL(window.location.href);
        if (chosen.a) url.searchParams.set('a', chosen.a.id);
        if (chosen.b) url.searchParams.set('b', chosen.b.id);
        history.replaceState(null, '', url);
      } catch (_) { /* no history */ }
    }));
  });
}

function column(p, rangeOther) {
  if (!p) return '<div class="card"><p class="sec-note">Search for a player.</p></div>';
  const r = captainRange(ctx, p);
  const rates = playerRates(p);
  const club = ctx.clubById[p.clubId];
  const flag = flags.get(p.id);
  const fixtures = r.fixtures.length
    ? r.fixtures.map((f) => {
      const opp = ctx.clubById[f.opponentId];
      return `<span class="ck-fix">${fdrCell(f.rating)}${homeAwayBadge(f.home)}
        <span>${f.home ? 'v' : 'at'} <b>${esc(opp ? opp.short : '???')}</b></span>
        <span class="muted">${esc(fmtDay(f.kickoff))}</span></span>`;
    }).join('')
    : '<span class="ck-fix">' + fdrCell(null) + '<span>No game this round</span></span>';
  const better = (key) => (rangeOther && r.captain[key] > rangeOther.captain[key] ? ' cmp-better' : '');
  const p100 = pct.get(p.id);
  return `<article class="card cmp-col">
    <p class="t-name" style="font-size:var(--fs-md)">${esc(p.name)}</p>
    <p class="t-sub">${esc(POSITION_NAMES[p.position])} · ${esc(club ? club.name : '')} · ${esc(DIVISION_LABELS[p.division])}</p>
    <div style="margin:6px 0">${flagBadge(isWarning(flag) ? flag : null)}${isWarning(flag) ? flagDetail(flag) : ''}</div>
    <div style="display:grid;gap:4px;margin:8px 0">${fixtures}
      ${r.matches > 1 ? '<span class="t-sub"><b>Double round</b></span>' : ''}</div>
    <dl class="cmp-range">
      <div class="${better('low')}"><dt>Low</dt><dd>${r.captain.low.toFixed(1)}</dd></div>
      <div class="${better('mid')}"><dt>Middle</dt><dd>${r.captain.mid.toFixed(1)}</dd></div>
      <div class="${better('high')}"><dt>High</dt><dd>${r.captain.high.toFixed(1)}</dd></div>
    </dl>
    <p class="t-sub">Captain points, modelled. A good day for a ${esc(POSITION_NAMES[p.position].toLowerCase())}: ${esc(r.goodDay)}.</p>
    <ul class="cmp-facts">
      <li>Points per appearance: <b>${rates.perApp == null ? '–' : rates.perApp.toFixed(2)}</b>${p100 == null ? '' : ` <span class="t-sub">(${esc(percentileWords(p100))} of ${esc(DIVISION_LABELS[p.division])} ${esc(POSITION_NAMES[p.position].toLowerCase())}s)</span>`}</li>
      <li>Appearances: <b>${p.appearances}</b>, playing share <b>${Math.round(r.share * 100)}%</b></li>
      ${rates.defPerApp == null ? '' : `<li>Defensive actions per appearance: <b>${rates.defPerApp.toFixed(1)}</b></li>`}
    </ul>
  </article>`;
}

function render() {
  const ra = chosen.a ? captainRange(ctx, chosen.a) : null;
  const rb = chosen.b ? captainRange(ctx, chosen.b) : null;
  let verdict = '';
  if (ra && rb) {
    const gap = Math.round((ra.captain.mid - rb.captain.mid) * 10) / 10;
    const lead = gap >= 0 ? chosen.a : chosen.b;
    const other = gap >= 0 ? chosen.b : chosen.a;
    verdict = Math.abs(gap) < 1
      ? `<p class="note note-method" style="margin-bottom:12px">Close call: the modelled middle figures are within a point. Look at fixtures and team news.</p>`
      : `<p class="note note-method" style="margin-bottom:12px"><b>${esc(lead.name)}</b> rates ${Math.abs(gap).toFixed(1)} captain points above ${esc(other.name)} on the modelled middle figure.</p>`;
  }
  mount('cmp-body', `${verdict}<div class="cmp-grid">${column(chosen.a, rb)}${column(chosen.b, ra)}</div>`);
}
