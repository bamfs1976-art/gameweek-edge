/* Gameweek Edge — the one HTTP path every provider uses.
 *
 * Timeout, bounded retry with jitter, and 429 handling live here so no
 * adapter reimplements them slightly differently. Retry decisions come from
 * the error taxonomy in errors.js rather than from status codes inspected at
 * each call site.
 *
 * WHAT IS DELIBERATELY NOT RETRIED: a 4xx that is not 429, and any response
 * we could not parse. Retrying an unparseable body spends someone's rate
 * limit to receive the same bytes again, and this project already learned
 * what an unnecessary 429 costs — see the note at the top of
 * netlify/functions/football-data.js.
 */
const {
  ProviderAuthError, ProviderRateLimited, ProviderTransportError, ProviderSchemaError
} = require('./errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Full jitter. Without it, several providers failing at once retry in
   lockstep and arrive together, which is how a blip becomes a thundering
   herd. Injectable so tests are deterministic. */
function backoffMs(attempt, rand = Math.random) {
  const capped = Math.min(8000, 250 * 2 ** attempt);
  return Math.floor(rand() * capped);
}

function parseRetryAfter(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(60, secs);
  const when = Date.parse(value);
  if (!Number.isFinite(when)) return null;
  return Math.min(60, Math.max(0, Math.round((when - Date.now()) / 1000)));
}

/**
 * Perform one request with timeout, retry and typed failures.
 *
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.provider          provider name, for error attribution
 * @param {number} opts.timeoutMs
 * @param {number} opts.retryAttempts     retries AFTER the first try
 * @param {object} [opts.headers]
 * @param {string} [opts.method]
 * @param {any}    [opts.body]            serialised as JSON when an object
 * @param {'json'|'text'} [opts.expect]
 * @param {Function} [opts.fetchImpl]     injected for tests
 * @param {Function} [opts.rand]          injected for tests
 * @param {Function} [opts.sleepImpl]     injected for tests
 */
async function request(url, opts) {
  const {
    provider, timeoutMs, retryAttempts, headers = {}, method = 'GET', body,
    expect = 'json', fetchImpl = globalThis.fetch, rand = Math.random, sleepImpl = sleep
  } = opts;

  let last;
  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    if (attempt) await sleepImpl(last instanceof ProviderRateLimited && last.retryAfterSeconds != null
      ? last.retryAfterSeconds * 1000
      : backoffMs(attempt, rand));

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: body && typeof body === 'object'
          ? { 'Content-Type': 'application/json', ...headers } : headers,
        body: body && typeof body === 'object' ? JSON.stringify(body) : body,
        signal: ac.signal
      });
    } catch (err) {
      last = new ProviderTransportError(
        err && err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(err && err.message || err),
        { provider, cause: err });
      continue;
    } finally { clearTimeout(timer); }

    if (res.status === 429) {
      last = new ProviderRateLimited('rate limited', {
        provider, status: 429,
        retryAfterSeconds: parseRetryAfter(res.headers && res.headers.get && res.headers.get('retry-after'))
      });
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      /* Not retried: the same credential will be rejected again. */
      throw new ProviderAuthError(`credentials rejected (${res.status})`, { provider, status: res.status });
    }
    if (res.status >= 500) {
      last = new ProviderTransportError(`upstream ${res.status}`, { provider, status: res.status });
      continue;
    }
    if (!res.ok) {
      throw new ProviderTransportError(`unexpected ${res.status}`, { provider, status: res.status });
    }

    if (expect === 'text') return { status: res.status, data: await res.text() };
    try {
      return { status: res.status, data: await res.json() };
    } catch (err) {
      /* Deliberately terminal — see the header note. */
      throw new ProviderSchemaError('response was not valid JSON', { provider, status: res.status, cause: err });
    }
  }
  throw last || new ProviderTransportError('request failed', { provider });
}

module.exports = { request, backoffMs, parseRetryAfter };
