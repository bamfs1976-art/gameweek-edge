/*
 * Gameweek Edge — enrichment CLI (read-only).
 *
 *   node dev/enrich-cli.mjs --gameweek 1 --players 1,2,3 --include-news
 *   node dev/enrich-cli.mjs --health          # just say what is configured
 *
 * Prints structured JSON on stdout and nothing else, so it pipes into jq.
 * Human-readable notes go to stderr.
 *
 * IT MUTATES NOTHING. No transfer, no team change, no purchase, no post.
 *
 * Exit codes:
 *   0  a response was produced, even if optional providers were skipped
 *   1  the CORE input failed — no official FPL data, nothing to enrich
 *   2  bad usage
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildFplEnrichment } = require(join(ROOT, 'netlify/lib/enrichment'));
const { loadConfig } = require(join(ROOT, 'netlify/lib/enrichment/config'));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, dflt = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const ids = (raw) => String(raw || '').split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);

if (has('--help')) {
  process.stderr.write('usage: node dev/enrich-cli.mjs [--gameweek N] [--players 1,2] [--teams 1,2] '
    + '[--include-news] [--no-news] [--include-recommendations] [--health]\n');
  process.exit(0);
}

/* Always report what is configured, on stderr, before anything else runs.
   "Which providers were skipped" is the first question anyone asks of a
   partial result, so it is answered without being asked. */
const config = loadConfig();
const states = Object.values(config.providers).map((p) => ({
  provider: p.name,
  enabled: p.enabled,
  configured: p.configured,
  missing: p.missing
}));
for (const s of states) {
  if (s.configured) continue;
  process.stderr.write(`skipping ${s.provider}: `
    + (s.enabled ? `not configured (set ${s.missing.join(', ') || 'its settings'})` : 'disabled') + '\n');
}

if (has('--health')) {
  process.stdout.write(JSON.stringify({ providers: states }, null, 2) + '\n');
  process.exit(0);
}

const gw = parseInt(val('--gameweek'), 10);
try {
  const out = await buildFplEnrichment({
    fplPlayerIds: ids(val('--players')).length ? ids(val('--players')) : null,
    teamIds: ids(val('--teams')).length ? ids(val('--teams')) : null,
    gameweek: Number.isFinite(gw) ? gw : null,
    includeNews: has('--no-news') ? false : true,
    includeRecommendations: has('--include-recommendations')
  });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  /* An optional provider failing is NOT a failure of the command. */
  process.exit(0);
} catch (err) {
  if (err && err.code === 'CORE_UNAVAILABLE') {
    process.stderr.write('core failure: the official FPL source is unavailable, so nothing could be enriched\n');
    process.stdout.write(JSON.stringify({ error: err.message, data_quality: err.dataQuality }, null, 2) + '\n');
    process.exit(1);
  }
  process.stderr.write(`unexpected failure: ${(err && err.message) || err}\n`);
  process.exit(1);
}
