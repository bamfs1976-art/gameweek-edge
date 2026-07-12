# Gameweek Edge — App Audit & Enhancement Recommendations

*Audit date: 2026-07-12. Read-only audit, benchmarked against the category leaders: LiveFPL
(live rank / EO), FPL Review (multi-week MILP transfer solver, chip EV), Fantasy Football Fix
(price-change prediction, squad optimisation), Fantasy Football Scout (team news / predicted
lineups), and the official FPL app.*

## Verdict

This is the most ambitious of the three apps and much of it is genuinely competitive: a
validated Dixon-Coles/xP model with stated walk-forward numbers, 29 wired panels, real Stripe
billing, Web Push, an iOS Live Activity, and excellent operational docs (LAUNCH.md,
QA_CHECKLIST.md). But it has **two revenue-critical security holes** and a handful of Pro
features that under-deliver against the specific competitor whose feature they borrow. Fixing
the paywall and measurement gaps matters more right now than any new feature.

## Critical findings (fix before growth)

1. **`/api/ai` is unauthenticated and unmetered.** `netlify/functions/ai.js` performs no auth
   or tier check — any anonymous caller can POST and spend the Anthropic budget. Combined
   with (2), the paywall is cosmetic.
2. **Pro tier is client-side bypassable.** Tier is a `localStorage` flag
   (`ge-tier`), with an explicit `setProPreview(true)` unlock documented in
   `docs/FEATURES.md`. Server functions never verify tier. Fix: verify the Supabase JWT in
   `ai.js` (and any Pro-only function), read tier from `gwedge_profiles` server-side,
   rate-limit per user.
3. **A live VAPID private push key is committed in `LAUNCH.md`.** Rotate it, purge it from
   git history, and move it to Netlify env only.
4. **No security headers / CSP** in `netlify.toml`, while 36 renderers build DOM via
   `innerHTML` string concatenation with manual (not enforced) `esc()` usage.
5. **No analytics at all** (no gtag/plausible/posthog in app or landing page). Install,
   activation (team-linked), and Pro conversion are currently unmeasurable — the biggest
   growth blocker.

## Feature gaps vs the category leaders

| Feature | Category leader | Gameweek Edge today |
|---|---|---|
| Live overall rank | LiveFPL: true rank from full population | Normal-approximation percentile (`sd≈18`) sold as "Live Rank" — most likely Pro disappointment |
| Price-change prediction | Fix / FPL Statistics: threshold model, "% to rise tonight" | Net-transfer momentum only |
| Transfer solver | FPL Review: multi-week MILP, sale-price aware | Greedy 1-GW heuristic; assumes sale value = current price (overstates budget) |
| Authenticated my-team | Official app: exact selling prices, FTs, ITB | Public endpoints only |
| Predicted lineups / team news | Scout / Fix: core daily-retention feature | Entirely absent |
| Chip strategy | FPL Review: chip EV across fixture runs | Heuristic + Claude prose only |
| EO / template (top-10k) | LiveFPL | Admitted approximation |
| iOS distribution | Store apps with IAP | Capacitor scaffold, no IAP (Apple blocks Stripe-web for digital subs), manual Xcode wiring, no privacy-policy URL |

Other engineering notes: `push-live.js` runs every 2 minutes and fans out one FPL
`entry/{id}/picks` fetch per linked manager (will rate-limit at scale); `ai.js` truncates
context with `.slice(0, 9000)` which can cut JSON mid-token; zero unit tests/CI for the
validated model core; `README.md` says "21 panels" while `docs/FEATURES.md` documents 29;
landing page ships placeholder domain `gameweekedge.app` in OG/canonical tags.

## Top 10 recommendations (ranked by impact)

1. **Gate and meter `/api/ai` server-side; make tier verification server-side everywhere.**
   Biggest cost leak and revenue leak at once.
2. **Rotate the committed VAPID private key** and scrub git history.
3. **Add privacy-friendly analytics** (Plausible/PostHog) to app + landing before any launch
   push — otherwise no decision can be measured.
4. **Fix or reframe "Live Rank".** Either compute a real live rank or rename it
   ("Live percentile") — selling an estimate as the category's flagship metric invites churn.
5. **Add CSP + security headers** and audit `innerHTML` sinks.
6. **Build a real price-change probability model** — table stakes vs Fix/LiveFPL and the most
   shareable/viral feature class in FPL tools.
7. **Multi-week transfer optimiser + authenticated my-team** (exact selling prices, FT count)
   so the solver stops assuming sale = current price.
8. **Predicted lineups / team-news feed** — the most-used missing feature; drives daily
   retention more than model refinement.
9. **Finish the App Store path**: IAP via RevenueCat with Stripe↔IAP entitlement
   reconciliation, privacy-policy URL, automate the Live Activity target setup.
10. **Tests + CI**: unit tests for `plsimMatch`/`nativeXP`/`solvePlan`, run `dev/smoke.mjs`
    in CI, and start splitting the 332 KB monolith.

Quick wins: cap `push-live` fan-out; fix `ai.js` JSON truncation; reconcile the 21-vs-29
panel docs; replace the landing-page placeholder domain.

## Strengths worth keeping

Allowlisted FPL proxy (no SSRF), server-side-only tier setting via signature-verified Stripe
webhook, graceful 503 degradation on every unconfigured function, reduced-motion guards,
skeleton/empty/error states, the iOS Live Activity (a real differentiator once shippable),
and the honest model-validation write-up in `docs/FEATURES.md`.
