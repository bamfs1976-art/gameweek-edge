# Gameweek Edge — Mobile App Build Prompt (for Claude Code)

This document is the master brief for turning the existing Gameweek Edge web app into native mobile apps for iOS and Android. Read it fully before starting any work. It builds directly on `CLAUDE_CODE_BRIEF.md` and assumes the web app described there exists and works. Do not start a later phase until the user confirms the current one is approved.

Use this as the prompt: hand it to Claude Code, confirm the plan, then build Phase M1 only.

---

## 1. What we are building and why

Gameweek Edge is the calm, clear companion that gives serious Fantasy Premier League managers a measurable edge. It already exists as a responsive web app (`index.html`) with a full brand, a 6-area / 21-panel navigation model, light and dark themes, a free tier and a paid "Pro" tier, live FPL data via a Netlify proxy, Supabase accounts and Stripe billing.

The goal of this work is to ship Gameweek Edge as a real, store-listed mobile app on the **Apple App Store** and **Google Play Store**, without throwing away the web build. Managers live on their phones on matchday. The app must feel native — fast, gesture-friendly, with push notifications for price changes, deadlines and live events — while reusing the design system and backend we already have.

The same commercial rules apply. Do not use "FPL" or "Premier League" in the brand or app name. "Gameweek Edge" is the brand. "FPL" may only appear descriptively in body copy, for example "the smart companion for Fantasy Premier League managers".

---

## 2. Chosen approach — Capacitor wrap

We are wrapping the existing web app in a native shell using **Capacitor** (by Ionic). This reuses the entire design system, the FPL Netlify proxy, Supabase auth and almost all of the existing code, and gives us native iOS and Android binaries plus access to native device APIs (push, haptics, biometrics, secure storage, deep links).

Rationale: the web app is already a polished, single-file, vanilla-JS product with a complete design token system and accessibility baseline. A React Native rewrite would discard that. Capacitor is the fastest credible route to both stores while keeping one codebase as the source of truth.

**Source of truth stays the web app.** The mobile app loads the same UI. We add a thin native layer for the things a browser cannot do, and we adapt the UX so it reads as an app, not a website in a box.

If, after launch, the user wants a fully native rebuild, this brief includes a note on the migration path. Do not start that without an explicit instruction.

---

## 3. The one rule that changes the business model: in-app billing

This is the most important constraint in the whole brief. Get it wrong and the app gets rejected.

- Apple and Google require that **digital subscriptions sold inside the app use their own in-app purchase (IAP) systems** — StoreKit on iOS, Google Play Billing on Android. You generally **cannot** charge for Pro inside the app using Stripe.
- Both stores take a platform fee (commonly up to 30%, often 15% for subscriptions after year one or under small-business programmes). Pricing must account for this.
- Practical model: keep **Stripe for web** sign-ups, add **native IAP for in-app** upgrades, and unify them server-side so a user's `tier` is correct regardless of where they paid.
- Do not show external "buy on our website" links or pricing inside the iOS app unless using an approved entitlement — Apple restricts steering. Keep the in-app upgrade path clean and IAP-only on iOS.
- Recommended tool: **RevenueCat** to manage IAP across both stores and reconcile entitlements with Supabase, rather than hand-rolling StoreKit and Play Billing.

Confirm the pricing and the IAP plan with the user before building Phase M4. Do not assume the store cut is absorbed or passed on.

---

## 4. Non-negotiable standards

These extend, and do not replace, the standards in `CLAUDE_CODE_BRIEF.md`. Apply them to every commit.

### Code and stack
- Capacitor wrapping the existing web app. Keep vanilla JavaScript; do not introduce a heavy framework just to go mobile.
- One source of truth for UI. Mobile-specific behaviour lives behind capability checks (e.g. "is this running in the native shell?"), not in a forked copy of the app.
- All FPL data continues to route through the Netlify serverless proxy. No direct FPL API calls from the device. No secrets, keys or tokens in client code or in the app bundle.
- Native plugins only where they earn their place: Push Notifications, Haptics, Status Bar, Splash Screen, Preferences/Secure Storage, App (deep links / lifecycle), and the IAP layer.
- Complete, working code only. No stubs. The app must build to a real `.ipa` and `.aab`.

### Mobile UX — make it feel native
- Respect safe areas (notch, Dynamic Island, home indicator, Android gesture bar) using `env(safe-area-inset-*)`. Nothing under a notch or behind the home bar.
- The existing mobile bottom nav becomes the primary native-style tab bar. Tap targets minimum 44×44px (iOS) / 48×48dp (Android).
- Add momentum scrolling, pull-to-refresh on live panels, and skeleton loaders for the slow matchday API. No dead taps, no flashes of unstyled content.
- Haptic feedback on key actions (confirming a transfer plan, setting a captain, saving to watchlist).
- Native splash screen and app icon in the Gameweek Edge brand. Hide the splash only when the first meaningful paint is ready.
- Disable browser-isms: no text-selection on chrome, no long-press callout menus, no rubber-band overscroll where it looks broken, no pinch-zoom on the app shell.
- Dark and light themes both fully working, and the native status bar / nav bar colours must follow the theme.

### Accessibility — WCAG 2.2 AA, mandatory
- Carry over every accessibility guarantee from the web app: contrast, full focus states, ARIA roles and live regions, no colour-only meaning.
- Honour OS-level settings: Dynamic Type / font scaling, reduced motion, increased contrast, and VoiceOver / TalkBack. Live-updating panels announce politely.
- Test with a screen reader on at least one real device per platform before any phase is called done.

### Performance
- Fast cold start. Pre-bundle assets in the app; do not fetch the UI shell over the network at launch.
- Cache slow-changing bootstrap data on-device and refresh at least daily. Live matchday data is never cached.
- Be frugal on matchday: debounce polling, back off when the API is slow, and never hammer the proxy.

### Security
- Input validation on every input, especially the Manager ID field.
- Auth tokens in secure storage (Keychain / Keystone via a secure storage plugin), never in plain `localStorage` on device.
- Row Level Security on all Supabase tables. The `tier` is only ever set server-side, now including via verified IAP receipts.
- Content Security Policy and HTTPS for all remote calls. Pin nothing that would break the Netlify proxy, but verify all origins.

### Git workflow
- `main` holds the current stable build. Each phase is developed on its own branch from `main`, for example `mobile-m1-shell`.
- Small, logical commits with clear messages. Do not merge to `main` until the user approves the phase. Never force-push to `main`.
- Keep web and mobile buildable from the same repo. Document any new build commands in the README.

---

## 5. Build phases

Build in order. Stop at the end of each phase and wait for the user to approve before continuing. These phases assume the web app is at least at its Phase 3 (accounts) state from the original brief.

### PHASE M1 — Native shell and first run

Goal: the existing web app runs as a real native app on both platforms, looking and feeling like an app, with nothing functional lost.

Tasks:
1. Add Capacitor to the repo. Create the iOS and Android projects. Point the Capacitor web directory at the existing app build.
2. Configure app identity: app name "Gameweek Edge", bundle/package IDs, version, brand app icon and native splash screen in light and dark.
3. Implement safe-area handling across the whole app. Verify on a notched iPhone and a gesture-nav Android device (or emulators).
4. Convert the mobile bottom nav into the primary native-feeling tab bar. Make the native status bar and navigation bar follow the active theme.
5. Apply the mobile UX polish list in section 4: pull-to-refresh on live panels, disable unwanted browser gestures, momentum scroll, haptics on key actions.
6. Confirm the app builds to a runnable `.ipa` and `.aab` and launches to the dashboard.

Deliverable: installable debug builds for iOS and Android on a `mobile-m1-shell` branch, plus short run instructions.

### PHASE M2 — Native data, offline and push

Goal: the app behaves well on a flaky phone connection on matchday, and can notify managers.

Tasks:
1. On-device caching of bootstrap data with sensible refresh; graceful offline state with a clear "you're offline" treatment. Live data never served stale without a label.
2. Background-friendly refresh of personalised panels when the app returns to foreground.
3. Push notifications via the native push plugin: register the device, store the token against the user (RLS-protected), and wire a server-side sender through Supabase/Netlify.
4. Notification types, all opt-in and toggleable in settings: price-change risk, deadline reminders, and (Pro) live events for the user's players. No spam, no marketing pushes without consent.
5. Deep links so a notification opens the exact relevant panel.

Deliverable: working offline behaviour and push on a `mobile-m2-data-push` branch. The user provides Apple Push (APNs) and Firebase (FCM) credentials when this phase needs them.

### PHASE M3 — Native account experience

Goal: sign-in and account management feel native and secure.

Tasks:
1. Supabase auth wired through the native shell. Tokens in secure device storage, not plain local storage.
2. Optional biometric unlock (Face ID / Touch ID / Android biometrics) to re-open a signed-in session.
3. Sign in with Apple **and** Sign in with Google — Apple requires Sign in with Apple if any third-party social login is offered.
4. Account screen: Manager ID, watchlist, preferences and notification toggles, all syncing to the account as on web.
5. Signed-out users get the same limited free experience as on web.

Deliverable: native account flow on a `mobile-m3-accounts` branch. Supabase and OAuth provider details to be supplied by the user.

### PHASE M4 — In-app purchases and the Pro paywall

Goal: managers can upgrade to Pro inside the app, compliantly, and entitlements are correct everywhere.

Tasks:
1. Implement IAP via RevenueCat (recommended) or native StoreKit + Play Billing. Offer a monthly subscription and a season pass, matching the web Pro offering.
2. Create the products in App Store Connect and Google Play Console. Confirm pricing with the user first, accounting for the store fee.
3. On purchase, verify the receipt server-side and set the user's `tier` to `pro` in Supabase. Never trust the client. Reconcile so a user who paid on web (Stripe) is also Pro in the app, and vice versa.
4. Gate every Pro panel with the same rule as web: locked panels still show their value and a clear upgrade prompt, never a blank wall. On iOS the upgrade path is IAP-only with no external steering.
5. Handle the subscription lifecycle: active, in grace period, cancelled, expired, billing retry, refund. Restore Purchases must work.

Deliverable: working in-app Pro upgrade with correct entitlements on a `mobile-m4-iap` branch.

### PHASE M5 — Store readiness and launch

Goal: pass review and ship.

Tasks:
1. Full accessibility audit on real devices with VoiceOver and TalkBack. Fix every failure.
2. Performance and battery pass, especially matchday polling.
3. Store assets: icon, screenshots for required device sizes, preview text, age rating, and a privacy policy and privacy "nutrition label" / Data Safety form. Position clearly as a **sports analytics tool, not gambling**. A plain-language privacy policy now ships at **`/privacy.html`** — App Store Connect requires this URL in the app's metadata (App Information → Privacy Policy URL), so point it at `https://<your-domain>/privacy.html`.
4. App Store and Play Store metadata and review notes. Provide a reviewer test account and a test Manager ID.
5. Submit to TestFlight / Play internal testing first, then production. Document the release process so updates are repeatable.

Deliverable: submitted builds and a release runbook, merged to `main` after approval.

---

## 6. How to work with the user

- At the start of each phase, restate what you will build and ask any open questions before writing code.
- Do not assume credentials, IDs or pricing. Ask for Apple Developer, Google Play, APNs/FCM, Supabase, RevenueCat and OAuth details when each phase needs them.
- If anything is unclear or you are less than confident, stop and ask. Do not guess — store review rejections are expensive.
- Present each phase as a build the user can install and test, with a short note of what was done, assumptions made, and recommended polish.
- Keep responses focused. Plain English. No filler.

---

## 7. Open questions to raise with the user before relevant phases

- M1: Apple Developer Program and Google Play Console accounts — are they set up, and what bundle/package IDs to use?
- M2: APNs key (iOS) and Firebase/FCM project (Android) for push; which notification types to launch with.
- M3: OAuth provider setup for Sign in with Apple and Google; confirm Supabase project details match the web app.
- M4: confirmed monthly and season-pass prices **after** the store fee; RevenueCat vs native billing; how to reconcile Stripe-web and IAP entitlements.
- M5: privacy policy URL, support contact, marketing assets, and whether a phased rollout is wanted.

Start with Phase M1 only. Confirm the plan with the user, then begin.

---

## 8. Note — future native rebuild (do not start unless asked)

If the user later wants a fully native app, the migration path is to rebuild the UI in React Native (Expo) while keeping the same backend: the Netlify FPL proxy, Supabase auth and data model, and the entitlement reconciliation built in Phase M4 all carry over unchanged. The design tokens in `index.html` become the React Native theme. This is a large effort and is out of scope for this brief; raise it as a separate project.
