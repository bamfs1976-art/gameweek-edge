# Implementation Notes — audit follow-up (July 2026)

This branch implements the audit's critical fixes and feature upgrades
(see `AUDIT.md`). This file records what was **deliberately deferred**,
why, and what the operator must still do by hand.

## Operator actions required (cannot be done from the repo)

1. **Rotate the VAPID keypair.** The private key previously committed in
   `LAUNCH.md` must be treated as compromised. Run
   `npx web-push generate-vapid-keys`, set `VAPID_PUBLIC_KEY` /
   `VAPID_PRIVATE_KEY` in the Netlify environment, and redeploy. Existing
   push subscriptions were created against the old key and will stop
   working — users re-enable push from the Alerts panel. This needs
   Netlify env access, so it could not be done in this change.
2. **Run the new SQL** in the Supabase SQL editor:
   `supabase/gwedge_ai_usage.sql` (AI quota) and
   `supabase/gwedge_events.sql` (analytics). Both are idempotent and
   RLS-locked to the service role.
2b. ~~Run `supabase/gwedge_feedback.sql`~~ — **DONE**, applied to project
   `knodunjnsxelmpziupwk` as migration `create_gwedge_feedback` on
   16 Aug 2026. Verified after applying: 10 columns, RLS enabled, zero
   policies, zero grants to `anon`/`authenticated`, three indexes, zero rows.
   `has_table_privilege` confirms neither browser role can SELECT or INSERT
   and `service_role` can do both — the same posture as `gwedge_events`.
   Read it in the app at Studio → Feedback, or from the Supabase dashboard.

   NOTE: the table existing does NOT make the feature live. The button, the
   endpoints and the inbox panel are on `claude/fantasy-efl-companion-srui7c`
   and are not merged or deployed, so production has the storage but not yet
   the code.
3. **Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`** on Netlify if not
   already set — `/api/ai` now requires them to authenticate callers (it
   returns a 503 setup note until they exist).

## The fixture grid drops half of a double gameweek — fixed (19 Aug 2026)

**What it was.** `hydrateFixtures` built its per-club map with a plain
assignment, `(byTeamGw[f.team_h] = … )[f.event] = { … }`. A club playing twice
in one gameweek kept whichever fixture the API listed second and lost the
other with no marker anywhere — not in the cell, not in the run total, not in
the rotation pairs, the rotation chains, the opener planner or the chip-swing
card, all of which read the same map. Eight readers, one silent loss.

The source had known this for as long as the map existed. The comment above
`FX_VIEWS` gave it as one of the two reasons the Clean Sheet Matrix was kept
as a separate panel: *"it stacks BOTH fixtures of a double gameweek, where the
grid's per-team map keeps one fixture per gameweek and silently drops the
other."* It was written down and left standing.

**What changed.** Each gameweek collects its fixtures now and `fdrCombine()`
folds the list into the same cell shape the eight readers already expect, so
none of them needed rewriting. The rule is one sentence: **a cell's number
combines the way its own run total already combines.** Attack, defence and the
official FDR sum across gameweeks, so they sum within one; overall win odds
and Strength average across gameweeks, so they average within one — a
probability that summed would stop being a probability.

The **colour** is deliberately not the combined figure. It grades the
per-match means, so the cell answers "how hard are these opponents" and a
`×2` badge answers "how many games". Grading the sum would paint two awkward
fixtures green for no reason but their number, and would push the FPL lens off
its own 1–5 scale and out of the CSS classes that colour it. Two hard fixtures
in one week are still two hard fixtures.

Fixtures within a cell are ordered by **kickoff**, not by the order the API
listed them: "AVL + BRE" for a week played the other way round describes a
week that does not happen.

**What could have caught it.** Nothing did, for the same reason the bug
survived being written down: `dev/fixtures/fpl-mock-fixtures.json` contained
no double gameweek at all, so every check that could have looked for one had
nothing to find and would have passed by measuring itself. Fixture 81 (ARS v
AVL in GW4, on top of the fixtures both clubs already had that week) exists so
the guard has something to see.

**A second bug, found in a screenshot rather than by the suite.** The FPL lens
sanity-checks its rating against 1–5 and substitutes a neutral 3 outside that
range. That check is correct for one raw rating from the API and wrong for a
cell holding several of them summed: a double rated 2 and 4 sums to 6, fell
outside the range, and printed as **3** — in the cell and in the run total
alike. The wrong number, in exactly the cell the `×2` badge was drawing
attention to.

The unit suite passed throughout, because the case chosen to read nicely used
3 + 2 = 5 — the one sum that sits on the boundary and hides it. The bug was
visible in a screenshot of the FPL lens (Aston Villa reading 3 where the
fixtures say 6) and nowhere else. `fdrOfficial()` now validates against the
number of fixtures behind the cell — the legitimate range is n..5n — and both
suites carry cases above the single-fixture ceiling.

The same review found the strength edge keeping only the first fixture's
ratio, which is the original bug one field further down. It averages now.

## Fixture grid: My squad rows (19 Aug 2026)

The same grid, one row per player instead of one per club, with price and name
in front of the strip — the layout people share as a "fixture ticker".

It is a row source on the existing grid rather than a new panel, so it reuses
the window control, the five lenses, the purple-patch underline and the
per-club map unchanged; a player's fixtures are his club's fixtures. The picks
payload it needs was already being fetched for the "My teams" chip and thrown
away afterwards, so it costs no new request.

Two rules that are not obvious from the screenshot it came from:

* **Club rows re-rank easiest-first; squad rows stay in squad order.** A
  manager reading the league wants it sorted. A manager reading their own team
  wants to recognise it — the XI in formation order, then the bench, with one
  divider where the bench starts.
* **The club filter is withdrawn in squad mode.** Hiding clubs would silently
  drop players from a table headed "My squad", which is a filter that edits
  your own team.

It never opens on the squad, and the toggle is offered only when a team is
linked: a control that switches to an empty table is worse than no control.

Guards: `dev/test-fixture-ticker.mjs` (86 checks, in `npm test`) for the
combination and ordering rules as arithmetic; `dev/test-ui.mjs` (48 -> 83
assertions, outside `npm test` — needs Chromium) for whether any of it reaches
the screen. Both mutation-tested; the mutation runs found two holes in the
guards themselves — nothing asserted the ORDER of a double's two fixtures, and
the squad page always had a squad so nothing checked that the toggle stays
away when there is not one.

## Register edits owed, with a source attached (18 Aug 2026)

The official FPL Scout pre-season round-up (all 20 clubs, 172 stated prices)
is captured in `docs/benchmarks/pl-gw1-scout-official.json`. It is the game's
own publisher, so on prices and squads it settles rather than corroborates.
A benchmark must not edit the register, so these are listed rather than
applied. Each needs an edit to `docs/briefings/2026-27-preseason.md` and
`.html` citing the capture.

**Overdue — two sources, one of them official:**

- ~~**Newcastle's manager is not Eddie Howe.**~~ **WRITTEN 20 Aug.** The
  register's confirmed-new-bosses list named ten clubs and omitted Newcastle;
  the club block read "Underwhelmed to twelfth, but Eddie Howe continues" and
  built a paragraph on it. LazyFPL and the Daily Mail both said he had left;
  the official Scout named the successor — "the first under Jaissle" — but one
  passing clause is not a manager line, which is why this sat unwritten for two
  weeks as the largest single error the captures had surfaced.
  The Guardian's season preview (Louise Taylor, 20 Aug) is the fourth source
  and the first to carry the successor, the tenure and the style together, so
  the line is now written: Howe stepped down after almost five years, Matthias
  Jaissle is head coach, and Newcastle is in the new-bosses list. The block says
  in its own text that it had this wrong for a fortnight, and the two tests that
  used to assert "Eddie Howe continues" now assert the opposite — a test that
  demanded the old error would have kept it alive.
- **Sasa Lukic still takes Fulham's corners.** He joined Ipswich from Fulham
  (Guardian, then the official Scout, which prices him as an Ipswich player).
  Our register names him in neither club's transfer list and still assigns him
  half of Fulham's set pieces — a wrong answer the app will serve.

**Price rows the official source closes:**

- **Mateta £6.5m** — the last open row of the briefing's eight-row table. It
  now reads: the outside figure right 8 from 8, our estimate right 0 from 8.
- **Igor Thiago £8.0m** — closes the row opened by the fpltips capture
  against our ~£7.0–7.5m est.
- **56 corroborated prices the register does not hold at all**, every one now
  with the official source behind it. `npm run prices` lists them.
- Wider scoreboard: of the estimates an outside source has now priced, ours is
  **right 14, wrong 3**. The tabulated eight were wrong precisely because they
  were the rows where somebody had already published a figure — which is what
  the briefing already said.

**The GW4 Manchester rows (19 Aug):** our register holds no GW4 row for
either Manchester club. Four sources now say it is a Manchester derby and
three say the venue is Old Trafford — and the newest, FPL Mate's expert-draft
grid, is the first that is a **structured fixture grid** rather than prose:
Man Utd GW4 `MCI (H)`, Man City GW4 `MUN (A)`, reciprocally consistent, in a
grid whose other 30 cells all agree with our register. Adding the two rows is
now the best-supported outstanding edit.

**Smaller, all sourced:**

- John Egan's ankle doubt can come off; he started the final friendly.
- Two FPL position changes: Ryan Sessegnon MID→DEF, Patrick Dorgu DEF→MID.
- Yankuba Minteh is reported out two to three months. **Our register lists him
  as a value pick and a captaincy-adjacent option.**
- Joe Gelhardt's Hull presence can come off the source-conflict flag; the
  loan-or-permanent half stays, as does Garnacho's origin.
- Ipswich's In list holds three of ten arrivals.
- No line for **Mateo Kovacic**, who started the Community Shield in
  Manchester City's midfield — our own capture records the XI.

## Open conflicts in the register, waiting on a source (18 Aug 2026)

> **Closed 18 Aug: Jack Butland.** Our register said "12 weeks, arm surgery";
> the Guardian said "out until Christmas"; the official Scout says "at least
> three months", which is twelve weeks. Our register was right and the
> Guardian is the outlier of three. Recorded because every other item this
> fortnight went the other way, and reporting only the losses would be a
> biased sample.

> **Closed 19 Aug: the Sunderland GW4 venue.** The note asking whether
> Sunderland's GW4 is home or away against Arsenal was never a source
> conflict. Hadley said "Arsenal away"; our register says "Sunderland,
> Arsenal (H)". Those are the same fixture stated from opposite ends, and
> FPL Mate's grid confirms it as Arsenal `SUN (A)`. The open question was
> our own confusion.

> **Superseded 18 Aug:** the Newcastle manager conflict, the Mateta price row
> and the corroborated-prices list have all moved to the section above, where
> the official source settles them. What follows is what is still genuinely
> open.

- **Which goalkeeper did Newcastle sign?** Our register holds **Ewen Jaouen
  (GK, Reims, ~£24m)**; the Guardian's preview makes **Lukas Hornicek, 24,
  Czech Republic, ~£26m from Braga** its star signing and does not mention
  Jaouen. Similar fee, similar age, different name and different selling club.
  Either they bought two keepers or one entry is wrong. Nothing on hand settles
  it and neither was swapped for the other. Resolves on the FPL bootstrap, which
  will price whichever of them exists.
- **Which summer do Forest's midfield arrivals belong to?** The register lists
  Hutchinson, McAtee and Ndoye as 2026 incomings. The Guardian's Forest preview
  describes McAtee's "first season in Nottingham" as already behind him and a
  "difficult first year" for Ndoye, which reads as 2025 business. It also names
  **Ousmane Diomande (DEF, Sporting, ~£34m)** as the only signing to have cost
  Forest a fee this summer, and the register does not hold him at all. The
  missing signing is recorded as owed; the window each of the other three
  belongs to is open.
- **Newcastle's creative supply is unmodelled.** The Guardian's stat attack:
  Newcastle lost their leading four chance creators in one window — Guimaraes,
  Tonali, Gordon, Trippier. The register's set-piece line for the club is now
  deliberately short of a free-kick and corner taker rather than carrying a
  guess. Resolves on GW1–3 team sheets.
- **Tino Livramento's return date.** The Guardian has him back from "minor"
  surgery in "early autumn" after a calf injury in England training. He is
  priced and projected in the Marcello sheet captured beside this file at 14.2
  over GW1–5, which is a projection for a player who may not feature in the
  window. Not corrected on either side; flagged so the comparison is read with
  it in mind.
- **Rodri: in the league or not?** The official Scout (18 Aug) prices him at
  **£6.5m as a Manchester City player** and calls the Barcelona move "heavily
  linked"; the Guardian's City preview (19 Aug) states three times that he has
  **departed** for Barcelona. A player who has left cannot be priced in the
  game, so one of the two is describing a squad that does not exist. **Our
  register mentions Rodri nowhere at all** — a gap regardless of who is right.
  His absence from the Community Shield XI settles nothing: the official
  source says he has had back surgery, which explains it equally well. Resolves
  on the FPL bootstrap — he is either in the game or he is not.
- **Grealish's club.** Our register carries "Rumours only: ... a possible
  Grealish loan". FPL_Marcello's sheet lists him at Everton, £6.5m — but that
  sheet's Team column is demonstrably stale elsewhere (it still has Lukic at
  Fulham), the official Scout's Everton section does not mention him, and no
  other capture carries him. One unreliable column is not a transfer.
- **Thiaw's appearance base.** Hadley's DEFCON table says 33 starts at a 36%
  hit rate; the Daily Mail says 12 hits from 28 appearances. Both put him on
  twelve hits and only the denominator differs, and 33 starts from 28
  appearances is impossible. Needs a season appearance record, which is not
  reachable from this sandbox.
- **The Arsenal defensive discount.** Our register says discount every Arsenal
  defensive asset until Saliba's replacement is signed; BigManBakar and Sam FPL
  both say the opposite. The official Scout confirms the premises — Saliba out
  for "an extended period", Timber out for "weeks", Konsa still at Villa — and
  takes no side on the conclusion. Settles on Arsenal's GW1–6 clean sheets.
- **Whether Isidor or Brobbey leads the Sunderland line.** The official Scout's
  Sunderland section names Brobbey and does not mention Isidor at all. That is
  an omission, not a statement, and the register's disagreement stays open.

## Two congestion measures, one calendar (20 Aug 2026)

The repo had **two notions of congestion fed by two different calendars**, and
they disagreed on the case that matters most.

| Scenario | `congestionLoad` / factor | rotation: days / bucket / band |
|---|---|---|
| **Midweek *league* game (Wed→Sun)** | **0.00 / 1.000** | **3 / congested / raised** |
| Europa away (Thu→Sun) | 1.00 / 0.851 | 2 / congested / high |
| Normal week (7 days) | 0.00 / 1.000 | 7 / fresh / settled |
| Cup tie 5 days out | 0.41 / 0.939 | 4 / normal / normal |
| **Cup tie + league midweek** | **0.41 / 0.939** | **2 / congested / raised** |

`/api/euro-fixtures` deliberately excludes the Premier League, so
`congestionLoad` is **structurally blind to midweek league football** — the most
common congestion in FPL (rearranged rounds, double gameweeks). Rows 1 and 5 are
that blindness.

**What was done.** The *data* was converged, not the models. `competitiveCalendar()`
is now the single place league, cup and European football are merged, normalised
to one comp vocabulary, de-duplicated and tagged with provenance (`league`,
`src: fpl|euro|vendor`). `rotationEntries()` is a thin view over it.
`congestionLoad` was **not touched** — the backtest is byte-identical to before.

**Why not converge the models.** The rotation model is a team-level count of
*changes to the eleven*. It is not calibrated as a per-player minutes multiplier,
and `congestionLoad` is a graded term in the points path. Sharing coefficients
between them would be a category error and would silently un-test a backtested
model. `scripts/check-rotation.mjs` fails the build if the shared calendar or the
rotation model reaches the extracted engine.

**`restProvisional`.** The league fixture list is published in June, so from GW2
rest is always computable — meaning the season-long failure is *not* the
opening-weekend `known:false`. It is **false-fresh**: a club reads "settled"
because the cup tie that will land in that midweek has not been drawn yet. Past
`calendarHorizon()` a club can only look *more* rested than it turns out to be,
never less, so those rows are now badged `provisional` with the reason. Two feeds
of it: undrawn cup/European rounds, and PL fixtures with `kickoff_time: null`.

### Open — the measurement this deliberately did not make

Including the Premier League in `congestionLoad`'s input is probably correct and
was **not** adopted, because it changes every projection.

The endpoint's stated reason for the exclusion — that counting league fixtures
"would make every club permanently congested" — does not hold under the current
constants: a normal Sat→Sat gap is 7.0 days, past `CONGEST_FADE = 6`, and
contributes zero load. Only genuine sub-6-day gaps would count, which is the
intent. But Fri→Mon and Sun→Sat gaps from TV picks are common enough that the
frequency needs measuring rather than assuming.

**To close it:** feed the non-league *and* league slices of `competitiveCalendar`
into `congestionLoad`, re-grade through `dev/backtest-vaastav.mjs` and
`dev/model-validate.mjs`, and adopt only if minutes prediction improves. Until
then `check-rotation.mjs` asserts the exclusion is still documented in
`netlify/functions/euro-fixtures.js`, so the question cannot be silently closed
in either direction.

## Deferred (documented, not attempted)

- ~~An in-app inbox for feedback.~~ **Done** — Studio → Feedback, backed by
  `/api/feedback-inbox`. Owner-gated server-side with the same token-verify +
  allowlist gate as `/api/analytics`; `window.GE_OWNER` only hides the panel.
  The inbox returns the message, kind, panel, client hint and reply-to email,
  and deliberately withholds `anon_id` and the raw user agent so it cannot be
  used to follow one person's session around the app.
- **Server-side rate limiting on `/api/feedback`.** Netlify Functions are
  stateless, so the current protection is size caps and a client-side guard
  against double-sends — neither of which stops a determined scripted flood.
  Worth adding a per-IP or per-anon-id counter if it is ever abused; stated
  plainly rather than implied to be handled.
- **Replying from inside the app.** The inbox links a reply-to address as a
  `mailto:`, which hands off to the mail client. Sending from the app would
  need an email provider and an API key, which this project does not have and
  did not add.
- **Marking feedback as read or actioned.** The table is insert-only and the
  panel is a view over it; there is no state to track triage. Adding one means
  a writable column and an authenticated write path, which is a larger change
  than collating what is already there.

- **Git-history purge of the leaked key.** Rewriting history
  (`git filter-repo` / BFG) invalidates every clone and needs a
  coordinated force-push by the repo owner. Rotation makes the old key
  useless, which is the security-relevant step; purge remains optional
  hygiene the owner can do at leisure.
- **RevenueCat / Apple in-app purchase.** Apple requires IAP for digital
  subscriptions in the App Store build; the Stripe web flow stays for the
  PWA. Needs an Apple Developer account, App Store Connect products and
  a RevenueCat (or StoreKit 2) integration with Stripe↔IAP entitlement
  reconciliation in `gwedge_profiles` — a project of its own
  (see `MOBILE_APP_BRIEF.md`).
- **True live rank.** Impossible without the full FPL population's live
  scores, which no public API exposes (LiveFPL samples the population at
  scale server-side). The panel is now honestly framed as **Live
  Percentile**, a normal-approximation estimate.
- **Splitting the single-file monolith.** `index.html` (~5.7k lines) is a
  deliberate architectural choice documented throughout the repo. A
  build-step split (modules + bundler) should be its own change with the
  smoke suite run before/after — not piggybacked onto a feature branch.

## Follow-ups worth considering (out of audit scope)

- `checkout.js` / `portal.js` accept a client-supplied `userId` without
  verifying the Supabase token (portal only resolves an existing Stripe
  customer id; checkout only tags the session). Low risk since user ids
  are unguessable UUIDs, but they should adopt the same
  `Authorization: Bearer` verification `ai.js` now uses.
- The multi-week solver approximates selling prices as current price
  (stated in-panel). Exact selling prices need authenticated
  `my-team/{id}` access, which the public proxy deliberately avoids.
