/*
 * Unit tests for the model core of Gameweek Edge.
 *
 * The app is a single-file index.html, so there is nothing to import:
 * we locate named pure functions in the source, extract them by brace
 * matching, and evaluate them in an isolated context with minimal
 * stubs. This keeps the validated model code exactly as it ships —
 * no build step, no duplication.
 *
 * Run: node dev/test-core.mjs   (also `npm test`)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
/* The palette ranks through Fuse.js in the browser. Importing the same
   package here means the test exercises the real matcher rather than a
   mock of it — the whole point of the change was typo tolerance, and a
   mock would happily "tolerate" whatever we told it to. */
import Fuse from 'fuse.js';
import { extractArrayConst, extractBlock, extractConst, extractFn, extractLine } from './extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const aiSrc = readFileSync(join(ROOT, 'netlify/functions/ai.js'), 'utf8');

/* ── build the isolated context ─────────────────────────── */
const pieces = [
  /* SCORING is a module-level binding the projection engine reads for the
     points table — it replaced three inline copies of `type<=2?6:...`, one of
     which scored a goalkeeper's goal at 6 when the game says 10. Extracted
     here so these functions score exactly as they do in the app; without it
     they throw, which is at least loud. fplScoring comes too, so the
     derivation from game_config can be tested against a real payload. */
  ...['SCORING_FALLBACK'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  'let SCORING = SCORING_FALLBACK;',
  extractFn(html, 'fplScoring'),
  extractConst(html, 'PLSIM'),
  extractFn(html, 'poisson'),
  extractFn(html, 'plsimMatch'),
  extractFn(html, 'esc'),
  extractFn(html, 'recentMinutes'),
  /* minutesModel now discounts a start for midweek European / cup football;
     with no congestion passed, congestionFactor returns 1 and it is a no-op. */
  ...['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'congestionFactor'),
  extractFn(html, 'minutesModel'),
  extractFn(html, 'concedePts'),
  extractFn(html, 'savePts'),
  extractFn(html, 'dcHitProb'),
  extractFn(html, 'effGoalRate'),
  extractFn(html, 'negRate90'),
  extractFn(html, 'recencyWeight'),
  extractFn(html, 'availAttackMult'),
  extractFn(html, 'nativeXP'),
  extractFn(html, 'xP'),
  extractFn(html, 'fixtureXP'),
  /* The real horizonXP, renamed: transferFeatures below is tested against a
     stub of the same name, and a later function declaration would shadow
     this one. Both are wanted, so they cannot share a name. */
  extractFn(html, 'horizonXP').replace('function horizonXP(', 'function horizonXPreal('),
  extractFn(html, 'priceChangeProb'),
  extractFn(html, 'fplPriceMove'),
  extractFn(html, 'priceLocked'),
  extractFn(html, 'priceSource'),
  ...['CHIP_API_LABEL'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'teamShort'),
  extractFn(html, 'fixtureOver'),
  extractFn(html, 'fixtureToCome'),
  extractFn(html, 'gwAnchor'),
  extractFn(html, 'gwsPlayedOut'),
  extractFn(html, 'bootBehind'),
  /* gwMoved is the mechanism that makes a RUNNING app move on: boot()
     memoises its index for the life of the tab, and this is the only thing
     that ever throws it away. Its cache read is stubbed — what is under
     test is the decision, not the cache — and the recheck timer comes from
     the source so the rate limit is the shipped one. */
  'let PEEK_FX = null;\nfunction cachedPeek(){ return PEEK_FX; }\nconst FIXTURES_TTL = 1;\nfunction __setPeek(v){ PEEK_FX = v; }\nfunction __resetRecheck(){ BOOT_RECHECKED = 0; }',
  /* THE REFRESH PATH. Nothing here tested it, which is how the Refresh
     button came to preserve the single payload a manager taps Refresh to
     see. The browser's storage and the app's game scoping are stubbed —
     what is under test is the cache decision, not localStorage. */
  'const GAME={id:"fpl"};\nfunction noteData(){}\n'
    + 'const __LS={};\nconst localStorage={getItem:(k)=>(k in __LS?__LS[k]:null),'
    + 'setItem:(k,v)=>{__LS[k]=String(v);},removeItem:(k)=>{delete __LS[k];}};\n'
    + 'function __lsKeys(){return Object.keys(__LS);}',
  extractLine(html, /const MEM=\{\};/),
  extractFn(html, 'ck'),
  extractFn(html, 'cached'),
  extractLine(html, /let CACHE_FLOOR=0;/),
  extractFn(html, 'clearLiveCache'),
  extractLine(html, /const BOOT_TTL=[^;]+;/),
  ...['BOOT_RECHECK_MS'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  'let BOOT_RECHECKED = 0;',
  extractFn(html, 'gwMoved'),
  ...['RACE_TRIALS', 'RACE_SD_PRIOR', 'RACE_PRIOR_N', 'RACE_SD_FLOOR']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'raceSpread'),
  extractFn(html, 'gwsRemaining'),
  extractFn(html, 'titleRace'),
  extractConst(html, 'POS_SHORT'),
  extractFn(html, 'applyAutoSubs'),
  extractFn(html, 'rivalLivePts'),
  extractFn(html, 'tilePoints'),
  extractFn(html, 'rivalSquadRows'),
  /* managerDetail derives the gameweek score through it. */
  extractFn(html, 'rivalGwTotal'),
  /* CHIP_API_LABEL already arrives with an earlier block. */
  ...['CHIP_SHORT'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'chipStatus'),
  extractFn(html, 'rivalChipSummary'),
  extractFn(html, 'freeTransfers'),
  extractArrayConst(html, 'LEAGUE_SORTS'),
  extractFn(html, 'leagueSortSpec'),
  extractFn(html, 'sortLeagueRows'),
  extractFn(html, 'leagueStdRow'),
  extractFn(html, 'leagueAwards'),
  extractFn(html, 'leagueEO'),
  extractFn(html, 'managerDetail'),
  extractFn(html, 'leagueSwing'),
  extractFn(html, 'gwFixturesByTeam'),
  extractFn(html, 'teamGwState'),
  extractFn(html, 'playerGwStates'),
  extractFn(html, 'squadMatchday'),
  extractFn(html, 'suspCutoff'),
  extractFn(html, 'suspRisk'),
  extractFn(html, 'bestXI'),
  extractFn(html, 'minutesSecurity'),
  extractFn(html, 'projectXI'),
  extractLine(html, /const LG_GRID=\d+,LG_MAXG=\d+;/),
  extractFn(html, 'lgScoreGrid'),
  extractFn(html, 'lgCleanSheets'),
  extractLine(html, /const DRAFT_BUDGET=\d+;/),
  extractConst(html, 'DRAFT_QUOTA'),
  extractLine(html, /const DRAFT_CLUB_MAX=\d+;/),
  extractFn(html, 'draftCounts'),
  /* DRAFT_BUDGET is already extracted below by extractLine. planBudgetTenths
     reads the game's published budget out of RULES, which is a module-level
     binding in the app and therefore invisible here unless it comes too. */
  extractConst(html, 'RULES_FALLBACK'),
  'let RULES = RULES_FALLBACK;',
  'let PLAN_BUDGET = null;',
  extractFn(html, 'planBudgetTenths'),
  extractFn(html, 'plannerBudget'),
  extractFn(html, 'squadDiff'),
  extractFn(html, 'plannerMoves'),
  extractFn(html, 'draftValidate'),
  extractFn(html, 'draftCanAdd'),
  extractFn(html, 'draftMinCost'),
  extractFn(html, 'draftReserveAdd'),
  extractFn(html, 'draftBuild'),
  extractFn(html, 'draftFillGaps'),
  /* Palette search: pure, and takes the Fuse constructor as an argument
     precisely so it can be tested without a DOM or a window. */
  extractArrayConst(html, 'CMDK_KEYS'),
  extractConst(html, 'CMDK_FUSE'),
  extractFn(html, 'cmdkSearchFallback'),
  extractFn(html, 'cmdkSearch'),
  /* Sparkline geometry — the SVG fallback still has to be right, because it
     is what renders when the vendor bundle has not loaded. */
  extractFn(html, 'sparkPoints'),
  extractFn(html, 'transferMovers'),
  extractFn(html, 'gwPackEvent'),
  ...['GW_PACK_DIFF'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'gwPackLine'),
  extractFn(html, 'gwStatsPack'),
  extractFn(html, 'gwDefcon'),
  extractFn(html, 'gwDayStatus'),
  extractFn(html, 'boardDeadline'),
  extractFn(html, 'bonusForFixture'),
  extractFn(html, 'provBonusPts'),
  extractFn(html, 'managerCard'),
  ...['SOC_LADDER_X', 'SOC_LADDER_PAD', 'SOC_LADDER_LEFT']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  ...['SOC_ROW_H', 'SOC_ROW_MIN']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'socRowFont'),
  extractFn(html, 'socLadderItemX'),
  extractFn(html, 'gwPackWhy'),
  extractFn(html, 'sparkColor'),
  extractFn(aiSrc, 'fitJSON'),
  /* bestTransfer drives the dashboard/debrief suggestion; stub its only
     dependency (horizonXP) so we test the logic, not the xP maths. */
  'function horizonXP(_b, el, _hz){ return el._hx || 0; }',
  extractLine(html, /const MIN_TR_GAIN=[\d.]+;/),
  extractFn(html, 'bestTransfer'),
  ...['MATCH_MAX_MS', 'BLIND_LIVE_MS']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'fixtureStuck'),
  extractFn(html, 'gwPhase'),
  /* Section 2: decision-grade recommendation model. */
  extractFn(html, 'confTier'),
  extractFn(html, 'captainEligible'),
  extractFn(html, 'captainBand'),
  extractFn(html, 'pointsDist'),
  extractFn(html, 'squadSim'),
  extractFn(html, 'normCdf'),
  extractFn(html, 'effEdge'),
  extractFn(html, 'edgeDelta'),
  extractFn(html, 'rankEV'),
  extractFn(html, 'rankOptimiser'),
  extractFn(html, 'calibration'),
  extractFn(html, 'captainModel'),
  extractFn(html, 'captainConfidence'),
  extractFn(html, 'transferFrame'),
  extractFn(html, 'eventShape'),
  extractFn(html, 'capHintFrom'),
  extractFn(html, 'chipAdvice'),
  /* Section 3: My Week "Explain this" feature drivers. */
  extractFn(html, 'captainFeatures'),
  extractFn(html, 'transferFeatures'),
  extractFn(html, 'chipFeatures'),
  /* Section 4: Fixture Difficulty 2.0 + set-piece confidence. */
  extractFn(html, 'fdrAttack'),
  extractFn(html, 'fdrDefence'),
  extractConst(html, 'STRENGTH_KEYS'),
  extractConst(html, 'STRENGTH_BANDS'),
  extractFn(html, 'teamStrength'),
  extractFn(html, 'strengthEdge'),
  extractFn(html, 'strengthGrade'),
  /* setPieceConfidence reads the corner-side tariff, so the constant has to
     come with it. dev/test-setpiece.mjs owns the side and penalty-volume
     behaviour; these cases only assert the duty stacking is unchanged. */
  ...['CORNER_XP'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'setPieceConfidence'),
  /* Section 4 (6-13): readiness, lineup, community. */
  extractFn(html, 'benchBoostReadiness'),
  extractFn(html, 'lineupCheck'),
  extractFn(html, 'communityAggregate'),
  extractFn(html, 'topSelectedByPos'),
  extractFn(html, 'differentials'),
  extractFn(html, 'rotationPairs'),
  extractFn(html, 'bestFixtureRun'),
  /* The Fixture Planner's purple patch, and the entry-point summary read
     off the same call. */
  extractConst(html, 'FDR_PATCH_MAX'),
  extractFn(html, 'fdrGrade'),
  extractFn(html, 'fdrPatchFor'),
  extractFn(html, 'chipSwings'),
  /* Latest News feed. */
  extractFn(html, 'timeAgo'),
  extractFn(html, 'latestNews'),
  /* Pre-season readiness: season key derivation for scoped storage. */
  extractFn(html, 'seasonKeyFrom'),
  /* Pre-season readiness: promoted-club prior + bundle season cross-check. */
  extractConst(html, 'PLSIM_ALIAS'),
  extractLine(html, /const PLSIM_PROMOTED=\[[\d.,]+\];/),
  /* plsimPrior falls through to an Elo-derived prior when we have no
     offline fit for a club; absent Elo restores the old behaviour. */
  ...['ELO_SCALE', 'ELO_ATT', 'ELO_DEF', 'ELO_CLAMP']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'eloMean'),
  extractFn(html, 'eloPrior'),
  /* Fixture-planner lenses: each cell now prints its own projection. */
  extractFn(html, 'fdrOfficial'),
  extractConst(html, 'FDR_LENS'),
  extractFn(html, 'fdrLens'),
  extractFn(html, 'fdrCellValue'),
  extractFn(html, 'fdrRunTotal'),
  /* Out-of-position detection. */
  ...['OOP_MIN_MINUTES', 'OOP_PCTL', 'OOP_STRONG_PCTL', 'OOP_MID_PCTL', 'OOP_MID_STRONG_PCTL', 'OOP_LOW_PCTL', 'OOP_MIN_POOL']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'dcRate90'),
  extractFn(html, 'dcThreshold'),
  extractFn(html, 'dcReal'),
  extractFn(html, 'dcHasBasis'),
  extractFn(html, 'dcHitRate'),
  extractFn(html, 'dcHitLabel'),
  extractFn(html, 'oopThreat'),
  extractFn(html, 'oopQuantile'),
  extractFn(html, 'oopBenchmarks'),
  extractFn(html, 'oopFlag'),
  /* Set pieces pivoted club-first. */
  extractConst(html, 'SP_DUTIES'),
  extractFn(html, 'setPieceByClub'),
  extractFn(html, 'setPieceClubRows'),
  /* Rotation chains: one slot, many clubs, transfers cost something. */
  ...['ROT_SWITCH'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'rotationChain'),
  /* Club dossier: the venue split and the attack-or-defence read. */
  ...['SPLIT_MIN_GAMES', 'SPLIT_EDGE', 'LEAN_EDGE']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'clubSplit'),
  ...['OPP_SPLIT_MIN'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'poorAttacks'),
  extractFn(html, 'clubVsPoorAttacks'),
  extractFn(html, 'venueSplit'),
  ...['VALUE_MIN_FIT'].map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'valueFit'),
  extractFn(html, 'valueResiduals'),
  extractFn(html, 'clubVenueVerdict'),
  extractFn(html, 'clubLean'),
  ...['DEPTH_TIE', 'DEPTH_FRINGE', 'DEPTH_MAX']
    .map((n) => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf('\n', i)); }),
  extractFn(html, 'clubDepth'),
  extractFn(html, 'plsimPrior'),
  extractFn(html, 'bundleSeasonStale')
];
const core = new Function(
  pieces.join('\n') +
  '\nreturn {SCORING, SCORING_FALLBACK, fplScoring, cmdkSearch, cmdkSearchFallback, CMDK_KEYS, CMDK_FUSE, sparkPoints, sparkColor, transferMovers, gwPackEvent, gwPackLine, gwStatsPack, gwDefcon, managerCard, socRowFont, SOC_ROW_H, socLadderItemX, SOC_LADDER_X, SOC_LADDER_LEFT, gwPackWhy, GW_PACK_DIFF, bonusForFixture, provBonusPts, gwDayStatus, boardDeadline, plsimMatch, esc, nativeXP, xP, priceChangeProb, fplPriceMove, priceLocked, priceSource, fixtureOver, fixtureToCome, gwAnchor, gwsPlayedOut, bootBehind, gwMoved, __setPeek, __resetRecheck, BOOT_RECHECK_MS, cached, clearLiveCache, ck, MEM, __lsKeys, BOOT_TTL, raceSpread, gwsRemaining, titleRace, RACE_SD_PRIOR, squadMatchday, leagueEO, leagueAwards, LEAGUE_SORTS, leagueSortSpec, sortLeagueRows, leagueStdRow, managerDetail, freeTransfers, rivalChipSummary, CHIP_SHORT, leagueSwing, gwFixturesByTeam, teamGwState, playerGwStates, suspCutoff, suspRisk, bestXI, minutesSecurity, projectXI, lgScoreGrid, lgCleanSheets, plannerBudget, tilePoints, squadDiff, plannerMoves, draftValidate, draftCanAdd, draftBuild, draftFillGaps, fitJSON, bestTransfer, MIN_TR_GAIN, gwPhase, fixtureStuck, MATCH_MAX_MS, BLIND_LIVE_MS, confTier, captainEligible, captainBand, captainModel, captainConfidence, transferFrame, eventShape, capHintFrom, chipAdvice, captainFeatures, transferFeatures, chipFeatures, fdrAttack, fdrDefence, STRENGTH_KEYS, STRENGTH_BANDS, teamStrength, strengthEdge, strengthGrade, setPieceConfidence, benchBoostReadiness, lineupCheck, communityAggregate, topSelectedByPos, differentials, rotationPairs, bestFixtureRun, fdrGrade, fdrPatchFor, FDR_PATCH_MAX, chipSwings, timeAgo, latestNews, seasonKeyFrom, plsimPrior, eloPrior, eloMean, fdrCellValue, fdrRunTotal, fdrLens, FDR_LENS, fdrOfficial, dcRate90, dcThreshold, dcReal, dcHasBasis, dcHitRate, dcHitLabel, oopThreat, oopQuantile, oopBenchmarks, oopFlag, OOP_MIN_MINUTES, OOP_PCTL, OOP_MIN_POOL, setPieceByClub, setPieceClubRows, rotationChain, ROT_SWITCH, clubSplit, poorAttacks, clubVsPoorAttacks, OPP_SPLIT_MIN, venueSplit, valueFit, valueResiduals, VALUE_MIN_FIT, clubVenueVerdict, clubLean, SPLIT_MIN_GAMES, clubDepth, DEPTH_TIE, DEPTH_FRINGE, DEPTH_MAX, PLSIM_PROMOTED, PLSIM, PLSIM_ALIAS, bundleSeasonStale, recentMinutes, minutesModel, concedePts, savePts, dcHitProb, effGoalRate, negRate90, pointsDist, fixtureXP, horizonXPreal, recencyWeight, availAttackMult, squadSim, normCdf, effEdge, edgeDelta, rankEV, rankOptimiser, calibration};'
)();

/* ── tiny assertion harness ─────────────────────────────── */
let failures = 0, passes = 0;
function ok(cond, label) {
  if (cond) { passes++; }
  else { failures++; console.error('  ✗ ' + label); }
}
function section(name) { console.log('• ' + name); }

/* ── esc ────────────────────────────────────────────────── */
section('dcRate90: a zero is not the same as no data');
{
  /* Measured against the live bootstrap, not assumed: the per-90 field comes
     back PRESENT and set to 0 for every player with real minutes, so a
     fallback keyed on isNaN could never fire against the shape FPL actually
     sends. This is the assertion that would have caught that. */
  const F = core.dcRate90;
  ok(F({ defensive_contribution_per_90: '9.5', defensive_contribution: 0, minutes: 900 }) === 9.5,
    'a real per-90 figure is used as-is');
  const derived = F({ defensive_contribution_per_90: '0', defensive_contribution: 100, minutes: 900 });
  ok(Math.abs(derived - 10) < 1e-9,
    'a ZERO per-90 with a real season total derives the rate (' + derived + ')');
  ok(Math.abs(F({ defensive_contribution: 100, minutes: 900 }) - 10) < 1e-9,
    'and so does an absent field');
  ok(F({ defensive_contribution_per_90: '0', defensive_contribution: 0, minutes: 900 }) === 0,
    'no data anywhere still gives zero rather than an invention');
  ok(Number.isFinite(F({})), 'a bare element does not divide by zero');
  ok(core.dcThreshold({ element_type: 2 }) === 10 && core.dcThreshold({ element_type: 3 }) === 12,
    'the threshold follows the position');
}

section('dcHitLabel: "never clears it" and "never seen him" are different claims');
{
  /* The logistic in dcHitRate always returns a number, so a defender with no
     Premier League history at all came out as ~0% — visually identical to a
     defender with a full season of minutes who never hit the threshold.

     Not hypothetical. The creator DEFCON table ingested on 16 Aug had an
     entire cheapest bracket of Championship players and singled out three
     foreign-league arrivals as the season's best gambles; every one of them
     is a player this returned ~0% for, i.e. the tool was loudest exactly
     where it knew least. */
  const L = core.dcHitLabel;
  ok(L({ element_type: 2, minutes: 0, starts: 0 }) === '—',
    'a defender with no PL minutes gets no figure at all, not ~0%');
  ok(L({ element_type: 2, minutes: 0, defensive_contribution_per_90: '12.4' }) === '—',
    'and a per-90 carried over from another league does not create a basis either');
  ok(L({ element_type: 2, minutes: 2000, defensive_contribution: 0 }) === '~0%',
    'but a real season with genuinely no defensive returns still reports ~0% — '
    + 'that is a true finding and must survive');
  ok(L({ element_type: 2, minutes: 900, defensive_contribution: 100 }) === '~50%',
    'an estimate from real minutes keeps its ~ marker');
  ok(L({ element_type: 2, minutes: 2700, _ci: { dcs: 30, dchr: 0.6, dcps: 10.7 } }) === '60%',
    'a measured rate prints without the ~');
  ok(core.dcHasBasis({ element_type: 2, minutes: 1 }) === true
    && core.dcHasBasis({ element_type: 2, minutes: 0 }) === false,
    'the floor is any real minutes at all, not a threshold');
  /* The regression that motivated the whole change: these two must not look
     the same to a reader scanning the DC hit% column. */
  ok(L({ element_type: 2, minutes: 0 }) !== L({ element_type: 2, minutes: 2000, defensive_contribution: 0 }),
    'no-history and never-hit render differently');
}

section('every sandbox that extracts nativeXP supplies the scoring table');
{
  /* nativeXP stopped restating the points table inline and started reading
     SCORING. Every place that lifts it into a `new Function` has to supply
     that binding, or the extracted model throws the moment it is called —
     and these scripts are the ones nothing else exercises, so the throw
     surfaces days later on a scheduled run, or never.

     It has already happened twice. dev/backtest-history.mjs broke on a
     Saturday and was found by the following Tuesday's weekly workflow. Its
     fix carries a comment reading "three of the four places that extract it
     were updated; this one was not" — and that was wrong: THREE more were
     broken, and stayed broken, because the comment counted call sites from
     memory instead of from the directory. backtest-season, model-validate
     and simulate-gameweek all threw "SCORING is not defined" on import.

     So the list is read off disk. A new script that lifts nativeXP into its
     own sandbox is covered the day it is written, without anyone
     remembering — which is the whole difference between this and the
     comment it replaces.

     Files that go through buildEngine are deliberately not required to: the
     engine bundle declares SCORING itself. The rule is about hand-rolled
     sandboxes. */
  const dirs = ['dev', 'scripts'];
  const offenders = [];
  let checked = 0;
  for (const d of dirs) {
    for (const f of readdirSync(join(ROOT, d))) {
      if (!f.endsWith('.mjs')) continue;
      const src = readFileSync(join(ROOT, d, f), 'utf8');
      /* Only hand-rolled sandboxes. A file that merely mentions nativeXP in
         prose, or gets it from buildEngine, is not making this mistake. */
      if (!/new Function\(/.test(src) || !/\bnativeXP\b/.test(src)) continue;
      checked++;
      if (!/\bSCORING\b/.test(src)) offenders.push(d + '/' + f);
    }
  }
  ok(checked >= 5, 'the sweep found the sandboxes rather than an empty list (' + checked + ')');
  ok(!offenders.length,
     'every one supplies SCORING' + (offenders.length ? ' — missing in ' + offenders.join(', ') : ''));
}

section('extractBlock: the harness must not corrupt what it measures');
{
  /* Every assertion in this file rests on extractBlock pulling out exactly
     one function. When it over-captures the tests do not fail honestly —
     the whole sandbox stops parsing, or worse, silently tests the wrong
     code. So the scanner is tested against the things that fool it. */
  const cases = [
    ["apostrophe in a block comment", "function f(){ /* a midfielder's tariff */ return 1; }"],
    ["apostrophe in a line comment", "function f(){ // the striker's job\n return 1; }"],
    ["quote in a block comment", 'function f(){ /* he said "no" */ return 1; }'],
    ["brace in a line comment", "function f(){ // }\n return 1; }"],
    ["brace in a block comment", "function f(){ /* } */ return 1; }"],
    ["brace in a string", 'function f(){ var s = "}"; return 1; }'],
    ["brace in a template", "function f(){ var s = `}`; return 1; }"],
    ["escaped quote", "function f(){ var s = 'it\\'s'; return 1; }"],
    ["comment marker inside a string", 'function f(){ var s = "/*"; return 1; }'],
    /* REGEX LITERALS. esc() is one line and holds /[&<>"']/ — a character
       class containing both quote marks. The scanner read those as strings
       opening, lost the closing brace, and captured 638 lines instead of
       one: 35 unrelated functions and 25 top-level consts, silently, for as
       long as this file has existed. Nothing failed; the harness was simply
       evaluating a large slice of the app nobody had asked it to. */
    ["quotes inside a regex character class", `function f(){ return s.replace(/[&<>"']/g, ''); }`],
    ["a brace inside a regex", 'function f(){ return /[}]/.test(s); }'],
    ["an escaped slash inside a regex", 'function f(){ return /a\\/b/.test(s); }'],
    ["division is not a regex", 'function f(){ var a = 1; return (a) / 2 / 1; }'],
    ["a regex after a return", 'function f(){ return /"/; }']
  ];
  for (const [label, src] of cases) {
    let got = null;
    try { got = extractBlock(src, 0); } catch (_) { /* reported below */ }
    ok(got === src, 'captures exactly the function: ' + label +
      (got === src ? '' : ' — got ' + JSON.stringify(got)));
  }
  /* And the real thing: the function whose comment broke this. */
  const flag = extractFn(html, 'oopFlag');
  ok((flag.match(/^function [A-Za-z0-9_$]+\(/gm) || []).length === 1,
    'oopFlag extracts as one function, not a run-on');
  let parsed = true;
  try { new Function('return (' + flag + ')'); } catch (_) { parsed = false; }
  ok(parsed, 'and it parses on its own');

  /* EVERY ISOLATED MODEL CONTEXT MUST SUPPLY WHAT THE MODEL READS.

     Four files extract the scoring model out of index.html and evaluate it
     in a bare `new Function` context. When nativeXP started reading its
     points table from SCORING instead of restating it inline, three of the
     four were given that binding and the fourth — dev/backtest-history.mjs
     — was not. It threw "SCORING is not defined" the first time it scored a
     player. Nothing noticed for three days, because the only thing that
     runs that script is a workflow scheduled weekly.

     So the invariant is checked here rather than waiting for a Tuesday. The
     model's app-level constants are UPPER_SNAKE by convention, so they can
     be read straight off the extracted source: whatever the function
     references, the file that evaluates it has to declare. */
  {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      .replace(/'[^']*'|"[^"]*"/g, '');
    const globalsOf = (fn) => [...new Set(strip(extractFn(html, fn)).match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || [])];
    const consumers = ['dev/backtest-history.mjs', 'dev/backtest-vaastav.mjs',
      'netlify/functions/log-predictions.js'];
    const needed = [...new Set([...globalsOf('nativeXP'), ...globalsOf('minutesModel')])];
    ok(needed.includes('SCORING'),
       'the scan finds the constant that broke this (' + needed.join(', ') + ')');
    for (const rel of consumers) {
      let src = '';
      try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch (_) { /* reported below */ }
      ok(src.length > 0, rel + ' is readable');
      for (const g of needed) {
        ok(src.includes(g), rel + ' supplies ' + g + ' to the model it evaluates');
      }
    }
  }

  /* And the real one that exposed the regex hole, measured the way the
     damage was measured: by how much of the file came with it. */
  const escSrc = extractFn(html, 'esc');
  ok(escSrc.split('\n').length === 1,
     'esc extracts as the one line it is, not 638 (' + escSrc.split('\n').length + ')');
  ok((escSrc.match(/^function [A-Za-z0-9_$]+\(/gm) || []).length === 1,
     'and carries no other function with it');
}

section('esc escapes <>&"\'');
ok(core.esc('<script>') === '&lt;script&gt;', 'angle brackets escaped');
ok(core.esc('a&b') === 'a&amp;b', 'ampersand escaped');
ok(core.esc('"quoted"') === '&quot;quoted&quot;', 'double quote escaped');
ok(core.esc("it's") === 'it&#39;s', 'single quote escaped');
ok(core.esc(null) === '', 'null becomes empty string');
ok(core.esc('<>&"\'').indexOf('<') < 0 && core.esc('<>&"\'').indexOf('>') < 0, 'no raw angle brackets survive');

/* ── plsimMatch: probabilities normalise ────────────────── */
section('plsimMatch probabilities normalise');
const R = { att: { 1: 1.15, 2: 0.85 }, def: { 1: 0.9, 2: 1.1 }, hom: { 1: 1.05, 2: 1.0 } };
const m = core.plsimMatch(R, 1, 2);
ok(m !== null, 'returns a forecast');
ok(Math.abs(m.pH + m.pD + m.pA - 1) < 1e-6, 'W/D/L probabilities sum to 1');
for (const k of ['pH', 'pD', 'pA', 'csH', 'csA', 'h3', 'a3']) {
  ok(m[k] >= 0 && m[k] <= 1, k + ' within [0,1]');
}
ok(m.hx > 0 && m.ax > 0, 'expected goals positive');
ok(core.plsimMatch(R, 1, 99) === null, 'unknown team yields null');
const mStrong = core.plsimMatch({ att: { 1: 1.4, 2: 0.7 }, def: { 1: 0.7, 2: 1.4 }, hom: { 1: 1.05 } }, 1, 2);
ok(mStrong.pH > m.pH, 'stronger home side raises home win probability');

/* ── xP / nativeXP: finite, non-negative for sane inputs ── */
section('xP / nativeXP finite and non-negative');
const el = {
  minutes: 900, starts: 10, element_type: 4,
  expected_goals_per_90: '0.55', expected_assists_per_90: '0.20',
  ep_next: '5.2', form: '4.4', points_per_game: '4.1',
  chance_of_playing_next_round: null, status: 'a'
};
const nf = { gp: 10, lam: 1.6, lamAvg: 1.5, cs: 0.3, diff: 2 };
const nat = core.nativeXP(el, nf);
ok(Number.isFinite(nat) && nat >= 0, 'nativeXP finite and non-negative');
const xp = core.xP({}, el, nf);
ok(Number.isFinite(xp) && xp >= 0, 'xP finite and non-negative');
ok(core.nativeXP({ ...el, minutes: 100 }, nf) === null, 'nativeXP null on a thin sample (mpg < 20)');
ok(core.nativeXP(el, { ...nf, gp: 2 }) === null, 'nativeXP null before 5 games played');
const xpFlagged = core.xP({}, { ...el, chance_of_playing_next_round: 25 }, nf);
ok(xpFlagged < xp, 'chance-of-playing scales xP down');
ok(core.xP({}, el, { diff: 3 }) >= 0, 'xP without model view stays non-negative');

/* ── price model: caps, direction, monotonicity ─────────── */
section('fixtureOver: a match that has ended is not still live');
{
  /* Reported: Arsenal 3-0 Coventry finished on Friday night and still carried
     a LIVE badge at 10:07 the next morning. FPL settles a fixture in two
     stages and this app read only the second. */
  const F = (o) => Object.assign({ id: 1, started: true, minutes: 90,
    team_h_score: 3, team_a_score: 0 }, o);

  ok(core.fixtureOver(F({ finished: true, finished_provisional: true })) === true,
     'a fully settled match is over');

  /* THE REPORTED BUG. Full time has been blown — finished_provisional is set
     — but bonus is not confirmed, so `finished` is still false. Reading
     `finished` alone is what kept the badge red overnight. */
  ok(core.fixtureOver(F({ finished: false, finished_provisional: true })) === true,
     'a match at full time is over even before bonus is confirmed');

  ok(core.fixtureOver(F({ finished: false, finished_provisional: false, minutes: 62 })) === false,
     'a match in play is not over');
  ok(core.fixtureOver(F({ started: false, finished: false, finished_provisional: false, minutes: 0 })) === false,
     'a match that has not kicked off is not over');

  /* A MINUTES BACKSTOP WAS REJECTED and this pins the decision. FPL's own
     value can exceed 90 — the app writes Math.min(f.minutes||0,90) precisely
     because of that — so treating 90 as full time would show FT during
     stoppage time, and showing FT while a goal goes in is worse than the bug
     being fixed. Ninety minutes with neither flag set is NOT over. */
  ok(core.fixtureOver(F({ finished: false, finished_provisional: false, minutes: 90 })) === false,
     'ninety minutes alone does NOT end the match — stoppage time is still play');
  ok(core.fixtureOver(F({ finished: false, finished_provisional: false, minutes: 96 })) === false,
     'and neither does 96');

  /* If FPL ever stops sending the field, behaviour must be exactly what it is
     today rather than throwing or flipping — an absent field is not true. */
  ok(core.fixtureOver(F({ finished: true })) === true,
     'without finished_provisional at all, `finished` still ends the match');
  ok(core.fixtureOver(F({ finished: false })) === false,
     'and its absence never makes a live match look over');

  /* Truthiness is not enough: only an explicit true counts, so a stray
     string or 1 from a changed payload cannot silently end matches. */
  ok(core.fixtureOver(F({ finished: 'no', finished_provisional: 'no' })) === false,
     'a non-boolean value does not end the match');

  ok(core.fixtureOver(null) === false, 'a null fixture is not over, and does not throw');
  ok(core.fixtureOver(undefined) === false, 'nor an undefined one');
}

section('gwAnchor: the app moves on when the football does');
{
  /* Reported: "After each gameweek the app needs to move to the next
     gameweek. Planning tools like FDR doesn't need to show the previous GWs
     after they are completed."

     The anchor used to be `events.find(e => !e.finished)`. FPL does not set
     an event's `finished` until every match in it has been played AND
     scored, so between the last final whistle and that flag the app went on
     offering the gameweek just played as the one to plan for. */
  const ev = (id, o) => Object.assign({ id, finished: false, deadline_time: '2026-08-0' + id + 'T10:00:00Z' }, o);
  const fx = (id, event, o) => Object.assign({ id, event, team_h: 1, team_a: 2,
    finished: false, finished_provisional: false }, o);
  const EVENTS = [ev(1), ev(2), ev(3)];

  /* fixtureToCome: the shared rule the planning surfaces now share. */
  ok(core.fixtureToCome(fx(1, 1)) === true, 'an unplayed scheduled fixture is still to come');
  ok(core.fixtureToCome(fx(1, 1, { finished: true })) === false, 'a settled fixture is not');
  /* THE WHOLE POINT of not reading `finished` directly. */
  ok(core.fixtureToCome(fx(1, 1, { finished_provisional: true })) === false,
     'nor one at full time waiting on bonus — which `!f.finished` called upcoming');
  ok(core.fixtureToCome(fx(1, null)) === false,
     'a postponed fixture with no gameweek is not in anyone’s horizon');
  ok(core.fixtureToCome(null) === false, 'and a null fixture does not throw');

  /* GW1 fully played at the final whistle; FPL has not flagged the event yet
     because bonus is still pending. The anchor must already be GW2. */
  const played = [fx(10, 1, { finished_provisional: true }), fx(11, 1, { finished: true }),
    fx(20, 2), fx(21, 2), fx(30, 3)];
  const a1 = core.gwAnchor(EVENTS, played);
  ok(a1 && a1.id === 2, 'a gameweek whose games have all been played is not the one to plan for');

  /* The old rule, spelled out, so the fix cannot be quietly reverted: on this
     exact input `!e.finished` still answers GW1. */
  ok(EVENTS.find((e) => !e.finished).id === 1,
     'the event flags still say GW1 here — which is precisely the lag being fixed');

  /* A gameweek in progress IS still the one to plan for: it has games left. */
  const midweek = [fx(10, 1, { finished: true }), fx(11, 1), fx(20, 2)];
  const a2 = core.gwAnchor(EVENTS, midweek);
  ok(a2 && a2.id === 1, 'a gameweek with games still to come stays the anchor');

  /* Order independence — the fixtures list is not sorted by gameweek. */
  const shuffled = [fx(30, 3), fx(20, 2), fx(10, 1, { finished: true }), fx(11, 1)];
  ok(core.gwAnchor(EVENTS, shuffled).id === 1, 'the earliest live gameweek wins regardless of list order');

  /* Fallbacks. No fixtures is not evidence that a gameweek has ended, so the
     event flags answer instead — that is the between-seasons case. */
  ok(core.gwAnchor(EVENTS, []).id === 1, 'with no fixtures at all it falls back to the event flags');
  ok(core.gwAnchor(EVENTS, null).id === 1, 'and a null fixtures list does not throw');
  ok(core.gwAnchor([ev(1, { finished: true })], []) === null,
     'every event finished and nothing scheduled is null, not a guess');

  /* Season over: fixtures exist but all are played, and no event is unfinished. */
  const done = [fx(10, 1, { finished: true })];
  ok(core.gwAnchor([ev(1, { finished: true })], done) === null,
     'a finished season has no gameweek to plan for');

  /* A fixture pointing at a gameweek bootstrap does not carry must not
     invent one — callers read `.id` off the result. */
  ok(core.gwAnchor(EVENTS, [fx(99, 9)]) !== null && core.gwAnchor(EVENTS, [fx(99, 9)]).id === 1,
     'an unknown gameweek id falls through to the flags rather than returning undefined');

  /* THE OTHER DIRECTION, and the app's own mock bootstrap is exactly this
     shape: GW1 declared finished while two of its fixtures are still
     unplayed, because they were postponed and not yet rescheduled. A rule
     that trusted fixtures alone dragged the anchor back onto a gameweek FPL
     had already closed — planning for a week that had been and gone, which
     is the bug in the other direction. */
  const postponed = [ev(1, { finished: true }), ev(2), ev(3)];
  const strays = [fx(10, 1), fx(11, 1), fx(20, 2), fx(30, 3)];
  const a3 = core.gwAnchor(postponed, strays);
  ok(a3 && a3.id === 2, 'a gameweek FPL has closed is never the anchor, stray fixtures notwithstanding');

  /* And a gameweek with no fixtures scheduled into it at all — an empty week
     mid-window — is skipped rather than offered as the horizon. */
  const gap = core.gwAnchor(EVENTS, [fx(30, 3)]);
  ok(gap && gap.id === 3, 'the first gameweek that actually has football is the anchor');
}

section('the app moves off a gameweek that has been played');
{
  /* Reported, four days after GW1's deadline, with a screenshot: the header
     read "GW 1 · LIVE GW1 in play", the sidebar read "Gameweek 1 · Deadline
     Fri 21 Aug 18:30", and the debrief said "No finished gameweek yet".

     Three separate mechanisms, one symptom. */
  const HOUR = 3600e3, D = 86400e3;
  const NOW = 1_700_000_000_000;
  const isoAt = (ms) => new Date(ms).toISOString();
  const ev = (id, o) => Object.assign(
    { id, finished: false, data_checked: false, is_current: false, is_next: false,
      deadline_time: isoAt(NOW - 4 * D) }, o);
  const fx = (id, event, o) => Object.assign(
    { id, event, team_h: 1, team_a: 2, started: true,
      finished: false, finished_provisional: false }, o);

  /* ── gwsPlayedOut: what is behind us, by the football not the flags ── */
  const evs = [ev(1, { is_current: true }), ev(2, { deadline_time: isoAt(NOW + 3 * D), is_next: true })];
  const played = [fx(10, 1, { finished: true }), fx(11, 1, { finished_provisional: true }),
    fx(20, 2, { started: false })];
  const out = core.gwsPlayedOut(evs, played);
  ok(out.length === 1 && out[0].id === 1,
     'a gameweek whose every match is over is behind us, flags notwithstanding');
  ok(core.gwsPlayedOut(evs, []).length === 0,
     'and an empty fixture list reports NOTHING played out, rather than the whole season');
  ok(core.gwsPlayedOut(evs, [fx(10, 1)]).length === 0, 'a gameweek still playing is not behind us');
  ok(core.gwsPlayedOut(null, null).length === 0, 'null inputs do not throw');

  /* ── bootBehind: the hole the first fix left open ──────────────────
     The anchor is computed FROM fixtures, so once the football moves on the
     anchor moves with it and the index looks self-consistent — while the
     events array it was built from is still the stale copy that says the
     played gameweek is unfinished. That is what left the debrief insisting
     the season had not started. */
  const staleIdx = { cur: evs[0], upcoming: evs[1], events: evs };
  ok(core.bootBehind(staleIdx, played) === true,
     'bootstrap calling a played-out gameweek unfinished is behind the football');
  ok(core.bootBehind({ cur: ev(1, { finished: true }), events: evs }, played) === false,
     'once FPL flags it finished there is nothing to chase');
  ok(core.bootBehind(staleIdx, [fx(10, 1), fx(11, 1, { finished: true })]) === false,
     'a gameweek with a match still to finish is not behind, it is in progress');
  ok(core.bootBehind({ cur: evs[0], events: evs }, [fx(20, 2)]) === false,
     'and no fixtures for that gameweek is no evidence either way');

  /* ── gwPhase: a LIVE badge needs evidence ────────────────────────── */
  const bOf = (e) => ({ events: e, cur: e.find((x) => x.is_current) || e[0] });

  /* THE STUCK ROW. An abandoned match, or a feed that stopped updating,
     leaves started set with neither finished flag — and that pinned the
     header in LIVE indefinitely. */
  const stuck = [fx(10, 1, { kickoff_time: isoAt(NOW - 4 * D) })];
  const rStuck = core.gwPhase(bOf(evs), stuck, NOW);
  ok(rStuck.anyLive === false,
     'a match that kicked off four days ago is stuck data, not a match in play');
  ok(rStuck.phase !== 'live', 'so the header does not claim the gameweek is live');

  /* Still in play an hour after kickoff, which must keep working. */
  const nowPlaying = [fx(10, 1, { kickoff_time: isoAt(NOW - 1 * HOUR) })];
  ok(core.gwPhase(bOf(evs), nowPlaying, NOW).phase === 'live',
     'a match that kicked off an hour ago IS in play');
  /* No kickoff time cannot condemn the row — absence of evidence either way. */
  ok(core.gwPhase(bOf(evs), [fx(10, 1)], NOW).phase === 'live',
     'and a fixture with no kickoff time is still treated as in play');
  ok(core.fixtureStuck({ kickoff_time: isoAt(NOW - 6 * HOUR) }, NOW) === true, 'six hours is stuck');
  ok(core.fixtureStuck({ kickoff_time: isoAt(NOW - 2 * HOUR) }, NOW) === false, 'two hours is not');
  ok(core.fixtureStuck({}, NOW) === false, 'no kickoff time is never stuck');

  /* THE BLIND CLAIM. With no fixture rows at all the app assumed live, with
     no time bound — so a fixtures outage produced a LIVE badge for days. */
  const justPassed = [ev(1, { is_current: true, deadline_time: isoAt(NOW - 2 * HOUR) }),
    ev(2, { deadline_time: isoAt(NOW + 5 * D), is_next: true })];
  ok(core.gwPhase(bOf(justPassed), [], NOW).phase === 'live',
     'no fixture data two hours after the deadline still reads as live — kickoff is imminent');
  ok(core.gwPhase(bOf(evs), [], NOW).phase !== 'live',
     'but four days after it, with no fixture data, the app stops claiming a gameweek is live');

  /* ── gwMoved: what actually throws the memoised index away ─────────
     boot() indexes bootstrap once per tab. This is the ONLY thing that ever
     drops that index, so if it answers no the app cannot move on no matter
     how right everything else is. It had no test at all: a mutation that
     disabled its anchor check passed the whole suite. */
  core.__resetRecheck();
  const idxAnchorStale = { cur: evs[0], upcoming: evs[0], events: evs };
  core.__setPeek(played);
  ok(core.gwMoved(idxAnchorStale) === 'anchor',
     'an index still pointing at a played-out gameweek is stale');

  core.__resetRecheck();
  /* cur must be the SAME finished event the array holds — an index whose
     cur disagrees with its own events is not "fresh", it is corrupt, and
     the first draft of this test built exactly that and blamed the code. */
  const doneGw1 = ev(1, { finished: true, data_checked: true, is_current: true });
  const idxFresh = { cur: doneGw1, upcoming: evs[1], events: [doneGw1, evs[1]] };
  core.__setPeek(played);
  ok(core.gwMoved(idxFresh) === false,
     'and one whose anchor and flags both agree with the football is not');

  /* The case the first fix missed: anchor correct, events array behind. */
  core.__resetRecheck();
  ok(core.gwMoved({ cur: evs[0], upcoming: evs[1], events: evs }) === 'behind',
     'a correct anchor over a stale events array is still stale — the hole that left the debrief empty');

  /* Rate limit: the settling case stays true for hours, and boot() runs
     before every render, so it must not re-download bootstrap each time. */
  ok(core.gwMoved({ cur: evs[0], upcoming: evs[1], events: evs }) === false,
     'and asking again immediately does not trigger a second re-fetch');
  ok(core.BOOT_RECHECK_MS >= 60e3, 'the recheck interval is minutes, not milliseconds');

  /* A moved anchor is a transition, not a standing condition, so it is
     never rate-limited away. */
  core.__setPeek(played);
  ok(core.gwMoved(idxAnchorStale) === 'anchor',
     'while a moved anchor is never suppressed by that timer');

  /* No fixtures in memory: peek, never fetch, never guess. */
  core.__setPeek(null);
  ok(core.gwMoved(idxAnchorStale) === false, 'with no fixtures cached it declines rather than fetching');
  core.__setPeek([]);
  ok(core.gwMoved(idxAnchorStale) === false, 'and an empty list is not evidence either');
}

section('gwDefcon: who cleared the threshold, and the zero that is not one');
{
  /* Asked for as part of a whole-gameweek debrief: "highest scorer, bonus
     points, defcon". Thresholds and points come from the game's rulebook —
     a defender clears at 10, everyone further forward at 12, keepers do not
     score it — so the table is keyed by position and a missing entry means
     ineligible rather than zero. */
  const SC = { defconThreshold: { 2: 10, 3: 12, 4: 12 }, defcon: { 1: 0, 2: 2, 3: 2, 4: 2 } };
  const els = { 1: { id: 1, element_type: 2, web_name: 'Back' },
    2: { id: 2, element_type: 3, web_name: 'Mid' },
    3: { id: 3, element_type: 1, web_name: 'Keeper' },
    4: { id: 4, element_type: 2, web_name: 'Other' } };
  const le = (id, dc, mins) => ({ id, stats: { defensive_contribution: dc, minutes: mins == null ? 90 : mins } });

  const r = core.gwDefcon(els, [le(1, 12), le(2, 9), le(3, 20), le(4, 10)], SC, 10);
  ok(r.measured === 3, 'the keeper is not measured at all — he is not playing this game (' + r.measured + ')');
  ok(r.hits === 2, 'a defender on 12 and one on exactly 10 both clear; the midfielder on 9 does not');
  ok(r.points === 4, 'and the two who cleared are worth two points each');
  ok(r.rows[0].el.id === 1 && r.rows[0].dc === 12, 'ranked by contributions, highest first');
  ok(r.rows.every((x) => x.el.element_type !== 1), 'no keeper appears in the table');

  /* EXACTLY the threshold clears it. An off-by-one here silently denies a
     player the two points the game actually awarded him. */
  ok(core.gwDefcon(els, [le(1, 10)], SC, 5).hits === 1, 'ten is a hit for a defender, not a miss');
  ok(core.gwDefcon(els, [le(1, 9)], SC, 5).hits === 0, 'nine is not');
  ok(core.gwDefcon(els, [le(2, 12)], SC, 5).hits === 1, 'twelve is a hit for a midfielder');
  ok(core.gwDefcon(els, [le(2, 11)], SC, 5).hits === 0, 'eleven is not — the two positions differ');

  /* THE ABSENT FIELD IS NOT A ZERO. If FPL stops publishing the stat, every
     row would read 0 and the card would report that nobody in the league
     made a tackle — confident and wrong. measured must fall to zero so the
     caller can say it has no data instead. */
  const blind = core.gwDefcon(els, [{ id: 1, stats: { minutes: 90 } }, { id: 2, stats: {} }], SC, 5);
  ok(blind.measured === 0, 'a feed with no defensive_contribution measures nobody');
  ok(blind.hits === 0 && blind.rows.length === 0, 'and ranks nobody, rather than ranking zeroes');
  const real = core.gwDefcon(els, [le(1, 0)], SC, 5);
  ok(real.measured === 1 && real.hits === 0,
     'while a genuine zero IS measured — that is a player who made none, not a missing field');

  /* A player in the feed but not in bootstrap is dropped rather than
     half-rendered, the same rule gwStatsPack applies. */
  /* TWO SEPARATE RULES, and today's rulebook happens to make one of them
     invisible. Keepers are excluded here because they SCORE nothing, and
     also because the threshold table has no entry for them — so dropping
     the points half of the guard changes nothing against the live table.
     A rulebook that gave keepers a threshold but no points would then let
     them into a table of players earning points, which is the bug the
     second half exists to prevent. */
  const GK_THR = { defconThreshold: { 1: 14, 2: 10, 3: 12, 4: 12 }, defcon: { 1: 0, 2: 2, 3: 2, 4: 2 } };
  const gk = core.gwDefcon(els, [le(3, 20)], GK_THR, 5);
  ok(gk.measured === 0,
     'a position with a threshold but no points is still not playing this game');

  ok(core.gwDefcon(els, [le(99, 30)], SC, 5).measured === 0, 'an unknown element is dropped');
  ok(core.gwDefcon(null, null, SC, 5).measured === 0, 'null inputs do not throw');
  ok(core.gwDefcon(els, [le(1, 12), le(4, 11)], SC, 1).rows.length === 1, 'the limit is honoured');
}

section('socLadderItemX: the label and the value cannot share a column');
{
  /* Reported: the WEEK IN NUMBERS png "isn't formatted correctly, text is
     overlapping". The ladder drew its label at x=64 and then started the
     items at a hard-coded 206 — a 142px column, chosen when every ladder
     label was a club short name or a price band. THE WEEK IN NUMBERS
     arrived with MOST CAPTAINED and TRANSFERS MADE and printed the value
     straight through the label. */
  ok(core.socLadderItemX(0) === core.SOC_LADDER_X,
     'a label of no width leaves the column exactly where it always was');
  ok(core.socLadderItemX(80) === core.SOC_LADDER_X,
     'and a short one — ARS, a price band — does not move it either');
  /* The bug, as arithmetic: at the old fixed column a 234px label ran
     28px past the point the value started. */
  const wide = 234;
  ok(core.SOC_LADDER_LEFT + wide > core.SOC_LADDER_X,
     'a wide label really does overrun the old fixed column — that is the bug');
  ok(core.socLadderItemX(wide) >= core.SOC_LADDER_LEFT + wide,
     'so the items now start at or past where the label ends');
  ok(core.socLadderItemX(wide) > core.SOC_LADDER_LEFT + wide,
     'with a gap, not butted against it');
  /* Monotonic: a longer label never pulls the items back to the left. */
  let prev = 0;
  for (const w of [0, 50, 142, 200, 300, 600]) {
    const at = core.socLadderItemX(w);
    ok(at >= prev, 'a longer label never moves the items left (' + w + ' → ' + at + ')');
    prev = at;
  }
  ok(core.socLadderItemX(undefined) === core.SOC_LADDER_X,
     'an unmeasurable label falls back to the old column rather than NaN');
}

section('managerCard: the numbers on it add up to the number at the top');
{
  /* Built after FPL's own gameweek recap, whose eleven scores sum exactly to
     its headline — which is what makes it credible at a glance. The rows
     here therefore carry APPLIED points, captain already doubled, and a hit
     is a row rather than a silent subtraction. */
  const els = {};
  for (let i = 1; i <= 15; i++) els[i] = { id: i, web_name: 'P' + i, team: 1, element_type: i <= 1 ? 1 : i <= 6 ? 2 : i <= 11 ? 3 : 4 };
  const pick = (id, position, o) => Object.assign(
    { element: id, position, multiplier: position <= 11 ? 1 : 0, is_captain: false, is_vice_captain: false }, o);
  const picks = (o) => Object.assign({
    entry_history: { points: 0, event_transfers_cost: 0, overall_rank: 1234 },
    picks: Array.from({ length: 15 }, (_, i) => pick(i + 1, i + 1)),
  }, o || {});
  const live = (map) => Object.keys(map).map((id) => ({ id: Number(id), stats: { total_points: map[id] } }));
  const flat = {}; for (let i = 1; i <= 15; i++) flat[i] = 2;

  /* Captain doubled, eleven starters at 2, one of them on 4. */
  let p = picks();
  p.picks[2] = pick(3, 3, { is_captain: true, multiplier: 2 });
  p.picks[4] = pick(5, 5, { is_vice_captain: true });
  p.entry_history.points = 24;
  let c = core.managerCard(p, live(flat), { id: 7, average_entry_score: 20 }, els, { name: 'Real Treforys' });
  ok(c !== null, 'a full squad produces a card');
  ok(c.xi.length === 11 && c.bench.length === 4, 'eleven counting, four benched');
  ok(c.scored === 24, 'the eleven scored 24 — ten at 2, the captain doubled to 4');
  ok(c.xi.reduce((s, r) => s + r.pts, 0) === c.total,
     'and the rows sum to the headline, which is the whole point of the layout');
  ok(c.reconciles === true, 'the arithmetic closes against FPL’s own total');
  ok(c.name === 'Real Treforys' && c.gw === 7, 'the team and gameweek come through');
  ok(c.vsAvg === 4, 'scored against the gameweek average, which the official card omits');
  ok(c.benchPts === 8, 'and the bench points are counted — the thing FPL does not tell you');
  ok(c.cap && c.cap.el.id === 3 && c.cap.pts === 4, 'the captain is identified with his DOUBLED score');
  ok(c.vice && c.vice.el.id === 5, 'and the vice-captain, which the official card shows too');
  ok(c.top && c.top.el.id === 3, 'top performer is the highest APPLIED score, not the highest base');

  /* A hit must not vanish. If it did, the rows would sum to more than the
     score and the card would quietly lie about arithmetic it is claiming. */
  p = picks({ entry_history: { points: 20, event_transfers_cost: 4, overall_rank: 9 } });
  p.picks[2] = pick(3, 3, { is_captain: true, multiplier: 2 });
  c = core.managerCard(p, live(flat), { id: 7, average_entry_score: 20 }, els, null);
  ok(c.hit === 4 && c.scored === 24 && c.total === 20,
     'the eleven scored 24, the hit cost 4, the total is 20');
  ok(c.reconciles === true, 'and that still reconciles — scored minus hit is the official score');
  ok(c.vsAvg === 0, 'the comparison uses the total you were actually credited, hit included');

  /* When FPL's total disagrees with our sum we must NOT claim they add up. */
  p = picks({ entry_history: { points: 99, event_transfers_cost: 0 } });
  c = core.managerCard(p, live(flat), { id: 7, average_entry_score: 20 }, els, null);
  ok(c.reconciles === false,
     'a total we cannot reproduce is flagged rather than papered over');
  ok(c.total === 99, 'and the headline stays FPL’s number, not ours');

  /* AUTO-SUBS. A starter who did not play has already been replaced; summing
     the submitted lineup credits a player who never came on. */
  const subbed = picks({ automatic_subs: [{ element_out: 11, element_in: 12 }] });
  const scores = Object.assign({}, flat); scores[11] = 0; scores[12] = 9;
  c = core.managerCard(subbed, live(scores), { id: 7, average_entry_score: 20 }, els, null);
  ok(c.xi.some((r) => r.el.id === 12), 'the substitute is counted');
  ok(!c.xi.some((r) => r.el.id === 11), 'and the player who did not play is not');
  ok(c.top && c.top.el.id === 12, 'so the top performer can be a player who started on the bench');

  /* BENCH BOOST, which is the case that tells the two rules apart. Every
     one of the fifteen counts, so an eleven picked by POSITION would drop
     four players who scored and the column would no longer sum to the
     headline — on the one card whose whole claim is that it does. */
  const bb = picks({ active_chip: 'bboost' });
  bb.picks = bb.picks.map((q) => Object.assign({}, q, { multiplier: 1 }));
  bb.entry_history.points = 30;
  c = core.managerCard(bb, live(flat), { id: 7, average_entry_score: 20 }, els, null);
  ok(c.xi.length === 15, 'bench boost counts all fifteen (' + c.xi.length + ')');
  ok(c.bench.length === 0, 'and nobody is on the bench');
  ok(c.xi.reduce((s, r) => s + r.pts, 0) === c.total && c.reconciles === true,
     'the fifteen still add up to the headline');
  ok(c.benchPts === 0, 'with no points left on a bench that is empty');

  /* Degenerate input must not produce half a card on a published graphic. */
  ok(core.managerCard(null, [], {}, els, null) === null, 'no picks, no card');
  ok(core.managerCard({ picks: [] }, [], {}, els, null) === null, 'an empty squad makes no card');
  ok(core.managerCard(picks(), live(flat), {}, {}, null) === null,
     'and a squad whose players are not in bootstrap makes no card rather than a nameless one');
}

section('socRowFont: text that shrinks with the row it sits in');
{
  /* The manager card is eleven rows most weeks and FIFTEEN on a Bench Boost,
     plus a hit row. The rows shrink to fit a fixed vertical budget, so a
     name drawn at a constant 28px eventually overflows the row it is in —
     which is the ladder bug one card along, and was reported there. */
  ok(core.socRowFont(core.SOC_ROW_H, 28) === 28,
     'a full-height row draws at the size the card was designed at');
  ok(core.socRowFont(60, 28) === 28, 'and never larger, however much room there is');
  /* The invariant that matters: the glyphs fit inside the drawn pill, which
     is the row less its 6px gap. Checked across every row count the card
     can actually produce — eleven, fifteen, and either plus a hit row. */
  for (const rows of [11, 12, 15, 16]) {
    const rh = Math.min(core.SOC_ROW_H, (1148 - 690) / rows);
    const f = core.socRowFont(rh, 28);
    ok(f <= rh - 6,
       rows + ' rows: ' + f + 'px text fits a ' + Math.round(rh) + 'px row');
  }
  ok(core.socRowFont(10, 28) === 15, 'an absurd row still yields readable text, not 6px');
  ok(core.socRowFont(0, 28) === 15 && core.socRowFont(undefined, 28) === 15,
     'and a missing height does not produce NaN on a published graphic');
}

section('Refresh actually refreshes — including the player list');
{
  /* Reported during a busy transfer window: are the players updated from
     the API? They are — a runner probe found the feed carrying Hadjam to
     Brighton and Baleba to United dated the day before. What was not
     updated was the copy in the browser.

     bootstrap-static carries every player, club, price and injury note. It
     was cached for twelve hours, in localStorage as well as memory, and
     clearLiveCache — the Refresh button's one and only job — explicitly
     kept it:

         const keep=ck('boot');
         Object.keys(MEM).forEach(k=>{if(k!==keep)delete MEM[k];});

     So Refresh could not show a signing, a price change or a fitness
     update. The guard was not even buying anything: this function has a
     single caller, the button, and the 45-second live poll re-invokes the
     hydrator instead of coming through here. */
  const TTL = 60 * 60e3;
  const load = (v) => { let n = 0; const f = async () => { n++; return v; }; f.calls = () => n; return f; };

  Object.keys(core.MEM).forEach((k) => delete core.MEM[k]);
  const a = load('first');
  ok(await core.cached('boot', TTL, a) === 'first', 'a cold cache calls the loader');
  ok(await core.cached('boot', TTL, a) === 'first' && a.calls() === 1,
     'and the second read is served from cache, not the network');

  /* THE BUG, PINNED. */
  core.clearLiveCache();
  const b = load('second');
  ok(await core.cached('boot', TTL, b) === 'second',
     'after Refresh, the player list is fetched again');
  ok(b.calls() === 1, 'exactly once — the floor does not turn one read into two');
  /* And the refetched value has to STICK. Raising the floor above the clock
     means a value written in that same millisecond is stamped below the
     floor that was just set, so without the clamp in cached() every read
     for the rest of the tick refetches — a refresh that quietly disables
     the cache instead of renewing it. Found by mutation: dropping the clamp
     left every other assertion here green. */
  ok(await core.cached('boot', TTL, b) === 'second' && b.calls() === 1,
     'and the refetched value is cached again, not refetched on every read');

  /* Every key, not a hand-picked list. The old code named `boot` as the
     exception; naming it as the inclusion would be the same mistake wearing
     the other coat, so the floor is blind to which key it is. */
  core.clearLiveCache();
  const fx = load('fixtures-2');
  ok(await core.cached('fixtures', TTL, fx) === 'fixtures-2',
     'and so is everything else the panel had cached');

  /* THE PERSISTED HALF. The cache writes to memory AND localStorage, so
     clearing memory alone would let the stored copy hand the same stale
     bytes straight back — the button would still do nothing. */
  const stored = core.__lsKeys().filter((k) => k.indexOf('ge-c-fpl:') === 0);
  ok(stored.length > 0, 'the cache does persist to localStorage (' + stored.length + ' keys)');
  core.clearLiveCache();
  Object.keys(core.MEM).forEach((k) => delete core.MEM[k]);  /* memory gone, storage intact */
  const c = load('third');
  ok(await core.cached('boot', TTL, c) === 'third',
     'a refresh is not defeated by the localStorage copy surviving');

  /* AND IT IS A FLOOR, NOT A DELETE. A refresh that fails is exactly when a
     phone on a bad connection still needs the stored copy, so nothing is
     thrown away — the entries are ignored for this page life and are still
     there for the next one. */
  ok(core.__lsKeys().some((k) => k.indexOf('ge-c-fpl:') === 0),
     'the offline copy survives a refresh, rather than being destroyed by it');

  /* A failing loader must not poison the cache with its own failure. */
  core.clearLiveCache();
  let threw = false;
  try { await core.cached('boot', TTL, async () => { throw new Error('offline'); }); }
  catch (_) { threw = true; }
  ok(threw, 'a failed refresh surfaces the error rather than a stale value');

  /* AND THE PASSIVE WINDOW. Refresh is the escape hatch; most people never
     press it, so how long the player list may rot without one is the number
     that actually decides what a manager sees. A bound rather than an
     equality, because the requirement is "not stale for most of a day" and
     pinning the exact value would only detect change, not defend anything.

     The old twelve hours is the case in point: FPL's newest squad change was
     measured at 12.2 hours old, so a copy sitting at the boundary was
     provably missing it. Two hours is the loosest value that still means
     "this morning's transfers are not still showing tonight". */
  ok(core.BOOT_TTL <= 2 * 3600e3,
     'the player list may not go stale for more than two hours ('
     + (core.BOOT_TTL / 3600e3) + 'h)');
  ok(core.BOOT_TTL >= 15 * 60e3,
     'and is not so short that every panel visit refetches 100KB ('
     + (core.BOOT_TTL / 60e3) + ' min)');
  const d = load('fourth');
  ok(await core.cached('boot', TTL, d) === 'fourth',
     'and the next attempt still reaches the network');
}

section('Social Studio: the cards are the first thing on the page');
{
  /* Reported as "all 25 are there but they are not displaying". They were
     displaying. The panel opened on the custom builder and four paragraphs
     of reference prose, so on a phone the first card sat about two screens
     down — indistinguishable, from the reader's chair, from a gallery that
     had failed to build.

     Order is the fix, so order is what this asserts. It reads the shipped
     assignment rather than restating it, and it fails if the builder or the
     prose ever climbs back above the grid. */
  const fn = html.slice(html.indexOf('async function hydrateSocial('));
  const body = fn.slice(0, fn.indexOf('\n/* ── GW Debrief'));
  const assign = body.slice(body.indexOf('  host.innerHTML=\n'));
  const at = (s) => assign.indexOf(s);
  ok(at('gridHtml') > -1 && at('buildHtml') > -1, 'both blocks are in the assignment');
  ok(at('gridHtml') < at('buildHtml'), 'the gallery is placed above the builder');
  ok(at('gridHtml') < at('socPlanCard'), 'and above the posting queue');
  ok(at('soc-head') < at('gridHtml'), 'the header row is the only thing above it');

  /* The prose is reference — read once, then in the way every week after.
     A <details> costs one line until someone wants it. */
  ok(/const helpHtml='<details class="soc-help">/.test(body),
     'the caption reference is behind a disclosure, not open by default');
  ok(at('helpHtml') > -1 && at('helpHtml') < at('gridHtml'),
     'placed above the grid, where closed it costs one line');

  /* The count and the bulk download are the two things a reader who came
     for graphics wants before scrolling: how many, and give me all of them. */
  ok(/soc-count">'\+specs\.length/.test(body), 'the header states how many cards there are');
  ok(at("socDownloadAll()") < at('gridHtml'), 'and offers all of them in one click');

  /* A tile whose renderer throws used to leave an empty box and say
     nothing — the other thing "not displaying" could have meant, and
     visually identical to a card that was never built. */
  const paint = body.slice(body.indexOf('specs.forEach((sp,i)=>{', body.indexOf('socBuildRefresh')));
  ok(/catch\(_\)\{[\s\S]*soc-fail/.test(paint),
     'a card that cannot be drawn says so in its own tile');
  ok(!/catch\(_\)\{\}/.test(paint), 'and the silent swallow is gone');
  ok(/\.soc-fail\{/.test(html), 'with a style for it, so it is legible');
}

section('raceSpread: a part-played gameweek is not a measurement');
{
  const S = core.RACE_SD_PRIOR;

  /* THE TRAP. Two hours into a Saturday everybody has played three
     players, everybody is on ~12 points, and the spread between managers
     looks tiny. Feed that to the simulation and the current leader wins
     the title with near-certainty, because the model has been told the
     league has almost no randomness left in it. Only a settled gameweek
     counts. */
  const partScored = [11, 12, 13, 12, 11, 12];
  ok(core.raceSpread(partScored, false).sd === S,
     'a gameweek still being played falls back to the prior');
  ok(core.raceSpread(partScored, false).fromData === false,
     'and says so rather than claiming a measurement');
  ok(core.raceSpread(partScored, true).sd < S,
     'the very same numbers DO move the estimate once the gameweek is settled');

  /* Guards the `complete` flag itself: if it were ignored, the two calls
     above would agree and the trap would be invisible. */
  ok(core.raceSpread(partScored, false).sd !== core.raceSpread(partScored, true).sd,
     'the settled flag changes the answer — it is read, not decorative');

  ok(core.raceSpread([40, 80], true).fromData === false,
     'two managers are too few to measure a spread from');
  ok(core.raceSpread([], true).sd === S, 'and none at all is the prior');
  ok(core.raceSpread(null, true).sd === S, 'a missing list does not throw');
  ok(core.raceSpread([50, 'x', null, undefined, 60, 70], true).n === 3,
     'non-numeric entries are dropped rather than counted as zero');

  /* A wide, real spread must pull the estimate ABOVE the prior, not just
     shrink toward it — shrinkage that can only ever reduce would quietly
     cap every league at the prior. */
  const wide = [10, 30, 50, 70, 90, 110, 20, 100, 45, 85, 15, 95];
  ok(core.raceSpread(wide, true).sd > S,
     'a genuinely wide league measures wider than the prior');

  /* Shrinkage is toward the prior, so a small sample cannot swing all the
     way to its own observed value. */
  const tight = [50, 50, 50, 51, 50, 50];
  const t = core.raceSpread(tight, true);
  ok(t.sd > 0.4 && t.sd < S,
     'a freakishly tight sample is pulled back toward the prior, not believed');
  ok(t.sd >= 4, 'and never falls below the floor');
}

section('gwsRemaining: the current gameweek is counted once, or not at all');
{
  const EVENTS = Array.from({ length: 38 }, (_, i) => ({ id: i + 1 }));

  /* GW2 in progress: GW2..GW38 are still to be played. */
  ok(core.gwsRemaining(EVENTS, 2, false) === 37,
     'an unsettled gameweek is still to come');
  /* Once GW2 is settled its points are banked in `total`; counting it
     again would pay every manager for it twice. */
  ok(core.gwsRemaining(EVENTS, 2, true) === 36,
     'a settled gameweek is banked, not remaining');
  ok(core.gwsRemaining(EVENTS, 38, true) === 0, 'the season can reach zero');
  ok(core.gwsRemaining(EVENTS, 38, false) === 1, 'the final gameweek still counts while it is on');
  ok(core.gwsRemaining(EVENTS, 40, true) === 0, 'never negative');
  ok(core.gwsRemaining([], 2, false) === 0, 'no events, nothing to play');
  ok(core.gwsRemaining(EVENTS, null, false) === 0, 'no current gameweek, nothing to play');
}

section('titleRace: the probabilities must add up');
{
  const L = (n) => Array.from({ length: n }, (_, i) => ({
    entry: 100 + i, name: 'Team ' + i, mgr: 'M' + i, rank: i + 1,
    total: 200 - i * 8,
  }));
  const sum = (r) => r.rows.reduce((a, x) => a + x.win, 0);

  /* THE PROPERTY THE WHOLE DESIGN EXISTS FOR. Exactly one manager wins a
     league, so the odds across the league are a probability distribution.
     A per-manager formula produces plausible numbers that do not add to
     one — a table of numbers that cannot all be true. A joint simulation
     cannot fail this, which is precisely why it is a joint simulation. */
  for (const n of [2, 3, 6, 20, 50]) {
    const r = core.titleRace(L(n), 37, { trials: 4000 });
    ok(Math.abs(sum(r) - 1) < 1e-9,
       n + ' managers: the win probabilities sum to exactly 1');
  }

  /* Deterministic: a repaint must not reshuffle the odds. */
  const a = core.titleRace(L(6), 37, { trials: 4000 });
  const b = core.titleRace(L(6), 37, { trials: 4000 });
  ok(JSON.stringify(a.rows) === JSON.stringify(b.rows),
     'the same league renders the same odds every time');

  /* Monotone in the gap: being further behind cannot help. */
  const mono = core.titleRace(L(6), 37, { trials: 8000 }).rows;
  const byTotal = mono.slice().sort((x, y) => y.total - x.total);
  ok(byTotal.every((x, i) => i === 0 || byTotal[i - 1].win >= x.win - 0.02),
     'more points banked never means worse odds');
  ok(mono[0].win >= mono[mono.length - 1].win, 'and the leader is the favourite');

  /* Rows come back best-first so the card can render them in order. */
  ok(mono.every((x, i) => i === 0 || mono[i - 1].win >= x.win),
     'rows are sorted by odds, best first');
}

section('titleRace: a long season is mostly noise, a short one is mostly the gap');
{
  const SIX = Array.from({ length: 6 }, (_, i) => ({
    entry: 100 + i, name: 'T' + i, mgr: 'M' + i, rank: i + 1, total: 120 - i * 4,
  }));

  /* Six managers within 20 points at GW2, 37 gameweeks left. The gap is
     tiny next to the remaining swing (14*sqrt(37) is about 85 points), so
     the honest answer is close to one-in-six for everybody. Anything that
     confidently separates these managers now is reading noise as signal.
     This is the test that would fail if the model ever started treating
     an early-season lead as meaningful. */
  const early = core.titleRace(SIX, 37, { trials: 20000 });
  ok(early.rows.every((r) => r.win > 0.09 && r.win < 0.26),
     'at GW2 nobody in a tight six is far from one-in-six');
  ok(early.rows[0].win - early.rows[5].win < 0.16,
     'and the spread between best and worst odds stays modest');

  /* The same table with one gameweek to go is a different league. Note
     what does NOT happen: a 4-point lead with one gameweek of 14-point
     swing left is worth a lot more than it was in August, but it is
     still not a lock, and the model must not pretend otherwise. What
     changes decisively is the BOTTOM of the table — with 37 gameweeks
     left everyone is live, with one left the back markers are done. */
  const late = core.titleRace(SIX, 1, { trials: 20000 });
  ok(late.rows[0].win > 2 / 6,
     'with one gameweek left the leader is a clear favourite, not one of six');
  ok(late.rows[0].win < 0.6,
     'but a 4-point lead against a 14-point swing is still not a formality');
  ok(late.rows[0].win > early.rows[0].win + 0.12,
     'the leader is meaningfully safer in May than in August on an identical table');
  ok(late.rows[5].win < early.rows[5].win / 2,
     'and the manager 20 points back has run out of gameweeks to close it');

  /* Even across 37 gameweeks the leader must still be VISIBLY ahead. This
     looks like a restatement of the band above and is not: it is the
     lower net for a swing that grows too fast. Overstate the remaining
     randomness and every manager converges on exactly one-in-six, which
     passes a "close to uniform" test by being uniform for the wrong
     reason. */
  ok(early.rows[0].win > 0.18,
     'a 20-point lead is still worth something over 37 gameweeks');

  /* Points accumulate as a random walk, so VARIANCE grows with the number
     of gameweeks and the spread grows with its square root. That single
     choice is what makes an August lead nearly worthless and a May lead
     nearly safe, and it deserves to be pinned exactly rather than
     inferred from soft bands.

     The identity: quadrupling the horizon doubles the swing, so it must
     land in precisely the same place as halving the gap. Both runs draw
     the same normals — same seed, same trial count, same league size —
     so every trial reduces to the same comparison and the two tables
     agree exactly, not merely closely. Under any other exponent the
     ratios come apart and this fails. */
  const P = (gap, gws) => core.titleRace([
    { entry: 1, name: 'A', mgr: 'a', rank: 1, total: gap },
    { entry: 2, name: 'B', mgr: 'b', rank: 2, total: 0 },
  ], gws, { sd: 14, trials: 8000 }).rows.find((r) => r.entry === 1).win;

  ok(P(20, 4) === P(10, 1),
     'four times the horizon is exactly twice the swing — variance adds, spread is its root');
  ok(P(30, 9) === P(10, 1), 'and nine times the horizon is exactly three times the swing');
  /* Negative control: if the scaling were linear these would agree
     instead, so the identity above has to be the discriminating one. */
  ok(P(40, 4) !== P(10, 1),
     'a linear horizon is NOT what the model does');
  ok(Math.abs(late.rows.reduce((a, x) => a + x.win, 0) - 1) < 1e-9,
     'and it still adds up');
}

section('titleRace: a shared scoring rate cannot change who wins');
{
  const M = (rate) => Array.from({ length: 5 }, (_, i) => ({
    entry: 200 + i, name: 'T' + i, mgr: 'M' + i, rank: i + 1,
    total: 150 - i * 10, rate,
  }));

  /* The documented reason the model needs no points-per-gameweek forecast:
     a rate every manager shares shifts every final total equally and
     cannot reorder them. If this ever fails, the model has started
     depending on a number it has no business predicting. */
  const none = core.titleRace(M(undefined), 20, { trials: 8000 });
  const slow = core.titleRace(M(45), 20, { trials: 8000 });
  const fast = core.titleRace(M(90), 20, { trials: 8000 });
  ok(JSON.stringify(none.rows) === JSON.stringify(slow.rows),
     'giving everyone a scoring rate changes nothing');
  ok(JSON.stringify(slow.rows) === JSON.stringify(fast.rows),
     'and doubling that shared rate changes nothing either');

  /* A rate ADVANTAGE, though, must help — otherwise the parameter is
     inert and the test above would pass for the wrong reason. */
  const uplift = M(50);
  uplift[4].rate = 58;                       /* last place, 8 pts/gw better */
  const helped = core.titleRace(uplift, 20, { trials: 8000 });
  const flat = core.titleRace(M(50), 20, { trials: 8000 });
  const find = (r) => r.rows.find((x) => x.entry === 204).win;
  ok(find(helped) > find(flat),
     'a manager who scores faster than the field does gain ground');

  /* The same invariance seen from the other side: a league race depends
     on the gaps between totals, never on their absolute size. Awarding
     every manager a thousand extra points changes nobody's chances.
     Worth pinning because it is the assumption that lets the model skip
     forecasting a points-per-gameweek rate at all — and because a
     future "projected final total" feature would be the obvious way to
     break it by accident. */
  const shifted = M(50).map((m) => Object.assign({}, m, { total: m.total + 1000 }));
  const same = core.titleRace(shifted, 20, { trials: 8000 });
  ok(same.rows.every((r, i) => r.win === flat.rows[i].win),
     'adding a constant to every total changes nothing');
  ok(Math.abs(helped.rows.reduce((a, x) => a + x.win, 0) - 1) < 1e-9,
     'and the distribution still sums to 1');
}

section('titleRace: settled seasons, ties and degenerate leagues');
{
  const two = (ta, tb) => ([
    { entry: 1, name: 'A', mgr: 'a', rank: 1, total: ta },
    { entry: 2, name: 'B', mgr: 'b', rank: 2, total: tb },
  ]);

  /* No gameweeks left: the table IS the result. No simulation, no
     probabilistic hedging on a season that has already happened. */
  const done = core.titleRace(two(200, 180), 0);
  ok(done.decided === true, 'a finished season is decided, not simulated');
  ok(done.rows[0].win === 1 && done.rows[1].win === 0,
     'the leader has won it, at 100%');
  ok(done.err === 0, 'and there is no simulation error to report');

  /* A dead heat splits rather than picking one, which is what keeps the
     sum exact. */
  const tie = core.titleRace(two(200, 200), 0);
  ok(tie.rows[0].win === 0.5 && tie.rows[1].win === 0.5,
     'a tie splits the win evenly');
  ok(tie.rows[0].win + tie.rows[1].win === 1, 'so the total is still 1');

  ok(core.titleRace([], 10) === null, 'an empty league has no race');
  ok(core.titleRace([{ entry: 1, name: 'A', mgr: 'a', rank: 1, total: 5 }], 10) === null,
     'and neither does a league of one');
  ok(core.titleRace(null, 10) === null, 'a missing list does not throw');

  /* A manager with no total yet is dropped, not treated as zero — zero
     would read as "hopelessly last" for somebody the API simply has not
     scored. */
  const withHole = two(200, 180).concat([{ entry: 3, name: 'C', mgr: 'c', rank: 3, total: null }]);
  const r = core.titleRace(withHole, 5, { trials: 2000 });
  ok(r.rows.length === 2, 'a manager with no total is dropped, not zeroed');
  ok(Math.abs(r.rows.reduce((a, x) => a + x.win, 0) - 1) < 1e-9,
     'and the remaining odds still sum to 1');

  /* gap is measured from the leader and is what the card renders. */
  ok(r.rows.find((x) => x.entry === 1).gap === 0, 'the leader is 0 behind');
  ok(r.rows.find((x) => x.entry === 2).gap === 20, 'and the chaser is 20 behind');

  /* A bad sd must not silently produce a decided league. */
  const zeroSd = core.titleRace(two(200, 180), 10, { sd: 0, trials: 2000 });
  ok(zeroSd.sd === core.RACE_SD_PRIOR,
     'a zero spread falls back to the prior rather than freezing the table');
  ok(zeroSd.rows[1].win > 0, 'so the chaser still has a chance');
}

section('squadMatchday: which of my players are on, and when');
{
  /* Two clubs playing each other, a third club playing elsewhere, and a
     fourth with no fixture at all. Kickoffs deliberately out of order in
     the source array so the sort has something to do. */
  const T = { ARS: 1, CHE: 2, EVE: 3, NEW: 4, BLANKCLUB: 9 };
  const ELS = {
    10: { id: 10, web_name: 'Saka', team: T.ARS, element_type: 3 },
    11: { id: 11, web_name: 'Rice', team: T.ARS, element_type: 3 },
    12: { id: 12, web_name: 'Raya', team: T.ARS, element_type: 1 },
    20: { id: 20, web_name: 'Palmer', team: T.CHE, element_type: 3 },
    30: { id: 30, web_name: 'Pickford', team: T.EVE, element_type: 1 },
    40: { id: 40, web_name: 'Isak', team: T.BLANKCLUB, element_type: 4 },
  };
  const PICKS = {
    picks: [
      { element: 10, position: 1, multiplier: 2, is_captain: true, is_vice_captain: false },
      { element: 11, position: 2, multiplier: 1, is_captain: false, is_vice_captain: true },
      { element: 20, position: 3, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 40, position: 4, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 30, position: 12, multiplier: 0, is_captain: false, is_vice_captain: false },
      { element: 12, position: 13, multiplier: 0, is_captain: false, is_vice_captain: false },
    ],
  };
  const FX = [
    /* Sunday, later — listed FIRST to prove the sort is real. */
    { id: 2, event: 5, team_h: T.EVE, team_a: T.NEW, kickoff_time: '2026-08-23T15:00:00Z',
      started: false, finished: false, finished_provisional: false },
    /* Saturday lunchtime, already finished. */
    { id: 1, event: 5, team_h: T.ARS, team_a: T.CHE, kickoff_time: '2026-08-22T11:30:00Z',
      started: true, finished: true, finished_provisional: true },
    /* A different gameweek entirely — must be ignored. */
    { id: 3, event: 6, team_h: T.ARS, team_a: T.EVE, kickoff_time: '2026-08-29T14:00:00Z',
      started: false, finished: false, finished_provisional: false },
  ];

  const md = core.squadMatchday(PICKS, FX, ELS, 5);

  ok(md !== null, 'a squad with fixtures produces a matchday');
  ok(md.rows.length === 2, 'one row per fixture that involves my players, got ' + md.rows.length);

  /* Ordering is the whole point of a "when do I watch" card. */
  ok(md.rows[0].id === 1 && md.rows[1].id === 2,
     'rows are in kickoff order, not source order');

  /* The other gameweek must not leak in — the fixture list holds the
     whole season and filtering on event is the only thing keeping GW6
     out of GW5's schedule. */
  ok(!md.rows.some((r) => r.id === 3), 'a fixture from another gameweek is not in this one');

  /* Both my Arsenal starters AND my Chelsea starter are in fixture 1,
     because both clubs are in it. Plus Raya on the bench. */
  const first = md.rows[0];
  ok(first.players.length === 4, 'every player from either club is in the row, got ' + first.players.length);
  ok(first.players.map((p) => p.name).join(',') === 'Saka,Rice,Palmer,Raya',
     'and they come back in squad order (' + first.players.map((p) => p.name).join(',') + ')');
  ok(first.players[0].cap === true, 'the captain is flagged');
  ok(first.players[1].vice === true, 'and so is the vice');
  ok(first.players[3].bench === true, 'and the bench player is marked as bench');
  ok(first.players[0].pos === 'MID' && first.players[3].pos === 'GKP',
     'positions come through');

  /* THE THING THAT IS INVISIBLE FROM THE FIXTURE SIDE. A player whose
     club has no fixture cannot be found by looping over fixtures — he is
     defined by being absent from all of them — so blanks are computed
     from the squad. This is also the single most useful flag on the
     card: a starter who is not playing at all. */
  ok(md.blanks.length === 1 && md.blanks[0].name === 'Isak',
     'a player whose club has no fixture is flagged as a blank');
  ok(md.blanks[0].state === 'blank', 'and his state says so rather than "yet to play"');
  ok(!md.rows.some((r) => r.players.some((p) => p.name === 'Isak')),
     'and he appears in no fixture row, because he is in no fixture');

  /* Counts are over the XI, and a blank is not a "still to play". */
  ok(md.xi.done === 3, 'three of the XI have finished (' + md.xi.done + ')');
  ok(md.xi.blank === 1, 'one of the XI has no fixture');
  ok(md.xi.toPlay === 0, 'and nobody in the XI is still to play — the blank is not waiting');
  ok(md.counts.done === 4, 'the all-squad tally counts the bench too (' + md.counts.done + ')');

  /* next is the match to actually be watching. */
  ok(md.next && md.next.id === 2, 'next up is the earliest match not yet started');
}

section('squadMatchday: doubles, blanks and unscheduled kickoffs');
{
  const ELS = {
    10: { id: 10, web_name: 'Doubler', team: 1, element_type: 3 },
    20: { id: 20, web_name: 'Single', team: 2, element_type: 3 },
  };
  const PICKS = { picks: [
    { element: 10, position: 1, multiplier: 1 },
    { element: 20, position: 2, multiplier: 1 },
  ] };

  /* Team 1 plays twice. One match is over, the other has not kicked off.
     A per-fixture reading would call him finished off the first match;
     he plainly is not — he has a whole game left. */
  const DGW = [
    { id: 1, event: 7, team_h: 1, team_a: 3, kickoff_time: '2026-09-01T18:00:00Z',
      started: true, finished: true, finished_provisional: true },
    { id: 2, event: 7, team_h: 4, team_a: 1, kickoff_time: '2026-09-04T18:00:00Z',
      started: false, finished: false, finished_provisional: false },
    { id: 3, event: 7, team_h: 2, team_a: 5, kickoff_time: '2026-09-02T18:00:00Z',
      started: true, finished: true, finished_provisional: true },
  ];
  const md = core.squadMatchday(PICKS, DGW, ELS, 7);
  ok(md.rows.length === 3, 'a doubling player puts his club in two rows');
  const dbl = md.players.find((p) => p.name === 'Doubler');
  ok(dbl.games === 2, 'and the player knows he has two matches');
  ok(dbl.state === 'toPlay',
     'one match finished and one to come is STILL to play, not done');
  ok(md.players.find((p) => p.name === 'Single').state === 'done',
     'while a single-fixture player with his match over is done');
  ok(md.doubles.length === 1 && md.doubles[0].name === 'Doubler',
     'doubles are surfaced so the card can say so');
  ok(md.next.id === 2, 'and the next match is the one still to come');

  /* A match in play beats both — that is the one on the telly now. */
  const LIVE = DGW.map((f) => f.id === 2
    ? Object.assign({}, f, { started: true, finished: false, finished_provisional: false })
    : f);
  ok(core.squadMatchday(PICKS, LIVE, ELS, 7).players.find((p) => p.name === 'Doubler').state === 'live',
     'a match in play makes the player live');
  ok(core.squadMatchday(PICKS, LIVE, ELS, 7).next === null,
     'and with nothing unstarted left there is no next match');

  /* FPL leaves kickoff_time null until a match is scheduled. Date.parse
     of that is NaN, and NaN sorts unpredictably — an unscheduled match
     must land at the END, not masquerade as the earliest kickoff of the
     gameweek and become "next up". */
  const TBC = [
    { id: 9, event: 8, team_h: 1, team_a: 3, kickoff_time: null,
      started: false, finished: false, finished_provisional: false },
    { id: 8, event: 8, team_h: 2, team_a: 4, kickoff_time: '2026-09-12T14:00:00Z',
      started: false, finished: false, finished_provisional: false },
  ];
  const t = core.squadMatchday(PICKS, TBC, ELS, 8);
  ok(t.rows[0].id === 8, 'a scheduled match comes before an unscheduled one');
  ok(t.rows[1].ko === null, 'and the unscheduled one reports no kickoff rather than NaN');
  ok(t.next.id === 8, 'so "next up" is a match with a time, not a TBC');
}

section('squadMatchday: nothing to show, and nothing to throw');
{
  const ELS = { 10: { id: 10, web_name: 'A', team: 1, element_type: 3 } };
  const PICKS = { picks: [{ element: 10, position: 1, multiplier: 1 }] };
  const FX = [{ id: 1, event: 5, team_h: 1, team_a: 2, kickoff_time: '2026-08-22T14:00:00Z',
    started: false, finished: false, finished_provisional: false }];

  ok(core.squadMatchday(null, FX, ELS, 5) === null, 'no picks, no matchday');
  ok(core.squadMatchday({ picks: [] }, FX, ELS, 5) === null, 'an empty squad likewise');
  ok(core.squadMatchday(PICKS, [], ELS, 5).rows.length === 0,
     'no fixtures means no rows, not a throw');
  ok(core.squadMatchday(PICKS, [], ELS, 5).blanks.length === 1,
     'and everybody is a blank when the gameweek has no matches at all');
  ok(core.squadMatchday(PICKS, null, ELS, 5).rows.length === 0, 'a missing fixture list is survivable');
  ok(core.squadMatchday(PICKS, FX, null, 5) === null,
     'without the player index there is nobody to place');

  /* A pick the bootstrap does not know is skipped, not rendered as
     undefined — this is what a mid-season player removal looks like. */
  const ghost = { picks: PICKS.picks.concat([{ element: 999, position: 2, multiplier: 1 }]) };
  const g = core.squadMatchday(ghost, FX, ELS, 5);
  ok(g.players.length === 1, 'an unknown player id is dropped rather than shown as a blank name');

  /* multiplier absent: position decides bench, because that is what the
     bench actually is. */
  const noMult = { picks: [{ element: 10, position: 14 }] };
  ok(core.squadMatchday(noMult, FX, ELS, 5).players[0].bench === true,
     'position 14 is on the bench even with no multiplier field');
}

section('leagueSwing: a player nobody starts separates nobody');
{
  /* Reported from a real twelve-manager league: "Who separates this
     league" listed six players and EVERY ONE read 0.0%.

     The rows were arithmetically right and the ranking was backwards.
     leagueSwing scored each player by Math.abs(1 - eo) — distance from
     universal ownership — and sorted descending. That is correct at one
     end: a player everyone starts scores for everyone equally and cannot
     change the table. It is exactly wrong at the other. A player at 0%
     is in nobody's XI, so he scores for nobody and cannot change the
     table either — and |1 - 0| is 1.0, the maximum, so the six players
     LEAST able to affect the league sorted to the top of the panel that
     exists to name the ones who decide it.

     The measure is the spread of the multiplier across managers. Both
     extremes go to zero, which is what "cannot move you up or down"
     actually means. */
  const els = {};
  for (let i = 1; i <= 6; i++) els[i] = { id: i, web_name: 'P' + i };
  const N = 12;
  /* 1 — everyone starts him.            2 — one owner, benched.
     3 — three owners, all benched.      4 — half the league starts him.
     5 — everyone owns, seven captain.   6 — one owner, one captain. */
  const league = [];
  for (let i = 0; i < N; i++) {
    league.push({ picks: [
      { element: 1, position: 1, multiplier: 1 },
      { element: 2, position: 12, multiplier: i === 0 ? 0 : undefined },
      { element: 3, position: 12, multiplier: 0 },
      { element: 4, position: 5, multiplier: i < 6 ? 1 : 0 },
      { element: 5, position: 6, multiplier: i < 7 ? 2 : 1, is_captain: i < 7 },
      { element: 6, position: 7, multiplier: i === 0 ? 2 : 0, is_captain: i === 0 },
    ].filter((p) => !(p.element === 2 && i > 0)) });
  }
  const eo = core.leagueEO(league);
  ok(eo.byId[2].eo === 0 && eo.byId[3].eo === 0,
     'the benched players really are on 0% effective ownership');

  const sw = core.leagueSwing(league, eo, els, 6);
  const ids = sw.map((p) => p.id);

  /* THE BUG, PINNED. */
  ok(!ids.includes(2) && !ids.includes(3),
     'a player nobody starts is not listed as separating the league');
  ok(!sw.some((p) => p.eo === 0),
     'and no row reads 0.0% — every one of them did when this was reported');

  /* The other end, which the old measure got right and must keep. */
  ok(!ids.includes(1), 'nor is a player every single manager starts at the same weight');

  /* What is left is the actual race, and the order is worth stating
     because I expected it wrong. A lone CAPTAIN (element 6: one manager
     on a multiplier of 2, eleven on nothing) outranks an even 6-v-6 split
     of single-weighted starts (element 4). Checked rather than argued
     with: the captain puts twice the player's score on one manager and
     zero on everyone else, so the gap he can open is wider than the gap
     between two halves of the league each getting him once. The measure
     is right and my intuition was the thing that needed correcting. */
  ok(ids[0] === 6, 'a lone captain leads — twice the stake on one manager (' + ids.join(', ') + ')');
  ok(ids.includes(4), 'and an even split of the league is right behind him');
  ok(ids.includes(5), 'a universally owned but half-captained player also separates');
  ok(sw.every((p, i, a) => !i || a[i - 1].swing >= p.swing), 'most divisive first');

  /* THE SYMMETRY that says this is a principled measure rather than one
     tuned to the example. Being the only manager who owns him and being
     the only manager who does NOT are equally divisive: eleven-of-twelve
     and one-of-twelve give the identical spread. |1 - eo| could not do
     this — it scored them 0.083 and 0.917. */
  const one = core.leagueEO(Array.from({ length: N }, (_, i) =>
    ({ picks: [{ element: 9, position: 1, multiplier: i === 0 ? 1 : 0 }] })));
  const all = core.leagueEO(Array.from({ length: N }, (_, i) =>
    ({ picks: [{ element: 9, position: 1, multiplier: i === 0 ? 0 : 1 }] })));
  ok(Math.abs(one.byId[9].sd - all.byId[9].sd) < 1e-12,
     'owning alone and missing out alone separate the league identically');
}

section('leagueEO: effective ownership is multipliers, not headcount');
{
  /* Twelve managers, mirroring the league in the screenshot that prompted
     this. Haaland is owned by everyone and captained by seven, which is
     19 multiplier units over 12 managers — 158.3%, exactly the figure
     those tables show. That number is unreachable by counting owners:
     headcount caps at 100%. */
  const mk = (opts) => ({ picks: [
    { element: 1, position: 1, multiplier: 1 },                    /* keeper */
    { element: 2, position: 2, multiplier: opts.cap === 2 ? 2 : 1, is_captain: opts.cap === 2 },
    { element: 3, position: 11, multiplier: opts.cap === 3 ? 2 : 1, is_captain: opts.cap === 3 },
    { element: 4, position: 12, multiplier: 0 },                   /* benched */
  ] });
  const league = [];
  for (let i = 0; i < 12; i++) league.push(mk({ cap: i < 7 ? 3 : 2 }));
  const eo = core.leagueEO(league);

  ok(eo.managers === 12, 'the manager count is the divisor, got ' + eo.managers);
  /* element 3: started by 12, captained by 7 → 12 + 7 = 19 units. */
  ok(Math.abs(eo.byId[3].eo - 19 / 12) < 1e-9,
     'a universally owned, half-captained player is 158.3% (' + (eo.byId[3].eo * 100).toFixed(1) + ')');
  ok(eo.byId[3].eo > 1, 'and effective ownership can exceed 100%, which headcount cannot');
  ok(eo.byId[3].cap === 7, 'the captain count is carried separately');

  /* THE CASE HEADCOUNT GETS WRONG. Element 4 is in all twelve squads and
     started by none. Twelve owners is 100% by any ownership count, and
     0% effective — he cannot move anyone's position because he scores
     for nobody. */
  ok(eo.byId[4].own === 12, 'a benched player is still owned by everyone');
  ok(eo.byId[4].eo === 0, 'but his effective ownership is zero, because he scores for nobody');
  ok(eo.byId[4].start === 0, 'and nobody starts him');

  /* A missing multiplier falls back to position, because that is what the
     bench is. */
  const noMult = core.leagueEO([{ picks: [
    { element: 9, position: 5 }, { element: 8, position: 13 },
  ] }]);
  ok(noMult.byId[9].eo === 1, 'a starter with no multiplier field counts as one');
  ok(noMult.byId[8].eo === 0, 'and a bench player with none counts as zero');

  /* Triple captain is three units, not two — the whole reason to sum
     multipliers rather than special-case the armband. */
  const tc = core.leagueEO([{ picks: [{ element: 5, position: 1, multiplier: 3, is_captain: true }] }]);
  ok(tc.byId[5].eo === 3, 'a triple captain is three units of effective ownership');

  /* A bench boost makes the bench count, with no chip flag needed. */
  const bb = core.leagueEO([{ picks: [
    { element: 6, position: 12, multiplier: 1 }, { element: 7, position: 13, multiplier: 1 },
  ] }]);
  ok(bb.byId[6].eo === 1, 'under a bench boost the bench has real effective ownership');

  ok(core.leagueEO([]).managers === 0, 'an empty league divides by nothing rather than by zero');
  ok(core.leagueEO(null).managers === 0, 'and a missing list does not throw');
  ok(core.leagueEO([null, undefined, {}, { picks: 'no' }]).managers === 0,
     'entries without a picks array are not managers');
  /* A failed fetch must not inflate everyone else's ownership by shrinking
     the divisor... it must shrink it. Dropping a manager we could not load
     is right; counting them as owning nobody would be wrong. */
  const partial = core.leagueEO([{ picks: [{ element: 1, position: 1, multiplier: 1 }] }, null]);
  ok(partial.managers === 1 && partial.byId[1].eo === 1,
     'a manager whose picks failed to load is not counted as a manager who owns nobody');
}

section('freeTransfers: derived from published transfers, and checked against published hits');
{
  /* I told the user this could not be done. It can: FPL publishes
     event_transfers for every gameweek, the accumulation rule is fixed,
     and event_transfers_cost independently tests the result. */
  const H = (rows, chips) => ({ current: rows, chips: chips || [] });
  const gw = (event, made, cost) => ({ event, event_transfers: made, event_transfers_cost: cost || 0 });

  /* GW1 is squad creation, not a transfer. Entering GW2 you have exactly
     one — which is the "FT 1" every manager shows in a live GW1 table. */
  const start = core.freeTransfers(H([gw(1, 0, 0)]), 5);
  ok(start.ft === 1, 'after GW1 a manager has one free transfer, got ' + start.ft);
  ok(start.verified === true, 'and the derivation agrees with the published hits');

  /* Bank one a week up to the cap, and no further. */
  const idle = core.freeTransfers(H([1, 2, 3, 4, 5, 6, 7, 8].map((e) => gw(e, 0, 0))), 5);
  ok(idle.ft === 5, 'saved transfers stop at the cap, got ' + idle.ft);
  ok(idle.cap === 5, 'and the cap is reported');

  /* THE CAP IS THE GAME'S, NOT OURS. It went from 2 to 5 in 2024/25 and
     a number written into this function would have been wrong for a
     season without anything failing. */
  const oldRules = core.freeTransfers(H([1, 2, 3, 4, 5].map((e) => gw(e, 0, 0))), 2);
  ok(oldRules.ft === 2, 'under a cap of two, two is the ceiling, got ' + oldRules.ft);

  /* Spending them. GW1→1 FT. GW2 uses it → 0, +1 = 1 entering GW3. */
  const spend = core.freeTransfers(H([gw(1, 0, 0), gw(2, 1, 0), gw(3, 1, 0)]), 5);
  ok(spend.ft === 1, 'spending one a week holds steady at one, got ' + spend.ft);

  /* A hit: two transfers on one free transfer costs 4, and leaves zero
     banked, so the next week starts from one. */
  const hit = core.freeTransfers(H([gw(1, 0, 0), gw(2, 2, 4)]), 5);
  ok(hit.ft === 1, 'after overspending you start again from one, got ' + hit.ft);
  ok(hit.verified === true, 'and a hit that our count predicts is consistent');

  /* THE SELF-CHECK, BOTH WAYS. This is what makes the number publishable
     rather than merely plausible: FPL already told us whether they were
     charged, so a reconstruction that disagrees is known to be wrong. */
  const tooGenerous = core.freeTransfers(H([gw(1, 0, 0), gw(2, 1, 4)]), 5);
  ok(tooGenerous.verified === false,
     'a hit charged where our count says there was room is a contradiction');
  const tooMean = core.freeTransfers(H([gw(1, 0, 0), gw(2, 3, 0)]), 5);
  ok(tooMean.verified === false,
     'and three transfers on one free transfer with no hit charged is one too');

  /* Wildcard and Free Hit: unlimited, free, and they preserve the bank.
     Eight transfers on a wildcard must not zero the saved count. */
  const wc = core.freeTransfers(
    H([gw(1, 0, 0), gw(2, 0, 0), gw(3, 8, 0)], [{ name: 'wildcard', event: 3 }]), 5);
  ok(wc.ft === 3, 'a wildcard preserves what was banked, got ' + wc.ft);
  ok(wc.verified === true, 'and costs nothing, as published');
  const fh = core.freeTransfers(
    H([gw(1, 0, 0), gw(2, 0, 0), gw(3, 11, 0)], [{ name: 'freehit', event: 3 }]), 5);
  ok(fh.ft === 3, 'and so does a free hit, got ' + fh.ft);

  /* A chip that does NOT free transfers must not be treated as if it
     did — a bench boost week is an ordinary transfer week. */
  const bb = core.freeTransfers(
    H([gw(1, 0, 0), gw(2, 0, 0), gw(3, 2, 0)], [{ name: 'bboost', event: 3 }]), 5);
  ok(bb.ft === 1, 'a bench boost week spends transfers normally, got ' + bb.ft);

  /* GW1 IS NOT A TRANSFER WEEK, and only a GW1 that reports transfers
     can show it. Every other test here has GW1 at zero transfers, where
     treating it as free and treating it as ordinary give the same
     answer — so without this the special case was untestable and a
     mutation removing it survived. FPL charges nothing for building the
     initial squad, so transfers in GW1 with no hit are correct data and
     must not be read as a contradiction. */
  const lateJoiner = core.freeTransfers(H([gw(1, 3, 0), gw(2, 0, 0)]), 5);
  ok(lateJoiner.verified === true,
     'transfers in GW1 with no hit charged are squad building, not a contradiction');
  ok(lateJoiner.ft === 2, 'and they do not eat into the allowance, got ' + lateJoiner.ft);

  /* Out-of-order history must not change the answer: the rule is
     sequential, so sorting is load-bearing. Comparing the FINAL count
     alone was not enough — the two orderings happen to land on the same
     number here — so the check that bites is `verified`, which the
     unsorted pass wrecks by testing each week against the wrong balance. */
  const shuffled = core.freeTransfers(H([gw(3, 1, 0), gw(1, 0, 0), gw(2, 2, 4)]), 5);
  const ordered = core.freeTransfers(H([gw(1, 0, 0), gw(2, 2, 4), gw(3, 1, 0)]), 5);
  ok(shuffled.ft === ordered.ft, 'history out of order gives the same count');
  ok(ordered.verified === true, 'the in-order season is consistent with its hits');
  ok(shuffled.verified === ordered.verified,
     'and shuffling the same season cannot make it inconsistent');

  /* upToGw with nothing before it: no weeks processed, so no number.
     This is the only path that reaches the empty-tally branch, and
     without it a mutation returning 0 there survived. */
  const none = core.freeTransfers(H([gw(3, 0, 0), gw(4, 0, 0)]), 5, 1);
  ok(none.ft === null, 'no gameweeks in range gives no count, not zero');
  ok(none.verified === false, 'and nothing verified');
  const upTo = core.freeTransfers(H([gw(1, 0, 0), gw(2, 0, 0), gw(3, 0, 0)]), 5, 2);
  ok(upTo.ft === 2, 'and a cut-off honours the weeks before it, got ' + upTo.ft);

  ok(core.freeTransfers(null, 5).ft === null, 'no history, no number — not a zero');
  ok(core.freeTransfers({ current: [] }, 5).ft === null, 'and an empty season likewise');
  ok(core.freeTransfers(null, 5).verified === false, 'an absent derivation is never "verified"');
  ok(core.freeTransfers(H([gw(1, 0, 0)]), 0).cap === 5,
     'a nonsense cap falls back rather than freezing the count at zero');
}

section('plannerBudget: what a rebuild can actually spend');
{
  /* MEASURED, NOT ASSUMED. dev/fpl-budget-basis.mjs summed six real
     squads at GW1 and found squad + bank = value every time, so the bank
     is already inside value. Adding it on top would hand a manager a
     fifth more money than they have. These are that probe's own rows. */
  const REAL = [
    { value: 1000, bank: 225, squad: 775 },
    { value: 1000, bank: 170, squad: 830 },
    { value: 1000, bank: 195, squad: 805 },
    { value: 1000, bank: 210, squad: 790 },
  ];
  REAL.forEach((r) => {
    ok(r.squad + r.bank === r.value, 'probe row is self-consistent: squad + bank = value');
    ok(core.plannerBudget(r, 9999).tenths === r.value,
       'budget is value alone (' + core.plannerBudget(r, 9999).tenths + ' from value ' + r.value + ')');
    ok(core.plannerBudget(r, 9999).tenths !== r.value + r.bank,
       'and emphatically NOT value + bank, which would be £' + ((r.value + r.bank) / 10).toFixed(1) + 'm');
  });

  const b = core.plannerBudget({ value: 1012, bank: 7 }, 1000);
  ok(b.fromEntry === true, 'a real entry supplies the budget');
  ok(b.tenths === 1012, 'a squad worth 101.2 can spend 101.2, got ' + b.tenths);
  ok(b.bank === 7, 'and the bank is reported separately for the card');

  /* Pre-season, or unlinked: the game's own starting budget. */
  const pre = core.plannerBudget(null, 1000);
  ok(pre.fromEntry === false, 'with no entry the budget is the fallback');
  ok(pre.tenths === 1000, 'which is the game budget, got ' + pre.tenths);
  ok(pre.bank === null, 'and there is no bank to report');
  ok(core.plannerBudget({}, 1000).tenths === 1000, 'an empty entry_history falls back too');
  ok(core.plannerBudget({ value: 0 }, 1000).tenths === 1000,
     'a zero value is not a budget of nothing — it is a missing figure');
  ok(core.plannerBudget({ value: -5 }, 1000).tenths === 1000, 'nor is a negative one');
  ok(core.plannerBudget({ value: 'abc' }, 1000).tenths === 1000, 'and neither is a non-number');

  /* The fallback must come from the game's published rules rather than a
     literal here, so a rule change is picked up rather than contradicted. */
  ok(core.plannerBudget(null, 950).tenths === 950, 'the caller decides the fallback');

  /* A missing bank does not become zero: "no bank reported" and "an
     empty bank" are different things on the card. */
  ok(core.plannerBudget({ value: 1000 }, 1000).bank === null, 'an absent bank is unknown');
  ok(core.plannerBudget({ value: 1000, bank: 0 }, 1000).bank === 0, 'an empty bank is zero');
}

section('tilePoints: what number goes on a player tile');
{
  /* The reported bug in one line: r.pts is score TIMES MULTIPLIER, so a
     bench player's is nought however well he played. Two separate cards
     had each written this choice out by hand and both got it wrong; it
     now lives in one place so they cannot disagree. */
  const bench = core.tilePoints({ mult: 0, base: 7, pts: 0 });
  ok(bench.counts === false, 'a bench player does not count');
  ok(bench.shown === 7, 'and shows what he SCORED, not his nought contribution');
  ok(bench.text === '7', 'as text for the tile');

  const starter = core.tilePoints({ mult: 1, base: 7, pts: 7 });
  ok(starter.counts === true && starter.shown === 7, 'a starter shows his score');

  /* The captain shows his CONTRIBUTION, so the counting tiles still add
     up to the gameweek total. */
  const cap = core.tilePoints({ mult: 2, base: 7, pts: 14 });
  ok(cap.counts === true && cap.shown === 14, 'a captain shows the doubled figure, got ' + cap.shown);
  const tc = core.tilePoints({ mult: 3, base: 7, pts: 21 });
  ok(tc.shown === 21, 'and a triple captain the tripled one');

  /* Under a Bench Boost the bench counts at 1, so the two readings
     coincide and nothing is greyed. */
  const bb = core.tilePoints({ mult: 1, base: 5, pts: 5 });
  ok(bb.counts === true && bb.shown === 5, 'a bench-boosted substitute counts, at his own score');

  /* A player who scored nothing still reads 0 — that is a real score. */
  ok(core.tilePoints({ mult: 0, base: 0, pts: 0 }).text === '0',
     'a substitute who genuinely scored nothing shows nought');

  /* AN UNKNOWN IS A DASH, NEVER A NOUGHT. The live feed not having
     reported a player is not the same as him scoring nothing, and this
     is the one distinction the fix must not trample: it would be easy to
     "fix" the bench by defaulting base to 0. */
  ok(core.tilePoints({ mult: 0, base: null, pts: null }).text === '—',
     'a substitute with no live row is a dash');
  ok(core.tilePoints({ mult: 1, base: null, pts: null }).text === '—', 'and so is a starter');
  ok(core.tilePoints({ mult: 0, base: null, pts: null }).shown === null,
     'with the null surviving as a null');

  ok(core.tilePoints(null).text === '—', 'no row at all does not throw');
  ok(core.tilePoints({}).counts === false, 'and a row with no multiplier does not count');
}

section('squadDiff: the transfers that turn my team into the plan');
{
  const cur = [1, 2, 3, 4, 5];
  ok(core.squadDiff(cur, [1, 2, 3, 4, 5]).moves === 0,
     'a plan identical to the squad needs no transfers');
  ok(core.squadDiff(cur, [1, 2, 3, 4, 5]).keep.length === 5, 'and keeps everyone');

  const d = core.squadDiff(cur, [1, 2, 3, 9, 8]);
  ok(d.in.join(',') === '9,8', 'incoming players are the ones the plan adds');
  ok(d.out.join(',') === '4,5', 'outgoing are the ones it drops');
  ok(d.moves === 2, 'two swaps, got ' + d.moves);
  ok(d.keep.join(',') === '1,2,3', 'the rest are kept');

  /* MOVES COUNTS INCOMING, and for a complete fifteen that is the same
     number as outgoing. On a half-built plan it is not: only the ins are
     known, because which of your players a finished plan would displace
     has not been decided. So the count is a floor and `exact` says so. */
  const full = (n, off) => Array.from({ length: 15 }, (_, i) => i + 1 + (i < n ? off : 0));
  const both15 = core.squadDiff(full(0, 0), full(3, 100));
  ok(both15.exact === true, 'two complete fifteens give an exact transfer count');
  ok(both15.in.length === both15.out.length, 'and the ins and outs balance');
  ok(both15.moves === 3, 'three changes, got ' + both15.moves);

  const partial = core.squadDiff(full(0, 0), [1, 2, 3, 99]);
  ok(partial.exact === false, 'a half-built plan is not an exact count');
  ok(partial.moves === 1, 'and reports only the players it would have to bring in');

  /* Duplicates and nulls must not inflate the count. */
  ok(core.squadDiff([1, 1, 2], [1, 2]).moves === 0, 'a repeated id is not a transfer');
  /* And a duplicate on the PLAN side is one player, not two transfers.
     draftCanAdd cannot produce one, but the plan is restored from
     localStorage and that is not a validated source. */
  ok(core.squadDiff([], [5, 5]).moves === 1,
     'a player listed twice in the plan is still one transfer, got ' + core.squadDiff([], [5, 5]).moves);
  ok(core.squadDiff([], [5, 5]).in.join(',') === '5', 'and appears once in the list');
  ok(core.squadDiff([1, null, 2], [1, 2, undefined]).moves === 0, 'nor is a missing one');
  ok(core.squadDiff(null, null).moves === 0, 'and nothing at all does not throw');
  ok(core.squadDiff([], [7]).in.join(',') === '7', 'an empty squad needs the whole plan');

  /* Order of the plan is the order transfers are listed, so the card can
     show them the way the user built them. */
  ok(core.squadDiff([1], [5, 3, 1]).in.join(',') === '5,3',
     'incoming keeps the plan order');
}

section('plannerMoves: what those transfers cost, and when we do not know');
{
  const D = (n) => ({ moves: n });

  ok(core.plannerMoves(D(2), 2).paid === 0, 'two transfers on two free ones cost nothing');
  ok(core.plannerMoves(D(2), 2).cost === 0, 'so no points');
  ok(core.plannerMoves(D(4), 1).paid === 3, 'four on one free leaves three paid');
  ok(core.plannerMoves(D(4), 1).cost === 12, 'at four points each, got ' + core.plannerMoves(D(4), 1).cost);
  ok(core.plannerMoves(D(1), 5).free === 1,
     'the free count never exceeds the transfers actually made');

  /* A NULL FREE-TRANSFER COUNT IS NOT ZERO. freeTransfers() returns null
     when its derivation was contradicted or there was no history, and
     treating that as "no free transfers" would quote a hit for every
     move on no evidence at all. */
  const unknown = core.plannerMoves(D(3), null);
  ok(unknown.known === false, 'an underived free-transfer count is marked unknown');
  ok(unknown.paid === null, 'so the paid count is withheld');
  ok(unknown.cost === null, 'and no points cost is claimed');
  ok(unknown.moves === 3, 'though the number of transfers is still known');

  /* A game with no transfer cost charges nothing — the same gate
     transferFrame uses, rather than a second opinion about the rules. */
  const freeGame = core.plannerMoves(D(5), 1, false);
  ok(freeGame.paid === 4, 'a costless game still counts transfers beyond the allowance');
  ok(freeGame.cost === 0, 'but charges nothing for them');
  ok(freeGame.per === 0, 'and says the per-transfer cost is zero');

  ok(core.plannerMoves(null, 2).moves === 0, 'no diff, no moves');
  ok(core.plannerMoves(D(0), 0).cost === 0, 'nothing planned costs nothing');
  ok(core.plannerMoves(D(-3), 1).moves === 0, 'a negative count is floored at zero');
  ok(core.plannerMoves(D(2), -1).free === 0, 'and so is a negative allowance');
}

section('leagueAwards: top score, captain, bench and differential');
{
  const ELS = {
    1: { id: 1, web_name: 'Haaland' }, 2: { id: 2, web_name: 'Salah' },
    3: { id: 3, web_name: 'Saka' },    4: { id: 4, web_name: 'Mbeumo' },
    5: { id: 5, web_name: 'Benchy' },  6: { id: 6, web_name: 'Ødegaard' },
  };
  const ST = { 1: { total_points: 12 }, 2: { total_points: 8 }, 3: { total_points: 2 },
    4: { total_points: 5 }, 5: { total_points: 21 }, 6: { total_points: 11 } };
  const E = (n, name, team, gw) => ({ entry: n, player_name: name, entry_name: team, event_total: gw });
  /* Three managers. Everyone starts Haaland and Salah (template), only
     the third starts Ødegaard (a differential), and the second has a
     mountain on the bench. */
  const entries = [E(1, 'Max', 'Lammenade', 40), E(2, 'Sean', 'Mainoo', 49), E(3, 'Gareth', 'Wilson', 35)];
  const picks = [
    { picks: [
      { element: 1, position: 1, multiplier: 2, is_captain: true },
      { element: 2, position: 2, multiplier: 1 },
      { element: 3, position: 3, multiplier: 1 },
      { element: 5, position: 12, multiplier: 0 },
    ] },
    { picks: [
      { element: 1, position: 1, multiplier: 1 },
      { element: 2, position: 2, multiplier: 2, is_captain: true },
      { element: 4, position: 3, multiplier: 1 },
      { element: 5, position: 12, multiplier: 0 },
    ] },
    { picks: [
      { element: 1, position: 1, multiplier: 1 },
      { element: 2, position: 2, multiplier: 1 },
      { element: 6, position: 3, multiplier: 1, is_captain: true },
      { element: 4, position: 12, multiplier: 0 },
    ] },
  ];
  const a = core.leagueAwards(entries, picks, ST, ELS);

  ok(a.managers === 3, 'all three managers counted, got ' + a.managers);
  /* Top score reads the STANDINGS total, not a sum of the live rows —
     the official figure already carries hits and auto-subs. */
  ok(a.top.mgr === 'Sean' && a.top.pts === 49, 'top score is the highest gameweek total');
  ok(a.top.team === 'Mainoo', 'and names the team as well as the manager');

  /* THE ARMBAND IS THE MULTIPLIER. Haaland captained is 12 × 2 = 24;
     Salah captained is 8 × 2 = 16; Ødegaard captained is 11 × 1 — a
     multiplier of 1 means the armband moved, so it is not doubled. */
  ok(a.cap.pts === 24, 'the best captain is scored through the multiplier, got ' + a.cap.pts);
  ok(a.cap.mgr === 'Max' && a.cap.name === 'Haaland', 'and is attributed correctly');

  ok(a.bench.pts === 21 && a.bench.mgr === 'Max', 'bench tragedy is the biggest bench score');

  /* A differential is owned by at most two of the loaded managers.
     Haaland and Salah are started by all three, so neither qualifies
     however well they scored — which is the point of the award. */
  ok(a.diff !== null, 'a differential hero was found');
  ok(a.diff.name === 'Ødegaard', 'the low-owned starter wins it, got ' + a.diff.name);
  ok(a.diff.pts === 11, 'with his own score, not a doubled one');
  ok(a.diff.mgr === 'Gareth', 'credited to the manager who owned him');

  /* A BENCHED COPY OF A DIFFERENTIAL IS NOT A HERO, and proving that
     needs a player who is started by one manager and benched by another.
     A player nobody starts never enters the ownership count at all, so
     he is excluded whether or not the bench is filtered — which is why
     the first version of this check could not tell the two apart.

     Here Benchy scores 21 and is STARTED by the second manager and
     BENCHED by the first. The award belongs to the manager who played
     him; crediting the one who left him out would be the opposite of
     what the award means. */
  const twoMgrs = [E(1, 'Benched-him', 'A', 10), E(2, 'Played-him', 'B', 30)];
  const twoPicks = [
    { picks: [{ element: 1, position: 1, multiplier: 1 }, { element: 5, position: 12, multiplier: 0 }] },
    { picks: [{ element: 1, position: 1, multiplier: 1 }, { element: 5, position: 2, multiplier: 1 }] },
  ];
  const bh = core.leagueAwards(twoMgrs, twoPicks, ST, ELS);
  ok(bh.diff && bh.diff.name === 'Benchy', 'the low-owned starter is the hero');
  ok(bh.diff.mgr === 'Played-him',
     'credited to the manager who STARTED him, not the one who benched him (got ' + bh.diff.mgr + ')');
}

section('leagueAwards: nothing to award, and nothing to throw');
{
  const ELS = { 1: { id: 1, web_name: 'A' } };
  const E = { entry: 1, player_name: 'M', entry_name: 'T', event_total: 0 };
  const P = [{ picks: [{ element: 1, position: 1, multiplier: 1 }] }];

  ok(core.leagueAwards([], [], {}, ELS) === null, 'no entries, no awards');
  ok(core.leagueAwards(null, null, {}, ELS) === null, 'and no throw on missing inputs');
  ok(core.leagueAwards([E], [null], {}, ELS) === null,
     'a manager whose picks failed to load leaves nothing to award');

  /* Before a ball is kicked every score is nought. The three headline
     awards still resolve — somebody is nominally top — but the
     differential is withheld, because nobody has scored with one and
     "hero, 0 points" is not a finding. */
  const zero = core.leagueAwards([E], P, {}, ELS);
  ok(zero !== null && zero.top.pts === 0, 'a scoreless gameweek still has a top score');
  ok(zero.diff === null, 'but no differential hero at nought points');

  /* A live feed with no row for a player is nought for the award, which
     is right here: an award is a comparison, and a missing row cannot
     win one. */
  const noLive = core.leagueAwards([E], P, {}, ELS);
  ok(noLive.cap.pts === 0, 'a captain with no live row scores nothing rather than throwing');

  /* Only the managers actually passed in are counted, so the "top N"
     claim on the card matches what was measured. */
  const two = core.leagueAwards(
    [E, { entry: 2, player_name: 'N', entry_name: 'U', event_total: 5 }],
    [P[0], P[0]], { 1: { total_points: 3 } }, ELS);
  ok(two.managers === 2, 'the manager count reports what was measured, got ' + two.managers);
}

section('sortLeagueRows: a different order, not a different league');
{
  /* Six managers. Deliberately: the league leader is NOT top this week,
     and the manager 6th on total has the best gameweek — the case the
     whole feature exists for. */
  const R = [
    { entry: 1, rank: 1, lastRank: 1, total: 200, gwPts: 40, or: 500,     tv: 101.5, yet: 3, playedUnits: 9,  totalUnits: 12 },
    { entry: 2, rank: 2, lastRank: 4, total: 195, gwPts: 55, or: 12000,   tv: 100.0, yet: 0, playedUnits: 12, totalUnits: 12 },
    { entry: 3, rank: 3, lastRank: 2, total: 190, gwPts: 30, or: 3000,    tv: 102.2, yet: 5, playedUnits: 4,  totalUnits: 12 },
    { entry: 4, rank: 4, lastRank: 3, total: 185, gwPts: 45, or: 900,     tv: 99.5,  yet: 1, playedUnits: 10, totalUnits: 12 },
    { entry: 5, rank: 5, lastRank: 5, total: 180, gwPts: 20, or: 250000,  tv: 100.7, yet: 8, playedUnits: 2,  totalUnits: 12 },
    { entry: 6, rank: 6, lastRank: 6, total: 175, gwPts: 60, or: 77,      tv: 98.8,  yet: 2, playedUnits: 12, totalUnits: 16 },
  ];
  const order = (rows) => rows.map((r) => r.entry).join(',');

  /* League order is the default and is what the position column means. */
  ok(order(core.sortLeagueRows(R, 'rank')) === '1,2,3,4,5,6', 'league position sorts 1 first');
  ok(order(core.sortLeagueRows(R, 'total')) === '1,2,3,4,5,6', 'and so does total points, on this table');

  /* THE POINT OF THE FEATURE. Sorted by gameweek, last place leads. */
  ok(order(core.sortLeagueRows(R, 'gw')) === '6,2,4,1,3,5',
     'gameweek points puts the best week first (' + order(core.sortLeagueRows(R, 'gw')) + ')');

  /* THE RANK IS NOT RECOMPUTED. Reordering rows must not renumber them:
     the manager top of the gameweek is still 6th in the league, and a
     table that said otherwise would be describing a different league. */
  const byGw = core.sortLeagueRows(R, 'gw');
  ok(byGw[0].rank === 6, 'the best gameweek is still labelled 6th, got ' + byGw[0].rank);
  ok(byGw.map((r) => r.rank).sort((a, b) => a - b).join(',') === '1,2,3,4,5,6',
     'every league position survives the sort exactly once');

  /* Overall rank ascends by default — 1 is the good end. */
  ok(order(core.sortLeagueRows(R, 'or')) === '6,1,4,3,2,5',
     'overall rank puts the best rank first (' + order(core.sortLeagueRows(R, 'or')) + ')');
  ok(order(core.sortLeagueRows(R, 'tv')) === '3,1,5,2,4,6', 'team value puts the richest squad first');
  ok(order(core.sortLeagueRows(R, 'yet')) === '5,3,1,6,4,2', 'players to play puts the most left first');

  /* Progress is a fraction, so a bench-boosted 10/16 ranks below 11/12
     — the point being that raw counts are not comparable across chips. */
  const prog = core.sortLeagueRows(R, 'played');
  ok(prog[0].entry === 2, 'the finished squad is first on progress');
  /* THE COMPARISON MUST BE A FRACTION. Entry 6 has bench-boosted, so he
     has MORE units played in absolute terms (12) than entry 4 (10) while
     being LESS far through his gameweek (12/16 against 10/12). Raw counts
     and fractions therefore order these two oppositely, which is the only
     arrangement that can tell the two implementations apart — the first
     version of this test had 11/12 against 10/16, where both orderings
     agree, and a mutation to raw counts sailed through it. */
  ok(prog.findIndex((r) => r.entry === 4) < prog.findIndex((r) => r.entry === 6),
     '10 of 12 is further through than 12 of 16, though the raw counts say otherwise');

  /* Direction override. */
  ok(order(core.sortLeagueRows(R, 'gw', 1)) === '5,3,1,4,2,6', 'the direction can be reversed');
  ok(order(core.sortLeagueRows(R, 'gw', -1)) === order(core.sortLeagueRows(R, 'gw')),
     'and the explicit natural direction matches the default');

  /* Rank movement: entry 2 climbed two, entry 3 and 4 dropped one. */
  ok(core.sortLeagueRows(R, 'move')[0].entry === 2, 'rank movement puts the biggest climb first');

  /* Unknown key is not a silent reorder into some arbitrary order. */
  ok(order(core.sortLeagueRows(R, 'nonsense')) === '1,2,3,4,5,6',
     'an unrecognised sort key leaves the order alone');
  ok(core.sortLeagueRows(null, 'gw').length === 0, 'a missing list does not throw');

  /* The input must not be mutated — the caller still holds league order. */
  const before = order(R);
  core.sortLeagueRows(R, 'gw');
  ok(order(R) === before, 'sorting returns a new array and leaves the original alone');
}

section('sortLeagueRows: a manager with no value does not win the sort');
{
  /* A squad that failed to load has no team value and no overall rank.
     Treating that as zero would make him the poorest manager in the
     league; treating it as infinity would make him the richest. Both
     invent a fact. He sinks, in BOTH directions. */
  const R = [
    { entry: 1, rank: 1, total: 100, tv: 101.0, or: 500 },
    { entry: 2, rank: 2, total: 90,  tv: null,  or: null },
    { entry: 3, rank: 3, total: 80,  tv: 99.0,  or: 900 },
  ];
  const ord = (k, d) => core.sortLeagueRows(R, k, d).map((r) => r.entry).join(',');

  ok(ord('tv') === '1,3,2', 'no team value sinks on a high-to-low sort');
  ok(ord('tv', 1) === '3,1,2', 'and sinks on a low-to-high sort too');
  ok(ord('or') === '1,3,2', 'the same for a missing overall rank');
  ok(ord('or', -1) === '3,1,2', 'in both directions');

  /* Several unknowns keep league order among themselves, so the table
     does not reshuffle between repaints. */
  const many = [
    { entry: 1, rank: 1, tv: null }, { entry: 2, rank: 2, tv: 100 },
    { entry: 3, rank: 3, tv: null }, { entry: 4, rank: 4, tv: null },
  ];
  ok(core.sortLeagueRows(many, 'tv').map((r) => r.entry).join(',') === '2,1,3,4',
     'unknowns hold league order among themselves');

  /* NaN is not a number either, however arithmetic produced it. */
  ok(core.sortLeagueRows([
    { entry: 1, rank: 1, tv: NaN }, { entry: 2, rank: 2, tv: 50 },
  ], 'tv')[0].entry === 2, 'NaN sinks like a missing value');

  /* Equal values fall back to league order rather than input order, so
     two repaints of the same table agree. */
  const tied = [
    { entry: 3, rank: 3, gwPts: 40 }, { entry: 1, rank: 1, gwPts: 40 },
    { entry: 2, rank: 2, gwPts: 40 },
  ];
  ok(core.sortLeagueRows(tied, 'gw').map((r) => r.entry).join(',') === '1,2,3',
     'ties break on league position, so the order is deterministic');
}

section('leagueStdRow / LEAGUE_SORTS: one sorter for two views');
{
  /* The compact table has standings and the detailed view has assembled
     rows; they must present the same field names or the sorter silently
     stops working in one of them. */
  const std = core.leagueStdRow({ entry: 7, entry_name: 'Team', player_name: 'Manager',
    rank: 4, last_rank: 2, event_total: 55, total: 190 });
  ok(std.rank === 4 && std.lastRank === 2, 'rank and movement are renamed onto the shared shape');
  ok(std.gwPts === 55 && std.total === 190, 'and so are the two point totals');
  ok(std.raw && std.raw.entry_name === 'Team',
     'the original row is carried through so the renderer keeps its own fields');

  /* Every always-available sort must actually work on a standings row —
     this is the check that catches a field renamed on one side only. */
  const compactKeys = core.LEAGUE_SORTS.filter((o) => !o.detail).map((o) => o.key);
  ok(compactKeys.length === 4, 'four sorts need nothing but standings, got ' + compactKeys.length);
  ok(compactKeys.every((k) => core.sortLeagueRows([std, core.leagueStdRow(
      { entry: 8, rank: 1, last_rank: 3, event_total: 60, total: 200 })], k).length === 2),
     'and every one of them sorts a standings row without throwing');

  /* The detail-only sorts must be marked, or the compact table offers a
     control that cannot do anything. */
  const detailKeys = core.LEAGUE_SORTS.filter((o) => o.detail).map((o) => o.key);
  ok(detailKeys.join(',') === 'or,tv,yet,played',
     'the squad-dependent sorts are flagged (' + detailKeys.join(',') + ')');
  ok(detailKeys.every((k) => core.leagueStdRow({ rank: 1 })[core.leagueSortSpec(k).key] === undefined
      || k === 'played'),
     'and none of them is answerable from standings alone');

  ok(core.leagueSortSpec('rank').dir === 1, 'league position reads best-first ascending');
  ok(core.leagueSortSpec('total').dir === -1, 'points read best-first descending');
  ok(core.leagueSortSpec('or').dir === 1, 'overall rank ascends — 1 is the good end');
  ok(core.leagueSortSpec('nope') === null, 'an unknown key has no spec');
  ok(core.LEAGUE_SORTS.every((o) => o.dir === 1 || o.dir === -1),
     'every sort declares a direction');
  ok(new Set(core.LEAGUE_SORTS.map((o) => o.key)).size === core.LEAGUE_SORTS.length,
     'and the keys are unique, so the select cannot have two of the same');
}

section('boardDeadline: the clock names the gameweek the app is on');
{
  const ev = (id, iso) => ({ id: id, deadline_time: iso });
  const EVENTS = [ev(1, '2026-08-14T17:15:00Z'), ev(2, '2026-08-21T17:15:00Z'),
                  ev(3, '2026-08-28T17:15:00Z'), ev(4, '2026-09-04T17:15:00Z'),
                  ev(5, '2026-09-11T17:15:00Z'), ev(6, '2026-09-18T17:15:00Z')];
  const NOW = new Date('2026-08-22T12:00:00Z').getTime();   /* GW2 under way */

  {
    /* The ordinary case: the anchor is ahead, so it is the clock. */
    const r = core.boardDeadline(ev(3, '2026-08-28T17:15:00Z'), EVENTS, NOW);
    ok(r.event.id === 3, 'an anchor still ahead is the deadline shown, got ' + r.event.id);
    ok(r.underWay === null, 'and nothing is under way');
    ok(r.upcoming.map(e => e.id).join(',') === '4,5,6',
       'the rest follow it, without repeating it, got ' + r.upcoming.map(e => e.id).join(','));
  }
  {
    /* The case that made the card disagree with the sidebar: the anchor's
       deadline has gone. The clock moves on AND says why. */
    const r = core.boardDeadline(ev(2, '2026-08-21T17:15:00Z'), EVENTS, NOW);
    ok(r.event.id === 3, 'a passed anchor hands the clock to the next gameweek, got ' + r.event.id);
    ok(r.underWay && r.underWay.id === 2,
       'and the round already running is named, got ' + JSON.stringify(r.underWay && r.underWay.id));
  }
  {
    /* No anchor at all — between seasons, or before a fixture list. There
       is nothing to call under way, and no number to invent. */
    const r = core.boardDeadline(null, EVENTS, NOW);
    ok(r.event.id === 3, 'with no anchor the next deadline still shows, got ' + r.event.id);
    ok(r.underWay === null, 'and nothing is claimed to be under way');
  }
  {
    const r = core.boardDeadline(null, EVENTS, new Date('2027-01-01T00:00:00Z').getTime());
    ok(r.event === null && r.upcoming.length === 0,
       'a finished season has no deadline and no list');
  }
  ok(core.boardDeadline(null, null, NOW).event === null,
     'and no events at all is answered, not thrown');
}

section('gwDayStatus: how far through the round are we, day by day');
{
  const at = (day, h) => '2026-08-' + String(day).padStart(2, '0') +
    'T' + String(h).padStart(2, '0') + ':00:00Z';
  const fx = (day, h, o) => Object.assign({ event: 2, kickoff_time: at(day, h) }, o);
  const day = (rows, i) => core.gwDayStatus(rows, 2)[i || 0];

  ok(core.gwDayStatus([], 2).length === 0, 'no fixtures means no days, not a blank row');
  ok(core.gwDayStatus([fx(29, 12, {})], 3).length === 0,
     'another gameweek\u2019s fixtures are not this gameweek\u2019s days');
  ok(core.gwDayStatus([{ event: 2 }], 2).length === 0,
     'a fixture with no kick-off time cannot be placed on a day');

  ok(day([fx(29, 12, { started: false })]).state === 'toCome',
     'nothing kicked off is still to come');
  ok(day([fx(29, 12, { started: true })]).state === 'live',
     'a ball rolling is in play');
  /* The state FPL's own board spends most of a Saturday evening in:
     every match played, bonus not yet confirmed. */
  ok(day([fx(29, 12, { started: true, finished_provisional: true })]).state === 'provisional',
     'played but unconfirmed is provisional, not finished');
  ok(day([fx(29, 12, { started: true, finished: true, finished_provisional: true })]).state === 'finished',
     'scored by FPL is finished');
  /* A day half played is neither, and rounding it to either would be a
     claim the fixtures do not support. */
  ok(day([fx(29, 12, { started: true, finished_provisional: true }),
          fx(29, 17, { started: false })]).state === 'part',
     'one match done and one to come is part played');
  ok(day([fx(29, 12, { started: true, finished: true, finished_provisional: true }),
          fx(29, 17, { started: true })]).state === 'live',
     'and a match actually in play outranks the one already scored');

  {
    const days = core.gwDayStatus([
      fx(31, 12, { started: false }),
      fx(29, 15, { started: true, finished: true, finished_provisional: true }),
      fx(29, 17, { started: true, finished: true, finished_provisional: true }),
      fx(30, 14, { started: true, finished_provisional: true }),
    ], 2);
    ok(days.length === 3, 'one row per calendar day, got ' + days.length);
    ok(days.map(d => d.state).join('|') === 'finished|provisional|toCome',
       'and they come back in kick-off order, got ' + days.map(d => d.state).join('|'));
    ok(days[0].games === 2, 'a day counts its own matches, got ' + days[0].games);
  }
}

section('bonusForFixture: bonus is a ranking, and a ranking needs something to rank');
{
  /* Reported as "live points isn't correct", proved by one screenshot: five
     players in five different fixtures each carrying a provisional +3, when
     a single match only ever awards 3-2-1 to three of them. The squad's
     live total ran 12 points high — four counting players inflated by 3
     apiece — against the same squad's league card. */
  const B = { elements: [
    { id: 1, team: 1, web_name: 'Keeper' },
    { id: 2, team: 1, web_name: 'Back' },
    { id: 3, team: 2, web_name: 'Wing' },
    { id: 4, team: 2, web_name: 'Sub' },
    { id: 5, team: 3, web_name: 'Elsewhere' },
  ], cur: { id: 2 } };
  const F = { event: 2, team_h: 1, team_a: 2, started: true, finished: false,
    finished_provisional: false };

  {
    /* Two minutes into the match. Everybody is on the pitch, nobody has
       banked anything yet. Before the fix all four tied on 0, took the
       first slot as one group, and were handed three bonus each. */
    const st = { 1: { bps: 0, minutes: 2 }, 2: { bps: 0, minutes: 2 },
                 3: { bps: 0, minutes: 2 }, 4: { bps: 0, minutes: 2 } };
    ok(core.bonusForFixture(B, st, F) === null,
       'a match where nobody has positive BPS projects no bonus at all');
  }
  {
    /* Real BPS: the 3-2-1 goes to the top three, and the player on nothing
       is not one of them however few rivals he has. */
    const st = { 1: { bps: 30, minutes: 90 }, 2: { bps: 22, minutes: 90 },
                 3: { bps: 11, minutes: 90 }, 4: { bps: 0, minutes: 6 } };
    const r = core.bonusForFixture(B, st, F);
    ok(r.earners.length === 3, 'three earners, not everyone on the pitch, got ' + r.earners.length);
    ok(r.earners.map(x => x.e.id + ':' + x.bonus).join('|') === '1:3|2:2|3:1',
       'and they take 3-2-1 in BPS order, got ' + r.earners.map(x => x.e.id + ':' + x.bonus).join('|'));
    ok(!r.earners.some(x => x.e.id === 4), 'a player on zero BPS earns nothing');
    ok(r.confirmed === false, 'and it is provisional until FPL posts real bonus');
  }
  {
    /* FPL's own tie rule, which the grouping already implemented and which
       this fix must not disturb: two level at the top take 3 each and the
       next takes 1, with the 2 consumed by the tie. */
    const st = { 1: { bps: 30, minutes: 90 }, 2: { bps: 30, minutes: 90 },
                 3: { bps: 11, minutes: 90 }, 4: { bps: 4, minutes: 90 } };
    const r = core.bonusForFixture(B, st, F);
    ok(r.earners.map(x => x.bonus).join(',') === '3,3,1',
       'a tie at the top takes 3-3-1, got ' + r.earners.map(x => x.bonus).join(','));
  }
  {
    /* Confirmed bonus is FPL's, and the projection stands aside. */
    const st = { 1: { bps: 30, minutes: 90, bonus: 3 }, 2: { bps: 22, minutes: 90 },
                 3: { bps: 11, minutes: 90 } };
    ok(core.bonusForFixture(B, st, F).confirmed === true,
       'once FPL has posted bonus in the match the fixture reads as confirmed');
  }

  /* provBonusPts, the number the pitch view actually adds to the squad. */
  {
    const picks = { picks: [
      { element: 1, position: 1, multiplier: 1 },
      { element: 2, position: 2, multiplier: 1 },
      { element: 3, position: 3, multiplier: 2 },
      { element: 4, position: 12, multiplier: 0 },
    ] };
    const kickoff = { 1: { bps: 0, minutes: 2 }, 2: { bps: 0, minutes: 2 },
                      3: { bps: 0, minutes: 2 }, 4: { bps: 0, minutes: 2 } };
    ok(core.provBonusPts(B, kickoff, [F], picks).extra === 0,
       'at kickoff the squad gains no provisional bonus, got ' +
       core.provBonusPts(B, kickoff, [F], picks).extra);
    /* The bench player tops the BPS table, the captain is second. Earners
       are 4:+3, 3:+2, 1:+1 — so the squad should gain the captain's 2
       doubled plus 1, and nothing at all for the bench player's 3. */
    const live = { 4: { bps: 50, minutes: 90 }, 3: { bps: 40, minutes: 90 },
                   1: { bps: 30, minutes: 90 }, 2: { bps: 22, minutes: 90 } };
    const got = core.provBonusPts(B, live, [F], picks);
    ok(got.extra === 5,
       'the captain multiplier applies and the bench earns nothing, got ' + got.extra);
    ok(got.prov[4] === 3,
       'though the bench player is still projected his own bonus for display');
  }
}

section('managerDetail: one row of the detailed league table');
{
  const ELS = {
    1: { id: 1, web_name: 'Raya', team: 1, element_type: 1 },
    2: { id: 2, web_name: 'Saka', team: 1, element_type: 3 },
    3: { id: 3, web_name: 'Haaland', team: 2, element_type: 4 },
    4: { id: 4, web_name: 'Bench1', team: 3, element_type: 2 },
    5: { id: 5, web_name: 'Blanker', team: 9, element_type: 3 },
  };
  const PICKS = {
    active_chip: '3xc',
    entry_history: { event: 3, overall_rank: 791032, value: 1003, bank: 7,
      event_transfers: 2, event_transfers_cost: 4 },
    picks: [
      { element: 1, position: 1, multiplier: 1 },
      { element: 2, position: 2, multiplier: 1, is_vice_captain: true },
      { element: 3, position: 3, multiplier: 3, is_captain: true },
      { element: 5, position: 4, multiplier: 1 },
      { element: 4, position: 12, multiplier: 0 },
    ],
  };
  const LIVE = { elements: [
    { id: 1, stats: { total_points: 2 } },
    { id: 2, stats: { total_points: 5 } },
    { id: 3, stats: { total_points: 9 } },
    { id: 5, stats: { total_points: 0 } },
    { id: 4, stats: { total_points: 6 } },
  ] };
  const STATE = { 1: 'done', 2: 'live', 3: 'done', 4: 'done', 5: 'blank' };
  const STD = { entry: 42, entry_name: 'Lammenade', player_name: 'Max Sargeant',
    rank: 1, last_rank: 2, event_total: 28, total: 28 };
  const eo = core.leagueEO([PICKS]);
  const d = core.managerDetail(STD, PICKS, LIVE, STATE, ELS, eo.byId);

  ok(d.name === 'Lammenade' && d.mgr === 'Max Sargeant', 'the standings identity comes through');
  ok(d.chip === '3xc', 'the active chip is read from the picks, not guessed');
  ok(d.or === 791032, 'overall rank comes from entry_history');
  /* value and bank are published in tenths of a million. */
  ok(d.tv === 100.3, 'team value is converted out of tenths (' + d.tv + ')');
  ok(d.bank === 0.7, 'and so is the bank (' + d.bank + ')');
  ok(d.transfers === 2 && d.hit === 4, 'transfers and their cost are carried');

  /* PROGRESS IN UNITS, NOT PLAYERS. Two of the four counting players are
     finished — but one of them is the triple captain, worth 3 on his own.
     Counting players would read 2/4; counting what actually scores reads
     4/6. The second is the one that tells you how much of your gameweek
     is already banked. */
  ok(d.totalUnits === 6, 'total units is the sum of multipliers (' + d.totalUnits + ')');
  ok(d.playedUnits === 4,
     'a finished triple captain carries three units, not one (' + d.playedUnits + ')');

  /* A blank is not a "yet to play". Saying otherwise promises points that
     are not coming. */
  ok(d.yet === 0, 'nobody is yet to play — the only one left is a blank');
  ok(d.playing === 1, 'one player is on the pitch');
  ok(d.blanks === 1, 'and one has no fixture at all');

  ok(d.captain && d.captain.name === 'Haaland', 'the captain is identified');
  ok(d.vice && d.vice.name === 'Saka', 'and so is the vice');
  ok(d.xi.length === 4 && d.bench.length === 1, 'the XI and bench are split');
  ok(d.xi[0].eo != null, 'each player carries the league effective ownership');
  ok(d.xi.find((p) => p.name === 'Haaland').pts === 27,
     'a triple captain scores three times, got ' + d.xi.find((p) => p.name === 'Haaland').pts);
  ok(d.bench[0].pts === 0, 'a benched player scores nothing however well he played');
  ok(d.bench[0].base === 6, 'though his raw score is still available');

  /* THE SCORE THIS ROW USED TO GET WRONG. gwPts was std.event_total —
     the classic-standings field FPL freezes until it scores the gameweek
     — so all through a live matchday the row printed a confident number
     (0 early on) directly above its own players showing 2, 5 and 27.
     Reported from a live gameweek as "the live score isn't updating with
     the live points". It is summed from the live feed now, and net of the
     hit, because FPL's own total is net of it too and the two have to be
     the same quantity or the number drops when the gameweek settles.
     Live rows here are 2 + 5 + (9x3) + 0 = 34, less the -4 = 30. */
  ok(d.gwPts === 30,
     'the gameweek score is summed live and net of the hit, got ' + d.gwPts);
  ok(d.gwLive === true, 'and is flagged as a running total');
  ok(d.gwOfficial === 28,
     "while FPL's own figure stays available for the row to name when they disagree");
  {
    const settled = core.managerDetail({ ...STD, event_total: 31 },
      { ...PICKS, entry_history: { ...PICKS.entry_history, points: 31 } },
      LIVE, STATE, ELS, eo.byId, null, 5, true);
    ok(settled.gwPts === 31 && settled.gwLive === false,
       'and once the gameweek is scored FPL\u2019s own total takes over, got ' + settled.gwPts);
  }

  /* THE SEASON TOTAL, which is on FPL's scoring clock exactly like
     event_total is. Reported after the gameweek column was fixed: the
     detailed card showed no cumulative total at all, so rows sorted on
     rank were sorted by a quantity the card never printed. Printing
     std.total raw would have been its own bug — through a live matchday
     that figure is the total THROUGH LAST WEEK, so it would sit beside a
     live gameweek score reading as of a different day, then jump. */
  ok(d.totalRun === 28,
     'with no history to read, the total is FPL\u2019s own and nothing else, got ' + d.totalRun);
  {
    /* THE REPORTED BUG. A live GW3 with nothing kicked off: rank 4 printed
       64 against rank 2's 57 and rank 3's 52, an ordering no league table
       can produce. The overall ranks on the same rows ascended cleanly, so
       the sort was right and the number was wrong.

       The old arithmetic was total − event_total + live, which assumed
       event_total describes the gameweek on screen. It does not have to:
       until FPL scores GW3 those standings fields still describe GW2, so
       the subtraction removed a week that had already been played and the
       card printed the total through GW1.

       The history settles it without an assumption. GW1 and GW2 are in it,
       GW3 is not, so the answer is GW2's cumulative plus what GW3 is worth
       live: 104 + 30. Under the old expression this read 104 − 44 + 30 = 90. */
    const HIST = { current: [
      { event: 1, points: 60, total_points: 60 },
      { event: 2, points: 44, total_points: 104 },
    ] };
    const live3 = core.managerDetail({ ...STD, event_total: 44, total: 104 },
      PICKS, LIVE, STATE, ELS, eo.byId, HIST);
    ok(live3.totalRun === 134,
       'an unscored gameweek is added to the history\u2019s cumulative total, got ' + live3.totalRun);
    ok(live3.totalLive === true, 'and the total is flagged as still moving');

    /* THE PROPERTY THAT MATTERS: the answer no longer depends on a field
       whose gameweek nobody can determine. Whatever the standings say
       event_total is, the history says which weeks are counted. */
    const odd = core.managerDetail({ ...STD, event_total: 999, total: 104 },
      PICKS, LIVE, STATE, ELS, eo.byId, HIST);
    ok(odd.totalRun === 134,
       'and event_total cannot move it, whatever gameweek it belongs to, got ' + odd.totalRun);

    /* Once FPL scores the week its own cumulative figure is the answer,
       and nothing is added on top of it. */
    const scored = core.managerDetail({ ...STD, event_total: 31, total: 135 },
      { ...PICKS, entry_history: { ...PICKS.entry_history, points: 31 } },
      LIVE, STATE, ELS, eo.byId,
      { current: HIST.current.concat([{ event: 3, points: 31, total_points: 135 }]) },
      5, true);
    ok(scored.totalRun === 135 && scored.totalLive === false,
       'a scored gameweek takes FPL\u2019s cumulative total, untouched, got ' + scored.totalRun);

    /* A first gameweek has no history behind it, and 30 is the season. */
    const first = core.managerDetail({ ...STD, event_total: 0, total: 0 },
      { ...PICKS, entry_history: { ...PICKS.entry_history, event: 1 } },
      LIVE, STATE, ELS, eo.byId, { current: [] });
    ok(first.totalRun === 30,
       'the opening gameweek IS the season total, got ' + first.totalRun);
  }
  ok(core.managerDetail({ ...STD, total: null }, PICKS, LIVE, STATE, ELS, eo.byId).totalRun === null,
     'a row with no season total prints nothing rather than a wrong number');

  /* THE OVERALL RANK. It had no test at all, and neither did the mock
     server carry an overall_rank field, so the whole column rendered
     nothing under test while shipping to every card in production. */
  {
    const HIST = { current: [
      { event: 1, overall_rank: 900000 },
      { event: 2, overall_rank: 742118 },
    ] };
    const d2 = core.managerDetail(STD, PICKS, LIVE, STATE, ELS, eo.byId, HIST, 5);
    ok(d2.or === 742118 && d2.orEvent === 2,
       'the overall rank comes from the newest gameweek FPL has ranked, got ' + d2.or);
  }
  {
    /* Mid-gameweek: FPL has not scored this week, so its row carries no
       rank yet. The honest answer is last week's rank, named as such —
       not a blank column that looks broken. */
    const HIST = { current: [
      { event: 1, overall_rank: 900000 },
      { event: 2, overall_rank: null },
    ] };
    const d2 = core.managerDetail(STD, PICKS, LIVE, STATE, ELS, eo.byId, HIST, 5);
    ok(d2.or === 900000 && d2.orEvent === 1,
       'an unranked gameweek falls back to the last ranked one, got ' + d2.or + '@' + d2.orEvent);
  }
  {
    /* History failed to load: entry_history is the fallback, and it
       cannot say which gameweek it is as of. */
    const withOr = { ...PICKS,
      entry_history: { ...PICKS.entry_history, overall_rank: 555111 } };
    const d2 = core.managerDetail(STD, withOr, LIVE, STATE, ELS, eo.byId, null, 5);
    ok(d2.or === 555111 && d2.orEvent === null,
       'with no history the picks payload still supplies a rank, got ' + d2.or);
  }
  {
    /* Nothing ranked anywhere: no history rows AND no rank in the picks
       payload. The pill has to be absent, not zero — a rank of 0 does
       not exist, and printing one would be a fabricated position. */
    const bare = { ...PICKS,
      entry_history: { ...PICKS.entry_history, overall_rank: undefined } };
    const d2 = core.managerDetail(STD, bare, LIVE, STATE, ELS, eo.byId, { current: [] }, 5);
    ok(d2.or === null && d2.orEvent === null,
       'a manager with no ranked gameweek anywhere prints no rank, got ' + JSON.stringify(d2.or));
  }

  /* THE PROGRESS BREAKDOWN MUST ADD UP TO ITS OWN DENOMINATOR.
     Reported as the played count being wrong, and the card proved it:
     "Played 2/12 ... 5 still to play. 4 on the pitch." — eleven against
     twelve. playedUnits/totalUnits were multiplier-weighted while the
     named buckets were headcounts, so the line came up short by exactly
     the captain whenever he sat in one of them. */
  {
    /* The fixture's captain (element 3, multiplier 3 under Triple
       Captain) is 'done', Saka is 'live', Raya is 'done', the blanker
       has no fixture. Counting rows are the four with mult > 0. */
    ok(d.playedUnits + d.yetUnits + d.playingUnits + d.blankUnits === d.totalUnits,
       'the four state buckets account for every scoring slot, got ' +
       [d.playedUnits, d.yetUnits, d.playingUnits, d.blankUnits].join('+') +
       ' vs ' + d.totalUnits);
    ok(d.playingUnits === 1 && d.playing === 1,
       'one player on the pitch is one slot when he is not the captain');
    ok(d.blankUnits === 1 && d.blanks === 1, 'and the blanker is one of each');
  }
  {
    /* The captain in a bucket is where units and headcount part company,
       and the case the report actually hit: one player, three slots. */
    const STATE2 = { 1: 'done', 2: 'done', 3: 'toPlay', 4: 'done', 5: 'blank' };
    const d2 = core.managerDetail(STD, PICKS, LIVE, STATE2, ELS, eo.byId);
    ok(d2.yet === 1 && d2.yetUnits === 3,
       'a Triple Captain still to play is one player and three slots, got ' +
       d2.yet + '/' + d2.yetUnits);
    ok(d2.playedUnits + d2.yetUnits + d2.playingUnits + d2.blankUnits === d2.totalUnits,
       'and the buckets still account for the whole total');
  }

  ok(core.managerDetail(STD, null, LIVE, STATE, ELS, {}) === null,
     'a manager whose picks failed to load has no row');
  ok(core.managerDetail(STD, { picks: 'nope' }, LIVE, STATE, ELS, {}) === null,
     'and neither does a malformed payload');

  /* No live feed yet: points are unknown, not zero. */
  const early = core.managerDetail(STD, PICKS, { elements: [] }, STATE, ELS, eo.byId);
  ok(early.xi.every((p) => p.pts === null), 'with no live rows, points are null rather than nought');
  ok(early.liveKnown === 0, 'and the row says how little it knows');
}

section('managerDetail: the markers — free transfers, value, rank, chips');
{
  const ELS = { 1: { id: 1, web_name: 'A', team: 1, element_type: 3 } };
  const PICKS = {
    active_chip: 'bboost',
    entry_history: { overall_rank: 1186437, value: 1012, bank: 3,
      event_transfers: 1, event_transfers_cost: 0 },
    picks: [{ element: 1, position: 1, multiplier: 1 }],
  };
  const HIST = {
    current: [
      { event: 1, event_transfers: 0, event_transfers_cost: 0 },
      { event: 2, event_transfers: 0, event_transfers_cost: 0 },
      { event: 3, event_transfers: 1, event_transfers_cost: 0 },
    ],
    chips: [{ name: 'wildcard', event: 2 }, { name: 'bboost', event: 3 }],
  };
  const d = core.managerDetail({ entry: 1, rank: 1 }, PICKS, { elements: [] },
    {}, ELS, {}, HIST, 5);

  /* The four markers the user asked for. */
  ok(d.ft && d.ft.ft === 2, 'free transfers are derived (' + (d.ft && d.ft.ft) + ')');
  ok(d.ft.verified === true, 'and checked against the published hit costs');
  ok(d.tv === 101.2, 'team value (' + d.tv + ')');
  ok(d.bank === 0.3, 'money in the bank (' + d.bank + ')');
  ok(d.or === 1186437, 'overall rank');

  /* Chips: the whole season's ledger, with the live one marked. A chip
     played in GW2 is only in the history; one played now is in both, and
     the row has to say which is which. */
  ok(d.chips.length === 2, 'both chips played this season are listed, got ' + d.chips.length);
  ok(d.chips.map((c) => c.short).join(',') === 'WC,BB',
     'in the order they were played (' + d.chips.map((c) => c.short).join(',') + ')');
  ok(d.chips[0].active === false, 'a chip played in an earlier gameweek is not active');
  ok(d.chips[1].active === true, 'and the one running right now is');
  ok(d.chips[1].event === 3, 'each carries the gameweek it was played');
  ok(d.chips[0].label === 'Wildcard', 'with a readable label, not the API code');

  /* A chip the API names but we have no short code for must still show. */
  const odd = core.managerDetail({ entry: 1 }, PICKS, { elements: [] }, {}, ELS, {},
    { current: HIST.current, chips: [{ name: 'somethingnew', event: 4 }] }, 5);
  ok(odd.chips[0].short === 'somethingnew',
     'an unknown chip falls back to its name rather than vanishing');

  /* No history loaded: no free transfers, no chips — and crucially no
     zero, which would read as "used them all" and "played none". */
  const bare = core.managerDetail({ entry: 1 }, PICKS, { elements: [] }, {}, ELS, {}, null, 5);
  ok(bare.ft.ft === null, 'without history the free-transfer count is null, not zero');
  ok(bare.ft.verified === false, 'and is not presented as verified');
  ok(bare.chips.length === 0, 'and no chips are claimed');

  /* A contradicted derivation must reach the row as unverified so the
     card can withhold it. */
  const bad = core.managerDetail({ entry: 1 }, PICKS, { elements: [] }, {}, ELS, {},
    { current: [{ event: 1, event_transfers: 0, event_transfers_cost: 0 },
                { event: 2, event_transfers: 1, event_transfers_cost: 4 }], chips: [] }, 5);
  ok(bad.ft.verified === false, 'a derivation FPL contradicts arrives marked unverified');
}

section('leagueSwing: the players who actually separate a league');
{
  const ELS = {
    1: { id: 1, web_name: 'Template' }, 2: { id: 2, web_name: 'Differential' },
    3: { id: 3, web_name: 'Captained' }, 4: { id: 4, web_name: 'Benched' },
  };
  /* Four managers. Template started by all four (EO 100%), Differential by
     one (25%), Captained by all and captained by all (200%), Benched by
     all and started by none (0%). */
  const league = [];
  for (let i = 0; i < 4; i++) league.push({ picks: [
    { element: 1, position: 1, multiplier: 1 },
    { element: 2, position: 2, multiplier: i === 0 ? 1 : 0 },
    { element: 3, position: 3, multiplier: 2, is_captain: true },
    { element: 4, position: 12, multiplier: 0 },
  ] });
  const eo = core.leagueEO(league);
  const sw = core.leagueSwing(league.length ? [] : [], eo, ELS, 10);

  /* THE POINT, and this block used to state half of it.

     A player the whole league starts once each cannot change anyone's
     position — his points land on every manager equally. That much was
     always asserted here, and it still holds: Template is gone from the
     list entirely.

     What this block ALSO used to assert is that "Captained" — owned by
     everyone and captained by everyone, EO 200% — was among the BIGGEST
     swings, because the old measure was |1 - eo| and 200% is a full unit
     from 100%. That was the same bug wearing its other face. Everyone
     getting double is still everyone getting the same: he cannot move a
     single manager past another, however many he scores. The test blessed
     it for as long as the code did.

     All three no-signal shapes now drop out, and only the genuine
     differential is left. */
  const names = sw.map((x) => x.name);
  ok(!names.includes('Template'), 'a player every manager starts identically does not appear');
  ok(!names.includes('Captained'), 'nor one every manager CAPTAINS identically, at 200%');
  ok(!names.includes('Benched'), 'nor one every manager owns and nobody starts, at 0%');
  ok(names.join(',') === 'Differential',
     'the one player the league disagrees on is the whole list (' + names.join(', ') + ')');

  /* The effective-ownership figures themselves are unchanged — it is the
     RANKING that was wrong, not the percentages, which is why every row in
     the reported screenshot was arithmetically correct. */
  ok(Math.abs(eo.byId[3].eo - 2) < 1e-9, 'a universally captained player is still 200%');
  ok(eo.byId[4].eo === 0, 'and a universally benched one is still 0%');
  ok(Math.abs(eo.byId[2].eo - 0.25) < 1e-9, 'a one-in-four pick is still 25%');
  /* Both extremes now score zero separating power, by the same rule and
     for the same reason, rather than a full unit each. */
  ok(eo.byId[3].sd === 0 && eo.byId[4].sd === 0 && eo.byId[1].sd === 0,
     'everyone-captains, everyone-benches and everyone-starts all separate nobody');

  /* The limit needs a league with enough separating players to cap. This
     one deliberately has exactly one, so it is tested where the rows are. */
  ok(core.leagueSwing([], eo, ELS, 2).length === 1,
     'a league with one divisive player lists one, not a padded two');
  ok(core.leagueSwing([], { byId: {} }, ELS, 5).length === 0, 'an empty league has no swing players');
  ok(core.leagueSwing([], eo, {}, 5).length === 0,
     'a player the bootstrap does not know is skipped rather than shown nameless');
}

section('fplPriceMove: FPL’s own figure, read rather than approximated');
{
  /* Shapes copied from a live bootstrap-static, measured 22 Aug 2026. */
  const CALAFIORI = {
    price_change_percent: '19.9', price_change_hourly_rate: 1327,
    price_change_calibrating: false, price_change_locked_until: null,
    price_change_projections: [
      { offset: 0, projected_percent: '32.5', likelihood: 2 },
      { offset: 1, projected_percent: '52.5', likelihood: 3 },
      { offset: 2, projected_percent: '72.5', likelihood: 4 }]
  };
  const PORRO = {
    price_change_percent: '-7.4', price_change_hourly_rate: -1854,
    price_change_calibrating: false, price_change_locked_until: null,
    price_change_projections: [
      { offset: 0, projected_percent: '-11.3', likelihood: -1 },
      { offset: 1, projected_percent: '-17.5', likelihood: -1 },
      { offset: 2, projected_percent: '-23.7', likelihood: -2 }]
  };
  const LOCKED = {
    price_change_percent: '0.0', price_change_hourly_rate: 0,
    price_change_calibrating: false,
    price_change_locked_until: '2026-08-30T13:56:30.932335Z',
    price_change_projections: []
  };

  const a = core.fplPriceMove(CALAFIORI);
  ok(a && a.pct === 19.9 && a.dir === 'rise', 'a positive figure reads back as a rise (' + (a && a.pct) + ')');
  ok(a.proj.length === 3 && a.proj[0].pct === 32.5 && a.proj[2].pct === 72.5,
     'all three projection offsets are carried, in order');
  ok(a.rate === 1327, 'the hourly rate is read');

  const f = core.fplPriceMove(PORRO);
  ok(f.dir === 'fall' && f.pct === -7.4, 'a negative figure reads back as a fall');
  ok(f.proj[2].pct === -23.7, 'and its projections stay negative rather than losing the sign');

  /* Order is the entire reason this replaced our estimate: ranked by
     magnitude, the biggest mover has to come first whichever way it moves. */
  const ranked = [PORRO, CALAFIORI].map((x) => core.fplPriceMove(x))
    .sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));
  ok(ranked[0].pct === 19.9, 'ranking by magnitude puts the biggest mover first regardless of direction');

  /* Projections out of order upstream must still come back in order — the
     column reads "today → +2d" and a shuffled array would print it backwards. */
  const shuffled = core.fplPriceMove(Object.assign({}, CALAFIORI, {
    price_change_projections: CALAFIORI.price_change_projections.slice().reverse()
  }));
  ok(shuffled.proj.map((x) => x.offset).join(',') === '0,1,2',
     'projections sort by offset regardless of payload order');

  /* Absence, and the three ways it happens. Each must yield null so the panel
     falls back to the estimate and SAYS it did, rather than rendering a blank
     where a number used to be. */
  ok(core.fplPriceMove({}) === null, 'no price_change_percent yields null');
  ok(core.fplPriceMove(null) === null, 'a null element yields null rather than throwing');
  ok(core.fplPriceMove({ price_change_percent: 'n/a' }) === null, 'an unparseable figure yields null, not NaN');
  ok(core.fplPriceMove(Object.assign({}, CALAFIORI, { price_change_calibrating: true })) === null,
     'CALIBRATING yields null — the game saying its own number is not ready is not a number');

  /* A zero is a real answer and must not be confused with absence: the player
     is flat, which is different from FPL having no view. */
  const flat = core.fplPriceMove({ price_change_percent: '0.0' });
  ok(flat !== null && flat.dir === 'flat' && flat.pct === 0,
     'a genuine zero is flat, NOT absent');

  ok(core.fplPriceMove(Object.assign({}, CALAFIORI, { price_change_projections: null })).proj.length === 0,
     'a missing projections array degrades to no projections rather than throwing');
  ok(core.fplPriceMove(Object.assign({}, CALAFIORI, {
    price_change_projections: [{ offset: 0, projected_percent: 'x' }] })).proj.length === 0,
     'an unparseable projection row is dropped rather than becoming NaN');

  /* Locked players cannot move however large the figure, so listing one as
     "closest to a move" would be wrong. Locked is a fact from the API. */
  const L = core.fplPriceMove(LOCKED);
  const beforeLock = Date.parse('2026-08-25T00:00:00Z');
  const afterLock = Date.parse('2026-09-01T00:00:00Z');
  ok(core.priceLocked(L, beforeLock) === true, 'a player is locked before the stated time');
  ok(core.priceLocked(L, afterLock) === false, 'and unlocked after it — the lock expires rather than sticking');
  ok(core.priceLocked(a, beforeLock) === false, 'a player with no lock is never locked');
  ok(core.priceLocked(null, beforeLock) === false, 'no figure at all is not a lock');
}

section('priceSource: the panel’s claim about provenance follows the data');
{
  const T = Date.parse('2026-08-25T00:00:00Z');
  const moving = { price_change_percent: '19.9' };
  const flat = { price_change_percent: '0.0' };
  const locked = { price_change_percent: '12.0', price_change_locked_until: '2026-08-30T00:00:00Z' };
  const none = { web_name: 'nobody' };

  ok(core.priceSource([moving, none], T).official === true,
     'one player with a real figure is enough to show FPL’s number');
  ok(core.priceSource([none, none], T).official === false,
     'no figures at all falls back to the estimate');

  /* A table of players who cannot move is not a price panel. If the only
     figures we have are locked, claiming to show FPL’s live view would be a
     false statement about provenance even though the field is populated. */
  ok(core.priceSource([locked, none], T).official === false,
     'ONLY locked players is not an official view — it falls back');
  ok(core.priceSource([locked, none], T).locked === 1, 'and the locked player is still counted, to be disclosed');
  ok(core.priceSource([locked, moving], T).official === true,
     'one unlocked mover alongside a locked one is enough');

  /* Flat is a real answer but not a mover, so a field full of zeroes — which
     is exactly what the API served the day before it went live — must not
     read as "FPL is telling us something". */
  ok(core.priceSource([flat, flat, flat], T).official === false,
     'every player flat falls back rather than showing an all-zero table');
  ok(core.priceSource([flat, flat], T).withFigure === 2,
     'though a flat figure still counts as FPL having a view');

  ok(core.priceSource([], T).official === false, 'no elements at all falls back');
  ok(core.priceSource(null, T).official === false, 'a null element list does not throw');

  /* The lock expires. After its time the same player is a normal mover. */
  ok(core.priceSource([locked], Date.parse('2026-09-05T00:00:00Z')).official === true,
     'once the lock expires the player counts again');
}

section('priceChangeProb caps, direction, monotonic in net transfers');
const TOTAL = 10e6;
const mk = (tin, tout, own) => ({ transfers_in_event: tin, transfers_out_event: tout, selected_by_percent: String(own) });
let prev = -1, monotone = true;
for (const tin of [0, 10e3, 50e3, 120e3, 250e3, 600e3]) {
  const r = core.priceChangeProb(mk(tin, 0, 10), TOTAL);
  ok(r.prob >= 5 && r.prob <= 95, 'prob within [5,95] at net ' + tin);
  if (r.prob < prev) monotone = false;
  prev = r.prob;
}
ok(monotone, 'rise probability monotonic in net transfers');
ok(core.priceChangeProb(mk(100e3, 0, 5), TOTAL).dir === 'rise', 'net buys → rise');
ok(core.priceChangeProb(mk(0, 100e3, 5), TOTAL).dir === 'fall', 'net sells → fall');
ok(core.priceChangeProb(mk(0, 0, 5), TOTAL).dir === 'flat', 'no net movement → flat');
const lowOwn = core.priceChangeProb(mk(150e3, 0, 2), TOTAL);
const highOwn = core.priceChangeProb(mk(150e3, 0, 40), TOTAL);
ok(lowOwn.prob > highOwn.prob, 'same net transfers → low ownership rises with higher probability');
ok(lowOwn.prob >= 90, 'heavily-transferred low-ownership player shows a high estimate');
const symm = core.priceChangeProb(mk(0, 150e3, 2), TOTAL);
ok(symm.prob === lowOwn.prob, 'fall probability symmetric with rise');

/* ── suspension model: cutoffs and proximity levels ─────── */
section('suspRisk cutoffs / proximity levels');
ok(core.suspCutoff(1).limit === 5 && core.suspCutoff(19).limit === 5, '5-card limit through GW19');
ok(core.suspCutoff(20).limit === 10 && core.suspCutoff(32).limit === 10, '10-card limit GW20–32');
ok(core.suspCutoff(33).limit === 15 && core.suspCutoff(38).limit === 15, '15-card limit after GW32');
ok(core.suspRisk(4, 10).level === 'edge', '4 yellows at GW10 → one from a ban');
ok(core.suspRisk(3, 10).level === 'watch', '3 yellows at GW10 → two away');
ok(core.suspRisk(2, 10).level === null, '2 yellows at GW10 → no flag');
ok(core.suspRisk(4, 25).level === null, '4 yellows after the GW19 cutoff → no flag (limit 10)');
ok(core.suspRisk(9, 25).level === 'edge', '9 yellows at GW25 → one from the 10-card ban');
ok(core.suspRisk(5, 10).level === 'banned', 'hitting the limit flags as banned');
ok(core.suspRisk(0, 1).left === 5 && core.suspRisk(0, 1).level === null, 'clean record → 5 left, no flag');
ok(core.suspRisk(null, 10).yellows === 0, 'null yellows treated as 0');

/* ── minutesSecurity: bounds, monotonicity, availability ── */
section('minutesSecurity bounds, monotonicity, availability');
const mkMS = (starts, mins, status, ch) => ({
  starts, minutes: mins, status: status || 'a',
  chance_of_playing_next_round: ch == null ? null : ch
});
ok(core.minutesSecurity(mkMS(38, 3420), 38) === 100, 'ever-present starter scores 100');
ok(core.minutesSecurity(mkMS(0, 0), 38) === 0, 'no starts, no minutes scores 0');
let msPrev = -1, msMono = true;
for (const s of [0, 5, 10, 20, 30, 38]) {
  const v = core.minutesSecurity(mkMS(s, s * 90), 38);
  ok(v >= 0 && v <= 100, 'within [0,100] at ' + s + ' starts');
  if (v < msPrev) msMono = false;
  msPrev = v;
}
ok(msMono, 'monotonic in starts share');
ok(core.minutesSecurity(mkMS(38, 3420, 'i'), 38) <= 5, 'injured status is zero-ish (availability floor)');
ok(core.minutesSecurity(mkMS(38, 3420, 's'), 38) <= 5, 'suspended status is zero-ish');
ok(core.minutesSecurity(mkMS(38, 3420, 'a', 50), 38) === 50, 'chance-of-playing scales the score');
ok(core.minutesSecurity(mkMS(99, 99999), 38) <= 100, 'clamped for over-the-top inputs');
ok(core.minutesSecurity(mkMS(10, 900), 0) >= 0 && core.minutesSecurity(mkMS(10, 900), 0) <= 100, 'zero club games handled');

/* ── projectXI: legal XI from club data ─────────────────── */
section('projectXI picks a legal XI');
const squad = [];
let id = 1;
const push = (type, n, starts, mins, status) => {
  for (let i = 0; i < n; i++) squad.push({
    id: id++, team: 7, element_type: type, starts, minutes: mins,
    status: status || 'a', chance_of_playing_next_round: null
  });
};
push(1, 2, 10, 900); push(2, 5, 9, 850); push(3, 5, 8, 800); push(4, 3, 7, 700);
push(3, 2, 1, 90);                                   /* fringe players */
const fakeB = { elements: squad };
const proj = core.projectXI(fakeB, 7, 10);
ok(!!proj, 'returns a projection');
ok(proj.xi.length === 11, 'projects exactly 11 players');
ok(proj.xi.filter(x => x.el.element_type === 1).length === 1, 'exactly one goalkeeper');
ok(proj.formation.reduce((a, c) => a + c, 0) === 10, 'formation covers ten outfielders');
ok(proj.xi.every(x => x.p >= 0 && x.p <= 1), 'start likelihoods within [0,1]');
const injured = squad.map(e => e.element_type === 4 ? { ...e, status: e.id === 13 ? 'i' : e.status } : e);
const proj2 = core.projectXI({ elements: injured }, 7, 10);
ok(proj2.xi.filter(x => x.el.status === 'i').every(x => x.p <= 0.06), 'injured players carry a floor score');

/* ── clean-sheet probabilities from the score grid ──────── */
section('lgScoreGrid / lgCleanSheets');
const grid = core.lgScoreGrid(1.5, 1.1, -0.074);
let gridSum = 0;
for (const p of grid) gridSum += p;
ok(Math.abs(gridSum - 1) < 1e-9, 'score grid sums to 1');
const csPair = core.lgCleanSheets(grid);
ok(csPair[0] >= 0 && csPair[0] <= 1 && csPair[1] >= 0 && csPair[1] <= 1, 'CS probabilities within [0,1]');
ok(csPair[0] > csPair[1], 'facing the lower-scoring attack ⇒ higher CS%');
const gridWeakOpp = core.lgScoreGrid(1.5, 0.6, -0.074);
ok(core.lgCleanSheets(gridWeakOpp)[0] > csPair[0], 'stronger defence (lower xGA) ⇒ higher CS%');
ok(grid[0] <= Math.min(csPair[0], csPair[1]) + 1e-12, 'P(0-0) never exceeds either CS probability');
const gridPlain = core.lgScoreGrid(1.5, 1.1, null); /* no DC correction */
const csPlain = core.lgCleanSheets(gridPlain);
ok(Math.abs(csPlain[0] - Math.exp(-1.1)) < 1e-3, 'plain-Poisson home CS ≈ e^-λaway');
ok(Math.abs(csPlain[1] - Math.exp(-1.5)) < 1e-3, 'plain-Poisson away CS ≈ e^-λhome');
const csDC = core.lgCleanSheets(core.lgScoreGrid(1.5, 1.1, -0.074));
ok(csDC[0] !== csPlain[0], 'Dixon-Coles correction moves the low-score mass');

/* ── draft validators: budget / position / club / save gate ─ */
section('draftValidate / draftCanAdd rules');
let draftSeq = 1;
const mkD = (type, team, cost) => ({ id: draftSeq++, element_type: type, team, now_cost: cost });
function legalSquad(costGK, costDEF, costMID, costFWD) {
  const a = [];
  for (let k = 0; k < 2; k++) a.push(mkD(1, k + 1, costGK));
  for (let k = 0; k < 5; k++) a.push(mkD(2, k + 1, costDEF));
  for (let k = 0; k < 5; k++) a.push(mkD(3, k + 6, costMID));
  for (let k = 0; k < 3; k++) a.push(mkD(4, k + 11, costFWD));
  return a;
}
const sq15 = legalSquad(45, 50, 70, 80); /* cost 930, bank 70 */
const vOK = core.draftValidate(sq15);
ok(vOK.complete && vOK.quotaOk && vOK.clubOk, 'legal 15 is complete and inside every quota');
ok(vOK.cost === 930 && vOK.bank === 70, 'cost and bank computed against the £100.0m budget');
ok(vOK.saveable, 'valid, complete, in-budget draft is saveable');
const vRich = core.draftValidate(legalSquad(50, 60, 90, 95)); /* cost 1135 */
ok(vRich.overBudget && vRich.bank === -135, 'over-budget draft flagged with a negative bank');
ok(!vRich.saveable, 'over-budget draft is NOT saveable');
const vPart = core.draftValidate(sq15.slice(0, 14));
ok(!vPart.complete && !vPart.saveable, 'incomplete squad (14) is not saveable');
ok(!vPart.overBudget, 'incomplete squad can still be within budget');
const vClub = core.draftValidate(sq15.map((p, i) => (i >= 2 && i < 6 ? { ...p, team: 99 } : p)));
ok(!vClub.clubOk && !vClub.saveable, 'four players from one club breaks the 3-per-club rule');
const vBudget = core.draftValidate(sq15, 900);
ok(vBudget.overBudget && !vBudget.saveable, 'custom budget respected');
ok(!core.draftCanAdd(sq15, mkD(4, 15, 60)), 'cannot add a 16th player');
const part13 = sq15.slice(0, 13); /* 2 GK, 5 DEF, 5 MID, 1 FWD */
ok(core.draftCanAdd(part13, mkD(4, 15, 60)), 'a needed forward can be added (even over budget)');
ok(!core.draftCanAdd(part13, mkD(2, 15, 45)), 'cannot exceed the 5-DEF quota');
ok(!core.draftCanAdd(part13, { ...part13[0] }), 'cannot add a duplicate player');
const trio = [mkD(2, 7, 45), mkD(3, 7, 60), mkD(4, 7, 60)];
ok(!core.draftCanAdd(trio, mkD(3, 7, 55)), 'the 3-per-club cap is enforced on add');
ok(core.draftCanAdd(trio, mkD(3, 8, 55)), 'a fourth player from another club is fine');

/* ── draftBuild / draftFillGaps: the 2026/27 guided builder ── */
section('draftBuild: guided, legal, in-budget squad');
let bseq = 1000;
const bpool = [], bxp = {};
const addP = (type, team, cost, xp) => { const p = { id: bseq++, element_type: type, team, now_cost: cost, status: 'a', web_name: 'P' + bseq }; bpool.push(p); bxp[p.id] = xp; };
for (let team = 1; team <= 20; team++) {
  addP(1, team, 40, 12 + team % 3 * 4); addP(1, team, 50, 28 + team % 3 * 4);
  for (let i = 0; i < 4; i++) addP(2, team, 40 + i * 15, 18 + i * 18 + team % 4 * 5);
  for (let i = 0; i < 4; i++) addP(3, team, 45 + i * 25, 24 + i * 28 + team % 5 * 6);
  for (let i = 0; i < 2; i++) addP(4, team, 50 + i * 45, 30 + i * 42 + team % 3 * 7);
}
/* a deliberately weak club (id 21) nobody would pick on merit — mid-priced
   so it competes on merit, not as cheap bench fodder */
for (let i = 0; i < 4; i++) addP(2 + (i % 3), 21, 55, 1);
const cost4Low = sq => sq.map(e => e.now_cost).sort((a, c) => a - c).slice(0, 4).reduce((a, c) => a + c, 0);
const xiCost = sq => sq.slice().sort((a, c) => bxp[c.id] - bxp[a.id]).slice(0, 11).reduce((a, c) => a + (c.now_cost || 0), 0);
const spend = (sq, types) => sq.filter(e => types.includes(e.element_type)).reduce((a, c) => a + (c.now_cost || 0), 0);

const built = core.draftBuild(bpool, bxp, {});
const bv = core.draftValidate(built);
ok(built.length === 15, 'builds a full 15');
ok(bv.complete && bv.quotaOk && bv.clubOk && !bv.overBudget, 'the built squad is complete, legal and within £100.0m');
ok(built.every(e => e.team !== 21), 'a no-merit club is left out by default');

const fav = core.draftBuild(bpool, bxp, { favClub: 21 });
ok(fav.filter(e => e.team === 21).length >= 1 && core.draftValidate(fav).saveable, 'favourite-club preference forces in a player from that club, still legal');

const benchStrong = core.draftBuild(bpool, bxp, { bench: 'strong' });
const benchCheap = core.draftBuild(bpool, bxp, { bench: 'cheap' });
ok(xiCost(benchCheap) >= xiCost(benchStrong), 'cheap-bench build spends more on the starting XI than the strong-15 build');
ok(cost4Low(benchCheap) <= cost4Low(benchStrong), 'and its four cheapest (the bench) cost no more');

const atk = core.draftBuild(bpool, bxp, { tilt: 'attack' });
const def = core.draftBuild(bpool, bxp, { tilt: 'defence' });
ok(spend(atk, [3, 4]) >= spend(def, [3, 4]), 'attack lean puts more budget into MID+FWD than defence lean');

const s1 = core.draftBuild(bpool, bxp, { seed: 1 }), s2 = core.draftBuild(bpool, bxp, { seed: 2 });
const idset = a => a.map(e => e.id).sort().join(',');
ok(idset(s1) !== idset(s2), 'different seeds yield a different squad (Generate again works)');
ok(core.draftValidate(s1).saveable && core.draftValidate(s2).saveable, 'both re-rolls are legal');
ok(idset(core.draftBuild(bpool, bxp, { seed: 1 })) === idset(s1), 'same seed + prefs is deterministic');

section('draftFillGaps: keep picks, fill the rest');
const kept = [built[0], built.find(e => e.element_type === 4), built.find(e => e.element_type === 3)];
const filled = core.draftFillGaps(bpool, bxp, kept);
const keptIds = new Set(kept.map(e => e.id));
ok(filled.length === 15 && core.draftValidate(filled).saveable, 'fills a partial squad to a legal 15');
ok(kept.every(e => filled.some(f => f.id === e.id)), 'every kept player is retained');
ok(core.draftFillGaps(bpool, bxp, built).length === 15, 'a complete squad is left untouched');

/* ── fitJSON (ai.js): valid JSON within budget ──────────── */
section('fitJSON always yields valid JSON within budget');
const big = { players: Array.from({ length: 500 }, (_, i) => ({ n: 'Player ' + i, xP: i % 9, next: 'OPP (H)' })) };
const out = core.fitJSON(big, 9000);
ok(out.length <= 9000, 'output within budget');
let parsed = null;
try { parsed = JSON.parse(out); } catch (_) {}
ok(parsed !== null, 'output parses as JSON (never cut mid-token)');
ok(Array.isArray(parsed.players), 'structure preserved (arrays trimmed, not mangled)');
const small = { a: 1 };
ok(core.fitJSON(small, 9000) === JSON.stringify(small), 'small contexts pass through untouched');

/* ── bestTransfer: coherent, captain-safe suggestions ───── */
section('bestTransfer never sells a protected pick, holds below threshold');
let bt = 1;
const mkBT = (type, team, cost, hx, extra) => Object.assign(
  { id: bt++, element_type: type, team, now_cost: cost, _hx: hx,
    status: 'a', chance_of_playing_next_round: null, web_name: 'P' + bt,
    selected_by_percent: '10' }, extra || {});
/* XI: a strong captain and a genuinely weak starter, same position. */
const capP = mkBT(3, 1, 90, 3.0);      /* id 2 — the captain */
const weakP = mkBT(3, 2, 55, 0.0);     /* id 3 — the weak link */
const xiBT = [capP, weakP];
const squadBT = [capP, weakP];
/* Candidate pool: a clear upgrade and a marginal one, both affordable MIDs. */
const upgrade = mkBT(3, 5, 60, 5.0);   /* +5 over weakP */
const marginal = mkBT(3, 6, 60, 0.4);  /* +0.4 over weakP — below threshold */
const bPool = { elements: [capP, weakP, upgrade, marginal] };
const protect = new Set([capP.id]);
const pick = core.bestTransfer(bPool, squadBT, xiBT, 40, {}, protect);
ok(pick !== null, 'a clear upgrade is surfaced');
ok(pick && pick.out.id === weakP.id, 'sells the weak link, not the captain');
ok(pick && pick.cand.id === upgrade.id, 'brings in the biggest horizon upgrade');
ok(pick && pick.gain >= core.MIN_TR_GAIN, 'reported gain clears the threshold');
/* With only a marginal option, the honest call is HOLD (null). */
const pickMarginal = core.bestTransfer({ elements: [capP, weakP, marginal] }, squadBT, xiBT, 40, {}, protect);
ok(pickMarginal === null, 'no move below the gain threshold → hold (no +0.0 suggestion)');
/* The captain is the weakest by horizon but protected → must not be sold. */
const capWeak = mkBT(3, 1, 90, 0.0);   /* captain now the lowest hx */
const otherStarter = mkBT(3, 2, 55, 4.0);
const pickProtect = core.bestTransfer(
  { elements: [capWeak, otherStarter, upgrade] }, [capWeak, otherStarter],
  [capWeak, otherStarter], 40, {}, new Set([capWeak.id]));
ok(!pickProtect || pickProtect.out.id !== capWeak.id, 'a protected captain is never the sell, even when weakest');

/* ── gwPhase: the between-gameweek state machine ────────── */
section('gwPhase resolves pre / live / post / between / ended');
const HR = 3600e3, DAY = 86400e3;
const T0 = 1_700_000_000_000;               /* fixed "now" for determinism */
const iso = ms => new Date(ms).toISOString();
/* Two-event world: GW10 (the one we're around) and GW11 (next). */
const mkEvents = (cfg) => [
  { id: 10, deadline_time: iso(cfg.g10), is_current: cfg.cur10, is_next: false,
    data_checked: !!cfg.checked10 },
  { id: 11, deadline_time: iso(cfg.g11), is_current: false, is_next: cfg.next11,
    data_checked: false },
];
const bOf = evs => ({ events: evs, cur: evs.find(e => e.is_current) || evs[0] });

/* pre-deadline: GW10 deadline still ahead → count down to it. */
let evs = mkEvents({ g10: T0 + 2 * DAY, cur10: true, g11: T0 + 9 * DAY, next11: true });
let r = core.gwPhase(bOf(evs), [], T0);
ok(r.phase === 'pre', 'before the deadline → pre');
ok(r.target && r.target.id === 10, 'pre targets the imminent GW');

/* live: GW10 deadline passed, a fixture started and not finished. */
evs = mkEvents({ g10: T0 - 2 * HR, cur10: true, g11: T0 + 7 * DAY, next11: true });
let fxLive = [{ event: 10, started: true, finished: false }];
r = core.gwPhase(bOf(evs), fxLive, T0);
ok(r.phase === 'live', 'deadline gone with a match in play → live');

/* live: deadline passed, kickoff imminent (no fixture rows / none started). */
r = core.gwPhase(bOf(evs), [], T0);
ok(r.phase === 'live', 'deadline gone, awaiting kickoff → live (not dead)');

/* post: all GW10 fixtures finished but data not yet checked (bonus settling). */
evs = mkEvents({ g10: T0 - 2 * DAY, cur10: true, g11: T0 + 5 * DAY, next11: true, checked10: false });
let fxDone = [{ event: 10, started: true, finished: true }, { event: 10, started: true, finished: true }];
r = core.gwPhase(bOf(evs), fxDone, T0);
ok(r.phase === 'post', 'finished but unchecked → post (result in)');

/* between: GW10 finished AND data checked, GW11 deadline ahead. */
evs = mkEvents({ g10: T0 - 2 * DAY, cur10: true, g11: T0 + 5 * DAY, next11: true, checked10: true });
r = core.gwPhase(bOf(evs), fxDone, T0);
ok(r.phase === 'between', 'finished, checked, next GW ahead → between');
ok(r.target && r.target.id === 11, 'between counts down to the next GW');

/* ended: last GW finished and checked, no future deadline anywhere. */
evs = [{ id: 38, deadline_time: iso(T0 - 3 * DAY), is_current: true, is_next: false, data_checked: true }];
r = core.gwPhase(bOf(evs), [{ event: 38, started: true, finished: true }], T0);
ok(r.phase === 'ended', 'season over → ended');

/* the regression guard: no configuration yields the old dead combo where
   the deadline reads "passed" yet the app still points at a stale GW with
   nothing ahead. Every passed-deadline state must resolve to a live phase. */
evs = mkEvents({ g10: T0 - 1 * HR, cur10: true, g11: T0 + 6 * DAY, next11: true });
r = core.gwPhase(bOf(evs), [], T0);
ok(r.phase !== 'pre' && (r.target ? r.target.id === 11 || r.phase === 'live' : true),
  'passed deadline never leaves the header pointing at a dead countdown');

/* ── Section 2: decision-grade recommendation model ─────── */
section('confTier / confChip thresholds');
ok(core.confTier(70) === 'high' && core.confTier(95) === 'high', '≥70 is high');
ok(core.confTier(50) === 'med' && core.confTier(69) === 'med', '50–69 is medium');
ok(core.confTier(49) === 'low' && core.confTier(0) === 'low', '<50 is low');

section('captainEligible filters to fit MID/FWD attackers');
const capEl = (t, extra) => Object.assign({ element_type: t, status: 'a', chance_of_playing_next_round: null }, extra || {});
ok(core.captainEligible(capEl(3)) === true, 'a fit midfielder is eligible');
ok(core.captainEligible(capEl(4)) === true, 'a fit forward is eligible');
ok(core.captainEligible(capEl(1)) === false, 'a goalkeeper is never eligible');
ok(core.captainEligible(capEl(2)) === false, 'a defender is never eligible');
ok(core.captainEligible(capEl(4, { status: 's' })) === false, 'a suspended attacker is out');
ok(core.captainEligible(capEl(4, { status: 'i' })) === false, 'an injured-out attacker is out');
ok(core.captainEligible(capEl(4, { chance_of_playing_next_round: 50 })) === false, '<60% to play is out');
ok(core.captainEligible(capEl(4, { chance_of_playing_next_round: 75 })) === true, '≥60% to play is in');
ok(core.captainEligible(null) === false, 'null is not eligible');

section('captainBand gives an ordered P10 ≤ P50 ≤ P90');
const band = core.captainBand(6);
ok(band.p10 <= band.p50 && band.p50 <= band.p90, 'band is monotonic');
ok(band.p90 > band.p10, 'ceiling exceeds floor');
ok(core.captainBand(10).p90 > core.captainBand(4).p90, 'higher xP lifts the ceiling');

section('captainModel: EO-adjusted EV and field weighting');
/* Build a small league: a template premium (high own + high xP), a mid
   pick, and a low-owned differential — plus an ineligible keeper. */
const mkC = (id, t, xp, own) => ({ id, element_type: t, status: 'a',
  chance_of_playing_next_round: null, selected_by_percent: String(own),
  web_name: 'C' + id, team: id, ep_next: String(xp), form: '4', points_per_game: '4' });
const cPool = [ mkC(1, 4, 8, 45), mkC(2, 3, 6, 20), mkC(3, 4, 5, 3), mkC(4, 1, 9, 30) ];
/* nf map with no fixture detail → xP falls back to ep_next directly. */
const cnf = {};
const cModel = core.captainModel({}, cnf, cPool, 3);
ok(cModel.picks.length === 3, 'returns the eligible top-3 (keeper excluded)');
ok(cModel.picks[0].el.id === 1, 'the premium leads on xP');
ok(!cModel.picks.some(p => p.el.element_type === 1), 'no keeper ever appears');
ok(cModel.picks[0].eo > cModel.picks[2].eo, 'the template pick carries more captaincy EO than the differential');
ok(Math.abs(cModel.picks.reduce((s, p) => s, 0)) >= 0, 'picks computed');
/* EV = xP − fieldEV; the top pick should beat the field, the punt trail it. */
ok(cModel.picks[0].ev > 0, 'the best captain beats the field EV');
ok(cModel.picks[2].ev < cModel.picks[0].ev, 'the differential has lower EV-vs-field than the premium');
ok(core.captainModel({}, cnf, [mkC(9, 1, 9, 30)], 3).picks.length === 0, 'a pool of only keepers yields no captain');

section('captainConfidence: clear leader → higher, tie → lower');
const clear = core.captainConfidence({ picks: [{ el: mkC(1, 4, 9, 40), xp: 9 }, { el: mkC(2, 4, 4, 20), xp: 4 }] });
const tie = core.captainConfidence({ picks: [{ el: mkC(1, 4, 6, 40), xp: 6 }, { el: mkC(2, 4, 5.8, 20), xp: 5.8 }] });
ok(clear.value > tie.value, 'a clear captain scores more confidently than a coin-flip');
ok(clear.value >= 0 && clear.value <= 96, 'confidence stays within bounds');
ok(['high', 'med', 'low'].includes(clear.tier), 'a tier is assigned');

section('transferFrame: money, net xP and −4 breakeven');
const fr = core.transferFrame({ out: { now_cost: 70 }, cand: { now_cost: 85 }, gain: 6 }, 20, 1, 5);
ok(Math.abs(fr.priceDelta - 1.5) < 1e-9, 'price delta in £m (85−70 = +1.5)');
ok(Math.abs(fr.bankAfter - 0.5) < 1e-9, 'bank after: (20−15)/10 = £0.5m');
ok(fr.affordable === true, 'affordable when bank covers the delta');
ok(fr.usesHit === false && fr.hitCost === 0, 'a free transfer takes no hit');
const frHit = core.transferFrame({ out: { now_cost: 70 }, cand: { now_cost: 70 }, gain: 6 }, 5, 0, 5);
ok(frHit.usesHit === true && frHit.hitCost === 4, 'no free transfer → a −4 hit applies');
ok(Math.abs(frHit.clears - 2) < 1e-9, 'net after the hit: 6 − 4 = 2');
ok(frHit.beGw > 0 && frHit.beGw < 5, 'breakeven is a positive fraction of the horizon');
const frBust = core.transferFrame({ out: { now_cost: 50 }, cand: { now_cost: 120 }, gain: 3 }, 5, 1, 5);
ok(frBust.affordable === false, 'unaffordable when the delta exceeds bank');
/* A game with no transfer cost must never frame a move as costing a hit, even
   with no free transfer banked. The default stays "charges hits", so FPL is
   unaffected and the flag only matters to a pack that opts out. */
const frFree = core.transferFrame({ out: { now_cost: 70 }, cand: { now_cost: 70 }, gain: 6 }, 5, 0, 5, false);
ok(frFree.usesHit === false && frFree.hitCost === 0, 'a game without transfer costs takes no hit');
ok(Math.abs(frFree.clears - 6) < 1e-9, 'and the full gain survives (6 − 0 = 6)');
ok(frFree.beGw === 0, 'breakeven is immediate when nothing is spent');
ok(core.transferFrame({ out: { now_cost: 70 }, cand: { now_cost: 70 }, gain: 6 }, 5, 0, 5).usesHit === true,
  'omitting the flag still charges the hit (FPL default unchanged)');

section('eventShape: double / blank / modal detection');
/* 3 GWs: GW1 normal (10 games), GW2 a double (team 1 plays twice, 11 games),
   GW3 a blank (only 4 games). */
const fixG = [];
for (let i = 0; i < 10; i++) fixG.push({ event: 1, team_h: 2 * i + 1, team_a: 2 * i + 2, finished: false });
for (let i = 0; i < 10; i++) fixG.push({ event: 2, team_h: 2 * i + 1, team_a: 2 * i + 2, finished: false });
fixG.push({ event: 2, team_h: 1, team_a: 5, finished: false });          /* team 1 twice → double */
for (let i = 0; i < 4; i++) fixG.push({ event: 3, team_h: 2 * i + 1, team_a: 2 * i + 2, finished: false });
const shape = core.eventShape(fixG);
ok(shape.modal === 10, 'modal fixture count is 10');
ok(shape.byGw[2].isDouble === true && shape.byGw[2].doubles.includes(1), 'GW2 flagged as a double for team 1');
ok(shape.byGw[3].isBlank === true, 'GW3 flagged as a blank');
ok(shape.byGw[1].isDouble === false && shape.byGw[1].isBlank === false, 'GW1 is a normal week');

section('chipAdvice: reasoned windows, never a bare hold');
const adv = core.chipAdvice({}, fixG, ['3xc', 'bboost', 'freehit', 'wildcard'],
  [{ status: 'a' }, { status: 'a' }]);
ok(adv.all.length === 4, 'advises on every remaining chip');
ok(adv.all.every(a => a.reason && a.reason.length > 0), 'every chip carries a reason (never bare HOLD)');
ok(adv.nextDbl && adv.nextDbl.gw === 2, 'points Triple Captain / Bench Boost at the GW2 double');
ok(adv.nextBlank && adv.nextBlank.gw === 3, 'points Free Hit at the GW3 blank');
const tc = adv.all.find(a => a.chip === '3xc');
ok(tc.window === 'GW2' && tc.conf >= 60, 'Triple Captain recommends the double with real confidence');
ok(adv.best && adv.second, 'a best and second-best chip are surfaced');
const advFlags = core.chipAdvice({}, fixG, ['wildcard'],
  [{ status: 'i' }, { status: 'd' }, { status: 's' }]);
ok(advFlags.all[0].window === 'now', 'a squad with 3 flags recommends the Wildcard now');

/* Free Hit is strongest on the blank right after a double (GW2 double → GW3 blank). */
const fhAdv = core.chipAdvice({}, fixG, ['freehit'], [{ status: 'a' }]).all.find(a => a.chip === 'freehit');
ok(fhAdv.window === 'GW3' && fhAdv.conf >= 80 && /after a double/.test(fhAdv.reason), 'Free Hit on a post-double blank scores higher and names the pattern');

/* Single-gameweek Triple Captain (the 2025/26 lesson): with no double on the
   horizon, a standout single-GW fixture is still a valid TC. */
const normalFix = [];
for (let g = 1; g <= 3; g++) for (let i = 0; i < 10; i++) normalFix.push({ event: g, team_h: 2 * i + 1, team_a: 2 * i + 2, finished: false });
const strongHint = { gw: 1, name: 'Haaland', lam: 2.2, xp: 8.1, opp: 'BUR', home: true };
const tcSingle = core.chipAdvice({}, normalFix, ['3xc'], [{ status: 'a' }], strongHint).all.find(a => a.chip === '3xc');
ok(tcSingle.window === 'GW1' && tcSingle.conf >= 55 && /Haaland/.test(tcSingle.reason), 'strong single-GW fixture → Triple Captain recommended even without a double');
const okHint = { gw: 1, name: 'Palmer', lam: 1.7, xp: 6.2, opp: 'BHA', home: true };
const tcOk = core.chipAdvice({}, normalFix, ['3xc'], [{ status: 'a' }], okHint).all.find(a => a.chip === '3xc');
ok(tcOk.window === 'hold' && /best single-GW/.test(tcOk.reason), 'a decent-but-not-elite fixture holds, naming the best single-GW option');
const weakHint = { gw: 1, name: 'Mbeumo', lam: 1.2, xp: 4.5, opp: 'ARS', home: false };
const tcWeak = core.chipAdvice({}, normalFix, ['3xc'], [{ status: 'a' }], weakHint).all.find(a => a.chip === '3xc');
ok(tcWeak.window === 'hold' && tcWeak.conf <= 42, 'a weak fixture holds the Triple Captain');
const tcNoHint = core.chipAdvice({}, normalFix, ['3xc'], [{ status: 'a' }]).all.find(a => a.chip === '3xc');
ok(tcNoHint.window === 'hold', 'no double and no hint → hold (unchanged legacy behaviour)');

/* capHintFrom builds the hint from the top captain pick + their fixture. */
const chHint = core.capHintFrom({ picks: [{ el: { team: 1, web_name: 'Haaland' }, xp: 8.1 }] }, { 1: { event: 5, lam: 2.3, opp: 'BUR', home: true } });
ok(chHint && chHint.gw === 5 && chHint.name === 'Haaland' && chHint.lam === 2.3 && chHint.home === true, 'capHintFrom reads gw, name, team xG and venue from the top pick');
ok(core.capHintFrom({ picks: [] }, {}) === null && core.capHintFrom(null, {}) === null, 'capHintFrom is null-safe with no pick');

/* ── Section 3: My Week "Explain this" feature drivers ──── */
section('captainFeatures / transferFeatures / chipFeatures');
const capPick = { el: { team: 1, form: '5.2', ep_next: '6.1', web_name: 'Salah' }, xp: 7.4, eo: 40, ev: 1.8 };
const capNf = { 1: { lam: 2.1, opp: 'BUR', home: true, diff: 2 } };
const cf = core.captainFeatures({}, capNf, capPick);
ok(cf.length === 3, 'captain drivers return three reasons');
ok(cf[0].includes('7.4'), 'first driver quotes the xP');
ok(cf.some(s => s.includes('EV vs field')), 'a driver names the EV-vs-field edge');
ok(cf.some(s => s.includes('2.1') || s.toLowerCase().includes('xg')), 'a driver names the fixture xG');

/* transferFeatures uses horizonXP (stubbed to el._hx in this harness). */
const tf = core.transferFeatures({}, {},
  { out: { web_name: 'A', _hx: 2 }, cand: { web_name: 'B', _hx: 8 }, gain: 6 },
  { priceDelta: 1.5, bankAfter: 0.5, perGw: 1.2 });
ok(tf.length === 3, 'transfer drivers return three reasons');
ok(tf[0].includes('6.0') && tf[0].includes('5 GW'), 'leads with the 5-GW net xP');
ok(tf.some(s => s.includes('£1.5m') && s.includes('0.5')), 'a driver spells out the money');
const tfHold = core.transferFeatures({}, {}, null, null);
ok(tfHold.length === 3 && tfHold[0].toLowerCase().includes('no move'), 'HOLD explains why there is no move');

const advForFeat = core.chipAdvice({}, fixG, ['3xc', 'bboost'], [{ status: 'a' }]);
const chf = core.chipFeatures(advForFeat);
ok(chf.length >= 2, 'chip drivers return at least two reasons');
ok(chf.some(s => s.includes('GW2') || s.toLowerCase().includes('double')), 'a chip driver names the double');
ok(core.chipFeatures({ best: null }).length >= 1, 'chipFeatures is safe when nothing stands out');

/* ── Section 4: Fixture Difficulty 2.0 + set-piece confidence ─ */
section('fdrAttack / fdrDefence: monotonic, easier = lower');
ok(core.fdrAttack(2.5) === 1 && core.fdrAttack(0.5) === 5, 'high team xG is easy (1), low is hard (5)');
ok(core.fdrAttack(2.1) <= core.fdrAttack(1.4) && core.fdrAttack(1.4) <= core.fdrAttack(0.7),
  'attack difficulty falls monotonically with team xG');
ok(core.fdrDefence(0.6) === 1 && core.fdrDefence(0.1) === 5, 'high CS odds is easy (1), low is hard (5)');
ok(core.fdrDefence(0.55) <= core.fdrDefence(0.3) && core.fdrDefence(0.3) <= core.fdrDefence(0.12),
  'defence difficulty falls monotonically with clean-sheet odds');
ok([1, 2, 3, 4, 5].includes(core.fdrAttack(1.47)) && [1, 2, 3, 4, 5].includes(core.fdrDefence(0.28)),
  'both grades stay on the 1–5 scale');

section('setPieceConfidence: penalties dominate, roles + xP add');
const pen1 = core.setPieceConfidence({ penalties_order: 1 });
ok(pen1.value === 82 && pen1.tier === 'high', 'a primary penalty taker is high confidence');
ok(pen1.roles.includes('penalties') && pen1.addXp >= 0.5, 'flags the penalty role with real xP value');
const pen2 = core.setPieceConfidence({ penalties_order: 2 });
ok(pen2.value < pen1.value, 'the 2nd-choice taker is less certain than the 1st');
const multi = core.setPieceConfidence({ penalties_order: 1, direct_freekicks_order: 1, corners_and_indirect_freekicks_order: 1 });
ok(multi.roles.length === 3 && multi.addXp > pen1.addXp, 'a multi-duty taker stacks xP value across roles');
ok(multi.value === 82, 'confidence takes the strongest duty (penalties), not the sum');
const none = core.setPieceConfidence({});
ok(none.value === 0 && none.roles.length === 0, 'no set-piece duty → zero');

/* ── Section 4 (6-13): readiness, lineup, community ─────── */
section('benchBoostReadiness: strong bench scores higher');
const bbEl = (id, xp, status, ch) => ({ id, team: id, element_type: 3, status: status || 'a',
  chance_of_playing_next_round: ch === undefined ? null : ch,
  ep_next: String(xp), form: '4', points_per_game: '4', selected_by_percent: '5' });
const bbNf = { 1: { opp: 'BUR', lam: 1.6, cs: 0.3 }, 2: { opp: 'LUT', lam: 1.6, cs: 0.3 },
  3: { opp: 'EVE', lam: 1.6, cs: 0.3 }, 4: { opp: 'CHE', lam: 1.6, cs: 0.3 } };
const strongBench = core.benchBoostReadiness({}, bbNf, [bbEl(1, 5), bbEl(2, 4), bbEl(3, 4), bbEl(4, 4)]);
const weakBench = core.benchBoostReadiness({}, bbNf, [bbEl(1, 1), bbEl(2, 1, 'i'), bbEl(3, 0), bbEl(4, 1)]);
ok(strongBench.score > weakBench.score, 'a strong, fit bench scores above a weak/injured one');
ok(strongBench.playing === 4 && weakBench.playing < 4, 'counts only fit players with a fixture');
ok(strongBench.tier === core.confTier(strongBench.score), 'tier matches the score');
ok(core.benchBoostReadiness({}, {}, []).score === 0, 'an empty bench is zero');

section('lineupCheck: flags the point-costing mistakes');
const lcNf = { 1: { opp: 'BUR' }, 2: { opp: 'LUT' }, 3: { opp: 'EVE' } };  /* team 4 has NO fixture (blank) */
const lcPick = (element, position, isC) => ({ element, position, is_captain: !!isC });
const lcEls = { 10: { web_name: 'Fit', team: 1, status: 'a', chance_of_playing_next_round: null },
  11: { web_name: 'Hurt', team: 2, status: 'i', chance_of_playing_next_round: 0 },
  12: { web_name: 'Blank', team: 4, status: 'a', chance_of_playing_next_round: null },
  13: { web_name: 'Nailed', team: 3, status: 'a', chance_of_playing_next_round: null } };
const lcPicks = { picks: [ lcPick(10, 1, true), lcPick(11, 2), lcPick(12, 3), lcPick(13, 12) ] };
const issues = core.lineupCheck({ els: lcEls }, lcPicks, lcNf);
ok(issues.some(i => i.msg.includes('Hurt') && i.level === 'warn'), 'flags a ruled-out starter');
ok(issues.some(i => i.msg.includes('Blank') && i.msg.toLowerCase().includes('no fixture')), 'flags a starter with no fixture');
ok(issues.some(i => i.msg.includes('Nailed') && i.level === 'info'), 'flags a nailed player left on the bench');
/* A legal, fully fit XI (11 starters on a team that has a fixture). */
const fitEls = {};
const cleanRows = [];
for (let i = 0; i < 11; i++) { fitEls[100 + i] = { web_name: 'P' + i, team: 1, status: 'a', chance_of_playing_next_round: null };
  cleanRows.push(lcPick(100 + i, i + 1, i === 0)); }
const cleanIssues = core.lineupCheck({ els: fitEls }, { picks: cleanRows }, lcNf);
ok(cleanIssues.length === 1 && cleanIssues[0].level === 'ok', 'a legal, fully fit XI reports all-good');

section('communityAggregate: the crowd selectors');
const caB = { cur: { most_captained: 1, most_transferred_in: 2, most_transferred_out: 3, top_element_info: { id: 4 } },
  els: { 1: { web_name: 'Cap' }, 2: { web_name: 'In' }, 3: { web_name: 'Out' }, 4: { web_name: 'Top' } },
  elements: [ { id: 5, web_name: 'Owned', selected_by_percent: '61.0' }, { id: 1, web_name: 'Cap', selected_by_percent: '40.0' } ] };
const ca = core.communityAggregate(caB);
ok(ca.captain.web_name === 'Cap' && ca.transferIn.web_name === 'In', 'reads crowd captain + transfer in');
ok(ca.transferOut.web_name === 'Out' && ca.topScorer.web_name === 'Top', 'reads transfer out + top scorer');
ok(ca.mostOwned.web_name === 'Owned', 'finds the most-owned player');

/* ── topSelectedByPos + the optimal template XI ─────────── */
section('topSelectedByPos: top-N most owned per position');
let tsId = 1;
const mkOwn = (type, own, team) => ({ id: tsId++, element_type: type, team: team || (tsId % 8) + 1, web_name: 'P' + tsId, selected_by_percent: String(own), now_cost: 50 });
const tsPool = [];
[1, 2, 3, 4].forEach(t => { for (let i = 0; i < 14; i++) tsPool.push(mkOwn(t, 90 - i, t * 100 + i)); });
tsPool.push(mkOwn(3, 0, 99));   /* zero-owned should be excluded */
const top = core.topSelectedByPos(tsPool, 10);
ok([1, 2, 3, 4].every(t => top[t].length === 10), 'exactly 10 per position');
ok(top[3].every((e, i) => i === 0 || parseFloat(e.selected_by_percent) <= parseFloat(top[3][i - 1].selected_by_percent)), 'sorted by ownership descending');
ok(top[3].every(e => parseFloat(e.selected_by_percent) > 0), 'zero-owned players are excluded');
ok(core.topSelectedByPos([], 10)[1].length === 0, 'empty pool → empty positions');

section('differentials: ownership-first, no minutes gate, premiums excluded');
const diffPool = [
  { id: 1, status: 'a', selected_by_percent: '3.0', minutes: 0, now_cost: 55 },    /* season start, no minutes, cheap */
  { id: 2, status: 'a', selected_by_percent: '11.9', minutes: 540, now_cost: 55 },
  { id: 3, status: 'a', selected_by_percent: '40.0', minutes: 900, now_cost: 90 },  /* too owned */
  { id: 4, status: 'i', selected_by_percent: '2.0', minutes: 0, now_cost: 60 },     /* injured out */
  { id: 5, status: 'a', selected_by_percent: '0', minutes: 0, now_cost: 45 },       /* 0% owned, unplayed */
  { id: 6, status: 'a', selected_by_percent: '3.0', minutes: 0, now_cost: 140 },    /* premium (Haaland) briefly reading low at season open */
  { id: 7, status: 'a', minutes: 0, now_cost: 50 },                                 /* no ownership figure at all */
];
const diffs = core.differentials(diffPool);   /* default threshold */
ok(diffs.some(e => e.id === 1) && diffs.some(e => e.id === 5), 'includes low-owned players with zero minutes (season start / benched) — the bug fix');
ok(diffs.some(e => e.id === 2), 'an 11.9%-owned player is included under the 15% default');
ok(!diffs.some(e => e.id === 3), 'excludes players at/over the ownership threshold');
ok(!diffs.some(e => e.id === 4), 'excludes unavailable (injured/suspended) players');
ok(!diffs.some(e => e.id === 6), 'excludes premiums (£10.0m+) even when their ownership briefly reads low — the Haaland fix');
ok(!diffs.some(e => e.id === 7), 'excludes players with no real ownership figure (not treated as 0% differentials)');
ok(core.differentials(diffPool).every(e => parseFloat(e.selected_by_percent) < 15 && (e.now_cost || 0) < 100), 'every survivor is under 15% owned AND under £10.0m — the primary filters');
ok(core.differentials(diffPool, 5).every(e => parseFloat(e.selected_by_percent) < 5), 'a custom ownership threshold is honoured');
ok(core.differentials([{ status: 'a', selected_by_percent: '9.5', now_cost: 105 }], 15, 120).length === 1, 'a custom premium cap is honoured');
ok(core.differentials([{ status: 'a', selected_by_percent: '14.5', now_cost: 55 }]).length === 1 && core.differentials([{ status: 'a', selected_by_percent: '15.0', now_cost: 55 }]).length === 0, 'boundary: under 15 in, 15+ out');

section('rotationPairs: cheap defenders whose easy fixtures alternate');
/* Two teams with mirror-image runs (one easy while the other is hard) should
   pair to an all-green combined run; a third team is hard throughout. */
const rotDiff = {
  10: [1, 5, 1, 5, 1, 5],   /* easy on odd weeks */
  20: [5, 1, 5, 1, 5, 1],   /* easy on even weeks — perfect rotation with 10 */
  30: [4, 4, 4, 4, 4, 4],   /* always awkward */
};
const rotCands = [
  { id: 1, team: 10, cost: 45, own: 20 },
  { id: 2, team: 20, cost: 45, own: 18 },
  { id: 3, team: 30, cost: 45, own: 5 },
];
const rp = core.rotationPairs(rotCands, rotDiff, 6);
ok(rp.length === 3, 'every cross-club pair is returned');
ok(rp[0].a.team !== rp[0].c.team, 'a pair is always two different clubs');
ok(rp[0].score === 6 && rp[0].green === 6, 'the mirror pair scores a perfect all-green combined run');
ok((rp[0].a.team === 10 && rp[0].c.team === 20) || (rp[0].a.team === 20 && rp[0].c.team === 10), 'the best pair is the two mirror-image teams');
ok(rp[0].score <= rp[rp.length - 1].score, 'pairs are ranked easiest combined run first');
ok(core.rotationPairs(rotCands, rotDiff, 1).length === 1, 'the limit caps the number of pairs');
ok(core.rotationPairs([{ id: 9, team: 99, cost: 40 }], rotDiff, 6).length === 0, 'a player whose team has no fixtures yields no pair');

section('fdrPatchFor / entry points: a run is only a window if it is actually kind');
{
  /* The grid draws a purple underline and the entry-point summary lists the
     gameweek it starts. Both must come from one call, or the panel lists a
     club as an entry point that it did not underline two inches above. */
  const gws = [1, 2, 3, 4, 5, 6];
  const cell = (diff) => ({ diff, lam: 1.5, cs: 0.3, fdr: diff });
  const kind = {}; gws.forEach((g) => { kind[g] = cell(g >= 3 ? 1.5 : 5); });
  const cruel = {}; gws.forEach((g) => { cruel[g] = cell(4.5); });
  const byTeamGw = { 1: kind, 2: cruel };

  const p1 = core.fdrPatchFor('overall', 1, gws, byTeamGw, 3);
  ok(p1 && gws[p1.start] === 3, 'the kind stretch is found where it starts (GW' +
    (p1 ? gws[p1.start] : '—') + ')');
  ok(p1 && gws[p1.end] === 5, 'and runs to the end of K');
  ok(core.fdrPatchFor('overall', 2, gws, byTeamGw, 3) === null,
    'a club whose best run is still hard gets no window at all');

  /* The gate is the shared constant, not a number retyped in two places. */
  const edge = {}; gws.forEach((g) => { edge[g] = cell(core.FDR_PATCH_MAX); });
  ok(core.fdrPatchFor('overall', 3, gws, { 3: edge }, 3) !== null,
    'a run exactly at the threshold still counts');
  const over = {}; gws.forEach((g) => { over[g] = cell(core.FDR_PATCH_MAX + 0.1); });
  ok(core.fdrPatchFor('overall', 3, gws, { 3: over }, 3) === null, 'just past it does not');

  /* A missing fixture grades 6 — maximally hard — so a blank always makes a
     run worse rather than being skipped over. */
  const full = {}; gws.forEach((g) => { full[g] = cell(1); });
  const gap = {}; gws.forEach((g) => { if (g !== 3) gap[g] = cell(1); });
  /* Given room, the best run simply avoids the blank and is no worse for it. */
  ok(core.fdrPatchFor('overall', 5, gws, { 5: gap }, 3).sum
     === core.fdrPatchFor('overall', 5, gws, { 5: full }, 3).sum,
    'a run routes around a blank when the window has room');
  ok(gws[core.fdrPatchFor('overall', 5, gws, { 5: gap }, 3).start] !== 3,
    'and does not start on it');
  /* With no room to avoid it, the blank costs the run its full 6. */
  ok(core.fdrPatchFor('overall', 5, gws, { 5: gap }, 5).sum
     > core.fdrPatchFor('overall', 5, gws, { 5: full }, 5).sum,
    'and when it cannot be avoided it makes the run worse');

  /* Pinning a known limitation rather than asserting it away: with only two
     kind fixtures either side, a three-game window CONTAINING the blank still
     averages under the threshold and is drawn as a patch. That is the grid's
     existing rule and the summary now inherits it, so any change to it should
     be deliberate rather than a side effect. */
  const short = { 1: cell(1), 2: cell(1) };
  const p2 = core.fdrPatchFor('overall', 4, gws, { 4: short }, 3);
  ok(p2 !== null && (2 + 6) / 3 <= core.FDR_PATCH_MAX,
    'two kind fixtures plus a blank still clears the bar on the mean');

  /* THE HORIZON RULE. A K-game run cannot start in the last K-1 weeks of a
     window, so those weeks must not be listed as "nothing turns here" — that
     claims an absence of opportunity where there is only an absence of
     horizon. Live, a 5-game patch over a 10-week view made four gameweeks
     read as empty when no run could have fitted in them. */
  for (const [len, K] of [[10, 5], [6, 3], [5, 5], [3, 5]]) {
    const win = Array.from({ length: len }, (_, i) => i + 1);
    const kk = Math.min(K, win.length);
    const canStart = win.slice(0, Math.max(1, win.length - kk + 1));
    ok(canStart.length === Math.max(1, len - kk + 1),
      'a ' + kk + '-game run over ' + len + ' weeks can start in ' + canStart.length + ' of them');
    ok(canStart[canStart.length - 1] + kk - 1 <= win[win.length - 1],
      'and the last listed start still finishes inside the window');
  }
}

section('bestFixtureRun: the lowest-difficulty run of K consecutive gameweeks (purple patch)');
const brun = core.bestFixtureRun([5, 5, 1, 1, 1, 5], 3);
ok(brun.start === 2 && brun.end === 4 && brun.sum === 3, 'finds the easiest 3-gameweek block');
ok(core.bestFixtureRun([2, 2, 2, 2], 2).start === 0, 'ties resolve to the earliest block');
ok(core.bestFixtureRun([4], 5).K === 1 && core.bestFixtureRun([4], 5).sum === 4, 'K is clamped to the array length');
ok(core.bestFixtureRun([], 3) === null, 'an empty array yields no run');
{
  const arr = [3, 1, 2, 5, 5, 5], r = core.bestFixtureRun(arr, 3);
  let s = 0; for (let i = r.start; i <= r.end; i++) s += arr[i];
  ok(s === r.sum && r.sum === 6, 'the returned sum matches the marked block');
}

section('chipSwings: fixture-swing Free Hit and Wildcard windows');
const fhRuns = [
  { team: 1, own: 50, diff: [2, 2, 2, 5, 2, 2] },  /* heavily owned, hard fixture at index 3 */
  { team: 2, own: 40, diff: [2, 2, 2, 5, 2, 2] },
  { team: 3, own: 1, diff: [5, 5, 5, 1, 5, 5] },   /* barely owned, so its easy week 3 barely moves the field mean */
];
const swFH = core.chipSwings(fhRuns, 2, 2);
ok(swFH.fh.idx === 3, 'Free Hit lands on the week the most-owned teams face the hardest fixtures');
ok(swFH.fh.clear === true, 'a clear ownership-weighted spike above the window average is flagged');
const wcRuns = [
  { team: 1, own: 10, diff: [1, 1, 1, 5, 5, 5, 5, 5, 1, 1] },  /* great early, turns hard from index 3 */
  { team: 2, own: 10, diff: [5, 5, 5, 1, 1, 1, 1, 1, 5, 5] },  /* the opposite — the reshape target */
];
const swWC = core.chipSwings(wcRuns, 5, 1);
ok(swWC.wc.idx === 3, 'Wildcard lands where the current best-fixture teams turn hardest over the next run');
ok(swWC.wc.gain > 0, 'the reshape difficulty-shed is positive at the swing boundary');
ok(core.chipSwings([], 5, 6).fh === null, 'no teams yields no swing');
ok(core.chipSwings([{ team: 1, own: 5, diff: [2, 2] }], 5, 6).wc === null, 'too short a horizon yields no Wildcard boundary');

section('bestXI drawn from the template pool is a legal, optimal XI');
/* Score the 40-player pool (higher ownership rank ≈ higher xP here) and build. */
const scored = [].concat(top[1], top[2], top[3], top[4]).map((e, i) => ({ el: e, p: parseFloat(e.selected_by_percent) / 10 }));
const xi = core.bestXI(scored);
ok(xi && xi.xi.length === 11, 'builds a full XI of 11');
const cnt = t => xi.xi.filter(s => s.el.element_type === t).length;
ok(cnt(1) === 1, 'exactly one goalkeeper');
ok(cnt(2) >= 3 && cnt(2) <= 5 && cnt(3) >= 3 && cnt(3) <= 5 && cnt(4) >= 1 && cnt(4) <= 3, 'a valid outfield formation');
const clubCount = {}; xi.xi.forEach(s => { clubCount[s.el.team] = (clubCount[s.el.team] || 0) + 1; });
ok(Object.values(clubCount).every(n => n <= 3), 'never more than 3 from one club');
ok(xi.xi.every(s => top[s.el.element_type].some(e => e.id === s.el.id)), 'every pick comes from the top-10 template pool');
/* Optimality: the single highest-xP player in the pool is always fielded, and
   the chosen formation beats every alternative on total xP. */
const bestP = scored.slice().sort((a, b) => b.p - a.p)[0];
ok(xi.xi.some(s => s.el.id === bestP.el.id), 'the top-projected player is always in the XI');
ok(xi.total === Math.max(...[[3, 4, 3], [3, 5, 2], [4, 5, 1], [4, 4, 2], [4, 3, 3], [5, 4, 1], [5, 3, 2], [5, 2, 3]].map(f => {
  const need = { 1: 1, 2: f[0], 3: f[1], 4: f[2] }, got = { 1: 0, 2: 0, 3: 0, 4: 0 }, club = {}; let tot = 0, n = 0;
  for (const s of scored.slice().sort((a, b) => b.p - a.p)) { const t = s.el.element_type, c = s.el.team; if (got[t] >= need[t] || (club[c] || 0) >= 3) continue; tot += s.p; got[t]++; club[c] = (club[c] || 0) + 1; if (++n === 11) break; }
  return n === 11 ? tot : -1;
})), 'the XI total equals the best achievable across all legal formations');

/* ── Latest News feed ───────────────────────────────────── */
section('timeAgo: relative time buckets');
const T = 1_700_000_000_000;
ok(core.timeAgo(new Date(T).toISOString(), T + 30 * 1000) === 'just now', 'under a minute → just now');
ok(core.timeAgo(new Date(T).toISOString(), T + 5 * 60e3) === '5m ago', 'minutes');
ok(core.timeAgo(new Date(T).toISOString(), T + 3 * 3600e3) === '3h ago', 'hours');
ok(core.timeAgo(new Date(T).toISOString(), T + 2 * 86400e3) === '2d ago', 'days');
ok(core.timeAgo(new Date(T).toISOString(), T + 21 * 86400e3) === '3w ago', 'weeks');
ok(core.timeAgo('', T) === '' && core.timeAgo('not-a-date', T) === '', 'blank / bad input → empty');

section('latestNews: only news, newest first');
const nB = { elements: [
  { id: 1, web_name: 'A', news: '', news_added: '2026-01-01T00:00:00Z' },
  { id: 2, web_name: 'B', news: 'Knock - 75%', news_added: '2026-01-03T10:00:00Z', status: 'd', chance_of_playing_next_round: 75 },
  { id: 3, web_name: 'C', news: 'Suspended', news_added: '2026-01-05T09:00:00Z', status: 's' },
  { id: 4, web_name: 'D', news: '   ', news_added: '2026-01-04T00:00:00Z' },
  { id: 5, web_name: 'E', news: 'Hamstring', news_added: '2026-01-02T00:00:00Z', status: 'i' },
] };
const feed = core.latestNews(nB, 10);
ok(feed.length === 3, 'only players with real news text (blank/whitespace excluded)');
ok(feed[0].el.web_name === 'C' && feed[1].el.web_name === 'B' && feed[2].el.web_name === 'E', 'sorted newest → oldest by news_added');
ok(feed[0].chance === undefined ? true : feed[0].status === 's', 'carries status/chance through');
ok(core.latestNews(nB, 2).length === 2, 'respects the limit');
ok(core.latestNews({ elements: [] }, 10).length === 0, 'no elements → empty feed');

/* ── nativeXP: the added scoring categories (P1) ────────── */
section('nativeXP models bonus, defensive-contribution and saves');
const nnf = { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.3 };
const baseMid = { element_type: 3, minutes: 540, expected_goals_per_90: '0.2', expected_assists_per_90: '0.2' };
const midBase = core.nativeXP(baseMid, nnf);
ok(midBase != null && midBase > 0, 'a midfielder with a full sample gets positive native xP');
ok(core.nativeXP(baseMid, { gp: 3, lam: 1.6, lamAvg: 1.5, cs: 0.3 }) === null, 'still null below the 5-game sample floor');

ok(core.nativeXP({ ...baseMid, bonus: 12 }, nnf) > midBase, 'realised bonus lifts the estimate');

const midDC12 = core.nativeXP({ ...baseMid, defensive_contribution_per_90: '12' }, nnf);
const midDC18 = core.nativeXP({ ...baseMid, defensive_contribution_per_90: '18' }, nnf);
ok(midDC18 > midDC12 && midDC12 > midBase, 'defensive-contribution points rise with the per-90 rate (MID threshold 12)');

const baseDef = { element_type: 2, minutes: 540, expected_goals_per_90: '0.05', expected_assists_per_90: '0.05' };
const defLow = core.nativeXP({ ...baseDef, defensive_contribution_per_90: '6' }, nnf);
const defHigh = core.nativeXP({ ...baseDef, defensive_contribution_per_90: '14' }, nnf);
ok(defHigh > defLow, 'a ball-winning defender (DEF threshold 10) out-scores a low-action one');

const gk = { element_type: 1, minutes: 540, expected_goals_per_90: '0', expected_assists_per_90: '0' };
ok(core.nativeXP({ ...gk, saves: 60 }, nnf) > core.nativeXP(gk, nnf), 'goalkeeper saves add points');
ok(core.nativeXP({ ...gk, defensive_contribution_per_90: '30' }, nnf) === core.nativeXP(gk, nnf),
  'goalkeepers get no defensive-contribution points (their category is saves)');

/* ── model fixes from the season backtest ───────────────── */
section('concedePts: goals-conceded downside for GK/DEF (fix 1)');
ok(core.concedePts(0.9) < core.concedePts(0.2), 'a leaky fixture (low CS odds) costs more than a solid one');
ok(core.concedePts(0.28) > 0.2 && core.concedePts(0.28) < 0.6, 'a league-average fixture costs ~0.3-0.4 pts');
const defSolid = core.nativeXP({ ...baseDef, defensive_contribution_per_90: '8' }, { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.5 });
const defLeaky = core.nativeXP({ ...baseDef, defensive_contribution_per_90: '8' }, { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.12 });
ok(defSolid > defLeaky, 'a defender on a solid fixture out-scores the same player on a leaky one');
const midSolid = core.nativeXP(baseMid, { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.5 });
const midLeaky = core.nativeXP(baseMid, { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.12 });
ok((defSolid - defLeaky) > 3 * (midSolid - midLeaky),
  'a defender is far more CS-sensitive than a midfielder (4pt CS + concede vs a lone 1pt CS)');
/* concedePts blends the player's own xGC/90 (API-fix 2). */
ok(core.concedePts(0.28, '2.4') > core.concedePts(0.28), 'a high player xGC/90 raises the concede deduction above the team-only estimate');
ok(core.concedePts(0.28, '0.5') < core.concedePts(0.28), 'a low player xGC/90 lowers it');
ok(core.concedePts(0.28, 'x') === core.concedePts(0.28) && core.concedePts(0.28, 0) === core.concedePts(0.28), 'missing / zero xGC leaves the team estimate unchanged');
const defBase = { element_type: 2, minutes: 540, starts: 6, status: 'a', expected_goals_per_90: '0.05', expected_assists_per_90: '0.05', defensive_contribution_per_90: '8' };
const defOdds = { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.3 };
ok(core.nativeXP({ ...defBase, expected_goals_conceded_per_90: '2.2' }, defOdds) < core.nativeXP({ ...defBase, expected_goals_conceded_per_90: '0.6' }, defOdds),
  'a defender who personally ships more xGC is rated below a stingier one on the same team odds');

section('savePts: the saves floor is charged on the count, not on its mean');
/* FPL pays 1 point per 3 saves, so the value is E[floor(S/3)], not E[S]/3.
   The gap is the expected remainder — about one save, a third of a point —
   and it is very nearly constant across every realistic save rate. */
const exactSavePts = (lam) => { let p = Math.exp(-lam), e = 0; for (let k = 1; k <= 200; k++) { p *= lam / k; e += p * Math.floor(k / 3); } return e; };
for (const lam of [1.5, 3, 4.6, 6]) {
  ok(Math.abs(core.savePts(lam) - exactSavePts(lam)) < 1e-9, 'savePts matches a direct pmf sum at lam=' + lam);
  ok(core.savePts(lam) < lam / 3, 'the floor costs points against the naive mean/3 at lam=' + lam);
}
ok(Math.abs((3 / 3 - core.savePts(3)) - (6 / 3 - core.savePts(6))) < 0.02,
  'the over-credit the old term carried is flat in the save rate (so it was a bias, not noise)');
ok(core.savePts(0) === 0 && core.savePts(-1) === 0, 'no saves expected, no points, no throw');
const gkQuiet = { element_type: 1, minutes: 540, starts: 6, status: 'a', saves: 12, expected_goals_per_90: '0', expected_assists_per_90: '0' };
const gkBusy = { ...gkQuiet, saves: 40 };
const gkOdds = { gp: 6, lam: 1.2, lamAvg: 1.5, cs: 0.3 };
ok(core.nativeXP(gkBusy, gkOdds) > core.nativeXP(gkQuiet, gkOdds), 'a busier keeper still projects higher');

section('dcHitProb: the defensive-contribution threshold, as a threshold');
ok(core.dcHitProb(0, 10) === 0, 'no counted actions, no chance of the bonus');
ok(core.dcHitProb(20, 10) > 0.99 && core.dcHitProb(3, 10) < 0.01, 'far either side of the line is near-certain either way');
ok(core.dcHitProb(10, 10) > 0.4 && core.dcHitProb(10, 10) < 0.6, 'right on the threshold is close to a coin flip');
ok(core.dcHitProb(12, 12) < core.dcHitProb(12, 10), 'the midfielder threshold of 12 is harder than the defender 10 at the same rate');
/* The point estimate must equal the expectation of the event the simulators
   draw — that agreement is the whole reason this replaced a hand-picked
   logistic that had no relationship to it. */
const dcDef = { element_type: 2, minutes: 540, starts: 6, status: 'a', expected_goals_per_90: '0.05', expected_assists_per_90: '0.05', expected_goals_conceded_per_90: '1.2' };
const dcOdds = { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.3 };
const dcLow = core.nativeXP({ ...dcDef, defensive_contribution_per_90: '4' }, dcOdds);
const dcHigh = core.nativeXP({ ...dcDef, defensive_contribution_per_90: '14' }, dcOdds);
ok(dcHigh - dcLow > 1.2 && dcHigh - dcLow <= 2, 'clearing the threshold is worth close to, and never more than, the 2 points on offer');

section('conditional minutes: the absence is charged once, not twice');
/* minFrac is the UNCONDITIONAL expected minutes — it already averages in the
   weeks a player does not appear. Anything drawn inside a branch that has
   already conditioned on appearing must use minFrac/pAppear instead, or the
   same absence is applied a second time. pointsDist and squadSim did the
   latter, which ran every distribution light and bit hardest on exactly the
   rotation risks the rank tools exist to weigh. */
const cmOdds = { gp: 20, lam: 1.6, lamAvg: 1.47, cs: 0.3 };
const cmNailed = { id: 501, element_type: 3, team: 1, status: 'a', minutes: 1800, starts: 20, bonus: 14, saves: 0,
  expected_goals_per_90: '0.4', expected_assists_per_90: '0.25', expected_goals_conceded_per_90: '1.3',
  defensive_contribution_per_90: '4', yellow_cards: 3 };
const cmRota = { ...cmNailed, id: 502, minutes: 1050, starts: 11 };
for (const [who, el] of [['a nailed starter', cmNailed], ['a rotation risk', cmRota]]) {
  const nat = core.nativeXP(el, cmOdds), sim = core.pointsDist(el, cmOdds, 40000).mean;
  ok(Math.abs(sim - nat) / nat < 0.06,
    'the simulated mean agrees with the point estimate for ' + who + ' (within 6%)');
}
/* The distortion used to scale with the chance of NOT appearing, so it did
   not cancel out of a comparison between two players. */
const mNailed = core.minutesModel(cmNailed, 20), mRota = core.minutesModel(cmRota, 20);
ok(mRota.pAppear < mNailed.pAppear, 'the rotation risk really is the less certain starter');
const errNailed = Math.abs(core.pointsDist(cmNailed, cmOdds, 40000).mean - core.nativeXP(cmNailed, cmOdds));
const errRota = Math.abs(core.pointsDist(cmRota, cmOdds, 40000).mean - core.nativeXP(cmRota, cmOdds));
ok(Math.abs(errRota - errNailed) < 0.35, 'and the two layers no longer diverge further the less certain the starter is');

section('deductions are drawn as whole points, not shaved off the score');
/* Subtracting a fractional expectation from an otherwise integer score moved
   every trial off the integers, so a trial that scored exactly 10 fell below
   the haul line — losing the whole probability mass at 10 from the haul
   figure however small the deduction was. */
const cardy = { ...cmNailed, id: 503, yellow_cards: 9, red_cards: 1 };
const clean = { ...cmNailed, id: 503, yellow_cards: 0, red_cards: 0 };
const dCardy = core.pointsDist(cardy, cmOdds, 60000), dClean = core.pointsDist(clean, cmOdds, 60000);
ok(dCardy.mean < dClean.mean, 'a booking-prone player still projects below a clean one');
ok(dClean.haul - dCardy.haul < 0.02,
  'but the cards cost him a sliver of haul probability, not a fifth of it');
ok(Number.isInteger(dClean.p10) && Number.isInteger(dClean.p50) && Number.isInteger(dClean.p90),
  'the quantiles are whole points, as an FPL score is');
ok(Number.isInteger(dCardy.p50), 'and stay whole once deductions are in play');

section('availability is applied once across the horizon');
/* fixtureXP owns the availability scale on whichever branch it takes, so
   horizonXP must not apply it again — it used to, charging a 50 percent
   doubt as 25 percent everywhere the solver and transfer tools read. */
const hzOdds = { gp: 20, lam: 1.6, lamAvg: 1.47, cs: 0.3, event: 21 };
const hzMap = { 1: [hzOdds, hzOdds, hzOdds] };
const hzFit = { ...cmNailed, id: 504, chance_of_playing_next_round: null };
const hzDoubt = { ...cmNailed, id: 505, chance_of_playing_next_round: 50 };
ok(Math.abs(core.horizonXPreal(null, hzFit, hzMap) - 3 * core.fixtureXP(null, hzFit, hzOdds)) < 1e-9,
  'the horizon is the sum of its fixtures for a fit player');
ok(Math.abs(core.horizonXPreal(null, hzDoubt, hzMap) - 3 * core.fixtureXP(null, hzDoubt, hzOdds)) < 1e-9,
  'and for a doubtful one — no second scale applied on the way out');
const hzRatio = core.horizonXPreal(null, hzDoubt, hzMap) / core.horizonXPreal(null, hzFit, hzMap);
ok(hzRatio > 0.42 && hzRatio < 0.58, 'a 50 percent doubt costs about half the horizon, not three quarters of it');
/* The fallback branch (no native model yet) must carry availability too — it
   used to get none at all from every caller except horizonXP. */
const hzYoung = { element_type: 3, minutes: 120, starts: 1, status: 'a', ep_next: '4.0', chance_of_playing_next_round: 50,
  expected_goals_per_90: '0.3', expected_assists_per_90: '0.2' };
const hzYoungFit = { ...hzYoung, chance_of_playing_next_round: null };
ok(core.nativeXP(hzYoung, { gp: 3, lam: 1.6, lamAvg: 1.47, cs: 0.3 }) === null, 'the sample is too thin for the native model');
ok(core.fixtureXP(null, hzYoung, hzOdds) < core.fixtureXP(null, hzYoungFit, hzOdds),
  'so the ep_next fallback carries the doubt itself');

section('effGoalRate: finishing-aware goals (fix 5)');
const noGoalsField = { element_type: 4, minutes: 540, expected_goals_per_90: '0.4' };
ok(core.effGoalRate(noGoalsField) === 0.4, 'falls back to pure xG when goals are unknown');
const clinical = core.effGoalRate({ element_type: 4, minutes: 1800, expected_goals_per_90: '0.4', goals_scored: 16 });
const wasteful = core.effGoalRate({ element_type: 4, minutes: 1800, expected_goals_per_90: '0.4', goals_scored: 4 });
ok(clinical > 0.4 && clinical < 0.8, 'a clinical finisher is nudged above xG but shrunk, not fully');
ok(wasteful < 0.4, 'a wasteful finisher is nudged below xG');
const fwdBt = { element_type: 4, starts: 6, minutes: 540, status: 'a', chance_of_playing_next_round: null,
  expected_goals_per_90: '0.5', expected_assists_per_90: '0.2', bonus: 10 };
ok(core.nativeXP({ ...fwdBt, goals_scored: 20 }, nnf) > core.nativeXP(fwdBt, nnf), 'proven finishing lifts native xP');

section('negRate90: expected deductions for negatives (fix 4)');
ok(core.negRate90({ minutes: 900 }) === 0, 'a clean record deducts nothing');
ok(core.negRate90({ minutes: 900, red_cards: 1 }) > core.negRate90({ minutes: 900, yellow_cards: 1 }), 'a red costs more than a yellow');
ok(core.nativeXP({ ...fwdBt, yellow_cards: 8, red_cards: 1 }, nnf) < core.nativeXP(fwdBt, nnf), 'a booking-prone profile is debiased downward');

/* ── minutes model (P2) ─────────────────────────────────── */
section('minutesModel: availability reshapes the minutes');
const nailed = core.minutesModel({ starts: 6, minutes: 540, status: 'a', chance_of_playing_next_round: null }, 6);
ok(nailed.pStart > 0.95 && nailed.p60 > 0.95 && nailed.minFrac > 0.95, 'a nailed-on starter is ~certain to start and last 60');
const doubt = core.minutesModel({ starts: 6, minutes: 540, status: 'd', chance_of_playing_next_round: 50 }, 6);
ok(Math.abs(doubt.pStart - 0.5) < 0.02, 'a 50% doubt halves the start probability');
ok(doubt.minFrac < nailed.minFrac, 'a doubt lowers expected minutes');
const outPl = core.minutesModel({ starts: 6, minutes: 540, status: 'i', chance_of_playing_next_round: 0 }, 6);
ok(outPl.avail === 0 && outPl.pStart === 0 && outPl.minFrac === 0, 'an injured-out player is zeroed');
const rota = core.minutesModel({ starts: 3, minutes: 360, status: 'a', chance_of_playing_next_round: null }, 6);
ok(rota.pStart < nailed.pStart, 'a rotation risk starts less often than a nailed player');

/* ── recent minutes + this-round availability (API-fix 1, 3) ── */
section('recentMinutes: recency-weighted starts + minutes');
const allStarts = core.recentMinutes([1, 2, 3, 4, 5].map(r => ({ round: r, starts: 1, minutes: 90 })), 5);
ok(allStarts.n === 5 && Math.abs(allStarts.startShare - 1) < 1e-9 && Math.abs(allStarts.minShare - 1) < 1e-9, 'five full starts → share 1');
ok(core.recentMinutes([1, 2, 3].map(r => ({ round: r, starts: 0, minutes: 0 })), 5).startShare === 0, 'three blanks → share 0');
ok(core.recentMinutes([], 5).n === 0, 'no history → n 0');
const turnedNailed = core.recentMinutes([{ round: 1, starts: 0, minutes: 0 }, { round: 2, starts: 0, minutes: 0 }, { round: 3, starts: 1, minutes: 90 }, { round: 4, starts: 1, minutes: 90 }, { round: 5, starts: 1, minutes: 90 }], 5);
ok(turnedNailed.startShare > 0.55, 'a newly nailed player reads above 0.5 (recent gameweeks weigh more)');

section('minutesModel: recent form + this-round availability');
const seasonRota = { starts: 3, minutes: 360, status: 'a', chance_of_playing_next_round: null };
ok(core.minutesModel({ ...seasonRota, _recent: { startShare: 1, minShare: 1, n: 5 } }, 6).pStart > core.minutesModel(seasonRota, 6).pStart,
  'recent starts lift the start probability above the season average');
ok(core.minutesModel({ ...seasonRota, _recent: { startShare: 0, minShare: 0, n: 5 } }, 6).pStart < core.minutesModel(seasonRota, 6).pStart,
  'a recent benching pulls it below the season average');
const thisRoundDoubt = core.minutesModel({ starts: 6, minutes: 540, status: 'd', chance_of_playing_next_round: null, chance_of_playing_this_round: 25 }, 6);
ok(thisRoundDoubt.pStart < 0.3, 'a this-round doubt is applied when the next-round flag is unset');

section('nativeXP reflects the minutes model');
const nxNf = { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.3 };
const fitFwd = { element_type: 4, starts: 6, minutes: 540, status: 'a', chance_of_playing_next_round: null,
  expected_goals_per_90: '0.5', expected_assists_per_90: '0.2', bonus: 10 };
const doubtFwd = { ...fitFwd, status: 'd', chance_of_playing_next_round: 50 };
const outFwd = { ...fitFwd, status: 'i', chance_of_playing_next_round: 0 };
ok(core.nativeXP(doubtFwd, nxNf) < core.nativeXP(fitFwd, nxNf), 'a doubt lowers native xP');
ok(core.nativeXP(outFwd, nxNf) === 0, 'a ruled-out player gets zero native xP');

/* ── points distribution (P3) ───────────────────────────── */
section('pointsDist: ordered percentiles, deterministic, premium hauls more');
const pdNf = { gp: 6, lam: 1.9, lamAvg: 1.5, cs: 0.4 };
const prem = { id: 1, element_type: 4, starts: 6, minutes: 540, status: 'a',
  expected_goals_per_90: '0.85', expected_assists_per_90: '0.2', bonus: 18, defensive_contribution_per_90: '2' };
const cheap = { id: 2, element_type: 3, starts: 6, minutes: 500, status: 'a',
  expected_goals_per_90: '0.08', expected_assists_per_90: '0.1', bonus: 4, defensive_contribution_per_90: '3' };
const dp = core.pointsDist(prem, pdNf);
ok(dp.p10 <= dp.p50 && dp.p50 <= dp.p90, 'percentiles are ordered');
ok(dp.mean > 0 && dp.p90 > dp.p10, 'a real spread');
ok(dp.haul > core.pointsDist(cheap, pdNf).haul, 'the premium hauls more often than the cheap punt');
const dp2 = core.pointsDist(prem, pdNf);
ok(dp.p50 === dp2.p50 && dp.p90 === dp2.p90, 'deterministic (seeded on the player id)');
ok(core.pointsDist(prem, null).mean === 0, 'no fixture model → zeroed distribution');
const gkDist = core.pointsDist({ id: 3, element_type: 1, starts: 6, minutes: 540, status: 'a', saves: 60 }, { gp: 6, lam: 1.4, lamAvg: 1.5, cs: 0.45 });
ok(gkDist.mean > 0, 'a goalkeeper gets a positive distribution (saves + clean sheet)');

/* ── correlated squad simulation (P4) ───────────────────── */
section('squadSim: projects an XI, captain doubles, shared team outcomes');
const sq = [];
for (let i = 0; i < 11; i++) sq.push({ id: 200 + i, team: 1 + (i % 5), element_type: i === 0 ? 1 : i < 5 ? 2 : i < 9 ? 3 : 4,
  starts: 6, minutes: 540, status: 'a', expected_goals_per_90: i > 4 ? '0.4' : '0.05',
  expected_assists_per_90: '0.15', bonus: 8, defensive_contribution_per_90: '9', saves: i === 0 ? 60 : 0 });
const sqNf = { 1: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 }, 2: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 },
  3: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 }, 4: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 }, 5: { gp: 6, lam: 1.6, lamAvg: 1.5, cs: 0.35 } };
const noCap = core.squadSim(sq, sqNf, null);
const withCap = core.squadSim(sq, sqNf, 205);          /* captain a forward */
ok(noCap.p10 <= noCap.p50 && noCap.p50 <= noCap.p90, 'squad total percentiles ordered');
ok(noCap.mean > 20, 'a full XI projects a sensible points total');
ok(withCap.mean > noCap.mean, 'captaining a starter raises the projection');
ok(core.squadSim(sq, sqNf, 205).p50 === withCap.p50, 'deterministic (seeded on the squad)');
ok(core.squadSim([], sqNf, null).mean === 0, 'an empty squad projects zero');

/* ── rank-EV transfer optimiser (P4) ────────────────────── */
section('normCdf: standard normal CDF');
ok(Math.abs(core.normCdf(0) - 0.5) < 1e-3, 'CDF at 0 is 0.5');
ok(core.normCdf(3) > 0.99 && core.normCdf(-3) < 0.01, 'far tails saturate');
ok(Math.abs(core.normCdf(1.6449) - 0.95) < 2e-3, '95th percentile at z≈1.645');
ok(core.normCdf(-1) < 0.5 && core.normCdf(1) > 0.5, 'monotone around the mean');

section('effEdge: ownership damps the edge over the field');
const rnf = { gp: 6, lam: 1.7, lamAvg: 1.5, cs: 0.35 };
const hi = core.effEdge({ id: 501, element_type: 3, starts: 6, minutes: 540, status: 'a',
  expected_goals_per_90: '0.55', expected_assists_per_90: '0.3', bonus: 10, selected_by_percent: '60' }, rnf);
const lo = core.effEdge({ id: 502, element_type: 3, starts: 6, minutes: 540, status: 'a',
  expected_goals_per_90: '0.55', expected_assists_per_90: '0.3', bonus: 10, selected_by_percent: '4' }, rnf);
ok(Math.abs(hi.raw.mean - lo.raw.mean) < 0.4, 'same profile → near-identical raw distribution');
ok(lo.mean > hi.mean, 'the low-owned twin carries a bigger edge over the field');
ok(lo.sd > hi.sd, 'the differential also swings rank harder');
ok(hi.o === 0.6 && lo.o === 0.04, 'ownership fraction read from selected_by_percent');

section('rankEV / rankOptimiser: rank pick can differ from points pick');
const outEl = { id: 510, team: 3, element_type: 3, starts: 6, minutes: 540, status: 'a', now_cost: 70,
  expected_goals_per_90: '0.15', expected_assists_per_90: '0.1', bonus: 3, selected_by_percent: '30' };
/* Two candidates: one slightly higher raw points but heavily owned (template),
   one a hair lower on raw points but a differential. */
const templ = { id: 511, team: 4, element_type: 3, starts: 6, minutes: 540, status: 'a', now_cost: 70,
  expected_goals_per_90: '0.62', expected_assists_per_90: '0.32', bonus: 12, selected_by_percent: '70' };
const diff = { id: 512, team: 5, element_type: 3, starts: 6, minutes: 540, status: 'a', now_cost: 70,
  expected_goals_per_90: '0.58', expected_assists_per_90: '0.30', bonus: 11, selected_by_percent: '5' };
const oNf = { 3: rnf, 4: rnf, 5: rnf };
const rTempl = core.rankEV(templ, outEl, oNf), rDiff = core.rankEV(diff, outEl, oNf);
ok(rTempl.rawGain > 0 && rDiff.rawGain > 0, 'both upgrades gain raw points');
ok(rDiff.dMean > rTempl.dMean, 'the differential wins on edge over the field despite lower raw points');
ok(rDiff.beat > 0.5, 'a positive edge beats the field more than half the time');
const optB = { elements: [templ, diff], els: { 511: templ, 512: diff } };
const opt = core.rankOptimiser(optB, [outEl], [outEl], 20, oNf, new Set());
ok(opt.topRank && opt.topRank.inEl.id === 512, 'optimiser ranks the differential top');
ok(opt.topPoints && opt.topPoints.inEl.id === 511, 'and still names the raw-points leader');
ok(opt.diverges === true, 'flags that points and rank disagree here');
ok(core.rankOptimiser(optB, [outEl], [outEl], 20, oNf, new Set([510])).moves.length === 0, 'a protected player is never sold');

/* ── match model refinements (P6) ───────────────────────── */
section('recencyWeight / availAttackMult');
ok(core.recencyWeight(10, 10) === 1, 'the latest gameweek is full weight');
ok(core.recencyWeight(9, 10) < 1 && core.recencyWeight(9, 10) > core.recencyWeight(1, 10), 'older fixtures decay monotonically');
ok(Math.abs(core.recencyWeight(0, 10) - Math.pow(0.97, 10)) < 1e-9, '10 GWs back ≈ 0.97^10');
ok(core.recencyWeight(12, 10) === 1, 'future/clamped events never exceed full weight');
ok(core.availAttackMult('a') === 1, 'a fit key attacker leaves attack unchanged');
ok(core.availAttackMult('i') === 0.90 && core.availAttackMult('s') === 0.90, 'a ruled-out key man cuts team attack 10%');
ok(core.availAttackMult('d') === 0.96, 'a doubtful key man cuts attack 4%');

/* ── calibration (P5) ───────────────────────────────────── */
section('calibration: Brier score + reliability curve');
/* Perfectly calibrated: outcomes occur exactly at the predicted rate. */
const perfect = [];
for (let b = 0; b < 10; b++) { const p = (b + 0.5) / 10;
  for (let i = 0; i < 100; i++) perfect.push({ p, y: i < Math.round(p * 100) ? 1 : 0 }); }
const cp = core.calibration(perfect);
ok(cp.n === 1000 && cp.brier > 0, 'grades all rows with a Brier score');
ok(cp.buckets.every(b => Math.abs(b.pMean - b.oFreq) < 0.05), 'a calibrated model tracks the diagonal (pMean ≈ oFreq)');
/* An over-confident model: always predicts 0.9 but outcomes are 50/50. */
const over = [];
for (let i = 0; i < 1000; i++) over.push({ p: 0.9, y: i % 2 });
const co = core.calibration(over);
ok(co.brier > cp.brier, 'an over-confident model scores a worse (higher) Brier');
ok(co.buckets.some(b => b.pMean - b.oFreq > 0.3), 'the reliability curve exposes the over-confidence');
ok(core.calibration([]).n === 0 && core.calibration([]).brier === null, 'empty input is handled');

section('seasonKeyFrom: season label for scoped storage');
/* Earliest deadline year -> "YYYY/YY". The stamp that invalidates last
   seasons watchlist / draft (element IDs reset each season). */
ok(core.seasonKeyFrom([{ deadline_time: '2026-08-21T17:30:00Z' }, { deadline_time: '2026-08-28T17:30:00Z' }]) === '2026/27', 'derives 2026/27 from GW1 deadline');
ok(core.seasonKeyFrom([{ deadline_time: '2025-08-15T17:30:00Z' }]) === '2025/26', 'derives 2025/26');
ok(core.seasonKeyFrom([{ deadline_time: '2026-09-01T00:00:00Z' }, { deadline_time: '2026-08-21T17:30:00Z' }]) === '2026/27', 'uses the earliest deadline, not array order');
ok(core.seasonKeyFrom([]) === '' && core.seasonKeyFrom([{}]) === '', 'no deadlines -> empty (cannot verify -> never discards)');
/* The scoping rule: a stamp from a different season must not equal the
   current one, so stale element-ID lists get discarded. */
ok(core.seasonKeyFrom([{ deadline_time: '2025-08-15T17:30:00Z' }]) !== core.seasonKeyFrom([{ deadline_time: '2026-08-21T17:30:00Z' }]), 'consecutive seasons produce distinct keys');

section('plsimPrior: promoted-club default (Tier 2)');
/* A fitted club gets its own prior; an unknown (newly-promoted) club gets a
   below-average default, not neutral [1,1,1], so opponents arent over-rated.
   The fitted side is graded against the table rather than against a fixed
   number: the priors are refreshed from the simulator's weekly recalibration,
   and a hard threshold would fail on an ordinary refit rather than on a real
   regression. Arsenal is the claim — well above average in attack, and the
   best defence we rate. */
const arsPrior = core.plsimPrior({ name: 'Arsenal' });
const allPriors = Object.keys(core.PLSIM.priors).map((k) => core.PLSIM.priors[k]);
const bestDef = Math.min(...allPriors.map((p) => p[1]));
ok(arsPrior[0] > 1.1 && arsPrior[1] === bestDef,
  'a fitted club keeps its own strong prior (Arsenal ' + arsPrior[0] + ' att / ' + arsPrior[1] + ' def)');
const promoted = core.plsimPrior({ name: 'Wrexham AFC' });
ok(promoted === core.PLSIM_PROMOTED, 'an unknown/promoted club falls back to PLSIM_PROMOTED');
ok(promoted[0] < 1 && promoted[1] > 1, 'the promoted default is below average (weaker attack, concedes more)');
ok(core.plsimPrior({}) === core.PLSIM_PROMOTED && core.plsimPrior(null) === core.PLSIM_PROMOTED, 'missing team name is handled, not a crash');
ok(core.plsimPrior({ name: 'Manchester City' })[0] > 1.2, 'alias resolves multi-word names (Manchester City -> mancity)');

section('eloPrior: a club-specific prior where we have no fitted one (Tier 2)');
{
  /* Real 2026/27 ratings from the Core Insights teams.csv, and the league mean
     they sit around. */
  const elo = { 1: 2064, 2: 1921, 3: 1666, 4: 1971, 5: 1533 };
  const mean = core.eloMean(elo);
  ok(Math.abs(mean - 1831) < 1, 'the league mean comes from the ratings we have (' + Math.round(mean) + ')');
  ok(core.eloMean({}) === null && core.eloMean(null) === null, 'no ratings means no mean');
  ok(core.eloMean({ 1: 2000, 2: NaN }) === 2000, 'a broken rating is left out of the mean');

  const strong = core.eloPrior(2064, mean);
  const weak = core.eloPrior(1533, mean);
  ok(strong && weak, 'a rating either side of the mean produces a prior');
  ok(strong[0] > weak[0], 'the stronger club attacks better');
  ok(strong[1] < weak[1], 'and concedes less — a LOWER defence multiplier is better');
  const avg = core.eloPrior(mean, mean);
  ok(Math.abs(avg[0] - 1) < 0.05 && Math.abs(avg[1] - 1) < 0.05, 'a league-average club is close to neutral');
  ok(strong[2] === core.PLSIM_PROMOTED[2], 'home advantage is not an Elo question and is left alone');

  /* A wild rating must not produce a wild side. */
  const absurd = core.eloPrior(9000, mean);
  ok(absurd[0] <= 1.6 && absurd[1] >= 0.55, 'an absurd rating is clamped to a plausible side');
  ok(core.eloPrior(NaN, mean) === null && core.eloPrior(1800, null) === null, 'a missing rating or mean yields nothing');
}

section('plsimPrior: Elo fills the gap, and never overrides a fit (Tier 2)');
{
  const elo = { 1: 2064, 2: 1921, 3: 1666, 4: 1971, 5: 1533 };
  /* A club WITH an offline fit keeps it — the fit is the better estimate and
     Elo reproducing it to within ~8% is not a reason to trade down. */
  const arsWith = core.plsimPrior({ name: 'Arsenal', id: 1 }, elo);
  ok(arsWith === core.PLSIM.priors.arsenal, 'a fitted club keeps its fitted prior even with Elo present');

  /* A club WITHOUT one gets a club-specific prior instead of the single
     generic promoted number every such club used to share. */
  const strongUnknown = core.plsimPrior({ name: 'Wrexham AFC', id: 1 }, elo);
  const weakUnknown = core.plsimPrior({ name: 'Wrexham AFC', id: 5 }, elo);
  ok(strongUnknown !== core.PLSIM_PROMOTED, 'an unknown club with a rating no longer takes the generic prior');
  ok(strongUnknown[0] > weakUnknown[0],
    'and two unknown clubs of different strength no longer get identical priors');

  /* Every fallback still holds. */
  ok(core.plsimPrior({ name: 'Wrexham AFC', id: 99 }, elo) === core.PLSIM_PROMOTED,
    'an unknown club with no rating falls back to the generic prior');
  ok(core.plsimPrior({ name: 'Wrexham AFC', id: 1 }) === core.PLSIM_PROMOTED,
    'and so does one when no Elo is loaded at all — the old behaviour exactly');
  ok(core.plsimPrior({ name: 'Arsenal', id: 1 }) === core.PLSIM.priors.arsenal, 'fitted clubs are unaffected by absent Elo');
  ok(core.plsimPrior({}, elo) === core.PLSIM_PROMOTED && core.plsimPrior(null, elo) === core.PLSIM_PROMOTED,
    'a missing team is still handled, not a crash');
}

section('eloPrior: held-out, it beats the generic prior it replaces (Tier 2)');
{
  /* The claim that justified using Elo at all, pinned so it survives any
     change to the fitted coefficients. Leave-one-out over a committed snapshot
     of real 2026/27 ratings: for each club, predict its prior from Elo using
     ONLY the other nineteen, and compare against PLSIM_PROMOTED — the single
     generic number every club without a fit used to share. */
  const snap = JSON.parse(readFileSync(join(ROOT, 'dev', 'fixtures', 'team-elo-2026-2027.json'), 'utf8'));
  /* The app's own aliasing, not a copy of it — a duplicate here would drift
     and silently shrink the sample. */
  const key = (n) => {
    const k = String(n).toLowerCase().replace(/[^a-z]/g, '');
    return core.PLSIM.priors[k] ? k : (core.PLSIM_ALIAS[k] || k);
  };
  const data = snap.teams
    .map((t) => ({ elo: t.elo, prior: core.PLSIM.priors[key(t.name)] }))
    .filter((d) => d.prior);
  ok(data.length >= 18, 'the snapshot matches our fitted clubs (' + data.length + '/20)');

  /* Refit the log-linear mapping on a subset — the same shape eloPrior uses. */
  const refit = (sample, idx) => {
    const mean = sample.reduce((s, d) => s + d.elo, 0) / sample.length;
    const X = sample.map((d) => (d.elo - mean) / 400);
    const Y = sample.map((d) => Math.log(d.prior[idx]));
    const mx = X.reduce((s, x) => s + x, 0) / X.length;
    const my = Y.reduce((s, y) => s + y, 0) / Y.length;
    let num = 0, den = 0;
    for (let i = 0; i < X.length; i++) { num += (X[i] - mx) * (Y[i] - my); den += (X[i] - mx) ** 2; }
    const b = num / den;
    return { a: my - b * mx, b, mean };
  };
  for (const [idx, label] of [[0, 'attack'], [1, 'defence']]) {
    let eloErr = 0, genErr = 0;
    for (let j = 0; j < data.length; j++) {
      const rest = data.filter((_, k) => k !== j);
      const { a, b, mean } = refit(rest, idx);
      const pred = Math.exp(a + b * (data[j].elo - mean) / 400);
      eloErr += Math.abs(Math.log(pred) - Math.log(data[j].prior[idx]));
      genErr += Math.abs(Math.log(core.PLSIM_PROMOTED[idx]) - Math.log(data[j].prior[idx]));
    }
    ok(eloErr < genErr * 0.6,
      'held-out, an Elo prior beats the generic one on ' + label +
      ' by ' + Math.round(100 * (1 - eloErr / genErr)) + '% (needs >40%)');
  }

  /* And the SHIPPING coefficients — not a refit — must reproduce the priors
     we trust, or the mapping baked into the app has drifted from its fit. */
  const mean = core.eloMean(Object.fromEntries(snap.teams.map((t) => [t.id, t.elo])));
  let worst = 0;
  for (const d of data) {
    const p = core.eloPrior(d.elo, mean);
    worst = Math.max(worst, Math.abs(Math.log(p[0]) - Math.log(d.prior[0])),
      Math.abs(Math.log(p[1]) - Math.log(d.prior[1])));
  }
  ok(worst < 0.25, 'the shipped coefficients still track the fitted priors (worst |log err| ' + worst.toFixed(3) + ')');

  /* Closeness alone is not enough: a mapping that returned ~1 for every club
     would be close on average and useless, because the whole point is telling
     a strong promoted side from a weak one. So check the SPREAD too — the
     shipped mapping must separate clubs about as much as the priors do. */
  const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
  for (const [idx, label] of [[0, 'attack'], [1, 'defence']]) {
    const pred = data.map((d) => Math.log(core.eloPrior(d.elo, mean)[idx]));
    const act = data.map((d) => Math.log(d.prior[idx]));
    const ratio = sd(pred) / sd(act);
    ok(ratio > 0.6 && ratio < 1.4,
      'the mapping spreads clubs like the priors do on ' + label + ' (sd ratio ' + ratio.toFixed(2) + ')');
  }
}

section('team strength: FPL\'s own venue-split rating, and the ways it lies');
{
  /* The direction is the whole ballgame. It was established empirically —
     r=0.818 against the opponent's team_*_difficulty over 380 fixtures — and
     if it is ever flipped, every rating on the lens inverts silently. These
     assertions are what would catch that. */
  const club = (o) => Object.assign({
    strength_overall_home: 3, strength_overall_away: 3,
    strength_attack_home: 0, strength_attack_away: 0,
    strength_defence_home: 0, strength_defence_away: 0
  }, o || {});

  /* ── zero is absent, not weakest ─────────────────────────
     FPL ships 0 for every attack and defence field as of 16 Aug 2026. Read as
     a real strength it would make every club maximally weak, and as a divisor
     it is a division by zero. */
  ok(core.teamStrength(club(), true, 'attack') === null,
    'a zero attack strength reads as ABSENT, not as the weakest possible attack');
  ok(core.teamStrength(club(), true, 'overall') === 3, 'a real value is returned as-is');
  ok(core.teamStrength(null, true, 'overall') === null, 'a missing club is null, not a throw');
  ok(core.teamStrength(club(), true, 'nonsense-kind') === 3,
    'an unknown kind falls back to overall rather than undefined');

  /* ── venue ─────────────────────────────────────────────── */
  const lopsided = club({ strength_overall_home: 5, strength_overall_away: 2 });
  ok(core.teamStrength(lopsided, true, 'overall') === 5
    && core.teamStrength(lopsided, false, 'overall') === 2,
    'home and away are read from the right field');

  /* ── DIRECTION: stronger club, easier fixture ──────────── */
  const strong = club({ strength_overall_home: 5, strength_overall_away: 5 });
  const weak = club({ strength_overall_home: 2, strength_overall_away: 2 });
  const vsWeak = core.strengthEdge(strong, true, weak);
  const vsStrong = core.strengthEdge(weak, true, strong);
  ok(vsWeak.edge > 1 && vsStrong.edge < 1,
    'a strong club facing a weak one is above parity, and the reverse below');
  ok(core.strengthGrade(vsWeak) < core.strengthGrade(vsStrong),
    'and the strong club gets the EASIER grade — this is the assertion that '
    + 'catches the direction being inverted');
  ok(core.strengthGrade(vsWeak) === 1 && core.strengthGrade(vsStrong) === 5,
    'the extremes of a 2-5 scale reach both ends of the 1-5 grade');

  /* Parity must land in the middle, from either side. */
  const even = core.strengthEdge(club(), true, club());
  ok(Math.abs(even.edge - 1) < 1e-9 && core.strengthGrade(even) === 3,
    'an even matchup is 1.00 and grades 3');

  /* ── the bands mirror around parity ────────────────────── */
  const B = core.STRENGTH_BANDS;
  ok(Math.abs(B[0] * B[3] - 1) < 0.02 && Math.abs(B[1] * B[2] - 1) < 0.02,
    'the bands are symmetric in log space, so "one band better" means the same '
    + 'thing on both sides of a fixture (' + B.join(', ') + ')');
  ok(B[0] > B[1] && B[1] > B[2] && B[2] > B[3], 'the bands descend');

  /* ── basis: attack/defence when populated, overall otherwise ── */
  ok(even.basis === 'overall',
    'with attack and defence zeroed the edge falls back to overall — which is '
    + 'what FPL actually serves today');
  const withAtt = club({ strength_attack_home: 1300, strength_defence_away: 1000 });
  const opp = club({ strength_defence_away: 1000, strength_attack_home: 1100 });
  const rich = core.strengthEdge(withAtt, true, opp);
  ok(rich.basis === 'attack' && Math.abs(rich.edge - 1.3) < 1e-9,
    'once FPL populates them, the lens uses attack-vs-defence without a code change');
  /* The basis must be REPORTED, not silently swapped. */
  ok(even.basis !== rich.basis && typeof even.basis === 'string',
    'and it says which basis it used, because a number whose meaning changes '
    + 'underneath the reader is worse than no number');

  /* ── a missing edge must not manufacture an easy fixture ── */
  ok(core.strengthEdge(club({ strength_overall_home: 0 }), true, club()) === null,
    'no usable numbers on either side gives null, not a guess');
  ok(core.strengthGrade(null) === 3, 'a null edge grades NEUTRAL, never easy');
  ok(core.strengthGrade({ edge: NaN }) === 3, 'and a NaN edge does too');
  ok(core.strengthGrade(null) > core.FDR_PATCH_MAX,
    'a missing edge sits above the purple-patch threshold, so absent data can '
    + 'never pull a run into existence');

  /* ── the grid contract ─────────────────────────────────── */
  const cell = (o) => Object.assign({ opp: 'BOU', home: true, diff: 2, fdr: 2,
    lam: 2.21, cs: 0.33, win: 0.62, s: { edge: 1.25, basis: 'overall' } }, o || {});
  ok(core.fdrCellValue('strength', cell()) === '1.25', 'the strength lens prints the ratio');
  ok(core.fdrCellValue('strength', cell({ s: null })) === '—',
    'a fixture with no strength data shows a dash rather than a number');
  ok(core.fdrLens('strength').unit === 'STR', 'the lens names its own unit');
  ok(core.fdrGrade('strength', cell()) === 2, 'fdrGrade routes the strength view');
  /* Averaged, not summed — it is a ratio. */
  const run = [cell({ s: { edge: 1.0, basis: 'overall' } }),
    cell({ s: { edge: 2.0, basis: 'overall' } })];
  ok(core.fdrRunTotal('strength', run) === '1.50',
    'the run total AVERAGES the ratio — summing ratios would be meaningless');
  ok(core.fdrRunTotal('strength', [cell({ s: null }), cell({ s: { edge: 2, basis: 'overall' } })]) === '2.00',
    'and a partial run averages only the fixtures that have data');
  ok(core.fdrRunTotal('strength', [cell({ s: null })]) === '—',
    'an all-missing run has no total');

  /* Adding a lens must not disturb the others. */
  ok(core.fdrCellValue('attack', cell()) === '2.21'
    && core.fdrCellValue('fpl', cell()) === '2',
    'the existing lenses are unchanged by the new one');

  /* ── and it has to be REACHABLE ─────────────────────────
     Everything above tests a lens the user cannot select unless it is also in
     the VIEWS list that draws the buttons. VIEWS is built inside a closure so
     it cannot be extracted and evaluated; the source line is checked instead.

     Worth the crudeness: the defect found earlier today was a correction that
     reached one edition of a document and not the other, passing every test
     because the test read the edition that was right. A lens that exists in
     FDR_LENS and nowhere in the UI would fail exactly the same way. */
  const viewsLine = /const VIEWS=\[[^;]*\];/.exec(html);
  ok(!!viewsLine, 'the lens button list is still where this test looks for it');
  for (const id of Object.keys(core.FDR_LENS)) {
    ok(viewsLine && viewsLine[0].includes("'" + id + "'"),
      'the ' + id + ' lens is offered as a button, not just implemented');
  }
}

section('fdr lenses: the cell shows the projection, not just a colour (Tier 2)');
{
  /* A cell as the planner builds one: opponent, difficulty bucket, official
     FDR, and the three projections the model already computed. */
  const cell = (o) => Object.assign({ opp: 'BOU', home: true, diff: 2, fdr: 2, lam: 2.21, cs: 0.33, win: 0.62 }, o || {});

  ok(core.fdrCellValue('attack', cell()) === '2.21', 'the attack lens prints expected goals');
  ok(core.fdrCellValue('defence', cell()) === '33%', 'the defence lens prints clean-sheet odds');
  ok(core.fdrCellValue('overall', cell()) === '62%', 'the overall lens prints the win chance');
  ok(core.fdrCellValue('fpl', cell()) === '2', 'the FPL lens prints the official rating');

  /* The whole point: two cells that colour identically can be very different
     fixtures, and the number is what separates them. */
  const easy = cell({ lam: 2.5, diff: 2 }), meh = cell({ lam: 1.6, diff: 2 });
  ok(easy.diff === meh.diff, 'two fixtures can share a difficulty bucket');
  ok(core.fdrCellValue('attack', easy) !== core.fdrCellValue('attack', meh),
    'but the attack lens tells them apart');

  /* Totals are in the lens's own unit, not a sum of 1-5 buckets. */
  const run = [cell({ lam: 2.21, cs: 0.33, win: 0.62, fdr: 2 }),
    cell({ lam: 1.65, cs: 0.33, win: 0.5, fdr: 3 }),
    cell({ lam: 2.78, cs: 0.46, win: 0.7, fdr: 2 })];
  ok(core.fdrRunTotal('attack', run) === '6.64', 'the attack total sums expected goals over the run');
  ok(core.fdrRunTotal('fpl', run) === '7', 'the FPL total sums the official ratings');
  ok(core.fdrRunTotal('defence', run) === '1.12', 'the defence total sums clean-sheet chance (expected clean sheets)');
  ok(core.fdrRunTotal('overall', run) === '61%', 'the overall total AVERAGES win chance — summing probabilities would be meaningless');
  ok(core.fdrLens('attack').unit === 'GLS' && core.fdrLens('defence').unit === 'xCS',
    'each lens names its own unit');

  /* Blanks: a club with no fixture that week has no cell at all. */
  ok(core.fdrCellValue('attack', null) === '—', 'a blank gameweek shows a dash, not a zero');
  ok(core.fdrRunTotal('attack', [null, null]) === '—', 'an all-blank run has no total');
  ok(core.fdrRunTotal('attack', [null, cell({ lam: 2 }), null]) === '2.00',
    'and a partial run totals only the fixtures that exist');
  ok(core.fdrRunTotal('attack', []) === '—' && core.fdrRunTotal('attack', null) === '—', 'an empty run is safe');

  /* Missing model output must read as zero, never NaN on the page. */
  const bare = { opp: 'X', home: true, diff: 3, fdr: 3 };
  for (const v of ['overall', 'attack', 'defence', 'fpl']) {
    ok(!/NaN|undefined/.test(core.fdrCellValue(v, bare)), 'the ' + v + ' lens never renders NaN');
  }
  ok(core.fdrCellValue('nonsense', cell()) === core.fdrCellValue('overall', cell()),
    'an unknown lens falls back to overall rather than throwing');
  /* An out-of-range official rating is clamped to average, as the grid does. */
  ok(core.fdrCellValue('fpl', cell({ fdr: 0 })) === '3' && core.fdrCellValue('fpl', cell({ fdr: 9 })) === '3',
    'an impossible official rating reads as average');
}

section('oopFlag: unusual for his own position, paid on his own tariff (Tier 2)');
{
  const M = core.OOP_MIN_MINUTES;
  /* A realistic league: within each position most players cluster low and a
     few sit well clear. That spread is the whole point — the flag is looking
     for the tail of a position, not for a player who resembles another one. */
  const pool = [];
  let id = 1;
  const add = (type, xgs) => xgs.forEach((xg) => pool.push({
    id: id++, element_type: type, minutes: M + 100, expected_goals_per_90: String(xg) }));
  /* 20 defenders: nearly all negligible, two genuine attacking full-backs. */
  add(2, [0.02, 0.02, 0.03, 0.03, 0.03, 0.04, 0.04, 0.04, 0.05, 0.05,
          0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.09, 0.10, 0.22, 0.30]);
  /* 20 midfielders: a spread, with a couple playing as strikers. */
  add(3, [0.05, 0.06, 0.08, 0.09, 0.10, 0.11, 0.12, 0.13, 0.15, 0.16,
          0.17, 0.18, 0.20, 0.22, 0.25, 0.28, 0.32, 0.36, 0.55, 0.62]);
  /* 20 forwards, including two who barely threaten at all. */
  add(4, [0.12, 0.14, 0.20, 0.25, 0.30, 0.33, 0.36, 0.38, 0.40, 0.42,
          0.45, 0.47, 0.50, 0.52, 0.55, 0.58, 0.62, 0.66, 0.70, 0.80]);
  const marks = core.oopBenchmarks(pool);

  ok(marks[2] && marks[3] && marks[4], 'every position group gets its own cut-offs');
  ok(marks[2].high < marks[2].top, 'the strong cut-off sits above the ordinary one');
  ok(marks[2].n === 20, 'and the pool size is reported (' + marks[2].n + ')');

  /* THE REGRESSION THIS REPLACES. The old rule compared a defender against
     the MEDIAN MIDFIELDER, which is a genuinely attacking footballer — so it
     flagged nobody across two real club previews, including the league's
     most-cited out-of-position players. An attacking full-back must be found
     by his own position's distribution, and this pool is built so the two
     rules disagree: 0.12 is a standout among defenders and nowhere near a
     typical midfielder. */
  const fullBack = { element_type: 2, minutes: M + 100, expected_goals_per_90: '0.12' };
  const medianMid = core.oopQuantile(
    pool.filter((p) => p.element_type === 3).map((p) => parseFloat(p.expected_goals_per_90)).sort((a, b) => a - b), 0.5);
  ok(0.12 < medianMid, 'the test case would fail the old median-midfielder bar (' + medianMid + ')');
  ok(0.12 >= marks[2].high, 'while clearing his own position\'s bar (' + marks[2].high.toFixed(3) + ')');
  const fb = core.oopFlag(fullBack, marks);
  ok(fb && fb.kind === 'up', 'but an attacking full-back IS flagged now');
  ok(fb && /defender/.test(fb.label), 'and the label is about his own position (' + (fb || {}).label + ')');
  ok(fb && /6 points a goal/.test(fb.note), 'with the tariff that makes it worth points');

  /* Same idea for a midfielder playing as a striker. */
  const striker = core.oopFlag({ element_type: 3, minutes: M + 100, expected_goals_per_90: '0.55' }, marks);
  ok(striker && striker.kind === 'up' && /midfielder/.test(striker.label),
    'a midfielder in his position\'s top tail is flagged');
  ok(striker && /5 points a goal/.test(striker.note), 'with the midfielder tariff named');

  /* THE TAG IS A MEASUREMENT, NOT A FORECAST. This is derived entirely from
     last season's output, and a commentator made the cost of forgetting that
     concrete: Muñoz is flagged here as an attacking full-back on numbers he
     compiled in a back three under a manager who has since left. The role
     that produced them may not exist. Nothing in any feed we read carries a
     manager, so the honest move is to stop the copy claiming the present
     tense — "attacks like a winger" reads as a property of the player, and
     it is a property of a job. */
  ok(/last season/.test(fb.label),
    'the defender label is past tense (' + fb.label + ')');
  ok(!/^attacks /.test(fb.label), 'and does not assert a present-tense habit');
  ok(/ROLE and not a property|role and not a property/.test(fb.note),
    'the note says it is a role rather than a property');
  ok(/new manager|change of shape/.test(fb.note),
    'and names what would take it away (' + fb.note.slice(-90) + ')');
  ok(/last season/.test(striker.label) && /role and not a property|ROLE and not a property/i.test(striker.note),
    'the midfielder copy carries the same caveat');

  /* The tail is the claim, so the middle of a position must stay silent —
     otherwise the flag means "quite good" and stops being information. */
  ok(core.oopFlag({ element_type: 2, minutes: M + 100, expected_goals_per_90: '0.05' }, marks) === null,
    'a typical defender is not out of position');
  ok(core.oopFlag({ element_type: 3, minutes: M + 100, expected_goals_per_90: '0.15' }, marks) === null,
    'nor a typical midfielder');
  ok(core.oopFlag({ element_type: 1, minutes: M + 100, expected_goals_per_90: '0' }, marks) === null,
    'a goalkeeper is never flagged');

  /* No more than the stated share of a position may be flagged, or the
     percentile has stopped meaning what it says. */
  const defs = pool.filter((p) => p.element_type === 2);
  const flagged = defs.filter((p) => core.oopFlag(p, marks));
  ok(flagged.length <= Math.ceil(defs.length * (1 - core.OOP_PCTL)) + 1,
    'only the top tail of a position is flagged (' + flagged.length + ' of ' + defs.length + ')');
  ok(flagged.length >= 1, 'but the tail is not empty');

  /* Strength: the top of the tail reads differently from its edge. */
  const edge = core.oopFlag({ element_type: 2, minutes: M + 100,
    expected_goals_per_90: String(marks[2].high) }, marks);
  const peak = core.oopFlag({ element_type: 2, minutes: M + 100,
    expected_goals_per_90: String(marks[2].top + 0.05) }, marks);
  ok(edge.level === 1 && peak.level === 2, 'the very top of a position is a stronger flag');

  /* The caution, and it must stay a caution rather than a find. */
  const deep = core.oopFlag({ element_type: 4, minutes: M + 100, expected_goals_per_90: '0.12' }, marks);
  ok(deep && deep.level < 0 && deep.kind === 'down', 'a forward with no goal threat is a caution');
  ok(core.oopFlag({ element_type: 4, minutes: M + 100, expected_goals_per_90: '0.80' }, marks) === null,
    'and an elite forward is not flagged at all — he is exactly where he should be');

  /* Sample size and pre-season: no minutes, no claim. */
  ok(core.oopFlag({ element_type: 3, minutes: M - 1, expected_goals_per_90: '0.9' }, marks) === null,
    'too few minutes means no flag, however good the rate looks');
  ok(Object.keys(core.oopBenchmarks(pool.map((p) => Object.assign({}, p, { minutes: 0 })))).length === 0,
    'a pre-season squad produces no benchmarks at all');
  ok(core.oopFlag({ element_type: 3, minutes: M + 100, expected_goals_per_90: '0.9' }, {}) === null,
    'and with no benchmarks nothing is flagged');
  ok(Object.keys(core.oopBenchmarks([])).length === 0, 'an empty league is safe');
  ok(core.oopFlag(null, marks) === null && core.oopFlag({ element_type: 3, minutes: 9999 }, null) === null,
    'missing inputs do not throw');

  /* A thin group cannot describe a distribution — a percentile over four
     players is an ordering, not a tail. */
  const thin = core.oopBenchmarks(pool.filter((p) => p.element_type !== 4).concat(
    [{ id: 900, element_type: 4, minutes: M + 1, expected_goals_per_90: '0.5' }]));
  ok(thin[4] === undefined, 'a group with too few players sets no benchmark');
  ok(core.OOP_MIN_POOL >= 8, 'and the floor is a real sample (' + core.OOP_MIN_POOL + ')');

  /* The quantile itself, since everything above rests on it. */
  const q = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  ok(core.oopQuantile(q, 0) === 0 && core.oopQuantile(q, 1) === 10, 'quantile spans the range');
  ok(core.oopQuantile(q, 0.5) === 5, 'the median is the middle');
  ok(Math.abs(core.oopQuantile(q, 0.85) - 8.5) < 1e-9, 'and it interpolates between points');
  ok(core.oopQuantile([], 0.5) === null && core.oopQuantile([4], 0.9) === 4, 'degenerate inputs are safe');

  /* Non-penalty threat is preferred when Core Insights has it: penalties are
     a duty, not evidence of where a player plays. */
  const penTaker = { element_type: 3, minutes: M + 100, expected_goals_per_90: '0.60', _ci: { np_xg_per_90: 0.10 } };
  ok(core.oopThreat(penTaker) === 0.10, 'non-penalty xG is used when available');
  ok(core.oopFlag(penTaker, marks) === null, 'so a penalty taker is not mistaken for a striker');
}

section('setPieceByClub: the club is the row, the duty is the column (Tier 2)');
{
  const p = (id, team, name, pen, fk, ck) => ({
    id, team, web_name: name, element_type: 3,
    penalties_order: pen, direct_freekicks_order: fk, corners_and_indirect_freekicks_order: ck,
  });
  const b = {
    teams: { 1: { short_name: 'BOU' }, 2: { short_name: 'ARS' }, 3: { short_name: 'FUL' } },
    elements: [
      p(1, 1, 'Kluivert', 1, 3, null), p(2, 1, 'Kroupi', 2, null, null), p(3, 1, 'Tavernier', 3, 2, 1),
      p(4, 2, 'Saka', 1, 2, 2), p(5, 2, 'Rice', null, 1, 1),
      p(6, 3, 'Robinson', 1, null, null),
      p(7, 3, 'NoDuty', null, null, null),
    ],
  };
  const by = core.setPieceByClub(b);
  ok(by[1] && by[1].pen.length === 3, 'the whole penalty hierarchy is kept, not just the first two');
  ok(by[1].pen.map((x) => x.el.web_name).join() === 'Kluivert,Kroupi,Tavernier', 'and it comes back in order');
  ok(by[1].ck.length === 1 && by[1].ck[0].el.web_name === 'Tavernier', 'each duty is separate');
  ok(by[2].fk.map((x) => x.el.web_name).join() === 'Rice,Saka', 'a different duty can have a different first choice');

  /* A player on no duty is not a set-piece taker. */
  ok(!Object.keys(by).some((t) => by[t].pen.concat(by[t].fk, by[t].ck).some((x) => x.el.web_name === 'NoDuty')),
    'a player with no designation appears nowhere');

  /* Rows: clubs with nothing are omitted, not printed as three dashes. */
  const rows = core.setPieceClubRows(b);
  ok(rows.length === 3, 'every club with any designation gets a row');
  ok(rows[0].team === 2 && rows[1].team === 1, 'rows are in club-name order (ARS, BOU, FUL)');
  const empty = core.setPieceClubRows({ teams: b.teams, elements: [p(9, 1, 'Nobody', null, null, null)] });
  ok(empty.length === 0, 'a league with no designations produces no rows at all');

  /* The cap keeps a long tail out of the grid. */
  const capped = core.setPieceByClub(b, 2);
  ok(capped[1].pen.length === 2, 'the per-duty cap trims the tail');
  ok(capped[1].pen.map((x) => x.el.web_name).join() === 'Kluivert,Kroupi', 'keeping the top of the order');

  ok(Object.keys(core.setPieceByClub({ elements: [] })).length === 0, 'an empty squad is safe');
  ok(Object.keys(core.setPieceByClub({})).length === 0 && Object.keys(core.setPieceByClub(null)).length === 0,
    'missing input does not throw');
  ok(Object.keys(core.setPieceByClub({ elements: [null, undefined] })).length === 0, 'holes are ignored');
}

section('rotationChain: one slot, many clubs, transfers cost something (Tier 2)');
{
  const cands = (teams) => teams.map((t) => ({ id: t * 10, team: t, cost: 45 }));

  /* Brute force every possible sequence of clubs over the horizon and score
     it the same way, so "optimal" is a claim we can actually check rather
     than assert. Exponential, hence tiny cases only. */
  const brute = (teams, diff, sw) => {
    const N = Math.min(...teams.map((t) => diff[t].length));
    let best = null;
    const walk = (g, path, total) => {
      if (g === N) { if (!best || total < best.total - 1e-9) best = { total, path: path.slice() }; return; }
      for (const t of teams) {
        const step = diff[t][g] + (g > 0 && path[g - 1] !== t ? sw : 0);
        walk(g + 1, path.concat([t]), total + step);
      }
    };
    walk(0, [], 0);
    return best;
  };
  const totalOf = (r, diff, sw) =>
    r.path.reduce((s, t, g) => s + diff[t][g] + (g > 0 && r.path[g - 1] !== t ? sw : 0), 0);

  /* A planted chain: club 1 is green early, club 2 green in the middle,
     club 3 green late — exactly the shape the creator graphics show. */
  const diff = { 1: [1, 1, 5, 5, 5, 5], 2: [5, 5, 1, 1, 5, 5], 3: [5, 5, 5, 5, 1, 1] };
  const teams = [1, 2, 3];
  const r = core.rotationChain(cands(teams), diff, { switchCost: 1 });
  ok(r != null, 'a chain is found');
  ok(r.path.join() === '1,1,2,2,3,3', 'it walks the planted chain (' + r.path.join() + ')');
  ok(r.blocks.length === 3 && r.switches === 2, 'compressed into three blocks with two switches');
  ok(r.blocks[0].weeks === 2 && r.blocks[0].team === 1, 'each block records its club and length');
  ok(r.green === 6, 'and every week of the horizon is covered green');
  ok(r.teams.join() === '1,2,3', 'the chain is whichever clubs the path visits');

  /* The claim, checked: matches exhaustive search. */
  for (const sw of [0, 0.5, 1, 2, 5]) {
    const got = core.rotationChain(cands(teams), diff, { switchCost: sw });
    const bf = brute(teams, diff, sw);
    ok(Math.abs(totalOf(got, diff, sw) - bf.total) < 1e-9,
      'matches brute force at switch cost ' + sw);
  }

  /* The switch cost is what controls chain length, and that must be visible. */
  const cheap = core.rotationChain(cands(teams), diff, { switchCost: 0 });
  const dear = core.rotationChain(cands(teams), diff, { switchCost: 50 });
  ok(dear.switches === 0, 'an expensive transfer means never switching at all');
  ok(dear.teams.length === 1, 'so the chain collapses to a single club');
  ok(cheap.switches >= dear.switches, 'and a free transfer switches at least as often');

  /* Ties must prefer staying: an equal-cost plan with fewer transfers is
     strictly better in a game where transfers are the scarce resource. */
  const flat = { 1: [3, 3, 3, 3], 2: [3, 3, 3, 3] };
  const t = core.rotationChain(cands([1, 2]), flat, { switchCost: 0 });
  ok(t.switches === 0, 'identical clubs never switch, even when switching is free');
  /* The case that actually exercises the tie-break, on the path that gets
     chosen: holding club 2 throughout costs 3 + 0 = 3, and starting on club 1
     then paying a transfer costs 1 + 2 + 0 = 3 as well. Dead level, so only
     an explicit preference for staying avoids spending a transfer to buy
     nothing at all. */
  const tie = core.rotationChain(cands([1, 2]), { 1: [1, 3], 2: [3, 0] }, { switchCost: 2 });
  ok(tie.switches === 0, 'a tie is settled by NOT spending a transfer');
  ok(tie.path.join() === '2,2', 'so the plan holds one club rather than churning (' + tie.path.join() + ')');

  /* One candidate per club, and the cheapest one — a rotation slot is a
     budget slot. */
  /* Cheapest FIRST in the list, so "keep the last one seen" would pick the
     expensive player and the assertion below would catch it. */
  const dup = core.rotationChain(
    [{ id: 2, team: 1, cost: 45 }, { id: 1, team: 1, cost: 70 }, { id: 3, team: 2, cost: 50 }],
    { 1: [1, 1, 5, 5], 2: [5, 5, 1, 1] }, { switchCost: 1 });
  ok(dup.blocks[0].player.cost === 45, 'the cheapest player at a club represents it');
  ok(dup.minCost === 45 && dup.maxCost === 50, 'the price range of the chain is reported');

  /* Horizons of different length: the shortest club array bounds the run. */
  const ragged = core.rotationChain(cands([1, 2]), { 1: [1, 1, 1, 1, 1], 2: [5, 5] }, { switchCost: 1 });
  ok(ragged.n === 2, 'the horizon is the shortest club history available');

  /* Degenerate inputs return null rather than a misleading empty chain. */
  ok(core.rotationChain(cands([1]), { 1: [1, 2, 3] }) === null, 'one club is not a rotation');
  ok(core.rotationChain([], diff) === null && core.rotationChain(null, diff) === null, 'no candidates, no chain');
  ok(core.rotationChain(cands(teams), null) === null, 'no fixture difficulty, no chain');
  ok(core.rotationChain(cands([1, 2]), { 1: [1], 2: [1] }) === null, 'a single gameweek is not a rotation');
  ok(core.rotationChain([null, undefined].concat(cands(teams)), diff, { switchCost: 1 }).teams.length === 3,
    'holes in the candidate list are ignored');
  /* A club with no fixture data cannot be part of a chain. */
  ok(core.rotationChain(cands([1, 2, 9]), diff, { switchCost: 1 }).teams.indexOf(9) < 0,
    'a club with no difficulty array is left out');
}

section('clubSplit / clubVenueVerdict: is this club a different side at home? (Tier 2)');
{
  const fx = (team_h, team_a, hs, as_, finished) => ({ team_h, team_a, team_h_score: hs, team_a_score: as_, finished: finished !== false });
  /* Club 1: strong at home, poor away — the Brentford shape. */
  const games = [];
  for (let i = 0; i < 5; i++) games.push(fx(1, 2 + i, 3, 0));       // home: 3-0
  for (let i = 0; i < 5; i++) games.push(fx(2 + i, 1, 2, 1));       // away: lose 2-1
  const sp = core.clubSplit(games, 1);
  ok(sp.home.games === 5 && sp.away.games === 5, 'both venues are counted');
  ok(sp.home.gf === 15 && sp.home.ga === 0, 'home goals for and against are from the club\'s point of view');
  ok(sp.away.gf === 5 && sp.away.ga === 10, 'and flip correctly when the club is the away side');
  ok(sp.home.cs === 5 && sp.away.cs === 0, 'clean sheets are counted per venue');
  ok(Math.abs(sp.home.gfpg - 3) < 1e-9 && Math.abs(sp.away.gapg - 2) < 1e-9, 'per-game rates are right');

  const v = core.clubVenueVerdict(sp);
  ok(v.attack === 'home' && v.defence === 'home', 'a home-heavy side is called as one');
  ok(v.attGap > 0 && v.defGap > 0, 'and the size of each gap comes with it');

  /* A side that travels identically must read as level, not be forced into
     a verdict — most clubs are not Brentford. */
  const evenGames = [];
  for (let i = 0; i < 5; i++) { evenGames.push(fx(1, 2 + i, 2, 1)); evenGames.push(fx(2 + i, 1, 1, 2)); }
  const ev = core.clubVenueVerdict(core.clubSplit(evenGames, 1));
  ok(ev.attack === 'level' && ev.defence === 'level', 'a club that travels well reads level');

  /* The two reads are independent: a club can attack differently by venue
     while conceding the same everywhere. */
  const mixed = [];
  for (let i = 0; i < 5; i++) { mixed.push(fx(1, 2 + i, 3, 1)); mixed.push(fx(2 + i, 1, 1, 1)); }
  const mx = core.clubVenueVerdict(core.clubSplit(mixed, 1));
  ok(mx.attack === 'home' && mx.defence === 'level', 'attack and defence are judged separately');

  /* Sample size: four games at a venue is not a home record. */
  const thin = games.slice(0, 3).concat(games.slice(5, 8));
  ok(core.clubVenueVerdict(core.clubSplit(thin, 1)) === null, 'too few games at each venue means no verdict');
  ok(core.clubVenueVerdict(core.clubSplit([], 1)) === null, 'and a club with no games has none either');
  ok(core.clubVenueVerdict(null) === null, 'a missing split does not throw');

  /* Unplayed and malformed fixtures must not leak into the record. */
  const withFuture = games.concat([fx(1, 9, null, null, false), { team_h: 1, team_a: 9, finished: true }]);
  ok(core.clubSplit(withFuture, 1).games === 10, 'unplayed and score-less fixtures are ignored');
  ok(core.clubSplit([null, undefined], 1).games === 0, 'holes in the fixture list are safe');
  ok(core.clubSplit(games, 99).games === 0, 'a club that played none of these games has an empty record');
}

section('clubVsPoorAttacks: does a kind fixture actually become a clean sheet? (Tier 2)');
{
  /* The line this exists for, from a rival's Man Utd thread: "only 2 clean
     sheets vs weak sides, so if the defenders return nothing at Hull and
     Ipswich it is not bad luck". A fixture ticker cannot say that — it grades
     the opponent, not whether this defence converts one. */
  const R = { att: {}, def: {} };
  for (let i = 1; i <= 20; i++) { R.att[i] = 0.5 + i * 0.05; R.def[i] = 1; }
  const weak = core.poorAttacks(R);
  ok(weak instanceof Set && weak.size === 10, 'the bottom half of attacks is exactly half the league');
  ok(weak.has(1) && weak.has(10), 'the weakest attacks are in it');
  ok(!weak.has(11) && !weak.has(20), 'the strongest are not');
  ok([...weak].every((x) => typeof x === 'number'),
    'ids come back as numbers — the ratings are keyed by string, the fixtures are not');

  /* Team 1 plays opponents 2..11; it keeps two clean sheets. Only 2..10 are
     weak, so nine of the ten matches count. */
  const fx = [];
  for (let i = 0; i < 10; i++) {
    fx.push({ finished: true, team_h: 1, team_a: i + 2, team_h_score: 2, team_a_score: i < 2 ? 0 : 1 });
  }
  const v = core.clubVsPoorAttacks(fx, 1, weak);
  ok(v && v.games === 9, 'only matches against weak attacks count (' + (v && v.games) + ')');
  ok(v.cs === 2, 'two clean sheets, as played');
  ok(Math.abs(v.csr - 2 / 9) < 1e-9, 'and the rate is over those games, not the whole season');
  ok(v.gf === 18 && v.ga === 7, 'goals for and against are the club’s own way round');

  const away = [{ finished: true, team_h: 3, team_a: 1, team_h_score: 0, team_a_score: 4 }];
  const both = core.clubVsPoorAttacks(fx.concat(away), 1, weak);
  ok(both.games === 10 && both.cs === 3, 'an away clean sheet counts too');
  ok(both.gf === 22 && both.ga === 7, 'and away goals are not read off the wrong side');

  /* The guard that matters. A clean-sheet percentage off three games is noise
     wearing a number's clothes, and printed in a thread it reads as evidence. */
  ok(core.OPP_SPLIT_MIN === 5, 'the minimum sample is five matches');
  ok(core.clubVsPoorAttacks(fx.slice(0, 4), 1, weak) === null, 'four matches is not a finding');
  ok(core.clubVsPoorAttacks(fx.slice(0, 5), 1, weak) !== null, 'five is');
  ok(core.clubVsPoorAttacks(fx, 1, null) === null, 'and no ratings means no claim at all');
  ok(core.clubVsPoorAttacks(fx, 1, new Set()) === null, 'nor does an empty weak set');

  /* Unplayed fixtures must not dilute the rate — this is read mid-season and
     the fixture list carries the whole of it. */
  const withFuture = fx.concat([{ finished: false, team_h: 1, team_a: 2, team_h_score: null, team_a_score: null }]);
  ok(core.clubVsPoorAttacks(withFuture, 1, weak).games === 9, 'unplayed fixtures are ignored');
  ok(core.poorAttacks({ att: { 1: 1, 2: 1 } }) === null, 'too few clubs rated means no split');
  ok(core.poorAttacks(null) === null, 'and no ratings at all is safe');
}

section('clubLean: which end of this club is worth buying (Tier 2)');
{
  /* Four clubs: 1 all attack, 2 all defence, 3 good at both, 4 poor at both. */
  const R = {
    att: { 1: 1.40, 2: 0.80, 3: 1.35, 4: 0.75 },
    def: { 1: 1.30, 2: 0.70, 3: 0.75, 4: 1.35 },
  };
  ok(core.clubLean(R, 1).lean === 'attack', 'a side that rates far higher going forward says buy the attack');
  ok(core.clubLean(R, 2).lean === 'defence', 'and one that rates higher at the back says buy the defence');
  ok(core.clubLean(R, 3).lean === 'balanced' && core.clubLean(R, 3).grade === 'both',
    'a side strong at both ends is balanced AND strong — a very different message');
  ok(core.clubLean(R, 4).grade === 'neither', 'and one weak at both is called that, not just "balanced"');
  ok(core.clubLean(R, 1).attPct > core.clubLean(R, 2).attPct, 'percentiles order the league correctly');
  /* A LOWER defence multiplier is a better defence — the inversion is the
     easy thing to get backwards. */
  ok(core.clubLean(R, 2).defPct > core.clubLean(R, 1).defPct,
    'a lower defence multiplier ranks as the better defence');

  ok(core.clubLean(R, 99) === null, 'a club with no rating has no lean');
  ok(core.clubLean(null, 1) === null && core.clubLean({}, 1) === null, 'missing ratings do not throw');
  ok(core.clubLean({ att: { 1: 1, 2: 1 }, def: { 1: 1, 2: 1 } }, 1) === null,
    'a league too small to rank against gives no verdict');
}

section('bundleSeasonStale: model-bundle vs live season cross-check (Tier 2)');
/* Pre-season the bundle intentionally trails (last completed season), so no
   warning; once games are played a trailing bundle IS stale. */
ok(core.bundleSeasonStale('2026/27', false, '2025/26') === false, 'pre-season (no games): bundle behind is expected, not stale');
ok(core.bundleSeasonStale('2026/27', true, '2025/26') === true, 'season started but bundle still last season -> stale');
ok(core.bundleSeasonStale('2026/27', true, '2026/27') === false, 'season started and bundle caught up -> fresh');
ok(core.bundleSeasonStale('', true, '2025/26') === false && core.bundleSeasonStale('2026/27', true, '') === false, 'unknown season or missing bundle label -> never warn');

section('pre-season bootstrap: all-zeros end to end (Tier 4)');
/* The load-bearing pre-season state the recon flagged as untested: every
   player minutes=0, form=0, ownership forming. nativeXP is gated off below
   5 games, so xP leans entirely on FPL's provisional ep_next. These lock
   that the model degrades gracefully (finite, no crash, sensible empties). */
const preEl = (id, t, own, epNext) => ({
  id, element_type: t, team: id, web_name: 'P' + id, status: 'a',
  minutes: 0, starts: 0, form: '0.0', points_per_game: '0.0',
  ep_next: String(epNext == null ? 0 : epNext),
  expected_goals_per_90: '0', expected_assists_per_90: '0',
  chance_of_playing_next_round: null, now_cost: 60,
  selected_by_percent: String(own)
});
const preNf = { gp: 0 };                       /* no games played yet */
/* nativeXP is null pre-season (0 games), so the native blend never engages. */
ok(core.nativeXP(preEl(1, 3, 5, 0), preNf) === null, 'nativeXP is null pre-season (0 games played)');
/* Cold player with a zero ep_next -> xP is a finite 0, never NaN. */
const xpCold = core.xP({}, preEl(1, 3, 0, 0), preNf);
ok(Number.isFinite(xpCold) && xpCold === 0, 'a fully-cold player (ep_next 0) yields a finite xP of 0, not NaN');
/* With ep_next populated (FPL usually seeds it pre-season), xP tracks it and
   orders players — so the boards are not flat. */
const xpSeed = core.xP({}, preEl(2, 3, 5, 4.5), preNf);
ok(Number.isFinite(xpSeed) && xpSeed > 0, 'a provisional ep_next drives a positive, finite pre-season xP');
ok(xpSeed > xpCold, 'ep_next differences order players pre-season (boards are not flat)');
/* Realistic pre-season nf (buildNextFix always sets diff, from plsimDiff or
   FPL): an easy opener still lifts xP over a hard one, no NaN. */
const xpEasy = core.xP({}, preEl(3, 3, 5, 4.5), { gp: 0, diff: 2 });
const xpHard = core.xP({}, preEl(3, 3, 5, 4.5), { gp: 0, diff: 5 });
ok(Number.isFinite(xpEasy) && Number.isFinite(xpHard) && xpEasy > xpHard, 'fixture difficulty still tilts xP pre-season (easy opener > hard)');
ok(Number.isFinite(core.xP({}, preEl(4, 3, 5, 4.5), undefined)), 'a player with no upcoming fixture (undefined nf) still yields a finite xP');
/* captainModel over an all-zero-xP pool degrades to no pick, not a crash. */
const flatPool = [preEl(1, 3, 5, 0), preEl(2, 4, 3, 0), preEl(3, 3, 8, 0)];
ok(core.captainModel({}, {}, flatPool, 3).picks.length === 0, 'captainModel returns no pick when every xP is 0 (graceful, not a crash)');
/* With provisional ep_next it still ranks. */
const seedPool = [preEl(1, 3, 5, 3.0), preEl(2, 4, 3, 6.0), preEl(3, 3, 8, 4.0)];
const preCap = core.captainModel({}, {}, seedPool, 3);
ok(preCap.picks.length === 3 && preCap.picks[0].el.id === 2, 'captainModel ranks on provisional ep_next when present');
/* Differentials pre-season: 0%-owned non-premium players ARE included (nobody
   has picked yet), premiums excluded, and a missing ownership figure is not. */
const preElements = [
  preEl(1, 3, 0, 3),                              /* 0% owned -> included */
  Object.assign(preEl(2, 4, 5, 4), { now_cost: 140 }),  /* premium -> excluded */
  Object.assign(preEl(3, 3, 8, 2), { selected_by_percent: 'x' }), /* no figure -> excluded */
  preEl(4, 2, 12, 1)                              /* under 15% -> included */
];
const preDiffs = core.differentials(preElements, 15).map(e => e.id).sort();
ok(preDiffs.join(',') === '1,4', 'pre-season differentials include 0%-owned non-premiums, exclude premiums and no-ownership rows');

/* ── clubDepth: who is competing for the same shirt ─────── */
section('clubDepth — pecking order, contests and the unrankable');
/* gp = 10, so minutesSecurity = 100*(0.65*starts/10 + 0.35*mins/900). */
const mkDepth = (id, pos, starts, mins, extra) => Object.assign(
  { id, team: 1, element_type: pos, status: 'a', web_name: 'P' + id, now_cost: 45, starts, minutes: mins },
  extra || {});
const depthPool = [
  mkDepth(1, 2, 10, 900),   /* 100 */
  mkDepth(2, 2, 9, 810),    /*  90 — 10 behind, a contest */
  mkDepth(3, 2, 5, 450),    /*  50 — 40 behind, clear of the contest */
  mkDepth(4, 2, 2, 180),    /*  20 — under the fringe, not in the conversation */
  mkDepth(5, 3, 10, 900),   /* 100 */
  mkDepth(6, 3, 5, 450),    /*  50 — 50 behind, so the shirt is settled */
  mkDepth(7, 3, 0, 0),      /* no minutes at all — unrankable, not fringe */
  mkDepth(8, 3, 10, 900, { status: 'u' }),         /* left the club */
  mkDepth(10, 3, 0, 0, { status: 'u' }),           /* left, and never played */
  mkDepth(9, 2, 10, 900, { team: 2 })              /* another club entirely */
];
const dep = core.clubDepth(depthPool, 1, 10);
ok(dep[2].rows.map(r => r.e.id).join(',') === '1,2,3', 'defenders rank by minutes security, fringe player dropped');
ok(dep[2].rows.every(r => r.sec >= core.DEPTH_FRINGE), 'no ranked row sits below the fringe threshold');
ok(dep[2].settled === false, 'a 10-point lead is not a settled shirt');
ok(dep[2].rows[0].tied === true && dep[2].rows[1].tied === true, 'both halves of a contest are marked, not just the lower one');
ok(dep[2].rows[2].tied === false, 'the man 40 points adrift is not part of the contest');
ok(dep[3].settled === true && dep[3].rows[0].tied === false, 'a 50-point lead is a settled shirt');
ok(dep[3].unranked.map(e => e.id).join(',') === '7', 'a player with no minutes is listed as unrankable, not ranked last');
ok(dep[3].rows.every(r => r.e.id !== 7), 'the unrankable player is kept out of the ranking');
/* A departed player with no minutes must not surface as "one to watch" — the
   unranked list is the only place he could slip through. */
ok(!dep[3].unranked.some(e => e.id === 10), 'a player who has left the club never reaches the unranked list');
ok(!dep[2].rows.some(r => r.e.id === 9) && !dep[3].rows.some(r => r.e.id === 8),
  'another club and a departed player are both excluded');
ok(dep[1] === undefined && dep[4] === undefined, 'positions with nobody at all are absent, not empty groups');
/* A contest can sit BELOW a clear leader — the tie check has to look both
   ways, or the middle of the table reads as settled. */
const midPool = [mkDepth(1, 2, 10, 900), mkDepth(2, 2, 6, 540), mkDepth(3, 2, 5, 579), mkDepth(4, 2, 2, 180)];
const midDep = core.clubDepth(midPool, 1, 10);
ok(midDep[2].settled === true, 'leader 40 clear reads as settled');
ok(midDep[2].rows[0].tied === false && midDep[2].rows[1].tied === true && midDep[2].rows[2].tied === true,
  'a contest below a clear leader is marked on both players');
/* The list is capped so a 30-man squad does not become the panel. */
const bigPool = Array.from({ length: 9 }, (_, i) => mkDepth(i + 1, 2, 10 - i * 0.5, 900 - i * 45));
ok(core.clubDepth(bigPool, 1, 10)[2].rows.length === core.DEPTH_MAX,
  'the ranking is capped at DEPTH_MAX per position');
ok(Object.keys(core.clubDepth([], 1, 10)).length === 0, 'an empty squad yields no groups rather than throwing');

/* ── Venue split: what a projection owes to the venue ────────
   The Players table's home/away lens. Every property here is about NOT
   overclaiming: it is a per-game rate rather than a total, and a side with no
   fixtures is unknown rather than zero. */
{
  console.log('\n• venue split');
  /* Pre-season shape — no games played, so nativeXP declines and fixtureXP
     takes its documented fallback: ep_next scaled by the fixture. That makes
     the arithmetic below exact rather than approximate. */
  const b = {};
  const fwd = { id: 1, team: 1, element_type: 4, ep_next: '5.0' };
  const fx = (home, lam) => ({ home, lam, cs: 0.3, gp: 0, lamAvg: 1.47 });
  /* lam 1.47 is the league average, so the fixture factor is exactly 1. */
  const flat = (home) => fx(home, 1.47);

  /* A total would make four home games look better than one away game at the
     same quality. A per-game rate must not. */
  const lopsided = core.venueSplit(b, fwd,
    { 1: [flat(true), flat(true), flat(true), flat(true), flat(false)] });
  ok(lopsided.hN === 4 && lopsided.aN === 1, 'the counts are kept (' + lopsided.hN + 'H/' + lopsided.aN + 'A)');
  ok(Math.abs(lopsided.h - 5) < 1e-9, 'four identical home games average to one game (' + lopsided.h + ')');
  ok(Math.abs(lopsided.a - 5) < 1e-9, 'and the single away game to the same');
  ok(Math.abs(lopsided.swing) < 1e-9, 'so four home to one away is a swing of zero, not a home bias');

  /* A real difference still shows. A kinder home fixture raises the home rate
     and the swing goes positive. */
  const kind = core.venueSplit(b, fwd, { 1: [fx(true, 2.2), fx(false, 1.0)] });
  ok(kind.h > kind.a, 'a better home fixture reads as a better home rate');
  ok(kind.swing > 0, 'and the swing is positive');
  const harsh = core.venueSplit(b, fwd, { 1: [fx(true, 1.0), fx(false, 2.2)] });
  ok(harsh.swing < 0, 'reversed, the same player travels better');
  ok(Math.abs(harsh.swing + kind.swing) < 1e-9, 'and the two are mirror images');

  /* The refusals. A player with no away game has no away rate; a zero there
     would rank him the worst traveller in the league. */
  const allHome = core.venueSplit(b, fwd, { 1: [flat(true), flat(true)] });
  ok(allHome.a === null, 'no away fixture means no away rate — null, not zero');
  ok(allHome.swing === null, 'and no swing to report');
  ok(allHome.h != null && allHome.aN === 0, 'while the home side is still given');
  const allAway = core.venueSplit(b, fwd, { 1: [flat(false)] });
  ok(allAway.h === null && allAway.swing === null, 'and the same the other way round');

  /* A team with no horizon at all, and a horizon that does not mention this
     player's team. Both are "unknown", not "zero". */
  ok(core.venueSplit(b, fwd, {}).h === null, 'an empty horizon yields nothing');
  ok(core.venueSplit(b, fwd, { 2: [flat(true)] }).swing === null, 'nor does another team’s run');
  ok(core.venueSplit(b, fwd, null).swing === null, 'a missing horizon does not throw');

  /* A fixture whose expected points cannot be computed is skipped rather than
     counted as zero, which would drag the rate down and misreport the sample
     size behind it. */
  const broken = { id: 2, team: 1, element_type: 4, ep_next: '', form: 'x', points_per_game: 'x' };
  const skipped = core.venueSplit(b, broken, { 1: [flat(true), flat(false)] });
  ok(skipped.hN === 0 && skipped.aN === 0, 'an uncomputable fixture is not counted');
  ok(skipped.h === null && skipped.a === null, 'and contributes no rate');

  /* Defenders take the clean-sheet branch rather than the goals one, so the
     split has to work for them too — they are the whole point of the lens. */
  const def = { id: 3, team: 1, element_type: 2, ep_next: '4.0' };
  const dsplit = core.venueSplit(b, def,
    { 1: [{ home: true, lam: 1.2, cs: 0.55, gp: 0 }, { home: false, lam: 1.6, cs: 0.18, gp: 0 }] });
  ok(dsplit.h > dsplit.a, 'a defender with better clean-sheet odds at home reads that way');
  ok(dsplit.swing > 0, 'and carries a positive swing');
}

/* ── Value against the price curve ───────────────────────────
   The Players table's value scatter. The property that carries the whole
   feature is that the fit is PER POSITION: a single line through defenders and
   midfielders together measures the position tariff, not value, and would rank
   every cheap defender as a bargain. */
{
  console.log('\n• value curve');
  const line = (n, m, c, from) => Array.from({ length: n },
    (_, i) => ({ x: (from || 4) + i * 0.5, y: m * ((from || 4) + i * 0.5) + c }));

  /* Exact recovery on a perfect line — if this drifts, every residual is
     wrong by a constant nobody would notice. */
  const f = core.valueFit(line(8, 1.5, 2));
  ok(f && Math.abs(f.m - 1.5) < 1e-9, 'the slope is recovered exactly (' + (f && f.m) + ')');
  ok(Math.abs(f.c - 2) < 1e-9, 'and so is the intercept');
  ok(f.n === 8, 'the sample size is carried');

  /* The refusals. */
  ok(core.valueFit(line(core.VALUE_MIN_FIT - 1, 1, 0)) === null,
    'under ' + core.VALUE_MIN_FIT + ' players there is no curve to fit');
  ok(core.valueFit(line(core.VALUE_MIN_FIT, 1, 0)) !== null, 'at the floor there is');
  ok(core.valueFit(Array.from({ length: 9 }, (_, i) => ({ x: 5, y: i }))) === null,
    'a pool all on one price has no slope — null, not infinity');
  ok(core.valueFit([]) === null && core.valueFit(null) === null, 'and nothing at all is null');

  /* Residual sign. Above the line is positive, which is the direction the
     chart's whole reading depends on. */
  const pts = line(8, 1.0, 0);
  const fit = core.valueFit(pts);
  const resid = (x, y) => y - (fit.m * x + fit.c);
  ok(resid(6, 8) > 0, 'a player above the curve reads positive');
  ok(resid(6, 4) < 0, 'and one below it negative');

  /* ── the per-position property ──
     Two positions with genuinely different price curves. Defenders here return
     less per pound than midfielders — the real tariff difference. A defender
     sitting exactly on the DEFENDER curve is fairly priced, and must read as
     such; measured against a pooled line he would look like a bargain. */
  const el = (id, type, cost, y) => ({ id, element_type: type, now_cost: cost * 10, _y: y });
  const defs = [], mids = [];
  for (let i = 0; i < 8; i++) {
    const price = 4 + i * 0.5;
    defs.push(el(100 + i, 2, price, 1.0 * price));   /* defender curve: y = 1.0x */
    mids.push(el(200 + i, 3, price, 2.0 * price));   /* midfielder curve: y = 2.0x */
  }
  const all = defs.concat(mids);
  const r = core.valueResiduals(all, (e) => e._y);
  ok(r.fits[2] && Math.abs(r.fits[2].m - 1.0) < 1e-9, 'the defender curve is fitted alone (' + r.fits[2].m.toFixed(2) + ')');
  ok(r.fits[3] && Math.abs(r.fits[3].m - 2.0) < 1e-9, 'and the midfielder curve separately (' + r.fits[3].m.toFixed(2) + ')');
  ok(r.points.length === 16, 'every player is plotted');
  ok(r.points.every((p) => Math.abs(p.resid) < 1e-9),
    'a player exactly on his OWN position’s curve has no residual — the whole point');
  /* And the counterfactual: pooled, the same defenders would look mispriced.
     This is the bug the split exists to prevent, asserted rather than assumed. */
  const pooled = core.valueFit(all.map((e) => ({ x: (e.now_cost || 0) / 10, y: e._y })));
  const pooledResid = (e) => e._y - (pooled.m * ((e.now_cost || 0) / 10) + pooled.c);
  ok(Math.abs(pooledResid(defs[7])) > 1, 'pooled, a fairly-priced defender reads as badly off the line');
  ok(pooledResid(defs[7]) < 0 && pooledResid(mids[7]) > 0,
    'and the pooled reading is a position tariff, not value — every top defender low, every top mid high');

  /* A position too thin to fit still shows its players, with no residual —
     they are real, and hiding them would misrepresent the pool. */
  const thin = core.valueResiduals(defs.concat([el(300, 1, 4.5, 3), el(301, 1, 5.0, 4)]), (e) => e._y);
  ok(thin.fits[1] === null, 'two goalkeepers give no curve');
  const gks = thin.points.filter((p) => p.pos === 1);
  ok(gks.length === 2, 'but they are still plotted');
  ok(gks.every((p) => p.resid === null), 'with a null residual rather than one from a line nobody drew');

  /* A player whose projection cannot be computed is left out entirely, rather
     than dragging the curve down towards zero. */
  const withBad = core.valueResiduals(defs.concat([el(400, 2, 6.0, null), el(401, 2, 6.5, NaN)]),
    (e) => e._y);
  ok(withBad.points.length === 8, 'an uncomputable projection is not plotted (' + withBad.points.length + ')');
  ok(Math.abs(withBad.fits[2].m - 1.0) < 1e-9, 'and does not move the curve');
}

/* ── palette search ranking (Fuse.js) ───────────────────── */
section('palette: the weights put a name match above a description match');
{
  /* The ordering the brief asks for and the reason it matters. "captain"
     appears in the Captain panel's NAME and in several other panels'
     descriptions. Before the weights, those ranked together. */
  const entries = [
    { name: 'Captain', aliases: ['captain'], desc: 'Decisions', base: 1, label: 'Captain' },
    { name: 'Transfers', aliases: ['transfers'], desc: 'Captain and transfer planning', base: 1, label: 'Transfers' },
    { name: 'Chips', aliases: ['chips'], desc: 'When to play your captain chip', base: 1, label: 'Chips' }
  ];
  const r = core.cmdkSearch(entries, 'captain', Fuse);
  ok(r.length > 0, 'a query returns matches');
  const ranked = r.slice().sort((a, b) => b.score - a.score);
  ok(ranked[0].name === 'Captain', 'the panel NAMED Captain ranks first (' + ranked[0].name + ')');
  const cap = r.find((x) => x.name === 'Captain');
  const desc = r.find((x) => x.name === 'Chips');
  ok(!desc || cap.score > desc.score, 'and outranks a panel that only mentions it in its description');

  /* The weights themselves, asserted rather than assumed: a later edit that
     reorders them would still pass the ranking test above by luck. */
  const byKey = Object.fromEntries(core.CMDK_KEYS.map((k) => [k.name, k.weight]));
  ok(byKey.name > byKey.aliases, 'name outweighs aliases');
  ok(byKey.aliases > byKey.desc, 'aliases outweigh description');
}

section('palette: a typo still finds the command');
{
  /* The reason Fuse is here at all. The scorer it replaced was
     prefix / substring / subsequence, and "captian" is none of those
     against "Captain" — it scored zero and the palette said "No matches". */
  const entries = [
    { name: 'Captain', aliases: [], desc: 'Decisions', base: 1 },
    { name: 'Fixtures', aliases: [], desc: 'Planning', base: 1 }
  ];
  const typo = core.cmdkSearch(entries, 'captian', Fuse);
  ok(typo.some((x) => x.name === 'Captain'), 'transposed letters still match');
  /* And a misspelt surname, which is the search people actually run. */
  const players = [
    { name: 'Haaland', aliases: ['Erling Haaland'], desc: 'Manchester City', base: 0 },
    { name: 'Saka', aliases: ['Bukayo Saka'], desc: 'Arsenal', base: 0 }
  ];
  ok(core.cmdkSearch(players, 'halland', Fuse).some((x) => x.name === 'Haaland'),
    'a misspelt player name still matches');
  /* Tolerance has a limit — otherwise every query matches everything and
     the ranking is noise. */
  ok(!core.cmdkSearch(players, 'zzzzzz', Fuse).some((x) => x.name === 'Haaland'),
    'but an unrelated query does not match');
}

section('palette: an empty query keeps the resting order, and mult breaks ties');
{
  const entries = [
    { name: 'Squad', aliases: [], desc: 'x', base: 1 },
    { name: 'Diffs', aliases: [], desc: 'x', base: 0.4 },
    { name: 'Theme', aliases: [], desc: 'x', base: 0.5 }
  ];
  const r = core.cmdkSearch(entries, '', Fuse).sort((a, b) => b.score - a.score);
  ok(r.length === 3, 'everything is offered with no query');
  ok(r[0].name === 'Squad' && r[2].name === 'Diffs',
    'panels above verbs above lenses, as before (' + r.map((x) => x.name).join(',') + ')');

  /* Two players matching a query equally well are separated by season
     points, which is what `mult` carries. */
  const two = [
    { name: 'Smith', aliases: [], desc: 'Club', base: 0, mult: 2 },
    { name: 'Smith', aliases: [], desc: 'Other', base: 0, mult: 1 }
  ];
  const s2 = core.cmdkSearch(two, 'smith', Fuse).sort((a, b) => b.score - a.score);
  ok(s2[0].mult === 2, 'the higher-scoring player wins an equal text match');
}

section('palette: the no-Fuse fallback still returns something usable');
{
  /* If vendor.js fails to load the palette must degrade to substring
     matching, not to an empty list. */
  const entries = [
    { name: 'Captain', aliases: [], desc: 'Decisions', base: 1 },
    { name: 'Fixtures', aliases: [], desc: 'Planning', base: 1 }
  ];
  const r = core.cmdkSearch(entries, 'capt', null);
  ok(r.some((x) => x.name === 'Captain'), 'a substring match survives with no Fuse');
  ok(!r.some((x) => x.name === 'Fixtures'), 'and an unrelated entry does not');
  ok(core.cmdkSearch(entries, 'captian', null).length === 0,
    'the fallback cannot do typos — which is exactly why Fuse is the default');
}

/* ── keyboard shortcut registration (tinykeys) ───────────── */
section('shortcuts: every chord is registered, and in an order that matters');
{
  /* These are read out of the shipped source rather than restated, so a
     chord deleted from index.html fails here instead of silently
     disappearing from the app. */
  const chords = html.match(/const G_CHORDS=\{[\s\S]*?\};/)[0];
  const pairs = [...chords.matchAll(/(\w):'(\w+)'/g)].map((m) => [m[1], m[2]]);
  const keys = pairs.map((p) => p[0]);
  ok(keys.length === 12, 'twelve chords defined (' + keys.length + ')');
  ok(new Set(keys).size === keys.length, 'and no key is bound twice');
  /* `h` for home was added when My Week became the landing panel. `d` stayed
     on Overview and `w` stayed on Watchlist, because silently repointing a
     chord someone has in their fingers is worse than a stale mnemonic. */
  const map = Object.fromEntries(pairs);
  ok(map.h === 'myweek', 'g h goes to My Week');
  ok(map.d === 'dashboard', 'g d still goes to Overview');
  ok(map.w === 'watchlist', 'g w still goes to the Watchlist');

  const init = html.slice(html.indexOf('function initKeys()'));
  const body = init.slice(0, init.indexOf('\nfunction '));
  ok(/kbdBind\(\{'\[Control\]\+Meta\+k'/.test(body), 'Ctrl+K is bound');
  ok(/'\[Meta\]\+Control\+k'/.test(body), 'and Meta+K, so both work on every platform');
  ok(/ignore:\(\)=>false/.test(body), 'the palette binding opts out of the ignore rule');
  /* Every chord is ONE sequence whose second press is a regex, and that is a
     correctness requirement rather than a tidiness one.

     Registering them as separate sequences plus a catch-all looked
     right and ran wrong: tinykeys stops at the first complete match, so a
     fired chord left the catch-all's pending state half-consumed and the
     next plain `j` inside the timeout matched it and was swallowed. A
     single always-completing binding cannot strand a sibling. This asserts
     the shape because the bug it prevents is invisible in a binding map —
     it took a real browser to see. */
  const gBinds = [...body.matchAll(/binds\[?'?\[Shift\]\+g /g)].length;
  ok(gBinds === 1, 'exactly one `g` sequence is registered (' + gBinds + ')');
  ok(/binds\['\[Shift\]\+g \[Shift\]\+\(\.\)'\]/.test(body),
    'and its second press is a regex, so it always completes');
  ok(/G_CHORDS\[\(e\.key\|\|''\)\.toLowerCase\(\)\]/.test(body),
    'with the lookup inside the handler, exactly as the old branch did');
  const iCatch = body.indexOf("binds['[Shift]+g [Shift]+(.)']");
  const iJ = body.indexOf('binds.j=');
  ok(iCatch > -1 && iJ > iCatch, 'and it is registered before j/k/Enter');

  ok(/timeout:CHORD_MS/.test(body), 'the chord timeout is passed to tinykeys');
  ok(/const CHORD_MS=900;/.test(html), 'and is still 900ms, as the hand-rolled one was');
}

section('shortcuts: the suppression rules survive the move to tinykeys');
{
  const fn = html.slice(html.indexOf('function kbdIgnore('));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  ok(/e\.metaKey\|\|e\.ctrlKey\|\|e\.altKey/.test(body), 'modifier combos are ignored');
  ok(/input,textarea,select/.test(body), 'typing in a field suppresses shortcuts');
  ok(/isContentEditable/.test(body), 'and so does a contenteditable');
  ok(/cmdk/.test(body), 'and an open palette owns the keyboard');

  /* The modifier check must come FIRST. It is what preserves an armed chord
     across a modifier press: returning true from ignore makes tinykeys skip
     the event before it touches its pending map, exactly as the old handler
     returned without clearing _pendingG. */
  ok(body.indexOf('metaKey') < body.indexOf('input,textarea'),
    'modifiers are checked before the focus rule, which is what keeps a chord armed');
  /* The binding is gone; the comments explaining what it used to do are
     deliberately still there, so this looks for an assignment rather than a
     mention. A test that forbade the NAME would have quietly punished the
     documentation. */
  ok(!/_pendingG\s*=/.test(html) && !/let _pendingG/.test(html),
    'the hand-rolled chord timer is gone from the code');
}

section('shortcuts: the library is the one we think it is');
{
  /* There is an unrelated GPL "tinykeys" P5.js project. Taking it by
     mistake would put a copyleft licence into a closed shell, and the
     mistake is one `npm install` away, so it is asserted rather than
     trusted to a code review. */
  const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/tinykeys/package.json'), 'utf8'));
  ok(pkg.license === 'MIT', 'tinykeys is MIT (' + pkg.license + ')');
  ok(JSON.stringify(pkg.repository).includes('jamiebuilds/tinykeys'),
    'and is jamiebuilds/tinykeys, not the P5.js project of the same name');
  const up = JSON.parse(readFileSync(join(ROOT, 'node_modules/uplot/package.json'), 'utf8'));
  ok(up.license === 'MIT', 'uPlot is MIT');
  ok(JSON.stringify(up.repository).includes('leeoniya/uPlot'), 'and is leeoniya/uPlot');
  const fu = JSON.parse(readFileSync(join(ROOT, 'node_modules/fuse.js/package.json'), 'utf8'));
  ok(fu.license === 'Apache-2.0', 'Fuse.js is Apache-2.0');
  ok(JSON.stringify(fu.repository).includes('krisk/Fuse'), 'and is krisk/Fuse');

  /* Every bundled library needs a LICENSES.md entry — the rule is only
     real if something enforces it. */
  const lic = readFileSync(join(ROOT, 'LICENSES.md'), 'utf8');
  for (const name of ['uPlot', 'Fuse.js', 'tinykeys']) {
    ok(lic.includes(name), 'LICENSES.md documents ' + name);
  }
}

section('sparklines: the SVG fallback geometry is unchanged');
{
  ok(core.sparkPoints([1, null, 2, NaN, 3]).length === 3, 'non-finite values are dropped');
  ok(core.sparkColor([1, 5]) === 'var(--green)', 'a rising series is green');
  ok(core.sparkColor([5, 1]) === 'var(--red)', 'a falling series is red');
  ok(core.sparkColor([5, 5]) === 'var(--green)', 'a flat series reads as not-falling, as before');
  ok(core.sparkColor([5, 1], { color: 'var(--blue)' }) === 'var(--blue)', 'an explicit colour wins');
}

section('transfer market: the top ten each way, and what it refuses to pad');
{
  const el = (id, i, o) => ({ id, transfers_in_event: i, transfers_out_event: o });
  /* A plain field, ranked both ways. */
  const set = [el(1, 500, 10), el(2, 900, 5), el(3, 100, 800), el(4, 0, 300)];
  const m = core.transferMovers(set, 10);
  ok(m.in.map((e) => e.id).join(',') === '2,1,3', 'most transferred in, biggest first');
  ok(m.out.map((e) => e.id).join(',') === '3,4,1,2', 'and most transferred out, biggest first');

  /* A player nobody has bought is not "eleventh most bought" — he is not in
     that race. Padding a top ten out to ten rows with zeros would make the
     tenth row indistinguishable from a real one. */
  ok(!m.in.some((e) => e.id === 4), 'a player with no transfers in is not in the in list');
  ok(m.in.length === 3 && m.out.length === 4,
    'each list is only as long as there are players actually in that race');
  ok(core.transferMovers([el(9, 0, 0)], 10).in.length === 0
    && core.transferMovers([el(9, 0, 0)], 10).out.length === 0,
    'a player with neither is in neither list');

  /* The limit is the whole point of a top ten. */
  const many = Array.from({ length: 40 }, (_, i) => el(i + 1, 1000 - i, i));
  ok(core.transferMovers(many, 10).in.length === 10, 'the in list stops at ten');
  ok(core.transferMovers(many, 10).out.length === 10, 'and so does the out list');
  ok(core.transferMovers(many, 3).in.length === 3, 'the limit is honoured when it is not ten');

  /* TIES ARE BROKEN BY THE OTHER SIDE OF THE LEDGER. Two players level on
     40,000 in are not equally wanted if one is also being sold by 30,000.
     Nothing about a raw count says that, so the sort has to. */
  const tied = [el(7, 40000, 30000), el(8, 40000, 1000)];
  ok(core.transferMovers(tied, 10).in.map((e) => e.id).join(',') === '8,7',
    'level on transfers in, the better net leads');
  const tiedOut = [el(11, 30000, 40000), el(12, 1000, 40000)];
  ok(core.transferMovers(tiedOut, 10).out.map((e) => e.id).join(',') === '12,11',
    'level on transfers out, the worse net leads');

  /* Identical rows must not shuffle between renders — the panel is rebuilt
     on every visit and a list that reorders itself reads as live movement
     that did not happen. */
  const same = [el(30, 100, 50), el(20, 100, 50), el(10, 100, 50)];
  ok(core.transferMovers(same, 10).in.map((e) => e.id).join(',') === '10,20,30',
    'identical rows fall back to id, so the order is stable');

  /* Missing fields are absent counts, not zero-count entries that outrank
     somebody real. */
  ok(core.transferMovers([{ id: 1 }, el(2, 5, 0)], 10).in.map((e) => e.id).join(',') === '2',
    'a player with no transfer fields at all is simply not ranked');
  ok(core.transferMovers(null, 10).in.length === 0, 'no elements yields no lists');
}

section('gameweek stats pack: only a SCORED gameweek, and only what happened');
{
  /* WHICH GAMEWEEK IT IS ABOUT is the whole risk. Bonus does not exist
     until FPL awards it and BPS moves for hours after the whistle, so a
     pack built on `finished` publishes numbers that change — and a graphic
     is the one format nobody goes back and corrects. */
  const ev = (id, extra) => Object.assign({ id, deadline_time: '2026-08-15T17:15:00Z' }, extra || {});
  ok(core.gwPackEvent({ events: [ev(1, { finished: true, data_checked: true })] }).id === 1,
    'a checked gameweek is reviewable');
  ok(core.gwPackEvent({ events: [ev(1, { finished: true })] }) === null,
    'FINISHED is not enough — it turns true before bonus is applied');
  ok(core.gwPackEvent({ events: [ev(1, {})] }) === null, 'and an unplayed one certainly is not');
  ok(core.gwPackEvent({ events: [] }) === null && core.gwPackEvent(null) === null,
    'no season yields no pack');
  /* The LATEST checked one, not the first — a mid-season pack must be about
     last week, not about the opening weekend forever. */
  ok(core.gwPackEvent({ events: [
    ev(1, { data_checked: true }), ev(3, { data_checked: true }), ev(2, { data_checked: true })] }).id === 3,
    'the most recent checked gameweek wins, whatever order the events arrive in');
  ok(core.gwPackEvent({ events: [ev(4, { data_checked: true }), ev(5, { finished: true })] }).id === 4,
    'a gameweek still being scored never displaces the last one that finished');

  /* WHAT HE DID, in the words a match report would use. A blank line beats
     "0 goals, 0 assists", which reads as a stat rather than its absence. */
  const L = core.gwPackLine;
  ok(L({ goals_scored: 2, assists: 1, bonus: 3, minutes: 90 }, 4) === '2 goals · 1 assist · 3 bonus',
    'goals, assists and bonus read as a match report (' + L({ goals_scored: 2, assists: 1, bonus: 3 }, 4) + ')');
  ok(L({ goals_scored: 1, minutes: 90 }, 4) === '1 goal', 'one goal is singular');
  ok(L({ clean_sheets: 1, minutes: 90 }, 2) === 'clean sheet', 'a defender’s clean sheet is worth saying');
  ok(L({ clean_sheets: 1, minutes: 90 }, 3) === '90 mins',
    'a midfielder’s is one point, so it is not — the line falls back to minutes');
  ok(L({ minutes: 0 }, 3) === 'did not play', 'a blank is stated plainly');
  ok(L({ minutes: 62 }, 3) === '62 mins', 'and minutes stand in when nothing else happened');
  ok(!/0 goals|0 assists|undefined|NaN/.test(L({ minutes: 90, goals_scored: 0, assists: 0 }, 3)),
    'nothing that did not happen is ever printed');
  ok(L({ red_cards: 1, yellow_cards: 1, minutes: 40 }, 3) === 'red card',
    'a red card is the card that gets mentioned, not the yellow before it');

  /* THE PACK. */
  const els = {
    1: { id: 1, web_name: 'Haaland', team: 1, element_type: 4, selected_by_percent: '60.0' },
    2: { id: 2, web_name: 'Mbeumo', team: 2, element_type: 3, selected_by_percent: '4.5' },
    3: { id: 3, web_name: 'Nobody', team: 2, element_type: 2, selected_by_percent: '0.2' },
    4: { id: 4, web_name: 'Keeper', team: 3, element_type: 1, selected_by_percent: '30.0' }
  };
  const liveEls = [
    { id: 1, stats: { total_points: 13, bps: 60, bonus: 3, minutes: 90, goals_scored: 2 } },
    { id: 2, stats: { total_points: 13, bps: 40, bonus: 1, minutes: 90, goals_scored: 1, assists: 1 } },
    { id: 3, stats: { total_points: 0, bps: 4, minutes: 0 } },
    { id: 4, stats: { total_points: 6, bps: 30, bonus: 2, minutes: 90, clean_sheets: 1, saves: 4 } },
    { id: 99, stats: { total_points: 20, bps: 90 } }        /* not in the bootstrap index */
  ];
  const evt = ev(7, { data_checked: true, average_entry_score: 51, highest_score: 121,
    most_captained: 1, most_transferred_in: 2, transfers_made: 4200000,
    chip_plays: [{ chip_name: 'bboost', num_played: 90000 }, { chip_name: '3xc', num_played: 120000 }] });
  const pk = core.gwStatsPack(els, liveEls, evt, 10);

  ok(pk.gw === 7, 'the pack knows which gameweek it is about');
  /* A name with no stats, or stats with no name, is a broken row on a
     published graphic — so an id in one feed and not the other is dropped
     rather than half-drawn. */
  ok(!pk.scorers.some((r) => r.id === 99), 'a live id the bootstrap does not know is dropped');
  /* Level on points, BPS decides — the game’s own tie-break, so it is the
     one already meaningful here. */
  ok(pk.scorers.map((r) => r.id).join(',') === '1,2,4',
    'scorers rank by points, ties broken on BPS (' + pk.scorers.map((r) => r.id).join(',') + ')');
  ok(!pk.scorers.some((r) => r.pts === 0),
    'a player who scored nothing is not padding out a top ten');
  ok(pk.bonus.map((r) => r.id).join(',') === '1,2,4,3',
    'the BPS table ranks on BPS, and keeps a player who scored no points but earned some');

  /* Under 15% owned — the definition the differentials lens and the glossary
     already use. A second definition here would mean the same word meant two
     things in one product. */
  ok(core.GW_PACK_DIFF === 15, 'the differential threshold is the app’s existing one');
  ok(pk.diffs.map((r) => r.id).join(',') === '2', 'only the low-owned hauls are differentials');
  ok(!pk.diffs.some((r) => r.id === 3), 'and a low-owned player who did nothing is not one');

  ok(pk.numbers.avg === 51 && pk.numbers.high === 121, 'the published averages come straight through');
  ok(pk.numbers.chips.map((c) => c.name).join(',') === '3xc,bboost',
    'chips are ranked by how many played them (' + pk.numbers.chips.map((c) => c.name).join(',') + ')');

  /* A season that published no chip figures must produce no chip row rather
     than a row of zeroes. */
  const bare = core.gwStatsPack(els, liveEls, ev(7, { data_checked: true }), 10);
  ok(bare.numbers.chips.length === 0 && bare.numbers.avg === null,
    'figures FPL did not publish are absent, not zero');
  ok(core.gwStatsPack(els, [], evt, 10).scorers.length === 0, 'no live data yields no rows');
  ok(core.gwStatsPack(els, liveEls, evt, 2).scorers.length === 2, 'the limit is honoured');

  /* ── WHY THERE IS NO PACK ────────────────────────────────────────
     Reported as "can't see the new cards". The gate was right and it was
     invisible: four cards were simply not in the gallery, with nothing to
     say whether the season was young, a gameweek was still being scored,
     or the feature was broken. An absence that cannot be told apart from a
     bug is a bug. */
  const W = core.gwPackWhy;
  const NOW = Date.parse('2026-08-23T20:00:00Z');
  const at = (id, iso, extra) => Object.assign({ id, deadline_time: iso }, extra || {});

  ok(W({ events: [at(1, '2026-08-14T17:15:00Z', { data_checked: true })] }, NOW) === '',
    'a pack that EXISTS explains nothing — the cards are their own explanation');

  const inPlay = W({ events: [at(1, '2026-08-21T17:15:00Z', {})] }, NOW);
  ok(/GW1/.test(inPlay) && /still being played/.test(inPlay),
    'a gameweek in play says so, by number (' + inPlay.slice(0, 70) + ')');

  /* finished and data_checked are different states and the wait is a
     different length. Collapsing them into "not ready" would hide the one
     that resolves in hours. */
  const awaiting = W({ events: [at(1, '2026-08-21T17:15:00Z', { finished: true })] }, NOW);
  ok(/bonus/.test(awaiting) && /within a day/.test(awaiting),
    'a finished-but-unconfirmed gameweek names bonus as what is missing, and when it lands');
  ok(awaiting !== inPlay, 'and it is not the same sentence as one still being played');

  const preseason = W({ events: [at(1, '2026-08-28T17:15:00Z', {})] }, NOW);
  ok(/first gameweek/.test(preseason) && !/GW/.test(preseason),
    'before any deadline it names no gameweek, because none has been played');

  /* The LATEST started gameweek is the one being waited on. Reporting GW1
     while GW7 is in play would be an answer about the wrong week. */
  const mid = W({ events: [
    at(1, '2026-08-14T17:15:00Z', { finished: true }),
    at(7, '2026-08-21T17:15:00Z', {})] }, NOW);
  ok(/GW7/.test(mid) && !/GW1/.test(mid),
    'mid-season it is about the gameweek actually being waited on (' + mid.slice(0, 60) + ')');

  /* Every branch must say something. An empty string here is the silence
     this whole helper exists to remove. */
  [inPlay, awaiting, preseason, mid].forEach((m, i) =>
    ok(typeof m === 'string' && m.length > 40, 'branch ' + i + ' produces a real sentence'));
  ok(W({ events: [] }, NOW).length > 40 && W(null, NOW).length > 40,
    'even an empty or missing season explains itself rather than going quiet');
}

/* ── summary ────────────────────────────────────────────── */
console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
