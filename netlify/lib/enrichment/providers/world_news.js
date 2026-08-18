/* Gameweek Edge — World News API adapter. NOT LIVE.
 *
 * Publishers are NOT scraped. This talks to a news API that is licensed to
 * redistribute metadata, and it stores title, URL, publisher, time and the
 * snippet the API returns — never a full article body. The dashboard links
 * out. See the attribution note in docs/ENRICHMENT.md.
 *
 * Searches are bounded on purpose: an approved-domain list, English, a UK
 * country hint where supported, and a recent window. An unbounded football
 * news query returns transfer rumour and is worse than no news at all.
 */
const { BaseProvider } = require('./base');
const { ProviderSchemaError } = require('../errors');
const { firstString } = require('./letletme');

class WorldNewsProvider extends BaseProvider {
  static LIVE = false;
  static NOTE = 'Adapter only — needs WORLD_NEWS_API_BASE_URL and WORLD_NEWS_API_KEY.';

  /** Query text for a player: name plus club, never the name alone. */
  static playerQuery(playerName, clubName) {
    return clubName ? `"${playerName}" ${clubName}` : `"${playerName}"`;
  }

  /** Query text for a team: club plus the words that carry team news. */
  static teamQuery(clubName) {
    return `${clubName} (injury OR "team news" OR "press conference" OR lineup OR "line-up")`;
  }

  async search(text, { windowDays = null, max = null } = {}) {
    this.requireConfigured();
    const days = windowDays ?? this.settings.windowDays;
    const earliest = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const params = {
      text,
      'source-countries': this.settings.country,
      language: this.settings.language,
      'earliest-publish-date': earliest,
      number: String(max ?? this.settings.maxArticles),
      /* The approved-domain list is the main quality control. */
      'news-sources': this.settings.sources.join(',')
    };

    /* The key goes in a header, not the query string, so it can never end up
       in a cache key, a log line or a stamped source_url. */
    const qs = new URLSearchParams(params).toString();
    const url = `${this.settings.baseUrl}/search-news?${qs}`;
    const got = await this.cached('search-news', params, async () => {
      const { data } = await this.http(url, { headers: { 'x-api-key': this.settings.apiKey } });
      const rows = (data && (data.news || data.articles)) || null;
      if (!Array.isArray(rows)) {
        throw new ProviderSchemaError('search response had no news[]/articles[]', { provider: this.name });
      }
      return rows;
    });
    return { ...got, url };
  }

  toArticle(row, { url, stale, ageMs }) {
    const link = firstString(row.url, row.link);
    return {
      title: firstString(row.title, row.headline) || '(untitled)',
      url: link,
      publisher: publisherOf(row, link),
      /* A missing date is kept as null. It must not default to "now", which
         would make an undated archive piece look like breaking news. */
      published_at: firstString(row.publish_date, row.publishedAt, row.published_date, row.date),
      snippet: firstString(row.summary, row.text, row.description),
      image_url: firstString(row.image, row.imageUrl, row.urlToImage),
      record_id: firstString(row.id),
      safe_url: url.split('?')[0],
      stale,
      age_ms: ageMs
    };
  }
}

function publisherOf(row, link) {
  const explicit = firstString(row.source_country && row.author, row.publisher, row.source, row.author);
  if (explicit) return explicit;
  try { return new URL(link).hostname.replace(/^www\./, ''); } catch (_) { return 'unknown'; }
}

module.exports = { WorldNewsProvider, publisherOf };
