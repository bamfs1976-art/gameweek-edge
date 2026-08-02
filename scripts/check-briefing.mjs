/*
 * Check a hand-compiled pre-season briefing against the live FPL API.
 *
 *   node scripts/check-briefing.mjs
 *   node scripts/check-briefing.mjs --file docs/briefings/2026-27-preseason.md
 *   FPL_API=http://127.0.0.1:8700/api/fpl node scripts/check-briefing.mjs
 *
 * Why this exists.
 *
 * The briefing is research, not data. It carries real value the API does not
 * have — who the manager is, what a club paid, that Villa's set-piece coach
 * followed the money to Chelsea — and it also carries forty-odd claims the
 * API states authoritatively: prices, penalty and set-piece order, who is
 * actually in a squad, and what GW1 is. Its own caveats say so: "confirm
 * every price", "re-check duties after pre-season friendlies", "two minor
 * source conflicts to verify".
 *
 * The app's AI system prompt is "reason ONLY over the JSON data provided —
 * never invent players, fixtures, prices or statistics not in it". Pasting a
 * markdown file in as grounding breaks that contract quietly: the Scout would
 * begin stating a rumoured penalty order as fact, with our name on it, on a
 * product whose whole claim is that its numbers are published and graded. So
 * the checkable half gets checked, and only what survives goes near the app.
 *
 * COVERAGE IS REPORTED, NOT ASSUMED. A parser that silently reads half a
 * document and prints "all clear" is worse than no parser — it converts an
 * unchecked file into a checked-looking one. This one counts what it
 * extracted, prints it, and exits non-zero if the shape of the document is
 * not what it expected.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };
/* The HTML edition carries the same briefing as a structured TEAMS array, so
   it is the default: nothing is guessed from prose, and it states the opening
   fixtures gameweek by gameweek — the one claim type the API settles
   outright. Pass --file to check the markdown instead. */
const FILE = arg('file') || 'docs/briefings/2026-27-preseason.html';
const API = (process.env.FPL_API || 'https://fantasy.premierleague.com/api').replace(/\/$/, '');

import { clubBlocks, priceClaims, penaltyClaims, moveClaims,
  teamsFromHtml, claimsFromTeams, fixtureContradictions } from './briefing-parse.mjs';

const md = readFileSync(join(ROOT, FILE), 'utf8');

/* ── the API ──────────────────────────────────────────────── */
async function fpl(path) {
  const r = await fetch(API + '/' + path);
  if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
  return r.json();
}

/* Match a briefing name to a squad. Surnames are what the briefing uses and
   `web_name` is usually the surname, so try that first, then the full name.
   Accents and case are stripped on both sides — "Gyokeres" must find
   "Gyökeres" or every Scandinavian in the league reads as a conflict. */
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z ]/g, '').trim();
function findPlayer(els, name) {
  const n = norm(name);
  const last = n.split(' ').pop();
  const exact = els.filter((e) => norm(e.web_name) === n ||
    norm(e.first_name + ' ' + e.second_name) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return { ambiguous: exact.length };
  const bySurname = els.filter((e) => norm(e.second_name).split(' ').pop() === last ||
    norm(e.web_name).split(' ').pop() === last);
  if (bySurname.length === 1) return bySurname[0];
  if (bySurname.length > 1) return { ambiguous: bySurname.length };
  return null;
}

const say = (icon, s) => console.log('  ' + icon + ' ' + s);
const R = { agree: 0, conflict: 0, missing: 0, ambiguous: 0 };
let selfBad = 0;
const conflicts = [];   /* {key, msg} — key is the fact, so one fact reports once */
const unresolved = [];   /* the briefing hedged and the API has not settled it yet */

const HTML = /\.html?$/i.test(FILE);
const briefTeams = HTML ? teamsFromHtml(md) : null;
const structured = briefTeams ? claimsFromTeams(briefTeams) : null;
const blocks = briefTeams ? briefTeams.map((t) => ({ name: t.name, body: '' })) : clubBlocks(md);
const prices = structured ? structured.prices : priceClaims(md);
const pens = structured ? structured.pens : penaltyClaims(blocks);
const moves = structured ? structured.moves : moveClaims(blocks);
const fxClaims = structured ? structured.fixtures : [];

console.log('Briefing: ' + FILE + (HTML ? '  (structured)' : '  (prose)'));
console.log('Parsed: ' + blocks.length + ' clubs · ' + prices.length + ' price claims · ' +
  pens.length + ' penalty claims · ' + moves.length + ' squad moves' +
  (fxClaims.length ? ' · ' + fxClaims.length + ' fixture claims' : '') + '\n');

/* The shape guard. If the document is reorganised and the parser silently
   stops finding club blocks, this must fail loudly rather than report a clean
   run over nothing — the exact failure mode that made an earlier dependency
   check in this repo useless for weeks. */
let shapeBad = false;
const shape = (cond, msg) => { if (!cond) { shapeBad = true; console.error('  ✗ SHAPE: ' + msg); } };
shape(blocks.length === 20, 'expected 20 clubs, found ' + blocks.length);
shape(!HTML || fxClaims.length >= 50, 'expected opening fixtures per club, found ' + fxClaims.length);
shape(prices.length >= 10, 'expected at least 10 price claims, found ' + prices.length);
shape(pens.length >= 15, 'expected a penalty claim for most clubs, found ' + pens.length);
shape(moves.length >= 40, 'expected a squad-move list per club, found ' + moves.length);
if (shapeBad) {
  console.error('\nThe briefing is not the shape this parser understands. Fix the parser ' +
    'before trusting a clean result — a partial parse that reports "all clear" is the bug.');
  process.exit(2);
}

/* ── the briefing against itself ──────────────────────────── */
/* Needs no network, so it runs first. Every fixture is stated twice — once by
   each club — and the two statements can disagree. A document that contradicts
   itself should be caught the moment it lands, not the next time someone has
   an internet connection. */
if (fxClaims.length) {
  const bad = fixtureContradictions(fxClaims, briefTeams.map((t) => t.name));
  console.log('INTERNAL CONSISTENCY (no API needed)');
  if (!bad.length) say('·', 'every fixture claim agrees with the opponent\'s own claim');
  else {
    say('✗', bad.length + ' of the fixture claims contradict another claim in the same document');
    for (const b of bad) console.log('      • ' + b.msg);
    say('·', 'the API cannot settle these — one of the two claims is simply wrong, ' +
      'and until the fixture list is read directly neither can be trusted');
  }
  console.log('');
  selfBad = bad.length;
}

let boot, fixtures;
try {
  [boot, fixtures] = await Promise.all([fpl('bootstrap-static/'), fpl('fixtures/')]);
} catch (e) {
  console.error('\nCould not reach the FPL API (' + API + '): ' + e.message);
  console.error('The briefing parsed cleanly; nothing was verified. Re-run with network access.');
  process.exit(3);
}
const els = boot.elements || [];
const teams = Object.fromEntries((boot.teams || []).map((t) => [t.id, t]));
const teamByName = {};
for (const t of boot.teams || []) { teamByName[norm(t.name)] = t; teamByName[norm(t.short_name)] = t; }

/* ── prices ───────────────────────────────────────────────── */
console.log('PRICES');
for (const c of prices) {
  const p = findPlayer(els, c.name);
  if (!p) { R.missing++; continue; }
  if (p.ambiguous) { R.ambiguous++; continue; }
  const live = (p.now_cost || 0) / 10;
  if (Math.abs(live - c.price) < 0.05) R.agree++;
  else if (c.est) { R.agree++; }          /* an estimate is not a claim of fact */
  else {
    R.conflict++;
    conflicts.push({ key: 'price:' + p.id, msg: 'price · ' + p.web_name + ': briefing £' +
      c.price.toFixed(1) + 'm, API £' + live.toFixed(1) + 'm' });
  }
}
say('·', R.agree + ' agree, ' + R.conflict + ' conflict, ' + R.missing + ' not in the game, ' +
  R.ambiguous + ' ambiguous name');

/* ── penalties ────────────────────────────────────────────── */
console.log('\nPENALTIES (API field: penalties_order)');
let penAgree = 0, penWrong = 0, penUnset = 0, penGone = 0;
for (const c of pens) {
  const p = findPlayer(els, c.name);
  if (!p || p.ambiguous) { penGone++; continue; }
  const order = p.penalties_order;
  if (order == null) { penUnset++; continue; }
  if (order === 1) penAgree++;
  else {
    penWrong++;
    conflicts.push({ key: 'pen:' + p.id, msg: 'penalties · ' + c.club + ': briefing says ' +
      c.name + ' primary, API has him at order ' + order });
  }
}
say('·', penAgree + ' confirmed primary, ' + penWrong + ' contradicted, ' +
  penUnset + ' unset in the API, ' + penGone + ' not found');
if (penUnset) say('·', 'an unset order is not a disagreement — pre-season FPL often ' +
  'publishes none, which is exactly when a briefing is guessing too');

/* ── squad membership ─────────────────────────────────────── */
console.log('\nSQUAD MOVES (is the player where the briefing says?)');
let mvOk = 0, mvWrong = 0, mvUnknown = 0, mvHedged = 0;
for (const c of moves) {
  const p = findPlayer(els, c.name);
  const club = teamByName[norm(c.club)];
  if (!club) { mvUnknown++; continue; }
  if (!p || p.ambiguous) {
    /* An "Out" player absent from the game is the briefing being right. */
    if (c.dir === 'Out') mvOk++; else mvUnknown++;
    continue;
  }
  const atClub = p.team === club.id;
  if ((c.dir === 'In') === atClub) mvOk++;
  else if (c.hedged) {
    mvHedged++;
    unresolved.push(c.club + ' ' + c.dir + ': ' + p.web_name + ' — briefing calls this ' +
      'unconfirmed, and the API still has him at ' +
      (teams[p.team] ? teams[p.team].short_name : '?'));
  } else {
    mvWrong++;
    /* Keyed on the PLAYER: a move is one fact that the briefing states twice,
       once as the buying club's In and once as the selling club's Out. */
    conflicts.push({ key: 'squad:' + p.id, msg: 'squad · ' + p.web_name + ' is at ' +
      (teams[p.team] ? teams[p.team].short_name : '?') +
      ', which contradicts ' + c.club + ' ' + c.dir });
  }
}
say('·', mvOk + ' consistent, ' + mvWrong + ' contradicted, ' + mvHedged +
  ' still-open rumours, ' + mvUnknown + ' unresolvable');

/* ── opening fixtures ─────────────────────────────────────── */
/* The claims the API settles outright: who a club plays in a given gameweek,
   and whether it is home. The briefing itself flags one of these as unsure —
   Hull's GW1 is written "Man Utd (H?)" — and this is the check that answers
   it rather than leaving it on a to-do list. */
if (fxClaims.length) {
  console.log('\nOPENING FIXTURES');
  let fxOk = 0, fxOpp = 0, fxVenue = 0, fxNone = 0, fxHedged = 0;
  const shortOf = {};
  for (const t of boot.teams || []) {
    shortOf[norm(t.name)] = t.id; shortOf[norm(t.short_name)] = t.id;
  }
  /* The briefing uses everyday club names — "Forest", "Man Utd", "Spurs" —
     which are neither the API's `name` nor its `short_name`. Matching on the
     longest common form keeps a naming difference from reading as a wrong
     fixture, which would drown the real ones. */
  const teamId = (label) => {
    const n = norm(label);
    if (shortOf[n] != null) return shortOf[n];
    const hit = (boot.teams || []).find((t) => norm(t.name).includes(n) || n.includes(norm(t.short_name)) ||
      norm(t.name).split(' ').some((w) => w.length > 3 && n.includes(w)));
    return hit ? hit.id : null;
  };
  for (const c of fxClaims) {
    const me = teamId(c.club), them = teamId(c.opp);
    if (me == null || them == null) { fxNone++; continue; }
    const f = (fixtures || []).find((x) => x.event === c.gw &&
      ((x.team_h === me && x.team_a === them) || (x.team_a === me && x.team_h === them)));
    if (!f) { fxNone++; continue; }
    const reallyHome = f.team_h === me;
    if (reallyHome === c.home) fxOk++;
    else if (c.hedged) {
      fxHedged++;
      unresolved.push(c.club + ' GW' + c.gw + ': briefing was unsure of the venue and it is ' +
        (reallyHome ? 'HOME' : 'AWAY'));
    } else {
      fxVenue++;
      conflicts.push({ key: 'fx:' + me + ':' + c.gw, msg: 'fixture · ' + c.club + ' GW' + c.gw +
        ' v ' + c.opp + ': briefing says ' + (c.home ? 'home' : 'away') + ', API says ' +
        (reallyHome ? 'home' : 'away') });
    }
  }
  say('·', fxOk + ' exact, ' + fxVenue + ' wrong venue, ' + fxHedged + ' venue the briefing flagged, ' +
    fxNone + ' opponent not found in that gameweek');
  /* A club the briefing pairs with the wrong opponent shows up here rather
     than as a venue error, and it is the more serious of the two. */
  if (fxNone) say('·', 'an unfound pairing is either a naming difference or a wrong opponent — ' +
    'check a sample before dismissing it');
}

/* ── GW1 ──────────────────────────────────────────────────── */
console.log('\nGAMEWEEK 1');
const ev1 = (boot.events || []).find((e) => e.id === 1);
if (ev1) {
  const d = new Date(ev1.deadline_time);
  say('·', 'deadline ' + d.toUTCString());
  const claimed = (md.match(/Season starts\s+\w+\s+(\d+\s+\w+\s+\d{4})/) || [])[1];
  if (claimed) say('·', 'briefing says the season starts ' + claimed);
}
const gw1 = (fixtures || []).filter((f) => f.event === 1);
say('·', gw1.length + ' fixtures in GW1' + (gw1.length
  ? ': ' + gw1.map((f) => (teams[f.team_h] || {}).short_name + ' v ' + (teams[f.team_a] || {}).short_name).join(', ')
  : ''));

/* ── the report ───────────────────────────────────────────── */
console.log('\n' + '─'.repeat(60));

/* The guard this whole file is about. If almost nothing matched a real player,
   then nothing was checked — and printing "no conflicts" over that converts an
   unverified briefing into a verified-looking one, which is worse than not
   running at all. It fires on a synthetic or stale bootstrap, and on a name
   format the matcher cannot read. */
const checkable = prices.length + pens.length;
const matched = (R.agree + R.conflict) + (penAgree + penWrong + penUnset);
const rate = checkable ? matched / checkable : 0;
if (rate < 0.5) {
  console.error('VERIFIED ALMOST NOTHING — ' + matched + ' of ' + checkable +
    ' name-based claims (' + Math.round(rate * 100) + '%) matched a player in the API.');
  console.error('Do not read this as a clean run. Either the feed is not the real');
  console.error('game (a mock or a stale season), or the name matcher needs work.');
  process.exit(4);
}

/* The same fact is often stated twice — once in a club block, once in the
   shortlist — and Semenyo moving clubs is one fact that shows up as both an
   "In" and an "Out". Report each once. */
const seen = new Set();
const unique = conflicts.filter((c) => (seen.has(c.key) ? false : seen.add(c.key)));
conflicts.length = 0; conflicts.push(...unique);

if (conflicts.length) {
  console.log(conflicts.length + ' CONFLICT' + (conflicts.length === 1 ? '' : 'S') +
    ' — the API disagrees with the briefing:\n');
  for (const c of conflicts) console.log('  ✗ ' + c.msg);
  console.log('\nThe API wins on all of these. It is the game.');
} else {
  console.log('No conflicts on the checkable claims.');
}
if (selfBad) {
  console.log('\nPlus ' + selfBad + ' internal contradiction' + (selfBad === 1 ? '' : 's') +
    ' listed above — the briefing disagreeing with itself, which no feed can fix.');
}
if (unresolved.length) {
  console.log('\n' + unresolved.length + ' STILL OPEN — the briefing flagged these itself:\n');
  for (const u of unresolved) console.log('  ? ' + u);
}
console.log('\nNOT CHECKABLE, and this is the briefing\'s real value: managers,');
console.log('transfer fees, set-piece coaching changes, and the narrative behind');
console.log('a squad. None of it is in the API. None of it was verified here.');
process.exit(conflicts.length || selfBad ? 1 : 0);
