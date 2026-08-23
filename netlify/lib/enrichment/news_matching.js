/* Gameweek Edge — news deduplication, filtering and relevance.
 *
 * The relevance score is deliberately a small, readable sum rather than a
 * model. Anyone reading a headline in the dashboard must be able to ask "why
 * is this here?" and get an answer from the components, which is why the
 * breakdown is returned alongside the total.
 */
const { normalizeName } = require('./resolve');

/* Words that mark a football story as FPL-relevant rather than transfer noise. */
const FPL_KEYWORDS = [
  'injury', 'injured', 'fitness', 'doubt', 'return', 'ruled out', 'team news',
  'line-up', 'lineup', 'starting xi', 'press conference', 'suspension', 'suspended',
  'available', 'setback', 'scan', 'assessment'
];

const WEIGHTS = { player: 0.45, team: 0.2, keyword: 0.2, recency: 0.1, publisher: 0.05 };

/** Canonical URL for dedup: scheme+host+path, tracking parameters removed. */
function canonicalUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    return `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch (_) { return String(raw).trim().toLowerCase() || null; }
}

/** Fallback identity when there is no usable URL. */
function fallbackKey(article) {
  return [normalizeName(article.title), normalizeName(article.publisher || ''),
    (article.published_at || '').slice(0, 10)].join('|');
}

/**
 * Deduplicate by canonical URL first, then by title+publisher+date.
 * The FIRST occurrence wins, so callers should pass higher-quality sources
 * earlier if they care which copy survives.
 */
function dedupe(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = canonicalUrl(a.url) || fallbackKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Keep only approved publisher domains. An unparseable URL is dropped. */
function filterBySource(articles, approvedDomains = []) {
  if (!approvedDomains.length) return articles;
  const allow = approvedDomains.map((d) => d.toLowerCase().replace(/^www\./, ''));
  return articles.filter((a) => {
    let host;
    try { host = new URL(a.url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return false; }
    return allow.some((d) => host === d || host.endsWith(`.${d}`));
  });
}

/**
 * Drop anything older than the window.
 * An article with NO date is KEPT — the API not publishing a date is a fact
 * about the API, and discarding those would silently hide whole publishers.
 * It scores zero for recency instead.
 */
function filterByRecency(articles, windowDays, now = Date.now()) {
  const cutoff = now - windowDays * 86400e3;
  return articles.filter((a) => {
    if (!a.published_at) return true;
    const t = Date.parse(a.published_at);
    return !Number.isFinite(t) || t >= cutoff;
  });
}

/**
 * Transparent relevance score in [0,1] plus the component breakdown.
 *
 * @param {object} article
 * @param {object} ctx
 * @param {Array<{fpl_id:number, display_name:string, full_name?:string}>} ctx.players
 * @param {string[]} ctx.teams  canonical club names
 * @param {string[]} ctx.approvedDomains
 */
function scoreArticle(article, { players = [], teams = [], approvedDomains = [], windowDays = 7, now = Date.now() } = {}) {
  const hay = normalizeName(`${article.title || ''} ${article.snippet || ''}`);
  const matchedPlayers = [];
  for (const p of players) {
    const candidates = [p.full_name, p.display_name].filter(Boolean).map(normalizeName);
    if (candidates.some((c) => c && hay.includes(c))) matchedPlayers.push(p.fpl_id);
  }
  const matchedTeams = teams.filter((t) => t && hay.includes(normalizeName(t)));
  const keywordHits = FPL_KEYWORDS.filter((k) => hay.includes(normalizeName(k)));

  let recency = 0;
  if (article.published_at) {
    const t = Date.parse(article.published_at);
    if (Number.isFinite(t)) {
      const ageDays = Math.max(0, (now - t) / 86400e3);
      recency = Math.max(0, 1 - ageDays / Math.max(1, windowDays));
    }
  }

  let publisher = 0;
  try {
    const host = new URL(article.url).hostname.replace(/^www\./, '').toLowerCase();
    publisher = approvedDomains.some((d) => host === d || host.endsWith(`.${d}`)) ? 1 : 0;
  } catch (_) { publisher = 0; }

  const parts = {
    player: matchedPlayers.length ? 1 : 0,
    team: matchedTeams.length ? 1 : 0,
    keyword: Math.min(1, keywordHits.length / 2),
    recency,
    publisher
  };
  const total = Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + w * parts[k], 0);

  return {
    score: Number(total.toFixed(3)),
    matched_fpl_ids: matchedPlayers,
    matched_teams: matchedTeams,
    /* Returned so the dashboard can explain a headline's presence. */
    breakdown: { ...parts, keywords: keywordHits }
  };
}

module.exports = { canonicalUrl, dedupe, filterBySource, filterByRecency, scoreArticle, FPL_KEYWORDS, WEIGHTS };
