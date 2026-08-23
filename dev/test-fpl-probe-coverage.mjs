/*
 * Pins the coverage claim in dev/fpl-endpoint-probe.mjs.
 *
 * That probe answers "are all our FPL endpoints firing?", and the honesty of
 * the answer rests entirely on one sentence: how many of the proxy's
 * allowlist patterns it actually probed. The old version hand-wrote that
 * list, and it had drifted to twelve paths against an allowlist of fifteen —
 * the two head-to-head league routes and the CURRENT set-piece-notes path had
 * quietly fallen off. An endpoint nobody probes and an endpoint that passes
 * produce the same output: nothing. Silence read as health.
 *
 * So the list is derived from netlify/functions/fpl.js at run time, and this
 * asserts the derivation: every pattern is accounted for, ids are substituted
 * in the right places, and anything unprobeable is REPORTED as unprobeable
 * rather than dropped.
 *
 * No network — the probe stays inert on import.
 */

import { allowPatterns, concreteFor } from './fpl-endpoint-probe.mjs';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log(`  FAIL  ${msg}`); } };

console.log('fpl-endpoint-probe — allowlist coverage');

const pats = allowPatterns();

/* If the parser silently returns nothing, every downstream count is zero and
   the report would read as "nothing to probe" rather than "parser broke". */
ok(pats.length >= 15, `should parse the whole allowlist, got ${pats.length}`);
ok(pats.includes('bootstrap-static'), 'the simplest pattern should be parsed');
ok(pats.some((p) => /leagues-h2h/.test(p)), 'h2h patterns must be parsed, not skipped at the parse step');
ok(pats.some((p) => p === 'team\\/set-piece-notes'), 'the CURRENT set-piece-notes path must be covered');
ok(pats.some((p) => p === 'set-piece-notes'), 'the legacy set-piece-notes path is still allowlisted, so still probed');
ok(!pats.some((p) => /^\s*$/.test(p)), 'no blank patterns from comment lines');

const ids = { entry: 555, event: 1, element: 42, classic: 314, h2h: null };

/* EVERY pattern must produce either a path or a stated reason. A pattern that
   produced neither would vanish from both the results and the coverage line,
   which is the exact failure this file exists to prevent. */
const outcomes = pats.map((p) => ({ p, c: concreteFor(p, ids) }));
ok(outcomes.every((o) => o.c.path || o.c.skip),
  'every allowlist pattern must yield a path or a reason it was skipped');

const pathFor = (needle) => (outcomes.find((o) => o.p.includes(needle)) || {}).c;

ok(pathFor('bootstrap-static').path === 'bootstrap-static/', 'bootstrap-static maps straight through');
ok(pathFor('element-summary').path === 'element-summary/42/', 'element id substituted into element-summary');
ok(pathFor('event\\/\\d+\\/live').path === 'event/1/live/', 'event id substituted into the live route');
ok(pathFor('dream-team').path === 'dream-team/1/', 'dream-team is per-gameweek, so it takes the event id');
ok(pathFor('leagues-classic').path === 'leagues-classic/314/standings/', 'classic league id substituted');

/* The two-id case, and the one most likely to be got wrong: entry first,
   gameweek second. Swapping them yields a real-looking path that 404s. */
const picks = outcomes.find((o) => o.p.includes('picks')).c;
ok(picks.path === 'entry/555/event/1/picks/',
  `picks should be entry-then-event, got ${picks.path || picks.skip}`);

/* h2h has no obtainable id. It must be skipped WITH A REASON, never silently
   dropped and never guessed — a guessed league id 404s and the headline
   becomes "our h2h endpoint is broken", which is a claim about the id. */
const h2h = outcomes.filter((o) => o.p.includes('leagues-h2h'));
ok(h2h.length === 2, 'both h2h routes should be present in the allowlist');
ok(h2h.every((o) => o.c.skip && !o.c.path), 'h2h must be skipped, not guessed');
ok(h2h.every((o) => /no real head-to-head league id/.test(o.c.skip)),
  'the h2h skip must say WHY, so it reads as unprobed rather than unhealthy');

/* And when an entry id could not be resolved, entry routes must skip too —
   not fall back to a made-up id. */
const noEntry = concreteFor('entry\\/\\d+\\/history', { ...ids, entry: null });
ok(noEntry.skip && !noEntry.path, 'with no real entry id, entry routes must be skipped');

/* Nothing may escape with regex metacharacters still in it: a path like
   "entry/\\d+/history/" would be requested literally and 404, which would be
   reported as a dead endpoint. */
ok(outcomes.every((o) => !o.c.path || !/\\|\+/.test(o.c.path)),
  'no produced path may still contain regex metacharacters');

/* A synthetic three-id pattern, because no REAL allowlist entry has more than
   two. Without this, replacing only the first metacharacter instead of all of
   them passes every check above — the entry and element branches happen to
   consume the first one, so first-only and global are indistinguishable on
   today's fifteen. That is a gap in the evidence, not a property of the code,
   and it would open silently the day somebody adds a third id to a route. */
const triple = concreteFor('a\\/\\d+\\/b\\/\\d+\\/c\\/\\d+', ids);
ok(triple.path === 'a/1/b/1/c/1/',
  `every metacharacter must be substituted, not just the first — got ${triple.path || triple.skip}`);

console.log(`${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);
