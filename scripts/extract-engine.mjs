/* Gameweek Edge — shared engine extraction.
 *
 * Two apps now run on this model: Gameweek Edge (Fantasy Premier League) and
 * Euro Matchday Edge (UEFA Champions League Fantasy). The model
 * itself — the Poisson/Dixon-Coles match layer, the expected-points layer and
 * the squad optimiser — is the same code in both, and it must stay that way:
 * a fix to the minutes model should land in both apps or the second one is a
 * slowly-rotting copy.
 *
 * The obvious way to share it would be to move the model into modules and
 * import it. That is exactly what we must NOT do, and the reason is the test
 * suite: eleven test files and both backtests locate model functions BY NAME
 * inside index.html and evaluate them verbatim, so that what is graded is
 * what ships. Moving the model out would silently un-test it.
 *
 * So index.html stays the single source of truth, and this script does at
 * build time what the tests do at test time: pull the named, league-agnostic
 * functions out and emit them as a plain script that assigns them to
 * `window.GEEngine`. Euro Matchday Edge loads that.
 *
 * Run via scripts/build-web.mjs. Emits www-ucl/engine.js.
 */
import { readFileSync } from 'node:fs';

/* ── A scanner that is actually correct ──────────────────────────────
   The test suite's extractor tracks strings and (in places) comments, but
   not regex literals — which is why extracting `esc`, whose body contains
   the character class /[&<>"']/g, silently swallows everything up to the
   next stray quote. That bug is harmless in a test that only reads the
   result, and NOT harmless here: an over-captured function would drag half
   the app into the shared engine.

   This scanner therefore tracks all five things that can contain a brace or
   a quote and not mean it: single/double strings, template literals, line
   comments, block comments and regex literals. Regex-versus-division is
   decided the way every small JS lexer decides it — by whether the previous
   meaningful token can end an expression. A bare "was the last character a
   word character" test is not enough: `return /[}]/.test(s)` ends in `n` and
   would be read as division, so the keywords that can precede a regex are
   checked too. */
const ENDS_EXPR = /[\w$\])]$/;
const KEYWORD_BEFORE_REGEX =
  /(^|[^\w$])(return|typeof|instanceof|new|delete|void|throw|case|in|of|do|else|yield|await)$/;
/* True when a `/` at this point starts a regex literal rather than a division. */
function regexCanStart(tail) {
  return !ENDS_EXPR.test(tail) || KEYWORD_BEFORE_REGEX.test(tail);
}

export function sliceBalanced(src, startIdx, open = '{', close = '}') {
  const from = src.indexOf(open, startIdx);
  if (from < 0) throw new Error('no opening ' + open + ' after index ' + startIdx);
  let depth = 0;
  let tail = '';                       /* recent meaningful chars, for regex detection */
  const push = (c) => { tail = (tail + c).slice(-16); };
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];

    /* comments */
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; if (i < 1) break; continue; }

    /* strings and template literals */
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      for (; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === quote) break;
        /* `${ ... }` can nest anything, braces included — skip it wholesale */
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          const inner = sliceBalanced(src, i + 1);
          i += inner.length;
        }
      }
      push(quote);
      continue;
    }

    /* regex literal — only where a regex can legally start */
    if (c === '/' && regexCanStart(tail)) {
      i++;
      let inClass = false;
      for (; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        else if (src[i] === '\n') break;      /* not a regex after all */
      }
      push('/');
      continue;
    }

    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(startIdx, i + 1); }

    if (!/\s/.test(c)) push(c);
  }
  throw new Error('unbalanced ' + open + close + ' from index ' + startIdx);
}

/* ── What the second app inherits ────────────────────────────────────
   Everything here must be league-agnostic: it may know about football, but
   never about the Premier League specifically, and never about a fantasy
   game's mechanics. Anything that reads GAME, RULES-as-a-global, the DOM or
   an FPL endpoint belongs in the app, not the engine.

   Grouped so it is obvious what a new entry is joining. */
export const ENGINE_FNS = [
  /* Match model: Poisson + Dixon-Coles, and the fixture-difficulty lens
     built on top of it. Pure maths over fixtures and results. */
  'poisson', 'plsimRatings', 'plsimMatch', 'plsimPrior', 'eloPrior', 'eloMean',
  'lgScoreGrid', 'lgCleanSheets', 'fdrAttack', 'fdrDefence',

  /* Minutes and congestion: how likely a player is to be on the pitch, and
     how a midweek fixture three days earlier changes that. Competition-blind
     by construction — it counts matches, it does not care whose they are. */
  'recentMinutes', 'minutesModel', 'minutesSecurity', 'congestionLoad', 'congestionFactor',

  /* Expected points from first principles, and its inputs. */
  'nativeXP', 'effGoalRate', 'negRate90', 'concedePts', 'recencyWeight', 'availAttackMult',

  /* Distribution helpers used by the simulators. */
  'normCdf', 'pointsDist', 'squadSim',

  /* Squad construction: best XI and the constrained optimiser. Both read
     their shape from a rules object rather than assuming 15/11/3. */
  'bestXI', 'squadOptimise', 'fplRules', 'minClubsForXi',
];

/* Constants the functions above close over. Missing one is not a build
   error — it is a ReferenceError the first time a panel calls the function —
   so dev/test-engine.mjs executes the bundle and exercises the model rather
   than only checking that it parses. */
export const ENGINE_CONSTS = [
  /* Match model coefficients and the score-grid size. */
  'PLSIM', 'PLSIM_PROMOTED', 'PLSIM_ALIAS', 'LG_GRID',
  /* Elo-derived priors for clubs with no offline fit. */
  'ELO_SCALE', 'ELO_ATT', 'ELO_DEF', 'ELO_CLAMP',
  /* Fixture congestion: how a midweek match suppresses the next start. */
  'CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH',
  /* Squad rules and the transfer solver's valuation terms. */
  'RULES_FALLBACK', 'BENCH_W', 'FT_LADDER', 'FT_CAP',
];

function grabFn(html, name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('engine function not found in index.html: ' + name);
  return sliceBalanced(html, at);
}
function grabConst(html, name) {
  const at = html.indexOf('const ' + name + '=');
  if (at < 0) throw new Error('engine constant not found in index.html: ' + name);
  /* Object/array literals span lines; scalars do not. Detect which. */
  const eq = html.indexOf('=', at) + 1;
  const firstReal = html.slice(eq).match(/\S/);
  const ch = firstReal ? firstReal[0] : '';
  if (ch === '{' || ch === '[') {
    return html.slice(at, eq) + sliceBalanced(html, eq, ch, ch === '{' ? '}' : ']') + ';';
  }
  return html.slice(at, html.indexOf('\n', at));
}

export function buildEngine(html) {
  const parts = [];
  for (const c of ENGINE_CONSTS) parts.push(grabConst(html, c));
  for (const f of ENGINE_FNS) parts.push(grabFn(html, f));

  const names = [...ENGINE_CONSTS, ...ENGINE_FNS];
  return `/* Gameweek Edge shared engine — GENERATED, do not edit.
   Extracted verbatim from index.html by scripts/extract-engine.mjs so that
   both apps run the identical model and the test suite keeps grading the
   code that actually ships. Edit index.html and rebuild. */
(function(){
  /* squadOptimise and bestXI read the squad shape from RULES. \`var\` so the
     declaration hoists above the extracted functions that close over it; the
     assignment waits until RULES_FALLBACK is actually initialised below. */
  var RULES;
  /* plsimRatings memoises its fit. In the app that lands in the shared cache;
     here the engine gets its own private store, so the second app's ratings
     can never collide with anything else on the page. */
  var MEM = {};
${parts.map((p) => '  ' + p.replace(/\n/g, '\n  ')).join('\n')}

  /* The engine ships FPL's squad shape as the default; an app with different
     rules calls GEEngine.setRules() at boot with its own. */
  RULES = RULES_FALLBACK;

  window.GEEngine = {
    ${names.join(', ')},
    setRules: function (r) { RULES = r || RULES_FALLBACK; },
    getRules: function () { return RULES; }
  };
})();
`;
}

export function extractEngine(indexPath) {
  return buildEngine(readFileSync(indexPath, 'utf8'));
}
