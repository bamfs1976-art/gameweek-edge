/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — shared view helpers.

   The header, the tab strip and the footer are written into each page's
   HTML rather than assembled here. That is deliberate: they are the
   internal links between the five pages, and links that only exist after
   JavaScript runs are links a crawler and a text browser cannot follow.
   This file is for the parts that genuinely depend on data.

   ── ACCESSIBILITY RULES THIS FILE ENFORCES ─────────────────
   · A fixture difficulty is never colour alone. Every `.fdr` carries its
     number as text and a full sentence as its accessible name.
   · A form strip is never colour alone. Every pip carries its letter, and
     the strip has one accessible name reading the run out in order.
   · Availability is a word before it is a colour.
   · Every table cell that becomes a stacked row on a phone carries a
     `data-label`, which is where the column heading goes when the header
     row is hidden.
   ═══════════════════════════════════════════════════════════ */

import { RATING_LABELS, AVAILABILITY_LABELS, POSITION_NAMES, divisionName } from './model.js';
import { TARIFF, statPoints } from './tariff.js';
import { riskBadgeText, ladderRows, SUSPENSION_LADDER } from './suspension.js';

export const DIVISION_LABELS = {
  championship: 'Championship',
  'league-one': 'League One',
  'league-two': 'League Two'
};

export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function mount(id, html) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) el.innerHTML = html;
  return el;
}

/* ── Theme ────────────────────────────────────────────────
   `ge-theme` is Gameweek Edge's own key. Reading it means the theme a
   manager chose in the FPL app is already applied here — one site, one
   preference — and writing it means the choice travels back. */
export function initTheme() {
  const root = document.documentElement;
  let stored = null;
  try { stored = localStorage.getItem('ge-theme'); } catch (_) { /* private mode */ }
  const initial = stored
    || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark');
  apply(initial);

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    const b = document.getElementById('theme-toggle');
    if (b) {
      b.textContent = theme === 'dark' ? 'Light' : 'Dark';
      b.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    }
    try { localStorage.setItem('ge-theme', theme); } catch (_) { /* private mode */ }
  }
}

/* ── Formatting ─────────────────────────────────────────── */
const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  timeZone: 'Europe/London'
});
const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London'
});

export function fmtKickoff(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DATE_FMT.format(d);
}
export function fmtDay(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DAY_FMT.format(d);
}

/* ── Chips and cells ────────────────────────────────────── */

export function divisionBadge(division) {
  return `<span class="badge badge-div div-${esc(division)}">${esc(DIVISION_LABELS[division] || division)}</span>`;
}

export function positionBadge(position) {
  return `<span class="badge" title="${esc(POSITION_NAMES[position] || position)}">${esc(position)}</span>`;
}

export function homeAwayBadge(home) {
  return `<span class="badge badge-ha" title="${home ? 'Home fixture' : 'Away fixture'}">`
    + `${home ? 'H' : 'A'}</span>`;
}

/**
 * A fixture-difficulty cell. `rating` 1 (easiest) to 5 (hardest).
 * The number is visible text; the word is in the accessible name and the
 * tooltip. Colour is the third channel, never the only one.
 */
export function fdrCell(rating, opts = {}) {
  if (rating == null) {
    return '<span class="fdr fdr-blank" title="No fixture this round" '
      + 'aria-label="Blank round — no fixture">—</span>';
  }
  const word = RATING_LABELS[rating] || '';
  const label = opts.label || `Difficulty ${rating} of 5 — ${word.toLowerCase()}`;
  const inner = opts.text ? `${esc(opts.text)}` : String(rating);
  return `<span class="fdr fdr-${rating}" title="${esc(label)}" aria-label="${esc(label)}">`
    + `${inner}</span>`;
}

/** A fixture cell for the ticker: opponent, H/A and the rating together. */
export function fixtureCell(ctx, rated, clubById) {
  if (!rated) return fdrCell(null);
  const opp = clubById[rated.opponentId];
  const oppName = opp ? opp.short : '???';
  const oppFull = opp ? opp.name : 'Unknown club';
  const where = rated.home ? 'at home to' : 'away at';
  const label = `${where} ${oppFull} — difficulty ${rated.rating} of 5, `
    + `${(RATING_LABELS[rated.rating] || '').toLowerCase()}`
    + (rated.postponed ? ', rearranged fixture' : '');
  return `<span class="fdr fdr-${rated.rating}" title="${esc(label)}" aria-label="${esc(label)}">`
    + `${esc(rated.home ? oppName : oppName.toLowerCase())}`
    + `<span aria-hidden="true">·${rated.rating}</span></span>`;
}

export function fdrLegend() {
  const items = [1, 2, 3, 4, 5].map((r) =>
    `<span class="lg-item"><span class="fdr fdr-${r}" aria-hidden="true">${r}</span>`
    + `${esc(RATING_LABELS[r])}</span>`).join('');
  return `<div class="fdr-legend"><span class="sr-only">Fixture difficulty scale, `
    + `1 easiest to 5 hardest.</span>${items}`
    + `<span class="lg-item"><span class="fdr fdr-blank" aria-hidden="true">—</span>Blank round</span></div>`;
}

/** Last five results as letters. Oldest first, which is how a form guide
 *  reads — the rightmost pip is the most recent match. */
export function formStrip(form) {
  const list = Array.isArray(form) ? form : [];
  if (!list.length) return '<span class="muted">No matches yet</span>';
  const words = { W: 'won', D: 'drew', L: 'lost' };
  const label = 'Last ' + list.length + ' matches, oldest first: '
    + list.map((r) => words[r] || r).join(', ');
  return `<span class="form-strip" role="img" aria-label="${esc(label)}">`
    + list.map((r) => `<span class="form-pip pip-${esc(r)}" aria-hidden="true">${esc(r)}</span>`).join('')
    + '</span>';
}

/** A 0-1 value as a bar plus its number. `text` is what the number reads as. */
export function meter(value, text, label) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<span class="meter" role="img" aria-label="${esc(label || `${text}`)}">`
    + `<span class="meter-track" aria-hidden="true"><span class="meter-fill" style="width:${pct}%"></span></span>`
    + `<span class="meter-val" aria-hidden="true">${esc(text)}</span></span>`;
}

/* ── Points attribution ─────────────────────────────────
   A stats table tells you a defender made 61 clearances. It does not tell
   you that was worth 15 points, which is the only reason a Fantasy EFL
   manager cares about clearances at all. Every stat cell therefore carries
   what it was worth, in the game's own currency.

   Three states, and they are deliberately different:
     null   the source does not publish this  → "—", nothing implied
     0 pts  it happened and paid nothing      → the value, no bracket
     n pts  it paid                           → "61 (+15)", signed and coloured
*/
export function statCell(stat, value, position, minutes) {
  if (value == null) {
    return '<span class="muted" title="Not published by this data source">—</span>';
  }
  const points = statPoints(stat, value, position, minutes);
  if (!points) return `<span class="mono">${esc(value)}</span>`;
  const cls = points > 0 ? 'attr-pos' : 'attr-neg';
  const rule = TARIFF[stat];
  const title = `${value} ${rule ? rule.label.toLowerCase() : stat} — `
    + `${points > 0 ? '+' : ''}${points} point${Math.abs(points) === 1 ? '' : 's'}`
    + (rule && rule.describe ? ` (${rule.describe})` : '');
  return `<span class="mono" title="${esc(title)}">${esc(value)} `
    + `<span class="${cls}" aria-label="worth ${points > 0 ? 'plus' : 'minus'} `
    + `${Math.abs(points)} point${Math.abs(points) === 1 ? '' : 's'}">`
    + `(${points > 0 ? '+' : ''}${points})</span></span>`;
}

/** Ownership, but only where a source actually publishes it. */
export function ownershipCell(value) {
  if (value == null) {
    return '<span class="muted" title="This data source does not publish ownership">—</span>';
  }
  return `<span class="mono">${Number(value).toFixed(1)}%</span>`;
}

/* ── Suspension risk ───────────────────────────────────
   Shown, never scored. A ban costs the round AFTER the booking, so this is
   a planning signal beside the player rather than a mark against him — see
   suspension.js for the argument. Only levels that would change a decision
   get a badge; "four from a ban" is noise. */
export function suspensionBadge(risk) {
  const text = riskBadgeText(risk);
  if (!text) return '';
  return `<span class="badge badge-susp susp-${esc(risk.level)}" title="${esc(risk.note)}">`
    + `${esc(text)}</span>`;
}

/** The ladder as a table, for the guide. */
export function suspensionLadder() {
  return '<div class="tscroll"><table>'
    + '<caption class="sr-only">EFL yellow-card accumulation ladder</caption>'
    + '<thead><tr><th scope="col">Reach</th><th scope="col" class="num">Ban</th></tr></thead><tbody>'
    + ladderRows().map((r) => `<tr><td>${esc(r.text)}</td>`
      + `<td class="num">${r.ban} match${r.ban === 1 ? '' : 'es'}</td></tr>`).join('')
    + '</tbody></table></div>'
    + `<p class="sec-note" style="margin-top:8px">The count is cumulative and does `
    + `<b>not</b> reset when a ban is served — a player who sat out at `
    + `${SUSPENSION_LADDER.rungs[0].at} is next in trouble at `
    + `${SUSPENSION_LADDER.rungs[1].at}, not at ${SUSPENSION_LADDER.rungs[0].at} again.</p>`;
}

export function availabilityBadge(availability) {
  const a = availability || { status: 'available', note: '' };
  const word = AVAILABILITY_LABELS[a.status] || a.status;
  const detail = a.note ? `${word} — ${a.note}` : word;
  return `<span class="badge badge-avail av-${esc(a.status)}" title="${esc(detail)}">${esc(word)}</span>`;
}

/* ── Feed health ─────────────────────────────────────────
   /api/efl/health in words rather than JSON. Two rules shape this:

   1. It is rendered ON DEMAND, never on page load. The endpoint is
      deliberately uncached and fetches all three upstream documents, so
      wiring it to every page view would turn a diagnostic into a load on
      somebody else's front end — the exact thing the proxy's cache TTLs
      exist to prevent.
   2. A failure is reported per document, because "the feed is broken" is
      not actionable and "players.json answered 200 but no longer carries
      squadId" is.
*/
export function healthSummary(report) {
  const r = report || {};
  const documents = r.documents || {};
  const names = Object.keys(documents);

  const rows = names.map((name) => {
    const d = documents[name] || {};
    const problems = [];
    if (d.error) problems.push(esc(d.error));
    if (d.status != null && d.status !== 200) problems.push(`HTTP ${esc(d.status)}`);
    if (d.isArray === false) problems.push('not a list of records');
    if (Array.isArray(d.fieldsMissing) && d.fieldsMissing.length) {
      problems.push(`missing ${d.fieldsMissing.map(esc).join(', ')}`);
    }
    const good = !problems.length;
    return `<tr>
      <th scope="row">${esc(name)}</th>
      <td class="health-status"><span class="health-dot health-${good ? 'ok' : 'bad'}" aria-hidden="true"></span>`
      + `${good ? 'OK' : 'Problem'}</td>
      <td class="num">${d.count == null ? '<span class="muted">—</span>' : esc(d.count)}</td>
      <td>${good
    ? `<span class="muted">all expected fields present</span>`
    : problems.join('; ')}</td>
    </tr>`;
  }).join('');

  const ok = r.ok === true;
  return `<div class="note ${ok ? '' : 'note-err'}" role="status">`
    + `<b>${ok ? 'The official Fantasy EFL feed is healthy.' : 'The official feed is not answering as expected.'}</b> `
    + esc(r.summary || '')
    + (r.checkedAt ? ` <span class="muted">Checked ${esc(fmtKickoff(r.checkedAt))}.</span>` : '')
    + '</div>'
    + (names.length ? `<div class="tscroll" style="margin-top:10px"><table>
        <caption class="sr-only">Per-document result of the Fantasy EFL feed health check</caption>
        <thead><tr><th scope="col">Document</th><th scope="col">Status</th>
          <th scope="col" class="num">Records</th><th scope="col">Detail</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '')
    + (ok ? '' : '<p class="sec-note" style="margin-top:9px">While it is wrong, every Fantasy EFL '
      + 'page shows a named error rather than wrong numbers. '
      + '<a href="/fantasy-efl/?provider=sample" style="color:var(--efl)">Switch to the sample '
      + 'dataset</a> to keep using the tools meanwhile — clearly labelled, and not live.</p>');
}

/** When the check itself could not run. Distinct from a failing feed. */
export function healthUnavailable(err) {
  const msg = err && err.message ? err.message : String(err || 'unknown error');
  return '<div class="note note-method" role="status">'
    + '<b>The health check could not be run.</b> ' + esc(msg)
    + ' That is a fault in the check, not necessarily in the feed — this page still loaded '
    + 'its data, and what that data was is reported above.</div>';
}

/* ── States ─────────────────────────────────────────────── */

export function skeletonCards(count = 6) {
  return '<div class="grid g-auto">'
    + Array.from({ length: count }, () => '<div class="skel skel-card"></div>').join('')
    + '</div>';
}

export function skeletonRows(count = 8) {
  return '<div class="card" aria-hidden="true">'
    + Array.from({ length: count }, () => '<div class="skel skel-line"></div>').join('')
    + '</div>';
}

export function loadingBlock(message) {
  return `<div role="status" aria-live="polite"><span class="sr-only">${esc(message || 'Loading')}</span>`
    + skeletonRows(6) + '</div>';
}

export function errorState(err, retryId) {
  const msg = err && err.message ? err.message : 'Something went wrong loading the data.';
  /* A shape error is a different event from an outage and deserves
     different words. The app reads the official game's feed, which can be
     changed without notice by people who owe us nothing — so when the shape
     moves, the page says which document and what arrived, rather than
     leaving someone to guess from a 500. */
  const isShape = Boolean(err && err.shapeError);
  return '<div class="note note-err" role="alert">'
    + `<b>${isShape
      ? 'The official Fantasy EFL feed has changed shape.'
      : 'The Fantasy EFL data could not be loaded.'}</b><br>`
    + esc(msg)
    + '<br><br>Nothing here is shown from a stale copy, and nothing falls back to sample data '
    + 'pretending to be live — an out-of-date pick is worse than no pick, and an invented one '
    + 'is worse still.'
    + '<br><br><b>What to check:</b> <a href="/fantasy-efl/how-to-play/#health" style="color:inherit;text-decoration:underline">'
    + 'run the feed health check</a> — it reports each document\'s status and which expected '
    + 'fields are present, in words. The same report is at '
    + '<a href="/api/efl/health" style="color:inherit;text-decoration:underline">/api/efl/health</a> as JSON. '
    + 'To carry on meanwhile, <a href="?provider=sample" style="color:inherit;text-decoration:underline">'
    + 'switch to the sample dataset</a> — clearly labelled, and not live.'
    + (retryId ? ` <br><button class="btn btn-ghost btn-sm" id="${esc(retryId)}" style="margin-top:10px">Try again</button>` : '')
    + '</div>';
}

export function emptyState(title, detail) {
  return `<div class="empty"><b>${esc(title)}</b>${esc(detail || '')}</div>`;
}

/**
 * The data-source banner. Every page calls it, and it is not optional:
 * where `source.live` is false the page must say so above the fold.
 */
export function sourceBanner(source) {
  if (!source) return '';
  if (source.live) {
    return `<p class="note" role="note"><b>${esc(source.label)}.</b> ${esc(source.description)} `
      + `Ratings and scores on this page are modelled, not official.</p>`
      + coverageNote(source.coverage);
  }
  return '<div class="note note-sample" role="note">'
    + `<b>${esc(source.label)} — not live Fantasy EFL data.</b> ${esc(source.description)} `
    + 'Club names are real; results, tables, players and availability are generated for '
    + 'demonstration. Swap in a real provider and this banner changes with it — see '
    + '<code>efl/app/assets/provider.js</code>.'
    + '</div>'
    + coverageNote(source.coverage);
}

/**
 * What the active source could NOT answer.
 *
 * A source that fills some fields and not others is the normal case, and
 * the failure worth designing against is not an error — it is a form meter
 * built from nothing that looks exactly like a form meter built from five
 * rounds. So the gaps are stated where the numbers are, rather than in a
 * changelog nobody reads.
 */
export function coverageNote(coverage) {
  if (!coverage || !Array.isArray(coverage.notes) || !coverage.notes.length) return '';
  return '<details class="note note-method coverage"><summary>What this data source '
    + `does and does not cover (${coverage.notes.length})</summary><ul>`
    + coverage.notes.map((n) => `<li>${esc(n)}</li>`).join('')
    + '</ul></details>';
}

/** The one-line method note that has to sit under anything rated 1-5. */
export function methodNote(extra) {
  return '<p class="note note-method"><b>How the fixture rating works.</b> Every club in a '
    + 'division is ranked on points per game, goals conceded and goals scored, then split into '
    + 'five bands — 1 is the most favourable fixture, 5 the toughest. Home advantage moves a '
    + 'fixture by up to one band. Clubs are only ever compared with others in their own division, '
    + 'so a League Two rating means the same thing as a Championship one. It is a modelled guide '
    + 'built from results so far, not a prediction, and it cannot see team news, a cup replay '
    + 'or a manager change.'
    + (extra ? ' ' + extra : '')
    + '</p>';
}

export { divisionName };
