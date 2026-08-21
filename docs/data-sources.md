# Football data sources — what we use, and what else is reachable

Measured on 21 Aug 2026 by `dev/pl-endpoint-probe.mjs`, run from a runner via the
**Premier League API probe** workflow. It is a workflow rather than a local
script because the sandbox this project is developed in cannot reach these
hosts — the egress proxy answers 403 — so the question cannot be answered
honestly from there, and answering it from recollection would be presenting
knowledge as verification.

Re-run the workflow before trusting any of this. Endpoints rot.

> **The Pulselive question below is closed.** 21 Aug 2026: investigated and
> **declined** — everything we wanted from it turned out to be available from
> `api.football-data.org`, which we already hold a key for under published
> terms. See **`docs/scope-pulselive-source.md`** for the measurements and
> what would reopen it. The survey below is left as written, because it is
> the evidence that decision was made on.

## In use today

| Source | Key | How it reaches the browser |
|---|---|---|
| `fantasy.premierleague.com/api` | none | `netlify/functions/fpl.js`, with an ALLOW list |
| `api.football-data.org` v4 | free key, configured | `netlify/functions/football-data.js` — midweek fixtures, and (measured 21 Aug 2026) squad **nationality** and confirmed-vs-provisional kick-offs |
| `resources.premierleague.com` | none | direct — crests and player photos |
| `raw.githubusercontent.com` (vaastav) | none | build-time, historical seasons |

## Reachable, free, not used

**Pulselive — `footballapi.pulselive.com/football/...`**
The API premierleague.com itself runs on. No key, no `Origin` request header
needed. Seven endpoints probed, all 200 with JSON:

| Path | Payload keys |
|---|---|
| `/competitions` | `abbreviation, description, level, source, id` |
| `/teams?comps=1` | `name, club, teamType, grounds, shortName, id` |
| `/fixtures?comps=1` | `gameweek, kickoff, provisionalKickoff, teams, replay, ground, neutralGround, status, phase, outcome, attendance, clock, goals, penaltyShootouts, id` |
| `/standings?comps=1` | `live, dynamicallyGenerated, tables` |
| `/players?comps=1` | `playerId, info, nationalTeam, previousTeam, birth, name, id` |
| `/teams/{id}/compseasons/{s}/staff` | `compSeason, team, players, **officials**` |
| `/stats/ranked/players/goals` | `entity, stats` |
| `/fixtures/{id}` | as the fixtures row |
| `/fixtures/{id}/textstream/EN` | `fixture, **events**` — the match timeline |

**They cannot be called from the browser.** Asked from
`https://gameweekedge.co.uk`, every one answered 200 with **no
`Access-Control-Allow-Origin` header at all**. Asked with the Premier League
origin, every one echoed `https://www.premierleague.com`. That pair of
measurements is what distinguishes a fixed allowlist from a server that
echoes any origin — the first run measured only the second case and could not
tell them apart, which is recorded in the script because it nearly became a
wrong conclusion.

So: usable, but only behind a Netlify function, exactly like `fpl.js` and
`football-data.js`. That is a known shape here, not a new one.

**SDP — `sdp-prem-prod.premier-league-prod.pulselive.com/api/v2/...`**
The newer platform. `/api/v2/matches?competition=8` returns
`{pagination, data}` with `phase, kickoff, homeTeam, awayTeam, ground,
season, resultType, …`. `Access-Control-Allow-Origin: *` — **callable
directly from the browser**, subject to adding the host to the CSP.
`/api/v2/competitions` returned 400 without parameters; that is a probe gap,
not a dead route.

**openfootball** — `raw.githubusercontent.com/openfootball/football.json`.
CORS `*`, open licence, but hand-maintained community data and fixtures only.

## Refused, as expected

`api.football-data.org` without a key → 403 (we hold a free key).
`v3.football.api-sports.io` → 403, missing token, and paid beyond a trial.
`www.premierleague.com/api/competitions` → 404 HTML; the www host is not a
proxy for the API.

## What the probe does NOT tell you

**Whether any of this is licensed for our use.** A 200 means reachable. It
does not mean permitted. Pulselive and SDP are undocumented site APIs whose
terms say nothing about third-party use, and that judgement is a human one —
it is deliberately not encoded in an exit code.

**Coverage.** The candidate list is hand-written and finite. An endpoint
absent from the output was *not probed*, which is not the same as not
existing.

## What the source we already have turned out to carry

Measured 21 Aug 2026 by `dev/probe-squad-nationality.mjs`, run through our own
deployed proxy so no key left the Netlify function. Both of these were reasons
to want Pulselive, and both are answered here instead:

| Route | Finding |
|---|---|
| `/teams/{id}` → `squad[].nationality` | Filled on **97/97** Premier League and **66/66** Championship players asked. No gaps. |
| `/competitions/{c}/matches` → `status` | `SCHEDULED` (date known, time not fixed) and `TIMED` (confirmed) are **both real on this plan** — Championship returned `SCHEDULED 264, TIMED 276, FINISHED 12`. |

The Premier League returned `TIMED 380` — every fixture confirmed — which on
its own proves nothing either way, and the probe says so rather than reporting
it as a finding. It is the Championship split that establishes the
distinction exists.

Neither of these is wired into the app yet. This records that the input is
available, not that anything reads it.

## Free to USE — the successor survey (21 Aug 2026)

`dev/open-api-probe.mjs`, run from the **Data source surveys** workflow. This
one puts licensing first, because the survey above could not, and that gap is
what made Pulselive expensive to close. Two filters applied **before** any
request: the candidate must publish terms somewhere citable, and it must need
no key. The first excludes every undocumented site backend as a matter of
policy; the second is the project's standing rule.

| Candidate | Result | CORS from our origin | Terms |
|---|---|---|---|
| **Open-Meteo forecast** | 200 | wildcard | read; excerpt was liability boilerplate — **licence not captured, read the URL** |
| **Open-Meteo archive** | 200 | wildcard | as above |
| REST Countries v3.1 | **200 with an error envelope** — *"This API version has been deprecated"* | wildcard | no licence wording matched |
| Wikidata entity | 200 `{entities}` | wildcard | CC0 wording found |
| Club Elo | **unreachable** — 15s timeout on http, `fetch failed` on https | — | terms page never answered |
| Sunrise-Sunset | 200 | wildcard | *"The API is free to use: no sign up or API key required. We do require attribution: display a visible link to sunrise-sunset.org"* |
| TheSportsDB | 200 — but the `/3/` in the path **is their public test key**, so it fails the no-key filter | wildcard | no licence wording matched |
| FPL Draft API | 200, full bootstrap shape | **none — needs a proxy** | PL terms page answered; excerpt was site navigation |

**The one gap with nothing filling it is weather.** `grep -riE
'weather|rain|wind|temperature'` across `index.html` and `netlify/functions/`
returns 0. Everything else on this list either duplicates something we have
(Elo via FPL-Core-Insights, nationality via football-data) or fills no gap
anyone has named.

Three things this run corrected about itself, each caught by reading output:

1. **A 503 with the reason thrown away.** Open-Meteo's forecast route answered
   503 on the first run and the output printed `{reason, error}` — the key
   names, not the values. Key names cannot separate a bad parameter from a
   rate limit from an outage. The body is printed now, and the re-run answered
   200, so that 503 was transient. Reporting it as "Open-Meteo refuses us"
   would have been the natural, wrong reading.
2. **A 200 that was not a success.** REST Countries was counted among "6 of 8
   answered 200 with parseable JSON" while returning a deprecation notice and
   no countries. Error envelopes are excluded from the usable count now, and
   the deprecation only became visible once bodies were printed.
3. **A candidate mislabelled as keyless.** TheSportsDB was described as
   "probed WITHOUT a key". The `/3/` path segment *is* the key — a shared demo
   credential that can be rate-limited or revoked for everyone at once. It
   fails the filter, and failing it is the finding.

**Nothing here is wired in.** This records what is available and under what
stated terms. Every licence judgement remains a human one; the excerpts above
are excerpts, and the URLs are in `dev/open-api-probe.mjs`.

## The one that touches an open question

`/teams/{id}/compseasons/{s}/staff` returns an `officials` array. Referee
data from an official JSON endpoint is a different thing from scraping a
website, which was declined earlier — but `api.football-data.org` already
supplies referees on the fixtures we use, so this would be a second source
rather than a new capability. Worth knowing; not worth wiring on its own.

## Three corrections this survey made to itself

Recorded because each was a way of being confidently wrong, and each was
caught by reading the run's own output rather than by anything failing:

1. The summary printed *"0 required the Origin header, which means a browser
   cannot call them directly"* — a consequence clause emitted unconditionally,
   which read as a finding when the count was zero.
2. It judged JSON by content-type alone, and reported openfootball's perfectly
   good JSON as `not-json` because raw.githubusercontent serves `.json` as
   `text/plain`.
3. It guessed fixture id `93000`, got a 404, and would have had that read as
   "the endpoint is gone". That is evidence about the id, not the route. The
   single-fixture and textstream probes chain off a real id now.
