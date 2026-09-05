// Guard the share cards.
//
// A share card is the one artefact that leaves the site. Nobody who sees it
// on a timeline can check it against the page, so the two things worth
// pinning are that it says what the app says and that it cannot lose its
// identity — the same reasoning as pl-bookings' scripts/check-share.mjs, which
// this follows: the renderer runs in a VM with a stub canvas that RECORDS
// every draw call instead of rasterising, and the assertions are about the
// text drawn. Pixels would fail on a font substitution and pass on a wrong
// number, which is backwards.
//
// One rule is this app's own: NO BETTING LANGUAGE on a Gameweek Edge card.
// The vendored renderer's desk cards draw the 18+ / BeGambleAware line in
// their shared footer, so the Gameweek Edge composer must never route through
// them, and every card is scanned for the words.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function stubCtx(drawn) {
  const noop = () => {};
  return {
    canvas: null,
    set fillStyle(v) {}, get fillStyle() { return '#000'; },
    set strokeStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {}, set lineJoin(v) {},
    set font(v) { this._font = v; }, get font() { return this._font || ''; },
    set textAlign(v) { this._align = v; }, get textAlign() { return this._align || 'left'; },
    set textBaseline(v) {}, get textBaseline() { return 'alphabetic'; },
    fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, arcTo: noop, arc: noop, closePath: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: (t) => ({ width: String(t).length * 11 }),
    fillText(t) { drawn.push(String(t)); }
  };
}
function makeSandbox(drawn) {
  const ctx = {
    document: {
      createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx(drawn), toBlob: (cb) => cb({ __blob: true, size: 1024 }) }),
      fonts: { ready: Promise.resolve() }
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    setTimeout, console, Promise
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['vendor/share.js', 'vendor/save.js', 'lib/gwe-share.js']) {
    assert.ok(existsSync(join(root, f)), f + ' is missing');
    vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx);
  }
  return ctx;
}

const drawn = [];
const sb = makeSandbox(drawn);
const S = sb.PLDShare, G = sb.GWEShare;
assert.ok(S, 'vendor/share.js did not export PLDShare');
assert.ok(sb.PLDSave && typeof sb.PLDSave.file === 'function', 'vendor/save.js did not export PLDSave.file');
assert.ok(G, 'lib/gwe-share.js did not export GWEShare');

/* ---- the identity ------------------------------------------------------- */
const t = S.theme('GWE');
assert.ok(t && t.strap && t.mark && t.slug, 'the GWE theme is incomplete');
assert.ok(/^#[0-9a-f]{6}$/i.test(t.from) && /^#[0-9a-f]{6}$/i.test(t.to), 'the GWE theme has a malformed gradient');
assert.equal(t.mark, 'GAMEWEEK EDGE', 'the wordmark is the brand name from BRAND.md');
assert.ok(/gameweek edge/i.test(t.strap), 'the strap names the brand');
for (const code of Object.keys(S.THEMES)) {
  if (code === 'GWE') continue;
  assert.notEqual(S.THEMES[code].mark, t.mark, 'a desk shares the Gameweek Edge wordmark: ' + code);
  assert.notEqual(S.THEMES[code].slug, t.slug, 'a desk shares the Gameweek Edge filename slug: ' + code);
}

/* ---- the adapters say what the app says -------------------------------- */
const XI = [
  ['Raya', 'ARS', 'GKP', 4.1, 'CHE (H) 3'], ['Gabriel', 'ARS', 'DEF', 5.2, 'CHE (H) 3'], ['Van Dijk', 'LIV', 'DEF', 4.9, 'HUL (A) 1'],
  ['Cucurella', 'CHE', 'DEF', 4.4, 'ARS (A) 4'], ['Salah', 'LIV', 'MID', 9.4, 'HUL (A) 1'], ['Palmer', 'CHE', 'MID', 7.1, 'ARS (A) 4'],
  ['Saka', 'ARS', 'MID', 7.0, 'CHE (H) 3'], ['Bruno', 'MUN', 'MID', 6.2, 'COV (H) 2'], ['Rogers', 'AVL', 'MID', 5.0, 'EVE (H) 2'],
  ['Haaland', 'MCI', 'FWD', 8.7, 'BOU (A) 2'], ['Isak', 'NEW', 'FWD', 6.9, 'FUL (H) 2']
].map(([name, team, pos, xp, fixture]) => ({ name, team, pos, xp, fixture }));
const totw = G.totwSpec({ gw: 7, formation: '3-5-2', total: 68.9, players: XI });
assert.ok(/GW7/.test(totw.title), totw.title);
assert.ok(/3-5-2/.test(totw.subtitle) && /68\.9/.test(totw.subtitle), totw.subtitle);
assert.equal(totw.sections.reduce((n, s) => n + s.rows.length, 0), 11, 'the Team of the Week card does not carry eleven');
assert.ok(totw.filename.startsWith('gameweek-edge-') && /\.png$/.test(totw.filename), totw.filename);

const cap = G.captainSpec({ gw: 7, confidence: 74, picks: [
  { name: 'Salah', team: 'LIV', xp: 9.4, eo: 61, fixture: 'HUL (A) 1' },
  { name: 'Haaland', team: 'MCI', xp: 8.7, eo: 55, fixture: 'BOU (A) 2' },
  { name: 'Palmer', team: 'CHE', xp: 7.1, eo: 12, fixture: 'ARS (A) 4' }] });
assert.ok(/GW7/.test(cap.title) && /Salah/.test(cap.subtitle), cap.subtitle);
assert.equal(cap.hero.value, '18.8', 'the captain hero is the doubled xP, as the app frames it');
assert.equal(cap.sections[0].rows.length, 2, 'the alternatives are the two the app showed');

const rating = G.ratingSpec({ gw: 7, myXP: 52.3, modelXP: 68.9, share: 76, overlap: 4, weakest: 'defence' });
assert.ok(/GW7/.test(rating.title), rating.title);
assert.equal(rating.hero.value, '76%');
assert.ok(rating.stats.some((s) => s.value === '4 of 11'), 'the overlap figure is on the rating card');
assert.ok(rating.stats.some((s) => s.value === 'defence'), 'the weakest position is on the rating card');

/* ---- it draws, and draws the numbers ------------------------------------ */
const BETTING = /18\+|begambleaware|\bodds\b|\bbet\b|\bbets\b|\bacca\b|\bstake\b|\bbookmaker|\btip(s|ster)?\b|nailed on|guaranteed/i;
async function drawText(spec) {
  drawn.length = 0;
  const blob = await G.card(spec);
  assert.ok(blob && blob.__blob, 'card() did not produce a blob');
  return drawn.join('\n');
}
const text = await drawText(totw);
for (const p of XI) assert.ok(text.includes(p.name), 'the Team of the Week card never drew ' + p.name);
assert.ok(/GW7/.test(text), 'the Team of the Week card does not carry the gameweek number');
assert.ok(text.includes('GAMEWEEK EDGE'), 'the Team of the Week card lost its wordmark');
assert.ok(text.includes('gameweekedge.co.uk'), 'the Team of the Week card does not carry the URL');
assert.ok(text.includes('9.4') && text.includes('4.1'), 'the card drew figures that are not the ones it was given');
assert.ok(!BETTING.test(text), 'betting language on a Gameweek Edge card: ' + JSON.stringify(text.match(BETTING)));

const ctext = await drawText(cap);
assert.ok(/GW7/.test(ctext) && ctext.includes('Salah') && ctext.includes('18.8'), 'the captain card lost its pick or its figure');
assert.ok(ctext.includes('GAMEWEEK EDGE') && ctext.includes('gameweekedge.co.uk'), 'the captain card lost its identity');
assert.ok(!BETTING.test(ctext), 'betting language on the captain card');

const rtext = await drawText(rating);
assert.ok(/GW7/.test(rtext) && rtext.includes('76%') && rtext.includes('4 of 11'), 'the rating card lost its figures');
assert.ok(rtext.includes('GAMEWEEK EDGE') && rtext.includes('gameweekedge.co.uk'), 'the rating card lost its identity');
assert.ok(!BETTING.test(rtext), 'betting language on the rating card');

/* ---- the composer never routes through a desk card ---------------------- */
const gwe = readFileSync(join(root, 'lib', 'gwe-share.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
for (const fn of ['matchCard', 'roundCard', 'calendarCard', 'statSheetCard', 'rankCard', 'accaCard', 'accaStrip']) {
  assert.ok(!new RegExp('\\b' + fn + '\\b').test(gwe),
    'lib/gwe-share.js calls the desk card ' + fn + '() — its footer carries the 18+ line and the acca strip carries odds');
}
/* And the app saves through PLDSave, never a bare anchor. */
const index = readFileSync(join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
assert.equal((index.match(/\.download\s*=/g) || []).length, 0,
  'index.html sets a.download directly instead of going through PLDSave — that button does nothing on an iPhone');
for (const need of ['vendor/share.js', 'vendor/save.js', 'lib/gwe-share.js']) {
  assert.ok(index.includes('<script src="' + need + '"'), 'index.html does not load ' + need);
}
assert.ok(/GWEShare\.(totwSpec|captainSpec|ratingSpec)/.test(index), 'index.html never builds a card through the adapters');

console.log('check-share OK: GWE theme registered, three adapters draw their figures, the XI, the gameweek, the wordmark and the URL, with no betting language');
