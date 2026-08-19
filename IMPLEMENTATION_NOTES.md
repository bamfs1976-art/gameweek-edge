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
