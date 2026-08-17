/*
 * FPL Challenge GW2-5 — render the card deck and a combined PDF.
 *
 *   node scripts/social/challenge-cards.mjs              everything
 *   node scripts/social/challenge-cards.mjs --html-only  just the HTML, no browser
 *
 * Output: assets/social/challenge/*.png  (1200×1200, one per card)
 *         assets/social/challenge/fpl-challenge-gw2-gw5.pdf  (the same cards, one per page)
 *
 * Copy comes from ./challenge-copy.mjs; the picks it summarises live in
 * docs/benchmarks/fpl-challenge-gw2-gw5.json and are checked against it by
 * dev/test-challenge-picks.mjs.
 *
 * The two guards from render.mjs are kept, because both failures have actually
 * happened in this repo and neither shows up in an exit code: a card rendered
 * in the fallback face because the webfonts never loaded, and a card whose
 * content runs past its own padding box while scrollHeight still calls it
 * clean. A deck of six multiplies both risks, so every page is asserted.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CARDS, DECK } from './challenge-copy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'assets', 'social', 'challenge');
const BUILD = join(HERE, '.challenge-build');

const esc = (s) => String(s).replace(/&(?![a-z]+;|#)/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* Copy carries deliberate <b> and <em>; unescape just those two back.
   The first version escaped "<" but not ">", so this pattern — which looked for
   a matching &gt; — never fired and every card printed a literal "<em>" in its
   headline. Neither guard could see it: the faces loaded and nothing overflowed.
   Escaping both ends is what makes the pair symmetric and this regex true. */
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|em)&gt;/g, '<$1$2>');

const STYLE = `
:root{
  --bg:#080b0f; --panel:#101820; --line:rgba(147,162,174,.18);
  --green:#1f9d5c; --green-lit:#2ecf73;
  --ink:#eef3f7; --ink2:#93a2ae; --ink3:#5f6d78; --amber:#d8a13a;
  --display:'Bricolage Grotesque',system-ui,sans-serif;
  --body:'Public Sans',system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink);font-family:var(--body)}
.card{
  width:1200px;height:1200px;padding:56px 64px;display:flex;flex-direction:column;
  background:
    radial-gradient(900px 560px at 84% -10%,rgba(31,157,92,.20),transparent 62%),
    radial-gradient(760px 620px at -10% 112%,rgba(31,157,92,.10),transparent 62%),
    linear-gradient(168deg,#0b1016 0%,#080b0f 58%);
}
.hd{display:flex;align-items:center;gap:14px}
.mark{width:46px;height:46px;flex:none}
.brand{font-family:var(--display);font-size:24px;font-weight:800;letter-spacing:-.02em}
.brand span{font-weight:600;color:var(--ink2)}
.kind{
  margin-left:auto;font-family:var(--mono);font-size:15px;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:var(--green);border:1px solid rgba(31,157,92,.45);
  border-radius:999px;padding:8px 16px;background:rgba(31,157,92,.10);
}
/* Everything between the brand header and the risk footer sits in .zone and is
   sized in em, so a single font-size on .zone scales the whole middle of the
   card. The fit loop in the page then shrinks it until the card fits its own
   padding box. Cards carry different amounts of copy — three picks on one, five
   plus an opponent table on another — and hand-tuning each one means the next
   copy edit silently overflows again. */
.zone{font-size:calc(16px * var(--s,1));flex:none}
.kicker{
  margin-top:1.63em;font-family:var(--mono);font-size:1em;font-weight:700;letter-spacing:.16em;
  text-transform:uppercase;color:var(--ink3);
}
h1{font-family:var(--display);font-size:4.13em;line-height:.98;font-weight:800;
  letter-spacing:-.035em;margin-top:.15em}
h1 em{font-style:normal;color:var(--ink2)}
.lead{margin-top:.58em;font-size:1.5em;font-weight:600;color:var(--ink2);line-height:1.32;max-width:1010px}
.lead b{color:var(--ink);font-weight:800}
.key{
  margin-top:1.13em;border-left:3px solid var(--green);background:rgba(31,157,92,.07);
  border-radius:0 14px 14px 0;padding:.71em .95em;font-size:1.31em;font-weight:600;
  color:var(--ink2);line-height:1.34;
}
.picks{margin-top:1.13em;display:flex;flex-direction:column;gap:.69em}
.pk{
  border:1px solid var(--line);border-radius:16px;background:var(--panel);
  padding:.94em 1.25em;display:flex;gap:1.06em;align-items:flex-start;
}
.pk .rk{
  font-family:var(--mono);font-size:1em;font-weight:700;color:var(--green);
  border:1px solid rgba(31,157,92,.4);border-radius:9px;padding:.38em .69em;flex:none;
  background:rgba(31,157,92,.10);min-width:2.75em;text-align:center;
}
.pk .bd{flex:1;min-width:0}
.pk .nm{font-family:var(--display);font-size:1.81em;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.pk .mt{font-family:var(--mono);font-size:.94em;font-weight:500;color:var(--ink3);
  margin-top:.31em;letter-spacing:.03em}
.pk .wy{font-size:1.19em;font-weight:600;color:var(--ink2);line-height:1.32;margin-top:.44em}
.pk .wy b{color:var(--ink);font-weight:800}
.chips{display:flex;flex-wrap:wrap;gap:.44em;margin-top:.5em}
.chip{
  font-family:var(--mono);font-size:.88em;font-weight:700;color:var(--green-lit);
  border:1px solid rgba(46,207,115,.32);border-radius:8px;padding:.31em .63em;
  background:rgba(31,157,92,.10);letter-spacing:.04em;
}
.rows{margin-top:1.25em;display:flex;flex-direction:column;gap:.69em}
.rw{
  border:1px solid var(--line);border-radius:16px;background:var(--panel);
  padding:.94em 1.25em;display:flex;gap:1.13em;align-items:flex-start;
}
.rw .k{
  font-family:var(--mono);font-size:1.06em;font-weight:700;color:var(--green);flex:none;
  min-width:3.5em;padding-top:.19em;
}
.rw .n{font-family:var(--display);font-size:1.69em;font-weight:800;letter-spacing:-.02em;line-height:1.12}
.rw .m{font-family:var(--mono);font-size:.88em;font-weight:500;color:var(--ink3);margin-top:.31em;letter-spacing:.04em}
.rw .note{font-size:1.19em;font-weight:600;color:var(--ink2);line-height:1.32;margin-top:.38em}
.avoid{
  margin-top:.94em;display:flex;gap:1em;align-items:flex-start;
  border:1px solid rgba(216,161,58,.28);border-radius:15px;
  background:rgba(216,161,58,.07);padding:.88em 1.25em;
}
.avoid .tag{
  font-family:var(--mono);font-size:.81em;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:var(--amber);border:1px solid rgba(216,161,58,.4);border-radius:8px;padding:.38em .69em;flex:none;
}
.avoid p{font-size:1.19em;font-weight:600;color:var(--ink2);line-height:1.32}
.ft{margin-top:auto;display:flex;align-items:flex-start;gap:18px;
  border-top:1px solid var(--line);padding-top:16px}
.ft .tag{
  font-family:var(--mono);font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:var(--ink3);border:1px solid var(--line);border-radius:8px;padding:6px 11px;flex:none;
}
.ft p{font-size:17px;font-weight:600;color:var(--ink3);line-height:1.4;max-width:940px}
.ft p b{color:var(--ink2);font-weight:800}
.stamp{margin-left:auto;text-align:right;font-family:var(--mono);font-size:14px;
  font-weight:500;color:var(--ink3);flex:none;line-height:1.6}
`;

const MARK = `<svg class="mark" viewBox="0 0 38 38" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="36" height="36" rx="10" fill="#15824a"/>
      <rect x="1" y="1" width="36" height="36" rx="10" stroke="#1f9d5c" stroke-width="1.5" opacity=".55"/>
      <path d="M9 25.5 L16 17 L22 22 L30 11" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="30" cy="11" r="3.4" fill="#fff"/>
    </svg>`;

const FACE_GUARD = `<script>
const FACES = ['800 66px "Bricolage Grotesque"','600 24px "Public Sans"','800 19px "Public Sans"',
  '700 16px "JetBrains Mono"','500 15px "JetBrains Mono"'];

/* Shrink each card's middle section until it clears its own padding box. Runs
   only AFTER the faces land, because the display face decides the line breaks
   and therefore the height — fitting against the fallback face produces a
   number that is wrong the moment the real one arrives.

   Linear walk rather than a binary search: the step is the resolution of the
   answer, monotonic in a way binary search on a reflowing layout is not, and
   fifty iterations of a 1200px layout is not worth optimising. */
function fit(){
  for (const card of document.querySelectorAll('.card')) {
    const zone = card.querySelector('.zone');
    const room = () => {
      const pad = parseFloat(getComputedStyle(card).paddingBottom);
      return (card.clientHeight - pad) - card.lastElementChild.getBoundingClientRect().bottom;
    };
    let s = 1;
    while (room() < 0 && s > 0.55) { s -= 0.01; zone.style.setProperty('--s', s.toFixed(2)); }
    card.dataset.scale = s.toFixed(2);
  }
}
Promise.all(FACES.map((f) => document.fonts.load(f)))
  .then(() => document.fonts.ready)
  .then(() => { window.__FACES__ = document.fonts.size; fit(); window.__READY__ = true; });
</script>`;

function cardBody(c) {
  const picks = (c.picks || []).map((p, i) => `
      <div class="pk">
        <div class="rk">${esc(String(i + 1).padStart(2, '0'))}</div>
        <div class="bd">
          <div class="nm">${esc(p.n)}</div>
          <div class="mt">${esc(p.m)}</div>
          ${p.chips && p.chips.length ? `<div class="chips">${p.chips.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
          <div class="wy">${rich(p.why)}</div>
        </div>
      </div>`).join('');
  const rows = (c.rows || []).map((r) => `
      <div class="rw">
        <div class="k">${esc(r.k)}</div>
        <div class="bd">
          <div class="n">${esc(r.n)}</div>
          ${r.m ? `<div class="m">${esc(r.m)}</div>` : ''}
          <div class="note">${rich(r.note)}</div>
        </div>
      </div>`).join('');
  return `<div class="card">
  <div class="hd">${MARK}
    <div class="brand"><span>Gameweek</span> Edge</div>
    <div class="kind">${esc(c.badge)}</div>
  </div>
  <div class="zone">
  <div class="kicker">${esc(c.kicker)}</div>
  <h1>${rich(c.h1)}</h1>
  <p class="lead">${rich(c.lead)}</p>
  ${c.key ? `<div class="key">${rich(c.key)}</div>` : ''}
  ${picks ? `<div class="picks">${picks}</div>` : ''}
  ${rows ? `<div class="rows">${rows}</div>` : ''}
  ${c.avoid ? `<div class="avoid"><span class="tag">Avoid</span><p>${rich(c.avoid)}</p></div>` : ''}
  </div>
  <div class="ft">
    <span class="tag">Risk</span>
    <p>${rich(c.risk)}</p>
    <div class="stamp">${esc(DECK.forWhom.split(' · ')[0])}<br>Not affiliated with the<br>Premier League or FPL</div>
  </div>
</div>`;
}

const page = (inner, css) => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><title>${esc(DECK.title)}</title>
<link rel="stylesheet" href="${css}">
<style>${STYLE}</style></head><body>${inner}${FACE_GUARD}</body></html>`;

rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
mkdirSync(OUT, { recursive: true });

for (const c of CARDS) writeFileSync(join(BUILD, c.id + '.html'), page(cardBody(c), '../fonts/fonts.css'));
/* the PDF is the same cards, one per page — same markup, so it cannot drift */
writeFileSync(join(BUILD, 'deck.html'),
  page(CARDS.map(cardBody).join('\n'), '../fonts/fonts.css')
    .replace('</style>', '@page{size:1200px 1200px;margin:0}\n.card{page-break-after:always}</style>'));
console.log(`✓ ${CARDS.length} card templates + deck.html written to scripts/social/.challenge-build/`);

if (process.argv.includes('--html-only')) process.exit(0);

const { chromium } = await import('playwright');
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

let bad = 0;
for (const c of CARDS) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
  await p.goto('file://' + join(BUILD, c.id + '.html'));
  await p.waitForFunction('window.__READY__ === true', null, { timeout: 15000 });
  await p.waitForTimeout(250);
  const chk = await p.evaluate(() => {
    const el = document.querySelector('.card');
    const pad = parseFloat(getComputedStyle(el).paddingBottom);
    const last = el.lastElementChild.getBoundingClientRect().bottom;
    return { faces: window.__FACES__ || 0, over: Math.round(last - (el.clientHeight - pad)) };
  });
  if (!chk.faces) {
    console.error(`✗ ${c.id}: no webfaces loaded — this would ship in the fallback face.`);
    console.error('  Run: node scripts/social/fetch-fonts.mjs');
    bad++; await p.close(); continue;
  }
  if (chk.over > 0) {
    console.error(`✗ ${c.id}: content runs ${chk.over}px past the padding box — trim the copy.`);
    bad++; await p.close(); continue;
  }
  await p.screenshot({ path: join(OUT, c.id + '.png') });
  await p.close();
  console.log(`✓ assets/social/challenge/${c.id}.png  (1200×1200, ${chk.faces} faces)`);
}

if (!bad) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
  await p.goto('file://' + join(BUILD, 'deck.html'));
  await p.waitForFunction('window.__READY__ === true', null, { timeout: 15000 });
  await p.waitForTimeout(300);
  await p.pdf({ path: join(OUT, 'fpl-challenge-gw2-gw5.pdf'),
    width: '1200px', height: '1200px', printBackground: true, pageRanges: `1-${CARDS.length}` });
  await p.close();
  console.log(`✓ assets/social/challenge/fpl-challenge-gw2-gw5.pdf  (${CARDS.length} pages)`);
}

await browser.close();
process.exitCode = bad ? 1 : 0;
