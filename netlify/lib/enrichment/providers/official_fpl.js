/* Gameweek Edge — the official FPL API. LIVE.
 *
 * The authoritative source, and the only one allowed to define FPL ids,
 * official availability flags, prices, ownership and FPL fixtures. Everything
 * else in this layer enriches around it and may not overwrite it.
 *
 * Reached through this site's own /api/fpl proxy rather than the upstream
 * directly: the proxy already carries the allow-list and the caching, and the
 * browser can only reach it anyway (the CSP is connect-src 'self').
 */
const { BaseProvider } = require('./base');
const { ProviderSchemaError } = require('../errors');
const { playerIdentity, availabilitySignal, fixtureContext } = require('../models');

/* FPL's element_type -> the position label the canonical model uses. */
const POSITION = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

/* FPL's own status letter -> canonical status. `n` (not available) covers
   several real-world causes, so it maps to 'unknown' rather than inventing a
   reason the feed did not give. */
const STATUS = { a: 'available', d: 'doubtful', i: 'injured', s: 'suspended', u: 'unknown', n: 'unknown' };

class OfficialFplProvider extends BaseProvider {
  static LIVE = true;
  static NOTE = 'Authoritative. Keyless, via this site\'s existing /api/fpl proxy.';

  async bootstrap() {
    this.requireConfigured();
    const url = `${this.settings.baseUrl}/bootstrap-static`;
    const got = await this.cached('bootstrap-static', {}, async () => (await this.http(url)).data);
    const b = got.value;
    if (!b || !Array.isArray(b.elements) || !Array.isArray(b.teams)) {
      throw new ProviderSchemaError('bootstrap-static did not contain elements[] and teams[]', { provider: this.name });
    }
    return { ...got, value: b, url };
  }

  async fixtures() {
    this.requireConfigured();
    const url = `${this.settings.baseUrl}/fixtures`;
    const got = await this.cached('fixtures', {}, async () => (await this.http(url)).data);
    if (!Array.isArray(got.value)) {
      throw new ProviderSchemaError('fixtures did not return an array', { provider: this.name });
    }
    return { ...got, url };
  }

  /** Normalise one bootstrap element into identity + official availability. */
  toIdentityAndAvailability(element, teamsById, { url, stale, ageMs }) {
    const team = teamsById[element.team] || null;
    const full = `${element.first_name || ''} ${element.second_name || ''}`.trim();
    const source = this.stamp({ sourceUrl: url, recordId: String(element.id), stale, ageMs });

    const identity = playerIdentity({
      fplId: element.id,
      providerIds: { official_fpl: String(element.id) },
      displayName: element.web_name || full,
      normalizedName: full,
      teamFplId: element.team,
      teamName: team ? team.name : null,
      position: POSITION[element.element_type] || null
    });

    const availability = availabilitySignal({
      status: STATUS[String(element.status || '').toLowerCase()] || 'unknown',
      chanceOfPlayingNextRound: element.chance_of_playing_next_round ?? null,
      detail: element.news || null,
      /* FPL publishes a date string only sometimes, and an empty string often. */
      expectedReturn: element.news_added && element.news ? element.news_added : null,
      /* The official feed makes NO line-up prediction. Saying null here is the
         difference between "unknown" and "predicted not to start". */
      predictedStarter: null,
      lineupConfidence: null,
      sources: [source]
    });

    return {
      identity,
      availability,
      official: {
        now_cost: element.now_cost ?? null,
        selected_by_percent: element.selected_by_percent ?? null,
        form: element.form ?? null,
        total_points: element.total_points ?? null,
        minutes: element.minutes ?? null
      },
      source
    };
  }

  /** Normalise the official fixture list for one team. */
  toFixtureContexts(fixtures, teamFplId, teamsById, { url, stale, ageMs }, gameweek = null) {
    const out = [];
    for (const f of fixtures) {
      if (f.team_h !== teamFplId && f.team_a !== teamFplId) continue;
      if (gameweek != null && f.event !== gameweek) continue;
      const isHome = f.team_h === teamFplId;
      const oppId = isHome ? f.team_a : f.team_h;
      out.push(fixtureContext({
        fixtureId: f.id,
        kickoffUtc: f.kickoff_time || null,
        opponent: teamsById[oppId] ? teamsById[oppId].name : null,
        isHome,
        competition: 'Premier League',
        status: f.finished ? 'finished' : (f.started ? 'in_play' : 'scheduled'),
        sources: [this.stamp({ sourceUrl: url, recordId: String(f.id), stale, ageMs })]
      }));
    }
    return out;
  }
}

module.exports = { OfficialFplProvider, POSITION, STATUS };
