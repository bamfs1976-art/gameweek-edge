/*
 * The chip planner, lifted out of index.html.
 *
 * Same idea as scripts/extract-engine.mjs, and for the same reason: the
 * planner is the app's, and anything that wants to run it — the offline
 * tests, a tool that checks it against the live fixture list — has to get the
 * SAME code rather than a copy that drifts. The extraction list lived inside
 * the test file until a second caller needed it; two copies of a list like
 * this stay in step for about a week.
 *
 * Comments are skipped before strings in the scanner. An apostrophe in prose
 * inside a block comment otherwise opens a phantom string and the capture
 * runs past the closing brace — which is exactly how dev/test-core.mjs
 * silently stopped parsing once.
 */

export function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0, inStr = null, esc = false, com = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (com) { if (com === 1 && ch === '\n') com = 0; else if (com === 2 && ch === '*' && nx === '/') { com = 0; j++; } continue; }
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { com = 1; j++; continue; }
    if (ch === '/' && nx === '*') { com = 2; j++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced');
}

export function buildChipApi(html) {
  const grabFn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
  const grabConst = (n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); };
  /* Some names exist both at top level and shadowed inside a function; anchor
     to the line start so the sandbox gets the one the app's top-level code
     sees. */
  const grabTopConst = (n) => { const i = html.indexOf('\nconst ' + n + '=') + 1; return html.slice(i, html.indexOf('\n', i)); };

  return new Function(
    grabConst('CHIP_HALF_END') + '\n' + grabConst('MIN_CLUBS_FOR_XI') + '\n' +
    /* The playable-week threshold is derived from the live club cap now. */
    grabConst('RULES_FALLBACK') + '\nlet RULES=RULES_FALLBACK;\n' + grabFn('minClubsForXi') + '\n' +
    grabFn('captainEligible') + '\n' +
    grabConst('INTL_GAP_DAYS') + '\n' + grabConst('WC_BREAK_BONUS') + '\n' +
    /* Break effects scale with how long the break actually is. */
    grabConst('BREAK_BASE_DAYS') + '\n' + grabConst('WC_BREAK_BONUS_LONG') + '\n' +
    grabFn('breakSeverity') + '\n' + grabFn('breakScale') + '\n' +
    grabConst('WC_EARLY_PENALTY') + '\n' + grabConst('BB_EARLY_PENALTY') + '\n' +
    grabConst('TIE_FDR') + '\n' + grabConst('CHIP_SEPARATION') + '\n' +
    grabConst('CHIP_PROVISIONAL_FROM') + '\n' + grabConst('WC_HORIZON_WEEKS') + '\n' +
    grabFn('wcHorizonFactor') + '\n' + grabConst('BB_RUNIN_PENALTY') + '\n' +
    /* ftCap() reads RULES.maxFt, which the app fills from game_config at boot.
       There is no boot here, so RULES stays the fallback and the accessor
       returns the same five the constant always did — the planner is graded
       on its arithmetic, not on which rulebook it was handed. RULES itself is
       already declared above. */
    grabConst('FT_CAP') + '\n' + grabFn('ftCap') + '\n' + grabConst('CARRY_HORIZON') + '\n' +
    grabFn('deadWeight') + '\n' + grabFn('transferRunway') + '\n' +
    grabConst('LEDGER_MAX') + '\n' + grabTopConst('CHIP_LABEL') + '\n' +
    grabFn('freeTransfersFrom') + '\n' + grabFn('transferLedger') + '\n' +
    /* The shared "still to be played" rule the planning surfaces read.
       Both extracted functions filter through it, so it travels with them. */
    grabFn('fixtureOver') + '\n' + grabFn('fixtureToCome') + '\n' +
    'const teamShort=(b,t)=>"T"+t;\n' + grabFn('clubFdrRuns') + '\n' +
    grabFn('intlBreakGws') + '\n' +
    grabConst('CONGEST_GAP_DAYS') + '\n' + grabConst('BB_CONGEST_PENALTY') + '\n' +
    grabFn('congestedGws') + '\n' +
    grabFn('chipHalfWindow') + '\n' + grabFn('fdrGameweeks') + '\n' + grabFn('chipPlanFdr') + '\n' +
    /* The OTHER chip view the app ships. chipPlanFdr ranks weeks on raw
       difficulty and knows nothing about who owns whom; chipSwings weights
       the same difficulty by ownership, which is a different question and
       gives different answers. The app shows both, on separate pages. This
       extraction shipped only the first, so the offline tool answered the
       fixture question and looked like it had answered the chip question. */
    grabFn('chipSwings') + '\n' +
    'return {chipHalfWindow,fdrGameweeks,chipPlanFdr,chipSwings,intlBreakGws,congestedGws,clubFdrRuns,' +
    'wcHorizonFactor,breakSeverity,breakScale,' +
    'deadWeight,transferRunway,freeTransfersFrom,transferLedger,minClubsForXi};'
  )();
}
