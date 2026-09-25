# Referee appointments — investigated, and declined

**Decision, 13 August 2026: not building this. Do not scrape efl.com.**
**Reaffirmed 25 September 2026** against both reopening conditions: the
football-data plan now names officials, but only on matches already played,
and a new source (BSD) was weighed without being called. Both are at the
bottom of "What would have to change to revisit".

Closed by the site's owner. This file is the record of what was asked, what
was found, and what would have to change for the answer to be different — so
that nobody re-runs the investigation in six months, and nobody picks up a
half-finished scraper.

The probes that produced these findings (`dev/probe-referees.mjs`,
`dev/probe-efl-source.mjs`) have been **deleted**, because their only purpose
was to enable a feature that is not being built and a gated scraper sitting
in the repo is an invitation. The one finding with ongoing value lives in a
code comment where an implementer will actually meet it — see
`netlify/functions/football-data.js`, the `matchday` route.

---

## The idea

Fantasy EFL knows who is one booking from a suspension. It does not know who
is refereeing them, and a player on four yellows in front of a strict
official is a different risk from the same player in front of a lenient one.

## What was found

**Referees are published before kick-off — three to nine days ahead.** The
EFL puts appointments on its own site; the 11 August article covered 14–20
August fixtures. That is comfortably inside the window the panel would need.

**football-data.org cannot supply them ahead of kick-off on this plan.** The
`referees` key is present on all 552 Championship and 380 Premier League
matches and, in August, populated on **none** of them. Present-but-never-
filled is a tier limit, not a schema gap. This is the finding that stays
useful, and it is recorded in the proxy's own comment. See the 25 September
re-check below, which changed the count and not the conclusion.

**The EFL's page would have been readable.** Nuxt 2, content embedded in the
payload rather than fetched after load, and `/sitemap.xml` lists every
appointments article 168 times, so discovery needed no slug-guessing.

So the feature was technically feasible. **It is declined on the source, not
on the difficulty.** The site should read the official Fantasy EFL feed and
things it is offered, not pages it takes.

## What would have to change to revisit

One of:

- football-data.org starts naming an official on a fixture that has **not
  been played** — cheap to re-check by hand, no probe required: call
  `/api/football-data/matchday?competition=ELC` and look at the `status` of
  any match that carries a name. Counting how many are filled is not the
  check; see the 25 September re-check below for why.
- The EFL, or anyone else, offers referee appointments as a feed or an API
  that we are invited to consume.

Neither is worth polling for. If either happens it will be noticed by
someone reading, not by a scheduled job.

### Re-checked 25 September 2026: the count moved, the answer did not

The first condition was tested for the first time, from a session that could
finally reach the deployed proxy. The raw counts have changed since August:

| | Premier League | Championship |
|---|---|---|
| Matches carrying a referee | 50 of 380 | 67 of 552 |
| Of those, status FINISHED | 50 | 67 |
| Fixtures still to be played | 330 | 457 |
| **Of those, carrying a referee** | **0** | **0** |

So the plan now fills the field retrospectively, as a record of who refereed
a match that has been played, and still publishes nothing in advance. The
condition is met on its old wording and not met on its purpose, so the
wording above has been tightened to say "has not been played".

Worth keeping, because it is the same failure this file already records
twice, arriving from the other direction. The first look returned "117 of 932
populated, up from nil", which is true and would have reopened a closed
question. The number that decides anything is the one filtered by status, and
it is nil. The lesson generalises as the mirror of the one at the bottom of
this file: when a check finds something, the question is whether it found the
thing you needed.

### Considered and left declined: BSD, 25 September 2026

A free API key for **BSD** (`sports.bzzoiro.com`) was offered, and it was
weighed against the second condition above. It is an API with a token that
invites consumption, it advertises 30+ leagues with per-match sub-resources
including `incidents`, and it is therefore the *shape* the condition
describes. That is not the same as meeting it.

**Nothing was called.** The host is denied by this environment's egress
policy and the key was not in the environment, so no response was seen. The
condition is that someone *offers referee appointments*, and an API existing
is not evidence that it carries them — which is precisely the trap recorded
above, where `referees` was present on 932 matches and populated on none.
Assuming the data is there because the marketing lists the leagues would be
the same error with the sign flipped.

So the decision stands unchanged. What would settle it is one call: fetch a
Premier League fixture from BSD's `/events/{id}` and look at whether an
official is named. Until someone has read that response, this stays declined,
and the second condition stays open rather than met.

### A note for the next reader of football-data.js

The proxy's file header spends forty lines on the rate limit before the
`matchday` route records that the feed carries no referees at all. A reader
who stops at the header comes away believing there is a working referee
source in need of shoring up, and on 19 September 2026 that is exactly what
happened: the dependency was described as fragile-but-working and a fallback
was proposed for it. The finding is in the right place for an implementer; it
is simply below the point where a skim stops. If it happens a third time, put
a pointer to this file at the top of that header rather than trusting the
reading order.

## A note on how this was investigated

Worth keeping, because it went wrong three times in the same way and the
third was caught only by the owner.

1. The first probe measured **one feed's** silence and the write-up reported
   it as "referees are not published before kick-off" — a claim about the
   world. It was false, and the probe could not have supported it.
2. The second version checked whether the EFL page carried the data, but
   stripped `<script>` blocks before counting — deleting the evidence before
   looking at it, and concluding the page had nothing.
3. The robots.txt check walked the file for a `User-agent: *` group, matched
   nothing, printed nothing, and still reported "/news/ is not disallowed" —
   the absence of a matched rule dressed up as permission.

Each time the instrument was measured and the result reported as the world.
The lesson that generalises: when a check finds nothing, the first question
is whether it *could* have found anything.

**robots.txt was never actually read.** That question dies with the decision,
but it should not be recorded as answered.
