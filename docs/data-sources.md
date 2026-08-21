# Football data sources — what we use, and what else is reachable

Measured on 21 Aug 2026 by `dev/pl-endpoint-probe.mjs`, run from a runner via the
**Premier League API probe** workflow. It is a workflow rather than a local
script because the sandbox this project is developed in cannot reach these
hosts — the egress proxy answers 403 — so the question cannot be answered
honestly from there, and answering it from recollection would be presenting
knowledge as verification.

Re-run the workflow before trusting any of this. Endpoints rot.

## In use today

| Source | Key | How it reaches the browser |
|---|---|---|
| `fantasy.premierleague.com/api` | none | `netlify/functions/fpl.js`, with an ALLOW list |
| `api.football-data.org` v4 | free key, configured | `netlify/functions/football-data.js` — referees, midweek fixtures |
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
