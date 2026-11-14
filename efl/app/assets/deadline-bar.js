/* Fantasy EFL — the countdown bar under the tabs on every page.

   Loaded AFTER each page's own module, so on a page that already asked for
   the snapshot it reuses that request rather than making a second one.
   On a page that never loads players it reads the rounds document alone.

   It is one thin line, never a pop-up. If the feed cannot be read the bar
   stays hidden: the page's own error state already says why, and a second
   error message in the header would only repeat it. */

import { loadRounds } from './provider.js';
import { nextDeadline, countdownText, fmtDeadline, URGENT_HOURS } from './deadline.js';
import { esc } from './ui.js';

const el = document.getElementById('deadline-bar');
if (el) start();

/* Nine tabs do not fit a phone. Bring the current one into view, so a
   reader can see where they are without swiping the bar. This module is
   on every page, so it is the one place to do it. */
const current = document.querySelector('.tabs [aria-current="page"]');
const strip = current && current.parentElement;
if (strip && strip.scrollWidth > strip.clientWidth) {
  strip.scrollLeft = Math.max(0, current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2);
}

async function start() {
  try {
    const { rounds } = await loadRounds();
    tick(rounds);
    setInterval(() => tick(rounds), 60 * 1000);
  } catch (_) { /* stays hidden; see above */ }
}

function tick(rounds) {
  const next = nextDeadline(rounds);
  if (!next) { el.hidden = true; return; }
  const ms = Date.parse(next.lockoutAt) - Date.now();
  const guessed = next.lockoutSource !== 'official';
  el.hidden = false;
  el.classList.toggle('dl-urgent', ms < URGENT_HOURS * 3600 * 1000);
  el.innerHTML = `<a href="/fantasy-efl/checklist/">Round ${esc(next.round)} deadline: `
    + `<b>${esc(fmtDeadline(next.lockoutAt))}</b> <span class="dl-left">· ${esc(countdownText(ms))}</span></a>`
    + (guessed ? ' <span class="dl-est">(first kick-off, deadline not published)</span>' : '');
}
