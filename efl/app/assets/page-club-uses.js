/* Fantasy EFL — club uses tracker.

   The log is the user's, kept in this browser. The ratings are the
   model's, from the same clubScore() and fixture ratings the club picker
   and the fixture ticker show. This page joins the two. */

import { loadSnapshot } from './provider.js';
import { buildContext, roundPicks } from './model.js';
import {
  clubPlan, checkModelClub, readLog, writeLog, setRound, usageCounts, seasonFor,
  CLUB_SEASON_USES, NOW_WINDOW
} from './clubs.js';
import { esc, mount, initTheme, sourceBanner, errorState, DIVISION_LABELS } from './ui.js';

initTheme();

const DIVISIONS = ['championship', 'league-one', 'league-two'];
let ctx = null;
let log = null;
let season = null;
let known = null;
let divisionFilter = 'all';

start();

async function start() {
  mount('plan-body', '<div class="skel skel-line"></div><div class="skel skel-line"></div>');
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    ctx = buildContext(snapshot);
    season = seasonFor();
    known = new Set(ctx.clubs.map((c) => c.id));
    log = readLog(storage(), season, known);
    setupForm();
    document.getElementById('all-division').addEventListener('change', (e) => { divisionFilter = e.target.value; renderAll(); });
    renderEverything();
  } catch (err) {
    mount('plan-body', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

function storage() {
  try { return window.localStorage; } catch (_) { return null; }
}

const nameOf = (id) => (ctx.clubById[id] ? ctx.clubById[id].name : 'Unknown club');

/* ── Log form ────────────────────────────────────────────── */

function setupForm() {
  const form = document.getElementById('log-form');
  form.hidden = false;
  const roundSel = document.getElementById('log-round');
  const last = Math.max(ctx.currentRound, ...Object.keys(log.rounds).map(Number));
  const opts = [];
  for (let r = last; r >= 1; r -= 1) {
    opts.push(`<option value="${r}">Round ${r}${r === ctx.currentRound ? ' (this round)' : ''}</option>`);
  }
  roundSel.innerHTML = opts.join('');
  roundSel.value = String(ctx.currentRound);
  roundSel.addEventListener('change', fillClubSelects);
  fillClubSelects();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const round = Number(roundSel.value);
    const ids = ['log-club-1', 'log-club-2'].map((id) => document.getElementById(id).value).filter(Boolean);
    const names = Object.fromEntries(ctx.clubs.map((c) => [c.id, c.name]));
    const res = setRound(log, round, ids, names);
    const msg = document.getElementById('log-msg');
    if (res.error) { msg.textContent = res.error; return; }
    log = res.log;
    const saved = writeLog(storage(), log);
    msg.textContent = (ids.length
      ? `Saved round ${round}: ${ids.map(nameOf).join(' and ')}.`
      : `Cleared round ${round}.`)
      + (saved ? '' : ' This browser is not saving (private mode?), so the log will not survive a reload.');
    renderEverything();
  });
}

/* Two selects, clubs grouped by division, each showing uses left. A club
   with none left stays visible but cannot be chosen. */
function fillClubSelects() {
  const round = Number(document.getElementById('log-round').value);
  const current = log.rounds[String(round)] || [];
  const without = { ...log, rounds: { ...log.rounds } };
  delete without.rounds[String(round)];
  const counts = usageCounts(without);
  ['log-club-1', 'log-club-2'].forEach((id, i) => {
    const sel = document.getElementById(id);
    const groups = DIVISIONS.map((div) => {
      const clubs = ctx.clubs.filter((c) => c.division === div).sort((a, b) => a.name.localeCompare(b.name));
      return `<optgroup label="${esc(DIVISION_LABELS[div])}">${clubs.map((c) => {
        const left = CLUB_SEASON_USES - (counts[c.id] || 0);
        const chosen = current[i] === c.id;
        return `<option value="${esc(c.id)}"${chosen ? ' selected' : ''}${left <= 0 && !chosen ? ' disabled' : ''}>`
          + `${esc(c.name)} (${left <= 0 ? 'no uses left' : `${left} left`})</option>`;
      }).join('')}</optgroup>`;
    }).join('');
    sel.innerHTML = `<option value="">No club</option>${groups}`;
    if (!current[i]) sel.value = '';
  });
}

function renderLog() {
  const rounds = Object.keys(log.rounds).map(Number).sort((a, b) => b - a);
  if (!rounds.length) {
    mount('log-list', `<p class="sec-note" style="margin-top:8px">Nothing logged yet for ${esc(season)}. `
      + 'Add the clubs you have already picked this season, one round at a time, to get an accurate count.</p>');
    return;
  }
  mount('log-list', `<ul class="ck-items" style="margin-top:10px">${rounds.map((r) => `
    <li class="ck-item"><span class="ck-mark">R${r}</span>
      <span style="flex:1">${log.rounds[String(r)].map((id) => esc(nameOf(id))).join(', ')}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-edit-round="${r}">Edit</button></li>`).join('')}
    </ul>`);
  document.querySelectorAll('[data-edit-round]').forEach((b) => b.addEventListener('click', () => {
    const sel = document.getElementById('log-round');
    sel.value = b.getAttribute('data-edit-round');
    fillClubSelects();
    sel.focus();
  }));
}

/* ── Spend or save ───────────────────────────────────────── */

function planCard(p) {
  const tag = p.verdict === 'spend' ? 'Worth a use now' : 'Worth saving';
  return `<li class="av-item">
    <div><span class="t-name">${esc(p.club.name)}</span>
      <span class="t-sub">${esc(DIVISION_LABELS[p.club.division])} · rated ${p.score.toFixed(1)} · ${p.left} of ${CLUB_SEASON_USES} uses left</span>
      <span class="flag-detail"><span class="flag-note">${esc(p.reason)}</span></span></div>
    <div><span class="badge badge-avail ${p.verdict === 'spend' ? 'flag-fit' : 'flag-doubt'}">${esc(tag)}</span></div>
  </li>`;
}

function renderPlan() {
  const plan = clubPlan(ctx, log);
  const picks = roundPicks(ctx);
  const model = checkModelClub(plan, picks.club && picks.club.club.id);
  const exhaustedContenders = plan.filter((p) => p.contender && p.verdict === 'exhausted');
  const spend = plan.filter((p) => p.verdict === 'spend');
  const save = plan.filter((p) => p.verdict === 'save');

  const warn = model.exhausted
    ? `<div class="chip-card flag-warn" style="margin-bottom:12px" role="status">
        <p class="chip-head"><span class="chip-name">The model's club pick has no uses left</span></p>
        <p class="chip-say">${esc(model.pick.club.name)} is this round's top-rated club, and your log shows all
          ${CLUB_SEASON_USES} uses spent.${model.alternative ? ` The best-rated club you can still pick is
          ${esc(model.alternative.club.name)} (${model.alternative.left} left).` : ''}</p>
      </div>`
    : '';
  const spentNote = exhaustedContenders.length
    ? `<p class="sec-note" style="margin-top:10px">Top-rated this round but used up on your log:
        ${exhaustedContenders.map((p) => esc(p.club.name)).join(', ')}.</p>`
    : '';

  mount('plan-body', `${warn}
    <h3 class="sec-title" style="margin:0 0 6px">Worth a use in the next ${NOW_WINDOW} rounds</h3>
    ${spend.length ? `<ul class="av-list">${spend.map(planCard).join('')}</ul>`
    : '<p class="sec-note">None of the top-rated clubs has one of its best rounds in the next three.</p>'}
    <h3 class="sec-title" style="margin:16px 0 6px">Worth saving for later</h3>
    ${save.length ? `<ul class="av-list">${save.map(planCard).join('')}</ul>`
    : '<p class="sec-note">No top-rated club has clearly better fixtures later on.</p>'}
    ${spentNote}`);
}

/* ── Every club ──────────────────────────────────────────── */

function renderAll() {
  const counts = usageCounts(log);
  const divs = divisionFilter === 'all' ? DIVISIONS : [divisionFilter];
  mount('all-body', divs.map((div) => {
    const clubs = ctx.clubs.filter((c) => c.division === div)
      .map((c) => ({ c, used: counts[c.id] || 0 }))
      .sort((a, b) => b.used - a.used || a.c.name.localeCompare(b.c.name));
    return `<h3 class="sec-title" style="margin:12px 0 6px">${esc(DIVISION_LABELS[div])}</h3>
      <ul class="ck-items">${clubs.map(({ c, used }) => {
      const left = Math.max(0, CLUB_SEASON_USES - used);
      return `<li class="ck-item ${left ? '' : 'ck-no'}">
        <span class="ck-mark" aria-hidden="true">${'●'.repeat(Math.min(used, CLUB_SEASON_USES))}${'○'.repeat(left)}</span>
        <span style="flex:1">${esc(c.name)}</span>
        <span class="t-sub">${left ? `${left} left` : 'No uses left'}<span class="sr-only">, ${used} of ${CLUB_SEASON_USES} used</span></span>
      </li>`;
    }).join('')}</ul>`;
  }).join(''));
}

function renderEverything() {
  fillClubSelects();
  renderLog();
  renderPlan();
  renderAll();
}


