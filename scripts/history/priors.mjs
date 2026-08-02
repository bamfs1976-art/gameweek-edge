/* The history prior engine — extracted from index.html, not reimplemented.
 *
 * This repo has one hard rule about model code (see scripts/extract-engine.mjs):
 * index.html is the single source of truth, and everything else pulls the named
 * functions out of it so that what gets tested is what actually ships. A second
 * copy of the prior maths living here would drift from the one the Draft panel
 * uses, and the tests would go on passing while the app went wrong.
 *
 * So this module is a thin adapter: it lifts histSeasonWeight, histBuildPriors,
 * histFallbacks and histPriorFor out of index.html verbatim and re-exports them
 * under the names the tests and the backtest use.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* Same brace-matching extractor the other dev tests use. */
function extractBlock(src, startIdx) {
  if (startIdx < 0) throw new Error('function not found in index.html');
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced block');
}
const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));

const versionMatch = html.match(/const HIST_PRIOR_VERSION\s*=\s*'([^']+)'/);
export const PRIOR_VERSION = versionMatch ? versionMatch[1] : '';

const engine = new Function(
  [
    "const histYear=s=>parseInt(String(s).slice(0,4),10)||0;",
    /* histPriorIndex memoises onto the app's global scratch object. Node has
       no such global, so supply an empty one — the memoisation then behaves
       exactly as it does in the browser. */
    'const MEM={};',
    grabFn('histCols'),
    grabFn('histLatestSeason'),
    grabFn('histSeasonWeight'),
    grabFn('histFallbacks'),
    grabFn('histBuildPriors'),
    grabFn('histPriorIndex'),
    grabFn('histShape'),
    grabFn('histPriorFor'),
    /* The engagement layer formats as it goes, so give it the two presentation
       helpers it borrows from the app. Neither affects any value under test. */
    'const fmtNum=n=>Number(n).toLocaleString();',
    "const POS_SHORT={1:'GKP',2:'DEF',3:'MID',4:'FWD',5:'MNG'};",
    grabFn('histCareers'),
    grabFn('histDayKey'),
    grabFn('histDaySeed'),
    grabFn('histMysteryPool'),
    grabFn('histMystery'),
    'return {histCols,histLatestSeason,histSeasonWeight,histFallbacks,histBuildPriors,histPriorIndex,histShape,histPriorFor,histCareers,histDaySeed,histMystery,histMysteryPool};',
  ].join('\n'),
)();

export const seasonWeight = engine.histSeasonWeight;
export const fallbacksFor = engine.histFallbacks;
export const priorIndex = engine.histPriorIndex;
export const shapeFor = engine.histShape;
export const careersOf = engine.histCareers;
export const mysteryFor = engine.histMystery;
export const mysteryPool = engine.histMysteryPool;
export const daySeed = engine.histDaySeed;

/* The Draft board's pre-season projection, lifted whole so the test grades the
   function the panel actually calls. */
export const draftXP6 = new Function(
  grabFn('draftXP6') + '\nreturn draftXP6;',
)();

/* Default shape is a plain Map of code → prior. Pass { withLookup: true } to
   also get priorFor, which resolves an unknown code to a flagged positional
   fallback instead of undefined. */
export function buildPriors(H, opts) {
  const priors = engine.histBuildPriors(H);
  if (!opts || !opts.withLookup) return priors;
  const fallbacks = engine.histFallbacks(H);
  return {
    priors,
    fallbacks,
    priorFor: (code, o) => engine.histPriorFor(priors, fallbacks, code, o),
  };
}
