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

## Guardian previews 17-18 — Newcastle and Forest (21 Aug 2026)

Captured in `docs/benchmarks/pl-guardian-previews-17-18.json`. These are the
two the 19-20 capture recorded as a gap, with the line *"if 17 is Newcastle,
it is the one preview that would speak directly to the largest open error in
our register."* It is Newcastle, and it does.

### SETTLED: the Newcastle manager line

Four sources now, and this one gives the successor a name, an age, a
nationality and a career: **Matthias Jaissle**, 38, German, ex-RB Salzburg and
Al-Ahli, never managed in England. Eddie Howe "stepped down". Our register
still says *"Eddie Howe continues"* in **both** editions and builds two
sentences on it, and the confirmed-new-bosses list names ten clubs while
omitting Newcastle.

**Still owed, not applied** — it adopts an outside claim, which is a register
edit. What makes it worse than a wrong name: our own front matter says *"New
managers reshuffle set-piece and penalty hierarchies, so early-season role
certainty is worth more points than usual."* It says that about ten clubs and
then treats Newcastle's dead-ball order as settled under a departed manager.

### APPLIED: a departed player was being recommended at the club he left

**Bruno Guimarães was named as Newcastle's captaincy alternative and placed on
their penalties, free-kicks and corners** — four lines below an Out list
recording his move to Arsenal. Our file records that move in four places and
then recommended him anyway; the transfer landed on 13 Aug and the picks under
it were never touched.

Applied rather than listed, and the distinction matters: this adopts nothing
from outside. Our own Out list already said he had gone, and the picks
contradicted it. Making a file agree with itself is not taking a source's word
for something. No replacement alternative was invented — Newcastle sold their
leading chance creators and naming a substitute would be worse than the hole.

**It had happened twice before.** The file already carried
*"Correction (11 Aug): this line previously named Digne on corners while the
same block listed him as sold to PSG"* and *"McNeil removed 13 Aug, he has gone
to Palace"*. Twice found by hand, twice fixed one player at a time, no check
written. So it recurred.

There is a check now: `departedStillPicked()` in `scripts/briefing-parse.mjs`.
No player in a club's **Out:** line may appear in that club's pick bullets
without a departure cue **in the same sentence**. Getting it right took four
corrections worth recording, because each one is a way a check can look like it
works:

1. A naive version reported **13 faults where there was one** — twelve were the
   file writing correctly about a departure ("with Salah gone", "stepping into
   Gordon's vacated role"). A report with twelve false positives gets ignored,
   and the thirteenth goes with it.
2. A character window let a cue about *other* players ("Newcastle have sold
   their leading chance creators") excuse a restored recommendation two
   sentences away. Proximity cannot tell whose departure is being discussed;
   a sentence boundary can.
3. Matching bare forenames flagged Anthony Elanga against departed Anthony
   Gordon, and Harry Wilson against departed Harry Gray. The picks abbreviate
   as "Bruno G", so the pattern is forename-plus-**initial**, which collides
   with neither.
4. The synthetic test fixture was called "Departed Playerson" — and *departed*
   is itself a cue word, so the fixture excused the very thing it was built to
   catch.

`CUE_WINDOW` was deleted rather than left exported: a mutation flipped it from
90 to 100000 and nothing changed, because nothing read it any more. A constant
no behaviour depends on is a decoration, not a safeguard.

### Two window-level conflicts, both open

- **Newcastle's goalkeeper.** The Guardian's star signing is **Lukas Hornicek**,
  £26m from Braga, "a genuine sweeper-keeper". Our register has **Ewen Jaouen**,
  ~£24m from Reims, and no Hornicek anywhere. Two keepers, two clubs, two fees.
  Both could be true; the preview calls Hornicek *the* signing of the window and
  never mentions Jaouen. Newcastle's starting keeper is a priced clean-sheet
  route, so this is not background. Settles on the bootstrap.
- **Forest's summer spend.** The Guardian: *"Ousmane Diomande is the only
  signing, at the time of writing, to have cost the club any money this summer,
  with £34m spent."* Ours: *"around £90m of incomings"* — Hutchinson ~£37.5m,
  McAtee ~£30m, Ndoye. One document is wrong about an entire window. The same
  preview says McAtee and Ndoye have already had a season at Forest, which
  would make our In list a year out of date — but a loan made permanent puts
  both readings partly right, so it is not asserted either way. Our own In list
  already carries *"(Some completion dates unverified, re-check.)"*, written
  before this source existed, about exactly the field this turns on.

### Register edits owed from this capture

- **The Newcastle manager line**, in both editions, plus the new-bosses list.
- **Ousmane Diomande** (£34m, Sporting, 22) — absent entirely, either way the
  Forest conflict resolves.
- **Tino Livramento** — a first-choice full-back who had surgery and "hopes to
  return in early autumn", and our file has never mentioned him. A silent gap
  is worse than a visible error: nothing in the app looks broken.
- **Lukas Hornicek**, pending the goalkeeper conflict.
- Smaller, all sourced: William Osula, Mason Miley, Ross Wilson (Newcastle);
  Dilane Bakwa, Ola Aina, Vítor Pereira, Lucas Bergvall (Forest).
- **Chris Wood**, a sharpening rather than an edit: two sources now say Forest
  are shopping for a striker to lead the line. Ours names Kalimuendo, theirs
  names Delap. Neither is signed; both are minutes risk on a £6.0m premium pick.

### Not a conflict

Our *"fifth manager in under 12 months"* against the Guardian's *"four permanent
managers in one campaign"*. Four during 2025-26 plus Glasner in July 2026 is
five in under twelve months. Both true, neither needs correcting — recorded
because a count differing by one is exactly what a checker files as an error
without reading the sentence around it.

Guards: 30 checks in `dev/test-challenge-picks.mjs` (473 → 504) and a new
section in `dev/test-briefing.mjs` (403 → 406). Mutation-tested 18/19 plus two
cue-list mutations run separately; the one miss was a badly-chosen mutant
removing an unused cue, which is how the dead `CUE_WINDOW` was found.

## Guardian previews 19-20 — Sunderland and Tottenham (21 Aug 2026)

Captured in `docs/benchmarks/pl-guardian-previews-19-20.json`, the last two of
the series. Previews 17 and 18 were never pasted and are recorded as a gap
rather than left to be inferred from the numbering — if 17 is Newcastle, it is
the one preview that would speak to the largest open error in our register.

**Closed: the Sam FPL "Robbo" pin — and it was ours to close all along.**
That capture left `Robbo, in 'Richa & Robbo should start for Spurs'` unresolved,
reasoning that reading it as Antonee Robinson "would manufacture a transfer out
of a nickname". The Guardian names Andy Robertson at Tottenham. So does our own
register, in three separate places, and it has throughout: the Spurs In list,
Liverpool's Out list, and a third line discussing his exit. The pin stayed open
because the search was for **Robinson** — the wrong surname — and a missing
Robinson was written up as ambiguity in the source. It was a failed lookup in
our own documents, reported as a limit of somebody else's.

The rule this adds: before recording a name as unresolvable, search for the
name it might be, not only the name first guessed. Corrected in the open in the
new capture rather than quietly patched in the old one.

**Strengthened, from an independent measurement:** our Sunderland regression
line. Our register reached it on 13 Aug from goals-versus-xG at both ends (42
scored against 38.89 xG, 48 conceded against 52.1 xGA). The Guardian reaches it
from Opta expected points — Sunderland would have been relegated on that metric
and finished 11 places above what xG implied, *the widest such margin in
Europe's big five leagues*. Different measurement, same finding, and theirs is
the stronger claim. No pick changes; holding the opposite just got dearer.

**Moved but not settled: Isidor vs Brobbey.** The Guardian's squad paragraph
frames the Sunderland attack around Brobbey and names Isidor once, for a Haiti
World Cup goal. That is a second outside source leaning Brobbey against our
register's "clear number nine after Mayenda" — 2-1 against our line, on
judgement not fact. Settles on the GW1 team sheet, not on another preview.

**Open, and not gradeable as stated:** the Guardian says "no key player has been
sold this summer"; our register says Sunderland lost breakout striker Mayenda
for ~£21.5m and calls replacing his goals the priority. *Key* is a judgement, so
this is filed as a disagreement rather than an error — and the preview's silence
about the sale is not read as a denial of it.

**Register edits owed from this capture:**

- **Guglielmo Vicario's departure.** Our register recommends Antonin Kinsky as
  a "cheap starting keeper enabler" while its own Spurs In list contains Martin
  Dubravka on a free — a veteran keeper is exactly what unseats a cheap
  enabler. The Guardian says Kinsky is first choice *because* Vicario left. Our
  own pick's justification is missing from our own file.
- **Cristian Romero has left Tottenham.** Absent from our Spurs Out list
  entirely; a first-choice centre-back leaving changes the shape of a defence
  we price Porro and van Hecke off.
- **Robin Roefs**, named among Sunderland's key men. We hold no Sunderland
  goalkeeper line at all, for a club whose defenders we price as home-fixture
  assets.
- Smaller, all sourced: Chris Rigg, Noah Sadiki, Tom Proctor (Sunderland);
  Djed Spence to Inter, Mikey Moore, Micky van de Ven, Savinho (Tottenham).
- **Trai Hume**, a tension rather than an edit: the Guardian lists him as one of
  three right-backs; our register says he has been used as a right winger in
  pre-season so Mukiele can overlap, and flags the clean-sheet cost. Both are
  risks and they are not the same risk. Our "unconfirmed for GW1" caveat now
  does more work than it was written to do.

**Watch:** Savinho and Omar Marmoush are *expected* to arrive at Spurs from
Manchester City. Not recorded as transfers — our register correctly still has
Marmoush in City's free-kick order. If both land, City's dead-ball hierarchy
loses an alternative and Spurs gain the striker this preview calls a glaring
absence, which would move our Spurs picks off Solanke.

Guards: 32 checks in `dev/test-challenge-picks.mjs` (473 total), mutation-tested
16/16 against both the capture's claims and the register's facts.

## Owed register edits — WORKED THROUGH (21 Aug 2026)

The list below this section had been accumulating since 18 Aug while the app
served the answers it describes. Applied on 21 Aug, highest harm first —
wrong answers before missing names:

| Edit | Was | Now |
|---|---|---|
| **Minteh** | Value pick, captaincy-adjacent option, on Brighton's right corner | All three withdrawn; out 2–3 months per the official round-up |
| **Lukic** | Taking half of Fulham's corners, in neither club's transfer list | Off the corners, on Ipswich's In list AND Fulham's Out list |
| **Newcastle manager** | "Eddie Howe continues", both editions, a paragraph built on it | Matthias Jaissle, both editions, and Newcastle added to the new-bosses list |
| **Mateta** | ~£7.5m estimate | £6.5m published — closes the eight-row table |
| **Igor Thiago** | ~£7.0–7.5m estimate | £8.0m published |
| **GW4 Manchester rows** | No GW4 row for either club | Derby added to both, reciprocal venues |
| **Egan** | "Did not travel, ankle — Doubt" | Cleared; started the final friendly |
| **Gelhardt** | Whole source-conflict flag | Presence closed; permanent-or-loan still open |
| **Kovacic** | No City central midfielder named at all | Named, with no invented price |
| **Vicario** | Absent, while our Kinsky pick rested on his exit | Recorded, with the Dubravka risk flagged beside it |

**Two things worth keeping from how it went.**

*The owed guards earned their keep.* Roughly twenty checks asserted each error
was still present, so each failed the moment it was fixed and none could be
half-done. Two attempts were caught mid-edit doing exactly that: a correction
note that quoted "Eddie Howe continues" verbatim, and an earlier commit that
slipped the successor's name into a set-piece aside while the manager line was
still owed. The briefing's own one-sided-transfer check then caught Lukic
being added to Ipswich's In list without reaching Fulham's Out list.

*A batch aborted halfway and nothing noticed.* The GW4/Egan/Gelhardt edits
went in as one script; it failed on a bad HTML anchor after the two GW4 rows
had been written, so Egan and Gelhardt were silently skipped. It surfaced only
because a later mutation run could not find an anchor to break — the missing
edit was invisible, the missing *guard* was not. Each of the four now has its
own assertion.

*A parser bug, not a document bug.* `departedStillPicked` treated punctuation
inside brackets as a sentence boundary, so "Mateta (£6.5m, published; our
estimate said ~£7.5m) is the pick if he stays" was cut between the name and
its cue and reported as a fault. The register was reworded twice to suit the
checker before it was clear the checker was wrong. It is bracket-aware now.

**Still open, and not applied:**

- **The 56 corroborated prices** the register does not hold. `npm run prices`
  lists them; they are additions rather than corrections, and adding fifty-six
  price lines by hand is a different kind of job from fixing ten wrong ones.
- **Two position changes** — Sessegnon MID→DEF, Dorgu DEF→MID. The register
  names neither player anywhere, so there is no line to correct; they belong
  with the price additions above.
- **Ipswich's In list holds three of ten arrivals.**
- Everything in the two conflict sections below, which need a source rather
  than an edit.
- The gaps from previews 17–20: **Diomande, Livramento, Hornicek, Romero,
  Roefs, Osula** and the smaller names. Livramento is the one that matters —
  an injured first-choice full-back our file has never mentioned.

Mutation-tested 17/17 against the applied edits: revert any one of them and
the suite goes red.

## Register edits owed, with a source attached (18 Aug 2026)

The official FPL Scout pre-season round-up (all 20 clubs, 172 stated prices)
is captured in `docs/benchmarks/pl-gw1-scout-official.json`. It is the game's
own publisher, so on prices and squads it settles rather than corroborates.
A benchmark must not edit the register, so these are listed rather than
applied. Each needs an edit to `docs/briefings/2026-27-preseason.md` and
`.html` citing the capture.

**Overdue — two sources, one of them official:**

- **Newcastle's manager is not Eddie Howe.** The register's confirmed-new-
  bosses list names ten clubs and omits Newcastle; the club block reads
  "Underwhelmed to twelfth, but Eddie Howe continues" and builds a paragraph
  on it. LazyFPL and the Daily Mail both said he had left; the official Scout
  names the successor — "the first under Jaissle". Three sources. The largest
  single error the eight captures have surfaced. Note that one passing clause
  establishes Howe is gone but is *not* enough to write a full manager line.
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
