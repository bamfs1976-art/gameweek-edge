/* Fantasy EFL — the guide page.

   Almost entirely static copy, which is the point: it is the page a search
   engine and a first-time reader should both be able to read without
   JavaScript. The one dynamic element is the data-source paragraph, because
   that is the one claim on the page that must never go stale — if the app
   is running on sample data, the guide has to say so too. */

import { loadSnapshot } from './provider.js';
import { initTheme, esc, suspensionLadder } from './ui.js';

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
    el.className = 'note';
    el.innerHTML = `<b>${esc(s.label)}.</b> ${esc(s.description)} `
      + `Snapshot taken ${esc(new Date(s.generatedAt).toLocaleString('en-GB'))}.`;
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
