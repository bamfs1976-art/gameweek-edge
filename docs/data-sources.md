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

## CORRECTION (21 Aug 2026, evening): FPL's elements DO carry `region`

Earlier in the day this file's neighbouring work stated flatly that FPL
elements carry 59 fields and none of them is nationality — *"no `nation`, no
`country`, no `region`, no `birth`"* — and that claim was used to justify
going looking for a nationality source at all.

**It was measured against `dev/fixtures/fpl-mock-bootstrap.json`, not against
the live API.** The mock carries 59 element fields. The live bootstrap,
probed from a runner on 21 Aug 2026, carries **109**, and among the 37 the app
never mentions are **`region`** and **`birth_date`**.

That is the house failure in its purest form: measuring the instrument and
reporting it as the world. A committed fixture is a snapshot of one moment,
and the confident sentence "FPL does not have this" needed the live feed to
support it.

What this does and does not change:

- It does **not** overturn the Pulselive decision. That rested on more than
  one field — football-data supplies nationality on every player asked, has
  published terms and a key we already hold, and the kick-off `status` finding
  stands untouched.
- It **does** mean a cheaper option was never evaluated. If `region` encodes
  what its name suggests, the nationality input may have been sitting in a
  feed the app already downloads on every load.
- It is **not** yet established what `region` contains. The probe reports the
  field's existence, not its values. Reading "it's nationality" off the name
  would repeat the original mistake in the opposite direction — that is the
  next measurement, not a conclusion.

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
| ~~Open-Meteo forecast~~ | 200 | wildcard | free tier is **non-commercial only** — and weather is out of scope; **no longer probed** |
| ~~Open-Meteo archive~~ | 200 | wildcard | as above |
| REST Countries v3.1 | **200 with an error envelope** — *"This API version has been deprecated"* | wildcard | no licence wording matched |
| Wikidata entity | 200 `{entities}` | wildcard | CC0 wording found |
| Club Elo | **unreachable** — 15s timeout on http, `fetch failed` on https | — | terms page never answered |
| Sunrise-Sunset | 200 | wildcard | *"The API is free to use: no sign up or API key required. We do require attribution: display a visible link to sunrise-sunset.org"* |
| TheSportsDB | 200 — but the `/3/` in the path **is their public test key**, so it fails the no-key filter | wildcard | no licence wording matched |
| FPL Draft API | 200, full bootstrap shape | **none — needs a proxy** | PL terms page answered; excerpt was site navigation |

### Open-Meteo: reachable, well-shaped, and not available to us

**The free API is non-commercial only.** Quoted from
`open-meteo.com/en/terms`, captured 21 Aug 2026:

> **Non-Commercial Use.** By using the Free API for non-commercial use you
> agree to following terms: Less than 10'000 API calls per day, 5'000 per
> hour and 600 per minute. **You may only use the free API services for
> non-commercial purposes.** You accept to the CC-BY 4.0 licence, as
> specified in the licence conditions.

Gameweek Edge sells subscriptions. Stripe webhook code is in this repo. That
makes it a commercial use of the free service, and the sentence above is not
ambiguous.

**Do not be misled by the CC-BY 4.0 in that same paragraph** — it is the
easiest mistake available here, and it would be a real one. CC-BY 4.0 governs
the DATA and does permit commercial use. The non-commercial restriction is on
the free API SERVICE. Both sentences are true at once: the data is freely
licensed, and we are not permitted to obtain it from that endpoint. Quoting
the licence half to justify the call is picking the convenient clause out of
a paragraph that also contains the inconvenient one.

Open-Meteo sells a commercial tier. Taking it would break the project's
standing rule against paid APIs, so it is not a decision this file makes.

### Weather is out of scope — decision, 21 August 2026

Closed by the site's owner, and closed on the subject rather than on the
vendor. Open-Meteo's non-commercial restriction would have ended that one
source; the decision goes further, so a weather API with friendlier terms is
**not wanted either** and looking for one is not a pending task.

`grep -riE 'weather|rain|wind|temperature'` across `index.html` and
`netlify/functions/` returns 0, and it is meant to stay that way. The gap is
real and is being declined, which is a different thing from being unfillable.

The two Open-Meteo candidates have been **removed** from
`dev/open-api-probe.mjs` rather than commented out — the same reasoning that
deleted the referee probes rather than gating them. A candidate that still
runs is an invitation, and "200, wildcard CORS" scrolling past a future run
is exactly the shape of thing somebody picks up and builds on.
`dev/test-open-api-probe.mjs` now fails if any weather source returns to the
list, matched on the subject and not just the host, so swapping in a
different vendor does not slip past. If weather is ever back in scope, that
check is deleted deliberately.

The measurements above stay as a record of why the call was easy, not as a
lead to follow.

Everything else on this list either duplicates something we have (Elo via
FPL-Core-Insights, nationality via football-data) or fills no gap anyone has
named.

### The two that are cleanly usable, and what they cost

- **Wikidata** — *"All structured data in the main, property and lexeme
  namespaces is made available under the Creative Commons CC0 License (Public
  domain); text in other namespaces is made available under the Creative
  Commons Attribution-ShareAlike…"*. CC0 on the structured data, so no
  attribution obligation on that half. Fills no current gap.
- **Sunrise-Sunset** — *"The API is free to use: no sign up or API key
  required. We do require attribution: display a visible link to
  sunrise-sunset.org in the app or page where you show the data."* Clean and
  quotable, attached to the most marginal gap on the list.

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
4. **A heading reported as a licence.** The excerpt grabber had one flat word
   list including "terms of use", took the FIRST match, and on every real page
   that match is navigation furniture. Open-Meteo's terms went unread for two
   whole surveys, and the summary said so honestly but weakly — "licence not
   captured, read the URL". Strong wording (states a permission) is now
   separated from weak wording (says the page is about permissions), every
   strong match is collected rather than the first, and the stated permissions
   are repeated in a digest at the end of the run.

   **This is the correction that mattered.** With the heading winning, the
   report read as "reachable, wildcard CORS, terms unread" — an invitation to
   build. With the clause found, it reads "not available to us". The two
   outputs differ by one regex tier and point in opposite directions.

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
