/* Fantasy EFL — the model's record.

   Reads one file: /fantasy-efl/data/record.json, built from the ledger in
   efl/data/rounds by scripts/efl/publish-record.mjs. The page computes no
   result of its own. That is the point — a scorecard that recalculated its
   own marks in the browser could quietly disagree with the evidence it is
   supposed to be reporting.

   Nothing here is rendered optimistically. Before the first round is
   recorded the page says so plainly; a round recorded but not yet played
   shows its picks with no points; a round whose points could not be pinned
   to one round is shown, labelled, and left out of the season figures. */

import { initTheme, esc, mount, emptyState } from './ui.js';

initTheme();

const RECORD_URL = '/fantasy-efl/data/record.json';

const n1 = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) : '—');

/* A recorded pick's fixtures, as one line of meta.

   Rounds recorded before the ledger knew about doubles carry only
   `fixture`; ones recorded since carry the whole list. Reading the list
   when it is there and the single when it is not keeps every round in the
   archive readable, and never claims a double the file cannot evidence. */
function fixtureMeta(p) {
  const list = (p.fixtures && p.fixtures.length) ? p.fixtures : (p.fixture ? [p.fixture] : []);
  if (!list.length) return '';
  const one = (f) => `${f.home ? 'v' : 'at'} ${esc(f.opponent || '')}`;
  return list.length > 1
    ? ` · double: ${list.map(one).join(' + ')}`
    : ` · ${one(list[0])}`;
}
const int = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
const rho = (v) => (Number.isFinite(v) ? v.toFixed(3) : '—');
const day = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
};

/* ── The season, in five numbers ─────────────────────────
   Ordered by how much they mean, not by how flattering they are. The
   percentile and the correlation come first because they survive a round
   in which nobody scored; the totals come last because they do not. */
function seasonCards(season) {
  if (!season || !season.graded) return '';
  const s = season;
  const card = (label, value, detail) => `
    <div class="card">
      <div class="pick-role">${esc(label)}</div>
      <div class="pick-score" style="font-size:var(--fs-xl);margin:4px 0">${value}</div>
      <div class="sec-note">${detail}</div>
    </div>`;

  return `<div class="grid g-auto">
    ${card('Beaten by our seven', pct(s.percentile && s.percentile.mean),
    `of legal random sevens, on average across ${s.graded} graded round${s.graded === 1 ? '' : 's'}. `
      + '50% would mean the model adds nothing.')}
    ${card('Rank correlation', rho(s.rho && s.rho.mean),
    'between our pre-round rating and what every player actually scored. '
      + 'The squad rules cannot flatter this one.')}
    ${card('Share of the ceiling', pct(s.ceilingShare),
    'of the best seven that could have been picked in hindsight. Nobody reaches 100%.')}
    ${card('Beat the naive seven', `${int(s.beatNaive)} / ${int(s.graded)}`,
    'rounds in which we beat "just pick whoever has been scoring". '
      + 'This is the baseline that has to fall for any of this to be worth doing.')}
    ${card('Captain on the money', `${int(s.captain && s.captain.best)} / ${int(s.captain && s.captain.graded)}`,
    `rounds where the armband landed on the best of our own seven. `
      + `${int(s.captain && s.captain.foregone)} points left on the table across the season, per extra multiple.`)}
  </div>`;
}

/* ── Totals ──────────────────────────────────────────────
   Our score against the three things it has to be read against. Rendered as
   a table rather than a chart because five numbers do not need a chart, and
   because a table can be read by a screen reader without a description. */
function totalsTable(season) {
  if (!season || !season.graded) return '';
  const row = (label, total, mean, note) => `<tr>
    <th scope="row">${esc(label)}</th>
    <td class="num">${int(total)}</td>
    <td class="num">${n1(mean)}</td>
    <td>${note}</td>
  </tr>`;

  return `<div class="tscroll"><table>
    <caption class="sr-only">Season totals for our picks and each baseline</caption>
    <thead><tr>
      <th scope="col">Seven</th><th scope="col" class="num">Season</th>
      <th scope="col" class="num">Per round</th><th scope="col">What it is</th>
    </tr></thead>
    <tbody>
      ${row('Our picks', season.ours.total, season.ours.mean,
    'The seven this site put on the dashboard before each round locked.')}
      ${row('Naive', season.naive.total, season.naive.mean,
    'The legal seven with the best points per appearance at the time. Ten minutes with a spreadsheet.')}
      ${row('Random', season.random.total, season.random.mean,
    'The average legal seven picked with no information at all. The floor.')}
      ${row('Best possible', season.ceiling.total, season.ceiling.mean,
    'The best legal seven in hindsight. Unreachable, and the only way to read a raw score.')}
    </tbody></table></div>`;
}

/* ── Round by round ──────────────────────────────────────
   Every recorded round, including the ones that have not been played and
   the ones that could not be graded cleanly. A missing round is left
   missing: the ledger cannot be back-filled, so a gap here means the job
   did not run or the feed was down that week, and saying so is the only
   honest option. */
function roundsTable(rounds) {
  if (!rounds.length) return '';
  const rows = rounds.slice().reverse().map((r) => {
    const res = r.result;
    const captain = r.players.find((p) => String(p.id) === String(r.captain));
    const flag = !res
      ? '<span class="badge badge-avail av-doubtful">Not played yet</span>'
      : res.attribution === 'clean' ? ''
        : '<span class="badge badge-avail av-doubtful" title="A later round had already kicked off when this was graded, so the points cannot be pinned to this round alone. Left out of the season figures.">Ambiguous</span>';

    return `<tr>
      <th scope="row" data-label="Round">${int(r.round)} ${flag}</th>
      <td data-label="Recorded">${day(r.recordedAt)}
        <span class="muted">${Number.isFinite(r.hoursBeforeLock) ? `${Math.round(r.hoursBeforeLock)}h early` : ''}</span></td>
      <td class="num" data-label="Our seven">${res ? int(res.total) : '—'}</td>
      <td class="num" data-label="Naive">${res ? int(res.baselines.naive) : '—'}</td>
      <td class="num" data-label="Random">${res ? n1(res.baselines.randomMean) : '—'}</td>
      <td class="num" data-label="Best possible">${res ? int(res.baselines.ceiling) : '—'}</td>
      <td class="num" data-label="Percentile">${res ? pct(res.baselines.percentile) : '—'}</td>
      <td data-label="Captain">${captain ? esc(captain.name) : '—'}
        ${res && res.captain ? `<span class="muted">${int(res.captain.points)} pts${res.captain.wasBest ? ', best of the seven' : `, ${int(res.captain.foregonePerMultiple)} behind`}</span>` : ''}</td>
      <td data-label="Clubs">${r.clubs.map((c) => esc(c.name)).join(', ')}
        ${res && res.clubs ? `<span class="muted">${int(res.clubs.total)} vs ${n1(res.clubs.fieldMeanTwo)} average</span>` : ''}</td>
      <td class="num" data-label="Rank correlation">${res ? rho(res.model.rho) : '—'}</td>
    </tr>`;
  }).join('');

  return `<div class="tscroll"><table>
    <caption class="sr-only">Every recorded round, its picks and how they scored</caption>
    <thead><tr>
      <th scope="col">Round</th><th scope="col">Recorded</th>
      <th scope="col" class="num">Our seven</th><th scope="col" class="num">Naive</th>
      <th scope="col" class="num">Random</th><th scope="col" class="num">Best possible</th>
      <th scope="col" class="num">Percentile</th>
      <th scope="col">Captain</th><th scope="col">Clubs</th>
      <th scope="col" class="num">Rank corr.</th>
    </tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

/* The most recent round in full: who was picked, and what each one did. */
function latestRound(rounds) {
  const r = rounds[rounds.length - 1];
  if (!r) return '';
  const res = r.result;
  const cards = r.players.map((p) => {
    const isCaptain = String(p.id) === String(r.captain);
    const points = p.points;
    return `<div class="sq-card">
      <div class="sq-pos">${esc(p.position)}${isCaptain ? ' <span class="sq-armband" title="Captain">C</span>' : ''}</div>
      <div class="sq-name">${esc(p.name)}</div>
      <div class="sq-meta">${esc(p.club || '')}${fixtureMeta(p)}</div>
      <div class="sq-foot">
        <span class="muted">rated ${n1(p.score)}</span>
        <span class="sq-score">${Number.isFinite(points) ? `${int(points)} pts` : '—'}</span>
      </div>
    </div>`;
  }).join('');

  return `<div class="sec-head">
      <h2 class="sec-title">Round ${int(r.round)} in full</h2>
      <span class="sec-note">Recorded ${day(r.recordedAt)}, ${Number.isFinite(r.hoursBeforeLock)
    ? `${Math.round(r.hoursBeforeLock)} hours` : ''} before the deadline</span>
    </div>
    <div class="squad">${cards}</div>
    <p class="sec-note" style="margin-top:10px">Clubs: ${r.clubs.map((c) => `<b>${esc(c.name)}</b>`).join(' and ')}.
      ${res && res.clubs ? `They returned ${int(res.clubs.total)} against an average of ${n1(res.clubs.fieldMeanTwo)} `
    + `for two clubs, and ${int(res.clubs.bestTwo)} for the best two available. `
    + (res.clubBasis === 'official-points'
      ? 'Graded on the official club points the feed publishes.'
      : 'Graded on the match result — the official club scoring is not published to this app, and this page will not invent a tariff for it.')
    : 'Not played yet.'}</p>`;
}

/* ── Render ──────────────────────────────────────────────── */

fetch(RECORD_URL, { headers: { Accept: 'application/json' } })
  .then((res) => {
    if (!res.ok) throw new Error(`the record file answered ${res.status}`);
    return res.json();
  })
  .then((record) => {
    const rounds = record.rounds || [];
    const season = record.season || {};

    if (!rounds.length) {
      mount('season', `<div class="note" role="status"><b>Nothing has been recorded yet.</b>
        The first entry appears when the job next runs inside the day before a round locks.
        This page will stay empty until then — a track record that starts with a back-filled
        week is not a track record, and there is no code in this project that can write one.</div>`);
      mount('rounds', emptyState('No rounds recorded',
        'Picks are written before each deadline and graded after the round settles.'));
      return;
    }

    mount('season', season.graded
      ? seasonCards(season) + totalsTable(season)
      : `<div class="note" role="status"><b>${rounds.length} round${rounds.length === 1 ? '' : 's'} recorded, none graded yet.</b>
          Season figures appear once the first round has been played and settled.</div>`);
    mount('latest', latestRound(rounds));
    mount('rounds', roundsTable(rounds));

    const meta = document.getElementById('record-meta');
    if (meta) {
      meta.innerHTML = `Built from the ledger at ${esc(new Date(record.generatedAt).toLocaleString('en-GB'))}. `
        + `${esc(String(rounds.length))} round${rounds.length === 1 ? '' : 's'} recorded, `
        + `${esc(String(season.graded || 0))} graded.`;
    }
  })
  .catch((err) => {
    mount('season', `<div class="note note-err" role="alert"><b>The record could not be loaded.</b>
      ${esc(err.message)}. Nothing is shown from memory or from a default — an empty scorecard is
      better than a made-up one.</div>`);
  });
