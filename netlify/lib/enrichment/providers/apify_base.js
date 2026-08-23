/* Gameweek Edge — shared Apify plumbing for the two Apify-backed adapters.
 *
 * Apify is used through its documented REST API with the project's existing
 * HTTP layer, NOT the apify-client package: this repository does not depend
 * on it and a whole SDK for two endpoints is not worth a new dependency.
 *
 * Two modes, both configured rather than guessed:
 *   dataset  read an already-prepared dataset. Cheap, no run started.
 *   run      start the actor and poll until it finishes, WITHIN A BOUND.
 *
 * The poll is bounded by APIFY_RUN_TIMEOUT_SECONDS and gives up cleanly. An
 * unbounded poll inside a serverless function is how you turn a slow actor
 * into a hung dashboard request and a surprising bill.
 */
const { BaseProvider } = require('./base');
const { ProviderUnavailable, ProviderSchemaError } = require('../errors');

/* Terminal Apify run states. Anything else means "still going". */
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

class ApifyProvider extends BaseProvider {
  /** The token travels as a query parameter per Apify's documented REST API. */
  tokenParam() { return { token: this.settings.token }; }

  /** Items from a dataset id, no run started. */
  async datasetItems(datasetId) {
    const url = `${this.settings.baseUrl}/datasets/${encodeURIComponent(datasetId)}/items`
      + `?${new URLSearchParams({ ...this.tokenParam(), clean: 'true', format: 'json' })}`;
    const { data } = await this.http(url);
    if (!Array.isArray(data)) throw new ProviderSchemaError('dataset items were not an array', { provider: this.name });
    /* The token is in the URL, so the URL must never be stamped as provenance.
       Callers get a redacted form instead. */
    return { items: data, safeUrl: `${this.settings.baseUrl}/datasets/${datasetId}/items` };
  }

  /**
   * Start a run and wait for it, bounded.
   * @param {Function} [sleepImpl] injected so tests do not actually wait
   */
  async runAndWait({ sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)), nowMs = () => Date.now() } = {}) {
    const startUrl = `${this.settings.baseUrl}/acts/${encodeURIComponent(this.settings.actorId)}/runs`
      + `?${new URLSearchParams(this.tokenParam())}`;
    const { data: started } = await this.http(startUrl, { method: 'POST', body: this.settings.actorInput || {} });
    const run = started && started.data;
    if (!run || !run.id) throw new ProviderSchemaError('run start returned no data.id', { provider: this.name });

    const deadline = nowMs() + this.settings.runTimeoutMs;
    let state = run.status;
    let datasetId = run.defaultDatasetId;

    while (!TERMINAL.has(String(state).toUpperCase())) {
      if (nowMs() >= deadline) {
        throw new ProviderUnavailable(
          `actor run ${run.id} did not finish within ${Math.round(this.settings.runTimeoutMs / 1000)}s`,
          { provider: this.name });
      }
      await sleepImpl(2000);
      const pollUrl = `${this.settings.baseUrl}/actor-runs/${encodeURIComponent(run.id)}`
        + `?${new URLSearchParams(this.tokenParam())}`;
      const { data: polled } = await this.http(pollUrl);
      state = polled && polled.data && polled.data.status;
      datasetId = (polled && polled.data && polled.data.defaultDatasetId) || datasetId;
    }

    if (String(state).toUpperCase() !== 'SUCCEEDED') {
      throw new ProviderUnavailable(`actor run finished ${state}`, { provider: this.name });
    }
    if (!datasetId) throw new ProviderSchemaError('successful run exposed no dataset', { provider: this.name });
    return this.datasetItems(datasetId);
  }

  /** Whichever mode is configured. Cached hard — Apify runs cost money. */
  async items(opts = {}) {
    this.requireConfigured();
    const mode = this.settings.mode === 'run' ? 'run' : 'dataset';
    if (mode === 'dataset' && !this.settings.datasetId) {
      throw new ProviderUnavailable('mode is "dataset" but no dataset id is configured', { provider: this.name });
    }
    const got = await this.cached(`items:${mode}`, { actor: this.settings.actorId, dataset: this.settings.datasetId },
      async () => (mode === 'run' ? this.runAndWait(opts) : this.datasetItems(this.settings.datasetId)));
    return got;
  }
}

module.exports = { ApifyProvider, TERMINAL };
