/*
 * Does FPL's entry_history.value already include the bank, or not?
 *
 * The squad planner needs a REBUILD budget: what a manager could raise if
 * they sold everything. That is value + bank if the two are disjoint, and
 * value alone if `value` is already the total. The difference is the whole
 * bank — small, but it is the difference between a planner that lets you
 * afford a player and one that does not, and guessing it would be a
 * guess baked into every squad the page builds.
 *
 * Nothing in the app answers it. bestTransfer uses `bank` as spending money
 * on top of an outgoing player's price, which is the single-transfer rule
 * and says nothing about the total. So: ask the API.
 *
 * The test. Sum the 15 players' now_cost from bootstrap and compare against
 * `value` and against `value + bank`. Whichever it matches is the answer.
 *
 * WHY NOW_COST IS GOOD ENOUGH, AND WHEN IT IS NOT. `value` is built from
 * SELLING prices, which sit below now_cost for anyone bought before a rise
 * (you bank half the gain). Early in a season almost nothing has moved, so
 * the two agree; deep into one they will not, and the comparison degrades
 * into noise. The run therefore prints the current gameweek and refuses to
 * conclude when the gap is too wide to attribute to either hypothesis.
 *
 * Entries come from the top of public league 314. No credentials.
 *
 * Run: node dev/fpl-budget-basis.mjs
 */
const BASE = 'https://fantasy.premierleague.com/api';
const UA = 'Mozilla/5.0 (compatible; GameweekEdgeProbe/1.0)';
const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(p + ' → ' + r.status);
  return r.json();
};
const m = (t) => '£' + (t / 10).toFixed(1) + 'm';

const boot = await get('/bootstrap-static/');
const cost = {};
(boot.elements || []).forEach((e) => { cost[e.id] = e.now_cost; });
const cur = (boot.events || []).find((e) => e.is_current)
  || (boot.events || []).filter((e) => e.finished).pop();
if (!cur) { console.log('No current gameweek — nothing to read.'); process.exit(0); }
console.log('Gameweek ' + cur.id + (cur.id <= 3 ? '  (early — selling prices still ≈ now_cost)' : '  (late — expect drift; read with care)'));
console.log('');

const std = await get('/leagues-classic/314/standings/');
const entries = ((std.standings && std.standings.results) || []).slice(0, 6);
if (!entries.length) { console.log('No entries available.'); process.exit(0); }

let votesExcl = 0, votesIncl = 0, inconclusive = 0;
console.log('entry        squad(now_cost)   value      bank     value+bank   verdict');
for (const e of entries) {
  let picks;
  try { picks = await get('/entry/' + e.entry + '/event/' + cur.id + '/picks/'); }
  catch (err) { console.log(String(e.entry).padEnd(12), 'picks unavailable (' + err.message + ')'); continue; }
  const eh = picks.entry_history || {};
  const sum = (picks.picks || []).reduce((s, p) => s + (cost[p.element] || 0), 0);
  if (!sum || eh.value == null) { console.log(String(e.entry).padEnd(12), 'incomplete row'); continue; }
  const dExcl = Math.abs(sum - eh.value);
  const dIncl = Math.abs(sum - (eh.value - (eh.bank || 0)));
  /* Which hypothesis the squad total sits closer to. A tie, or a gap
     bigger than the bank itself, means price drift has swamped the
     signal and this entry decides nothing. */
  let verdict;
  if (Math.min(dExcl, dIncl) > Math.max(20, (eh.bank || 0) + 10)) { verdict = 'no read (drift ' + m(Math.min(dExcl, dIncl)) + ')'; inconclusive++; }
  else if (dExcl < dIncl) { verdict = 'value EXCLUDES bank'; votesExcl++; }
  else if (dIncl < dExcl) { verdict = 'value INCLUDES bank'; votesIncl++; }
  else { verdict = 'tie (bank is £0.0m)'; inconclusive++; }
  console.log(String(e.entry).padEnd(12), m(sum).padEnd(17), m(eh.value).padEnd(10),
    m(eh.bank || 0).padEnd(8), m(eh.value + (eh.bank || 0)).padEnd(12), verdict);
}

console.log('');
console.log('excludes-bank votes: ' + votesExcl + '   includes-bank votes: ' + votesIncl + '   no read: ' + inconclusive);
if (votesExcl && !votesIncl) console.log('CONCLUSION: rebuild budget = value + bank.');
else if (votesIncl && !votesExcl) console.log('CONCLUSION: rebuild budget = value (bank already in it).');
else console.log('CONCLUSION: NONE — the entries disagree or every bank was £0.0m. Do not build on this.');
