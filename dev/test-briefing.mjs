/*
 * Tests for the pre-season briefing parsers (scripts/briefing-parse.mjs).
 *
 * These decide what a hand-written document is ASSERTING, which is the half of
 * the checker that can be got wrong silently: a parser that reads two thirds of
 * a file and hands back a tidy list produces a report that looks complete and
 * is not. So the tests are mostly about what must NOT be extracted — a transfer
 * fee read as an FPL price, a rumour read as a claim, an alternate penalty
 * taker read as the primary.
 *
 * Run: node dev/test-briefing.mjs   (wired into npm test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clubBlocks, priceClaims, penaltyClaims, moveClaims } from '../scripts/briefing-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0, passes = 0;
const ok = (c, label) => { if (c) passes++; else { failures++; console.error('  ✗ ' + label); } };

console.log('• briefing: club blocks');
{
  const src = [
    '# The 20 clubs', '',
    '## 1. Arsenal (Champions, 85 pts)', '', 'body one', '',
    '## 2. Manchester City (78 pts)', '', 'body two', '',
    '# Quick FPL shortlist', '', 'Haaland (£15.5m)',
  ].join('\n');
  const b = clubBlocks(src);
  ok(b.length === 2, 'two numbered clubs (' + b.length + ')');
  ok(b[0].name === 'Arsenal', 'the parenthesised finishing position is stripped from the name');
  ok(b[1].name === 'Manchester City', 'and from the second');
  /* The shortlist is not a club. Anchoring on "## <n>." rather than on any
     heading is what keeps the league-wide sections out of a per-club parse. */
  ok(!b.some((x) => /shortlist/i.test(x.name)), 'the shortlist is not read as a club');
  ok(/Haaland/.test(b[1].body), 'the last block runs to the end of the document');
}

console.log('• briefing: a transfer fee is not an FPL price');
{
  /* The distinction the whole price check rests on. Both are "£X.Xm in
     brackets after a name", so they are told apart by WHERE they sit: FPL
     prices in the pick bullets and the shortlist, fees in prose and in the
     In/Out lines. Prose is the case that actually bit — "(~£21.5m to Rennes)"
     has no comma, so an earlier punctuation-based rule read a £21.5m
     footballer, £6m above anything the game has priced. */
  const src = [
    '**In:** Piero Hincapie (DEF, Bayer Leverkusen, ~£34.5m, loan made permanent)',
    'they lost breakout striker Mayenda (~£21.5m to Rennes), so replacing goals is the priority',
    '- Value: Gabriel Magalhaes (DEF, ~£8.0m), clean sheets plus set-piece threat.',
    '- Premium / captaincy: Erling Haaland (FWD, £15.5m, record price)',
    '',
    '# Quick FPL shortlist',
    '',
    '**Premium anchors:** Bruno Fernandes (£12.0m), Isak (~£9.0m).',
  ].join('\n');
  const p = priceClaims(src);
  const names = p.map((x) => x.name);
  ok(!names.some((n) => /Hincapie/.test(n)), 'a fee on an In line is not a price claim');
  ok(!names.some((n) => /Mayenda/.test(n)), 'nor is a fee written in prose');
  ok(names.some((n) => /Gabriel/.test(n)), 'a positional price claim is');
  ok(p.find((x) => /Bruno/.test(x.name)).price === 12, 'a shortlist price is read exactly');
  ok(names.some((n) => /Haaland/.test(n)), 'and a premium bullet counts');
  /* An estimate that turns out wrong is not a factual error, so it is marked
     and forgiven rather than reported. */
  ok(p.find((x) => /Gabriel/.test(x.name)).est === true, '"~" marks an estimate');
  ok(p.find((x) => /Bruno/.test(x.name)).est === false, 'and a stated price is not one');
}

console.log('• briefing: only the primary penalty taker is a claim');
{
  const blocks = clubBlocks([
    '## 1. Arsenal (x)', '- Set-piece & penalties: Penalties Saka primary, with Gyokeres and Odegaard in the mix (watch the order).',
    '## 2. Villa (x)', '- Set-piece & penalties: Penalties Watkins (Buendia distant second). Free-kicks Buendia.',
    '## 3. Fulham (x)', '- Set-piece & penalties: Penalties unresolved, Robinson tentatively (1/1 last season).',
    '## 4. Brighton (x)', '- Set-piece & penalties: Corners Gross. Penalties uncertain after summer changes, O’Riley the likeliest.',
  ].join('\n'));
  const pens = penaltyClaims(blocks);
  const by = Object.fromEntries(pens.map((x) => [x.club, x]));
  ok(by.Arsenal && by.Arsenal.name === 'Saka', 'the first name after "Penalties" is the claim');
  ok(!/Gyokeres|Odegaard/.test(JSON.stringify(pens)), 'the alternates named in the same line are not');
  ok(by.Villa && by.Villa.name === 'Watkins', 'a parenthesised second choice is skipped too');
  /* "Penalties unresolved" and "Penalties uncertain" are the document saying
     it does not know. Extracting "unresolved" as a player name would then
     report it as a missing footballer. */
  ok(!by.Fulham, '"Penalties unresolved" produces no claim');
  ok(!by.Brighton, 'nor does "Penalties uncertain"');
  ok(by.Arsenal.hedged === true, 'a line saying "watch" carries the hedge');
  ok(by.Villa.hedged === false, 'and a flat statement does not');
}

console.log('• briefing: a rumour is hedged, the confirmed sale beside it is not');
{
  /* The shape that made this necessary. One line carries a completed £64m
     transfer and two guesses; hedging the whole line would excuse the one
     claim on it actually worth checking. */
  const blocks = clubBlocks([
    '## 1. Bournemouth (x)',
    '**Out:** Antoine Semenyo (W, Man City, ~£64m, Jan 2026), Marcos Senesi (CB, Tottenham, free). Rumoured exits: Junior Kroupi (x), Alex Scott (x).',
    '## 2. Palace (x)',
    '**Out:** Marc Guehi (CB, Man City, £20m+, January), Jean-Philippe Mateta (ST, rumoured exit, unconfirmed)',
  ].join('\n'));
  const mv = moveClaims(blocks);
  const get = (n) => mv.find((x) => x.name === n);
  ok(get('Antoine Semenyo') && get('Antoine Semenyo').hedged === false,
    'a completed sale stays a claim even when a rumour follows it on the same line');
  ok(get('Marcos Senesi') && get('Marcos Senesi').hedged === false, 'and so does the one after it');
  ok(get('Junior Kroupi') && get('Junior Kroupi').hedged === true,
    'everything after the "Rumoured" marker is hedged');
  ok(get('Alex Scott') && get('Alex Scott').hedged === true, 'including the last of them');
  ok(get('Jean-Philippe Mateta') && get('Jean-Philippe Mateta').hedged === true,
    'and a segment that hedges itself is hedged wherever it sits');
  ok(get('Marc Guehi') && get('Marc Guehi').hedged === false, 'while its neighbour is not');
  ok(mv.every((x) => x.dir === 'Out'), 'direction is carried on every claim');
}

console.log('• briefing: the shipped document still parses');
{
  /* The guard that matters most. The checker's own shape test refuses to run
     on a document it cannot read; this one fails the build if the shipped
     briefing drifts out of that shape, so the drift is found here rather than
     the next time someone runs the checker and trusts a thin result. */
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const blocks = clubBlocks(md);
  ok(blocks.length === 20, 'all twenty clubs (' + blocks.length + ')');
  ok(blocks.every((b) => b.name && b.body.length > 200), 'each with a real body');
  const prices = priceClaims(md);
  const pens = penaltyClaims(blocks);
  const moves = moveClaims(blocks);
  ok(prices.length >= 25, 'price claims extracted (' + prices.length + ')');
  ok(pens.length >= 15, 'penalty claims extracted (' + pens.length + ')');
  ok(moves.length >= 100, 'squad moves extracted (' + moves.length + ')');
  /* Spot-checks against what the document actually says, so a parser that
     starts returning plausible rubbish is caught. */
  ok(prices.some((p) => /Haaland/.test(p.name) && p.price === 15.5), 'Haaland at £15.5m');
  ok(pens.some((p) => p.club === 'Manchester United' && /Bruno/.test(p.name)),
    'Bruno on United penalties');
  ok(moves.some((m) => /Salah/.test(m.name) && m.dir === 'Out' && /Liverpool/.test(m.club)),
    'Salah listed out of Liverpool');
  ok(!prices.some((p) => p.price > 20), 'nothing priced above the game\'s ceiling leaked in as a price');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
