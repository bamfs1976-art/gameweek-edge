/*
 * Gameweek Edge — tests for the enrichment layer (netlify/lib/enrichment/).
 *
 * Run: node dev/test-enrichment.mjs   (wired into npm test)
 *
 * No network. Every provider is driven by a fixture through an injected fetch,
 * so these tests exercise the real adapters rather than mocks of them.
 *
 * What is actually worth asserting here, in order of how badly it would hurt
 * to get wrong:
 *
 *   1. A MISSING LINE-UP PREDICTION IS NOT A PREDICTION OF BENCHING. The
 *      difference between null and false is the difference between "nobody
 *      said" and "he is dropped", and a dashboard that confuses them gives
 *      confidently wrong advice.
 *   2. NOTHING OVERWRITES THE OFFICIAL FEED. External sources enrich; where
 *      they disagree the disagreement is recorded, not applied.
 *   3. NAME MATCHING NEVER GUESSES. Ambiguity is returned for review. This
 *      project has twice shipped a bug where a name match quietly picked the
 *      wrong player, and both times it was invisible.
 *   4. SECRETS NEVER TRAVEL. Not into a cache key, a source_url or a log.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const F = (name) => JSON.parse(readFileSync(join(ROOT, 'dev/fixtures/enrichment', name), 'utf8'));

const { loadConfig } = require(join(ROOT, 'netlify/lib/enrichment/config'));
const { MemoryCache, cacheKey, redact } = require(join(ROOT, 'netlify/lib/enrichment/cache'));
const { request } = require(join(ROOT, 'netlify/lib/enrichment/http'));
const errs = require(join(ROOT, 'netlify/lib/enrichment/errors'));
const resolve = require(join(ROOT, 'netlify/lib/enrichment/resolve'));
const models = require(join(ROOT, 'netlify/lib/enrichment/models'));
const news = require(join(ROOT, 'netlify/lib/enrichment/news_matching'));
const { buildFplEnrichment, buildProviders } = require(join(ROOT, 'netlify/lib/enrichment'));
const { FplGraphqlProvider } = require(join(ROOT, 'netlify/lib/enrichment/providers/fpl_graphql'));
const { ApifyLiveFootballProvider } = require(join(ROOT, 'netlify/lib/enrichment/providers/apify_live_football'));
const { FootballDataProvider } = require(join(ROOT, 'netlify/lib/enrichment/providers/football_data'));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; } else { fails.push(m); console.error('  ✗ ' + m); } };
const section = (s) => console.log('• ' + s);

const BOOT = F('fpl-bootstrap.json');
const FIXTURES = F('fpl-fixtures.json');

/* A fetch stub that answers by URL substring, records calls, and fails loudly
   on an unexpected URL rather than returning undefined. */
function stubFetch(routes, log = []) {
  return async (url, opts = {}) => {
    log.push({ url, headers: opts.headers || {}, method: opts.method || 'GET', body: opts.body });
    for (const [needle, handler] of routes) {
      if (String(url).includes(needle)) {
        const r = typeof handler === 'function' ? handler(url, opts) : handler;
        return {
          ok: (r.status ?? 200) < 400, status: r.status ?? 200,
          headers: { get: (h) => (r.headers || {})[String(h).toLowerCase()] ?? null },
          json: async () => { if (r.throwJson) throw new Error('bad json'); return r.body; },
          text: async () => JSON.stringify(r.body)
        };
      }
    }
    throw new Error(`unstubbed URL: ${url}`);
  };
}

const baseEnv = {
  FPL_DATA_SELF_BASE_URL: 'https://example.test',
  FPL_DATA_RETRY_ATTEMPTS: '0',
  APIFY_FPL_INTELLIGENCE_ENABLED: 'false'
};
const liveRoutes = [
  ['/api/fpl/bootstrap-static', { body: BOOT }],
  ['/api/fpl/fixtures', { body: FIXTURES }],
  ['/api/football-data/matchday', { body: F('football-data-matchday.json') }]
];

/* ── configuration ─────────────────────────────────────────────────────── */
section('configuration names what is missing, never what is secret');
{
  const cfg = loadConfig({ ...baseEnv, WORLD_NEWS_API_KEY: 'super-secret' });
  ok(cfg.providers.official_fpl.configured === true, 'official FPL is configured with no credential');
  ok(cfg.providers.football_data.configured === true, 'football-data uses the already-configured proxy');
  ok(cfg.providers.world_news.configured === false, 'world news is not configured without a base URL');
  ok(cfg.providers.world_news.missing.includes('WORLD_NEWS_API_BASE_URL'), 'and says which setting is missing');
  ok(!cfg.providers.world_news.missing.includes('WORLD_NEWS_API_KEY'), 'the key it DOES have is not listed as missing');
  ok(!JSON.stringify(cfg.providers.world_news.missing).includes('super-secret'), 'no secret VALUE appears in the missing list');
  ok(cfg.providers.apify_fpl_intelligence.enabled === false, 'the recommendation provider is off by default');
  const dflt = loadConfig({});
  ok(dflt.providers.apify_live_football.cacheTtlMs > dflt.cacheTtlMs, 'Apify is cached harder than ordinary REST');
}

/* ── cache ─────────────────────────────────────────────────────────────── */
section('cache: keys are safe, and expiry means stale not gone');
{
  ok(!cacheKey('p', 'e', redact({ token: 'abc', gw: 1 })).includes('abc'), 'a secret-looking param never reaches a key');
  ok(cacheKey('p', 'e', { b: 2, a: 1 }) === cacheKey('p', 'e', { a: 1, b: 2 }), 'key is order-independent');

  let t = 0;
  const cache = new MemoryCache({ now: () => t });
  let calls = 0;
  const load = async () => { calls++; return { v: calls }; };

  let r = await cache.through('k', 100, load);
  ok(r.value.v === 1 && !r.cached, 'first call loads');
  r = await cache.through('k', 100, load);
  ok(r.value.v === 1 && r.cached && !r.stale, 'second call is a fresh hit');

  t = 500;                                   // expired
  const boom = async () => { throw new errs.ProviderTransportError('down', { provider: 'p' }); };
  r = await cache.through('k', 100, boom);
  ok(r.value.v === 1 && r.stale === true, 'an expired entry is served STALE rather than lost');
  ok(r.ageMs === 500, 'and reports its age so the UI can warn');

  const empty = new MemoryCache();
  let threw = false;
  try { await empty.through('k', 100, boom); } catch (_) { threw = true; }
  ok(threw, 'with no cached value at all, the failure propagates');
}

/* ── http ──────────────────────────────────────────────────────────────── */
section('http: retries the transient, refuses to retry the pointless');
{
  const opts = { provider: 'p', timeoutMs: 50, retryAttempts: 2, sleepImpl: async () => {}, rand: () => 0 };

  let n = 0;
  const flaky = async () => { n++; return n < 3 ? { ok: false, status: 503, headers: { get: () => null } } : { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: 1 }) }; };
  const res = await request('https://x.test/a', { ...opts, fetchImpl: flaky });
  ok(res.data.ok === 1 && n === 3, `a 5xx is retried to success (attempts=${n})`);

  let seen429 = 0;
  const limited = async () => { seen429++; return { ok: false, status: 429, headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? '0' : null) } }; };
  let caught = null;
  try { await request('https://x.test/b', { ...opts, fetchImpl: limited }); } catch (e) { caught = e; }
  ok(caught instanceof errs.ProviderRateLimited, '429 surfaces as ProviderRateLimited');
  ok(caught.retryAfterSeconds === 0, 'and Retry-After is parsed');
  ok(seen429 === 3, 'it was retried the configured number of times, then gave up');

  let authCalls = 0;
  const denied = async () => { authCalls++; return { ok: false, status: 401, headers: { get: () => null } }; };
  caught = null;
  try { await request('https://x.test/c', { ...opts, fetchImpl: denied }); } catch (e) { caught = e; }
  ok(caught instanceof errs.ProviderAuthError, '401 surfaces as ProviderAuthError');
  ok(authCalls === 1, 'and is NOT retried — the same credential fails the same way');

  let jsonCalls = 0;
  const garbage = async () => { jsonCalls++; return { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('nope'); } }; };
  caught = null;
  try { await request('https://x.test/d', { ...opts, fetchImpl: garbage }); } catch (e) { caught = e; }
  ok(caught instanceof errs.ProviderSchemaError, 'unparseable JSON is a schema error');
  ok(jsonCalls === 1, 'and is NOT retried — the same bytes would come back');

  const hang = async (_u, o) => { const err = new Error('aborted'); err.name = 'AbortError'; void o; throw err; };
  caught = null;
  try { await request('https://x.test/e', { ...opts, retryAttempts: 0, fetchImpl: hang }); } catch (e) { caught = e; }
  ok(caught instanceof errs.ProviderTransportError && /timed out/.test(caught.message), 'a timeout is a transport error naming the timeout');
}

/* ── entity resolution ─────────────────────────────────────────────────── */
section('entity resolution: exact id, name+club, ambiguous, unresolved');
{
  const clubs = resolve.buildClubIndex(BOOT.teams);
  const players = resolve.buildPlayerIndex(BOOT.elements, clubs);

  ok(clubs.resolve('Arsenal FC').fpl_id === 1, 'club suffix "FC" is normalised away');
  ok(clubs.resolve('Spurs').fpl_id === 4, 'the alias "Spurs" resolves to Tottenham');
  ok(clubs.resolve("Nott'm Forest").fpl_id === 3, 'apostrophe form of Forest resolves');
  ok(clubs.resolve('Nottm Forest').fpl_id === 3, 'and the apostrophe-free form');
  ok(clubs.resolve('Brighton').fpl_id === 2, 'a short club alias resolves');
  ok(clubs.resolve('Real Madrid') === null, 'a club not in the FPL list does not resolve');

  ok(players.resolve({ fplId: 101 }).status === 'resolved', 'an FPL id resolves directly');
  ok(players.resolve({ fplId: 999 }).status === 'unresolved', 'an unknown FPL id is unresolved, not guessed');

  const byName = players.resolve({ name: 'Bukayo Saka', club: 'Arsenal' });
  ok(byName.status === 'resolved' && byName.player.fpl_id === 101, 'name + club resolves');
  ok(byName.method === 'name+club', 'and records how it matched');

  const diacritic = players.resolve({ name: 'Gabriel Magalhães', club: 'Arsenal FC' });
  ok(diacritic.status === 'resolved' && diacritic.player.fpl_id === 102, 'diacritics and club suffixes are handled');

  const hyphen = players.resolve({ name: 'Morgan Gibbs White', club: 'Nottm Forest' });
  ok(hyphen.status === 'resolved' && hyphen.player.fpl_id === 105, 'a hyphen/space variant resolves');

  const noClub = players.resolve({ name: 'Bukayo Saka' });
  ok(noClub.status === 'unresolved', 'a name WITHOUT a club is never matched');
  ok(/name alone/.test(noClub.reason), 'and says why');

  const wrongClub = players.resolve({ name: 'Bukayo Saka', club: 'Brighton' });
  ok(wrongClub.status === 'unresolved', 'the right name at the wrong club does not match');

  /* An exact FPL web-name is a strong, unique match and SHOULD resolve. */
  const exactWeb = players.resolve({ name: 'Sa', club: 'Tottenham Hotspur' });
  ok(exactWeb.status === 'resolved' && exactWeb.player.fpl_id === 106, 'an exact web-name match resolves');

  /* The case that must never be guessed: a name variant we do not hold, whose
     SURNAME is shared by two players at that club. An external feed spelling
     a first name differently is exactly how this arises in practice. */
  const amb = players.resolve({ name: 'Pedro Sa', club: 'Tottenham Hotspur' });
  ok(amb.status === 'ambiguous', 'a surname shared by two players at one club is AMBIGUOUS');
  ok(amb.candidates && amb.candidates.length === 2, 'and both candidates are returned for review');
  ok(amb.method === 'surname+club', 'the fallback method is recorded');
  ok(/returned for review rather than guessed/.test(amb.reason), 'and the reason says it was not guessed');
}

/* ── models ────────────────────────────────────────────────────────────── */
section('models: no signal without a source, and missing is not false');
{
  let threw = false;
  try { models.availabilitySignal({ status: 'injured', sources: [] }); } catch (_) { threw = true; }
  ok(threw, 'an availability signal with no source is rejected');

  const src = models.sourceRecord({ provider: 'p', fetchedAt: new Date() });
  const a = models.availabilitySignal({ status: 'available', sources: [src] });
  ok(a.predicted_starter === null, 'predicted_starter defaults to null, NOT false');
  const b = models.availabilitySignal({ status: 'available', predictedStarter: false, sources: [src] });
  ok(b.predicted_starter === false, 'an explicit false from a provider is kept');
  ok(models.availabilitySignal({ status: 'nonsense', sources: [src] }).status === 'unknown', 'an unknown status falls back to unknown');

  const rec = models.recommendation({ provider: 'x', kind: 'captain', source: src });
  ok(rec.is_third_party_model_output === true, 'a recommendation is flagged as third-party output');

  const n = models.newsItem({ title: 't', url: 'u', publisher: 'p', snippet: 'x'.repeat(900), source: src });
  ok(n.snippet.length === 400, 'a snippet is truncated — full article bodies are not stored');
}

/* ── GraphQL ───────────────────────────────────────────────────────────── */
section('graphql: a 200 carrying errors is a failure, not an empty list');
{
  const cfg = loadConfig({ ...baseEnv, FPL_GRAPHQL_API_URL: 'https://gql.test/graphql' });
  const mk = (routes, log) => new FplGraphqlProvider({
    settings: cfg.providers.fpl_graphql, config: cfg, cache: new MemoryCache(),
    fetchImpl: stubFetch(routes, log)
  });

  const log = [];
  const good = mk([['gql.test', { body: { data: { players: [{ id: 'g1', fplId: 101, name: 'Bukayo Saka', team: { name: 'Arsenal' }, price: 95 }] } } }]], log);
  const res = await good.players({});
  ok(res.value.length === 1, 'a well-formed GraphQL response yields rows');
  ok(/players/.test(String(log[0].body)), 'the query document was sent');
  ok(!/password|secret/i.test(String(log[0].body)), 'nothing secret is in the body');

  const errored = mk([['gql.test', { status: 200, body: { errors: [{ message: 'field "price" not found' }], data: null } }]]);
  let caught = null;
  try { await errored.players({}); } catch (e) { caught = e; }
  ok(caught instanceof errs.ProviderSchemaError, 'HTTP 200 with an errors[] payload raises a schema error');
  ok(/field "price" not found/.test(caught.message), 'and surfaces the provider message');

  const nulls = mk([['gql.test', { body: { data: { players: null } } }]]);
  caught = null;
  try { await nulls.players({}); } catch (e) { caught = e; }
  ok(caught instanceof errs.ProviderSchemaError, 'a null players field is a schema error, not zero players');

  /* A renamed field must degrade to null, not throw. */
  const renamed = mk([['gql.test', { body: { data: { players: [{ id: 'g1', playerName: 'Someone' }] } } }]]);
  const rr = await renamed.players({});
  const rec = renamed.toRecord(rr.value[0], { url: 'https://gql.test/graphql', stale: false, ageMs: 0 });
  ok(rec.name === null && rec.fpl_id === null, 'unknown field names normalise to null rather than crashing');

  const authed = loadConfig({ ...baseEnv, FPL_GRAPHQL_API_URL: 'https://gql.test/graphql', FPL_GRAPHQL_API_KEY: 'tok-123' });
  const log2 = [];
  const p2 = new FplGraphqlProvider({ settings: authed.providers.fpl_graphql, config: authed, cache: new MemoryCache(), fetchImpl: stubFetch([['gql.test', { body: { data: { players: [] } } }]], log2) });
  await p2.players({});
  ok(log2[0].headers.Authorization === 'Bearer tok-123', 'the bearer header is built from configuration');
  ok(!String(log2[0].url).includes('tok-123'), 'and the token never appears in the URL');
}

/* ── Apify ─────────────────────────────────────────────────────────────── */
section('apify: dataset, empty, failed run, timeout, and missing fields');
{
  const mk = (env, routes, log) => {
    const cfg = loadConfig({ ...baseEnv, ...env });
    return new ApifyLiveFootballProvider({
      settings: cfg.providers.apify_live_football, config: cfg,
      cache: new MemoryCache(), fetchImpl: stubFetch(routes, log)
    });
  };
  const DS = { APIFY_TOKEN: 'apify-secret', APIFY_LIVE_FOOTBALL_ACTOR_ID: 'act~x', APIFY_LIVE_FOOTBALL_DATASET_ID: 'ds1' };

  const log = [];
  const p = mk(DS, [['/datasets/ds1/items', { body: F('apify-live-football.json') }]], log);
  const got = await p.items();
  ok(got.value.items.length === 5, 'dataset items are returned');
  ok(String(log[0].url).includes('token=apify-secret'), 'the token is sent as Apify documents');
  ok(!got.value.safeUrl.includes('apify-secret'), 'but the URL stamped as provenance has NO token in it');

  const empty = mk(DS, [['/datasets/ds1/items', { body: [] }]]);
  const e = await empty.items();
  ok(e.value.items.length === 0, 'an empty dataset is a valid empty result, not an error');

  const noDs = mk({ APIFY_TOKEN: 't', APIFY_LIVE_FOOTBALL_ACTOR_ID: 'a' }, []);
  let caught = null;
  try { await noDs.items(); } catch (er) { caught = er; }
  ok(caught instanceof errs.ProviderUnavailable, 'dataset mode with no dataset id fails clearly');

  /* A failed run must not look like an empty result. */
  const failed = mk({ ...DS, APIFY_LIVE_FOOTBALL_MODE: 'run' }, [
    ['/acts/', { body: { data: { id: 'r1', status: 'RUNNING', defaultDatasetId: 'ds1' } } }],
    ['/actor-runs/r1', { body: { data: { id: 'r1', status: 'FAILED' } } }]
  ]);
  caught = null;
  try { await failed.items({ sleepImpl: async () => {} }); } catch (er) { caught = er; }
  ok(caught instanceof errs.ProviderUnavailable && /FAILED/.test(caught.message), 'a FAILED run is reported as unavailable');

  /* A run that never finishes must stop at the bound, not hang. */
  let clock = 0;
  const hanging = mk({ ...DS, APIFY_LIVE_FOOTBALL_MODE: 'run', APIFY_RUN_TIMEOUT_SECONDS: '4' }, [
    ['/acts/', { body: { data: { id: 'r2', status: 'RUNNING', defaultDatasetId: 'ds1' } } }],
    ['/actor-runs/r2', { body: { data: { id: 'r2', status: 'RUNNING' } } }]
  ]);
  caught = null;
  try {
    await hanging.items({ sleepImpl: async () => { clock += 2000; }, nowMs: () => clock });
  } catch (er) { caught = er; }
  ok(caught instanceof errs.ProviderUnavailable && /did not finish/.test(caught.message), 'a never-finishing run stops at the timeout');

  /* THE RULE: no prediction is not a prediction of benching. */
  const items = F('apify-live-football.json');
  const info = { safeUrl: 'https://api.apify.com/v2/datasets/ds1/items', stale: false, ageMs: 0 };
  const gross = p.toRecord(items.find((i) => i.player === 'Pascal Gross'), info);
  ok(gross.predicted_starter === null, 'an item with NO prediction yields null, never false');
  ok(gross.confidence_label === 'none', 'and is labelled as having no prediction');
  const gab = p.toRecord(items.find((i) => i.id === 'af-1'), info);
  ok(gab.predicted_starter === false, 'an explicit predictedStart:false IS kept as false');
  ok(gab.status === 'doubtful', 'free-text "doubtful" maps to the doubtful status');
  ok(Math.abs(gab.lineup_confidence - 0.65) < 1e-9, 'a 0-100 probability is normalised to 0-1');
  const saka = p.toRecord(items.find((i) => i.id === 'af-2'), info);
  ok(Math.abs(saka.lineup_confidence - 0.92) < 1e-9, 'a 0-1 probability is left alone');
  const mgw = p.toRecord(items.find((i) => i.id === 'af-3'), info);
  ok(mgw.status === 'suspended', '"Suspended after red card" maps to suspended');
  const bare = p.toRecord({}, info);
  ok(bare.name === null && bare.status === 'unknown' && bare.predicted_starter === null, 'a totally empty item degrades to unknown');
}

/* ── fixture conflicts ─────────────────────────────────────────────────── */
section('fixtures: disagreement is recorded, never applied');
{
  const clubs = resolve.buildClubIndex(BOOT.teams);
  const official = { kickoff_utc: '2026-08-22T14:00:00Z', opponent: 'Tottenham Hotspur' };
  const external = { kickoff_utc: '2026-08-22T16:30:00Z', home: 'Nottingham Forest FC', away: 'Tottenham Hotspur FC' };
  const c = FootballDataProvider.conflictsWith(official, external, clubs);
  ok(c.length === 1 && /kickoff/.test(c[0]), 'a differing kickoff is reported as a conflict');

  const agree = FootballDataProvider.conflictsWith(
    { kickoff_utc: '2026-08-21T19:00:00Z', opponent: 'Brighton & Hove Albion' },
    { kickoff_utc: '2026-08-21T19:00:30Z', home: 'Arsenal FC', away: 'Brighton & Hove Albion FC' }, clubs);
  ok(agree.length === 0, 'a sub-minute difference is not a conflict — the feeds round differently');

  const wrongOpp = FootballDataProvider.conflictsWith(
    { kickoff_utc: '2026-08-21T19:00:00Z', opponent: 'Arsenal' },
    { kickoff_utc: '2026-08-21T19:00:00Z', home: 'Nottingham Forest FC', away: 'Tottenham Hotspur FC' }, clubs);
  ok(wrongOpp.length === 1 && /opponent/.test(wrongOpp[0]), 'a mismatched opponent is reported');
}

/* ── news ──────────────────────────────────────────────────────────────── */
section('news: dedup, source and recency filters, transparent scoring');
{
  const raw = F('world-news.json').news.map((r) => ({
    title: r.title, url: r.url, publisher: r.author || 'unknown',
    published_at: r.publish_date ? r.publish_date.replace(' ', 'T') + 'Z' : null,
    snippet: r.summary
  }));

  ok(news.canonicalUrl('https://www.bbc.co.uk/sport/football/12345?utm_source=x')
    === news.canonicalUrl('https://bbc.co.uk/sport/football/12345/'), 'www, tracking params and trailing slash all canonicalise away');

  const deduped = news.dedupe(raw);
  ok(deduped.length === raw.length - 1, `the duplicate story is removed (${raw.length} -> ${deduped.length})`);

  const approved = ['bbc.co.uk', 'skysports.com', 'theguardian.com'];
  const filtered = news.filterBySource(deduped, approved);
  ok(!filtered.some((a) => a.url.includes('dailyrumour')), 'an unapproved publisher is dropped');
  ok(filtered.length === 3, 'three approved articles survive');

  const recent = news.filterByRecency(filtered, 7, Date.parse('2026-08-17T00:00:00Z'));
  ok(recent.some((a) => a.published_at === null), 'an article with NO date is KEPT — a missing date is the API\'s gap, not evidence of age');
  const old = news.filterByRecency(
    [{ title: 'x', url: 'https://bbc.co.uk/x', published_at: '2020-01-01T00:00:00Z' }], 7, Date.parse('2026-08-17T00:00:00Z'));
  ok(old.length === 0, 'an article outside the window is dropped');

  const players = [{ fpl_id: 102, display_name: 'Gabriel', full_name: 'Gabriel Magalhaes' }];
  const teams = ['Arsenal', 'Nottingham Forest'];
  const gabStory = recent.find((a) => /Gabriel/.test(a.title));
  const s = news.scoreArticle(gabStory, { players, teams, approvedDomains: approved, windowDays: 7, now: Date.parse('2026-08-16T12:00:00Z') });
  ok(s.matched_fpl_ids.includes(102), 'the player is matched by name');
  ok(s.matched_teams.includes('Arsenal'), 'the club is matched');
  ok(s.breakdown.keywords.length > 0, 'FPL keywords are identified');
  ok(s.score > 0.7, `a matching recent story from an approved source scores high (${s.score})`);
  ok(Object.keys(s.breakdown).length >= 5, 'the score is explainable — the breakdown is returned');

  const dated = news.scoreArticle({ title: 'Nothing relevant', url: 'https://elsewhere.example/x', published_at: null },
    { players, teams, approvedDomains: approved, windowDays: 7 });
  ok(dated.score < 0.2, `an irrelevant off-list story scores low (${dated.score})`);
}

/* ── end to end ────────────────────────────────────────────────────────── */
section('end to end: several providers, partial failure, nothing overwritten');
{
  const env = {
    ...baseEnv,
    APIFY_TOKEN: 'tok', APIFY_LIVE_FOOTBALL_ACTOR_ID: 'act', APIFY_LIVE_FOOTBALL_DATASET_ID: 'ds1',
    WORLD_NEWS_API_BASE_URL: 'https://news.test', WORLD_NEWS_API_KEY: 'news-secret'
  };
  const log = [];
  const fetchImpl = stubFetch([
    ...liveRoutes,
    ['/datasets/ds1/items', { body: F('apify-live-football.json') }],
    ['news.test/search-news', { body: F('world-news.json') }]
  ], log);

  const out = await buildFplEnrichment({ gameweek: 1, deps: { env, fetchImpl, cache: new MemoryCache() } });

  ok(Array.isArray(out.players) && out.players.length === BOOT.elements.length, 'every player is present');
  const gabriel = out.players.find((p) => p.identity.fpl_id === 102);
  ok(!!gabriel, 'Gabriel is in the response');

  /* Official first, external second, both kept. */
  ok(gabriel.availability.length === 2, 'both the official flag and the Apify signal are kept as separate signals');
  ok(gabriel.availability[0].sources[0].provider === 'official_fpl', 'the official signal comes first');
  ok(gabriel.availability[0].chance_of_playing_next_round === 50, 'the official chance-of-playing is unchanged');
  ok(gabriel.availability[1].sources[0].provider === 'apify_live_football', 'the secondary signal is attributed to Apify');
  ok(gabriel.availability[1].predicted_starter === false, 'and carries its line-up prediction');
  ok(gabriel.official.now_cost === 80, 'the official price is untouched by any provider');

  const gross = out.players.find((p) => p.identity.fpl_id === 103);
  ok(gross.availability.some((a) => a.predicted_starter === null), 'a player with no prediction keeps null, not false');

  /* Fixtures: official retained, external conflict recorded. */
  const forest = out.players.find((p) => p.identity.fpl_id === 105);
  ok(forest.fixtures.length === 1, 'only the requested gameweek is returned');
  /* Compare instants, not strings: an ISO timestamp carries milliseconds. */
  ok(Date.parse(forest.fixtures[0].kickoff_utc) === Date.parse('2026-08-22T14:00:00Z'),
    'the OFFICIAL kickoff survives, despite football-data saying 16:30');
  ok(Date.parse(forest.fixtures[0].kickoff_utc) !== Date.parse('2026-08-22T16:30:00Z'),
    'and was definitely not replaced by the external value');
  ok(forest.fixtures[0].source_conflicts.length === 1, 'and the disagreement is recorded on the fixture');
  ok(out.data_quality.fixture_conflicts.length >= 1, 'the conflict also appears in data_quality');
  ok(forest.fixtures[0].sources.length === 2, 'both sources are attached to the fixture');

  /* Unresolved names are reported, not silently dropped. */
  ok(out.data_quality.unresolved.some((u) => /Someone Unknown/.test(JSON.stringify(u))
    || /no player at/.test(u.reason || '')), 'an unmatchable external name is reported as unresolved');

  /* Skipped providers are named with the setting to supply. */
  const skipped = out.data_quality.warnings.map((w) => w.provider);
  ok(skipped.includes('letletme') && skipped.includes('fpl_graphql'), 'unconfigured providers are reported as skipped');
  ok(out.data_quality.warnings.some((w) => /LETLETME_API_BASE_URL/.test(w.message)), 'and the message names the missing setting');
  ok(out.data_quality.sources.length === 7, 'all seven providers report health');

  /* News attached and licence-safe. */
  const withNews = out.players.filter((p) => p.news.length);
  ok(withNews.length >= 1, 'news is matched onto at least one player');
  ok(out.players.every((p) => p.news.every((n) => n.url && n.snippet !== undefined)), 'every news item links out');
  ok(!JSON.stringify(out).includes('news-secret'), 'the news API key never appears anywhere in the response');
  ok(!JSON.stringify(out).includes('tok'.repeat(3)), 'nor does any Apify token');

  ok(/informational and uncertain/.test(out.disclaimer), 'the response states that predictions are not guarantees');
}

section('end to end: an optional provider failing does not break the response');
{
  const env = { ...baseEnv, APIFY_TOKEN: 'tok', APIFY_LIVE_FOOTBALL_ACTOR_ID: 'act', APIFY_LIVE_FOOTBALL_DATASET_ID: 'ds1' };
  const fetchImpl = stubFetch([
    ...liveRoutes,
    ['/datasets/ds1/items', { status: 500, body: {} }]
  ]);
  const out = await buildFplEnrichment({ gameweek: 1, includeNews: false, deps: { env, fetchImpl, cache: new MemoryCache(), logger: { warn() {} } } });
  ok(out.players.length > 0, 'the response is still produced');
  ok(out.data_quality.failed.some((f) => f.provider === 'apify_live_football'), 'the failure is named in data_quality');
  ok(out.players.every((p) => p.availability.length >= 1), 'official availability is still present for everyone');
}

section('end to end: losing the AUTHORITATIVE source is the one fatal case');
{
  const fetchImpl = stubFetch([['/api/fpl/bootstrap-static', { status: 500, body: {} }]]);
  let caught = null;
  try {
    await buildFplEnrichment({ deps: { env: baseEnv, fetchImpl, cache: new MemoryCache(), logger: { warn() {} } } });
  } catch (e) { caught = e; }
  ok(caught && caught.code === 'CORE_UNAVAILABLE', 'no official FPL data raises CORE_UNAVAILABLE');
  ok(caught.dataQuality && caught.dataQuality.failed.length >= 1, 'and still reports what failed');
}

section('recommendations stay third-party, and are off unless asked for');
{
  const env = { ...baseEnv, APIFY_FPL_INTELLIGENCE_ENABLED: 'true', APIFY_TOKEN: 'tok', APIFY_FPL_INTELLIGENCE_ACTOR_ID: 'act', APIFY_FPL_INTELLIGENCE_DATASET_ID: 'ds2' };
  const routes = [...liveRoutes, ['/datasets/ds2/items', { body: F('apify-fpl-intelligence.json') }]];

  const off = await buildFplEnrichment({ includeNews: false, deps: { env, fetchImpl: stubFetch(routes), cache: new MemoryCache() } });
  ok(off.players.every((p) => p.recommendations.length === 0), 'no recommendations unless include_recommendations is set');

  const on = await buildFplEnrichment({
    includeNews: false, includeRecommendations: true,
    deps: { env, fetchImpl: stubFetch(routes), cache: new MemoryCache(), logger: { warn() {} } }
  });
  const saka = on.players.find((p) => p.identity.fpl_id === 101);
  ok(saka.recommendations.length === 1, 'a recommendation attaches to its player');
  ok(saka.recommendations[0].is_third_party_model_output === true, 'and is flagged as third-party model output');
  ok(saka.recommendations[0].expected_points === 6.9, 'expected points are carried through');
  const mgw = on.players.find((p) => p.identity.fpl_id === 105);
  ok(mgw.recommendations.length === 1 && mgw.recommendations[0].kind === 'transfer_in', 'an alternate field spelling still resolves');
  ok(JSON.stringify(on).includes('unrecognised:moon_phase'), 'an unknown recommendation kind is kept, labelled unrecognised');
  ok((on.data_quality.unattached_recommendations || []).length >= 1, 'a recommendation naming no player is kept but not attached');
}

section('a disabled provider makes no call at all');
{
  const env = { ...baseEnv, APIFY_LIVE_FOOTBALL_ENABLED: 'false', WORLD_NEWS_ENABLED: 'false' };
  const log = [];
  const out = await buildFplEnrichment({ includeNews: true, deps: { env, fetchImpl: stubFetch(liveRoutes, log), cache: new MemoryCache() } });
  ok(!log.some((c) => /apify|news\.test/.test(c.url)), 'no request is made for a disabled provider');
  ok(out.data_quality.warnings.some((w) => w.provider === 'apify_live_football' && w.message === 'disabled'), 'it is reported as disabled, not failed');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
