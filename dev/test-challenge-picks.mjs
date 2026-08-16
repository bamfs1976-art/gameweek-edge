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

console.log(`checks passed ${pass}/${pass + fail.length}`);
fail.forEach((f) => console.log('  FAIL ' + f));
process.exit(fail.length ? 1 : 0);
