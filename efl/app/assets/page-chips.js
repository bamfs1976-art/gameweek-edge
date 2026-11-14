/* Fantasy EFL — chip timing advisor. Rules are in the page markup, first;
   this fills in the recommendation and the round-by-round read. */

import { loadSnapshot } from './provider.js';
import { buildContext } from './model.js';
import { chipCalendar, chipAdvice, readChipsUsed, writeChipsUsed, CHIPS } from './chips.js';
import { seasonFor } from './clubs.js';
import { esc, mount, initTheme, sourceBanner, errorState, emptyState } from './ui.js';

initTheme();

let ctx = null;
let calendar = null;
let season = null;

start();

function storage() { try { return window.localStorage; } catch (_) { return null; } }

async function start() {
  try {
    const snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    ctx = buildContext(snapshot);
    calendar = chipCalendar(ctx, { rounds: snapshot.rounds });
    season = seasonFor();
    document.getElementById('half-round').textContent = String(calendar.halves.secondHalfFrom);
    const used = readChipsUsed(storage(), season);
    const boxes = { mcFirst: 'u-mc1', mcSecond: 'u-mc2', oneClub: 'u-oc' };
    for (const [key, id] of Object.entries(boxes)) {
      const box = document.getElementById(id);
      box.checked = used[key];
      box.addEventListener('change', () => {
        const next = Object.fromEntries(Object.entries(boxes).map(([k, i]) => [k, document.getElementById(i).checked]));
        writeChipsUsed(storage(), season, next);
        renderAdvice(next);
      });
    }
    renderAdvice(used);
    renderCalendar();
  } catch (err) {
    mount('rec-body', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

const clubName = (id) => (ctx.clubById[id] ? ctx.clubById[id].name : 'Unknown club');

function captainWhy(r) {
  const names = r.captain.top.slice(0, 3).map((t) => `${t.name} (${clubName(t.clubId)})`);
  const doubles = r.captain.doubles
    ? `${r.captain.doubles} of the five strongest captain options have a double round. `
    : '';
  return `${doubles}Strongest options that round: ${names.join(', ')}.`;
}

function oneClubWhy(r) {
  const names = r.oneClub.players.map((p) => p.name);
  return `${clubName(r.oneClub.clubId)}${r.oneClub.double ? ' have a double round, and' : ''} have four players rated highly that round: `
    + `${names.join(', ')}. The chip lets you hold the third and fourth.`;
}

function renderAdvice(used) {
  if (!calendar.rounds.length) {
    mount('rec-body', emptyState('No rounds left to read', 'The fixture list has no rounds ahead of this one.'));
    return;
  }
  const advice = chipAdvice(calendar, used);
  const blocks = [];
  for (const mc of advice.maxCaptain) {
    const label = `${CHIPS.maxCaptain.name}, ${mc.half} half`;
    if (mc.status === 'used') blocks.push(card(label, 'Used', '', 'hold'));
    else if (mc.status === 'passed') blocks.push(card(label, 'Half over', 'The first half of the season has ended, so this one has gone if it was not played.', 'hold'));
    else if (mc.status === 'out-of-view') blocks.push(card(label, 'Later', 'Its rounds are beyond the fixtures this page reads. Check back nearer the time.', 'hold'));
    else {
      blocks.push(card(label, `Round ${mc.round.round}`,
        `${captainWhy(mc.round)}${mc.runnerUp ? ` Next best in this half: round ${mc.runnerUp.round}.` : ''}`, 'play'));
    }
  }
  const oc = advice.oneClub;
  if (oc.status === 'used') blocks.push(card(CHIPS.oneClub.name, 'Used', '', 'hold'));
  else if (oc.status === 'open') {
    blocks.push(card(CHIPS.oneClub.name, `Round ${oc.round.round}`,
      `${oneClubWhy(oc.round)}${oc.runnerUp ? ` Next best: round ${oc.runnerUp.round}, ${clubName(oc.runnerUp.oneClub.clubId)}.` : ''}`, 'play'));
  }
  mount('rec-body', `<div class="chips">${blocks.join('')}</div>
    <p class="sec-note" style="margin-top:9px">Read from the next ${calendar.rounds.length} rounds. Fixture ratings that far
      ahead lean on today's table, so the later rounds will move as results come in.</p>`);
}

function card(name, verdict, say, kind) {
  return `<article class="chip-card chip-${kind === 'play' ? 'play' : 'consider'}">
    <p class="chip-head"><span class="chip-name">${esc(name)}</span><span class="chip-verdict">${esc(verdict)}</span></p>
    ${say ? `<p class="chip-say">${esc(say)}</p>` : ''}
  </article>`;
}

function renderCalendar() {
  const rows = calendar.rounds.map((r) => `
    <div class="chip-row" role="listitem">
      <span class="ck-mark">R${r.round}</span>
      <div><div class="chip-bar" role="img" aria-label="Max Captain index ${r.captain.index}"><span style="width:${r.captain.index}%"></span></div>
        <span class="t-sub">Max Captain ${r.captain.index}${r.captain.doubles ? ' · doubles' : ''}</span></div>
      <div><div class="chip-bar" role="img" aria-label="One Club index ${r.oneClub.index}"><span style="width:${r.oneClub.index}%"></span></div>
        <span class="t-sub">One Club ${r.oneClub.index}${r.oneClub.clubId ? ` · ${esc(ctx.clubById[r.oneClub.clubId] ? ctx.clubById[r.oneClub.clubId].short : '')}` : ''}</span></div>
    </div>`).join('');
  mount('cal-body', `<div role="list" style="display:grid;gap:10px">${rows}</div>`);
}
