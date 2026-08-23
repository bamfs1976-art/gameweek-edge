/* Gameweek Edge — LetLetMe FPL API adapter. NOT LIVE.
 *
 * Ships complete but unconfigured: no LETLETME_API_BASE_URL has been supplied
 * and no endpoint of this provider has been reached from this project, so
 * NOTHING here is claimed to be verified against a live service. Paths come
 * from configuration (config.js -> providers.letletme.paths) precisely so
 * that correcting them is an environment change, not a code change.
 *
 * Set LETLETME_API_BASE_URL to enable. It will then behave like any other
 * provider: typed failures, cache, normalisation boundary.
 */
const { BaseProvider } = require('./base');
const { ProviderSchemaError } = require('../errors');
const { playerIdentity } = require('../models');

class LetLetMeProvider extends BaseProvider {
  static LIVE = false;
  static NOTE = 'Adapter only — no base URL configured and no endpoint verified from this project.';

  authHeaders() {
    /* Header name is a guess-free choice: bearer is the documented default
       for this provider family. Configure a different scheme by fronting it
       with a gateway rather than by editing this file. */
    return this.settings.apiKey ? { Authorization: `Bearer ${this.settings.apiKey}` } : {};
  }

  async players({ gameweek = null } = {}) {
    this.requireConfigured();
    const params = gameweek != null ? { gameweek } : {};
    const qs = new URLSearchParams(params).toString();
    const url = `${this.settings.baseUrl}${this.settings.paths.players}${qs ? `?${qs}` : ''}`;
    const got = await this.cached('players', params, async () =>
      (await this.http(url, { headers: this.authHeaders() })).data);
    const rows = Array.isArray(got.value) ? got.value : (got.value && got.value.data);
    if (!Array.isArray(rows)) {
      throw new ProviderSchemaError('players response was neither an array nor {data:[]}', { provider: this.name });
    }
    return { ...got, value: rows, url };
  }

  /**
   * Normalise one provider row. Every field is optional on purpose: this
   * adapter must survive a provider that renames or drops half of them.
   */
  toRecord(row, { url, stale, ageMs }) {
    const fplId = firstNumber(row.fpl_id, row.fplId, row.element, row.element_id);
    const name = firstString(row.name, row.web_name, row.display_name, row.player_name);
    const club = firstString(row.team_name, row.team, row.club, row.club_name);
    return {
      /* The preferred join key when the provider supplies it; otherwise the
         resolver falls back to name+club, and only with club agreement. */
      fpl_id: fplId,
      identity: playerIdentity({
        fplId,
        providerIds: { letletme: String(firstString(row.id, row.player_id, row.code) || '') },
        displayName: name || 'unknown',
        normalizedName: name || '',
        teamFplId: firstNumber(row.team_fpl_id, row.team_id),
        teamName: club,
        position: firstString(row.position, row.pos, row.element_type_name)
      }),
      metrics: {
        price: firstNumber(row.price, row.now_cost, row.value),
        ownership: firstNumber(row.ownership, row.selected_by_percent),
        form: firstNumber(row.form),
        total_points: firstNumber(row.total_points, row.points),
        minutes: firstNumber(row.minutes)
      },
      availability_hint: {
        status: firstString(row.status, row.availability),
        chance: firstNumber(row.chance_of_playing_next_round, row.chance)
      },
      source: this.stamp({ sourceUrl: url, recordId: String(firstString(row.id, row.player_id, fplId) || ''), stale, ageMs })
    };
  }
}

const firstNumber = (...vals) => {
  for (const v of vals) { const n = Number(v); if (v !== null && v !== undefined && v !== '' && Number.isFinite(n)) return n; }
  return null;
};
const firstString = (...vals) => {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
};

module.exports = { LetLetMeProvider, firstNumber, firstString };
