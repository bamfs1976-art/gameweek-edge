# Referee appointments — investigated, and declined

**Decision, 13 August 2026: not building this. Do not scrape efl.com.**

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

**football-data.org cannot supply them, and never will on this plan.** The
`referees` key is present on all 552 Championship and 380 Premier League
matches and populated on **none** of them. Present-but-never-filled is a tier
limit, not a schema gap — waiting for the season to start would not have
changed it. This is the finding that stays useful, and it is recorded in the
proxy's own comment.

**The EFL's page would have been readable.** Nuxt 2, content embedded in the
payload rather than fetched after load, and `/sitemap.xml` lists every
appointments article 168 times, so discovery needed no slug-guessing.

So the feature was technically feasible. **It is declined on the source, not
on the difficulty.** The site should read the official Fantasy EFL feed and
things it is offered, not pages it takes.

## What would have to change to revisit

One of:

- football-data.org starts populating `referees` on the plan in use — cheap
  to re-check by hand, no probe required: call
  `/api/football-data/matchday?competition=ELC` and look at any match.
- The EFL, or anyone else, offers referee appointments as a feed or an API
  that we are invited to consume.

Neither is worth polling for. If either happens it will be noticed by
someone reading, not by a scheduled job.

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
