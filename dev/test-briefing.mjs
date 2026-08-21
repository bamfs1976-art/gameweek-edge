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
  teamsFromHtml, claimsFromTeams, fixtureContradictions, moveContradictions,
  pensProseClaims, pensSelfContradictions, mdFixtureClaims,
  departedStillPicked, outNames, pickBullets, DEPARTURE_CUES,
  clubMatcher, samePlayer, CLUB_ALIAS } from '../scripts/briefing-parse.mjs';

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
  /* This assertion used to read the other way — "the last block runs to the
     end of the document" — and it PINNED A BUG. Not being read as a club is
     not the same as being kept out of the club bodies: club 20 was absorbing
     the shortlist, the caveats and the sources, so Hull City's block came
     back for Haaland, Gyokeres, Watkins, Saka and Fernandes, none of whom it
     mentions. A test can hold a defect in place by describing it accurately.
     The question to ask of an assertion is not "is this what the code does"
     but "is this what the code should do". */
  ok(!/Haaland/.test(b[1].body),
    'the last block stops at the next top-level heading, so the shortlist is '
    + 'out of the per-club parse at BOTH ends');
  ok(/body two/.test(b[1].body), 'and the last club still keeps its own body');
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

  /* "(H?)" is the briefing saying it does not know the venue. The shipped
     document no longer has one — Hull's GW1 was written that way until the API
     settled it as home — so the capability is tested on its own rather than on
     the document. Losing the mark would turn a flagged unknown into a claim,
     which is the failure worth guarding whether or not one is in the file
     today. */
  const marked = claimsFromTeams([{ name: 'X', fx: [['1', 'Man Utd (H?)', 'hard'],
    ['2', 'Coventry City (A)', 'vhard']] }]).fixtures;
  ok(marked.length === 2, 'both fixtures parse');
  ok(marked[0].hedged && marked[0].home, 'a "(H?)" venue is carried as unsure, not as a claim');
  ok(!marked[1].hedged, 'and a plain venue is not marked unsure');
  ok(!c.fixtures.some((f) => f.hedged), 'the shipped document has no unsure venues left');
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
  /* This assertion used to be inverted. The opening-fixtures section
     contradicted itself in 23 of its claims — Chelsea and Fulham both away to
     each other in GW1, Brentford and Spurs both at home — and the finding was
     pinned here rather than fixed, because fixing it meant reading the real
     fixture list rather than editing the parser. That has now happened, so the
     assertion is the right way round and this is a regression guard. */
  ok(bad.length === 0, 'the shipped briefing agrees with itself (' +
    bad.map((b) => b.msg).slice(0, 3).join('; ') + ')');
  /* The guard is only worth anything if the comparison ran over real claims. */
  ok(c.fixtures.length >= 50, 'over a full set of fixture claims (' + c.fixtures.length + ')');
  /* Every fixture is stated twice, once by each club, and both statements are
     in the set — so a mutual pair must exist for the check to have teeth. */
  const gw1 = c.fixtures.filter((f) => f.gw === 1);
  ok(gw1.length === 20, 'all 20 clubs state a GW1 fixture (' + gw1.length + ')');
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

/* ── penalties claimed inside the pick rationale ─────────────
   A club names its penalty taker twice — in the set-piece line, and again as
   the reason a player is worth picking. Correcting only the first left five
   clubs recommending someone on the strength of a duty the same document had
   just given to another player, and nothing caught it. */
console.log('\n• briefing: penalty duty asserted in the pick fields');
{
  const T = (o) => Object.assign({ name: 'X', value: '', prem: '', diff: '', sp: '' }, o);

  const one = pensProseClaims([T({ prem: 'Ollie Watkins — nailed striker and penalty taker, the reliable armband.' })]);
  ok(one.length === 1 && one[0].name === 'Ollie Watkins', 'the subject of the sentence is the claimed taker');
  ok(one[0].field === 'prem', 'the field is reported, because that is where the rewrite has to happen');

  /* The subject carries across a sentence break. Reading each sentence alone
     attributed Brentford's penalties to a player called "Nailed". */
  const carry = pensProseClaims([T({ prem: 'Igor Thiago (FWD ~£7.0m) — standout pick. Nailed, on pens, 21 goals.' })]);
  ok(carry.length === 1 && carry[0].name === 'Igor Thiago', 'the antecedent subject is used, not the opening word (' +
    (carry[0] || {}).name + ')');

  /* "backup pens" asserts the opposite of being the taker, so it agrees with
     any set-piece line rather than contradicting it. */
  ok(pensProseClaims([T({ diff: 'Semenyo in a new City role (backup pens/FK, soft openers).' })]).length === 0,
    'a backup claim is not a claim to be the taker');
  ok(pensProseClaims([T({ diff: 'Pino — well under 10%, on FK, in Eze\'s role.' })]).length === 0,
    'free-kicks are not penalties');
  ok(pensProseClaims([T({ prem: 'None obvious. Calvert-Lewin nearest but injury-flagged.' })]).length === 0,
    'a field with no penalty claim yields nothing');

  /* Matching the two halves. They almost never spell a player identically. */
  const contra = (sp, prose) => pensSelfContradictions(
    [{ club: 'X', name: sp }], [{ club: 'X', field: 'prem', name: prose, text: '' }]).length;
  ok(contra('Le Fee', 'Enzo Le Fee') === 0, 'a shared last token is the same player');
  ok(contra('Bruno', 'Bruno Fernandes') === 0, 'so is a single token matching the FIRST name');
  ok(contra('Thiago', 'Igor Thiago') === 0, 'and a single token matching the last');
  ok(contra('Buendía', 'Ollie Watkins') === 1, 'two different players contradict');
  ok(contra('Wood', 'Morgan Gibbs-White') === 1, 'and so do these');
  /* Not a free pass for any shared word: two full names that share only a
     forename are different players. */
  ok(contra('Harry Wilson', 'Wilson Isidor') === 1, 'a shared forename between two full names is not a match');

  /* A club whose set-piece line is silent cannot be contradicted by its picks. */
  ok(pensSelfContradictions([], [{ club: 'X', field: 'prem', name: 'A', text: '' }]).length === 0,
    'no set-piece claim, no contradiction');
}

console.log('\n• briefing: the shipped document, and the regression that broke it');
{
  const teams = teamsFromHtml(readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8'));
  const c = claimsFromTeams(teams);
  ok(c.pensProse.length >= 12, 'the pick fields assert penalties for most clubs (' + c.pensProse.length + ')');
  /* The shipped state. Both halves now name the API's order-1 taker, so this
     has to read clean — a check that cried wolf on a corrected file would get
     switched off within a week. */
  ok(pensSelfContradictions(c.pens, c.pensProse).length === 0,
    'the briefing agrees with itself about who takes penalties');
  /* And every club that was corrected names the right player, so the two halves
     being consistent is not them being consistently wrong again. */
  const spOf = {};
  for (const p of c.pens) spOf[p.club] = p.name;
  /* Bournemouth was on this list until 11 Aug 2026, when Kroupi.Jr — the
     API's order-1 taker — was ruled out for about three months. It is
     asserted separately below as naming nobody. */
  /* Forest and Hull left this list on 13 Aug, deliberately and for the same
     reason Bournemouth did: their set-piece lines asserted a taker their own
     pick bullets contradicted, so both now assert nobody. Asserted below. */
  for (const [club, taker] of [['Aston Villa', 'Buendía'],
    ['Sunderland', 'Diarra'], ['Ipswich Town', 'Hirst']]) {
    ok(spOf[club] === taker, club + ' set-piece line names ' + taker + ' (' + spOf[club] + ')');
  }

  /* The regression this check exists to catch, reproduced: put the old takers
     back in the set-piece lines only — which is the half --fix used to rewrite
     — and the picks that lean on those penalties must light up. Asserted as the
     historical six, so a parser that silently stops reading a pick field cannot
     pass by finding fewer. */
  const was = { 'Aston Villa': 'Watkins', Bournemouth: 'Tavernier', Sunderland: 'Le Fee',
    'Nottingham Forest': 'Gibbs-White', 'Ipswich Town': 'Clarke', 'Hull City': 'McBurnie' };
  const broken = pensSelfContradictions(
    c.pens.map((p) => (was[p.club] ? { ...p, name: was[p.club] } : p)), c.pensProse);
  /* Five, not the historical six: Bournemouth's set-piece line no longer
     asserts a taker at all (see below), so there is nothing there to revert. */
  /* Three now, not five: Forest and Hull joined Bournemouth in asserting no
     taker on 13 Aug, so there is nothing in their set-piece lines to revert. */
  ok(broken.length === 3, 'reverting the set-piece lines alone strands 3 picks (' + broken.length + ')');

  /* Kroupi.Jr was FPL order 1 and is out roughly three months from 11 Aug
     2026. The briefing therefore names NOBODY as Bournemouth's penalty
     taker, which is the honest state and the one the parser is built to
     accept — `unresolved` is in its skip list precisely so a document can
     say "we do not know" without a checker inventing a claim from it.
     Pinned so that a future edit cannot quietly reinstate a taker who is
     injured, nor leave the club asserting one when the order is open. */
  ok(!c.pens.some((p) => p.club === 'Bournemouth'),
    'Bournemouth asserts no penalty taker while its order-1 man is injured');
  ok(c.pensProse.some((p) => p.club === 'Bournemouth' && p.hedged),
    'and the pick text that mentions the promotion is hedged rather than stated');
  const clubs = broken.map((s) => s.club);
  /* Bournemouth dropped out of this list on 11 Aug 2026 for the same reason
     as above: with no taker asserted in its set-piece line there is nothing
     for the revert to strand. */
  for (const club of ['Aston Villa', 'Sunderland']) {
    ok(clubs.indexOf(club) > -1, club + ' is reported');
  }
  /* The three clubs that now claim no taker cannot be stranded by a revert,
     and each is asserted as claiming none rather than merely being absent —
     absence would also be what a broken parser produced. */
  for (const club of ['Bournemouth', 'Nottingham Forest', 'Hull City']) {
    ok(clubs.indexOf(club) < 0, club + ' is not, because it now claims no taker to revert');
    ok(!c.pens.some((p) => p.club === club), 'and ' + club + ' really does assert none');
  }
  ok(clubs.filter((x) => x === 'Sunderland').length === 2, 'Sunderland twice — it makes the claim in two fields');
  /* Ipswich's takers changed too, but its pick fields never claimed the
     penalties, so it must NOT appear. A check that flagged every corrected club
     would be counting rewrites rather than reading the document. */
  ok(clubs.indexOf('Ipswich Town') < 0, 'a club whose picks make no penalty claim is not reported');
}

/* ── the two editions must state the same fixtures ───────────
   The HTML edition holds the fixtures as data and gets checked against the API
   on every run. The markdown edition holds the same fixtures as prose and was
   checked by nothing at all, so it drifted a season out of date in silence
   while every test stayed green. This is the guard that makes that loud. */
console.log('\n• briefing: both editions state the same opening fixtures');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const teams = teamsFromHtml(readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8'));
  const prose = mdFixtureClaims(clubBlocks(md));
  ok(prose.length >= 50, 'the prose edition states opening fixtures per club (' + prose.length + ')');

  /* The two editions abbreviate club names differently — "Nottingham Forest"
     reads better in a sentence than in a fixture chip — so the comparison goes
     through the same alias table the checker uses. */
  const short = { 'Nottingham Forest': 'Nott\'m Forest', Tottenham: 'Spurs' };
  const key = (c) => c.club + '|' + c.gw;
  const htmlBy = {};
  for (const t of teams) {
    for (const f of t.fx || []) {
      const m = String(f[1]).match(/^(.*?)\s*\((H|A)\)\s*$/);
      if (m) htmlBy[t.name + '|' + f[0]] = { opp: m[1].trim(), home: m[2] === 'H', band: f[2] };
    }
  }
  let matched = 0, missing = 0;
  const drift = [];
  for (const c of prose) {
    const h = htmlBy[key(c)];
    if (!h) { missing++; continue; }
    const opp = short[c.opp] || c.opp;
    if (opp === h.opp && c.home === h.home && c.band === h.band) matched++;
    else drift.push(c.club + ' GW' + c.gw + ': prose "' + opp + (c.home ? ' (H) ' : ' (A) ') +
      c.band + '" vs data "' + h.opp + (h.home ? ' (H) ' : ' (A) ') + h.band + '"');
  }
  for (const d of drift.slice(0, 6)) ok(false, d);
  ok(!drift.length, 'every prose fixture matches the structured one (' + drift.length + ' drifted)');
  ok(!missing, 'every prose fixture has a structured counterpart (' + missing + ' orphaned)');
  ok(matched >= 50, 'and the comparison actually ran (' + matched + ' matched)');

  /* And the other direction, which the check above cannot see. Comparing only
     prose→data passes cleanly when the DATA gains fixtures the prose never
     mentions — which is exactly what happens the next time --fix fills a club
     out to a full opening window. One-way drift detection is how the markdown
     edition got a season out of date in the first place. */
  const proseKeys = new Set(prose.map(key));
  const orphanData = Object.keys(htmlBy).filter((k) => !proseKeys.has(k));
  for (const k of orphanData.slice(0, 6)) {
    ok(false, 'structured fixture with no prose counterpart: ' + k + ' ' + htmlBy[k].opp);
  }
  ok(!orphanData.length, 'every structured fixture is narrated in the prose too (' +
    orphanData.length + ' unnarrated)');
  ok(prose.length === Object.keys(htmlBy).length, 'the two editions state the same NUMBER of ' +
    'fixtures (prose ' + prose.length + ', data ' + Object.keys(htmlBy).length + ')');
}

/* The pre-season role watch records dead-ball evidence that CONTRADICTS the
   club register — "Mbeumo took a penalty" sits a few lines from a register
   that says Manchester United's penalties are Bruno's. That is the point of
   it: the register is what we believe, the watch is the case against it.

   It only works while the two stay apart. clubBlocks runs its last block to
   the end of the file, so a section moved below the club list is absorbed
   into Hull City's body — the watch's contradicting names become Hull's
   prose as far as every parser is concerned.

   Today that stops short of a wrong penalty claim only because penaltyClaims
   takes the FIRST "Set-piece & penalties" line in a block and Hull's own line
   comes first. That is luck, not design: it depends on ordering inside a
   function that has no idea this section exists, and priceClaims and
   moveClaims read the block body with no such protection. So the guard is on
   the arrangement rather than on one symptom of breaking it. */
console.log('\n• briefing: the role watch stays out of the club register');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const watchAt = md.indexOf('## Pre-season role watch');
  const firstClub = md.search(/^## 1\.\s/m);
  ok(watchAt > -1, 'the role watch section is present');
  ok(firstClub > -1 && watchAt < firstClub,
    'and sits ABOVE the first club, where no club block can swallow it');

  /* Proved rather than reasoned: the names it names must not surface as
     claims about any club. */
  const blocks = clubBlocks(md);
  const pens = penaltyClaims(blocks);
  const strays = pens.filter((p) => /^(Tel|Tzolis|Mbeumo)$/.test(p.name));
  ok(!strays.length, 'no watch name is read as a penalty taker (' + JSON.stringify(strays) + ')');
  ok(!blocks.some((b) => /role watch/i.test(b.name)), 'and the watch is not read as a club');

  /* The register is deliberately NOT rewritten from a highlights reel. If a
     future edit does change it, that is a decision worth making on purpose —
     this fails so it cannot happen by drift. */
  const mu = pens.find((p) => /United/.test(p.club));
  ok(mu && mu.name === 'Bruno',
    'the United penalty claim still names Bruno despite the Mbeumo signal (' + JSON.stringify(mu) + ')');
}

/* ── the outside ranking ────────────────────────────────────
   A third party's attack/defence ranks for all 20 clubs, added 12 Aug. It is
   NOT ours, and the risk it carries is the same one the role watch carries:
   it names twenty clubs a few lines from a register that ranks them
   differently, and clubBlocks runs its last block to the end of the file. Put
   below the register, every one of those names becomes Hull City's prose.

   The second guard is on what the section is FOR. The source is a
   38-gameweek fixture grid read from a screenshot, and the one thing this
   project must never do with it is copy a cell: three-letter codes at that
   resolution do not separate home from away, and both editions already
   promise in writing that no fixture comes from it. That promise is only
   worth something if breaking it fails. So the fixture count is pinned —
   if a hand-copied fixture appears, the number moves and this goes red
   before anybody has to notice the venue is wrong. --fix moving it is
   equally worth a deliberate look, which is why the assertion is on the
   exact figure rather than on a floor. */
console.log('\n• briefing: the outside ranking is quarantined from the register');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const outsideAt = md.indexOf('## Outside view');
  const firstClub = md.search(/^## 1\.\s/m);
  ok(outsideAt > -1, 'the outside view section is present');
  ok(firstClub > -1 && outsideAt < firstClub,
    'and sits ABOVE the first club, where no club block can swallow its twenty club names');

  /* Proved, not reasoned: none of it reaches a club claim. */
  const blocks = clubBlocks(md);
  ok(!blocks.some((b) => /Outside view/i.test(b.name)), 'the section is not read as a club');
  /* Hull's body runs to the end of the FILE — the caveats and the source list
     are already inside it, and that is long-standing. So the assertion is on
     the twenty-club table specifically, which is the part that would put
     nineteen other clubs' names into Hull's prose. */
  const hull = blocks.find((b) => /Hull/.test(b.name));
  ok(hull && !/\|\s*Man City\s*\|\s*1\s*\|/.test(hull.body),
    'and the twenty-club rank table has not landed inside the last club block');

  /* Both editions must carry the same ranks, or the two disagree about
     somebody else's numbers — which is worse than not carrying them. */
  for (const [club, atk, def] of [['Man City', 1, 2], ['Arsenal', 3, 1], ['Hull City', 20, 20]]) {
    const short = { 'Man City': 'MCI', Arsenal: 'ARS', 'Hull City': 'HUL' }[club];
    ok(new RegExp('\\|\\s*' + club + '\\s*\\|\\s*' + atk + '\\s*\\|\\s*' + def + '\\s*\\|').test(md),
      'the markdown states ' + club + ' ' + atk + '/' + def);
    ok(html.includes(short + ' ' + atk + ' ·') || html.includes(short + ' ' + atk + '</span>'),
      'and the html edition agrees on ' + short + '\'s attack rank');
  }

  /* The unread pairs stay marked. Guessing one to tidy the column is the
     failure mode this asterisk exists to prevent. */
  ok(/unread rather than\s*\n?guessed/.test(md) || /unread rather than guessed/.test(md),
    'the two unreadable ranks are still recorded as unread rather than guessed');

  /* No fixture may be hand-copied out of the grid. */
  const teams = teamsFromHtml(html);
  const stated = teams.reduce((n, t) => n + (t.fx || []).length, 0);
  ok(stated === 79, 'the document still states 79 opening fixtures — a hand-copied cell, or ' +
    '--fix filling the gaps, would move this and both are worth looking at (' + stated + ')');
  ok(/no fixture below is rewritten from it|Nothing in the\s*\n?fixture blocks below is rewritten from this image/i.test(md),
    'and the markdown still promises no fixture comes from the image');
}

/* ── the season calendar ────────────────────────────────────
   Thirty-eight dates, carried twice. The fixture prose already drifted a
   whole season out of date in one edition while the other stayed right, and
   nothing caught it — this is the same shape of data with the same failure
   available, so it gets the same treatment.

   The third guard is the one that matters most. The calendar's blank and
   double gameweeks are a third party's FORECAST. The document says in both
   editions that nothing in the app reads them, and that promise is only
   worth something if breaking it fails: the source must stay inside docs/.
   Wiring a projected blank into the chip planner would change live advice
   on the strength of results that have not happened. */
console.log('\n• briefing: the season calendar agrees with itself and stays out of the app');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const shapeAt = md.indexOf('## Season shape');
  const firstClub = md.search(/^## 1\.\s/m);
  ok(shapeAt > -1 && firstClub > -1 && shapeAt < firstClub,
    'the season shape section sits above the club register');

  const dates = (s) => {
    const out = {};
    for (const m of s.matchAll(/GW(\d+) ([A-Z][a-z]{2}) (\d+)/g)) out[+m[1]] = m[2] + ' ' + m[3];
    return out;
  };
  const a = dates(md), b = dates(html);
  const gws = Object.keys(a).map(Number).sort((x, y) => x - y);
  ok(gws.length === 38 && gws[0] === 1 && gws[37] === 38,
    'the markdown states all 38 gameweeks (' + gws.length + ')');
  const drift = gws.filter((g) => a[g] !== b[g]);
  for (const g of drift.slice(0, 5)) {
    ok(false, 'GW' + g + ': markdown "' + a[g] + '" vs html "' + b[g] + '"');
  }
  ok(!drift.length, 'and the html edition states the same date for every one of them');

  /* A calendar that runs backwards is the signature of a mis-read date, and
     it is the one error a reader would not spot in a wall of them. Months
     Aug-Dec are 2026, Jan-May 2027. */
  const MON = { Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11, Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4 };
  let last = -Infinity, backwards = null;
  for (const g of gws) {
    const [mon, day] = a[g].split(' ');
    const t = Date.UTC(MON[mon] >= 7 ? 2026 : 2027, MON[mon], +day);
    if (t <= last) { backwards = 'GW' + g + ' (' + a[g] + ') does not come after GW' + (g - 1); break; }
    last = t;
  }
  ok(!backwards, 'the dates run forwards from August to May (' + (backwards || 'they do') + ')');

  /* GW1's date must be the same day the rest of the document names as the
     season start, or the file states two start dates in two places. */
  const start = (md.match(/Season starts (\w+) (\d{1,2}) August 2026/) || [])[2];
  ok(start && a[1] === 'Aug ' + start,
    'GW1 in the calendar is the same day as the stated season start (' + a[1] + ' vs Aug ' + start + ')');

  /* The forecast stays in the briefing. */
  const leaked = ['index.html', 'scripts/chipplan-parts.mjs', 'netlify/functions/euro-fixtures.js']
    .filter((f) => /BenCrellin/i.test(readFileSync(join(ROOT, f), 'utf8')));
  ok(!leaked.length, 'the blank/double forecast has not reached app code (' + leaked.join(', ') + ')');
  for (const [ed, src] of [['markdown', md], ['html', html]]) {
    ok(/forecast, not a schedule|is a forecast|Forecast, not schedule/i.test(src),
      'the ' + ed + ' edition still labels the blank/double weeks a forecast');
  }
}

/* ── the GW9-18 grid ────────────────────────────────────────
   Transcribed from a screenshot, which is the one thing this file has said
   twice it will not do — so it is checked rather than trusted, and the check
   ships instead of the claim that it passed once.

   Every gameweek is ten fixtures. Each pair is stated twice, by both clubs,
   and exactly one of the two must be home. A mis-read three-letter code
   breaks the mirror; a mis-read CASE puts both clubs at home. That is the
   same property the fixture-contradiction pass uses on the club register,
   applied to a table the register does not own — and it is what separates
   this grid from the 11 August one, whose cells were used for nothing
   precisely because nothing could check them. */
console.log('\n• briefing: the GW9-18 grid pairs cleanly, or it is a mis-read');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const rows = {};
  /* Only the grid's own rows: three capitals, then ten short cells. */
  for (const m of md.matchAll(/^\| ([A-Z]{3}) \| ((?:[A-Za-z]{3} \| ){9}[A-Za-z]{3}) \|$/gm)) {
    rows[m[1]] = m[2].split(' | ').map((s) => s.trim());
  }
  const clubs = Object.keys(rows);
  ok(clubs.length === 20, 'the grid states twenty clubs (' + clubs.length + ')');

  let broken = 0, fixtures = 0;
  for (let i = 0; i < 10; i++) {
    const gw = i + 9, seen = new Set();
    for (const club of clubs) {
      const cell = rows[club][i], opp = cell.toUpperCase(), home = cell === opp;
      const mirror = rows[opp] && rows[opp][i];
      if (!mirror) {
        if (broken++ < 4) ok(false, 'GW' + gw + ': ' + club + ' names ' + opp + ', which has no row');
        continue;
      }
      if (mirror.toUpperCase() !== club) {
        if (broken++ < 4) {
          ok(false, 'GW' + gw + ': ' + club + ' plays ' + opp + ' but ' + opp +
            ' plays ' + mirror.toUpperCase());
        }
        continue;
      }
      /* Both upper case, or both lower case, means both claim the same venue. */
      if ((mirror === mirror.toUpperCase()) === home) {
        if (broken++ < 4) {
          ok(false, 'GW' + gw + ': ' + club + ' and ' + opp + ' BOTH claim ' +
            (home ? 'home' : 'away'));
        }
        continue;
      }
      seen.add([club, opp].sort().join(' v '));
    }
    if (seen.size !== 10) { broken++; ok(false, 'GW' + gw + ' resolves to ' + seen.size + ' fixtures, not 10'); }
    fixtures += seen.size;
  }
  ok(!broken, 'every pair mirrors with one home and one away (' + broken + ' broken)');
  ok(fixtures === 100, 'and the grid states 100 fixtures across GW9-18 (' + fixtures + ')');

  /* Five cells the live fixture list confirmed independently, through the
     captain weeks our own chip planner picked off the API. If a future edit
     moves one of these, the grid has drifted from the real season and not
     merely from itself — which the pairing check above cannot see. */
  for (const [club, gw, cell] of [['MCI', 16, 'HUL'], ['MCI', 13, 'LEE'], ['MCI', 9, 'BHA'],
    ['MUN', 14, 'COV'], ['MUN', 18, 'SUN']]) {
    ok(rows[club] && rows[club][gw - 9] === cell,
      club + ' GW' + gw + ' is ' + cell + ' at home, as the live list had it (' +
      ((rows[club] || [])[gw - 9] || 'missing') + ')');
  }

  /* The whole GW15 round, from a dated fixture card posted alongside the
     grid — an independent statement of one entire column, home side listed
     first. Pinned as a block rather than as five more samples, because a
     column is the unit a mis-read would move. */
  const CARD15 = [['ARS', 'BOU'], ['BHA', 'EVE'], ['COV', 'AVL'], ['CRY', 'MUN'], ['FUL', 'BRE'],
    ['HUL', 'TOT'], ['IPS', 'NEW'], ['LIV', 'LEE'], ['MCI', 'CHE'], ['SUN', 'NFO']];
  const off = CARD15.filter(([h, a]) =>
    !(rows[h] && rows[h][6] === a.toUpperCase() && rows[a] && rows[a][6] === h.toLowerCase()));
  for (const [h, a] of off.slice(0, 4)) {
    ok(false, 'GW15 card says ' + h + ' v ' + a + ', grid has ' + h + '→' +
      ((rows[h] || [])[6] || '?') + ', ' + a + '→' + ((rows[a] || [])[6] || '?'));
  }
  ok(!off.length, 'all ten GW15 fixtures match the dated card (' + off.length + ' off)');

  /* The card is dated Sat 12 Dec 2026, which is also a claim about the
     calendar section above. The two were transcribed from different sources
     on different days, so they can disagree. */
  const gw15 = (md.match(/GW15 ([A-Z][a-z]{2} \d+)/) || [])[1];
  ok(gw15 === 'Dec 12', 'the calendar puts GW15 on the card\'s date (' + gw15 + ' vs Dec 12)');
  ok(new Date(Date.UTC(2026, 11, 12)).getUTCDay() === 6, 'and 12 Dec 2026 is the Saturday the card names');
}

/* ── transfers, checked against each other ──────────────────
   Three previews in three days each turned up a signing this document had
   recorded at one end and not the other: Welbeck out of Brighton but never
   into Chelsea, Henderson out of Brentford but never into Chelsea, Rushworth
   out of Brighton but never into Coventry. Every one was caught by somebody
   reading a newspaper, which is not a system, and the sweep that followed
   found ten more — a £116m club-record sale and a promoted club's
   first-choice goalkeeper among them.

   A contradicted FIXTURE is visibly wrong: two clubs say different things.
   A missing transfer half is invisible — the block simply reads as a thinner
   squad and the pick list underneath never mentions the player. That is why
   it lasted. */
console.log('\n• briefing: a transfer is recorded by both clubs, or by neither');
{
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const teams = teamsFromHtml(html);
  const structured = claimsFromTeams(teams);
  const names = teams.map((t) => t.name);

  const badHtml = moveContradictions(structured.moves, names);
  for (const b of badHtml.slice(0, 6)) ok(false, 'html: ' + b.msg);
  ok(!badHtml.length, 'the structured edition has no one-sided transfer (' + badHtml.length + ')');

  const blocks = clubBlocks(md);
  const badMd = moveContradictions(moveClaims(blocks), blocks.map((b) => b.name));
  for (const b of badMd.slice(0, 6)) ok(false, 'markdown: ' + b.msg);
  ok(!badMd.length, 'and neither does the prose edition (' + badMd.length + ')');

  /* Proved rather than assumed: plant one and it must be caught. */
  const planted = [
    { club: 'Arsenal', dir: 'In', name: 'Nobody Atall', text: 'Nobody Atall (CM, Everton, ~£1m)' },
    { club: 'Everton', dir: 'Out', name: 'Someone Else', text: 'Someone Else (CM, Arsenal, ~£1m)' }
  ];
  const caught = moveContradictions(planted, names);
  ok(caught.length === 2, 'a planted one-sided move is caught from both ends (' + caught.length + ')');

  /* And the exclusions hold, or the check becomes noise nobody reads. */
  const quiet = moveContradictions([
    { club: 'Arsenal', dir: 'Out', name: 'A Player', text: 'A Player (CM, Real Madrid, ~£1m)' },
    { club: 'Arsenal', dir: 'Out', name: 'B Player', text: 'Rumour: B Player (CM, Everton) unconfirmed' },
    { club: 'Arsenal', dir: 'Out', name: 'C Player', text: 'C Player (released)' }
  ], names);
  ok(!quiet.length, 'a sale abroad, a rumour and a release raise nothing (' + quiet.length + ')');

  /* A completed LOAN has two ends like any other move, and must NOT be
     excluded — "loan made permanent" carries the word "loan", and a filter
     that skipped it is exactly what let Rushworth through. */
  const loan = moveContradictions([
    { club: 'Chelsea', dir: 'Out', name: 'D Player', text: 'D Player (W, Aston Villa, season loan)' }
  ], names);
  ok(loan.length === 1, 'a loan is still checked (' + loan.length + ')');
}

/* The club matcher used to accept a PREFIX between words as its last resort.
   Every label it had ever been given was a Premier League club, so nothing
   met a foreign one and the rule never misfired. Fed the selling club out of
   a transfer line it did so at once, turning Villarreal into Aston Villa and
   New England Revolution into Newcastle — which would have invented two
   contradictions and, worse, could mis-assign a real claim. */
console.log('\n• briefing: the club matcher does not turn Villarreal into Aston Villa');
{
  const teams = teamsFromHtml(readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8'));
  const match = clubMatcher(teams.map((t) => t.name));
  for (const [label, want] of [["Nott'm Forest", 'Nottingham Forest'], ['Forest', 'Nottingham Forest'],
    ['Spurs', 'Tottenham Hotspur'], ['Man Utd', 'Manchester United'],
    ['Brighton', 'Brighton & Hove Albion'], ['Villa', 'Aston Villa']]) {
    const got = match(label);
    ok(got === want, '"' + label + '" still resolves to ' + want + ' (' + got + ')');
  }
  for (const label of ['Villarreal', 'New England Revolution', 'Nordsjaelland', 'Eintracht Frankfurt']) {
    const got = match(label);
    ok(!got, '"' + label + '" resolves to no Premier League club (' + (got || 'none') + ')');
  }
}

/* ── European qualification ─────────────────────────────────
   Four of the five European qualifiers were missing from this file, and all
   four were found by an outside source rather than by us: Bournemouth on 11
   Aug, Brighton on the 12th, Sunderland on the 13th. Each is a
   Thursday-Sunday schedule and therefore a rotation warning on every asset
   at that club — the single biggest thing a pre-season register can omit
   without looking wrong, because an absent fact reads exactly like a fact
   that does not apply.

   Pinned so the knowledge cannot be lost again in an edit. Chelsea is in the
   list too, for the opposite reason: having NO European football is a real
   scheduling advantage, and it is only visible if somebody writes it down. */
console.log('\n• briefing: every European qualifier says so in its own block');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const blocks = clubBlocks(md);
  const EUROPE = [
    ['Aston Villa', /champions league|\bUCL\b/i],
    ['Bournemouth', /europa|european campaign/i],
    ['Brighton', /conference league/i],
    ['Sunderland', /europa/i],
    /* Palace was the one qualifier whose competition this file would not
       name: it held the Conference League trophy, which does not by itself
       say what it enters next. The block said so in bold rather than
       guessing, and the 13 Aug preview settled it as the EUROPA LEAGUE — so
       the assertion tightens from "mentions the trophy" to "names the
       competition", and Palace joins the clubs that must also carry the
       rotation tax. A flag that closes should cost the test something. */
    ['Crystal Palace', /europa league/i],
    ['Chelsea', /no european football/i]
  ];
  for (const [club, re] of EUROPE) {
    const b = blocks.find((x) => x.name.indexOf(club) === 0);
    ok(b && re.test(b.body), club + ' states its European situation in its own block');
    /* Naming the competition is not enough — the schedule is the FPL fact. */
    if (b && ['Bournemouth', 'Brighton', 'Sunderland', 'Crystal Palace'].includes(club)) {
      ok(/rotation/i.test(b.body), club + ' also carries the rotation warning that follows from it');
    }
  }
}

/* pensSelfContradictions reads the STRUCTURED edition only. The prose edition
   carries the same two claims — a set-piece line and a pick rationale — and
   nothing was comparing them, which is how Sunderland's value bullet came to
   say Le Fee was "on pens and free-kicks" four rows above a set-piece line
   giving the penalties to Diarra. The HTML edition had been corrected; the
   markdown had not, so the two editions disagreed as well. */
console.log('\n• briefing: the prose edition does not contradict its own set-piece line');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const blocks = clubBlocks(md);
  const sp = {};
  for (const p of penaltyClaims(blocks)) sp[p.club] = p.name;
  const NOT_NAME = /^(a|an|the|no|none|nailed|thin|both|neither|watch|expect|if|on|his|her|their|treat|every|this|that|these|those|still|now|one|two|three|read|set|against|watkins is)\b/i;
  const bad = [];
  for (const b of blocks) {
    const primary = sp[b.name];
    if (!primary) continue;
    for (const line of b.body.split('\n')) {
      if (!/^-\s*(Value|Premium|Differentials)/i.test(line.trim())) continue;
      /* Only a claim to TAKE them; "not on penalties" and "backup pens" are
         agreements with the set-piece line, not challenges to it. */
      let subject = null;
      for (const sentence of line.replace(/^-\s*\w+[^:]*:\s*/i, '').split(/\.(?:\s|$)/)) {
        const nm = sentence.match(/^\s*\*{0,2}([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,2})/u);
        if (nm && !NOT_NAME.test(nm[1])) subject = nm[1].trim();
        if (!/\bpens?\b|\bpenalt/i.test(sentence)) continue;
        if (/\bnot\b|backup|second|2nd|deputy|behind|unresolved|whatever|used to/i.test(sentence)) continue;
        if (!subject) continue;
        if (!samePlayer(subject, primary)) {
          bad.push(`${b.name}: the set-piece line says ${primary}, a pick bullet says ${subject}`);
        }
      }
    }
  }
  for (const b of bad.slice(0, 5)) ok(false, b);
  ok(!bad.length, 'no prose pick claims a penalty duty the same block assigns elsewhere (' + bad.length + ')');
}

/* "Thin post-Eze/Guehi. Mateta (~£7.5m)" made the price parser read a player
   called "Guehi. Mateta" — the name class has to allow a dot for B.Fernandes,
   and a slash-joined surname ran straight into the next sentence. Harmless
   until a price check quotes the name back at somebody. */
console.log('\n• briefing: the Palace price claim names a real player');
{
  const teams = teamsFromHtml(readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8'));
  const prices = claimsFromTeams(teams).prices.filter((p) => p.club === 'Crystal Palace');
  ok(prices.length > 0, 'Palace states prices at all (' + prices.length + ')');
  const junk = prices.filter((p) => /\./.test(p.name) && !/^[A-Z]\.[A-Z]/.test(p.name));
  for (const j of junk) ok(false, 'price claim for a non-name: "' + j.name + '"');
  ok(!junk.length, 'and none of them ran two sentences together (' + junk.length + ')');
}

/* The start date was wrong by a day and only one edition stated it, so the
   error had nowhere to be caught. Both state it now, and they must agree. */
console.log('\n• briefing: both editions state the same start date');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const dateOf = (s) => (s.match(/Season starts (\w+ \d{1,2} August 2026)/) || [])[1];
  const a = dateOf(md), b = dateOf(html);
  ok(a, 'the markdown edition states a start date (' + a + ')');
  ok(b, 'the html edition states one too (' + b + ')');
  ok(a === b, 'and they agree (' + a + ' vs ' + b + ')');
  /* 21 August 2026 is a Friday. A date that names the wrong weekday is the
     exact error being corrected here, so the pairing is checked, not assumed. */
  const [wd, dd] = String(a || '').split(' ');
  const actual = new Date(Date.UTC(2026, 7, Number(dd)))
    .toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  ok(wd === actual, 'the weekday matches the date (' + wd + ' ' + dd + ' August 2026 is a ' + actual + ')');

  /* The deadline, added 13 Aug once the API settled it. This is now the
     load-bearing half of the claim — four sources agreed the DATE while none
     of them was the deadline, and the deadline is the only version a manager
     is bound by. Both editions quote it, so both can drift. */
  const dl = (s) => (s.match(/2026-08-\d{2}T\d{2}:\d{2}:\d{2}Z/) || [])[0];
  const x = dl(md), y = dl(html);
  ok(x, 'the markdown quotes the GW1 deadline (' + x + ')');
  ok(x === y, 'and the html edition quotes the same one (' + x + ' vs ' + y + ')');
  /* The deadline must fall on the day the file names as the start, or the
     document is quoting a timestamp that contradicts its own headline. */
  const day = new Date(x).toISOString().slice(8, 10);
  ok(Number(day) === Number(dd),
    'the deadline falls on the stated start date (' + day + ' vs ' + dd + ')');
  /* And it must still be a real deadline rather than a stale copy from a
     season already gone — the same rollover trap the freshness check exists
     for, applied to the number this document hard-codes. */
  ok(new Date(x).getUTCFullYear() === 2026, 'and it is this season\'s, not last season\'s');
}

/* ── the market snapshot, and what is safe to assert about it ─────────
   docs/benchmarks/pl-gw1-market-odds.json is a dated capture of a
   betting-odds-derived projection, taken a week before the GW1 deadline so
   that git history proves it predates the football.

   The PROBABILITIES are not asserted here and must not be. They are a
   snapshot of a moving market; a test that pinned 60.3% would fail the next
   time somebody re-read the page and would be recording a moment rather than
   a rule. What IS durable is the fixture list underneath them — an
   independent source's opponent-and-venue pairs, which cannot drift — and
   the internal consistency of the file itself. */
console.log('\n• briefing: the market snapshot agrees with our GW1 fixtures');
{
  const snap = JSON.parse(readFileSync(join(ROOT, 'docs/benchmarks/pl-gw1-market-odds.json'), 'utf8'));
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const teams = teamsFromHtml(html);

  ok(Date.parse(snap.capturedAt) < Date.parse(snap.deadlineAt),
    'the capture predates the deadline, which is the only reason it is worth keeping');
  ok(snap.cleanSheets.length === 20, '20 rows, one per club (' + snap.cleanSheets.length + ')');

  /* Every row against our own GW1 line. This is the assertion that earns the
     file: two documents built for different purposes, from different
     upstreams, agreeing on all twenty opponent-and-venue pairs. */
  const SHORT = { Brighton: 'Brighton & Hove Albion', Leeds: 'Leeds United',
    Newcastle: 'Newcastle United', Spurs: 'Tottenham Hotspur',
    'Man Utd': 'Manchester United', 'Man City': 'Manchester City',
    "Nott'm Forest": 'Nottingham Forest' };
  let matched = 0;
  for (const row of snap.cleanSheets) {
    const t = teams.find((x) => x.name === row.team);
    if (!t) { ok(false, 'no block for ' + row.team); continue; }
    const gw1 = (t.fx || []).find((f) => String(f[0]) === '1');
    if (!gw1) { ok(false, 'no GW1 fixture for ' + row.team); continue; }
    const m = String(gw1[1]).match(/^(.*)\s\((H|A)\)$/);
    /* Our fx cells use display shorthand ("Man Utd", "Nott'm Forest"); the
       snapshot stores full block names. Compare on the resolved name. */
    const oursOpp = m && (SHORT[m[1]] || m[1]);
    const theirs = row.opp;
    const same = oursOpp && (oursOpp === theirs
      || theirs.indexOf(oursOpp) === 0 || oursOpp.indexOf(theirs) === 0);
    ok(same && m[2] === row.venue,
      row.team + ' GW1: ours ' + gw1[1] + ' vs theirs ' + theirs + ' (' + row.venue + ')');
    if (same && m[2] === row.venue) matched++;
    /* The difficulty stored beside each row must be the one our register
       actually holds, or the band comparison in the briefing is comparing
       against a copy that has since drifted. */
    ok(row.ourDifficulty === gw1[2],
      row.team + ' carries our CURRENT difficulty label (' + row.ourDifficulty + ' vs ' + gw1[2] + ')');
  }
  ok(matched === 20, 'all 20 opponent-and-venue pairs agree (' + matched + ')');
  ok(snap.verifiedAgainstOurRegister.fixturesAgreeing === matched,
    'and the count recorded in the file is the count the test just measured');

  /* 20 rows are 10 games seen twice. Both halves present, and two clean
     sheets in one match is a 0-0 — possible, so the pair may sum high, but
     never above 100 unless the conversion is broken. */
  const by = Object.fromEntries(snap.cleanSheets.map((r) => [r.team, r]));
  const games = new Set();
  for (const r of snap.cleanSheets) {
    const other = snap.cleanSheets.find((x) => x.team.indexOf(r.opp) === 0 || r.opp.indexOf(x.team) === 0);
    ok(!!other, r.team + "'s opponent " + r.opp + ' has its own row');
    if (!other) continue;
    ok(other.venue !== r.venue, r.team + ' v ' + other.team + ': exactly one side is at home');
    ok(r.anyCS + other.anyCS <= 100,
      r.team + ' v ' + other.team + ' clean-sheet pair sums to ' + (r.anyCS + other.anyCS).toFixed(1));
    games.add([r.team, other.team].sort().join('|'));
  }
  ok(games.size === 10, '20 rows resolve to 10 games (' + games.size + ')');
  ok(by['Arsenal'].anyCS > by['Coventry City'].anyCS,
    'and the direction is sane: the champions at home are likelier to shut out the promoted side');

  /* The player rows only make sense against the ten games in the same file. */
  const codes = new Set();
  for (const r of snap.cleanSheets) codes.add(r.team);
  for (const p of snap.players) {
    ok(/^[A-Z]{3}-[A-Z]{3}$/.test(p.fixture), p.name + ' has a well-formed fixture code');
    ok(p.anyReturn >= Math.max(p.goal, p.assist),
      p.name + ': any-return is at least as likely as either leg alone');
  }
  ok(snap.whatThisIsNot.some((s) => /Assuming player starts/i.test(s)),
    'the minutes caveat is on the file, not just in the prose that quotes it');

  /* ── the fixture-swing grid ────────────────────────────────────────
     The internal checks are asserted because they are what established how
     to READ the grid, and a later re-capture that broke them would mean the
     transcription is wrong. The metric's meaning is NOT asserted: it is an
     unconfirmed hypothesis and the file says so. A test that pinned "this is
     a 5-gameweek mean" would be promoting a guess to a fact by putting it
     somewhere that goes green. */
  const sw = snap.fixtureSwing;
  ok(sw.grid.length === 10, 'ten gameweeks captured (' + sw.grid.length + ')');
  let badge = 0, sorted = 0;
  for (const row of sw.grid) {
    const at = row.easiest.findIndex((c) => c[0] === 'Arsenal');
    /* Arsenal's printed rank must equal where Arsenal sits, or exceed the
       seven shown when absent. This is the check that proves the row is
       ordered easiest-first, which everything else about the grid rests on. */
    if (at >= 0 ? at + 1 === row.arsenalRank : row.arsenalRank > row.easiest.length) badge++;
    const v = row.easiest.map((c) => c[1]);
    if (v.every((x, i) => i === 0 || x >= v[i - 1])) sorted++;
  }
  ok(badge === 10, "Arsenal's printed rank matches its position in every row (" + badge + '/10)');
  ok(sorted === 10, 'every row is ordered easiest-first (' + sorted + '/10)');
  const cells = sw.grid.flatMap((r) => r.easiest.map((c) => c[1]));
  ok(cells.length === 70, 'seventy cells (' + cells.length + ')');
  ok(cells.every((v) => Math.abs(v * 5 - Math.round(v * 5)) < 1e-9),
    'every cell is a multiple of 0.20 — the shape a mean of five integers makes');
  ok(Math.min(...cells) >= 2,
    'and no cell drops below 2.00 even though these are the seven EASIEST of twenty, '
    + 'which is what stops the single-gameweek reading');
  ok(/UNCONFIRMED/.test(sw.metricHypothesis.status),
    'the metric hypothesis is still labelled unconfirmed, not quietly promoted to a fact');
}

/* ── published prices settle what "est." could not ────────────────────
   Every price in this briefing carried an "est." until 14 August, on the
   stated grounds that the FPL API would settle them. A BBC experts piece
   quoting the live game settled four of them, and all four went against us.

   The test asserts the CORRECTIONS reached the club blocks. A resolution
   recorded only in a benchmark file and not in the document it corrects is
   how two editions of the same claim drift apart, which this project has
   already had to fix once this week. */
console.log('\n• briefing: published prices reached the blocks, not just the notes');
{
  const bbc = JSON.parse(readFileSync(join(ROOT, 'docs/benchmarks/pl-gw1-bbc-experts.json'), 'utf8'));
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const blocks = clubBlocks(md);
  const claims = priceClaims(md);

  const res = bbc.theResolution;
  ok(res.disagreements === res.disagreementDetail.length,
    'the disagreement count matches the list it summarises');
  ok(res.checkable === res.exactAgreements + res.disagreements,
    'checkable really is agreements plus disagreements ('
    + res.checkable + ' vs ' + (res.exactAgreements + res.disagreements) + ')');

  /* The four corrected players must now be quoted at the PUBLISHED price
     somewhere in the prose, and the old estimate must not be left standing
     as if it were current. */
  const surname = (s) => String(s).trim().split(/\s+/).pop().toLowerCase();
  for (const d of res.disagreementDetail) {
    const key = surname(d.player);
    const said = claims.filter((c) => surname(c.name) === key).map((c) => c.price);
    ok(said.includes(d.published),
      d.player + ' is quoted at the published £' + d.published + 'm (' + said.join(', ') + ')');
    ok(!said.includes(d.ours) || /published/i.test(md),
      d.player + ': the superseded estimate is not left as a bare current claim');
  }

  /* And the reason, kept where it will be read. A scoreline of 0-4 against
     our own estimates is the kind of thing a document quietly loses. */
  ok(/theirs right four times and ours none/i.test(md),
    'the briefing states the scoreline rather than only listing the corrections');
  /* Tolerant of line wrapping: this prose is hard-wrapped at ~78 columns, so
     a fixed phrase can straddle a newline and a naive regex silently fails. */
  ok(/better\s+prior\s+until\s+it\s+earns\s+a\s+losing\s+record/i.test(md),
    'and states what it changes about how outside sources are weighed');

  /* Confirmations that cost nothing to check and would be embarrassing to
     get wrong: the two signings surfaced only today, both now named by a
     second source, must actually be in the blocks. */
  const fulham = blocks.find((b) => b.name.indexOf('Fulham') === 0);
  const palace = blocks.find((b) => b.name.indexOf('Crystal Palace') === 0);
  ok(/Gonzalo Garcia/.test(fulham.body), 'Gonzalo Garcia is in the Fulham block');
  ok(/Strand Larsen/.test(palace.body), 'Strand Larsen is in the Palace block');
  ok(bbc.picks.Fulham.talisman[0] === 'Rodrigo Muniz'
    && bbc.picks['Crystal Palace'].avoid[0] === 'Jorgen Strand Larsen',
    'and the source really does name them, rather than the file only saying so');

  /* The source's own defect, recorded so a later mechanical parse does not
     read it as two talismen. */
  ok(bbc.picks['Coventry City'].sourceLabelledBothAsTalisman === true,
    'the malformed Coventry section is flagged on the data, not just in prose');
  ok(bbc.reportedOwnership.values.every((v) => typeof v.reported === 'string'),
    'quoted ownership stays a quoted string, never a number to be computed with');
}

console.log('\n• briefing: a settled price reaches BOTH editions, not just the prose one');
{
  /* The test below this one, and the BBC one above it, both read the MARKDOWN.
     The HTML is the edition that ships as the standalone scout terminal — the
     one a reader actually opens — and nothing was checking it.

     It had been wrong since 14 August. Three of the four prices settled that
     day reached the prose blocks and the HTML summary row but never the HTML
     CLUB blocks: Wood and Gibbs-White still read ~£7.0m and Robinson ~£5.0m,
     while the same document's summary row said they were settled. A test that
     verifies one edition and gets read as verifying the document is the same
     failure this file keeps recording in other forms. */
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const teams = teamsFromHtml(html);
  /* every price this project has settled against an outside source, and the
     published figure that won. Add a row here whenever another one settles. */
  const SETTLED = [
    ['Gibbs-White', '8.0'], ['Wood', '6.0'], ['Le Fee', '6.0'], ['Robinson', '4.5'],
    ['Saka', '9.5'], ['Ndiaye', '6.0'], ['Garner', '6.0']
  ];
  for (const [name, price] of SETTLED) {
    const re = new RegExp(name.replace('-', '\\-') + '[^)]{0,80}?£'
      + price.replace('.', '\\.') + 'm', 'i');
    const inBlocks = teams.some((t) => ['value', 'prem', 'diff'].some((f) => re.test(t[f] || '')));
    ok(inBlocks, name + ' is quoted at £' + price + 'm inside an HTML CLUB block');
    ok(re.test(md), name + ' is quoted at £' + price + 'm in the prose edition');
  }
  /* And the superseded estimate must not still be the leading figure for the
     same player in the HTML, which is exactly how Wood read for two days. */
  const STALE = [['Gibbs-White', '~£7.0m'], ['Wood', '~£7.0m'], ['Robinson', '~£5.0m']];
  for (const [name, old] of STALE) {
    const bad = teams.some((t) => ['value', 'prem', 'diff'].some((f) =>
      new RegExp(name.replace('-', '\\-') + '\\s*\\((?:[A-Z]{2,3}\\s*)?'
        + old.replace(/[~£.]/g, (c) => '\\' + c), 'i').test(t[f] || '')));
    ok(!bad, name + ' no longer leads with the superseded ' + old + ' in the HTML');
  }
}

console.log('\n• briefing: the second wave of settled prices reached the blocks too');
{
  /* The test above holds the BBC four to the standard that a settled price
     must reach the CLUB BLOCK and not sit only in a notes table, because a
     reader picking a squad reads the block. Three more rows were settled on
     16 August from a different source, and nothing was enforcing the same
     standard on them — so a correction could land in the summary table and
     leave the block quoting a superseded estimate, which is exactly the
     failure the original test was written to stop. */
  const hadley = JSON.parse(readFileSync(
    join(ROOT, 'docs/benchmarks/pl-tomhadley-preseason-thread.json'), 'utf8'));
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const html = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.html'), 'utf8');
  const settled = hadley.priceColumnSettlesThreeOpenRowsInOurBriefing.settledHere;

  ok(settled.length === 3, 'three rows are claimed settled (' + settled.length + ')');
  for (const row of settled) {
    const surname = row.player.replace(/\s*\(.*\)$/, '').trim();
    const price = row.hisColumn.replace(/[£M]/gi, '');
    /* the published figure must appear next to the name in BOTH editions */
    const near = (src) => {
      const re = new RegExp(surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        + '[^\\n]{0,120}?£?' + price.replace('.', '\\.') + 'm', 'i');
      return re.test(src);
    };
    ok(near(md), surname + ' is quoted at the published £' + price + 'm in the prose edition');
    ok(near(html), surname + ' is quoted at the published £' + price + 'm in the HTML edition');
  }
  /* And the running score, which is the part a document loses first. */
  ok(/seven times from seven/i.test(md) || /right seven from seven/i.test(md),
    'the briefing states the updated scoreline, not just the three new rows');
  ok(/Mateta/.test(md), 'the one row still open is still named as open');

  /* The source file must not overstate what it settled: Mateta is a forward
     and the graphic carrying prices covers midfielders only. */
  ok(hadley.priceColumnSettlesThreeOpenRowsInOurBriefing.stillOpen.length === 1,
    'exactly one row is recorded as still open');
  ok(settled.every((r) => r.right === 'theirs'),
    'every newly settled row went the same way, which is the finding');
}

console.log('• briefing: nobody is recommended at a club this file says they left');
{
  const md = readFileSync(join(ROOT, 'docs/briefings/2026-27-preseason.md'), 'utf8');
  const bad = departedStillPicked(md);
  ok(bad.length === 0,
    'no departed player is named in the picks of the club he left'
    + (bad.length ? ' — ' + bad.map((b) => `${b.player} (${b.club})`).join(', ') : ''));

  /* The check must be shown able to find something, or a clean run means
     nothing. Two ways: it found the real one when it was written (Bruno
     Guimaraes was recommended as Newcastle's captaincy alternative and put on
     their penalties, free-kicks and corners, four lines under an Out list
     recording his move to Arsenal), and a planted violation still trips it. */
  const doc = (bullet) => `## 1. Test FC\n\n**Pre-season summary:** x\n\n`
    + `**In:** Silas Halbrook (MID, Elsewhere, ~£1m).\n\n`
    + `**Out:** Marcus Quintance (MID, Elsewhere, ~£1m).\n\n`
    + `**FPL picks:**\n- Premium / captaincy: ${bullet}\n`;
  /* Tested on a synthetic document rather than by editing the real one. A
     first attempt planted a name into a live bullet and the plant was
     swallowed by a cue already in that same sentence — the test passed by
     accident of wording, which is the failure mode this whole file is about.
     The invented names are deliberately cue-free: the first pair were
     "Departed Playerson" and "Arrived Newman", and "Departed" is itself a
     cue word, so the fixture excused the very thing it was built to catch. */
  const flagged = departedStillPicked(doc('Marcus Quintance is the pick.'));
  ok(flagged.length === 1 && flagged[0].player === 'Marcus Quintance',
    'a departed player recommended with no cue IS flagged');
  ok(departedStillPicked(doc('No nailed premium with Marcus Quintance gone.')).length === 0,
    'and the same name with a departure cue beside it is NOT');
  ok(departedStillPicked(doc('Silas Halbrook is the pick.')).length === 0,
    'while an arrival is never flagged, however it is phrased');
  /* The cue has to be in the SAME SENTENCE, not merely nearby. A character
     window was tried first and a mutation broke it: a departure cue about
     other players, later in the same bullet, excused a restored
     recommendation. */
  ok(departedStillPicked(doc(
    'Someone has gone.' + ' filler'.repeat(30) + ' Marcus Quintance is the pick.')).length === 1,
    'a cue far away in the same bullet does not excuse it');
  ok(departedStillPicked(doc(
    'Marcus Quintance is the pick. The club has sold half the squad.')).length === 1,
    'and neither does a cue in a NEIGHBOURING sentence about somebody else');
  /* Punctuation inside brackets is not a sentence break. The register writes
     "Mateta (£6.5m, published; our estimate said ~£7.5m) is the pick if he
     stays" — the aside sits between the name and the cue, and a
     bracket-blind splitter reported that correct line as a fault. The
     document was reworded twice to suit the checker before it was clear the
     checker was wrong. */
  ok(departedStillPicked(doc(
    'Marcus Quintance (£6.5m, published; est ~£7.5m) is the pick if he stays.')).length === 0,
    'a bracketed aside between the name and its cue does not split the sentence');
  ok(departedStillPicked(doc(
    'Marcus Quintance (£6.5m, published; est ~£7.5m) is the pick.')).length === 1,
    'but a bracketed aside is not itself a cue');

  /* The abbreviation the real picks used. Newcastle's set-piece line named
     "Bruno G" three times and a surname search could not see it — a mutation
     run restored that exact line and nothing tripped. */
  ok(departedStillPicked(doc('Pens Woltemade (Marcus Q secondary).')).length === 1,
    'a forename-plus-initial abbreviation is within reach');
  /* And the collisions that pattern is chosen to avoid. Bare forename
     matching was tried and reverted: it flagged Anthony Elanga against
     departed Anthony Gordon, and Harry Wilson against departed Harry Gray. */
  ok(departedStillPicked(doc('Marcus Wilberforce is the pick.')).length === 0,
    'and a different player sharing only the forename is NOT flagged');

  /* The reason this is hard, and the reason a naive version is useless: most
     mentions of a departed player are correct and necessary. A version
     without the cue window reported thirteen faults where there was one. */
  const naive = [];
  for (const line of md.split('\n')) {
    if (!/^- (Premium|Value|Differentials|Set-piece)/.test(line)) continue;
    for (const n of ['Salah', 'Gordon', 'Mayenda', 'Welbeck', 'Semenyo', 'Guehi']) {
      if (new RegExp('\\b' + n + '\\b').test(line)) naive.push(n);
    }
  }
  ok(naive.length >= 6,
    'the picks really do mention departed players legitimately (' + naive.length + ' mentions)');
  ok(bad.length === 0 && naive.length >= 6,
    'and the cue window separates those from the fault, rather than flagging both');

  /* The cue list is the whole discriminator, so assert it covers the phrasings
     the document actually uses — including the past-tense ones added after a
     false positive on "the reason Jimenez carried the line last season". */
  for (const phrase of ['with Salah gone', "stepping into Gordon's vacated role",
    'clear number nine after Mayenda', 'the reason Jimenez carried the line last season',
    'now Semenyo has gone', 'a direct Senesi replacement']) {
    ok(DEPARTURE_CUES.test(phrase), `the cue list recognises "${phrase}"`);
  }

  /* Parser sanity: an Out line and pick bullets are actually being found.
     If either returned nothing the check above would pass on every file. */
  const nufc = md.slice(md.indexOf('## 15.'), md.indexOf('## 16.'));
  ok(outNames(nufc).length >= 5, 'Out names are parsed (' + outNames(nufc).length + ')');
  ok(pickBullets(nufc).length >= 3, 'pick bullets are parsed (' + pickBullets(nufc).length + ')');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
