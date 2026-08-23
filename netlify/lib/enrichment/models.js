/* Gameweek Edge — the canonical model.
 *
 * The whole design goal: make it impossible to read a value without also
 * being able to see where it came from, when, and whether anything disagreed.
 *
 * Two rules the constructors enforce rather than merely document:
 *
 *   1. NO SIGNAL WITHOUT A SOURCE. Every availability reading, fixture and
 *      news item carries at least one SourceRecord.
 *   2. MISSING IS NOT FALSE. predicted_starter is `null` when nobody said,
 *      never `false`. "We have no line-up prediction" and "he is predicted to
 *      be benched" are different claims and the model keeps them different.
 */

const STATUSES = ['available', 'doubtful', 'injured', 'suspended', 'unknown'];

/** @returns {object} a provenance stamp. */
function sourceRecord({ provider, fetchedAt, sourceTimestamp = null, sourceUrl = null, recordId = null, stale = false, ageMs = null }) {
  if (!provider) throw new TypeError('sourceRecord requires a provider');
  return {
    provider,
    fetched_at: (fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt || Date.now())).toISOString(),
    source_timestamp: sourceTimestamp ? new Date(sourceTimestamp).toISOString() : null,
    /* Query strings can carry credentials; callers pass an already-safe URL. */
    source_url: sourceUrl || null,
    record_id: recordId == null ? null : String(recordId),
    stale: !!stale,
    age_ms: ageMs
  };
}

function playerIdentity({ fplId = null, providerIds = {}, displayName, normalizedName, teamFplId = null, teamName = null, position = null }) {
  return {
    fpl_id: fplId == null ? null : Number(fplId),
    provider_ids: { ...providerIds },
    display_name: displayName,
    normalized_name: normalizedName,
    team_fpl_id: teamFplId == null ? null : Number(teamFplId),
    team_name: teamName,
    position
  };
}

function availabilitySignal({
  status = 'unknown', chanceOfPlayingNextRound = null, detail = null, expectedReturn = null,
  predictedStarter = null, lineupConfidence = null, sources = []
}) {
  if (!STATUSES.includes(status)) status = 'unknown';
  if (!sources.length) throw new TypeError('availabilitySignal requires at least one source');
  return {
    status,
    chance_of_playing_next_round: chanceOfPlayingNextRound == null ? null : Number(chanceOfPlayingNextRound),
    detail,
    expected_return: expectedReturn ? new Date(expectedReturn).toISOString() : null,
    /* null, never false, when nobody predicted anything. */
    predicted_starter: predictedStarter === null || predictedStarter === undefined ? null : !!predictedStarter,
    lineup_confidence: lineupConfidence == null ? null : clamp01(Number(lineupConfidence)),
    sources
  };
}

function fixtureContext({
  fixtureId = null, kickoffUtc = null, opponent = null, isHome = null,
  competition = null, status = null, sourceConflicts = [], sources = []
}) {
  return {
    fixture_id: fixtureId == null ? null : Number(fixtureId),
    kickoff_utc: kickoffUtc ? new Date(kickoffUtc).toISOString() : null,
    opponent,
    is_home: isHome == null ? null : !!isHome,
    competition,
    status,
    source_conflicts: [...sourceConflicts],
    sources
  };
}

function newsItem({
  title, url, publisher, publishedAt = null, snippet = null, imageUrl = null,
  matchedFplIds = [], matchedTeams = [], relevanceScore = 0, source
}) {
  if (!source) throw new TypeError('newsItem requires a source');
  return {
    title,
    url,
    publisher,
    published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
    /* Snippet only. Full article bodies are not stored or redistributed —
       see the licensing note in docs/ENRICHMENT.md. */
    snippet: snippet == null ? null : String(snippet).slice(0, 400),
    image_url: imageUrl || null,
    matched_fpl_ids: [...matchedFplIds],
    matched_teams: [...matchedTeams],
    relevance_score: Number(relevanceScore.toFixed ? relevanceScore.toFixed(3) : relevanceScore),
    source
  };
}

function recommendation({
  provider, kind, playerFplId = null, subject = null, score = null,
  expectedPoints = null, rationale = null, generatedAt = null, source
}) {
  if (!source) throw new TypeError('recommendation requires a source');
  return {
    provider,
    kind,
    player_fpl_id: playerFplId == null ? null : Number(playerFplId),
    subject,
    score: score == null ? null : Number(score),
    expected_points: expectedPoints == null ? null : Number(expectedPoints),
    rationale,
    generated_at: generatedAt ? new Date(generatedAt).toISOString() : null,
    /* Read by the UI so third-party model output can never be rendered as
       this project's own finding. */
    is_third_party_model_output: true,
    source
  };
}

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);

module.exports = {
  STATUSES, sourceRecord, playerIdentity, availabilitySignal,
  fixtureContext, newsItem, recommendation
};
