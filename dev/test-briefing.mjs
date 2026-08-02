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
import { clubBlocks, priceClaims, penaltyClaims, moveClaims,
  teamsFromHtml, claimsFromTeams, fixtureContradictions,
  clubMatcher, CLUB_ALIAS } from '../scripts/briefing-parse.mjs';

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

console.log('• briefing: a name must stop at the sentence boundary');
{
  /* The bug this caught. The name class has to allow a dot — initials,
     "B.Fernandes" — which means a greedy match runs straight through
     "Penalties Bruno. Direct free-kicks Bruno primary" and returns a player
     called "Bruno. Direct". It did, on United, in both editions. A loose
     /Bruno/ assertion in this file passed happily over it. */
  const blocks = clubBlocks([
    '## 1. Manchester United (x)',
    '- Set-piece & penalties: Penalties Bruno. Direct free-kicks Bruno primary, Mbeumo backup. Corners Bruno primary.',
  ].join('\n'));
  const p = penaltyClaims(blocks);
  ok(p.length === 1 && p[0].name === 'Bruno', 'prose: exactly "Bruno" (' + JSON.stringify(p[0] && p[0].name) + ')');
  const { pens } = claimsFromTeams([{ name: 'Man Utd', sp: 'Pens Bruno. FK Bruno (Mbeumo backup). Corners Bruno.' }]);
  ok(pens.length === 1 && pens[0].name === 'Bruno', 'structured: the same (' + JSON.stringify(pens[0] && pens[0].name) + ')');
}

console.log('• briefing: the structured edition');
{
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const teams = teamsFromHtml(html);
  ok(Array.isArray(teams) && teams.length === 20, 'TEAMS lifts out of the page (' + (teams || []).length + ')');
  const c = claimsFromTeams(teams);
  ok(c.prices.length >= 20, 'price claims (' + c.prices.length + ')');
  ok(c.pens.length >= 15, 'penalty claims (' + c.pens.length + ')');
  ok(c.moves.length >= 80, 'squad moves (' + c.moves.length + ')');
  /* The claim type only this edition states machine-readably, and the one the
     API can settle outright. */
  ok(c.fixtures.length >= 50, 'fixture claims (' + c.fixtures.length + ')');
  ok(c.fixtures.every((f) => f.gw > 0 && f.opp && typeof f.home === 'boolean'),
    'each carries a gameweek, an opponent and a venue');

  /* Both editions must agree on the penalty takers, or one of the two parsers
     is reading the document wrong and there is no way to tell which. */
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const fromProse = penaltyClaims(clubBlocks(md)).map((x) => x.name).sort();
  const fromHtml = c.pens.map((x) => x.name).sort();
  ok(JSON.stringify(fromProse) === JSON.stringify(fromHtml),
    'the prose and structured editions extract the same penalty takers');

  /* "(H?)" is the briefing saying it does not know the venue — Hull's GW1 is
     written exactly that way, and it is one of the document's own open
     questions. Losing that mark would turn a flagged unknown into a claim. */
  const unsure = c.fixtures.filter((f) => f.hedged);
  ok(unsure.length >= 1 && unsure.some((f) => /Hull/.test(f.club) && f.gw === 1),
    'a "(H?)" venue is carried as unsure, not as a claim');
}

console.log('• briefing: fixture claims are checked against each other');
{
  const names = ['Chelsea', 'Fulham', 'Brentford', 'Tottenham Hotspur', 'Arsenal', 'Coventry City'];
  const fx = [
    /* Both away to each other — impossible, and in the shipped document. */
    { club: 'Chelsea', gw: 1, opp: 'Fulham', home: false },
    { club: 'Fulham', gw: 1, opp: 'Chelsea', home: false },
    /* Both at home — likewise. */
    { club: 'Brentford', gw: 1, opp: 'Tottenham', home: true },
    { club: 'Tottenham Hotspur', gw: 1, opp: 'Brentford', home: true },
    /* And a pair that simply name different opponents. */
    { club: 'Arsenal', gw: 1, opp: 'Coventry', home: true },
    { club: 'Coventry City', gw: 1, opp: 'Arsenal', home: false },
  ];
  const bad = fixtureContradictions(fx, names);
  const msgs = bad.map((b) => b.msg).join(' | ');
  ok(bad.some((b) => b.kind === 'venue' && /Chelsea/.test(b.msg)), 'both-away is caught');
  ok(bad.some((b) => b.kind === 'venue' && /Brentford/.test(b.msg)), 'both-home is caught');
  ok(!/Arsenal/.test(msgs), 'and a consistent pair is not reported (' + msgs + ')');
  ok(bad.length === 2, 'each contradiction is reported once, not once per side (' + bad.length + ')');

  /* Club labels differ between the block heading and the fixture text —
     "Forest" vs "Nottingham Forest", "Man Utd" vs "Manchester United". If the
     matcher cannot bridge that, every fixture reads as a contradiction and
     the check is worse than useless. */
  const shorthand = fixtureContradictions([
    { club: 'Nottingham Forest', gw: 1, opp: 'Leeds', home: true },
    { club: 'Leeds United', gw: 1, opp: 'Forest', home: false },
  ], ['Nottingham Forest', 'Leeds United']);
  ok(shorthand.length === 0, 'everyday club names resolve to the club (' +
    shorthand.map((b) => b.msg).join('; ') + ')');
}

console.log('• briefing: the shipped fixture claims, as they stand');
{
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const teams = teamsFromHtml(html);
  const c = claimsFromTeams(teams);
  const bad = fixtureContradictions(c.fixtures, teams.map((t) => t.name));
  /* This is a FINDING, pinned rather than fixed: the opening-fixtures section
     contradicts itself in roughly a quarter of its claims, and the fix is to
     read the real fixture list, not to edit the parser. The assertion exists
     so that if someone corrects the document, this test tells them it worked. */
  ok(bad.length > 0, 'the shipped briefing currently contradicts itself (' + bad.length + ')');
  ok(bad.some((b) => /Chelsea/.test(b.msg) && /Fulham/.test(b.msg)),
    'including Chelsea and Fulham both away to each other in GW1');
}

console.log('• briefing: one club-name matcher, not three');
{
  /* There were three matchers here with three separate bugs. One had its
     `includes` arguments the wrong way round, so "Brighton & Hove Albion"
     matched nothing — and the --fix pass silently left that club's fixtures
     uncorrected while rewriting everything around it, which is the worst kind
     of failure: a document that looks fixed and is not. */
  const api = [
    { name: 'Arsenal', short: 'ARS', id: 1 }, { name: 'Man Utd', short: 'MUN', id: 2 },
    { name: 'Manchester City', short: 'MCI', id: 3 }, { name: 'Spurs', short: 'TOT', id: 4 },
    { name: "Nott'm Forest", short: 'NFO', id: 5 }, { name: 'Brighton', short: 'BHA', id: 6 },
    { name: 'Newcastle', short: 'NEW', id: 7 }, { name: 'Leeds', short: 'LEE', id: 8 },
  ];
  const m = clubMatcher(api);
  const id = (label) => (m(label) || {}).id;
  ok(id('Arsenal') === 1, 'exact name');
  ok(id('ARS') === 1, 'short code');
  ok(id('Brighton & Hove Albion') === 6, 'the long form finds the short one');
  const palace = clubMatcher([{ name: 'Palace', short: 'CRY', id: 9 }]);
  ok((palace('Crystal Palace') || {}).id === 9, 'Crystal Palace → Palace');
  const long = clubMatcher([{ name: 'Wolverhampton Wanderers', short: 'WOL', id: 10 }]);
  ok((long('Wolverhampton') || {}).id === 10, 'and the long form the other way');
  ok(id('Manchester United') === 2, 'Manchester United → Man Utd');
  ok(id('Tottenham Hotspur') === 4, 'Tottenham Hotspur → Spurs (no word in common at all)');
  ok(id('Nottingham Forest') === 5, "Nottingham Forest → Nott'm Forest");
  ok(id('Forest') === 5, 'and the everyday shorthand too');
  ok(id('Newcastle United') === 7, 'Newcastle United → Newcastle');
  ok(id('Leeds United') === 8, 'Leeds United → Leeds');
  /* The ambiguity that must NOT resolve. "Manchester" alone is two clubs, and
     guessing between them would put a fixture on the wrong side of the city. */
  ok(id('Manchester') !== 2 || id('Manchester') !== 3, 'a bare "Manchester" is not silently assigned');
  ok(m('Barcelona') === null, 'a club not in the league returns null rather than a near miss');
  ok(m('') === null && m(null) === null, 'and empty input is safe');
}

console.log('• briefing: every club in the briefing resolves to a real one');
{
  /* THE regression guard, and the one that would have caught the bug. The
     failure was not a wrong match — it was two clubs matching NOTHING, so
     --fix rewrote eighteen fixture blocks and silently left two as they were.
     A document that looks fixed and is not is worse than one that is plainly
     broken, so this asserts total coverage rather than spot-checking names.

     The API's own names, verbatim, including the awkward ones. */
  const api = [['Arsenal','ARS'],['Aston Villa','AVL'],['Bournemouth','BOU'],['Brentford','BRE'],
    ['Brighton','BHA'],['Chelsea','CHE'],['Coventry','COV'],['Crystal Palace','CRY'],
    ['Everton','EVE'],['Fulham','FUL'],['Hull','HUL'],['Ipswich','IPS'],['Leeds','LEE'],
    ['Liverpool','LIV'],['Man City','MCI'],['Man Utd','MUN'],['Newcastle','NEW'],
    ["Nott'm Forest",'NFO'],['Sunderland','SUN'],['Spurs','TOT']]
    .map(([name, short], i) => ({ name, short, id: i + 1 }));
  const m = clubMatcher(api);
  const teams = teamsFromHtml(readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8'));

  const unmatchedClubs = teams.map((t) => t.name).filter((n) => !m(n));
  ok(unmatchedClubs.length === 0,
    'every club heading resolves' + (unmatchedClubs.length ? ' — ' + unmatchedClubs.join(', ') : ''));

  /* And the opponent labels inside the fixture text, which are written more
     loosely still ("Forest", "Man Utd", "Spurs"). */
  const opps = [...new Set(claimsFromTeams(teams).fixtures.map((f) => f.opp))];
  const unmatchedOpps = opps.filter((o) => !m(o));
  ok(unmatchedOpps.length === 0,
    'every opponent named in a fixture resolves' +
    (unmatchedOpps.length ? ' — ' + unmatchedOpps.join(', ') : ''));
  ok(opps.length >= 18, 'and there were enough distinct opponents to be worth checking (' + opps.length + ')');
}

console.log('• briefing: the alias table has not drifted from the app\'s');
{
  /* The same handful of clubs, for the same reason, kept in two places: the
     match model needs it (PLSIM_ALIAS) and this file must stay
     dependency-free. Two copies of a lookup are fine; two copies that
     disagree are a bug that only shows up on one club. */
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const i = html.indexOf('const PLSIM_ALIAS=');
  const src = html.slice(i, html.indexOf('};', i) + 2).replace('const PLSIM_ALIAS=', '');
  const app = new Function('return ' + src)();
  const disagree = Object.keys(app).filter((k) => CLUB_ALIAS[k] && CLUB_ALIAS[k] !== app[k]);
  ok(disagree.length === 0, 'no alias resolves differently in the two tables' +
    (disagree.length ? ' — ' + disagree.map((k) => k + ': ' + app[k] + ' vs ' + CLUB_ALIAS[k]).join(', ') : ''));
  const missing = Object.keys(app).filter((k) => !CLUB_ALIAS[k]);
  ok(missing.length === 0, 'every club the app aliases is aliased here too' +
    (missing.length ? ' — missing: ' + missing.join(', ') : ''));
}

console.log('• briefing: a corrected penalty line replaces the clause, not the name');
{
  /* The bug this is here for, found by looking at --fix's own output. Villa's
     line was "Pens Watkins (Buendia distant 2nd)". Swapping the one word after
     "Pens" produced "Pens Buendia (Buendia distant 2nd)" — the parenthetical
     was written around the old fact and now contradicts the new one. A patch
     that produces a self-contradicting sentence is worse than no patch: it
     reads as researched.

     This mirrors the transformation --fix performs, as a pure function, so it
     can be tested without an API. */
  const rewrite = (sp, was, now, order) => {
    const from = sp.search(/\bPens?(?:alt(?:ies|y))?\b/i);
    if (from < 0) return sp;
    const rest = sp.slice(from);
    const stop = rest.search(/\.(?:\s|$)/);
    const clause = stop < 0 ? rest : rest.slice(0, stop);
    if (!new RegExp(was).test(clause)) return sp;
    return sp.slice(0, from) + 'Pens ' + now +
      ' (FPL order 1; this briefing said ' + was + ', who is order ' + order + ')' +
      (stop < 0 ? '' : rest.slice(stop));
  };
  const before = 'Pens Watkins (Buendia distant 2nd). FK Buendia. Corners Cash, Bailey. Output a question mark — watch.';
  const after = rewrite(before, 'Watkins', 'Buendia', 2);
  ok(/^Pens Buendia \(FPL order 1; this briefing said Watkins, who is order 2\)\./.test(after),
    'the whole first clause is replaced (' + after.slice(0, 60) + '…)');
  ok(!/distant 2nd/.test(after), 'the stale parenthetical goes with it');
  ok(/FK Buendia\. Corners Cash, Bailey\. Output a question mark — watch\.$/.test(after),
    'and everything after the first sentence is the author\'s, untouched');
  ok(/FPL order 1/.test(after),
    'the line says where the correction came from, so a patched claim cannot pass as researched');

  /* A clause with no full stop after it must not lose the rest of the string
     or gain a stray one. */
  const noStop = rewrite('Pens Tavernier/Kluivert share', 'Tavernier', 'Cook', 3);
  ok(noStop === 'Pens Cook (FPL order 1; this briefing said Tavernier, who is order 3)',
    'a sentence with no trailing full stop is handled (' + noStop + ')');

  /* And the case that must be refused: the name is not in the clause at all,
     so there is nothing to correct and the line is left alone. */
  ok(rewrite('Corners Grimes. Pens uncertain', 'Watkins', 'Buendia', 2) ===
    'Corners Grimes. Pens uncertain', 'a clause that never named the player is untouched');
}

console.log('• briefing: the shortlist row is corrected with the club blocks');
{
  /* The row most likely to be read on its own, and quoted. Correcting every
     club block while leaving the summary naming the old takers would leave the
     document contradicting itself in the one place a reader skims.

     A bare bullet list, so a name swap is safe here in a way it was not inside
     the club sentences — there is no surrounding clause written around the old
     fact. Mirrors what --fix does, as a pure function. */
  const swap = (row, fixes) => {
    let out = row, n = 0;
    for (const f of fixes) {
      if (!f.now) continue;
      const re = new RegExp('(^|·\\s*)' + f.was.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '(?=\\s*(·|$))');
      if (!re.test(out)) continue;
      out = out.replace(re, '$1' + f.now); n++;
    }
    return { row: out, n };
  };
  const row = 'Bruno (pens/FK/cnr) · Gibbs-White · Palmer · Igor Thiago · Watkins · Woltemade · Ndiaye · Le Fee · McBurnie · Haji Wright';
  const r = swap(row, [
    { was: 'Watkins', now: 'Buendía' }, { was: 'Gibbs-White', now: 'Wood' },
    { was: 'Le Fee', now: 'Diarra' }, { was: 'McBurnie', now: 'Crooks' },
  ]);
  ok(r.n === 4, 'all four contradicted takers are swapped (' + r.n + ')');
  ok(/· Buendía ·/.test(r.row) && /· Wood ·/.test(r.row), 'by name, in place');
  ok(/· Diarra ·/.test(r.row) && /Crooks ·/.test(r.row), 'including the last two');
  ok(!/Watkins|Gibbs-White|Le Fee|McBurnie/.test(r.row), 'and none of the old names survive');
  /* The ones the API confirmed must be left exactly as they are. */
  ok(/^Bruno \(pens\/FK\/cnr\)/.test(r.row), 'a confirmed taker with a parenthetical is untouched');
  ok(/Palmer/.test(r.row) && /Igor Thiago/.test(r.row) && /Woltemade/.test(r.row) &&
     /Ndiaye/.test(r.row) && /Haji Wright/.test(r.row), 'and every other confirmed name stays');
  ok(r.row.split('·').length === row.split('·').length, 'the row keeps its length — a swap, not an insert');

  /* A club with no single order-1 taker contributes no swap, in the row as in
     the club block, so the two cannot disagree about who was corrected. */
  ok(swap(row, [{ was: 'Watkins', now: null }]).n === 0, 'a club left alone is left alone here too');
  /* And a name that is a substring of another must not be caught by accident. */
  const near = swap('Wilson · Harry Wilson', [{ was: 'Wilson', now: 'X' }]);
  ok(/^X · Harry Wilson$/.test(near.row), 'a bare name does not match inside a longer one (' + near.row + ')');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
