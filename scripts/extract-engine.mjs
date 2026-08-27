/* Gameweek Edge — shared engine extraction.
 *
 * The model — the Poisson/Dixon-Coles match layer, the expected-points layer
 * and the squad optimiser — lives in index.html, and things outside the app
 * need to run it: the daily-content renderer publishes numbers from it, and
 * the engine tests grade it. Every one of them must run the SAME code, or
 * what gets published is a slowly-rotting copy of what ships.
 *
 * Euro Matchday Edge was the original reason this existed — a second app on
 * the same model. That app has been removed; the extraction outlived it,
 * because sharing the model with a renderer poses the identical problem.
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
 * `window.GEEngine`, which a consumer evaluates in its own context.
 *
 * Consumers: scripts/content/model.mjs (the daily-content renderer) and
 * dev/test-engine.mjs, which asserts the emitted bundle produces the same
 * answers as the model inside the app.
 */
import { readFileSync } from 'node:fs';

/* ── A scanner that is actually correct, and now the only one ────────
   This used to open by contrasting itself with "the test suite's extractor",
   which tracked strings and sometimes comments but not regex literals — so
   extracting `esc`, whose body contains the character class /[&<>"']/g,
   silently swallowed everything up to the next stray quote. That was true of
   fourteen separate copies of the idea across eighteen files, each repaired
   only when it happened to bite the file it was in.

   There is no contrast to draw any more: dev/extract.mjs delegates here, and
   every suite and probe goes through it. This is the repository's scanner.
   It was already the strongest of the fourteen — the only one that also
   skips `${...}` interpolation inside template literals, and the only one
   with a test file of its own — which is why consolidation moved TO it
   rather than replacing it.

   Getting this wrong is worse here than in a test that only reads the
   result: an over-captured function would drag half the app into the shared
   engine.

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

  /* Who else is at the club for that shirt. A club preview lives on this:
     when two centre-backs leave in a window, the ones who remain are nailed,
     and no amount of last season's minutes can tell you that on its own. */
  'clubDepth',

  /* Two reads of a club's record that a fixture ticker cannot give. The venue
     split says whether this is a different side at home; clubVsPoorAttacks
     says whether a kind fixture actually becomes a clean sheet — the club
     thread's answer to "the run looks green, but does this defence cash it
     in". Both go silent below their sample floor. */
  'clubSplit', 'clubVenueVerdict', 'poorAttacks', 'clubVsPoorAttacks',

  /* Expected points from first principles, and its inputs. `dcHitProb` and
     `savePts` are not called by the app directly — nativeXP calls them — but
     an extraction that omits a callee produces an engine that parses, loads,
     and then throws the first time a projection is asked for. */
  'nativeXP', 'effGoalRate', 'negRate90', 'concedePts', 'recencyWeight', 'availAttackMult',
  'dcHitProb', 'savePts', 'dcRate90', 'dcThreshold',

  /* Out-of-position threat: a defender who attacks is scored on a defender's
     tariff, which is the single most exploitable classification in the game
     and the reason a club preview names one full-back over another. */
  'oopThreat', 'oopQuantile', 'oopBenchmarks', 'oopFlag',

  /* Set-piece duty, straight off the bootstrap's order fields. A club preview
     names the taker because a penalty is the most reliable goal in the game;
     confTier comes along because setPieceConfidence calls it. */
  'confTier', 'setPieceConfidence',

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
  /* Squad-competition thresholds, used by clubDepth. */
  'DEPTH_TIE', 'DEPTH_FRINGE', 'DEPTH_MAX',
  /* Corner-side tariff, read by setPieceConfidence. The register and club
     name map stay behind — they are Premier League research, and the second
     app is a different competition, so shipping them would be dead weight
     that reads as coverage. Without a side the tariff falls back to the
     population figure, which is the right answer for a league we have no
     corner research for. */
  'CORNER_XP',
  /* Match model coefficients and the score-grid size. */
  'PLSIM', 'PLSIM_PROMOTED', 'PLSIM_ALIAS', 'LG_GRID',
  /* Elo-derived priors for clubs with no offline fit. */
  'ELO_SCALE', 'ELO_ATT', 'ELO_DEF', 'ELO_CLAMP',
  /* Fixture congestion: how a midweek match suppresses the next start. */
  'CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH',
  /* Out-of-position thresholds. */
  'OOP_MIN_MINUTES', 'OOP_PCTL', 'OOP_STRONG_PCTL', 'OOP_MID_PCTL',
  'OOP_MID_STRONG_PCTL', 'OOP_LOW_PCTL', 'OOP_MIN_POOL',
  /* Sample floors for the two club-record splits. */
  'SPLIT_MIN_GAMES', 'SPLIT_EDGE', 'OPP_SPLIT_MIN',
  /* Squad rules and the transfer solver's valuation terms. */
  'RULES_FALLBACK', 'BENCH_W', 'FT_LADDER', 'FT_CAP',
  /* The points table. Read by pointsDist / squadSim / nativeXP, which used to
     restate it inline; the engine needs the same binding the app has or those
     three throw on their first call. */
  'SCORING_FALLBACK',
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
  /* Same hoisting reason as RULES: the projection functions close over
     SCORING, and the assignment has to wait for SCORING_FALLBACK below. */
  var SCORING;
  /* plsimRatings memoises its fit. In the app that lands in the shared cache;
     here the engine gets its own private store, so the second app's ratings
     can never collide with anything else on the page. */
  var MEM = {};
${parts.map((p) => '  ' + p.replace(/\n/g, '\n  ')).join('\n')}

  /* The engine ships FPL's squad shape as the default; an app with different
     rules calls GEEngine.setRules() at boot with its own. */
  RULES = RULES_FALLBACK;
  SCORING = SCORING_FALLBACK;

  window.GEEngine = {
    ${names.join(', ')},
    setRules: function (r) { RULES = r || RULES_FALLBACK; },
    getRules: function () { return RULES; },
    /* A competition with a different points table sets it here, exactly as it
       sets its squad rules. Defaults to FPL's. */
    setScoring: function (s) { SCORING = s || SCORING_FALLBACK; },
    getScoring: function () { return SCORING; }
  };
})();
`;
}

export function extractEngine(indexPath) {
  return buildEngine(readFileSync(indexPath, 'utf8'));
}

/* ── Unresolved-reference check ──────────────────────────────────────
   The failure mode this exists to prevent: someone improves the model in
   index.html, `nativeXP` starts calling a new helper, the extraction still
   parses and still loads — and the second app throws the first time anyone
   asks for a projection. That is a silent break of the other app caused by
   a change that looks entirely local.

   So the emitted bundle is scanned for names it CALLS but never DEFINES.
   Comments and every kind of literal are stripped first, so a function name
   mentioned in prose is not mistaken for a call. Called-but-undefined is the
   detectable subset — it covers helper functions, which is what actually
   goes missing — and dev/test-engine.mjs additionally executes the model. */
const JS_GLOBALS = new Set([
  'Math', 'JSON', 'Object', 'Array', 'Number', 'String', 'Boolean', 'Date', 'RegExp',
  'Map', 'Set', 'Error', 'Promise', 'Float64Array', 'Float32Array', 'Int32Array',
  'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'console', 'undefined', 'NaN', 'Infinity'
]);
const JS_KEYWORDS = new Set(('if else for while return function const let var new typeof ' +
  'instanceof in of do break continue switch case default try catch finally throw delete ' +
  'void null true false class extends super yield await async').split(' '));

export function unresolvedReferences(bundle) {
  const code = bundle
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(\\.|[^'\\])*'/g, "''")
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/`(\\.|[^`\\])*`/g, '``');

  const declared = new Set(['window', 'GEEngine', 'RULES', 'MEM', 'arguments']);
  const add = (n) => { if (n) declared.add(n); };
  for (const m of code.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  /* `const LG_GRID=11,LG_MAXG=10` declares two names; the rule above sees one. */
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().match(/^([A-Za-z_$][\w$]*)\s*=/);
      if (n) add(n[1]);
    }
  }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*[:=]\s*function/g)) add(m[1]);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  /* parameter lists and destructuring targets */
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const a of m[1].split(',')) add(a.trim().replace(/[{}[\]]/g, '').split(/[=:.\s]/)[0]);
  }
  for (const m of code.matchAll(/(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g)) {
    for (const a of m[1].split(',')) add(a.trim().split(/[=:\s]/)[0]);
  }

  const missing = new Map();
  const flag = (n) => {
    if (declared.has(n) || JS_GLOBALS.has(n) || JS_KEYWORDS.has(n)) return;
    missing.set(n, (missing.get(n) || 0) + 1);
  };
  /* A call site, excluding property access (`x.foo(`) and keywords. */
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) flag(m[1]);
  /* And bare SCREAMING_CASE references. A missing constant is not a call, so
     the rule above cannot see it — which is exactly how OOP_STRONG reached a
     run and threw. This codebase spells every module-level constant that way,
     so the convention is a reliable enough signal to check.
     A trailing `:` means an object key (`PLSIM={BASE_H:1.62}`), which is a
     definition rather than a reference and must not be flagged. */
  for (const m of code.matchAll(/(?<![.\w$])([A-Z][A-Z0-9_]{2,})(?![\w$])(?!\s*[(:])/g)) flag(m[1]);
  return [...missing.keys()].sort();
}
