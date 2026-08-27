/*
 * Guards for the set-piece value model: corner side and penalty volume.
 *
 * Run: node dev/test-setpiece.mjs   (wired into npm test)
 *
 * Why this file exists.
 *
 * The Set-Piece Register published two flat numbers. A primary corner taker
 * was worth +0.12 xP/gw and a primary penalty taker +0.60, whoever they were
 * and wherever they played. Opta's 2025-26 set-piece data says both are too
 * blunt to print:
 *
 *  - Corners are dominated by inswingers (2,643 to 541), so clubs put a
 *    left-footer on the right and a right-footer on the left. A taker who
 *    owns one side gets about half the deliveries of one who takes both.
 *    Bruno Fernandes takes United's left corners only; Szoboszlai takes both
 *    for Liverpool. We rated them identically.
 *  - Penalties are won, not awarded evenly. Igor Thiago took nine last
 *    season and only eight players in Premier League history have taken more
 *    than nine in a season, so the rate regresses hard — yet he carried the
 *    same +0.60 as Haaland.
 *
 * Two properties matter more than the constants themselves, and both are
 * re-derived here on every run rather than trusted:
 *
 *  1. The corner split is MEAN-PRESERVING. Adding side data should move
 *     individual players, not lift or drop the whole league. If someone later
 *     edits CORNER_XP to make their favourite look better, the register-
 *     weighted mean drifts off 0.12 and this fails.
 *  2. Both changes are OPT-IN. setPieceConfidence called with no options
 *     returns exactly what it always returned, because the players table and
 *     the club dossier still call it that way.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { extractBlock } from './extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; } else { fails.push(m); console.error('  ✗ ' + m); } };

const fn = (n) => extractBlock(html, html.indexOf('function ' + n + '('));
const obj = (n) => extractBlock(html, html.indexOf('const ' + n + '=')) + ';';
/* A whole statement, to the semicolon that closes it at depth zero — NOT to
   the end of the line. cornerKey is written across two lines, and slicing at
   the newline silently produced a half-built function that skipped the
   lowercasing: every positive assertion below failed while the register
   tests still passed, which is exactly how a broken extractor reads as a
   broken feature. */
const decl = (n) => {
  const i = html.indexOf('const ' + n + '=');
  if (i < 0) throw new Error('no declaration for ' + n);
  let depth = 0;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return html.slice(i, j + 1);
  }
  throw new Error('unterminated declaration for ' + n);
};

/* Pull the REAL implementations, not copies. A test that reimplements the
   arithmetic it is checking cannot fail when the shipped arithmetic breaks —
   that mistake let a three-times-out BPS constant through once already. */
const ctx = vm.createContext({});
vm.runInContext([
  obj('CORNER_SIDES'), obj('CORNER_CLUB_KEYS'), decl('cornerKey'), fn('cornerSide'),
  decl('CORNER_XP'), obj('PEN_RATE'), fn('penRateMult'),
  'const confTier=(v)=>v>=70?"high":v>=45?"med":"low";',
  fn('setPieceConfidence'),
  /* `const` lands in the script's lexical scope, not on the context object,
     so the bindings have to be handed over explicitly to be readable here. */
  'Object.assign(globalThis,{CORNER_SIDES,CORNER_CLUB_KEYS,CORNER_XP,PEN_RATE,'
    + 'cornerSide,penRateMult,setPieceConfidence});',
].join('\n'), ctx);
const { CORNER_SIDES, CORNER_CLUB_KEYS, CORNER_XP, PEN_RATE,
  cornerSide, penRateMult, setPieceConfidence } = ctx;

/* ---------------------------------------------------------------- */
console.log('• set-piece: the corner register is well formed');
{
  const clubs = Object.keys(CORNER_SIDES);
  ok(clubs.length === 20, 'all twenty clubs carry a corner entry (' + clubs.length + ')');
  const bad = [];
  for (const c of clubs) {
    const names = Object.keys(CORNER_SIDES[c]);
    if (!names.length) bad.push(c + ': empty');
    for (const n of names) {
      if (!/^(L|R|LR)$/.test(CORNER_SIDES[c][n])) bad.push(c + '/' + n + ': ' + CORNER_SIDES[c][n]);
      if (!n.trim()) bad.push(c + ': blank name');
    }
  }
  ok(!bad.length, 'every side is L, R or LR (' + bad.join(', ') + ')');
  /* Every club must be reachable from a real club name, or the register is
     decoration: cornerSide would return null for the whole league and
     nothing would ever fail. */
  const targets = new Set(Object.values(CORNER_CLUB_KEYS));
  const unreachable = clubs.filter((c) => !targets.has(c));
  ok(!unreachable.length, 'every register club is reachable from a club name (' + unreachable.join(', ') + ')');
  /* And each club needs at least one taker on each side somewhere in the
     league, otherwise the inswinger premise is not represented at all. */
  const sides = new Set(clubs.flatMap((c) => Object.values(CORNER_SIDES[c])));
  ok(sides.has('L') && sides.has('R') && sides.has('LR'), 'all three side values are used');
}

/* ---------------------------------------------------------------- */
console.log('• set-piece: every real club name reaches the register');
{
  /* The reachability check above only proves the register's own keys appear
     in the name map. It cannot see the failure that actually matters: a club
     the API names in a way the map does not carry. That fails silently —
     cornerSide returns null, the sides quietly vanish for a fifth of the
     league, and every other test still passes. So the real names go in.
     Kept in step with dev/mock_fpl.py, which uses the FPL spellings. */
  const LEAGUE = [
    ['ARS', 'Arsenal'], ['AVL', 'Aston Villa'], ['BOU', 'Bournemouth'],
    ['BRE', 'Brentford'], ['BHA', 'Brighton'], ['CHE', 'Chelsea'],
    ['COV', 'Coventry'], ['CRY', 'Crystal Palace'], ['EVE', 'Everton'],
    ['FUL', 'Fulham'], ['HUL', 'Hull'], ['IPS', 'Ipswich'], ['LEE', 'Leeds'],
    ['LIV', 'Liverpool'], ['MCI', 'Man City'], ['MUN', 'Man Utd'],
    ['NEW', 'Newcastle'], ['NFO', "Nott'm Forest"], ['TOT', 'Spurs'],
    ['SUN', 'Sunderland'],
  ];
  const seen = new Set(); const missed = [];
  for (const [short, name] of LEAGUE) {
    const b = { teams: { 1: { short_name: short, name } } };
    /* Probe with the club's own first-listed taker, so a resolved club also
       proves a name match rather than only a key match. */
    const key = CORNER_CLUB_KEYS[name.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z]/g, '')];
    const first = key && Object.keys(CORNER_SIDES[key] || {})[0];
    if (!first) { missed.push(name + ' (no register entry)'); continue; }
    const side = cornerSide(b, { team: 1, web_name: first });
    if (!side) missed.push(name + ' → ' + first + ' unresolved');
    else seen.add(key);
  }
  ok(!missed.length, 'all twenty clubs resolve a taker (' + missed.join(', ') + ')');
  ok(seen.size === 20, 'and each reaches a different register club (' + seen.size + ')');
}

/* ---------------------------------------------------------------- */
console.log('• set-piece: the corner split is mean-preserving');
{
  ok(CORNER_XP.LR === 2 * CORNER_XP.L, 'both sides is worth twice one side');
  ok(CORNER_XP.L === CORNER_XP.R, 'left and right are worth the same');
  /* The first name per club is the register's primary — the population the
     old flat 0.12 was calibrated on. */
  const firsts = Object.keys(CORNER_SIDES).map((c) => CORNER_SIDES[c][Object.keys(CORNER_SIDES[c])[0]]);
  const mean = firsts.reduce((s, side) => s + CORNER_XP[side], 0) / firsts.length;
  const drift = Math.abs(mean - CORNER_XP._);
  ok(drift < 0.01,
    'register-weighted mean stays at the population figure: ' + mean.toFixed(4)
    + ' vs ' + CORNER_XP._ + ' (drift ' + drift.toFixed(4) + ')');
  console.log('  primaries: ' + firsts.filter((s) => s === 'LR').length + ' both-sides, '
    + firsts.filter((s) => s !== 'LR').length + ' single-side, mean ' + mean.toFixed(4));
}

/* ---------------------------------------------------------------- */
console.log('• set-piece: a side is only assigned when the club resolves');
{
  const boot = (short, name) => ({ teams: { 7: { short_name: short, name } } });
  const el = (web) => ({ team: 7, web_name: web });
  ok(cornerSide(boot('MUN', 'Man Utd'), el('Fernandes')) === 'L', 'Bruno takes United\'s left corners');
  ok(cornerSide(boot('MUN', 'Man Utd'), el('Mbeumo')) === 'R', 'Mbeumo the right');
  ok(cornerSide(boot('LIV', 'Liverpool'), el('Szoboszlai')) === 'LR', 'Szoboszlai takes both for Liverpool');
  ok(cornerSide(boot('EVE', 'Everton'), el('Garner')) === 'L', 'Garner left');
  ok(cornerSide(boot('EVE', 'Everton'), el('Dewsbury-Hall')) === 'R', 'Dewsbury-Hall right');
  /* Club naming varies by feed and season. */
  ok(cornerSide(boot('NFO', "Nott'm Forest"), el('Williams')) === 'L', "Nott'm Forest resolves");
  ok(cornerSide(boot('NFO', 'Nottingham Forest'), el('Williams')) === 'L', 'and so does the long form');
  ok(cornerSide(boot('TOT', 'Spurs'), el('Porro')) === 'LR', 'Spurs resolves');
  ok(cornerSide(boot('TOT', 'Tottenham Hotspur'), el('Porro')) === 'LR', 'and Tottenham Hotspur');
  ok(cornerSide(boot('BHA', 'Brighton'), el('De Cuyper')) === 'R', 'a two-word surname matches');
  /* The important negatives. A surname that belongs to another club must not
     borrow that club's side — Wilson is at Leeds here and Anderson at City,
     and both surnames exist elsewhere in the league. */
  ok(cornerSide(boot('LEE', 'Leeds'), el('Wilson')) === 'R', 'Wilson takes Leeds\' right corners');
  ok(cornerSide(boot('SUN', 'Sunderland'), el('Wilson')) === null,
    'but a Wilson at another club gets nothing rather than Leeds\' side');
  ok(cornerSide(boot('MCI', 'Man City'), el('Anderson')) === 'L', 'Anderson takes City\'s left');
  ok(cornerSide(boot('HUL', 'Hull'), el('Anderson')) === null, 'a Hull Anderson gets nothing');
  ok(cornerSide(boot('XYZ', 'Some New Club'), el('Rice')) === null, 'an unknown club yields no side');
  ok(cornerSide(boot('ARS', 'Arsenal'), el('Nobody')) === null, 'an unlisted player yields no side');
  ok(cornerSide(null, el('Rice')) === null, 'and a missing bootstrap does not throw');
}

/* ---------------------------------------------------------------- */
console.log('• set-piece: penalty value scales with how many the club wins');
{
  const R = { att: { 1: 1.40, 2: 1.00, 3: 0.70, 4: 2.5, 5: 0.1 } };
  ok(penRateMult(R, 2) === 1, 'a league-average attack is unscaled');
  ok(penRateMult(R, 1) > 1, 'a strong attack is worth more');
  ok(penRateMult(R, 3) < 1, 'a weak one less');
  ok(penRateMult(R, 1) === 1 + PEN_RATE.SHRINK * 0.40, 'shrunk halfway to the mean, not taken at face value');
  ok(penRateMult(R, 4) === PEN_RATE.MAX, 'an extreme attack is clamped high');
  ok(penRateMult(R, 5) === PEN_RATE.MIN, 'and an extreme one clamped low');
  ok(PEN_RATE.MAX < 2 && PEN_RATE.MIN > 0.5, 'the clamps keep a presentation figure sane');
  /* Unknown data must not silently re-rank anyone. */
  ok(penRateMult(R, 99) === 1, 'an unrated club is unscaled');
  ok(penRateMult(null, 1) === 1, 'and so is a missing model');
}

/* ---------------------------------------------------------------- */
console.log('• set-piece: the additions are opt-in');
{
  const pen = { penalties_order: 1 };
  const ck = { corners_and_indirect_freekicks_order: 1 };
  const fk = { direct_freekicks_order: 1 };
  ok(setPieceConfidence(pen).addXp === 0.6, 'a bare call still returns the flat penalty figure');
  ok(setPieceConfidence(ck).addXp === 0.12, 'and the flat corner figure');
  ok(setPieceConfidence(fk).addXp === 0.18, 'and the free-kick figure');
  ok(setPieceConfidence(pen).value === 82 && setPieceConfidence(ck).value === 64,
    'confidence values are untouched');
  ok(setPieceConfidence(pen, {}).addXp === 0.6, 'empty options change nothing');
  ok(setPieceConfidence(pen, { penMult: 0 }).addXp === 0.6, 'a zero multiplier is treated as absent, not as zero value');

  /* Confidence answers "is this his job", which does not depend on how many
     penalties the club wins. Only the value of the job does. */
  const weak = setPieceConfidence(pen, { penMult: 0.7 });
  ok(weak.value === 82, 'a low-volume club does not make a settled duty look doubtful');
  ok(weak.addXp === 0.42, 'but it does cut the value (' + weak.addXp + ')');
  ok(setPieceConfidence(pen, { penMult: 1.35 }).addXp === 0.81, 'and a high-volume club raises it');

  ok(setPieceConfidence(ck, { side: 'LR' }).addXp === CORNER_XP.LR, 'a both-sides taker is worth more');
  ok(setPieceConfidence(ck, { side: 'L' }).addXp === CORNER_XP.L, 'a one-side taker less');
  ok(setPieceConfidence(ck, { side: 'ZZ' }).addXp === CORNER_XP._, 'an unrecognised side falls back to the population figure');
  ok(/both sides/.test(setPieceConfidence(ck, { side: 'LR' }).roles.join()), 'the role names the side');
  ok(/left/.test(setPieceConfidence(ck, { side: 'L' }).roles.join()), 'for one side too');
  ok(setPieceConfidence(ck).roles.join() === 'corners', 'and stays plain without it');

  /* The whole point, stated as a test: the two named players that motivated
     this are no longer rated the same. */
  const bruno = setPieceConfidence(ck, { side: 'L' }).addXp;
  const szobo = setPieceConfidence(ck, { side: 'LR' }).addXp;
  ok(szobo > bruno, 'Szoboszlai (both sides) now outranks Bruno (left only) on corner value');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
