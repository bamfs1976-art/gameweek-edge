/* Gameweek Edge — unofficial FPL GraphQL/REST wrapper adapter. NOT LIVE.
 *
 * One adapter, two transports, chosen by FPL_GRAPHQL_MODE ('graphql'|'rest').
 * The mode is DECLARED, never inferred from the URL — guessing a transport
 * from a path is how you send a GraphQL body to a REST route and read the
 * 400 as "the provider is down".
 *
 * Unconfigured: no FPL_GRAPHQL_API_URL supplied, no schema verified. The
 * query below requests only the fields the canonical model consumes, so a
 * wrapper that exposes more is not over-fetched from.
 */
const { BaseProvider } = require('./base');
const { ProviderSchemaError } = require('../errors');
const { firstNumber, firstString } = require('./letletme');

/* Kept as a named constant rather than built by string concatenation at the
   call site, so what is asked for is reviewable in one place. */
const PLAYERS_QUERY = `
query FplPlayers($first: Int) {
  players(first: $first) {
    id
    fplId
    name
    team { id name }
    position
    price
    totalPoints
    selectedByPercent
    form
    minutes
    status
    chanceOfPlayingNextRound
  }
}`.trim();

class FplGraphqlProvider extends BaseProvider {
  static LIVE = false;
  static NOTE = 'Adapter only — no endpoint URL configured and no schema verified.';

  authHeaders() {
    return this.settings.apiKey ? { Authorization: `Bearer ${this.settings.apiKey}` } : {};
  }

  async players({ first = 800 } = {}) {
    this.requireConfigured();
    return this.settings.mode === 'rest' ? this.playersRest({ first }) : this.playersGraphql({ first });
  }

  async playersGraphql({ first }) {
    const url = this.settings.url;
    const got = await this.cached('players:graphql', { first }, async () => {
      const { data } = await this.http(url, {
        method: 'POST', headers: this.authHeaders(),
        body: { query: PLAYERS_QUERY, variables: { first } }
      });
      /* A GraphQL server answers 200 with an `errors` array. Treating that as
         success is the classic way to ship an empty dashboard that looks
         healthy, so it is raised as a schema error here. */
      if (data && Array.isArray(data.errors) && data.errors.length) {
        const msgs = data.errors.map((e) => (e && e.message) || 'unknown').slice(0, 3).join('; ');
        throw new ProviderSchemaError(`GraphQL returned errors: ${msgs}`, { provider: this.name, detail: data.errors });
      }
      const rows = data && data.data && data.data.players;
      if (!Array.isArray(rows)) {
        throw new ProviderSchemaError('GraphQL response had no data.players[]', { provider: this.name });
      }
      return rows;
    });
    return { ...got, url };
  }

  async playersRest({ first }) {
    const qs = new URLSearchParams({ limit: String(first) }).toString();
    const url = `${this.settings.url}${this.settings.restPaths.players}?${qs}`;
    const got = await this.cached('players:rest', { first }, async () => {
      const { data } = await this.http(url, { headers: this.authHeaders() });
      const rows = Array.isArray(data) ? data : (data && data.players);
      if (!Array.isArray(rows)) {
        throw new ProviderSchemaError('REST response was neither an array nor {players:[]}', { provider: this.name });
      }
      return rows;
    });
    return { ...got, url };
  }

  toRecord(row, { url, stale, ageMs }) {
    const team = row.team || {};
    return {
      fpl_id: firstNumber(row.fplId, row.fpl_id, row.element),
      provider_id: firstString(row.id, row.playerId),
      name: firstString(row.name, row.web_name),
      team_name: firstString(team.name, row.teamName, row.team),
      position: firstString(row.position, row.pos),
      price: firstNumber(row.price, row.now_cost),
      total_points: firstNumber(row.totalPoints, row.total_points),
      selected_by_percent: firstNumber(row.selectedByPercent, row.selected_by_percent),
      form: firstNumber(row.form),
      minutes: firstNumber(row.minutes),
      status: firstString(row.status),
      chance_of_playing_next_round: firstNumber(row.chanceOfPlayingNextRound, row.chance_of_playing_next_round),
      source: this.stamp({ sourceUrl: url, recordId: firstString(row.id, row.fplId), stale, ageMs })
    };
  }
}

module.exports = { FplGraphqlProvider, PLAYERS_QUERY };
