#!/usr/bin/env node
/* Vendor the unofficial FPL OpenAPI spec — a second opinion on the API.
 *
 *   node scripts/vendor-fpl-spec.mjs              # fetch from source, re-vendor
 *   node scripts/vendor-fpl-spec.mjs --check      # verify what is committed (offline)
 *   node scripts/vendor-fpl-spec.mjs --check --remote  # re-fetch, fail if drifted
 *
 * WHY THIS REPO WANTS A SPEC AT ALL. The FPL API is undocumented, and this
 * app's most expensive bugs have all lived at the boundary with it — not in
 * our arithmetic but in what a field MEANS at a given moment of a matchday.
 * `event_total` and `total` freeze until FPL scores the week; `overall_rank`
 * is null while it is being scored; `finished` and `finished_provisional`
 * settle in two stages; live BPS is all zeros at kick-off. Every one of those
 * shipped, and every one was found by a person looking at the site rather
 * than by a test.
 *
 * The reason tests could not find them is dev/mock_fpl.py. It is the only
 * FPL the suite ever talks to, and it was written from the same assumptions
 * as the code it exercises — so where the code misunderstood the API, the
 * mock misunderstood it identically and agreed. A mock that is wrong in the
 * same direction as the code under test is worse than no mock, because it
 * reports confidence. Three times now the mock has simply not served a field
 * the real API serves, and each time that silence hid a live bug.
 *
 * A spec written by somebody else breaks that symmetry. It is the only
 * independent description of the API this repo can get: it was not derived
 * from our code, so where it disagrees with the mock, at least one of them is
 * wrong and it is worth ten minutes to find out which.
 *
 * WHAT IT IS NOT. Not official, not authoritative, and not a passing grade.
 * It is one person's reading of an undocumented API, it can be stale, and it
 * has a demonstrable blind spot of its own: it declares no nullable types at
 * all, so it types `overall_rank` as a plain required integer — the very
 * field whose null we shipped a bug over. dev/test-fpl-contract.mjs treats it
 * accordingly, hard-failing only where the disagreement is unambiguous.
 *
 * WHY A COPY, PINNED, RATHER THAN A FETCH. The same reason as
 * scripts/vendor-rotation.mjs: `npm test` must pass offline and in CI, and a
 * check whose verdict depends on somebody else's uptime is a check that gets
 * deleted the first week it goes red for a reason nobody caused. The copy is
 * pinned to a full commit SHA and its SHA-256 recorded, so drift is a thing
 * you adopt deliberately by re-running this and reading the diff.
 *
 * WHY JSON RATHER THAN THE YAML AS PUBLISHED. This repo ships no runtime and
 * no test dependencies, and Node cannot parse YAML without one. python3 is
 * already a hard prerequisite for the mock server, so the conversion happens
 * here, once, at vendoring time — and the committed artefact is something the
 * test can read with JSON.parse and nothing else. The YAML's own SHA-256 is
 * recorded alongside, so the pin describes the bytes actually published
 * rather than the bytes we derived from them.
 *
 * LICENCE. MIT, Copyright (c) 2026 Max McClowes. Reproduced in the manifest.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'dev', 'fixtures', 'fpl-openapi.json');
const MANIFEST = join(root, 'scripts', 'vendor-fpl-spec.sha256.json');

const check = process.argv.includes('--check');
const remote = process.argv.includes('--remote');

/* PINNED TO A COMMIT, not to a branch — the recorded hash and the bytes it
 * describes have to still agree the next time anybody runs this. */
const SOURCE = {
  owner: 'mcclowes',
  repo: 'fpl-oas',
  path: 'static/openapi.yaml',
  commit: '9e7efac377ba52315137d7a40712ed6666e10ded',
  branch: 'main',
  licence: 'MIT, Copyright (c) 2026 Max McClowes',
};
const rawUrl = (ref) =>
  `https://raw.githubusercontent.com/${SOURCE.owner}/${SOURCE.repo}/${ref}/${SOURCE.path}`;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

/* YAML -> JSON via python3, which the mock server already requires. Failing
 * loudly here beats emitting a half-parsed spec that the test would then read
 * as "the API declares nothing", quietly passing everything. */
function yamlToJson(yaml) {
  const r = spawnSync('python3', ['-c',
    'import sys,json,yaml; json.dump(yaml.safe_load(sys.stdin.read()), sys.stdout, ' +
    'sort_keys=True, separators=(",",":"))'],
    { input: yaml, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error('python3 could not parse the spec as YAML: ' +
      String(r.stderr || r.error || '').trim().split('\n').slice(-1)[0]);
  }
  return r.stdout;
}

async function fetchSpec(ref) {
  const res = await fetch(rawUrl(ref), { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new Error(`GET ${rawUrl(ref)} -> HTTP ${res.status}`);
  return await res.text();
}

/* The committed artefact carries its own provenance, because a bare JSON blob
 * in a fixtures directory is indistinguishable from something somebody typed. */
const wrap = (spec, yamlHash, fetched) => JSON.stringify({
  _source: `${SOURCE.owner}/${SOURCE.repo} ${SOURCE.path} @ ${SOURCE.commit}`,
  _licence: SOURCE.licence,
  _fetched: fetched,
  _yaml_sha256: yamlHash,
  _note: 'Vendored by scripts/vendor-fpl-spec.mjs. Do not hand-edit; re-run it.',
  spec: JSON.parse(spec),
}, null, 0) + '\n';

const readManifest = () =>
  existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;

async function main() {
  if (check) {
    const man = readManifest();
    if (!man) { console.error('✗ no manifest — run: node scripts/vendor-fpl-spec.mjs'); process.exit(1); }
    if (!existsSync(OUT)) { console.error('✗ ' + OUT + ' is missing'); process.exit(1); }

    const onDisk = readFileSync(OUT, 'utf8');
    if (sha256(onDisk) !== man.json_sha256) {
      console.error('✗ dev/fixtures/fpl-openapi.json does not match its recorded hash.');
      console.error('  It has been hand-edited, or vendored by a different run.');
      console.error('  Re-run: node scripts/vendor-fpl-spec.mjs');
      process.exit(1);
    }
    /* The artefact has to be readable as what the test expects, not merely
       intact — a valid JSON file with no paths would pass a hash check and
       then silently check nothing. */
    let paths = 0;
    try { paths = Object.keys(JSON.parse(onDisk).spec.paths || {}).length; } catch (_) {}
    if (paths < 10) {
      console.error(`✗ the vendored spec describes ${paths} paths — that is not a spec.`);
      process.exit(1);
    }
    console.log(`✓ FPL OpenAPI spec intact: ${paths} paths, ${man.commit.slice(0, 10)}, fetched ${man.fetched}`);

    if (remote) {
      const yaml = await fetchSpec(SOURCE.commit);
      if (sha256(yaml) !== man.yaml_sha256) {
        console.error('✗ the pinned commit no longer serves the bytes we recorded.');
        process.exit(1);
      }
      console.log('✓ and the pinned commit still serves those exact bytes');
      const head = await fetchSpec(SOURCE.branch);
      if (sha256(head) !== man.yaml_sha256) {
        console.log(`· note: ${SOURCE.branch} has moved on from the pin.`);
        console.log('  Re-vendor deliberately when you want it: node scripts/vendor-fpl-spec.mjs');
      } else {
        console.log(`✓ and ${SOURCE.branch} has not moved since`);
      }
    }
    return;
  }

  const yaml = await fetchSpec(SOURCE.commit);
  const yamlHash = sha256(yaml);
  const json = yamlToJson(yaml);
  const parsed = JSON.parse(json);
  const nPaths = Object.keys(parsed.paths || {}).length;
  const nSchemas = Object.keys((parsed.components || {}).schemas || {}).length;
  if (nPaths < 10) throw new Error(`the fetched spec describes only ${nPaths} paths`);

  const prev = readManifest();
  const fetched = (prev && prev.yaml_sha256 === yamlHash) ? prev.fetched : today();
  const body = wrap(json, yamlHash, fetched);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body);
  writeFileSync(MANIFEST, JSON.stringify({
    source: `${SOURCE.owner}/${SOURCE.repo}`,
    path: SOURCE.path,
    commit: SOURCE.commit,
    branch: SOURCE.branch,
    licence: SOURCE.licence,
    fetched,
    yaml_sha256: yamlHash,
    json_sha256: sha256(body),
    paths: nPaths,
    schemas: nSchemas,
  }, null, 2) + '\n');

  console.log(`✓ vendored ${nPaths} paths and ${nSchemas} schemas`);
  console.log(`  from ${SOURCE.owner}/${SOURCE.repo}@${SOURCE.commit.slice(0, 10)} (${SOURCE.licence})`);
  console.log(`  yaml sha256 ${yamlHash.slice(0, 16)}…  ->  dev/fixtures/fpl-openapi.json`);
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
