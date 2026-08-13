# Scope — reading EFL referee appointments

**Status: scoped, not started. Nothing below is built.**
Evidence from `dev/probe-referees.mjs` and `dev/probe-efl-source.mjs`, run
against production from a GitHub runner on 13 August 2026.

The feature this serves: Fantasy EFL knows who is one booking from a
suspension and not who is refereeing them. A player on four yellows in front
of a strict official is a different risk from the same player in front of a
lenient one.

---

## What is established

| Question | Answer | Evidence |
|---|---|---|
| Are appointments published before kick-off? | Yes, **3–9 days ahead** | The 11 Aug article covers 14–20 Aug fixtures |
| Can football-data.org supply them? | **No, and never will on this plan** | `referees` key present on all 552 ELC + 380 PL matches, populated on **0**. Present-but-empty is a tier limit, not a schema gap |
| Is the EFL page reachable from CI? | Yes | HTTP 200, 145,861 bytes |
| Is the content embedded or fetched after load? | **Embedded** | Nuxt 2, `window.__NUXT__=`. "Referee" 51× in raw HTML vs 3× in visible text — the bulk sits inside the script payload |
| Structured data or HTML-in-JSON? | **Probably structured** | 0 escaped HTML tags (`<p>`, `<\/td>`) in the payload. Weak-positive, see unknowns |
| How is next week's article found? | **Solved — the sitemap** | `/sitemap.xml` → 200, 632KB, `referee-appointments` **168×** |

The sitemap finding is the one that changes the shape of this work. Slugs are
**not** guessable — compare `referee-appointments--14-20-august` with
`referee-appointments--24---28-april`; the dash patterns differ. A scheduled
job guessing slugs would have failed silently within weeks. Enumerating the
sitemap costs one fetch and fails loudly.

## What is still unknown

1. **The payload's actual shape.** "Not HTML-in-JSON" is not "here are the
   fields". Nobody has extracted a single referee-to-fixture pairing. This is
   the one unknown that can still change the estimate materially.
2. **Whether assistants are published.** `Assistant Referee` appears **0×**.
   Either the page names only the main official, or it words it differently.
   We only need the main official, so this is a nice-to-have, but it is
   currently an assumption.
3. **robots.txt was not actually read.** It returned 200 and 9 lines, and the
   probe's own extractor quoted **nothing** — so no `User-agent: *` group was
   matched and no `Sitemap:` line was found either. The "/news/ is not
   disallowed" line in that output is the absence of a matching rule, not a
   verified permission. **This must be read properly before any scheduled
   fetching**, and the probe's extractor needs fixing first — it has the same
   defect twice now, reporting a measurement of itself as a measurement of
   the site.
4. **Host inconsistency.** The sitemap emits `https://efl.com/...`; we fetched
   `https://www.efl.com/...`. Trivial, but it will bite a naive URL match.

---

## Component 1 — discovery

**Job:** given "today", return the URL of the appointments article covering
the coming week.

**Design.** Fetch `/sitemap.xml`, filter entries whose path contains
`referee-appointments`, parse the date from the path segment
(`/news/2026/august/11/`), take the most recent that is not in the future.
No slug construction anywhere — we only ever *recognise* URLs the site
itself published.

**Why not the alternatives.** `/rss`, `/news/rss` and `/feed` all return the
same 7,022 bytes with zero matches, which is the signature of a catch-all
page rather than three real feeds — no usable feed exists. `/news/` lists the
article but is a paginated HTML index that would need its own parser and
would drift off page 1 within days.

**Cost:** small. One fetch, an XML filter, a date parse.
**Failure mode:** the EFL renames the article type. Detected immediately —
zero matches in a 632KB sitemap is unmistakable, and the job should fail
loudly rather than serve stale appointments.

## Component 2 — the parser

**Job:** article URL → `[{ competition, home, away, kickoff, referee }]`.

**Design.** Extract the `window.__NUXT__=` assignment, evaluate it in a
sandbox exactly the way `scripts/chipplan-parts.mjs` and
`scripts/extract-engine.mjs` already evaluate extracted code in this
repository — that pattern is established here and tested. Walk the object for
the fixture list, map to the shape above.

**Cost: unknown until someone looks at the payload once.** Two outcomes:
- *Structured fields* (what the escaped-tag count suggests): a mapping
  function plus a fixture-name matcher. Small-to-medium.
- *A prose blob* the count missed: an HTML/text scrape with a shelf life, and
  I would recommend not building it. Medium, plus indefinite maintenance.

**The step I would take first, before committing to either:** one throwaway
run that dumps the payload's *shape* — top-level keys, the path to the
referee data, one sample record — to a CI log. An hour, and it converts the
main estimate risk into a fact. I have not done it because it means printing
part of a third party's payload into a public log, which is a judgement call
that is yours, not mine.

**Failure mode:** the CMS changes. Detected by asserting a sane row count and
that every row has a referee and two clubs; the extractor should fail loudly,
never return a partial week silently.

## Component 3 — joining to Fantasy EFL

Club names must match between the EFL's article and the Fantasy EFL feed.
This repo already has `clubMatcher` in `scripts/briefing-parse.mjs`, with an
alias table and a matcher that — after this week's fix — matches on whole
shared words rather than prefixes. It was written for the briefing, but this
is the same problem and it should be reused rather than re-solved.

**Cost:** small, and mostly tests. **Risk:** Championship clubs are outside
the alias table's current coverage, which was built for 20 Premier League
sides. Expect to extend it.

---

## What I would not build

- **No referee *strictness* model on day one.** Names alone are useful — a
  user can look up a referee. Cards-per-game by official is a second dataset
  with its own sourcing problem, and bundling it would make a small feature
  into a large one.
- **No Premier League version yet.** PGMOL appointments come from a different
  place, and the FPL app has no suspension feature to hang them on.
- **No caching layer beyond the existing proxy pattern.** Appointments change
  rarely; a daily job is enough.

## Decisions that are yours

1. **Is scheduled reading of efl.com acceptable to you?** Distinct from
   consuming an API, and unknown 3 above means nobody has yet checked what
   the site asks of automated clients. I would fix the robots.txt extractor
   and read it properly before anything else.
2. **May I print part of the payload's structure to a CI log** to settle the
   parser estimate? It is a third party's data in a public log.
3. **Names only, or names plus strictness?** The first is a modest feature
   that ships; the second is a project.

## Suggested order

1. Fix the robots.txt extractor and actually read it. *(blocking)*
2. Dump the payload shape once. *(blocking on decision 2)*
3. Discovery via sitemap, with a loud-failure test.
4. Parser, shape decided by step 2.
5. Club-name join, reusing `clubMatcher`.
6. Surface it on the suspension panel.

Steps 1 and 2 are the whole of what stands between this scope and a reliable
estimate. Everything after them is ordinary work.
