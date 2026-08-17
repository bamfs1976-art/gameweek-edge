/* Gameweek Edge — enrichment layer configuration.
 *
 * One place that reads process.env, so every other module takes a settings
 * object and is trivially testable without touching the environment.
 *
 * WHICH PROVIDERS ARE LIVE, AND WHY ONLY THOSE
 * --------------------------------------------
 * This project's standing rule is: no paid APIs and no new API keys unless
 * the project already has them configured. Two of the six sources clear that
 * bar and are wired live:
 *
 *   official_fpl    keyless, already proxied at /api/fpl/*
 *   football_data   key already in the function environment, already proxied
 *                   at /api/football-data/*
 *
 * The other five need credentials nobody has supplied. They ship as complete
 * adapters that report `configured: false` and are skipped. Nothing about
 * them is claimed to be verified against a live endpoint — their request
 * shapes come from each provider's own documentation and are exercised only
 * against fixtures. See docs/ENRICHMENT.md.
 *
 * BOTH LIVE PROVIDERS GO THROUGH THIS SITE'S OWN PROXIES, deliberately.
 * football-data.org allows roughly ten requests a minute FOR THE WHOLE SITE,
 * and netlify/functions/football-data.js is where that budget is managed —
 * its edge cache IS the rate limiter. Calling the upstream directly from here
 * would spend the same budget while bypassing the thing that protects it.
 */

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
const csv = (v, dflt) => {
  const s = String(v ?? '').trim();
  if (!s) return dflt;
  return s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
};
const flag = (v, dflt = false) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return dflt;
  return ['1', 'true', 'yes', 'on'].includes(s);
};

/**
 * Build the settings object.
 * @param {Record<string,string|undefined>} [env] defaults to process.env
 */
function loadConfig(env = process.env) {
  const timeoutMs = num(env.FPL_DATA_TIMEOUT_SECONDS, 15) * 1000;
  const cacheTtlMs = num(env.FPL_DATA_CACHE_TTL_SECONDS, 900) * 1000;
  const retryAttempts = Math.min(5, Math.max(0, Number(env.FPL_DATA_RETRY_ATTEMPTS ?? 2) || 0));

  /* The two live providers are reached through THIS SITE'S own proxies, so a
     server-side caller needs an absolute origin. Netlify injects URL (the
     production site) and DEPLOY_URL (this deploy); prefer an explicit
     override, then the site URL, and fall back to the public hostname so a
     local run still resolves rather than silently requesting a relative path. */
  const selfBase = String(
    env.FPL_DATA_SELF_BASE_URL || env.URL || env.DEPLOY_URL || 'https://gameweekedge.co.uk'
  ).replace(/\/$/, '');

  const providers = {
    official_fpl: {
      enabled: true,
      required: [],
      baseUrl: (env.FPL_API_BASE_URL || `${selfBase}/api/fpl`).replace(/\/$/, ''),
      /* The authoritative source. Never overwritten by anything below. */
      authoritative: true
    },
    football_data: {
      enabled: flag(env.PREMIER_LEAGUE_ENABLED, true),
      required: [],
      baseUrl: (env.PREMIER_LEAGUE_API_BASE_URL || `${selfBase}/api/football-data`).replace(/\/$/, ''),
      apiKey: env.PREMIER_LEAGUE_API_KEY || null,
      competition: env.PREMIER_LEAGUE_COMPETITION || 'PL',
      /* Long, because the upstream budget is ~10 req/min for the entire site. */
      cacheTtlMs: num(env.PREMIER_LEAGUE_CACHE_TTL_SECONDS, 3600) * 1000
    },
    letletme: {
      enabled: flag(env.LETLETME_ENABLED, true),
      required: ['LETLETME_API_BASE_URL'],
      baseUrl: String(env.LETLETME_API_BASE_URL || '').replace(/\/$/, ''),
      apiKey: env.LETLETME_API_KEY || null,
      /* Endpoint paths live here, not scattered through the adapter, because
         nothing about this provider's routes is verified. */
      paths: {
        players: env.LETLETME_PATH_PLAYERS || '/players',
        teams: env.LETLETME_PATH_TEAMS || '/teams',
        fixtures: env.LETLETME_PATH_FIXTURES || '/fixtures'
      }
    },
    fpl_graphql: {
      enabled: flag(env.FPL_GRAPHQL_ENABLED, true),
      required: ['FPL_GRAPHQL_API_URL'],
      url: String(env.FPL_GRAPHQL_API_URL || '').replace(/\/$/, ''),
      apiKey: env.FPL_GRAPHQL_API_KEY || null,
      /* 'graphql' | 'rest' — declared, never guessed from the URL. */
      mode: (env.FPL_GRAPHQL_MODE || 'graphql').toLowerCase(),
      restPaths: { players: env.FPL_GRAPHQL_REST_PATH_PLAYERS || '/players' }
    },
    apify_live_football: {
      enabled: flag(env.APIFY_LIVE_FOOTBALL_ENABLED, true),
      required: ['APIFY_TOKEN', 'APIFY_LIVE_FOOTBALL_ACTOR_ID'],
      token: env.APIFY_TOKEN || null,
      actorId: env.APIFY_LIVE_FOOTBALL_ACTOR_ID || null,
      baseUrl: (env.APIFY_API_BASE_URL || 'https://api.apify.com/v2').replace(/\/$/, ''),
      /* 'run' starts an actor and waits; 'dataset' reads a prepared dataset. */
      mode: (env.APIFY_LIVE_FOOTBALL_MODE || 'dataset').toLowerCase(),
      datasetId: env.APIFY_LIVE_FOOTBALL_DATASET_ID || null,
      runTimeoutMs: num(env.APIFY_RUN_TIMEOUT_SECONDS, 90) * 1000,
      actorInput: safeJson(env.APIFY_LIVE_FOOTBALL_INPUT, {}),
      /* Apify runs cost money and move slowly; cache them much harder. */
      cacheTtlMs: num(env.APIFY_CACHE_TTL_SECONDS, 3600) * 1000
    },
    apify_fpl_intelligence: {
      /* Optional enrichment. Off unless asked for — see include_recommendations. */
      enabled: flag(env.APIFY_FPL_INTELLIGENCE_ENABLED, false),
      required: ['APIFY_TOKEN', 'APIFY_FPL_INTELLIGENCE_ACTOR_ID'],
      token: env.APIFY_TOKEN || null,
      actorId: env.APIFY_FPL_INTELLIGENCE_ACTOR_ID || null,
      baseUrl: (env.APIFY_API_BASE_URL || 'https://api.apify.com/v2').replace(/\/$/, ''),
      mode: (env.APIFY_FPL_INTELLIGENCE_MODE || 'dataset').toLowerCase(),
      datasetId: env.APIFY_FPL_INTELLIGENCE_DATASET_ID || null,
      runTimeoutMs: num(env.APIFY_RUN_TIMEOUT_SECONDS, 90) * 1000,
      actorInput: safeJson(env.APIFY_FPL_INTELLIGENCE_INPUT, {}),
      cacheTtlMs: num(env.APIFY_CACHE_TTL_SECONDS, 3600) * 1000
    },
    world_news: {
      enabled: flag(env.WORLD_NEWS_ENABLED, true),
      required: ['WORLD_NEWS_API_BASE_URL', 'WORLD_NEWS_API_KEY'],
      baseUrl: String(env.WORLD_NEWS_API_BASE_URL || '').replace(/\/$/, ''),
      apiKey: env.WORLD_NEWS_API_KEY || null,
      sources: csv(env.WORLD_NEWS_SOURCES, ['bbc.co.uk', 'skysports.com', 'theguardian.com']),
      language: env.WORLD_NEWS_LANGUAGE || 'en',
      country: env.WORLD_NEWS_COUNTRY || 'gb',
      windowDays: num(env.WORLD_NEWS_WINDOW_DAYS, 7),
      maxArticles: num(env.WORLD_NEWS_MAX_ARTICLES, 20)
    }
  };

  /* A provider is usable only if it is enabled AND every required env var is
     non-empty. Recording the missing names (not their values) is what lets
     the CLI say exactly which credential to supply. */
  for (const [name, p] of Object.entries(providers)) {
    p.name = name;
    p.missing = (p.required || []).filter((k) => !String(env[k] || '').trim());
    p.configured = p.enabled && p.missing.length === 0;
  }

  return { timeoutMs, cacheTtlMs, retryAttempts, providers };
}

function safeJson(raw, dflt) {
  if (!raw) return dflt;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : dflt; } catch (_) { return dflt; }
}

module.exports = { loadConfig };
