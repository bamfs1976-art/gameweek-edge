/* Fantasy EFL — the pre-deadline checklist.

   Reads the seven saved by the team builder on the dashboard (the same
   localStorage key, 'ge-efl-squad') and runs it past four checks. Every
   number comes from functions the rest of the app already uses, so this
   page cannot disagree with the rater, the ticker or the availability hub. */

import { loadSnapshot } from './provider.js';
import { buildContext, playerScore, POSITION_NAMES } from './model.js';
import { buildFlags } from './availability.js';
import { readLog, seasonFor, usageCounts, CLUB_SEASON_USES } from './clubs.js';
import {
  checklist, nextDeadline, countdownText, fmtDeadline, buildIcs, REMIND_OPTIONS, DEFAULT_REMIND
} from './deadline.js';
import {
  esc, mount, initTheme, sourceBanner, errorState, emptyState, fdrCell, homeAwayBadge, fmtDay,
  flagBadge, flagDetail, fdrLegend
} from './ui.js';

initTheme();

const SQUAD_KEY = 'ge-efl-squad';          /* written by page-home.js */
const REMIND_KEY = 'ge-efl-reminders';

let snapshot = null;

start();

async function start() {
  mount('check-body', '<div class="skel skel-line"></div><div class="skel skel-line"></div>');
  setupReminders();
  try {
    snapshot = await loadSnapshot();
    mount('source-banner', sourceBanner(snapshot.source));
    const ctx = buildContext(snapshot);
    const flags = buildFlags(ctx, { feedCheckedAt: snapshot.source && snapshot.source.generatedAt });
    const scored = ctx.players.map((p) => playerScore(ctx, p));
    renderDeadline(ctx);
    const ids = readSeven();
    if (!ids.length) {
      const empty = emptyState('No saved seven yet',
        'Pick your side in the team builder on the dashboard and it will be checked here. '
        + 'It saves in this browser only.');
      mount('check-body', empty + '<p style="margin-top:10px"><a class="btn btn-ghost btn-sm" href="/fantasy-efl/#mine">Go to the team builder</a></p>');
      mount('fixtures-body', '<p class="sec-note">Fixtures show here once you have saved a seven.</p>');
      mount('ahead-body', '<p class="sec-note">Blank and double rounds for your clubs show here once you have saved a seven.</p>');
    } else {
      const ck = checklist(ctx, ids, { scored, flags, clubs: clubsThisRound(ctx) });
      renderChecks(ck);
      renderFixtures(ctx, ck);
      renderAhead(ctx, ck);
    }
    const btn = document.getElementById('rm-download');
    btn.disabled = false;
  } catch (err) {
    mount('check-body', errorState(err, 'retry'));
    const retry = document.getElementById('retry');
    if (retry) retry.addEventListener('click', () => window.location.reload());
  }
}

/* This round's clubs from the club-uses log, or null when there is no log. */
function clubsThisRound(ctx) {
  let store = null;
  try { store = window.localStorage; } catch (_) { return null; }
  const log = readLog(store, seasonFor(), new Set(ctx.clubs.map((c) => c.id)));
  if (!Object.keys(log.rounds).length) return null;
  const counts = usageCounts(log);
  const ids = log.rounds[String(ctx.currentRound)] || [];
  const exhausted = ids.filter((id) => counts[id] > CLUB_SEASON_USES)
    .map((id) => (ctx.clubById[id] ? ctx.clubById[id].name : id));
  return { ids, exhausted };
}

function readSeven() {
  try {
    const raw = JSON.parse(localStorage.getItem(SQUAD_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, 7) : [];
  } catch (_) { return []; }
}

/* ── Deadline ────────────────────────────────────────────── */

function renderDeadline(ctx) {
  const thisRound = snapshot.rounds.find((r) => r.round === ctx.currentRound);
  const next = nextDeadline(snapshot.rounds);
  const passed = thisRound && thisRound.lockoutAt && Date.parse(thisRound.lockoutAt) <= Date.now();
  const show = passed ? next : (thisRound && thisRound.lockoutAt ? thisRound : next);
  if (!show) {
    mount('deadline-body', '<p class="sec-note">No deadline left in the published fixture list.</p>');
    return;
  }
  const guessed = show.lockoutSource !== 'official';
  mount('deadline-body', `
    <p class="ck-deadline">Round ${esc(show.round)}: ${esc(fmtDeadline(show.lockoutAt))}</p>
    <p class="sec-note">${esc(countdownText(Date.parse(show.lockoutAt) - Date.now()))} to go, UK time.
      ${guessed ? 'The official deadline is not in this data, so this is the round\'s first kick-off.' : ''}
      ${passed && thisRound.lockoutSource === 'official'
    ? `The round ${esc(ctx.currentRound)} deadline has passed. Reload the page to check your seven for round ${esc(show.round)}.`
    : passed ? `The checks below cover round ${esc(ctx.currentRound)}.` : ''}</p>`);
}

/* ── Checks ──────────────────────────────────────────────── */

function renderChecks(ck) {
  const items = ck.items.map((i) => `
    <li class="ck-item ${i.ok ? 'ck-ok' : 'ck-no'}">
      <span class="ck-mark">${i.ok ? 'Done' : 'Check'}</span><span>${esc(i.text)}</span>
    </li>`).join('');
  const warned = ck.warnings.length
    ? `<div class="chip-card flag-warn" style="margin-top:12px">
        <p class="chip-head"><span class="chip-name">Flagged in your seven</span></p>
        <ul class="av-list" style="margin-top:8px">${ck.warnings.map(({ player, flag }) => `
          <li class="av-item"><div><span class="t-name">${esc(player.name)}</span>${flagDetail(flag)}</div>
          <div>${flagBadge(flag)}</div></li>`).join('')}</ul>
      </div>`
    : '';
  const unknown = ck.unknown.length
    ? `<p class="sec-note" style="margin-top:10px">${ck.unknown.length} saved pick(s) are no longer in the game. Replace them in the
        <a href="/fantasy-efl/#mine" style="color:var(--efl)">team builder</a>.</p>`
    : '';
  mount('check-body', `<ul class="ck-items">${items}</ul>${warned}${unknown}
    <p style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px"><a class="btn btn-ghost btn-sm" href="/fantasy-efl/#mine">Change your seven</a>
      <a class="btn btn-ghost btn-sm" href="/fantasy-efl/club-uses/">Log this round's clubs</a></p>`);
}

/* ── Fixtures ────────────────────────────────────────────── */

function renderFixtures(ctx, ck) {
  const rows = ck.players.map(({ player, round }) => {
    const club = ctx.clubById[player.clubId];
    const fixtures = round.blank
      ? '<span class="ck-fix">' + fdrCell(null) + '<span>No game this round</span></span>'
      : round.matches.map((m) => {
        const opp = ctx.clubById[m.opponentId];
        return `<span class="ck-fix">${fdrCell(m.rating)}${homeAwayBadge(m.home)}
          <span>${m.home ? 'v' : 'at'} <b>${esc(opp ? opp.name : 'Unknown')}</b></span>
          <span class="muted">${esc(fmtDay(m.kickoff))}</span></span>`;
      }).join('');
    return `<li class="av-item">
      <div><span class="t-name">${esc(player.name)}</span>
        <span class="t-sub">${esc(POSITION_NAMES[player.position])} · ${esc(club ? club.name : '')}</span>
        ${round.double ? '<span class="t-sub"><b>Double round, two games</b></span>' : ''}
        <div style="display:grid;gap:4px;margin-top:5px">${fixtures}</div></div>
    </li>`;
  }).join('');
  mount('fixtures-body', `<ul class="av-list">${rows}</ul><div style="margin-top:11px">${fdrLegend()}</div>
    <p class="sec-note" style="margin-top:8px">Difficulty is this site's modelled 1 to 5 rating,
      the same one the <a href="/fantasy-efl/fixtures/" style="color:var(--efl)">fixture ticker</a> uses.</p>`);
}

/* ── Blanks and doubles ahead ────────────────────────────── */

function renderAhead(ctx, ck) {
  const now = ck.players.filter((p) => p.round.blank || p.round.double);
  const nowLine = now.length
    ? `<p style="margin:0 0 10px"><b>This round:</b> ${now.map((p) => `${esc(p.player.name)} ${p.round.blank ? 'has no game' : 'has two games'}`).join('; ')}.</p>`
    : '<p class="sec-note" style="margin:0 0 10px">This round: every club you hold plays once.</p>';
  if (!ck.ahead.length) {
    mount('ahead-body', nowLine + '<p class="sec-note">No blank or double rounds for your clubs in the next five rounds.</p>');
    return;
  }
  const list = ck.ahead.map((a) => {
    const club = ctx.clubById[a.clubId];
    return `<li class="ck-item"><span class="ck-mark">R${esc(a.round)}</span>
      <span>${esc(club ? club.name : a.clubId)}: ${a.kind === 'blank' ? 'no game (blank)' : 'two games (double)'}</span></li>`;
  }).join('');
  mount('ahead-body', nowLine + `<ul class="ck-items">${list}</ul>`);
}

/* ── Reminders ───────────────────────────────────────────── */

function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(REMIND_KEY) || '{}');
    return { when: REMIND_OPTIONS[p.when] ? p.when : DEFAULT_REMIND, lastRound: p.lastRound || null, savedAt: p.savedAt || null };
  } catch (_) { return { when: DEFAULT_REMIND, lastRound: null, savedAt: null }; }
}
function writePrefs(p) {
  try { localStorage.setItem(REMIND_KEY, JSON.stringify(p)); } catch (_) { /* private mode */ }
}

function setupReminders() {
  const prefs = readPrefs();
  const sel = document.getElementById('rm-when');
  sel.value = prefs.when;
  sel.addEventListener('change', () => writePrefs({ ...readPrefs(), when: sel.value }));
  if (prefs.lastRound) {
    document.getElementById('rm-note').textContent =
      `You last added deadlines up to round ${prefs.lastRound}. Download again if the fixture list has changed.`;
  }
  document.getElementById('rm-download').addEventListener('click', () => {
    if (!snapshot) return;
    const when = sel.value;
    const { ics, count, lastRound } = buildIcs(snapshot.rounds, { when });
    const note = document.getElementById('rm-note');
    if (!count) { note.textContent = 'There are no deadlines left to add.'; return; }
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fantasy-efl-deadlines.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    writePrefs({ when, lastRound, savedAt: new Date().toISOString() });
    note.textContent = `Downloaded ${count} reminder${count === 1 ? '' : 's'}, ${REMIND_OPTIONS[when].label}, up to round ${lastRound}. `
      + 'Open the file to add them to your calendar.';
  });
}
