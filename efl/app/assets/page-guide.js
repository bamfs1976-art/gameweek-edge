/* Fantasy EFL — the guide page.

   Almost entirely static copy, which is the point: it is the page a search
   engine and a first-time reader should both be able to read without
   JavaScript. Two things are dynamic:

   1. The data-source paragraph, because that is the one claim on the page
      that must never go stale — if the app is running on sample data, the
      guide has to say so too.
   2. The feed health check, which is the same claim tested harder. It runs
      only when asked, for the reason spelled out on the page. */

import { loadSnapshot, readConfig } from './provider.js';
import { initTheme, esc, suspensionLadder, healthSummary, healthUnavailable } from './ui.js';

initTheme();

/* The ladder is rendered from the rule in suspension.js rather than typed
   into the page, so the guide and the badges can never disagree about what
   earns a ban. */
const ladder = document.getElementById('ladder');
if (ladder) ladder.innerHTML = suspensionLadder();

const el = document.getElementById('data-status');

loadSnapshot().then((snapshot) => {
  if (!el) return;
  const s = snapshot.source;
  if (s.live) {
    /* The free verdict: this page just loaded that feed, so it can say what
       came back without asking anyone for anything. It is weaker evidence
       than the health check below — it only proves the documents parsed —
       but it costs nothing and it is already true by the time you read it. */
    el.className = 'note';
    el.innerHTML = `<b>${esc(s.label)}.</b> ${esc(s.description)} `
      + `Snapshot taken ${esc(new Date(s.generatedAt).toLocaleString('en-GB'))}. `
      + `It answered this page with ${esc(snapshot.clubs.length)} clubs, `
      + `${esc(snapshot.players.length)} players and ${esc(snapshot.fixtures.length)} fixtures, `
      + `so it is currently returning data in the shape this app expects.`;
    return;
  }
  el.className = 'note note-sample';
  el.innerHTML = `<b>${esc(s.label)} — this site is not currently running on live Fantasy EFL `
    + `data.</b> ${esc(s.description)} The club names are real. The results, tables, players, `
    + `minutes and injuries are generated so the tools can be used and judged before a data `
    + `provider is connected. Every page carries this notice, and it disappears on its own the `
    + `day a live provider is configured — it is driven by the data, not written into the page.`;
}).catch(() => {
  if (!el) return;
  el.className = 'note note-err';
  el.textContent = 'The data source could not be reached, so the pages that need it will show '
    + 'an error rather than out-of-date numbers.';
});

/* ── The on-demand deep check ────────────────────────────────
   /api/efl/health answers 503 when the feed is wrong, and that body is the
   report — so a non-2xx status is a result to render, not an error to
   throw. Only a response that isn't the report at all (no route, no
   network, not JSON) counts as "the check could not be run", which is a
   different sentence and gets a different one. */
const runBtn = document.getElementById('health-run');
const out = document.getElementById('health-result');

if (runBtn && out) {
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    const label = runBtn.textContent;
    runBtn.textContent = 'Checking…';
    out.innerHTML = '<p class="sec-note">Fetching all three documents from the official '
      + 'game — this takes a few seconds.</p>';
    try {
      const res = await fetch(`${readConfig().base}/health`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      let report;
      try { report = await res.json(); }
      catch (_) {
        throw new Error(`the check answered ${res.status} but not with a report `
          + '(a redirect or an error page?).');
      }
      if (!report || typeof report.ok !== 'boolean' || !report.documents) {
        throw new Error(`the check answered ${res.status} with something other than a health `
          + 'report — the /api/efl/health route may not be deployed.');
      }
      out.innerHTML = healthSummary(report);
    } catch (err) {
      out.innerHTML = healthUnavailable(err);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = label;
    }
  });
}
