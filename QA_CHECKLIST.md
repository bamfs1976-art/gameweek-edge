# Gameweek Edge — Launch QA Checklist

Run this before each release. Test on a real iPhone (Safari) and an Android phone (Chrome), plus a desktop browser. Use a known FPL Manager ID. ✅ / ❌ / N/A each line.

## 0. Config (one-time, in Netlify → Environment variables)
- [ ] `ANTHROPIC_API_KEY` set → AI features work (no "AI needs setup" note)
- [ ] Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_SEASON`, `STRIPE_WEBHOOK_SECRET`
- [ ] Stripe webhook endpoint added → `https://<site>/api/stripe-webhook` (events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted)
- [ ] Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- [ ] Supabase Auth → URL Configuration → Site URL + Redirect URLs = your deployed URL
- [ ] OG/meta domain in `index.html` + `landing.html` matches your real domain

## 1. First run & onboarding
- [ ] Fresh visit (no team linked) shows the welcome modal after ~1s
- [ ] "Link my team" opens the Manager ID modal; "Look around first" dismisses and doesn't return
- [ ] Invalid Manager ID shows a clear error; valid ID links, toasts "Team linked", topbar shows team name

## 2. Core navigation & shell
- [ ] Header shows logo + name + tagline; mobile hides the breadcrumb
- [ ] Sidebar (desktop) and bottom nav (mobile) switch areas/panels; active state correct
- [ ] Light/dark theme toggle works; choice persists across reloads
- [ ] Refresh button + pull-to-refresh re-pull live data
- [ ] Skip link works; visible focus rings on keyboard tab; Escape closes modals/drawer

## 3. Free panels (linked team)
- [ ] Dashboard: KPIs, recent-form chart, Weekly Digest + Last GW Review cards
- [ ] This Gameweek: deadline, average/highest, crowd moves
- [ ] My Squad: live pitch with captain ×2, live points, GW summary
- [ ] Transfer Planner: budget, in-form targets, AI Transfer Planner (Pro-gated button)
- [ ] Captaincy Lab: ranked by predicted points; safe/balanced/differential
- [ ] Fixture Planner: 6-GW FDR grid + Match outlook probabilities; pre-season shows "Between seasons"
- [ ] Differentials / Price Predictor / Injury Monitor: lists populate
- [ ] Chip Strategy: chips used/available + AI Chip Adviser
- [ ] Watchlist: search-add, remove, per-player AI verdict; persists; toasts
- [ ] Alerts: deadline + fitness + price feed; push card; preference toggles
- [ ] Mini-Leagues: lists your leagues with rank/movement; tap → standings highlight your row
- [ ] Player Compare: add up to 4, comparison table

## 4. Pro gating
- [ ] As Free: Pro panels show the value preview + "Unlock Pro" (no API call fired)
- [ ] AI buttons on free panels show "Unlock with Pro" when Free
- [ ] Upgrade modal: monthly + season prices; "Preview Pro now" fallback only if Stripe unconfigured
- [ ] As Pro: Pro panels show live tools; lock badges hidden; "Pro · Unlocked" marker

## 5. AI features (key set)
- [ ] Ask the Scout: question returns a grounded answer; suggested chips work; thread scrolls
- [ ] Scout AI: Team of the Week pitch + AI scout report
- [ ] Transfer plan / digest / review / chip adviser / rival brief / player verdict each generate and cache per gameweek
- [ ] With no key: each shows a tidy "AI needs setup" note (no crash)

## 6. Accounts (Supabase)
- [ ] Sign up → confirmation email → sign in
- [ ] Signed in: Manager ID / watchlist / rivals sync; sign out on another device, sign in, data restored
- [ ] Password reset email arrives and works
- [ ] RLS: a user cannot read another user's rows (spot-check)

## 7. Billing (Stripe)
- [ ] Subscribe (test card 4242…) → returns to app → tier becomes Pro within a few seconds
- [ ] gwedge_profiles.tier = pro; gwedge_billing_events logged
- [ ] Manage/cancel opens the Stripe portal; cancelling sets tier back to Free (after webhook)

## 8. Push (PWA, installed)
- [ ] Alerts → Enable push: permission prompt; toast "Push alerts on"; row appears in gwedge_push_subs
- [ ] Toggling a preference updates the stored prefs
- [ ] (After a price/injury change or near a deadline) a notification arrives; tapping it deep-links to the right panel
- [ ] Turn off removes the subscription

## 9. PWA / install / offline
- [ ] iOS Safari: Share → Add to Home Screen; launches full-screen, correct icon + splash, safe areas respected
- [ ] Android Chrome: install prompt works
- [ ] Offline: app shell still loads; offline banner appears; live panels show a graceful state
- [ ] After a deploy: fully close & reopen → latest version loads (service worker network-first)

## 10. Marketing & social
- [ ] `/welcome` renders the landing page; all CTAs go to the app; FAQ accordions open
- [ ] Sharing the URL shows the OG image + title/description (test with a social debugger)
- [ ] Non-affiliation disclaimer present in footer

## 11. Accessibility (WCAG 2.2 AA spot-check)
- [ ] VoiceOver/TalkBack: nav, buttons and modals are announced; AI replies announced (aria-live)
- [ ] Colour contrast passes for body and large text; no info by colour alone (badges have text)
- [ ] All touch targets ≥ 44×44px; Dynamic Type / font scaling doesn't break layout
- [ ] Reduced-motion setting calms animations

## 12. Performance
- [ ] Fast cold start; no layout shift on first paint
- [ ] Matchday: polling backs off; no hammering of the proxy
- [ ] Lighthouse (mobile) PWA installable; Performance/Accessibility/Best-practices ≥ 90
