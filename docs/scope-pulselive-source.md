# Pulselive and SDP — investigated, and declined

**Decision, 21 August 2026: not wiring these. The data we wanted is already
available from a source we hold a key for, under published terms.**

This file is the record of what was asked, what was measured, and what would
have to change for the answer to be different — so that nobody re-runs the
survey in six months, and nobody starts building a proxy for an endpoint we
decided against.

It follows the shape of `docs/scope-referee-source.md`, and lands in the same
place for the same reason: **the site reads feeds it is offered, not endpoints
it takes.**

---

## The idea

`docs/data-sources.md` recorded a survey of what else the Premier League
serves for free. The strongest candidate was
`footballapi.pulselive.com` — the API premierleague.com itself runs on. No
key, no `Origin` header, nine endpoints answering 200 with JSON.

Four things on it looked like real gaps in what FPL gives us:

1. **`nationalTeam`** on `/players`. FPL's `elements` carry 59 fields and not
   one is nationality, so the app cannot know a winter tournament is about to
   take six players out of a squad — despite already having an
   international-break model (`intlBreakGws`, the wildcard `afterBreak` bonus
   at `index.html:13808`) and a congestion model shaped to carry exactly that
   kind of minutes risk (`CONGEST_MAX` and friends, `index.html:12141`).
2. **`provisionalKickoff`** vs `kickoff`. FPL fixtures carry twelve fields and
   one time, `kickoff_time`, with no way to tell a confirmed broadcast slot
   from a placeholder.
3. **`ground` / `neutralGround`**. FPL fixtures carry no venue at all.
4. **`officials`** on `/teams/{id}/compseasons/{s}/staff`.

## What was found

**football-data.org already answers (1), completely.** Probed on 21 Aug 2026
through our own deployed proxy, via `dev/probe-squad-nationality.mjs`:

| Competition | Clubs asked | Players | `nationality` present | filled |
|---|---|---|---|---|
| Premier League | 3 | 97 | 97 | **97** |
| Championship | 3 | 66 | 66 | **66** |

Not a single gap, in either competition, with real values — `Kepa
Arrizabalaga → Spain`, `Oliver Dovin → Sweden`, `Konstantinos Tzolakis →
Greece`. The `team` route was already in the proxy
(`netlify/functions/football-data.js`), already cached for 24 hours, and
already inside the free tier's budget at twenty calls a day.

**football-data.org already answers (2) as well.** Match `status`
distinguishes `SCHEDULED` — date known, kick-off time not fixed — from
`TIMED`. Measured in the same run:

- Premier League: `TIMED 380`. All of them.
- Championship: `SCHEDULED 264, TIMED 276, FINISHED 12`.

The Premier League figure on its own would have proved nothing: all-one-value
is ambiguous between "our plan collapses the distinction" and "every fixture
happens to be confirmed", and the probe refuses to claim it in that case
(*"only TIMED seen, so this run cannot show the two are distinguished. Not
evidence they are not."*). The Championship is what settles it. Both values
are real on this plan.

There is a second, smaller finding sitting in those numbers, and it is worth
stating with its uncertainty attached: **every Premier League kick-off this
season is currently confirmed, and roughly half the Championship's is not.**
So the provisional-kickoff gap is, today, an EFL-side gap rather than an FPL
one. Caveat: a `TIMED` fixture can still be moved by a later broadcast
selection, and this run cannot say whether football-data revises `status`
when that happens. Do not read `TIMED 380` as "no Premier League fixture will
move".

**(3) is not covered, and is declined on value.** football-data's `team`
route returns the club's home venue, which is not the same thing as a
per-fixture ground — a neutral or relocated fixture would still be
unrepresentable. Whether their match rows carry a venue field on our plan was
**not measured**, which is a gap in this survey rather than a finding. It was
ranked as the smallest of the four before any of this and nothing here
changed that; if it ever matters, `dev/probe-squad-nationality.mjs` is
cheap to extend.

**(4) was already answered, in the negative, and does not reopen.**
`api.football-data.org` supplies referees on the fixtures we use, so
Pulselive's `officials` would be a second source rather than a new
capability. And the referee panel itself was investigated and declined on 13
Aug 2026 — see `docs/scope-referee-source.md`. That decision stands.

## Why this is a decline and not a deferral

Because the reason to take the risk has gone. Pulselive is an undocumented
site API whose terms say nothing about third-party use, consumed by a site
with a paid tier — a question with real weight, which is why it was never
going to be settled by an exit code. `docs/data-sources.md` says it plainly:
*a 200 means reachable, it does not mean permitted.*

That question was worth asking while Pulselive held something we could not
get otherwise. It no longer does. Both things anyone actually wanted are
available from a source with published terms, a key we already hold, a proxy
already written, and an attribution string already going out on every
response.

Worth saying, since it would otherwise look like a double standard: the FPL
API we already depend on is in the same undocumented category. The difference
is not a rule, it is a judgement — FPL is an FPL companion consuming its own
users' data, near-universally tolerated; Pulselive is premierleague.com's
private backend and consuming it is a step further out. Reasonable people
could weigh that differently. This decision does not need them to, because
the trade is no longer worth making either way.

**SDP** (`sdp-prem-prod.premier-league-prod.pulselive.com`) is declined on the
same reasoning plus one of its own: its `/api/v2/matches` payload duplicates
what FPL already gives us. Direct CORS access to data we already have is not
an improvement, and it is the browser-callable one, which makes it tempting
for exactly the wrong reason.

**`/fixtures/{id}/textstream/EN`** is declined on scope. A match timeline is
real data and this is a planning tool, not a live-match tool.

## What would have to change to revisit

One of:

- football-data.org stops filling `nationality`, or drops the `team` route
  from the free tier. Cheap to re-check: run the **Premier League data
  sources** workflow and read the `squad` job.
- Something appears on Pulselive that football-data does not have and the app
  actually needs. That means a specific feature with a specific missing
  field, not "more data would be nice".
- The Premier League publishes terms permitting third-party use, or offers a
  feed we are invited to consume.

None of these is worth polling for. If any happens it will be noticed by
someone reading, not by a scheduled job — and the free tier is ~10 requests a
minute for the whole site, so a scheduled re-check would spend a real budget
to re-learn a settled fact.

## A note on how this was investigated

Three things went wrong, all the same way, and all caught by reading output
rather than by anything failing.

1. **I called a hang that was not one.** The first probe run sat at "in
   progress" for seven minutes and I reported it as hung and started fixing
   it. It had finished in 63 seconds; GitHub's jobs API was serving stale
   status. But the log printed no elapsed times and the probe had no fetch
   deadline, so slow and stuck genuinely were indistinguishable from outside —
   and an unresponsive host would have looked identical while running to the
   runner's six-hour limit. Both were fixed. The mistake was reporting a
   diagnosis with the confidence of a measurement.
2. **The Premier League's `TIMED 380` nearly became the finding.** Taken
   alone it would have been written up as "the distinction does not exist on
   our plan", which the data does not support. The probe was built to refuse
   that claim before the run, not after, and it did.
3. **`referees` is why this file exists at all.** That field is present in the
   v4 schema on all 552 Championship and 380 Premier League matches and
   populated on none of them. Had the same assumption been made about
   `nationality` — the docs list it, so we have it — this decision would have
   been made on a belief instead of a response.

The lesson that generalises is the one already written down in
`scope-referee-source.md`, and it applied twice more here: **when a check
finds nothing, the first question is whether it could have found anything.**

The probe and its harness are kept, unlike the referee probes, which were
deleted. The difference is that those existed only to enable a feature that
was not built, whereas this one checks a licensed source we actively depend
on, and its answer has an expiry date.
