/* Gameweek Edge — Apify Live Football Data: injuries and predicted line-ups.
 * NOT LIVE (no APIFY_TOKEN / actor id configured).
 *
 * THE RULE THIS ADAPTER EXISTS TO ENFORCE:
 * a missing prediction is never rendered as "will not start". Absence of a
 * player from a predicted XI can mean benched, injured, or simply that the
 * feed had not published that team yet — and those are different facts. So
 * predicted_starter is true only when the feed says so, and otherwise stays
 * null with a confidence label of 'none'.
 */
const { ApifyProvider } = require('./apify_base');
const { firstNumber, firstString } = require('./letletme');

/* Free-text injury wording -> canonical status. Anything unrecognised stays
   'unknown' rather than being forced into 'injured'. */
/* ORDER MATTERS, and it is not the obvious one. A CAUSE word ("knock",
   "strain") says what happened; an AVAILABILITY word ("doubtful", "50-50")
   says whether he will play. Real feed text carries both — "Knock picked up
   in training, doubtful" — and the availability claim is the more specific
   one, so it is tested first. Testing causes first read that item as
   "injured", which is a harder claim than the source actually made. */
const STATUS_WORDS = [
  [/\b(suspend|ban|red card)/i, 'suspended'],
  [/\b(doubt|questionable|50-?50|assess|late test)/i, 'doubtful'],
  [/\b(injur|strain|tear|fractur|surgery|knock|hamstring|acl|out for)/i, 'injured'],
  [/\b(fit|available|returned|back in training)/i, 'available']
];

class ApifyLiveFootballProvider extends ApifyProvider {
  static LIVE = false;
  static NOTE = 'Adapter only — needs APIFY_TOKEN and APIFY_LIVE_FOOTBALL_ACTOR_ID.';

  /**
   * Normalise one dataset item. Every field is defensive: this is a scraped
   * feed and the shape is the provider's to change without notice.
   */
  toRecord(item, { safeUrl, stale, ageMs }) {
    const name = firstString(item.player, item.playerName, item.name, item.player_name);
    const club = firstString(item.team, item.teamName, item.club, item.team_name);
    const detail = firstString(item.injury, item.injuryStatus, item.status, item.reason, item.note, item.description);

    let status = 'unknown';
    for (const [re, label] of STATUS_WORDS) {
      if (detail && re.test(detail)) { status = label; break; }
    }

    /* Explicitly tri-state. `predictedStart === false` from the feed is a real
       claim and is kept; a MISSING field is not turned into false. */
    const raw = item.predictedStart ?? item.predicted_start ?? item.isPredictedStarter ?? item.starting;
    const predictedStarter = raw === undefined || raw === null ? null : !!raw;

    const confidence = firstNumber(item.confidence, item.probability, item.startProbability);
    return {
      name,
      club,
      position: firstString(item.position, item.pos),
      status,
      detail,
      expected_return: firstString(item.expectedReturn, item.expected_return, item.returnDate) || null,
      predicted_starter: predictedStarter,
      /* Normalise a 0-100 probability to 0-1; leave a 0-1 alone. */
      lineup_confidence: confidence == null ? null : (confidence > 1 ? confidence / 100 : confidence),
      confidence_label: predictedStarter === null ? 'none' : (confidence == null ? 'unlabelled' : 'reported'),
      record_id: firstString(item.id, item.playerId, item.player_id),
      source_timestamp: firstString(item.updatedAt, item.updated_at, item.lastUpdated, item.timestamp),
      safe_url: safeUrl,
      stale,
      age_ms: ageMs
    };
  }
}

module.exports = { ApifyLiveFootballProvider, STATUS_WORDS };
