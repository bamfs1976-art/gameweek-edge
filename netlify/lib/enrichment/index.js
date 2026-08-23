/* Gameweek Edge — the enrichment service.
 *
 * Combines every configured provider into one response with explicit
 * precedence and no silent overwriting:
 *
 *   official_fpl            AUTHORITATIVE for FPL ids, official availability,
 *                           price, ownership and FPL fixtures.
 *   football_data           enriches fixtures with competition/status/score.
 *                           Disagreements are RECORDED, never applied.
 *   letletme / fpl_graphql  secondary player metrics, kept beside the
 *                           official values rather than replacing them.
 *   apify_live_football     injury + predicted line-up as SECONDARY evidence.
 *   world_news              context only. Never changes an availability status.
 *   apify_fpl_intelligence  third-party recommendations, kept separate.
 *
 * Any non-core provider may fail. The response still returns, with the
 * failure named in data_quality. Only the authoritative source failing is
 * fatal, because without it there is nothing to enrich.
 */
const { loadConfig } = require('./config');
const { MemoryCache } = require('./cache');
const { ProviderError, ProviderNotConfigured } = require('./errors');
const { buildClubIndex, buildPlayerIndex } = require('./resolve');
const { availabilitySignal, newsItem, recommendation } = require('./models');
const news = require('./news_matching');

const { OfficialFplProvider } = require('./providers/official_fpl');
const { FootballDataProvider } = require('./providers/football_data');
const { LetLetMeProvider } = require('./providers/letletme');
const { FplGraphqlProvider } = require('./providers/fpl_graphql');
const { ApifyLiveFootballProvider } = require('./providers/apify_live_football');
const { ApifyFplIntelligenceProvider } = require('./providers/apify_fpl_intelligence');
const { WorldNewsProvider } = require('./providers/world_news');

const REGISTRY = {
  official_fpl: OfficialFplProvider,
  football_data: FootballDataProvider,
  letletme: LetLetMeProvider,
  fpl_graphql: FplGraphqlProvider,
  apify_live_football: ApifyLiveFootballProvider,
  apify_fpl_intelligence: ApifyFplIntelligenceProvider,
  world_news: WorldNewsProvider
};

function buildProviders({ config, cache, fetchImpl, now, logger }) {
  const out = {};
  for (const [name, Cls] of Object.entries(REGISTRY)) {
    out[name] = new Cls({ settings: config.providers[name], config, cache, fetchImpl, now, logger });
  }
  return out;
}

/**
 * Build the enrichment response.
 *
 * @param {object} [opts]
 * @param {number[]|null} [opts.fplPlayerIds]
 * @param {number[]|null} [opts.teamIds]
 * @param {number|null}   [opts.gameweek]
 * @param {boolean}       [opts.includeNews]
 * @param {boolean}       [opts.includeRecommendations]
 * @param {object}        [opts.deps] injection point for tests
 * @returns {Promise<object>} serialisable EnrichmentResponse
 */
async function buildFplEnrichment({
  fplPlayerIds = null, teamIds = null, gameweek = null,
  includeNews = true, includeRecommendations = false, deps = {}
} = {}) {
  const config = deps.config || loadConfig(deps.env);
  const cache = deps.cache || new MemoryCache();
  const logger = deps.logger || console;
  const providers = deps.providers || buildProviders({ config, cache, fetchImpl: deps.fetchImpl, now: deps.now, logger });
  /* One clock for the whole run. The providers already took an injectable
     `now`; the news step below did not, and read Date.now() directly. That
     split is why a fixture-driven test could not be frozen — and it also let
     a long run stamp `fetchedAt` from one clock while filtering articles for
     recency against another. `now` is a () => Date, matching the providers. */
  const nowMs = () => {
    const t = deps.now ? deps.now() : new Date();
    return t instanceof Date ? t.getTime() : Number(t);
  };

  const quality = {
    sources: [], failed: [], warnings: [],
    unresolved: [], ambiguous: [], fixture_conflicts: []
  };
  for (const p of Object.values(providers)) quality.sources.push(p.health());

  /* Any non-core provider is run through this. A typed failure becomes a
     warning and a null result; it never propagates. */
  const attempt = async (name, fn) => {
    const provider = providers[name];
    if (!provider.configured) {
      quality.warnings.push({
        provider: name, kind: 'skipped',
        message: provider.enabled
          ? `not configured (missing: ${(provider.settings.missing || []).join(', ') || 'unknown'})`
          : 'disabled'
      });
      return null;
    }
    try { return await fn(provider); } catch (err) {
      const rec = err instanceof ProviderError ? err.toJSON()
        : { provider: name, kind: 'UnexpectedError', message: String(err && err.message || err), status: null };
      quality.failed.push(rec);
      logger.warn && logger.warn(`enrichment: ${name} failed — ${rec.message}`);
      return null;
    }
  };

  /* ---- 1. the authoritative base ------------------------------------- */
  let boot;
  try {
    boot = await providers.official_fpl.bootstrap();
  } catch (err) {
    const rec = err instanceof ProviderError ? err.toJSON()
      : { provider: 'official_fpl', kind: 'UnexpectedError', message: String(err && err.message || err) };
    quality.failed.push(rec);
    /* The one fatal case: nothing to enrich. */
    const fatal = new Error('official FPL data is unavailable, so there is nothing to enrich');
    fatal.dataQuality = quality;
    fatal.code = 'CORE_UNAVAILABLE';
    throw fatal;
  }

  const bootstrap = boot.value;
  const teamsById = {};
  for (const t of bootstrap.teams) teamsById[t.id] = t;
  const clubIndex = buildClubIndex(bootstrap.teams);
  const playerIndex = buildPlayerIndex(bootstrap.elements, clubIndex);

  let elements = bootstrap.elements;
  if (Array.isArray(fplPlayerIds) && fplPlayerIds.length) {
    const want = new Set(fplPlayerIds.map(Number));
    elements = elements.filter((e) => want.has(e.id));
  }
  if (Array.isArray(teamIds) && teamIds.length) {
    const want = new Set(teamIds.map(Number));
    elements = elements.filter((e) => want.has(e.team));
  }

  const stampInfo = { url: boot.url, stale: boot.stale, ageMs: boot.ageMs };
  const players = new Map();
  for (const e of elements) {
    const rec = providers.official_fpl.toIdentityAndAvailability(e, teamsById, stampInfo);
    players.set(e.id, {
      identity: rec.identity,
      official: rec.official,
      availability: [rec.availability],   // multiple signals allowed, never merged away
      fixtures: [],
      news: [],
      recommendations: []
    });
  }

  /* ---- 2. official fixtures ------------------------------------------ */
  const fixturesRes = await attempt('official_fpl', (p) => p.fixtures());
  if (fixturesRes) {
    const info = { url: fixturesRes.url, stale: fixturesRes.stale, ageMs: fixturesRes.ageMs };
    for (const entry of players.values()) {
      entry.fixtures = providers.official_fpl.toFixtureContexts(
        fixturesRes.value, entry.identity.team_fpl_id, teamsById, info, gameweek);
    }
  }

  /* ---- 3. external fixture enrichment, conflicts recorded not applied - */
  const fd = await attempt('football_data', (p) => p.matchday({ matchday: gameweek }));
  if (fd) {
    const ext = providers.football_data.toFixtures(fd.value, { url: fd.url, stale: fd.stale, ageMs: fd.ageMs });
    for (const entry of players.values()) {
      for (const fx of entry.fixtures) {
        const match = matchExternalFixture(fx, entry.identity, ext, clubIndex);
        if (!match) continue;
        /* Enrich only where official is silent. */
        if (!fx.competition && match.competition) fx.competition = match.competition;
        if (fx.status == null && match.status) fx.status = match.status;
        fx.sources.push(match.source);
        const conflicts = FootballDataProvider.conflictsWith(fx, match, clubIndex);
        if (conflicts.length) {
          fx.source_conflicts.push(...conflicts);
          quality.fixture_conflicts.push({ fpl_id: entry.identity.fpl_id, fixture_id: fx.fixture_id, conflicts });
        }
      }
    }
  }

  /* ---- 4. secondary player metrics ----------------------------------- */
  for (const name of ['letletme', 'fpl_graphql']) {
    const res = await attempt(name, (p) => p.players({}));
    if (!res) continue;
    const info = { url: res.url, stale: res.stale, ageMs: res.ageMs };
    for (const row of res.value) {
      const rec = providers[name].toRecord(row, info);
      const r = playerIndex.resolve({
        fplId: rec.fpl_id ?? null,
        name: rec.identity ? rec.identity.display_name : rec.name,
        club: rec.identity ? rec.identity.team_name : rec.team_name
      });
      if (r.status === 'ambiguous') { quality.ambiguous.push({ provider: name, ...r }); continue; }
      if (r.status === 'unresolved') { quality.unresolved.push({ provider: name, ...r }); continue; }
      const entry = players.get(r.player.fpl_id);
      if (!entry) continue;
      entry.identity.provider_ids[name] = String(rec.provider_id || (rec.identity && rec.identity.provider_ids[name]) || '');
      /* Secondary metrics live BESIDE the official ones. */
      entry.secondary = entry.secondary || {};
      entry.secondary[name] = { ...(rec.metrics || {}), ...stripUndefined(rec), source: rec.source };
    }
  }

  /* ---- 5. injuries and predicted line-ups (secondary evidence) -------- */
  const live = await attempt('apify_live_football', (p) => p.items());
  if (live) {
    const info = { safeUrl: live.value.safeUrl, stale: live.stale, ageMs: live.ageMs };
    for (const item of live.value.items || []) {
      const rec = providers.apify_live_football.toRecord(item, info);
      const r = playerIndex.resolve({ name: rec.name, club: rec.club });
      if (r.status === 'ambiguous') { quality.ambiguous.push({ provider: 'apify_live_football', ...r }); continue; }
      if (r.status === 'unresolved') { quality.unresolved.push({ provider: 'apify_live_football', ...r }); continue; }
      const entry = players.get(r.player.fpl_id);
      if (!entry) continue;
      entry.availability.push(availabilitySignal({
        status: rec.status,
        detail: rec.detail,
        expectedReturn: rec.expected_return,
        predictedStarter: rec.predicted_starter,   // null when the feed said nothing
        lineupConfidence: rec.lineup_confidence,
        sources: [providers.apify_live_football.stamp({
          sourceUrl: rec.safe_url, sourceTimestamp: rec.source_timestamp,
          recordId: rec.record_id, stale: rec.stale, ageMs: rec.age_ms
        })]
      }));
    }
  }

  /* ---- 6. news context ------------------------------------------------ */
  if (includeNews) {
    const wanted = [...players.values()];
    const teamNames = [...new Set(wanted.map((p) => p.identity.team_name).filter(Boolean))];
    const res = await attempt('world_news', async (p) => {
      const queries = teamNames.slice(0, 6).map((t) => WorldNewsProvider.teamQuery(t));
      const all = [];
      for (const q of queries) {
        const got = await p.search(q);
        all.push(...got.value.map((row) => p.toArticle(row, { url: got.url, stale: got.stale, ageMs: got.ageMs })));
      }
      return all;
    });
    if (res) {
      const approved = config.providers.world_news.sources;
      let articles = news.dedupe(res);
      articles = news.filterBySource(articles, approved);
      articles = news.filterByRecency(articles, config.providers.world_news.windowDays, nowMs());
      const playerList = wanted.map((p) => ({
        fpl_id: p.identity.fpl_id, display_name: p.identity.display_name, full_name: p.identity.normalized_name
      }));
      for (const a of articles) {
        const s = news.scoreArticle(a, {
          players: playerList, teams: teamNames, approvedDomains: approved,
          windowDays: config.providers.world_news.windowDays, now: nowMs()
        });
        const item = newsItem({
          title: a.title, url: a.url, publisher: a.publisher, publishedAt: a.published_at,
          snippet: a.snippet, imageUrl: a.image_url,
          matchedFplIds: s.matched_fpl_ids, matchedTeams: s.matched_teams, relevanceScore: s.score,
          source: providers.world_news.stamp({ sourceUrl: a.safe_url, sourceTimestamp: a.published_at, recordId: a.record_id, stale: a.stale, ageMs: a.age_ms })
        });
        /* Attach to every matched player; a story about two players belongs to both. */
        for (const id of s.matched_fpl_ids) {
          const entry = players.get(id);
          if (entry) entry.news.push(item);
        }
      }
    }
  }

  /* ---- 7. third-party recommendations, kept separate ------------------ */
  if (includeRecommendations) {
    const res = await attempt('apify_fpl_intelligence', (p) => p.items());
    if (res) {
      const info = { safeUrl: res.value.safeUrl, stale: res.stale, ageMs: res.ageMs };
      for (const item of res.value.items || []) {
        const rec = providers.apify_fpl_intelligence.toRecord(item, info);
        const r = rec.player_fpl_id != null
          ? playerIndex.resolve({ fplId: rec.player_fpl_id })
          : { status: 'unresolved', reason: 'recommendation names no player id' };
        const built = recommendation({
          provider: 'apify_fpl_intelligence', kind: rec.kind,
          playerFplId: r.status === 'resolved' ? r.player.fpl_id : null,
          subject: rec.subject, score: rec.score, expectedPoints: rec.expected_points,
          rationale: rec.rationale, generatedAt: rec.generated_at,
          source: providers.apify_fpl_intelligence.stamp({
            sourceUrl: rec.safe_url, sourceTimestamp: rec.generated_at, recordId: rec.record_id,
            stale: rec.stale, ageMs: rec.age_ms
          })
        });
        if (r.status === 'resolved' && players.has(r.player.fpl_id)) {
          players.get(r.player.fpl_id).recommendations.push(built);
        } else {
          quality.unresolved.push({ provider: 'apify_fpl_intelligence', reason: r.reason, subject: rec.subject });
          (quality.unattached_recommendations = quality.unattached_recommendations || []).push(built);
        }
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    gameweek,
    players: [...players.values()],
    data_quality: quality,
    /* Stated in the payload so a consumer cannot mistake third-party output
       or a predicted line-up for a guarantee. */
    disclaimer: 'Predicted line-ups and third-party recommendations are informational and uncertain. '
      + 'Official FPL values are authoritative; other providers enrich but never overwrite them.'
  };
}

/** Find the external fixture that corresponds to an official one. */
function matchExternalFixture(officialFixture, identity, externals, clubIndex) {
  const own = clubIndex.resolve(identity.team_name);
  const opp = clubIndex.resolve(officialFixture.opponent);
  if (!own || !opp) return null;
  return externals.find((x) => {
    const h = clubIndex.resolve(x.home);
    const a = clubIndex.resolve(x.away);
    if (!h || !a) return false;
    const names = [h.name, a.name];
    return names.includes(own.name) && names.includes(opp.name);
  }) || null;
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && k !== 'source' && k !== 'identity' && k !== 'metrics') out[k] = v;
  return out;
}

module.exports = { buildFplEnrichment, buildProviders, REGISTRY };
