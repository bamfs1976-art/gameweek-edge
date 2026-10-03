/*
 * Club loyalty (Manager Report): points per start for favourite-club picks
 * against the rest, the share of starts, the captain counted once, and the
 * sample floor below which it says nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractFn, extractDecl } from './extract.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const { clubBias } = new Function(extractDecl(html, 'BIAS_MIN_STARTS') + '\n' + extractFn(html, 'clubBias') + '\nreturn {clubBias};')();

let n = 0, failures = 0;
const ok = (c, label) => { n++; if (!c) { failures++; console.error('  ✗ ' + label); } };
console.log('• club loyalty');

/* Player 1 plays for the favourite club (team 9), players 2-11 do not. */
const team = { 1: 9 }; for (let i = 2; i <= 12; i++) team[i] = 1;
const week = (favPts, otherPts, capFav) => ({
  team,
  picks: Array.from({ length: 12 }, (_, k) => ({ element: k + 1, multiplier: k === 11 ? 0 : (capFav && k === 0) || (!capFav && k === 1) ? 2 : 1, is_captain: capFav ? k === 0 : k === 1 })),
  pts: Object.fromEntries(Array.from({ length: 12 }, (_, k) => [k + 1, k === 0 ? favPts : otherPts])),
});
const cold = clubBias(Array.from({ length: 10 }, () => week(2, 5, true)), 9, 0.04);
ok(cold.favStarts === 10 && cold.enough, 'ten starts is enough to say something');
ok(cold.favPerStart === 2 && cold.otherPerStart === 5, 'points per start, the captain counted once');
ok(cold.cost === 30, 'cost is what those starts would have scored at your other picks\' rate (10 x 3)');
ok(Math.abs(cold.share - 1 / 11) < 1e-9, 'the share counts starters only, not the bench');
ok(cold.favCaptain === 10 && cold.captaincies === 10, 'and counts the armband');
const hot = clubBias(Array.from({ length: 10 }, () => week(9, 4, false)), 9, 0.04);
ok(hot.cost === -50, 'a club pick that outscores the rest shows as a gain, not a cost');
const thin = clubBias(Array.from({ length: 3 }, () => week(2, 5, false)), 9, 0.04);
ok(!thin.enough, 'three starts is too few to judge');
ok(clubBias([], 9, 0.04).favPerStart === null, 'no season, no numbers');

console.log(failures ? `${failures} of ${n} check(s) failed` : `${n}/${n} checks passed`);
process.exit(failures ? 1 : 0);
