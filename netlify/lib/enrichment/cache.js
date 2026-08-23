/* Gameweek Edge — TTL cache for the enrichment layer.
 *
 * Pluggable on purpose. The default is in-memory, which on Netlify means
 * per-container and therefore modest — that is the right default for a
 * personal dashboard and adds no infrastructure. Redis is NOT introduced;
 * this project has none.
 *
 * The property that matters most here is the STALE FALLBACK. An expired entry
 * is not deleted; it is kept and can be handed back, flagged stale, when a
 * live call fails. A dashboard showing yesterday's injury list clearly marked
 * "stale" is far more useful than one showing nothing — but only if the
 * staleness travels with the data, which is why get() returns the age.
 */

/** Build a cache key. Never pass a secret into this — see redact(). */
function cacheKey(provider, endpoint, params = {}, variant = '') {
  const sorted = Object.keys(params).sort()
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => `${k}=${String(params[k])}`)
    .join('&');
  return [provider, endpoint, sorted, variant].filter(Boolean).join('|');
}

/* Belt and braces: any key fragment that looks like a credential is dropped
   before it can reach a key, a log line or an error message. */
const SECRETISH = /(token|key|secret|password|authorization|apikey|api_key)/i;
function redact(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) if (!SECRETISH.test(k)) out[k] = v;
  return out;
}

class MemoryCache {
  constructor({ now = () => Date.now() } = {}) {
    this.map = new Map();
    this.now = now;
  }

  /**
   * @returns {{value:any, ageMs:number, fresh:boolean}|null}
   */
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return null;
    const ageMs = this.now() - hit.storedAt;
    return { value: hit.value, ageMs, fresh: ageMs < hit.ttlMs };
  }

  set(key, value, ttlMs) {
    this.map.set(key, { value, ttlMs, storedAt: this.now() });
    return value;
  }

  /**
   * Fetch through the cache with an explicit stale fallback.
   *
   * On a live failure with a usable expired entry, the entry is returned and
   * `stale` is true — the caller is expected to surface that, not hide it.
   */
  async through(key, ttlMs, loader) {
    const hit = this.get(key);
    if (hit && hit.fresh) return { value: hit.value, stale: false, ageMs: hit.ageMs, cached: true };
    try {
      const value = await loader();
      this.set(key, value, ttlMs);
      return { value, stale: false, ageMs: 0, cached: false };
    } catch (err) {
      if (hit) return { value: hit.value, stale: true, ageMs: hit.ageMs, cached: true, error: err };
      throw err;
    }
  }

  clear() { this.map.clear(); }
}

module.exports = { MemoryCache, cacheKey, redact };
