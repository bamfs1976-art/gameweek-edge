/* Gameweek Edge — the provider contract.
 *
 * Every adapter extends this so the enrichment service can treat six very
 * different APIs identically: ask whether it is usable, ask it for data, and
 * get back either normalised records or a typed failure it can report.
 *
 * The NORMALISATION BOUNDARY is the important idea. Raw provider shapes stop
 * inside the adapter. Nothing above this layer ever sees a provider's own
 * field names, so a provider changing `injury_status` to `injuryStatus` is a
 * one-file fix and cannot silently reshape the canonical model.
 */
const { ProviderNotConfigured } = require('../errors');
const { sourceRecord } = require('../models');
const { request } = require('../http');
const { cacheKey } = require('../cache');

class BaseProvider {
  /**
   * @param {object} deps
   * @param {object} deps.settings  this provider's slice of loadConfig()
   * @param {object} deps.config    the whole settings object (timeouts, retries)
   * @param {object} deps.cache     a MemoryCache-compatible cache
   * @param {Function} [deps.fetchImpl]
   * @param {Function} [deps.now]
   * @param {object} [deps.logger]
   */
  constructor({ settings, config, cache, fetchImpl, now = () => new Date(), logger = console }) {
    this.settings = settings;
    this.config = config;
    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
  }

  get name() { return this.settings.name; }
  get enabled() { return !!this.settings.enabled; }
  get configured() { return !!this.settings.configured; }

  /** Machine-readable state for the data_quality block. Never leaks values. */
  health() {
    return {
      provider: this.name,
      enabled: this.enabled,
      configured: this.configured,
      /* NAMES of missing settings, so the operator knows what to supply. */
      missing_settings: [...(this.settings.missing || [])],
      live: this.constructor.LIVE === true,
      note: this.constructor.NOTE || null
    };
  }

  /** Throw the typed error the service knows how to downgrade to a warning. */
  requireConfigured() {
    if (!this.enabled) throw new ProviderNotConfigured(`${this.name} is disabled`, { provider: this.name });
    if (!this.configured) {
      throw new ProviderNotConfigured(
        `${this.name} is enabled but not configured (missing: ${(this.settings.missing || []).join(', ') || 'unknown'})`,
        { provider: this.name });
    }
  }

  /** Provenance stamp for records this provider produced. */
  stamp({ sourceUrl = null, sourceTimestamp = null, recordId = null, stale = false, ageMs = null } = {}) {
    return sourceRecord({
      provider: this.name, fetchedAt: this.now(), sourceTimestamp, sourceUrl, recordId, stale, ageMs
    });
  }

  /** One HTTP call with this provider's timeout/retry policy applied. */
  http(url, opts = {}) {
    return request(url, {
      provider: this.name,
      timeoutMs: opts.timeoutMs ?? this.config.timeoutMs,
      retryAttempts: opts.retryAttempts ?? this.config.retryAttempts,
      fetchImpl: this.fetchImpl,
      ...opts
    });
  }

  /** Cached GET. ttl defaults to the provider's own override, then the global. */
  cached(endpoint, params, loader, { ttlMs } = {}) {
    const key = cacheKey(this.name, endpoint, params);
    return this.cache.through(key, ttlMs ?? this.settings.cacheTtlMs ?? this.config.cacheTtlMs, loader);
  }
}

module.exports = { BaseProvider };
