/*
 * Why is a gameweek card missing from the studio?
 *
 * Reported: of the six cards built from a settled gameweek, only THE
 * WEEK'S BIGGEST HAULS and THE WEEK IN NUMBERS appear. The other four are
 * absent with nothing on screen to say why — socialSpecs registers every
 * preset inside a try/catch and each builder returns null below its own
 * minimum row count, so "did not build" and "threw" and "not enough rows"
 * all look identical from the outside: nothing.
 *
 * This asks the live API and prints, per card, the number the gate is
 * actually comparing and the floor it has to clear. A card missing because
 * the feed carries no such field is a different problem from one missing
 * because five players did not clear a threshold, and the fix differs.
 *
 * It runs the SHIPPED functions, extracted from index.html rather than
 * retyped: a retyped copy grades my understanding of the code instead of
 * the code, and if the two drift the copy passes while the app stays broken.
 *
 * RUN IT FROM A RUNNER. fantasy.premierleague.com is unreachable from the
 * build sandbox, so this is wired into .github/workflows/fpl-endpoints.yml.
 *
 * Run: node dev/fpl-card-gates.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const BASE = 'https://fantasy.premierleague.com/api';
const UA = 'Mozilla/5.0 (compatible; GameweekEdgeProbe/1.0)';
const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(p + ' → ' + r.status);
  return r.json();
};

/* Same brace matcher the test harness uses, regex literals included. */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === '/') {
      let k = j - 1;
      while (k >= 0 && /\s/.test(src[k])) k--;
      const prev = k >= 0 ? src[k] : '';
      let word = '';
      for (let w = k; w >= 0 && /[A-Za-z]/.test(src[w]); w--) word = src[w] + word;
      if (/^(return|typeof|in|of|new|case|do|else)$/.test(word) || !/[\w$)\]]/.test(prev)) {
        let cls = false;
        for (j++; j < src.length; j++) {
          const c2 = src[j];
          if (c2 === '\\') { j++; continue; }
          if (c2 === '[') cls = true; else if (c2 === ']') cls = false;
          else if (c2 === '/' && !cls) break;
          else if (c2 === '\n') break;
        }
        continue;
      }
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced');
}
const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
const grabLine = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); };
const M = new Function(
  grabLine('SCORING_FALLBACK') + '\nlet SCORING = SCORING_FALLBACK;\n'
  + grabLine('GW_PACK_DIFF') + '\n'
  + grabFn('gwPackLine') + '\n' + grabFn('gwStatsPack') + '\n' + grabFn('gwDefcon') + '\n'
  + grabFn('applyAutoSubs') + '\n' + grabFn('managerCard') + '\n'
  + 'return {gwStatsPack,gwDefcon,managerCard,GW_PACK_DIFF,SCORING};')();

const boot = await get('/bootstrap-static/');
const ev = (boot.events || []).filter((e) => e.data_checked).pop();
if (!ev) { console.log('No data_checked gameweek — every pack card is correctly absent.'); process.exit(0); }
console.log('Settled gameweek: GW' + ev.id);
console.log('');

const live = await get('/event/' + ev.id + '/live/');
const liveEls = live.elements || [];
const els = {};
(boot.elements || []).forEach((e) => { els[e.id] = e; });

/* WHICH STAT KEYS THE FEED ACTUALLY CARRIES. A gate comparing a count that
   is zero because the field is absent is a different bug from one that is
   zero because nobody qualified, and only this tells them apart. */
const keys = {};
liveEls.forEach((le) => Object.keys((le && le.stats) || {}).forEach((k) => { keys[k] = (keys[k] || 0) + 1; }));
const nonZero = (k) => liveEls.filter((le) => Number(((le || {}).stats || {})[k]) > 0).length;
console.log('live stats keys (rows carrying the key / rows with a value above zero):');
['total_points', 'bps', 'bonus', 'minutes', 'defensive_contribution', 'clean_sheets', 'saves']
  .forEach((k) => console.log('  ' + k.padEnd(24) + String(keys[k] || 0).padStart(4) + ' / ' + String(nonZero(k)).padStart(4)
    + (keys[k] ? '' : '   <-- ABSENT FROM THE FEED')));
console.log('');

const pk = M.gwStatsPack(els, liveEls, ev, 10);
const dc = M.gwDefcon(els, liveEls, M.SCORING, 999);
const hits = dc.rows.filter((r) => r.hit).length;
const numbers = Object.values(pk.numbers).filter((v) => v != null && !(Array.isArray(v) && !v.length)).length;

const row = (card, got, floor, note) => {
  const ok = got >= floor;
  console.log('  ' + (ok ? 'BUILDS ' : 'ABSENT ') + card.padEnd(22)
    + String(got).padStart(4) + ' vs floor ' + String(floor).padStart(2) + '   ' + (note || ''));
};
console.log('card                          have    needs');
row('gw-top-scorers', pk.scorers.length, 5, 'players who scored above zero');
row('gw-differentials', pk.diffs.length, 3, 'scorers under ' + M.GW_PACK_DIFF + '% owned');
row('gw-bonus', pk.bonus.length, 5, 'players with a BPS above zero');
row('gw-week-in-numbers', numbers, 3, 'populated fields on the event');
row('gw-defcon', hits, 5, 'players who cleared the threshold (of ' + dc.measured + ' measured)');
console.log('');
console.log('Each ABSENT line is a card the studio silently does not show.');
