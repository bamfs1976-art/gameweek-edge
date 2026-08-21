/* Every number quoted in the Challenge picks file came out of the Hadley
   benchmark or the briefing register by hand, and hand-copying is where this
   project keeps introducing errors.

   The FIRST version of this script passed 41/41 and then passed two of three
   deliberate corruptions, because it checked Hadley against Hadley and only
   asked whether a figure appeared ANYWHERE in the picks file. "53%" appears in
   several places, so changing Muharemovic's rate to 58% went undetected.
   Each assertion below is therefore scoped: a figure must appear inside the
   sentence about THAT player, and a superlative must name the club the source
   actually puts at the top. */
import fs from 'node:fs';
import { departedStillPicked } from '../scripts/briefing-parse.mjs';
const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const H = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-tomhadley-preseason-thread.json`, 'utf8'));
const PICKS = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/fpl-challenge-gw2-gw5.json`, 'utf8'));
const P = fs.readFileSync(`${R}/docs/benchmarks/fpl-challenge-gw2-gw5.json`, 'utf8');
const D = H.defconLeaderboards;

const allDef = Object.entries(D.defence).filter(([k]) => k.startsWith('£')).flatMap(([b, rs]) => rs.map(r => ({ ...r, b })));
const allMid = Object.entries(D.midfield).flatMap(([b, rs]) => rs.map(r => ({ ...r, b })));
const cb = Object.fromEntries(D.opponentDefconAgainst.centreBacks.map(r => [r.vs, r]));
const cm = Object.fromEntries(D.opponentDefconAgainst.centralMidfielders.map(r => [r.vs, r]));

let pass = 0; const fail = [];
const ok = (label, cond) => { if (cond) pass++; else fail.push(label); };

/* the Shield entries, as objects, so a figure can be tied to ITS player */
const shield = PICKS.picks.gw5TheShield.priority;
const entryFor = (name) => shield.find(e => e.p.includes(name));

for (const [name, pool, hit, ps] of [
  ['Muharemovic', allDef, 53, 10.7], ['Vuskovic', allDef, 63, 12.4],
  ['Lacroix', allDef, 60, 10.7], ['Ballard', allDef, 54, null],
  ['Joao Gomes', allMid, 47, 11.7],
]) {
  const r = pool.find(x => x.n === name);
  const e = entryFor(name);
  ok(`${name}: is in Hadley`, !!r);
  ok(`${name}: has a Shield entry`, !!e);
  if (!r || !e) continue;
  /* the rate quoted IN THIS PLAYER'S OWN why-string must be Hadley's rate */
  const quoted = [...e.why.matchAll(/(\d+)%/g)].map(m => +m[1]);
  ok(`${name}: ${hit}% appears in his own entry`, r.hit === hit && quoted.includes(hit));
  /* A first attempt here flagged "no OTHER rate is attributed to him" whenever a
     second percentage in the entry happened to match some player's hit rate.
     Ballard's entry quotes 38% for Man City, and a Championship defender named
     Kitching also sits at 38% — a false positive from a heuristic that cannot
     tell a player rate from an opponent rate. The precise version: the FIRST
     percentage in an entry is the player's own rate, and every later one must
     be the opponent-table row of a club that entry actually names. */
  ok(`${name}: the first rate quoted IS his own`, quoted[0] === hit);
  const others = quoted.slice(1);
  const named = [...Object.keys(cb), ...Object.keys(cm)].filter(c => e.why.includes(c) || e.p.includes(c));
  ok(`${name}: every later rate belongs to a club the entry names`,
    others.every(q => named.some(c => (cb[c] && cb[c].hit === q) || (cm[c] && cm[c].hit === q))));
  if (ps != null) ok(`${name}: per-start ${ps} in his own entry`, r.perStart === ps && new RegExp(String(ps).replace('.', '\\.')).test(e.why));
}

/* Anderson must be ABSENT from the picks and named in the avoid list */
ok('Anderson is not a Shield pick', !shield.some(e => /Anderson/.test(e.p)));
ok('Anderson is named in the avoid list', PICKS.picks.gw5TheShield.avoid.some(a => /Anderson/.test(a)));

/* opponent-table rows: the figure must sit in an entry whose fixture names that club */
for (const [club, tbl, hit, whoFaces] of [
  ['Crystal Palace', cb, 62, 'Muharemovic'], ['Arsenal', cb, 44, 'Vuskovic'],
  ['Brentford', cb, 43, 'Lacroix'], ['Man City', cb, 38, 'Ballard'], ['Tottenham', cm, 39, 'Joao Gomes'],
]) {
  ok(`opponent ${club} = ${hit}% in Hadley`, tbl[club] && tbl[club].hit === hit);
  const e = entryFor(whoFaces);
  ok(`${whoFaces}'s entry quotes ${hit}% for ${club}`, e && [...e.why.matchAll(/(\d+)%/g)].map(m => +m[1]).includes(hit));
}

/* superlatives must name the club the source actually puts at the top/bottom */
const topCB = D.opponentDefconAgainst.centreBacks.reduce((a, b) => b.hit > a.hit ? b : a);
const topCM = D.opponentDefconAgainst.centralMidfielders.reduce((a, b) => b.hit > a.hit ? b : a);
const lowCB = D.opponentDefconAgainst.centreBacks.reduce((a, b) => b.hit < a.hit ? b : a);
ok('the "single highest row" claim names the actual top club',
  new RegExp(`${topCB.vs} is the single highest row`).test(P));
ok('the "top row" midfield claim names the actual top club',
  new RegExp(`${topCM.vs} is the top row of the central-midfield opponent table`).test(P));
ok('the "lowest row" claim names the actual lowest club',
  new RegExp(`${lowCB.vs} is the LOWEST row`).test(P));
ok('the lowest row is unique', D.opponentDefconAgainst.centreBacks.filter(r => r.hit <= lowCB.hit).length === 1);
const five = allDef.filter(r => r.b === '£5m');
const topFive = five.reduce((a, b) => b.perStart > a.perStart ? b : a);
ok('the "highest per-start in the £5m bracket" claim names the right player',
  new RegExp(`${topFive.n}[^"]*highest in the entire £5\\.0m bracket|highest in the entire £5\\.0m bracket`).test(P)
  && entryFor(topFive.n) && /highest in the entire/.test(entryFor(topFive.n).why));

/* the manager-change count, and the discrepancy it exposed */
const mCB = D.opponentDefconAgainst.centreBacks.filter(r => r.mgrChanged).map(r => r.vs).sort();
const mCM = D.opponentDefconAgainst.centralMidfielders.filter(r => r.mgrChanged).map(r => r.vs).sort();
ok('the marked club sets are identical across both tables', JSON.stringify(mCB) === JSON.stringify(mCM));
ok('the picks file quotes the count the DATA supports', P.includes(`Eight of the seventeen centre-back rows`) && mCB.length === 8);
ok('the picks file does NOT repeat the prose count', !/eleven of the seventeen centre-back rows/.test(P));
ok('the discrepancy is recorded in the Hadley file', !!D.opponentDefconAgainst.theManagerChangeCountDoesNotReconcile);
ok('the top-pick club is one of the manager-changed ones', mCB.includes(topCB.vs));

/* club attributions — each of these flips a recommendation if wrong */
const html = fs.readFileSync(`${R}/docs/briefings/2026-27-preseason.html`, 'utf8');
const ROOT_MD = `${R}/docs/briefings/2026-27-preseason.md`;
const block = (club) => { const i = html.indexOf(`name:"${club}"`); return html.slice(i, html.indexOf('fx:[', i)); };
for (const [who, club] of [['Elliot Anderson', 'Manchester City'], ['Muharemovic', 'Leeds United'],
  ['Vuskovic', 'Brighton & Hove Albion'], ['Lacroix', 'Chelsea'], ['Gomes', 'Aston Villa']])
  ok(`register has ${who} signing for ${club}`, new RegExp(`ins:\\[[^\\]]*${who}`, 'i').test(block(club)));
ok('register has Anderson leaving Forest', /outs:\[[^\]]*Anderson/.test(block('Nottingham Forest')));

/* Coventry, which the whole GW2 plan rests on */
/* These two originally read the REGISTER and never the picks file, so changing
   "17 clean sheets" to "21" in the picks file passed. Read the figure OUT of the
   register, then require the picks file to carry that same figure. */
const cov = block('Coventry City');
const spGoals = /(\d+) set-piece goals/.exec(cov), spRate = /(\d+\.\d+) a game/.exec(cov);
const cs = /Carl Rushworth[^"]*?(\d+) clean sheets/.exec(cov);
ok('register states a set-piece goal count and rate', !!spGoals && !!spRate);
ok('register states Rushworth clean sheets', !!cs);
ok(`picks file quotes the register's set-piece count (${spGoals && spGoals[1]})`,
  spGoals && new RegExp(`${spGoals[1]} set-piece goals`).test(P));
ok(`picks file quotes the register's set-piece rate (${spRate && spRate[1]})`,
  spRate && new RegExp(`${spRate[1].replace('.', '\\.')} a game`).test(P));
ok(`picks file quotes the register's clean-sheet count (${cs && cs[1]})`,
  cs && new RegExp(`${cs[1]} clean sheets`).test(P));
ok('the picks file repeats the 19th-of-20 defence warning', /19th of 20/.test(P) && /19th of 20/.test(block('Coventry City')));

/* ---- the share cards ------------------------------------------------------
   scripts/social/challenge-copy.mjs restates these picks in short form for a
   1200×1200 card. Two files stating the same picks is a drift risk, so the card
   copy is held to the record: every name must appear in the matching priority
   list, and every percentage on a card must be the figure the source carries. */
const { CARDS: DECK_CARDS } = await import(`${R}/scripts/social/challenge-copy.mjs`);

const flat = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CLUB_ALIAS = { Spurs: 'Tottenham', 'Man Utd': 'Man United' };
const CARD_TO_KEY = {
  'challenge-gw2-welcome-back': 'gw2WelcomeBack', 'challenge-gw3-all-out-attack': 'gw3AllOutAttack',
  'challenge-gw4-derby-day': 'gw4DerbyDay', 'challenge-gw5-the-shield': 'gw5TheShield',
};

ok('the deck has a card for every challenge in the record',
  Object.keys(CARD_TO_KEY).every((id) => DECK_CARDS.some((c) => c.id === id)));
ok('every card carries a risk line', DECK_CARDS.every((c) => c.risk && c.risk.length > 40));

for (const [id, key] of Object.entries(CARD_TO_KEY)) {
  const card = DECK_CARDS.find((c) => c.id === id);
  const rec = PICKS.picks[key];
  if (!card || !rec) { fail.push(`${id}: no card or no record`); continue; }
  ok(`${id}: pick count matches the record`, card.picks.length === rec.priority.length);
  for (const p of card.picks)
    ok(`${id}: "${p.n}" is in the record's priority list`,
      rec.priority.some((r) => flat(r.p).includes(flat(p.n))));
}

/* the Shield chips are the only hard numbers on any card */
const shieldCard = DECK_CARDS.find((c) => c.id === 'challenge-gw5-the-shield');
for (const p of shieldCard.picks) {
  const src = [...allDef, ...allMid].find((r) => flat(r.n) === flat(p.n));
  ok(`card chip: ${p.n} is a real row in Hadley`, !!src);
  if (!src) continue;
  const rate = p.chips.find((c) => /^\d+%$/.test(c));
  const per = p.chips.find((c) => /\/start$/.test(c));
  const opp = p.chips.find((c) => /^opp \d+%$/.test(c));
  ok(`card chip: ${p.n} hit rate matches Hadley`, rate && parseInt(rate) === src.hit);
  if (per) ok(`card chip: ${p.n} per-start matches Hadley`, parseFloat(per) === src.perStart);
  /* "DEF · Leeds — v Crystal Palace" → the club after "v " or "at " */
  const om = /—\s*(?:v|at)\s+(.+)$/.exec(p.m);
  ok(`card chip: ${p.n} names an opponent`, !!om);
  if (om && opp) {
    const club = CLUB_ALIAS[om[1].trim()] || om[1].trim();
    /* The opponent table has a centre-back half and a central-midfield half, and
       the same club sits in both with DIFFERENT figures — Tottenham is 33% for
       centre-backs and 39% for midfielders. Picking whichever table answers
       first read Joao Gomes, a midfielder, against the centre-back row. The
       player's own position chooses the table. */
    const isMid = /^MID/.test(p.m);
    const row = isMid ? cm[club] : cb[club];
    ok(`card chip: ${p.n} opponent ${club} is in the table`, !!row);
    ok(`card chip: ${p.n} opp figure matches the table`, row && parseInt(opp.replace('opp ', '')) === row.hit);
  }
}

/* the literal-tag regression: <b>/<em> in copy must survive escaping as MARKUP.
   The first render printed "<em>" as visible text in every headline, and
   neither the font guard nor the overflow guard could see it. */
const escT = (s) => String(s).replace(/&(?![a-z]+;|#)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const richT = (s) => escT(s).replace(/&lt;(\/?)(b|em)&gt;/g, '<$1$2>');
ok('rich() turns <em> back into markup, not visible text', richT('a <em>b</em> c') === 'a <em>b</em> c');
ok('rich() turns <b> back into markup', richT('a <b>b</b> c') === 'a <b>b</b> c');
ok('rich() still escapes a stray angle bracket', richT('5 < 6 > 4').includes('&lt;') && richT('5 < 6 > 4').includes('&gt;'));
ok('no card would print a literal tag',
  DECK_CARDS.every((c) => !/&lt;\/?(b|em)&gt;/.test(richT(c.h1) + richT(c.lead) + richT(c.risk))));

/* ---- the @BigManBakar capture ---------------------------------------------
   That benchmark states counts ABOUT our register — ten fixture claims, nine
   agreeing, no conflicts — and the GW4 card now leans on one of them. A stated
   count is only worth anything while it is still true, so it is re-derived here
   rather than trusted: if the register changes, this fails. */
const BAKAR = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-preseason-chips-bigmanbakar.json`, 'utf8'));
const FXALIAS = { Spurs: 'Tottenham Hotspur', 'Man City': 'Manchester City', 'Man Utd': 'Manchester United',
  "Nott'm Forest": 'Nottingham Forest', Newcastle: 'Newcastle United',
  Brighton: 'Brighton & Hove Albion', Leeds: 'Leeds United' };
const fxRows = [];
for (const b of html.split(/\n(?=\s*\{pos:)/)) {
  const nm = /name:"([^"]+)"/.exec(b); const fx = /fx:\[(.*?)\]\}/s.exec(b);
  if (!nm || !fx) continue;
  for (const m of fx[1].matchAll(/\["(\d+)","([^"]+?)\s*\((H|A)\)"/g))
    fxRows.push({ gw: +m[1], club: FXALIAS[nm[1]] || nm[1], opp: FXALIAS[m[2]] || m[2], home: m[3] === 'H' });
}
/* A fixture is a pair, so a club's row and its opponent's row are two witnesses
   to the same fact. Taking whichever answered FIRST made this check pass a
   mutation that rewrote Leeds' own GW2 row: Brentford's intact row still
   answered, and the corruption was invisible. Worse, the same shortcut would
   hide a register that genuinely disagrees with itself — which the Hadley
   benchmark already records happening twice in a rotation grid.
   So: collect every witness, and treat disagreement as a failure rather than
   silently picking one. */
const both = fxRows.flatMap((r) => [r, { gw: r.gw, club: r.opp, opp: r.club, home: !r.home }]);
const at = (club, gw) => {
  const seen = both.filter((r) => r.club === club && r.gw === gw);
  if (!seen.length) return null;
  const agreed = seen.every((r) => r.opp === seen[0].opp && r.home === seen[0].home);
  return agreed ? seen[0] : { ...seen[0], DISAGREE: seen };
};
const firm = (r) => r && !r.DISAGREE;

/* his densest claim: five consecutive Calvert-Lewin fixtures, venues included */
const DCL = [['Nottingham Forest', false], ['Brentford', true], ['Brighton & Hove Albion', false],
  ['Newcastle United', true], ['Crystal Palace', true]];
let dcl = 0;
DCL.forEach(([opp, home], i) => { const r = at('Leeds United', i + 1); if (firm(r) && r.opp === opp && r.home === home) dcl++; });
ok('all five Calvert-Lewin fixtures still reproduce against the register', dcl === 5);
ok('the benchmark claims exactly that', /AGREES on all five/.test(JSON.stringify(BAKAR)));

/* the two GW4 fixtures — one we hold, one we do not */
const che4 = at('Chelsea', 4);
ok('Chelsea host Hull in GW4, as he says', firm(che4) && che4.opp === 'Hull City' && che4.home === true);
ok('every GW1-5 row in the register agrees with its own reciprocal',
  [1,2,3,4,5].every((gw) => [...new Set(fxRows.map((r) => r.club))].every((c) => !at(c, gw)?.DISAGREE)));
ok('the register STILL holds no GW4 row for Man City — the gap is real, not stale',
  !at('Manchester City', 4));
ok('the benchmark does not claim the derby is confirmed',
  /corroborated, not confirmed/i.test(JSON.stringify(BAKAR)));
ok('the Challenge record records the corroboration without changing the picks',
  !!PICKS.fixtureDerivation.theGW4Question.corroboratedLaterTheSameDay
  && /picksUnchanged/.test(JSON.stringify(PICKS)));

/* the GW4 card must state the venue and must NOT claim it is settled */
const derby = DECK_CARDS.find((c) => c.id === 'challenge-gw4-derby-day');
ok('the GW4 card says corroborated, not confirmed', /[Cc]orroborated, not confirmed/.test(derby.risk));
ok('the GW4 card still calls it an inference', /INFERENCE/.test(derby.risk));

/* the Szoboszlai tension, which is only interesting if the figure is right */
const sz = allMid.find((r) => r.n === 'Szoboszlai');
ok('Szoboszlai is 28% in the Hadley table', sz && sz.hit === 28);
ok('the benchmark quotes 28% and the median it is compared against',
  /28% hit rate/.test(JSON.stringify(BAKAR)) && /median of 36%/.test(JSON.stringify(BAKAR)));
const median = allMid.map((r) => r.hit).sort((a, b) => b - a)[Math.floor(allMid.length / 2)];
ok('that median is what the table actually gives', median === 36);

/* The second half of that thread turns on DEFCON judgements, and the benchmark
   states ranks inside the Hadley table. A stated rank is a claim about our own
   data, so it is re-derived rather than trusted — and the "led last season"
   check exists because reading that claim on the wrong metric produced a
   confident wrong answer that was very nearly written up. */
const bkS = JSON.stringify(BAKAR);
const rankOf = (pool, n) => pool.slice().sort((a, b) => b.hit - a.hit).findIndex((x) => x.n === n) + 1;
for (const [who, pool, hit, rank, size] of [
  ['Ndiaye', allMid, 19, 38, 39], ['Szoboszlai', allMid, 28, 27, 39],
  ['Guehi', allDef, 20, 49, 50], ['Maguire', allDef, 42, 22, 50],
]) {
  const r = pool.find((x) => x.n === who);
  ok(`${who} is ${hit}% in the table`, r && r.hit === hit);
  ok(`${who} ranks ${rank} of ${size}`, rankOf(pool, who) === rank && pool.length === size);
  ok(`the benchmark states ${who}'s rank correctly`,
    new RegExp(`rank ${rank} of ${size}`).test(bkS));
}
ok('the benchmark records the negative-right / positive-wrong shape',
  /negative-?\s*DEFCON judgements land/i.test(bkS) || /NEGATIVE DEFCON judgements land/.test(bkS));

/* "led last season" — five of six on TOTAL hits, Premier League rows only */
const tot = (r) => Math.round(r.starts * r.hit / 100);
const plDef = allDef.filter((r) => !r.note);
const byTot = plDef.slice().sort((a, b) => tot(b) - tot(a)).map((r) => r.n);
const HIS = ['Senesi', 'Lacroix', 'Tarkowski', 'Van Dijk', 'Andersen', 'Van Hecke'];
ok('five of his six are the top five by total DEFCON hits',
  HIS.filter((n) => byTot.slice(0, 5).includes(n)).length === 5);
ok('by HIT RATE only one of them would be in the top six — the wrong instrument',
  HIS.filter((n) => allDef.slice().sort((a, b) => b.hit - a.hit).slice(0, 6).map((r) => r.n).includes(n)).length === 1);
ok('the benchmark records that the wrong metric was caught, not shipped',
  /theMistakeThisAlmostBecame/.test(bkS) && /the instrument decided the finding/.test(bkS));

/* the conflict with our OWN register must be recorded without quietly resolving it */
const ars = block('Arsenal');
ok('our register still says discount every Arsenal defensive asset',
  /discount every Arsenal defensive asset/.test(ars));
ok('the benchmark records the Arsenal conflict', /theArsenalDefenceConflict/.test(bkS));
ok('the benchmark does NOT change our position', /register's line is NOT changed/.test(bkS));
ok('our register independently holds the facts he reasons from',
  /Saliba/.test(ars) && /Rice/.test(ars));

/* provenance: a disclosed commercial interest is part of what the source IS */
ok('the commercial interest is recorded', !!BAKAR.source.commercialInterest);
ok('it is recorded as weight, not as a reason to discount',
  /does not make any claim here wrong/i.test(bkS));

/* the completeness miscount must leave a trace */
ok('the corrected post count is stated', BAKAR.completeness.postsCaptured === 22);
ok('the miscount is recorded rather than silently fixed',
  !!BAKAR.completeness.aCountThatWasWrongWhenFirstWritten);
ok('no stale reference to the old count survives', !/fourteen captured/.test(bkS));

/* ---- the LazyFPL Community Shield capture -------------------------------
   The first capture reporting football that was PLAYED. Its value is that it
   bears on positions this project has already published, so what is guarded
   here is that the evidence was recorded WITHOUT the positions being quietly
   changed to match it — and that the two parsing bugs it exposed stay fixed. */
const SHIELD = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-community-shield-lazyfpl.json`, 'utf8'));
const shieldS = JSON.stringify(SHIELD);

ok('the Community Shield capture records both full elevens',
  SHIELD.theMatch.arsenalXI.length === 11 && SHIELD.theMatch.manCityXI.length === 11);
ok('and reports zero conflicts against our register',
  SHIELD.verifiedAgainstOurRegister.clubClaims.conflicts === 0);

/* The rumour bug: our ins/outs arrays mix rumours with completed transfers.
   Re-derived here, because a checker that reads a rumour as a transfer turns
   an agreeing source into a contradicting one. */
const rumourLines = [];
for (const club of ['Everton', 'Crystal Palace']) {
  const b = block(club);
  for (const field of ['ins', 'outs']) {
    const arr = (new RegExp(field + ':\\[(.*?)\\]', 's').exec(b) || [, ''])[1];
    for (const entry of arr.split('","')) if (/rumour/i.test(entry)) rumourLines.push(entry);
  }
}
ok('the register really does mix rumour lines into ins/outs', rumourLines.length >= 3);
ok('and Ndiaye is only RUMOURED out of Everton, never transferred',
  rumourLines.some((l) => /Ndiaye/.test(l)));
ok('while the register itself still puts Ndiaye on Everton penalties',
  /Pens Ndiaye/.test(block('Everton')));
ok('the capture records the rumour-parsing bug rather than hiding it',
  /rumoursReadAsCompletedTransfers/.test(shieldS));

/* Haaland: the price "mismatch" was a regex reaching to Saka's marker. */
ok('our register prices Haaland at £15.5m', /Erling Haaland \(FWD £15\.5m/.test(html));
ok('the £9.5m settled marker belongs to Saka, not Haaland',
  /Saka \(\*\*£9\.5m, published/.test(fs.readFileSync(ROOT_MD, 'utf8')));
ok('the capture records that the mismatch was ours', /aPriceMismatchThatWasARegexJump/.test(shieldS));

/* THE ONE THAT MATTERS: counter-evidence recorded, position NOT flipped. */
ok('our register STILL says discount every Arsenal defensive asset',
  /discount every Arsenal defensive asset/.test(block('Arsenal')));
ok('the capture records the clean sheet as counter-evidence',
  /clean sheet against Manchester City/.test(shieldS));
ok('and states plainly that our line was not changed',
  /line is NOT changed on one fixture/.test(shieldS));
ok('the capture does not overclaim from one match',
  /it is one match, it is the Community Shield/i.test(shieldS));

/* Elliot Anderson: a starting eleven is the strongest confirmation of the club. */
ok('Anderson started for Manchester City in the captured XI',
  SHIELD.theMatch.manCityXI.includes('Anderson'));
ok('which confirms the register, not Hadley\'s "(at Forest)" annotation',
  /ins:\[[^\]]*Elliot Anderson/.test(block('Manchester City')));
ok('and the capture explains why this is not a refutation of the Shield card',
  /whyThisIsNotTheRefutationItLooksLike/.test(shieldS)
  && /premise of the exclusion .* did not hold/i.test(shieldS));

/* Calvert-Lewin now has three statements and still no settled price. */
ok('Calvert-Lewin £6.0m carries three independent statements',
  /THREE independent statements/.test(shieldS));
ok('and our register still holds no settled price for him',
  !/Calvert-Lewin[^\n]{0,80}\*\*£\d+\.\dm, published/.test(fs.readFileSync(ROOT_MD, 'utf8')));

/* Commercial interest recorded, as for the other two paid sources. */
ok('the newsletter\'s commercial interest is recorded', !!SHIELD.source.commercialInterest);
ok('and its unverifiable member claims are marked as such', !!SHIELD.source.unverifiedMemberClaims);

/* ------------------------------------------------------------------------ */
/* The Daily Mail / Fantasy Football Hub capture, and the price checker it
   broke. The point of these checks is not that the file exists — it is that
   the specific faults recorded in it cannot come back. */

const MAIL = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-gw1-guide-dailymail-ffh.json`, 'utf8'));
const mailS = JSON.stringify(MAIL);
const { readRegister, readCaptures, collate, normName, buildAliases } =
  await import(`${R}/dev/cross-source-prices.mjs`);
const REG = readRegister(fs.readFileSync(ROOT_MD, 'utf8'));
const CAPS = readCaptures(`${R}/docs/benchmarks`);
const ROWS = collate(CAPS.declared, REG);
const rowFor = (n) => ROWS.find((r) => r.key === normName(n) || r.display === n);

/* --- the false corroboration that started this. Both must stay dead. --- */
ok('LazyFPL is NOT counted as a source for Igor Thiago',
  !(rowFor('Igor Thiago')?.exact || []).some((e) => e.source === 'lazyfpl'));
ok('LazyFPL is NOT counted as a source for Haaland',
  !(rowFor('Haaland')?.exact || []).some((e) => e.source === 'lazyfpl'));
ok('and the LazyFPL capture says in terms why neither figure is its own',
  /NEITHER is a LazyFPL statement/.test(
    JSON.stringify(JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-community-shield-lazyfpl.json`, 'utf8')))));

/* --- the diacritic miss --- */
ok('Guimaraes and Guimarães fold to one key', normName('Bruno Guimarães') === normName('Bruno Guimaraes'));
ok('and Bruno Guimaraes carries at least two independent statements',
  rowFor('Bruno Guimaraes')?.independentStatements >= 2);

/* --- fees must never be read as prices --- */
ok('the register parser excludes signing-line figures', REG.excluded.onSigningLines > 50);
ok('and Guehi is not held at his transfer fee', !REG.has(normName('Guehi')) || REG.get(normName('Guehi')).price < 16);
ok('nothing in the parsed register is priced above the game ceiling',
  [...REG.values()].every((r) => r.price <= 16));
ok('the £100m Tonali fee is excluded by the ceiling, not adopted',
  REG.excluded.aboveCeiling.some((s) => /Tonali/.test(s)));

/* --- silence and never-being-asked must not look alike --- */
ok('captures with no declared prices are named, not skipped', CAPS.silent.length >= 3);
ok('fpltips records that it enumerates fewer prices than it stated',
  CAPS.declared.find((c) => c.sourceId === 'fpltips').statedTotal === 12
  && CAPS.declared.find((c) => c.sourceId === 'fpltips').exact.length === 6);

/* --- a band is not a price --- */
const hadleyCap = CAPS.declared.find((c) => c.sourceId === 'hadley');
ok('Hadley contributes bands, not prices, from the DEFCON tables', hadleyCap.bands.length > 50);
ok('and an open-ended bracket has no ceiling',
  hadleyCap.bands.some((b) => b.label.endsWith('+') && b.ceiling === null));
ok('a banded player alone never counts as an independent statement',
  ROWS.filter((r) => !r.exact.length).every((r) => r.independentStatements === 0));

/* --- the two Sangare rows must stay two players --- */
ok('the unidentified Sangare band is pinned away from M. Sangare',
  hadleyCap.bands.some((b) => /unidentified/.test(b.canonical || '')));
ok('so M. Sangare carries no band conflict', !(rowFor('M. Sangare')?.bandConflicts || []).length);
ok('and the automatic alias refuses an ambiguous surname',
  !buildAliases(['sangare', 'm sangare', 'i sangare']).has('sangare'));

/* --- Thiaw: the conflict that is real, and the one that was not --- */
const thiaw = allDef.find((r) => r.n === 'Thiaw');
ok('Hadley puts Thiaw on 33 starts', thiaw.starts === 33);
ok('which is incompatible with the article\'s 28 appearances',
  /cannot start 33 matches and appear in only 28/.test(mailS));
ok('but both sources put him on twelve hits', Math.round(thiaw.hit * thiaw.starts / 100) === 12);
ok('and the withdrawn second sign is recorded, not deleted',
  /HadToWithdraw|HADTOWITHDRAW/i.test(mailS) && /It is false|itIsFalse/.test(mailS));
ok('because Thiaw is in the £5m bracket, agreeing with the article', thiaw.b === '£5m');
ok('so the checker reports no band conflict for him', !(rowFor('Thiaw')?.bandConflicts || []).length);

/* --- Lacroix: the exact corroboration, on the same denominator --- */
const lac = allDef.find((r) => r.n === 'Lacroix');
ok('Lacroix 60% from 35 starts is 21 hits', Math.round(lac.hit * lac.starts / 100) === 21);
ok('which is what the article states', /21 of 35 = 60%/.test(mailS));

/* --- the GW4 derby, and what it is NOT --- */
ok('three statements of the GW4 Manchester derby are recorded',
  MAIL.theGW4ManchesterDerby.theRunningCount.statementsThatTheFixtureIsAGW4ManchesterDerby === 3);
ok('two of the venue', MAIL.theGW4ManchesterDerby.theRunningCount.statementsOfTheVENUE === 2);
ok('and our register still holds no GW4 row for either club',
  !/\["4","(Manchester United|Manchester City)/.test(fs.readFileSync(`${R}/index.html`, 'utf8')));
ok('recorded as corroboration of a derivation, not a settled fixture',
  /recorded, not adopted/i.test(JSON.stringify(MAIL.theGW4ManchesterDerby)));

/* --- Newcastle: an open conflict against our own register --- */
ok('the Newcastle manager conflict is recorded', !!MAIL.managerClaims.theNewcastleConflict);
ok('with a second outside source on the same side',
  /LazyFPL/.test(JSON.stringify(MAIL.managerClaims.theNewcastleConflict)));
/* This used to assert the register STILL said Howe continues — the point
   being that a benchmark does not amend the register. That discipline held:
   the capture recorded the conflict on 18 Aug and changed nothing, and the
   edit was made three days later against four sources, in a commit of its
   own. So the assertion becomes: the capture still refuses to amend, and the
   register no longer carries the error. */
ok('the capture still declines to amend the register itself',
  /whyTheRegisterIsNOTAMENDEDHERE/.test(mailS));
ok('and the register was corrected later, by an edit rather than by a capture',
  !/Eddie Howe continues/.test(fs.readFileSync(ROOT_MD, 'utf8'))
  && /Matthias Jaissle/.test(fs.readFileSync(ROOT_MD, 'utf8')));

/* --- commercial interest, as for every paid source --- */
ok('the article\'s commercial interest is recorded first', !!MAIL.commercialInterest);
ok('and names the projections as the product being sold',
  /ARE the product being sold/.test(JSON.stringify(MAIL.commercialInterest)));

/* ------------------------------------------------------------------------ */
/* The 18 August pair: a Polish table series carrying 100 stated prices, and a
   70K-view tips card carrying none. Between them they exercise the price
   checker harder than everything before them combined. */

const MICHAL = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-preseason-tables-lesniczak.json`, 'utf8'));
const SAM = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-preseason-tips-samfpl.json`, 'utf8'));
const michalS = JSON.stringify(MICHAL);
const samS = JSON.stringify(SAM);
const REG2 = readRegister(fs.readFileSync(ROOT_MD, 'utf8'));
const CAPS2 = readCaptures(`${R}/docs/benchmarks`);
const ROWS2 = collate(CAPS2.declared, REG2);
const row2 = (n) => ROWS2.find((r) => r.key === normName(n) || r.display === n);

/* --- range estimates must be visible to the parser --- */
ok('the register parser reads range estimates like ~£4.5-5.0m',
  [...REG2.values()].some((r) => r.isRange));
ok('and De Cuyper is one of them, not a gap in the register',
  REG2.get(normName('Maxim De Cuyper'))?.isRange === true);
ok('so the checker no longer says we hold no De Cuyper price',
  !!row2('De Cuyper')?.register);
ok('a range estimate counts as right when the stated price falls inside it',
  row2('De Cuyper')?.estimateConfirmed === true);

/* --- the estimate scoreboard the briefing keeps --- */
const confirmed = ROWS2.filter((r) => r.estimateConfirmed).length;
const missed = ROWS2.filter((r) => r.estimateMissed);
ok('our register estimates are scored against the stated figures', confirmed >= 6);
/* Both of these used to assert the register held a WRONG estimate. The edits
   were applied on 21 Aug, so there is no estimate left to be wrong — the
   register carries the published figure. The historical scoreline lives in
   the briefing's own table, asserted below, which is the right place for it:
   a record of how we did, not a live price. */
ok('Igor Thiago no longer sits in the register as a missed estimate',
  !missed.some((r) => r.display === 'Igor Thiago'));
ok('nor Mateta', !missed.some((r) => r.display === 'Mateta'));
ok('because both now carry the published price instead',
  /Igor Thiago \(FWD, \*\*£8\.0m, published/.test(fs.readFileSync(ROOT_MD, 'utf8'))
  && /Mateta \(\*\*£6\.5m, published/.test(fs.readFileSync(ROOT_MD, 'utf8')));

/* --- Mateta closed the briefing's eight-row price table on 21 Aug --- */
ok('the briefing still shows Mateta in the original eight-row table',
  /\| Mateta \(CRY\) \| ~£7\.5m \| £6\.5m \|/.test(fs.readFileSync(ROOT_MD, 'utf8')));
ok('and now also in the settled table, as the eighth and last row',
  /\| Mateta \(CRY\) \| ~£7\.5m \| £6\.5m \| \*\*£6\.5m\*\* \| theirs \|/
    .test(fs.readFileSync(ROOT_MD, 'utf8')));
/* Not `=== 2`. A count of sources only grows as captures arrive, so exact
   equality on it is a brittle assertion that fails on the next ingest for no
   reason connected to what it is testing — which is what happened here when
   the official round-up became the third. Assert the floor and the figure. */
ok('at least two independent sources state the outside figure',
  row2('Mateta')?.independentStatements >= 2 && row2('Mateta')?.agreedPrice === 6.5);
ok('and the capture says the briefing edit is owed, not done here',
  /whyItIsNotWrittenIntoTheBriefingHere/.test(michalS));

/* --- silence is recorded as silence --- */
const samCap = CAPS2.declared.find((c) => c.sourceId === 'samfpl');
ok('the tips card declares zero prices rather than being unexamined',
  samCap && samCap.statedTotal === 0 && samCap.exact.length === 0);

/* --- four surnames pinned rather than resolved --- */
/* These four were pinned to their own keys on 18 Aug rather than surname-
   matched. All four have since resolved. The guard therefore checks the
   RESOLUTION IS RECORDED — a pin that quietly becomes a canonical with no
   account of what resolved it is indistinguishable from the guess the pin
   existed to prevent. */
for (const n of ['Sarr', 'Wilson', 'Anthony', 'Rayan']) {
  const e = MICHAL.sourceStatedPrices.exact.find((x) => x.player === n);
  ok(`${n} carries a canonical AND a record of what resolved it`,
    e && e.canonical && !/unidentified/.test(e.canonical) && typeof e.resolvedOn === 'string' && e.resolvedOn.length > 40);
}
ok('P. Sarr stays a different player from the £6.5m Sarr',
  !(row2('P. Sarr')?.bandConflicts || []).length);

/* --- the unread rows are named as unread --- */
ok('the fixture row is recorded as unread, not as agreeing',
  /soItIsRecordedAsUnread/.test(michalS) && /Not as agreeing, and not as disagreeing/.test(michalS));
ok('and the nine untranscribed stat rows are counted, not glossed',
  /roughly nine hundred figures/.test(michalS));
ok('the one transcribed stat row carries its own internal check',
  /The reading survives its own test/.test(michalS));
ok('and the tension it leaves is not blamed on the source',
  /my reading is the weaker link/.test(michalS));

/* --- shared provenance is a limit on independence --- */
ok('the FFH footnote is recorded as a limit on independence',
  /source: FFH \/ Fbref/.test(michalS) && /NOT independent/.test(michalS));
ok('and the honest framing of price agreement is stated',
  /several people reading the same public number/.test(michalS));

/* --- the Arsenal line: a second voice is not more evidence --- */
ok('a second source against our Arsenal line is recorded', !!SAM.theSecondSourceAgainstOurArsenalLine);
ok('and is explicitly NOT counted as new evidence',
  /Two assertions are not twice the evidence of one/.test(samS));
/* The line lives in the STRUCTURED html register's Arsenal value field, not
   in the markdown. Three benchmark files quote it; the first version of this
   assertion looked in the markdown, failed, and would have been "fixed" by
   weakening it had the quote not been checked against the right file. */
ok('our register\'s Arsenal discount line still stands, where it actually lives',
  /discount every Arsenal defensive asset until the replacement is signed/
    .test(fs.readFileSync(`${R}/docs/briefings/2026-27-preseason.html`, 'utf8')));

/* --- the one checkable fact on the tips card --- */
ok('Le Fee\'s stated fixtures agree with our register',
  /Sunderland GW1 Ipswich Town \(A\), GW2 Fulham \(H\)/.test(samS));
ok('and three short names are left unresolved rather than guessed',
  SAM.verifiedAgainstOurRegister.threeNamesLEFTUNRESOLVED.the.length === 3);

/* --- the correction this pair forced on an earlier capture --- */
const FPLTIPS = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-preseason-notes-fpltips.json`, 'utf8'));
const corr = FPLTIPS.verifiedAgainstOurRegister.clubAttributions.CORRECTION_18_AUG;
ok('the fpltips "six absent" count is corrected in place', !!corr);
ok('with the original count left standing beside it',
  FPLTIPS.verifiedAgainstOurRegister.clubAttributions.notInOurRegister === 6);
ok('De Cuyper is demonstrably in the register', /Maxim De Cuyper/.test(fs.readFileSync(ROOT_MD, 'utf8')));
ok('and so is Palestra', /Palestra is a specialist wing-back/.test(fs.readFileSync(ROOT_MD, 'utf8')));
ok('while Hinshelwood, Lammens and Patterson genuinely are not',
  ['Hinshelwood', 'Lammens', 'Patterson'].every((n) => !fs.readFileSync(ROOT_MD, 'utf8').includes(n)));
ok('and the correction names why the method could only give that answer',
  /could only ever have produced this answer/.test(JSON.stringify(corr)));

/* --- zero disagreements is a real result only if a disagreement can show --- */
/* Was "no two sources disagree", which held until an authoritative source
   arrived and one graphic was found to be wrong. The durable invariant is
   that nothing is left OPEN: a disagreement the official list settles is a
   finding, and the wrong figure is named. */
ok('no price disagreement is left open',
  ROWS2.every((r) => !r.sourceConflict || r.wrongSources.length > 0));
ok('across at least a hundred and fifty stated prices',
  CAPS2.declared.reduce((n, c) => n + c.exact.length, 0) >= 150);

/* ------------------------------------------------------------------------ */
/* Guardian previews 11-14. The first non-FPL source captured, and the first
   whose value is entirely facts about football clubs rather than opinions
   about players. Two register errors and one false positive of my own. */

const GDN = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-guardian-previews-11-14.json`, 'utf8'));
const gdnS = JSON.stringify(GDN);
const MD = fs.readFileSync(ROOT_MD, 'utf8');
const HTML = fs.readFileSync(`${R}/docs/briefings/2026-27-preseason.html`, 'utf8');

/* --- the Lukic edit, APPLIED 21 Aug (was: "must stay visible until fixed") --- */
ok('Fulham no longer has Lukic on corners, in either edition',
  !/Corners Iwobi, Lukic/.test(HTML) && !/Corners Iwobi, Lukic/.test(MD));
ok('the vacated corner is left unresolved rather than reassigned to somebody',
  /second corner is unresolved, not reassigned/i.test(MD)
  && /Second corner UNRESOLVED, not reassigned/i.test(HTML));
ok('he is on Ipswich\'s in list now, in both editions',
  /Sasa Lukic \(MID, Fulham\)/.test(MD) && /Sasa Lukic \(MID, Fulham\)/.test(HTML));
ok('AND on Fulham\'s out list — the half a one-sided transfer would have left off',
  /Sasa Lukic \(MID, Ipswich\)/.test(MD) && /Sasa Lukic \(MID, Ipswich\)/.test(HTML));
ok('which is how the briefing parser caught the first attempt at this edit',
  /the one-sided-transfer check in `dev\/test-briefing\.mjs` caught this list still missing him/.test(MD));
ok('the capture records it as an owed edit, not an applied one',
  /Not made here — a benchmark records what a source said/.test(gdnS));
ok('and says why a wrong set-piece duty is worse than a missing name',
  /A departed player holding a set-piece duty is a WRONG ANSWER/.test(gdnS));

/* --- the Gelhardt flag: half closed, and only half --- */
ok('the register still carries the Gelhardt source-conflict flag',
  /Joe Gelhardt's Hull status/.test(MD));
ok('the capture settles his presence at Hull', /The flag can close on presence/.test(gdnS));
ok('and explicitly does NOT settle loan versus permanent',
  /Half a flag closed is recorded as half a flag closed/.test(gdnS));

/* --- Butland: a real conflict, left open --- */
ok('our register says twelve weeks', /Jack Butland \(12 weeks, arm surgery\)/.test(MD));
ok('the Guardian says Christmas, and the gap is recorded',
  /out until Christmas/.test(gdnS) && /Around six weeks/.test(gdnS));
ok('and neither side is adopted', /Recorded as open/.test(gdnS) && /The register is not changed/.test(gdnS));

/* --- Hughes: NOT recorded as a conflict, deliberately --- */
ok('the register has Hughes missing the Man Utd game',
  /Charlie Hughes \| Groin/.test(MD));
ok('groin versus hernia is refused as a conflict',
  /this is NOT recorded as a conflict/.test(gdnS)
  && /inventing a disagreement out of vocabulary/.test(gdnS));

/* --- interest is not a transfer --- */
/* Checking that the KEY exists proves nothing about what it says — a mutation
   that flipped the sentence to "Isidor is moving to Hull" left this green. */
const notMoves = GDN.verifiedAgainstOurRegister.transfersAndClubAttributions.notATransferAndNOTRecordedAsOne;
ok('Isidor stays at Sunderland despite Hull coveting him',
  /Wilson Isidor/.test(MD)
  && notMoves.the.some((x) => /Isidor stays at Sunderland/.test(x))
  && !notMoves.the.some((x) => /Isidor is moving/.test(x)));
ok('and the Barcola pursuit is recorded as unconsummated',
  /An unconsummated pursuit/.test(gdnS));

/* --- the Old Trafford false positive --- */
ok('James Trafford appears nowhere in either register file',
  !MD.includes('James Trafford') && !HTML.includes('James Trafford'));
/* The register wraps "Old Trafford" across a line break, so the full stadium
   name is not findable as one string in the markdown — which is exactly why a
   bare surname search matched it and nothing else did. */
ok('but "Trafford" does, as a stadium wrapped across a line break',
  /Old\s*\n?\s*Trafford/.test(MD) && /away at Old/.test(MD));
ok('and the false positive is recorded rather than quietly fixed',
  /aFalsePositiveInMYOWNCHECKThisTurn/.test(gdnS)
  && /the right word in the right document about entirely the wrong thing/.test(gdnS));

/* --- absence must mean checked-and-zero, not lookup-failed --- */
ok('the capture defines absent as zero occurrences, checked',
  /Absent means ZERO occurrences, checked/.test(gdnS));
/* Verify the WHOLE list, not a sample. A list of names claimed absent is a
   claim about our register, and spot-checking three of twenty-one leaves room
   for a name that is plainly present — a mutation that added Calvert-Lewin to
   the absent list passed the sampled version of this check. */
/* Absence must be tested on WORD BOUNDARIES. `.includes('Rodri')` matches
   "Alvaro Rodriguez" and reported a name as present that the register does
   not hold — the same shape as "Trafford" matching "Old Trafford". Every
   absent-list guard below uses this. */
const heldByRegister = (n) => {
  const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return re.test(MD) || re.test(HTML);
};
const claimedAbsent = GDN.whatOurRegisterDOESNOTHOLD.absent;
/* A capture records what was true when it was taken, so a name can stop being
   absent because we ACTED on it. Those are annotated in the capture rather
   than deleted — deleting would erase the evidence the gap existed — and this
   check exempts exactly the annotated ones, no more. */
const resolvedSince = new Set(
  (GDN.absencesResolvedSince?.resolved || []).map((r) => r.name));
const wronglyAbsent = claimedAbsent.filter((n) => heldByRegister(n) && !resolvedSince.has(n));
ok('every name claimed absent is still absent, or is recorded as since resolved',
  wronglyAbsent.length === 0);
ok('and each exemption says what was done and when',
  (GDN.absencesResolvedSince?.resolved || []).every((r) => r.name && r.on && r.what && r.sources));
ok('Lukic is the one that moved, because we acted on it',
  resolvedSince.has('Sasa Lukic') && heldByRegister('Sasa Lukic'));
/* The exemption must not become a blanket. Every other claimed-absent name is
   still genuinely absent. */
ok('the other twenty are still absent from the register',
  claimedAbsent.filter((n) => !resolvedSince.has(n)).filter(heldByRegister).length === 0);
ok('and the list is the size the capture says it checked', claimedAbsent.length >= 20);
for (const n of ["Dara O'Shea", 'Milos Kerkez']) {
  ok(`${n} is on that list, and is priced by another capture`, claimedAbsent.includes(n));
}
ok('and two of the absent names are priced by other captures',
  /Both are cheap defenders at clubs our register covers/.test(gdnS));

/* --- fees are quarantined from prices --- */
const gdnCap = CAPS2 && null; // placeholder to keep lint-free; recomputed below
const CAPS3 = readCaptures(`${R}/docs/benchmarks`);
const g = CAPS3.declared.find((c) => c.sourceId === 'guardian-previews');
ok('the Guardian capture declares zero FPL prices', g && g.statedTotal === 0 && g.exact.length === 0);
ok('while carrying transfer fees in a separate field', Object.keys(GDN.feesStatedAndWHYTHEYAREKEPTSEPARATE).length >= 5);
ok('and names the two times we read a fee as a price',
  /Vuskovic and Van Hecke/.test(gdnS) && /Guehi/.test(gdnS));

/* --- agreements that matter --- */
ok('Liverpool GW1 at Newcastle agrees with our register',
  /Liverpool GW1 Newcastle United \(A\)/.test(gdnS));
/* Assert on the VERDICT FIELD, not on the whole file. The file quotes the
   withdrawn phrase "the fee matches exactly" while explaining why it was
   withdrawn, so a whole-file "must not contain" check fires on the record of
   the correction rather than on the claim. Scope the assertion to the claim. */
const muha = GDN.verifiedAgainstOurRegister.transfersAndClubAttributions.agreeing
  .find((c) => /Muharemovic/.test(c.claim));
ok('Muharemovic at Leeds agrees to the nearest million, and is claimed that way',
  /Muharemovic \(CB, Sassuolo, ~£34\.1m\)/.test(MD)
  && /agrees to the nearest million/.test(muha.verdict)
  && /NOT an exact match/.test(muha.verdict));
ok('which grades one of our OWN Challenge picks',
  /one of THIS project's own FPL Challenge GW5 Shield picks/.test(gdnS));
ok('Jacquet at Liverpool is confirmed by a second source',
  /that reading is now settled/.test(gdnS));
ok('and our ~£60m is recorded as the ceiling of a structured deal',
  /the ceiling of a structured deal, not the fee paid/.test(gdnS));

/* --- the panel prediction is a poll, not the author's view --- */
ok('the predicted positions are recorded as a panel average',
  /It is a panel average, not the correspondent's view/.test(gdnS));
ok('and the weak convergence with our own model is claimed weakly',
  /Little, honestly, and it is recorded at that weight/.test(gdnS));

/* --- the Guardian's own erratum --- */
ok('the source\'s published correction is recorded',
  /An earlier version showed the progress chart for Ipswich Town rather than for Hull/.test(gdnS));
ok('and is named as the same error class we have made',
  /one club's data attached to another club/.test(gdnS));

/* ------------------------------------------------------------------------ */
/* The official FPL Scout round-up. Not a seventh witness — the thing the
   other six were reading. Every price row it touches is settled, and our own
   estimates get graded rather than corroborated. */

const SCOUT = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-gw1-scout-official.json`, 'utf8'));
const scoutS = JSON.stringify(SCOUT);
const CAPS4 = readCaptures(`${R}/docs/benchmarks`);
const ROWS4 = collate(CAPS4.declared, readRegister(MD));
const row4 = (n) => ROWS4.find((r) => r.key === normName(n) || r.display === n);
const scoutCap = CAPS4.declared.find((c) => c.sourceId === 'fpl-official-scout');

/* --- it must not be counted as one more independent voice --- */
ok('the official capture is marked authoritative', SCOUT.sourceStatedPrices.authoritative === true);
ok('and says in terms that it is not an independent witness',
  /it is the thing the other six were looking at/.test(scoutS));
ok('it carries the whole league', scoutCap.exact.length >= 170 && scoutCap.statedTotal === 172);
ok('and the article-versus-bootstrap distinction is kept',
  /not the official BOOTSTRAP API/.test(scoutS) && /an article can/.test(scoutS));

/* --- with an authority in the room, disagreement is decisive --- */
ok('no price disagreement is left open after the official ingest',
  ROWS4.every((r) => !r.sourceConflict || r.wrongSources.length > 0));
ok('nor with a non-estimate register price', ROWS4.every((r) => !r.registerConflict));
ok('and no band is contradicted', ROWS4.every((r) => !r.bandConflicts.length));

/* --- the eight-row table closes, and our estimates are graded ---
   These two used to assert estimateMissed === true, meaning our register held
   an estimate that the official price contradicted. Both edits were applied on
   21 Aug, so the register carries the published figure now and there is no
   estimate left to miss — the flag flips to false BECAUSE we acted. What must
   not be lost is the scoreline, so that moves to where it belongs: the price
   table and the capture, which are records rather than live advice. */
ok('Mateta is settled at the outside figure by the official source',
  row4('Mateta')?.agreedPrice === 6.5);
ok('Igor Thiago too', row4('Igor Thiago')?.agreedPrice === 8.0);
ok('and our register carries the published price for both, not the old estimate',
  /Jean-Philippe Mateta \(\*\*£6\.5m, published/.test(MD)
  && /Igor Thiago \(FWD, \*\*£8\.0m, published/.test(MD)
  && !/Igor Thiago \(FWD, ~£7\.0-7\.5m est\.\)/.test(MD));
ok('so neither row is a live wrong estimate any more',
  row4('Mateta')?.estimateMissed !== true && row4('Igor Thiago')?.estimateMissed !== true);
ok('but the scoreline against us survives in the table, which is a record',
  /the outside figure right eight from eight, ours right none from\s+eight/i.test(MD));
ok('and the HTML edition records the close too',
  /CLOSED 21 AUG by the official round-up/.test(HTML) && /eight from eight/.test(HTML));
ok('the table is recorded as eight from eight against us',
  /right EIGHT times from eight and our estimate was right none/.test(scoutS));
const rightNow = ROWS4.filter((r) => r.estimateConfirmed).length;
const wrongNow = ROWS4.filter((r) => r.estimateMissed).length;
ok('and the wider estimate scoreboard is mostly in our favour', rightNow >= 12 && wrongNow <= 4);
ok('which the capture states rather than only reporting the losses',
  /Recording only the times an outside source beat us would be a biased sample/.test(scoutS));

/* --- Butland: the one conflict that closed OUR way --- */
ok('our register still says twelve weeks', /Jack Butland \(12 weeks, arm surgery\)/.test(MD));
ok('the official source says at least three months, agreeing with us',
  /at least three months/.test(scoutS) && /the Guardian is the outlier of three/.test(scoutS));
ok('and the Guardian capture still records what it said',
  /out until Christmas/.test(JSON.stringify(GDN)));

/* --- Newcastle: three sources and now a name --- */
ok('the official source names Jaissle', /the first under Jaissle/.test(scoutS));
ok('and our register names him now, in both editions — applied 21 Aug',
  MD.includes('Matthias Jaissle') && HTML.includes('Matthias Jaissle'));
ok('and no longer says Howe continues',
  !/Eddie Howe continues/.test(MD) && !/Eddie Howe continues/.test(HTML));
ok('the paragraph built on the old line went with it',
  !/whether Howe can knit a reshaped attack/.test(MD));
ok('Newcastle is in the confirmed-new-bosses list that used to omit it',
  /Matthias Jaissle \(Newcastle, replacing Eddie Howe/.test(MD));
ok('and the consequence is carried, not just the name',
  /treat every Newcastle dead-ball line as unconfirmed for GW1/.test(MD));
ok('the capture stops short of writing a manager line from one clause',
  /not enough to write a manager line from/.test(scoutS));

/* --- three of four pinned surnames resolve, one does not --- */
const MICH = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-preseason-tables-lesniczak.json`, 'utf8'));
const pinned = MICH.sourceStatedPrices.exact.filter((e) => /unidentified/.test(e.canonical || ''));
/* True OF THE SCOUT, and still true: its round-up names no Rayan. He was
   resolved a day later by two other sources. The claim under test is what
   this capture could settle, not what has been settled since. */
ok('the official round-up could not resolve Rayan, and says so',
  /The official round-up names no Rayan/.test(scoutS));
ok('and the capture says four from four resolving would have been suspicious',
  /four of four resolving would have been the suspicious one/.test(scoutS));
for (const [pin, who] of [['Sarr', 'Ismaila Sarr'], ['Anthony', 'Jaidon Anthony'], ['James', 'Reece James']]) {
  ok(`${pin} resolves to ${who} on the official list`,
    scoutCap.exact.some((e) => e.player === who));
}
ok('the Harry Wilson resolution is flagged as INFERRED, not stated',
  /recorded as a resolution by elimination rather than a statement/.test(scoutS));

/* --- a collision inside my own transcription of the official source --- */
ok('Matheus Cunha and Jair Cunha are two players in the official list',
  scoutCap.exact.some((e) => e.player === 'Matheus Cunha' && e.price === 8.0)
  && scoutCap.exact.some((e) => e.player === 'Jair Cunha' && e.price === 4.5));
ok('and Michal\'s bare Cunha is pinned to the right one, with the reason recorded',
  MICH.sourceStatedPrices.exact.some((e) => e.player === 'Cunha'
    && e.canonical === 'Matheus Cunha' && /REFUSED to merge/.test(e.resolvedOn || '')));

/* --- Sam FPL's short names --- */
ok('Robbo resolves to Andy Robertson at Spurs, not Antonee Robinson',
  scoutCap.exact.some((e) => e.player === 'Andy Robertson' && e.club === 'Tottenham Hotspur')
  && /It is NOT Antonee Robinson/.test(scoutS));
ok('and Williams-and-Igor is still NOT recorded as settled',
  /STILL Not Recorded As Settled|whyItIsSTILLNotRecordedAsSettled/i.test(scoutS)
  && /an inference from a coincidence of club/.test(scoutS));

/* --- the Lukic error now has an official source behind it --- */
ok('the official source also puts Lukic at Ipswich',
  scoutCap.exact.some((e) => e.player === 'Sasa Lukic' && e.club === 'Ipswich Town'));
ok('and our register no longer has him on Fulham\'s corners', !/Corners Iwobi, Lukic/.test(HTML));
ok('the capture calls the edit overdue rather than owed', /overdue rather than merely owed/.test(scoutS));

/* --- availability that touches our own picks --- */
ok('Minteh is out 2-3 months per the official round-up', /two to three months/.test(scoutS));
ok('and he is no longer recommended as a value pick — withdrawn 21 Aug',
  !/- Value: Yankuba Minteh/.test(MD)
  && /Yankuba Minteh WITHDRAWN from this line/.test(MD)
  && /Yankuba Minteh WITHDRAWN from this line/.test(HTML));
ok('nor named as a captaincy-adjacent option',
  !/Minteh or Matt O'Riley are the best captaincy-adjacent/.test(MD)
  && !/Minteh or O'Riley best captaincy-adjacent/.test(HTML));
ok('nor left on Brighton\'s right-side corner',
  !/De Cuyper and Minteh from the right/.test(MD) && !/De Cuyper and Minteh \(right\)/.test(HTML));
ok('and nobody was promoted into the vacancy to fill the hole',
  /Nobody is promoted in his place/.test(MD) && /nobody is promoted in his place/.test(HTML));
ok('Egan\'s ankle doubt can come off', /The doubt can come off/.test(scoutS));
ok('and both position changes are recorded',
  /Sessegnon[^"]*MIDFIELDER to DEFENDER/.test(scoutS) && /Dorgu[^"]*DEFENDER to MIDFIELDER/.test(scoutS));

/* --- what an official round-up does NOT settle --- */
ok('the Arsenal defence dispute is explicitly left open',
  /It is a round-up, not an argument, and it takes no side/.test(scoutS));
ok('and still settles on Arsenal\'s GW1-6 clean sheets, as first recorded',
  /Arsenal's GW1-6 clean sheets, as recorded when the dispute was opened/.test(scoutS));
ok('Konsa is confirmed still at Villa, which our Arsenal line depends on',
  scoutCap.exact.some((e) => e.player === 'Konsa' && e.club === 'Aston Villa')
  && /\(Konsa\) is unsigned/.test(MD));

/* ------------------------------------------------------------------------ */
/* 19 August: three community sources at once. The first price disagreement in
   eight captures, the GW4 rows our register has never held, and a fabricated
   row of my own that the fixture check surfaced. */

const MATE = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-gw1-expert-drafts-fplmate.json`, 'utf8'));
const FRAN = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-gw1-cards-fplfran.json`, 'utf8'));
const MARC = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-gw1-points-analysis-marcello.json`, 'utf8'));
const mateS = JSON.stringify(MATE); const franS = JSON.stringify(FRAN); const marcS = JSON.stringify(MARC);
const CAPS5 = readCaptures(`${R}/docs/benchmarks`);
const ROWS5 = collate(CAPS5.declared, readRegister(MD));
const row5 = (n) => ROWS5.find((r) => r.key === normName(n) || r.display === n);

/* --- an authority makes a disagreement decidable --- */
const haaland = row5('Haaland');
ok('the Haaland disagreement is detected', haaland?.sourceConflict === true);
ok('the official figure is identified as the answer', haaland?.authoritativePrice === 15.5);
ok('and the wrong source is NAMED, not averaged with the rest',
  haaland?.wrongSources.length === 1 && /fplmate £15\.0m/.test(haaland.wrongSources[0]));
ok('no disagreement is left open', ROWS5.filter((r) => r.sourceConflict && !r.wrongSources.length).length === 0);
/* "Nothing open" is satisfied by an authority that settles everything, so it
   cannot tell one bad row from fifty. Name the only capture the official list
   contradicts: if a second one ever disagrees, this goes red even though the
   authority still settles it. */
const contradicted = [...new Set(ROWS5.flatMap((r) => r.wrongSources).map((w) => w.split(' ')[0]))].sort();
ok('exactly one capture is contradicted by the official list, and it is fplmate',
  contradicted.length === 1 && contradicted[0] === 'fplmate');
ok('the capture says why one wrong row is worth having',
  /the evidence the instrument works/.test(mateS));
ok('and refuses to discount the survey because of a price typo',
  /that would be the reverse of the fault this project keeps finding/.test(mateS));

/* --- the GW4 rows, from a structured grid --- */
ok('the grid checks 30 of 32 cells against our register',
  MATE.theGW1To4Grid.checkedAgainstOurRegister.agree === 30
  && MATE.theGW1To4Grid.checkedAgainstOurRegister.conflict === 0);
ok('and the two it cannot check are exactly the Manchester GW4 rows',
  MATE.theGW1To4Grid.checkedAgainstOurRegister.unheld === 2
  && /Manchester United GW4 and Manchester City GW4/.test(mateS));
ok('our register still holds no GW4 row for either club',
  !/\["4","(Manchester United|Manchester City)/.test(HTML));
ok('the derby now has four statements and three of the venue',
  MATE.theGW1To4Grid.theRunningCountOnTheGW4Derby.statementsThatGW4IsAManchesterDerby === 4
  && MATE.theGW1To4Grid.theRunningCountOnTheGW4Derby.statementsOfTheVENUE === 3);
ok('and it is still not written into the register',
  /It IS STILL Not Written Into The Register|andItIsSTILLNotWrittenIntoTheRegister/i.test(mateS));

/* --- an "open question" that was our own confusion --- */
ok('Arsenal GW4 away at Sunderland is our register\'s Sunderland GW4 at home',
  /Arsenal away IS Sunderland at home/.test(mateS));
ok('and it is recorded as our confusion, not a source conflict',
  /the open question was our own confusion rather than a disagreement between sources/.test(mateS));

/* --- FPL Fran: a clean grid, and a row I invented --- */
ok('all 57 of Fran\'s fixture cells agree with our register',
  FRAN.theFixtureGridCHECKSCOMPLETELY.checkedAgainstOurRegister.agree === 57
  && FRAN.theFixtureGridCHECKSCOMPLETELY.checkedAgainstOurRegister.conflict === 0);
ok('the three "conflicts" the first run reported are recorded as MY fabrication',
  /aFabricationOfMYOWNThatThisCheckSURFACED/.test(franS)
  && /three fixture cells that no source ever stated/.test(franS));
ok('and it is named as worse than a misreading', /Worse than a misreading/.test(franS));
ok('the real observation underneath is that Fran names no Newcastle player',
  /NOT ONE of them is a Newcastle player/.test(franS));
ok('which agrees with what fpltips said about Newcastle',
  /Nothing from Newcastle interests me right now/.test(franS));

/* --- the last pinned surname resolves --- */
const stillPinned = MICH.sourceStatedPrices.exact.filter((e) => /unidentified/.test(e.canonical || ''));
ok('no Michal surname is left unidentified', stillPinned.length === 0);
ok('Rayan resolved to Bournemouth, two ways',
  /Resolved, two ways, one of them structural/.test(marcS));
ok('and one of the two is a fixture run rather than a team label',
  /which are Bournemouth's fixtures in our own register/.test(marcS));

/* --- the third Sangare --- */
ok('a £5.0m Sangare is placed at Nottingham Forest',
  MARC.sourceStatedPrices.exact.some((e) => /Sangare \(Nottingham Forest\)/.test(e.canonical || ''))
  && FRAN.sourceStatedPrices.exact.some((e) => /Sangare \(Nottingham Forest\)/.test(e.canonical || '')));
ok('the club is settled and the forename is not',
  /the club is settled and the forename is not/.test(marcS));
ok('and Mamadou Sangare stays a separate £5.5m player at Brentford',
  row5('Mamadou Sangare')?.agreedPrice === 5.5);

/* --- a source whose team column cannot be trusted --- */
ok('Marcello\'s team column is flagged unreliable before anything is taken from it',
  /theTEAMColumnIsNotReliable/.test(marcS));
ok('with the proof named', /Lukic is listed at FULHAM/.test(marcS));
ok('yet its Lukic PRICE agrees with the official list',
  MARC.sourceStatedPrices.exact.some((e) => e.canonical === 'Sasa Lukic' && e.price === 5.0));
ok('Bruno Guimaraes at Arsenal is corroborated four ways and was already ours',
  /Bruno Guimaraes has joined Arsenal from Newcastle/.test(MD));
ok('while Grealish at Everton is left OPEN on one unreliable column',
  /recordedAs["\s:]+An open row/.test(marcS) && /a possible Grealish loan/.test(MD));

/* --- the only numeric forecast in eight captures --- */
ok('the next-five-gameweek predictions are recorded as gradeable',
  MARC.thePREDICTIONColumnIsTheGradeableThing.someOfTheFigures.length >= 12);
ok('with the grading method named and matched to our own',
  /Rank correlation between predicted GW1-5 points and actual/.test(marcS));
ok('and the inference about how it was built flagged as an inference',
  /is NOT what the sheet says about itself/.test(marcS));
ok('the unexplained Value column is recorded and not used',
  /A number whose definition we do not have cannot check anything/.test(marcS));

/* --- Fran's verdicts touch two of our own picks --- */
ok('Muharemovic is marked a Great option, supporting our own Challenge pick',
  /one of THIS project's own FPL Challenge GW5 Shield picks/.test(franS));
ok('and the card\'s own inputs contradicting its verdict is named, not smoothed',
  /publishes the inputs and the verdict but not the function between them/.test(franS));

/* --- ownership, cross-checked once --- */
ok('the one checkable ownership figure agrees with the official source',
  /26\.8% global/.test(mateS) && /above 25 per cent/.test(mateS));
ok('and the other nine are recorded as unverifiable',
  /Unverifiable from anything we hold/.test(mateS));

/* ------------------------------------------------------------------------ */
/* Guardian previews 15-16. The first time an outside source and the OFFICIAL
   source contradict each other on a fact rather than a price. */

const GDN2 = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-guardian-previews-15-16.json`, 'utf8'));
const g2 = JSON.stringify(GDN2);
const SHIELD_XI = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-community-shield-lazyfpl.json`, 'utf8'));

/* --- Rodri: official says priced at City, Guardian says departed --- */
ok('the official source prices Rodri as a Manchester City player',
  scoutCap.exact.some((e) => e.player === 'Rodri' && e.price === 6.5 && e.club === 'Manchester City'));
ok('the Guardian says he has left for Barcelona', /The departed Rodri/.test(g2));
ok('the conflict is recorded rather than resolved by preference',
  /theRODRICONFLICT/.test(g2) && /No register line is written either way/.test(g2));
ok('our register mentions Rodri nowhere at all',
  !/\bRodri\b/.test(MD.replace(/Rodrigu?ez/g, '')) && !/\bRodri\b/.test(HTML.replace(/Rodrigu?ez/g, '')));
ok('and that gap is recorded as a gap independent of who is right',
  /a gap independent of who is right/.test(g2));
ok('his Community Shield absence is stated NOT to settle it',
  !SHIELD_XI.theMatch.manCityXI.includes('Rodri')
  && /consistent with BOTH readings/.test(g2));
ok('citing our own enrichment rule about absence', /is not a prediction of benching/.test(g2));
ok('and the resolution path is the bootstrap, not another article',
  /priced in the game or he is not/.test(g2));

/* --- three fees agree exactly --- */
ok('Elliot Anderson £116m agrees', /around £116m \(a British record\)/.test(MD));
ok('Tielemans ~£35m agrees', /Youri Tielemans \(MID, Aston Villa, ~£35m\)/.test(MD));
ok('Andrey Santos ~£48m agrees', /Andrey Santos \(MID, Chelsea, ~£48m\)/.test(MD));
ok('and the previews close on each other arithmetically',
  /£32m more than Tielemans' and Santos's combined fee/.test(g2));

/* --- a rumour that gains a fee is still a rumour --- */
ok('our register still calls Baleba a rumour', /a rumour not a done deal/.test(MD));
ok('and the capture refuses to upgrade it on "set to sign"',
  /'Set to sign' is not signed/.test(g2)
  && /would be repeating the rumour-as-transfer fault/.test(g2));
ok('four further items are separated from transfers',
  GDN2.verifiedAgainstOurRegister.andFourMoreThingsThatAreNOTTransfers.length === 4);

/* --- absence measured, not assumed --- */
const gap = GDN2.whatOurRegisterDOESNOTHOLD.absent;
ok('every name claimed absent really is absent, on word boundaries',
  gap.filter(heldByRegister).length === 0);
ok('and the substring test that got this wrong is not used',
  gap.some((n) => MD.includes(n)) && gap.filter(heldByRegister).length === 0);
ok('and Kovacic is absent despite being in our own Community Shield XI',
  gap.includes('Mateo Kovacic') && SHIELD_XI.theMatch.manCityXI.includes('Kovacic'));

/* --- the World Cup consistency check across six previews --- */
ok('eight passing tournament references across six previews are assembled',
  GDN2.aSOURCEThatCanBeCheckedAgainstITSELF.theWorldCupCrossCheck.theAssembly.length === 8);
ok('and the check is claimed for what it is, not more',
  /It is not a check of anything we hold/.test(g2));

/* --- the set-piece stat lands on priced assets --- */
ok('City\'s set-piece weakness is tied to five priced City defenders',
  /Gvardiol £5\.5m, Dias £5\.5m, Guehi £6\.0m, O'Reilly £6\.5m, Khusanov £5\.5m/.test(g2));
ok('and the phrasing is recorded as stated rather than recomputed',
  /Recorded as stated/.test(g2));
ok('the Bruno Fernandes age risk is tied to his expert ownership',
  /89%/.test(g2) && /the only risk anybody has attached to him/.test(g2));

/* --- still no FPL prices in a Guardian preview --- */
const g2cap = CAPS5.declared.find((c) => c.sourceId === 'guardian-previews-15-16');
ok('previews 15-16 declare zero prices, like 11-14',
  g2cap === undefined || (g2cap.statedTotal === 0 && g2cap.exact.length === 0));

/* ------------------------------------------------------------------------ */
/* The owner's GW1 draft. Recorded so git history proves it predates the
   football; checked so the record is of the squad that actually exists. */

const DRAFT = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/fpl-gw1-squad-draft.json`, 'utf8'));
const draftS = JSON.stringify(DRAFT);
const SQ = DRAFT.squad;

ok('the draft is fifteen players', SQ.length === 15);
ok('costing exactly £100.0m, which reproduces the app\'s £0.0m budget',
  Math.abs(SQ.reduce((n, p) => n + p.price, 0) - 100) < 1e-9);
ok('in a legal 2/5/5/3 shape',
  ['GK', 'DEF', 'MID', 'FWD'].map((x) => SQ.filter((p) => p.pos === x).length).join('/') === '2/5/5/3');
const perClub = {};
for (const p of SQ) perClub[p.club] = (perClub[p.club] || 0) + 1;
ok('with no club over the three-player limit', Math.max(...Object.values(perClub)) <= 3);
ok('and Manchester United exactly at it', perClub['Manchester United'] === 3);

/* --- every price agrees with the official list, or is named as unpriced --- */
const offList = scoutCap.exact;
const priced = SQ.filter((p) => offList.some((e) => normName(e.canonical || e.player) === normName(p.name)));
const wrongPrice = priced.filter((p) => {
  const o = offList.find((e) => normName(e.canonical || e.player) === normName(p.name));
  return Math.abs(o.price - p.price) > 1e-9;
});
ok('every squad price the official list holds agrees with it', wrongPrice.length === 0);
ok('and the four it does not hold are named',
  /Petrovic, Kayode, Palmer, Hughes/.test(draftS));

/* --- fixtures by reciprocity, all fifteen --- */
ok('all fifteen GW1 fixtures agree with our register',
  /FIFTEEN OF FIFTEEN AGREE, none conflict/.test(draftS));
ok('and the capture says what that does NOT establish',
  /establishes nothing whatever about whether the picks are good/.test(draftS));

/* --- two picks nothing we hold can speak to --- */
ok('Petrovic and Hughes are recorded as unspoken-for, not as bad picks',
  /Petrovic and Hughes/.test(DRAFT.whatOurNINECAPTURESSayAboutEachPick.twoPicksNOTHINGWEHOLDCanSpeakTo.who)
  && /No read is offered on them, in either direction/.test(draftS));
ok('and neither is priced by any capture',
  !ROWS5.some((r) => (r.key === normName('Petrovic') || r.key === normName('Hughes')) && r.exact.length > 0));
ok('with the reason for saying so recorded',
  /a silence that looks like a judgement is how this project has gone wrong before/.test(draftS));

/* --- Palmer: the evidence leans one way, and the other side is stated --- */
/* Five entries, and they are not five negatives: four are stated negatives
   and the fifth is a SILENCE — the official round-up not mentioning him where
   a mention was expected. Counting a silence as a negative is the shape of
   fault this project keeps finding, so the label says what the array is. */
ok('four stated negatives plus one telling silence are recorded on Palmer',
  DRAFT.thePickTheEVIDENCELEANSAGAINST.against.length === 5
  && /does not mention him at all/.test(DRAFT.thePickTheEVIDENCELEANSAGAINST.against[4])
  && /one silence from the official source/.test(draftS));
ok('and the case FOR him is recorded too, not omitted',
  DRAFT.thePickTheEVIDENCELEANSAGAINST.forHim.length === 3
  && /not a bad deal at all/.test(draftS));
ok('the card contradicting its own inputs is named on both sides',
  /contradicts its own inputs, which cuts both ways/.test(draftS));
ok('and it stops short of a sell recommendation',
  /Nothing here is a projection/.test(draftS));

/* --- Gabriel sits against our own published line --- */
ok('our register still discounts every Arsenal defensive asset',
  /discount every Arsenal defensive asset until the replacement is signed/.test(HTML));
ok('the draft is recorded as taking the other side',
  /It takes the outside sources' side against this project's own published position/.test(draftS));
ok('and neither the register nor the draft is changed to match',
  /Both stand, and one of them will be wrong/.test(draftS));

/* --- the internal head-to-heads --- */
ok('three GW1 head-to-heads inside the squad are recorded',
  DRAFT.threeGW1HeadToHeadsINSIDETheSquad.the.length === 3);
ok('and hedging is not called a mistake', /It is not a mistake|What This Is Not|whatThisIsNot/i.test(draftS)
  && /Hedging is a choice/.test(draftS));

/* --- no injury flag touches the squad --- */
ok('none of the fifteen carries an injury flag in any capture',
  /include none of these fifteen/.test(draftS));
ok('the check is against the assembled availability list, not a guess',
  /Checked against the availability list assembled from the official round-up/.test(draftS));

/* --- it is a draft, and says so --- */
ok('it is recorded as a draft, not a submitted entry',
  DRAFT.kind === 'own-pick' && /may not be what is submitted/.test(draftS));
ok('with the hours before lock stated', DRAFT.hoursBeforeLock === 54);
ok('and the captain recorded as NOT visible', /The captain and vice-captain/.test(draftS));

/* --- the 13:55 revision of the draft, appended not overwritten --- */
const REV = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/fpl-gw1-squad-draft.json`, 'utf8')).revisions[0];
const revS = JSON.stringify(REV);
ok('the first draft is preserved beside the revision',
  DRAFT.squad.some((p) => p.name === 'Palmer') && /Palmer \(CHE, £9\.5m\)/.test(revS));
ok('four changes are recorded', REV.fourChanges.length === 4);
ok('and the Hughes-to-Tonali swap is called what it is',
  /SWAPPED ONE PLAYER NOTHING WE HOLD PRICES FOR ANOTHER/.test(revS));
ok('Tonali really is priced by no capture',
  !ROWS5.some((r) => r.key === normName('Tonali') && r.exact.length > 0));
ok('while Van Hecke and Neco Williams are evidenced starters',
  REV.theBenchBoostQuestion.one_halfTheBenchIsUnKNOWNToEverythingWeHold.wellEvidenced.length === 2
  && /look likely to start the season/.test(revS));
ok('two clubs are now at the three-player limit', /BOTH FULL/.test(revS));
ok('and the internal clashes fell from three to one', /The first draft had three, two of them inside the eleven/.test(revS));
ok('the bench-boost answer is no, with reasons ordered by weight',
  /theReadIsNo/.test(revS) && /ordered by weight, not by rhetoric/.test(revS));
ok('including that the chip removes auto-substitutions',
  /there are no automatic substitutions/.test(revS));
ok('and that GW1 is where that risk is highest, not lowest',
  /at its HIGHEST here, not its lowest/.test(revS));
ok('Triple Captain is offered as a comparison, not a recommendation',
  /notARecommendation/.test(revS) && /53 minutes in the Community Shield/.test(revS));
ok('the Haaland price footnote explains the checker\'s null',
  /noted only so the tool's output is not misread/.test(revS));

/* --- the 14:21 revision: a rebuild, a new captain, zero internal clashes --- */
const REV2 = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/fpl-gw1-squad-draft.json`, 'utf8')).revisions[1];
const rev2S = JSON.stringify(REV2);
ok('both earlier drafts are preserved beside the third',
  DRAFT.squad.some((p) => p.name === 'Palmer') && /Tonali/.test(JSON.stringify(REV)) && REV2.recordedAt.includes('14:21'));

/* A COUNT STATED IN PROSE MUST MATCH THE LISTS BESIDE IT. The 14:21 entry
   said "nine of fifteen changed" while its own out/in arrays held seven names
   each — a figure asserted in prose that the structured data beside it
   contradicted, which is this project's recurring fault at its smallest
   possible scale. This guard compares every revision's stated count to its
   own lists, so the next one cannot drift. */
const REVS = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/fpl-gw1-squad-draft.json`, 'utf8')).revisions;
for (const r of REVS) {
  if (!Array.isArray(r.out)) continue;
  ok(`${r.recordedAt.slice(11, 16)}: the stated change count matches the out list`,
    r.countedChanges === r.out.length && r.out.length === r.in.length);
}
ok('the miscount is corrected in place, not erased',
  /CORRECTION/.test(JSON.stringify(REV2)) && /It is SEVEN/.test(JSON.stringify(REV2)));
ok('and named as the fault it belongs to',
  /a figure asserted in prose that the structured data beside it contradicts/.test(JSON.stringify(REV2)));

/* --- the 14:22 draft --- */
const REV3 = REVS[2];
const rev3S = JSON.stringify(REV3);
ok('the fourth draft is recorded', REV3.recordedAt.includes('14:22') && REV3.countedChanges === 2);
ok('Manchester City is full AND all three start',
  /MANCHESTER CITY 3 — FULL, and all three START/.test(rev3S));
ok('with the concentration named against the earlier drafts',
  /The 14:21 draft's biggest block was three Spurs; that is now two/.test(rev3S));
ok('and the fixture quality allowed to cut the other way',
  /Concentration and fixture quality point opposite ways here/.test(rev3S));
ok('the spread fell from nine matches to eight', /down from nine/.test(rev3S));
ok('the bench-boost read is revisited and unchanged',
  /better, and not enough to change the answer/.test(rev3S));
ok('and Gomez resolves an ambiguity WITHOUT resolving Sam FPL\'s sentence',
  /identifies the priced player rather than the sentence/.test(rev3S));
ok('internal clashes are now zero, and the trend is recorded',
  /ZERO/.test(rev2S) && /The first draft had three clashes, the second had one, this has none/.test(rev2S));
ok('the two Fernandes in one eleven are named as the collision family',
  /theTwoFernandesInTheSameEleven/.test(rev2S) && /REFUSES to merge/.test(rev2S));
ok('and it is explicitly NOT called a mistake', /They are two real players in two different matches/.test(rev2S));
ok('the captaincy case carries the official source AGAINST it',
  REV2.theCaptaincy.againstIt.length === 2 && /missed his second penalty in two matches/.test(rev2S));
ok('with the sharpest point attributed to the publisher, not a tipster',
  /it comes from the game's own publisher rather than a tipster/.test(rev2S));
ok('and no captaincy recommendation is made', /none of it says captain him or do not/.test(rev2S));
ok('M. Fernandes is thinly priced but not thinly evidenced',
  /THIRD OF SEVEN/.test(rev2S) && /NOBODY has said he starts for Spurs/.test(rev2S));
ok('and the West Ham caveat on those numbers is kept',
  /earned somewhere else, under a different manager, in a different role/.test(rev2S));
ok('Mac Allister is recorded as the one new pick the evidence points down on',
  /theWeakestOfTheNewOnes/.test(rev2S) && /13\.4/.test(rev2S));
ok('what was given up is listed, not glossed', REV2.whatWasGivenUp.what.includes('Mbeumo'));
ok('and the trade is called a choice rather than an error',
  /not a fact either way/.test(rev2S));
ok('the Spurs concentration growing is recorded alongside the offsetting gain',
  /theConcentrationThatGREW/.test(rev2S) && /Concentration went up in one place and down in another/.test(rev2S));
ok('Verbruggen and Hughes are still the two nothing prices',
  /the same two as in the previous draft/.test(rev2S)
  && !ROWS5.some((r) => r.key === normName('Verbruggen') && r.exact.length > 0));

/* ─── Guardian previews 19-20: Sunderland and Tottenham ────────────────────
   The last two of the series, both published on the morning of deadline week.
   The valuable items are not the agreements — they are one pin this closes
   about our OWN searching, one convergence arrived at from two different
   measurements, and three squad gaps sitting underneath FPL picks we publish.
   ------------------------------------------------------------------------ */
const GDN3 = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-guardian-previews-19-20.json`, 'utf8'));
const g3 = JSON.stringify(GDN3);

/* --- the pin this closes, and whose fault it was --- */
ok('our register has held Andy Robertson at Tottenham all along',
  /Andy Robertson \(LB, Liverpool, free\)/.test(MD));
ok('and Liverpool records the same move from the other end',
  /Andy Robertson \(DEF, Tottenham, free\)/.test(MD));
ok('the Sam FPL card really did leave "Robbo" unresolved',
  /Robbo, in 'Richa & Robbo should start for Spurs'/.test(
    fs.readFileSync(`${R}/docs/benchmarks/pl-preseason-tips-samfpl.json`, 'utf8')));
ok('the new capture closes it against the Guardian naming Robertson at Spurs',
  /thePINThisCLOSES/.test(g3) && /Andy Robertson's addition as an experienced head/.test(g3));
/* The point of the entry is the cause, not the answer. */
ok('and it records the cause as our own failed lookup, not source ambiguity',
  /the search was for ROBINSON/.test(g3) && /It was not ambiguity in the source/.test(g3));
ok('the older capture is corrected in the open rather than rewritten',
  /a correction that erases its own cause teaches nothing/.test(g3));
ok('and the claim that Robertson will START is explicitly not adopted',
  /That is a team-sheet claim/.test(g3));

/* --- convergence, and the distinction it has to survive --- */
ok('our register already held the Sunderland overperformance numbers',
  /42 goals scored against 38\.89 xG/.test(MD) && /48 conceded against 52\.1 xGA/.test(MD));
ok('the Guardian reaches it from a different metric entirely',
  /expected points metric/.test(g3) && /11 places higher/.test(g3));
ok('and the capture states why this counts as corroboration where the Arsenal one did not',
  /separate measurements neither took from the other/.test(g3));
/* Agreement must not quietly become a new claim. */
ok('the convergence changes no pick, and says so',
  /Nothing yet, deliberately/.test(g3));

/* --- the disagreement is filed as ungradeable, not as an error --- */
ok('"no key player has been sold" is recorded against our Mayenda line',
  /breakout striker Mayenda/.test(MD) && /Eliezer Mayenda \(ST, Rennes, ~£21\.5m\)/.test(MD));
ok('and it is NOT filed as a factual error, because "key" is a judgement',
  /'key' is a judgement, not a fact/i.test(g3));
ok('silence about the sale is not read as denial of it',
  /it is silent on it, and this file does not read silence as denial/.test(g3));
const ungradeable = GDN3.claimsWorthGrading.filter((c) => c.gradeable === false);
ok('exactly the "key player" claim is marked ungradeable',
  ungradeable.length === 1 && /no key player has been sold/.test(ungradeable[0].claim));

/* --- the open Isidor/Brobbey item moves without being settled --- */
ok('our register still calls Isidor the clear number nine',
  /clear number nine after Mayenda/.test(MD));
ok('the capture records a SECOND source leaning Brobbey', /A second outside source leaning Brobbey/.test(g3));
ok('and refuses to call it settled', /NOT a settlement/.test(g3));
ok('scoring it honestly against our own line', /That is 2-1 against our line/.test(g3));
ok('with the team sheet named as what would settle it, not another preview',
  /The GW1 team sheet\. Not another preview\./.test(g3));

/* --- absence measured on word boundaries, and measured against the REAL file --- */
const g3gaps = [].concat(
  GDN3.verifiedAgainstOurRegister.playersTheseArticlesNameThatOurRegisterDoesNOTHold.sunderland,
  GDN3.verifiedAgainstOurRegister.playersTheseArticlesNameThatOurRegisterDoesNOTHold.tottenham,
  GDN3.verifiedAgainstOurRegister.playersTheseArticlesNameThatOurRegisterDoesNOTHold.offField);
ok('every name claimed absent really is absent from both editions',
  g3gaps.length >= 15 && g3gaps.filter(heldByRegister).length === 0);
/* A gap list that could not have been wrong is not a check. This asserts the
   list is non-trivial AND that the register genuinely holds the players the
   same previews name that are NOT on it. */
ok('and the previews name plenty we DO hold, so the gap list is selective',
  ['Meunier', 'Mukiele', 'Hume', 'Kinsky', 'Porro', 'Tonali', 'Richarlison']
    .every((n) => heldByRegister(n)));

/* --- the three gaps that sit underneath published picks --- */
const under = GDN3.verifiedAgainstOurRegister.playersTheseArticlesNameThatOurRegisterDoesNOTHold.theThreeThatMatterForFPL;
ok('three gaps are singled out as sitting under FPL picks we publish', under.length === 3);
ok('Vicario is one of them, because our Kinsky pick rests on his exit',
  under.some((u) => u.name === 'Guglielmo Vicario') && /Antonin Kinsky \(GK, ~£4\.5m\), cheap starting keeper enabler/.test(MD));
ok('and our own transfer list argues AGAINST that pick, which the capture states',
  /Martin Dubravka \(GK, Burnley, free\)/.test(MD) && /a free veteran keeper is exactly what would unseat a cheap enabler/.test(g3));

/* --- the series gap is recorded rather than implied --- */
ok('previews 17 and 18 are recorded as never captured',
  GDN3.theSERIESGap.neverCaptured.join() === '17,18');
ok('and the file refuses to guess which clubs they cover',
  /guessing it would be manufacturing a source we do not have/.test(g3));

/* --- still no prices, three Guardian captures running --- */
const g3cap = CAPS5.declared.find((c) => c.sourceId === 'guardian-previews-19-20');
ok('previews 19-20 declare zero prices',
  g3cap === undefined || (g3cap.statedTotal === 0 && g3cap.exact.length === 0));
ok('and transfer fees are explicitly kept apart from prices',
  /Transfer FEES are stated \(Tonali £100m\) and are not prices/.test(g3));

/* --- a preview's silence is never read as a denial --- */
ok('the source limits state that omission is not denial',
  /never as a denial/.test(g3) && /reading an absent Newcastle row as three source conflicts/.test(g3));

/* ─── Guardian previews 17-18: Newcastle and Nottingham Forest ─────────────
   The two the 19-20 capture recorded as a gap. 17 is Newcastle, which is what
   that entry said would matter, and it settles the manager error. It also led
   to finding a worse one in our own file.
   ------------------------------------------------------------------------ */
const GDN4 = JSON.parse(fs.readFileSync(`${R}/docs/benchmarks/pl-guardian-previews-17-18.json`, 'utf8'));
const g4 = JSON.stringify(GDN4);
const GDN3f = fs.readFileSync(`${R}/docs/benchmarks/pl-guardian-previews-19-20.json`, 'utf8');

/* --- the gap the previous capture recorded is the one this fills --- */
ok('the 19-20 capture really did record 17 and 18 as missing',
  /"neverCaptured": \[17, 18\]/.test(GDN3f));
ok('and refused to name the clubs', /manufacturing a source we do not have/.test(GDN3f));
ok('17 is Newcastle, as that entry said would matter',
  GDN4.source.articles.find((a) => a.no === 17).club === 'Newcastle United');
ok('and the fill is credited to the source, not to the guess being right',
  /Not that the guess would have been right/.test(g4));

/* --- the manager error, settled --- */
ok('our register no longer says Howe continues, in either edition',
  !/Eddie Howe continues/.test(MD) && !/Eddie Howe continues/.test(HTML));
ok('and the correction records that the old line was held against four sources',
  /four sources against, one of them the game's own publisher/.test(MD));
/* Applied 21 Aug. This assertion used to require the OPPOSITE — that the
   successor was absent, because the edit was owed and half-applying it in a
   set-piece aside is how a file ends up naming two managers. An earlier
   commit did exactly that and this guard caught it. Now the edit is made, so
   the requirement inverts: the name must be present in both editions, and the
   holding note that stood in for it must be gone. */
ok('the successor is named in both editions — the owed edit is applied',
  MD.includes('Matthias Jaissle') && HTML.includes('Matthias Jaissle'));
ok('and the placeholder that marked it as pending has been removed',
  !/under an owed correction/.test(MD));
ok('the capture names the successor fully, which the official three-word clause could not',
  /Matthias Jaissle/.test(g4) && /38-year-old German/.test(g4));
ok('four sources are counted, not three, and each names itself and its claim',
  GDN4.theERRORThisSETTLES.theSourceCount.length === 4
  && GDN4.theERRORThisSETTLES.theSourceCount.every((s) => s.source && s.said));
ok('and it is listed as owed rather than applied, because it adopts an outside claim',
  /Listed rather than applied here/.test(g4));
/* The consequence that is not just "the name is wrong". */
ok('the register\'s own front matter contradicts its Newcastle dead-ball line',
  /New managers reshuffle set-piece and penalty hierarchies/.test(MD)
  && /treats Newcastle's dead-ball order as settled under a manager who has gone/.test(g4));

/* --- the error found in our OWN file, and applied --- */
ok('our file records the Guimaraes move to Arsenal at both ends',
  /Bruno Guimaraes \(CM, Newcastle, fee not confirmed here\)/.test(MD)
  && /Bruno Guimaraes \(CM, Arsenal\)/.test(MD));
/* Asserted structurally, not by exact string: a mutation restoring the line
   with slightly different wording ("the reliable alternative" rather than
   "the reliable minutes-and-creativity alternative") slipped past the exact
   match. The parser answers the question the string was standing in for. */
ok('and no longer recommends him as a Newcastle pick, by the parser not a phrase',
  departedStillPicked(MD).length === 0);
ok('nor on Newcastle penalties, free-kicks or corners',
  !/Penalties Woltemade \(Bruno G secondary\)/.test(MD) && !/Bruno G 2nd/.test(HTML));
/* The parser reads the markdown edition only, so the HTML gets its own
   assertion. A mutation leaving the HTML stale while the markdown was fixed
   went unnoticed once the string check was replaced by the parser check —
   two editions need two checks. */
ok('and the HTML edition is fixed too, not just the markdown',
  !/Bruno Guimaraes the reliable/.test(HTML)
  && !/FK Hall, Bruno G/.test(HTML)
  && /has left for Arsenal/.test(HTML));
ok('the correction says how it got there, not just that it was wrong',
  /the transfer reached the Out list four lines above on 13 Aug and the picks under it were never touched/.test(MD));
ok('no replacement alternative was invented to fill the hole',
  /inventing a substitute for them would be a worse answer than saying so/.test(MD));
ok('and the capture states why THIS edit was applied when the manager edit was not',
  /Making a file agree with itself is not the same as taking a source's word/.test(g4));
ok('recording that the same fault had already been hand-fixed twice',
  /previously named Digne on corners/.test(MD) && /McNeil removed 13 Aug/.test(MD)
  && /Twice found, twice fixed one player at a time, and no check written/.test(g4));

/* --- the structural check that came out of it --- */
ok('the check is named and lives in the parser, not in a one-off script',
  /departedStillPicked, in scripts\/briefing-parse\.mjs/.test(g4));
ok('the naive version is recorded as having reported 13 faults for 1',
  /THIRTEEN faults where there was one/.test(g4));
ok('and both fixture mistakes that made it pass wrongly are written down',
  /swallowed by a cue already in that same sentence/.test(g4)
  && /'Departed' is itself a cue word/.test(g4));

/* --- two window-level conflicts, neither resolved by preference --- */
ok('the goalkeeper conflict names both keepers and both fees',
  /Lukas Hornicek/.test(g4) && /Ewen Jaouen \(GK, Reims, ~£24m\)/.test(MD) && /£26m/.test(g4));
ok('and refuses to call our Jaouen line wrong',
  /That our Jaouen line is wrong/.test(g4) && /notClaimed/.test(g4));
ok('the Forest window conflict is stated as one document being a year out',
  /one of the two documents is wrong about an entire transfer window/.test(g4));
ok('with the loan-to-permanent reading offered rather than a verdict',
  /A loan made permanent would put McAtee at Forest last season AND make him a paid signing/.test(g4));
ok('and our own In list already carried the caveat the conflict turns on',
  /\(Some completion dates unverified, re-check\.\)/.test(MD));

/* --- the four-versus-five count that is NOT a conflict --- */
ok('the manager count difference is explained rather than filed as an error',
  /theAPPARENTConflictThatIsNot/.test(g4) && /Different windows/.test(g4));
ok('and our register really does say five in under 12 months',
  /the fifth manager in under 12 months/.test(MD));

/* --- the silent gap --- */
ok('Livramento is absent from both editions', !heldByRegister('Livramento'));
ok('and the capture says why a silent gap is worse than a visible error',
  /It is a silent one/.test(g4));

/* --- still no prices, four Guardian captures running --- */
const g4cap = CAPS5.declared.find((c) => c.sourceId === 'guardian-previews-17-18');
ok('previews 17-18 declare zero prices',
  g4cap === undefined || (g4cap.statedTotal === 0 && g4cap.exact.length === 0));

console.log(`checks passed ${pass}/${pass + fail.length}`);
fail.forEach((f) => console.log('  FAIL ' + f));
process.exit(fail.length ? 1 : 0);
