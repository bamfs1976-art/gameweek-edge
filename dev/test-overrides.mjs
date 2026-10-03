/*
 * A Pro manager's own team news: storage, merge and what it does to the
 * projection. The functions are lifted out of index.html the way every
 * suite does it, so this grades the code that ships.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractFn, extractDecl, minutesSupport } from './extract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const congest = ['CONGEST_FULL', 'CONGEST_FADE', 'CONGEST_MAX', 'CONGEST_NAILED', 'CONGEST_TO_BENCH'].map((n) => extractDecl(html, n)).join('\n');
const api = new Function([
  congest, extractFn(html, 'congestionFactor'), minutesSupport(html),
  extractDecl(html, 'OVR_KINDS'),
  ...['minutesModel', 'ovrNormalise', 'ovrMerge'].map((n) => extractFn(html, n)),
].join('\n') + '\nreturn {minutesModel, ovrNormalise, ovrMerge, availScale, overrideLive, MINUTES_BENCHED};')();

let failures = 0, n = 0;
const ok = (c, label) => { n++; if (!c) { failures++; console.error('  ✗ ' + label); } };
console.log('• your team news (overrides)');

/* Normalising what comes back from storage or the cloud. */
ok(api.ovrNormalise({ kind: 'out', until: '2026-10-18', updated: 5 }).until === '2026-10-18', 'a dated note keeps its date');
ok(api.ovrNormalise({ kind: 'out', until: '18/10/2026', updated: 5 }).until === null, 'a malformed date becomes "until cleared", not a crash');
ok(api.ovrNormalise({ kind: 'injured' }) === null, 'an unknown kind is dropped');
ok(api.ovrNormalise(null) === null, 'nothing stays nothing');

/* Merge: newest note per player wins, a clear included. */
const m = api.ovrMerge(
  { 1: { kind: 'out', updated: 10 }, 2: { kind: 'benched', updated: 30 }, 3: { kind: 'out', updated: 5 } },
  { 1: { kind: 'clear', updated: 20 }, 2: { kind: 'out', updated: 25 }, 4: { kind: 'benched', updated: 1 } });
ok(m[1].kind === 'clear', 'a clear made later on another device beats the older note here');
ok(m[2].kind === 'benched', 'a newer local note beats an older cloud one');
ok(m[3].kind === 'out' && m[4].kind === 'benched', 'notes held on only one side survive the merge');

/* What it does to the numbers. */
const el = { status: 'a', chance_of_playing_next_round: null, starts: 8, minutes: 700, element_type: 3, now_cost: 75 };
const base = api.minutesModel(el, 8, null);
const out = api.minutesModel({ ...el, _ovr: { kind: 'out' } }, 8, null);
const bench = api.minutesModel({ ...el, _ovr: { kind: 'benched' } }, 8, null);
const clear = api.minutesModel({ ...el, _ovr: { kind: 'clear' } }, 8, null);
ok(out.pAppear === 0 && out.minFrac === 0, '"out" zeroes the minutes');
ok(Math.abs(bench.pStart - api.MINUTES_BENCHED.start) < 1e-9, '"benched" uses the measured start rate for dropped regulars');
ok(bench.pAppear > bench.pStart && bench.minFrac < base.minFrac, '"benched" keeps a cameo but cuts the expected minutes');
ok(clear.src !== 'override' && Math.abs(clear.pStart - base.pStart) < 1e-12, 'a "clear" note changes nothing');
ok(api.availScale({ ...el, _ovr: { kind: 'out' } }) === 0, 'the ep_next path sees "out" as zero');
ok(api.availScale({ ...el, chance_of_playing_next_round: 75 }) === 0.75, 'without a note the FPL flag applies as before');
const bs = api.availScale({ ...el, _ovr: { kind: 'benched' } });
ok(bs > 0 && bs < 0.5, `the ep_next path scales a benched player down, not to zero (${bs.toFixed(3)})`);
ok(api.availScale({ ...el, chance_of_playing_next_round: 75, _ovr: { kind: 'out', until: '2000-01-01' } }) === 0.75,
  'an expired note hands back to the FPL flag');

/* A note is a manager's view: it must never reach the public model record. */
const logger = readFileSync(join(ROOT, 'netlify/functions/log-predictions.js'), 'utf8');
ok(!/ge-overrides|gwedge_overrides|ovrApply/.test(logger), 'the prediction logger never reads overrides');

console.log(failures ? `\n${failures} of ${n} check(s) failed` : `${n}/${n} checks passed`);
process.exit(failures ? 1 : 0);
