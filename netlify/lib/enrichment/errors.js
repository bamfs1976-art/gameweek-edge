/* Gameweek Edge — enrichment layer error taxonomy.
 *
 * The point of separate classes is that the enrichment service treats them
 * differently. A misconfigured optional provider must degrade to a warning; a
 * transport blip should be retried; a schema change must NOT be retried,
 * because retrying a response we cannot parse just spends someone's rate
 * limit to get the same unparseable bytes back.
 *
 * `retryable` is the field the HTTP layer reads. It is set per class rather
 * than inferred at the call site so the decision lives in one place.
 */

class ProviderError extends Error {
  constructor(message, { provider, cause, status } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.provider = provider || 'unknown';
    this.status = status ?? null;
    if (cause) this.cause = cause;
  }
  get retryable() { return false; }
  /** Shape used in the response's data_quality block. Never carries secrets. */
  toJSON() {
    return { provider: this.provider, kind: this.name, message: this.message, status: this.status };
  }
}

/** Provider is enabled but its required settings are absent or malformed. */
class ProviderNotConfigured extends ProviderError {}

/** Credentials present but rejected (401/403). Not retryable — it will fail again. */
class ProviderAuthError extends ProviderError {}

/** 429, or a documented quota refusal. Retryable, but only with Retry-After respected. */
class ProviderRateLimited extends ProviderError {
  constructor(message, opts = {}) { super(message, opts); this.retryAfterSeconds = opts.retryAfterSeconds ?? null; }
  get retryable() { return true; }
}

/** Timeout, DNS, connection reset, 5xx. Worth one or two more goes. */
class ProviderTransportError extends ProviderError {
  get retryable() { return true; }
}

/** The bytes arrived and did not match the shape we can read. NOT retryable. */
class ProviderSchemaError extends ProviderError {
  constructor(message, opts = {}) { super(message, opts); this.detail = opts.detail ?? null; }
}

/** Provider answered, but said it cannot serve this right now (e.g. a failed Apify run). */
class ProviderUnavailable extends ProviderError {
  get retryable() { return true; }
}

module.exports = {
  ProviderError, ProviderNotConfigured, ProviderAuthError,
  ProviderRateLimited, ProviderTransportError, ProviderSchemaError, ProviderUnavailable
};
