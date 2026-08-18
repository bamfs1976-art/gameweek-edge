# Data-integration (enrichment) layer

Combines the official FPL feed with up to five external providers into one
canonical response: availability and injury flags, predicted-line-up and
minutes-risk signals, fixture and opponent context, relevant news, optional
third-party recommendations — each carrying its own provenance, timestamp and
staleness.

**It is read-only.** It fetches and merges. There is no transfer, team change,
purchase or outbound post anywhere in `netlify/lib/enrichment/` or the endpoint
in front of it.

```
netlify/lib/enrichment/
  config.js          every environment variable, in one place
  errors.js          the failure taxonomy the service reacts to
  http.js            timeout, bounded retry, 429/Retry-After
  cache.js           TTL cache with an explicit STALE fallback
  models.js          the canonical schema
  resolve.js         name/club normalisation and entity resolution
  news_matching.js   dedup, filtering, transparent relevance
  index.js           buildFplEnrichment() — the service
  providers/         one adapter per source
netlify/functions/enrich.js   GET /api/enrich
dev/test-enrichment.mjs       127 fixture-driven checks, in `npm test`
dev/enrich-cli.mjs            read-only CLI
```

## What each integration contributes, and how far to trust it

| Source | Contributes | Status |
|---|---|---|
| **Official FPL** | FPL ids, official availability, price, ownership, fixtures | **LIVE** — authoritative, keyless, via the existing `/api/fpl` proxy |
| **football-data.org** | fixtures, results, competition, status, score | **LIVE** — key already configured, via the existing `/api/football-data` proxy |
| **LetLetMe** | player metadata, teams, fixtures, FPL-level metrics | Adapter only — needs `LETLETME_API_BASE_URL` |
| **Unofficial FPL GraphQL/REST** | second opinion on price, points, ownership, form, minutes | Adapter only — needs `FPL_GRAPHQL_API_URL` |
| **Apify Live Football Data** | injuries, predicted line-ups | Adapter only — needs `APIFY_TOKEN` + actor id |
| **Apify FPL Intelligence** | transfer/captain/price recommendations | Adapter only, **off by default** |
| **World News API** | BBC/Sky/Guardian team and player context | Adapter only — needs base URL + key |

> **Unofficial and third-party.** Everything except the official FPL feed is
> outside this project's control and may change shape or disappear without
> notice. The five adapters above have **not** been verified against a live
> endpoint from this repository — their request shapes come from each
> provider's documentation and are exercised only against fixtures. They are
> configuration away from working, not proof that they work.

## Precedence: what may overwrite what

1. **Official FPL is authoritative** for FPL ids, official availability flags,
   prices, ownership and FPL fixtures. Nothing overwrites it.
2. **External football providers** enrich fixtures with competition, status and
   score, and only where the official feed is silent. Where the two disagree
   the disagreement is **recorded** on the fixture as `source_conflicts` and in
   `data_quality.fixture_conflicts` — never applied.
3. **Apify Live Football** adds injury and predicted-line-up signals as
   *secondary evidence*, appended alongside the official signal rather than
   replacing it. A player can carry several availability signals at once.
4. **World News** is context only. It never changes an availability status.
5. **Apify FPL Intelligence** stays separate, flagged
   `is_third_party_model_output: true`.

### The rule worth stating twice

**A missing line-up prediction is not a prediction of benching.**
`predicted_starter` is `true` or `false` only when a provider actually said so;
otherwise it is `null` with `confidence_label: "none"`. Absence from a
predicted XI can mean benched, injured, or that the feed had not published that
team yet, and those are different facts.

## Configuration

Every variable is documented in `.env.example`. Required versus optional:

- **Required: none.** The layer runs with no credentials, using the two live
  providers above.
- **Optional:** each remaining provider switches itself on when its own
  settings are present, and reports `configured: false` with the exact missing
  variable names until then.

Secrets are read server-side only. They never reach the browser, a cache key,
a `source_url`, or a log line — there are tests for each of those.

## Usage

```bash
# what is configured, and what is missing
npm run enrich -- --health

# a read-only enrichment for gameweek 1
npm run enrich -- --gameweek 1 --players 1,2,3 --include-news

# over HTTP
curl 'https://gameweekedge.co.uk/api/enrich?gameweek=1&players=1,2,3&news=1'
```

The CLI prints JSON on stdout and notes on stderr, so it pipes into `jq`. It
exits non-zero **only** when the core official feed is unavailable — an
optional provider being unconfigured or failing is a warning in
`data_quality`, not a failure of the command.

## Caching and refresh

- Default TTL 900s; football-data 3600s; Apify 3600s (runs cost money and move
  slowly).
- **football-data.org allows roughly ten requests a minute for the entire
  site.** The layer calls this site's own `/api/football-data` proxy rather
  than the upstream, precisely so the existing edge cache keeps acting as the
  rate limiter. Do not "optimise" this into a direct upstream call.
- 429 is respected, including `Retry-After`. Only transient failures are
  retried; an auth rejection and an unparseable body are not.
- When a live call fails and safe cached data exists, the cached value is
  returned **marked stale**, with its age, so the UI can show it with a warning
  rather than showing nothing.

## News: attribution and licensing

Publishers are **not** scraped. The adapter queries a news API and stores only
title, canonical URL, publisher, publication time, an image URL and the snippet
the API returns — snippets are truncated to 400 characters and full article
bodies are never stored or redistributed. **The dashboard must link to the
source.** Check your World News API plan's licence before displaying anything
beyond metadata and a short snippet.

Relevance is a transparent weighted sum — matched player, matched club, FPL
keywords, recency, approved publisher — and the component breakdown is returned
alongside the score so any headline's presence can be explained.

## Uncertainty

Predicted line-ups and third-party recommendations are **informational and
uncertain**. They are one provider's opinion, frequently wrong, and must not be
presented as guarantees. The response carries a `disclaimer` field saying so,
and every recommendation is flagged as third-party model output.
