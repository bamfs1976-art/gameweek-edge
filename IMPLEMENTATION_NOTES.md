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
2b. **Run `supabase/gwedge_feedback.sql`** — the in-app feedback button
   writes here. Until it exists the button is live but every send fails:
   `/api/feedback` returns 503 and the app tells the user their message was
   NOT saved, keeps their text on screen and offers to copy it out. That is
   deliberate — a feedback form that silently swallows messages is worse
   than none — but it does mean the feature is inert until the SQL is run.
   Read the feedback from the Supabase dashboard; there is no in-app inbox
   yet (see Deferred).
3. **Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`** on Netlify if not
   already set — `/api/ai` now requires them to authenticate callers (it
   returns a 503 setup note until they exist).

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
