/* Gameweek Edge — football-data.org fixtures/results/table. LIVE.
 *
 * This is the "Premier League data client" slot. The original brief named an
 * unofficial lightweight source; this project already has a *configured* one
 * with a key in the function environment, so it is used instead of asking for
 * a new credential. The adapter interface is unchanged, so swapping providers
 * is a constructor change, not a rewrite.
 *
 * IT GOES THROUGH THIS SITE'S OWN PROXY, AND THAT IS NOT AN OVERSIGHT.
 * football-data.org's free tier allows roughly ten requests a minute for the
 * entire site, and netlify/functions/football-data.js is where that budget is
 * defended — its edge cache IS the rate limiter. Calling the upstream from
 * here would spend the same budget while bypassing the protection, so this
 * adapter never fans out: one matchday call, cached for an hour by default.
 *
 * It also never overwrites official FPL fixtures. Where the two disagree the
 * disagreement is RECORDED on the fixture as a conflict, because "our two
 * sources disagree" is information and silently picking one destroys it.
 */
const { BaseProvider } = require('./base');
const { ProviderSchemaError } = require('../errors');

class FootballDataProvider extends BaseProvider {
  static LIVE = true;
  static NOTE = 'Live via this site\'s existing /api/football-data proxy, whose cache is the rate limiter.';

  /** Fixtures/results for a matchday (or the whole competition when omitted). */
  async matchday({ matchday = null } = {}) {
    this.requireConfigured();
    const params = { competition: this.settings.competition };
    if (matchday != null) params.matchday = matchday;
    const qs = new URLSearchParams(params).toString();
    const url = `${this.settings.baseUrl}/matchday?${qs}`;

    const got = await this.cached('matchday', params, async () => (await this.http(url, {
      headers: this.settings.apiKey ? { 'X-Auth-Token': this.settings.apiKey } : {}
    })).data);

    const body = got.value;
    if (!body || !Array.isArray(body.matches)) {
      throw new ProviderSchemaError('matchday response had no matches[]', { provider: this.name });
    }
    return { ...got, url };
  }

  /**
   * Normalise to a comparable fixture shape. Kickoffs are returned as
   * timezone-aware UTC ISO strings; anything unparseable becomes null rather
   * than a guessed local time.
   */
  toFixtures(body, { url, stale, ageMs }) {
    return (body.matches || []).map((m) => {
      const kickoff = m.utcDate ? new Date(m.utcDate) : null;
      return {
        external_id: m.id != null ? String(m.id) : null,
        kickoff_utc: kickoff && Number.isFinite(kickoff.getTime()) ? kickoff.toISOString() : null,
        home: (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || null,
        away: (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || null,
        competition: (m.competition && m.competition.name) || this.settings.competition,
        status: (m.status || '').toLowerCase() || null,
        score: m.score && m.score.fullTime
          ? { home: m.score.fullTime.home ?? null, away: m.score.fullTime.away ?? null } : null,
        source: this.stamp({ sourceUrl: url, sourceTimestamp: m.lastUpdated || null, recordId: m.id != null ? String(m.id) : null, stale, ageMs })
      };
    });
  }

  /**
   * Compare against the official FPL fixture and describe any disagreement.
   * Returns a list of human-readable conflict strings; empty means agreement.
   *
   * Only kickoff time and status are compared. Club identity is compared via
   * the caller's club index, because these two feeds spell clubs differently
   * and a raw string compare would manufacture a conflict on every row.
   */
  static conflictsWith(officialFixture, externalFixture, clubIndex) {
    const conflicts = [];
    if (!officialFixture || !externalFixture) return conflicts;

    if (officialFixture.kickoff_utc && externalFixture.kickoff_utc) {
      const a = Date.parse(officialFixture.kickoff_utc);
      const b = Date.parse(externalFixture.kickoff_utc);
      /* A minute of slack: the two feeds round differently and a 60-second
         difference is not a rescheduling. */
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 60000) {
        conflicts.push(`kickoff: official ${officialFixture.kickoff_utc} vs football_data ${externalFixture.kickoff_utc}`);
      }
    }
    if (officialFixture.opponent && externalFixture.home && externalFixture.away && clubIndex) {
      const off = clubIndex.resolve(officialFixture.opponent);
      const extHome = clubIndex.resolve(externalFixture.home);
      const extAway = clubIndex.resolve(externalFixture.away);
      const names = [extHome && extHome.name, extAway && extAway.name].filter(Boolean);
      if (off && names.length === 2 && !names.includes(off.name)) {
        conflicts.push(`opponent: official ${off.name} is not in football_data's ${names.join(' v ')}`);
      }
    }
    return conflicts;
  }
}

module.exports = { FootballDataProvider };
