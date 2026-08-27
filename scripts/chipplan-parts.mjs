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
 * The scanner itself now lives in dev/extract.mjs, shared with every other
 * caller. It used to be copied in here, with a note that comments are
 * skipped before strings so an apostrophe in prose cannot open a phantom
 * string. True, and not enough: this copy never learned about regex
 * literals, so /[&<>"']/ in esc() would have run the capture hundreds of
 * lines past the closing brace. Fourteen copies of this function had drifted
 * to fourteen different states of half-fixed.
 *
 * extractBlock was exported from here. Nothing outside imported it — only
 * buildChipApi — so it goes rather than being re-exported.
 */
import { extractBlock, extractFn, extractDecl } from '../dev/extract.mjs';

export function buildChipApi(html) {
  const grabFn = (n) => extractFn(html, n);
  const grabConst = (n) => extractDecl(html, n);
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
