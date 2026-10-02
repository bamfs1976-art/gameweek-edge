/*
 * Squad screenshot import: the request the server sends (image checks, the
 * structured-output schema) and matchScan, which turns names read off an
 * image into real FPL players. No network, no model call.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractFn, extractDecl } from './extract.mjs';
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const { matchScan } = new Function([extractFn(html, 'scanNorm'), extractDecl(html, 'SCAN_POS'), extractFn(html, 'matchScan')].join('\n') + '\nreturn {matchScan};')();
const { buildScanRequest } = require(join(ROOT, 'netlify', 'functions', 'ai.js'));

let n = 0, failures = 0;
const ok = (c, label) => { n++; if (!c) { failures++; console.error('  ✗ ' + label); } };
console.log('• squad screenshot import');

const req = buildScanRequest({ media_type: 'image/jpeg', data: 'QUJD' });
ok(req && req.model === 'claude-opus-5-5', 'reads with Claude Opus 5.5');
ok(req.output_config.format.type === 'json_schema' && req.output_config.format.schema.additionalProperties === false, 'and asks for strict JSON, so the reply always parses');
ok(req.messages[0].content[0].type === 'image' && req.messages[0].content[0].source.type === 'base64', 'the image goes first, as base64');
ok(req.fallbacks === 'default', 'with the server-side fallback switched on');
ok(buildScanRequest({ media_type: 'image/gif', data: 'QUJD' }) === null, 'a GIF is refused');
ok(buildScanRequest({ media_type: 'image/png', data: 'not base64!' }) === null, 'so is anything that is not base64');
ok(buildScanRequest({ media_type: 'image/png', data: 'A'.repeat(7e6) }) === null, 'and anything over about 5 MB');

const el = (id, web, first, second, team, type, own) => ({ id, web_name: web, first_name: first, second_name: second, team, element_type: type, selected_by_percent: String(own) });
const b = {
  raw: { teams: [{ id: 1, short_name: 'ARS', name: 'Arsenal' }, { id: 2, short_name: 'MCI', name: 'Man City' }, { id: 3, short_name: 'NEW', name: 'Newcastle' }] },
  elements: [
    el(1, 'Saka', 'Bukayo', 'Saka', 1, 3, 40), el(2, 'Haaland', 'Erling', 'Haaland', 2, 4, 60),
    el(3, 'Gabriel', 'Gabriel', 'dos Santos Magalhães', 1, 2, 30), el(4, 'G.Jesus', 'Gabriel', 'Fernando de Jesus', 1, 4, 2),
    el(5, 'Gordon', 'Anthony', 'Gordon', 3, 3, 10), el(6, 'Ødegaard', 'Martin', 'Ødegaard', 1, 3, 12),
  ],
};
const r = matchScan(b, [
  { name: 'Saka', club: 'ARS', position: 'MID' },
  { name: 'Haaland', club: '', position: 'FWD' },
  { name: 'Gabriel', club: 'ARS', position: 'DEF' },
  { name: 'Odegaard', club: 'Arsenal', position: 'MID' },
  { name: 'Anthony Gordon', club: 'NEW', position: 'unknown' },
  { name: 'Nobody', club: 'ARS', position: 'MID' },
]);
const nameOf = (i) => (r.rows[i].el || {}).web_name;
ok(nameOf(0) === 'Saka' && nameOf(1) === 'Haaland', 'an exact display name matches, club or no club');
ok(nameOf(2) === 'Gabriel', 'position separates the defender Gabriel from Gabriel Jesus');
ok(nameOf(3) === 'Ødegaard', 'accents do not matter: Odegaard finds Ødegaard');
ok(nameOf(4) === 'Gordon', 'a full name finds the player');
ok(!r.rows[5].el && r.unmatched === 1, 'a name that is not in the game is reported, not guessed');
ok(new Set(r.ids).size === r.ids.length, 'no player is used twice');
const twice = matchScan(b, [{ name: 'Gabriel', club: 'ARS', position: 'unknown' }, { name: 'Gabriel', club: 'ARS', position: 'unknown' }]);
ok(twice.ids.length === 2 && twice.ids[0] !== twice.ids[1], 'two Gabriels land on two players, most-owned first');

console.log(failures ? `${failures} of ${n} check(s) failed` : `${n}/${n} checks passed`);
process.exit(failures ? 1 : 0);
