/* Gameweek Edge — Apify FPL Intelligence: third-party recommendations.
 * NOT LIVE, and OFF BY DEFAULT (APIFY_FPL_INTELLIGENCE_ENABLED defaults false).
 *
 * This is somebody else's model. It is stored as clearly-labelled third-party
 * output alongside the evidence, never merged into this project's own
 * numbers and never presented as a finding. The canonical Recommendation
 * record carries is_third_party_model_output: true for exactly that reason.
 *
 * Disabled mode makes NO call at all — not a call that is thrown away.
 */
const { ApifyProvider } = require('./apify_base');
const { firstNumber, firstString } = require('./letletme');

/* Recommendation kinds this adapter recognises. An unrecognised kind is kept
   verbatim rather than dropped: a provider adding a new one should show up as
   an unfamiliar label, not as silence. */
const KNOWN_KINDS = ['transfer_in', 'transfer_out', 'captain', 'price_change', 'watchlist', 'wildcard'];

class ApifyFplIntelligenceProvider extends ApifyProvider {
  static LIVE = false;
  static NOTE = 'Adapter only, and disabled by default — needs APIFY_TOKEN and APIFY_FPL_INTELLIGENCE_ACTOR_ID.';

  toRecord(item, { safeUrl, stale, ageMs }) {
    const kind = firstString(item.kind, item.type, item.recommendationType, item.category) || 'unknown';
    return {
      kind: KNOWN_KINDS.includes(kind) ? kind : `unrecognised:${kind}`,
      player_fpl_id: firstNumber(item.fplId, item.fpl_id, item.playerId, item.element),
      subject: firstString(item.player, item.playerName, item.subject, item.name, item.team),
      score: firstNumber(item.score, item.rating, item.rank),
      expected_points: firstNumber(item.expectedPoints, item.expected_points, item.xP, item.xp),
      rationale: firstString(item.rationale, item.reason, item.explanation, item.summary),
      generated_at: firstString(item.generatedAt, item.generated_at, item.timestamp, item.updatedAt),
      record_id: firstString(item.id, item.recommendationId),
      safe_url: safeUrl,
      stale,
      age_ms: ageMs
    };
  }
}

module.exports = { ApifyFplIntelligenceProvider, KNOWN_KINDS };
