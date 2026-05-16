# Gameweek Edge — Development Brief for Claude Code

This document is the master brief for building Gameweek Edge. Read it fully before starting any work. It sets the product, the standards, the build phases and the rules. Each phase has its own prompt section. Do not start a later phase until the user confirms the current one is approved.

---

## 1. What Gameweek Edge is

Gameweek Edge is a web app for Fantasy Premier League (FPL) managers. It is the calm, clear companion that gives serious managers a measurable edge. It is not a tipster site and not aggressive in tone. Think of the official FPL site's clarity, applied to deeper analysis.

The product has a free tier and a paid "Pro" tier. Free helps a manager run their own team. Pro gives the competitive edge: live matchday tracking and intelligence on other managers.

The app must be commercially safe. Do not use "FPL" or "Premier League" as part of the brand name anywhere. "Gameweek Edge" is the brand. "FPL" may only be used descriptively in body copy and taglines, for example "the smart companion for Fantasy Premier League managers".

---

## 2. Starting point

The repository already contains `index.html`. This is the Phase 1 structural shell: the full brand, the 6-area navigation, all 23 sub-panels as navigable pages, light and dark themes, and a responsive layout with a mobile bottom nav. Panels currently hold placeholder content.

**Build from this file. Do not rebuild from scratch.** Keep the brand, the navigation model, the theming and the layout system. Your job across the phases is to replace placeholder content with real, working features, then add accounts and the paywall.

---

## 3. Non-negotiable standards

Apply these to every commit, in every phase.

### Code and stack
- Single-file `index.html` where practical. Vanilla JavaScript, no frameworks.
- All data comes live from the official FPL API. Remove any reliance on static JSON data files. No stale data.
- The FPL API does not allow direct browser calls (CORS). Route every API call through a Netlify serverless function as a proxy. A `netlify/functions` folder and `netlify.toml` should exist for this.
- No secrets, keys or tokens in client-side code.
- Complete, working code only. No stubs, no TODOs left in delivered work.

### Design and UX
- Light theme is the default. Dark theme is the toggleable option. Both must work fully.
- Keep the established design tokens (CSS custom properties). Do not introduce ad hoc colours, spacing or font sizes.
- Lead with graphic elements: the pitch view, cards, big numbers, colour-coded badges. Dense data tables sit one level deeper, not as the first thing a user sees.
- 8pt spacing grid. Distinctive display font for headings, clean readable font for body and data.

### Accessibility — WCAG 2.2 AA, mandatory
- Colour contrast: minimum 4.5:1 for body text, 3:1 for large text and UI components.
- Full keyboard navigation. Visible focus states on every interactive element.
- ARIA labels, roles and live regions where needed. Live-updating panels must announce updates politely.
- No information conveyed by colour alone.
- Touch targets minimum 44x44px.
- Skip link to main content. Page language set.
- Confirm AA compliance before presenting any phase as done.

### Quality control before every handover
- No unused variables, no broken animations, no missing fallbacks, no selector conflicts, no duplicate IDs.
- Validate JavaScript syntax. Trace the rendered HTML structure. Check every grid and flex container.
- Test in both light and dark themes, and at mobile, tablet and desktop widths.
- Fix all issues silently before presenting. Note any minor polish items as recommendations.

### Security checklist on every build
- Input validation on every user input, especially the FPL Manager ID field.
- Content Security Policy in place.
- Authentication checks on protected features.
- Row Level Security on all Supabase tables.
- No secrets in client code. HTTPS and secure cookies.

### Git workflow
- `main` holds the current stable build.
- Each phase is developed on its own branch, branched from `main`, for example `phase-2-live-data`.
- Commit in small, logical steps with clear messages.
- Do not merge to `main` until the user approves the phase.
- Never force-push to `main`.

---

## 4. The 6-area structure and the free / paid split

The 6 areas and their panels. The tier decides free versus Pro.

**Home** — Dashboard (free), This Gameweek (free)
**My Team** — My Squad (free), Transfer Planner (free), Captaincy Lab (free)
**Live** — Live Rank (Pro), DefCon Threats (Pro), Auto-Sub Tracker (Pro), What-If Simulator (Pro)
**Intelligence** — EO Tracker (Pro), Template Meter (Pro), Rival Scout (Pro)
**Players** — Player Compare (free), Differentials (free), Price Predictor (free), Injury Monitor (free), Set Piece Register (Pro), Rotation Risk (Pro)
**Planner** — Fixture Planner (free), Chip Strategy (free), GW History (Pro), Watchlist (free), Alerts (free)

Principle: free helps a manager run their own team; Pro gives intelligence on other managers and live matchday tracking. The navigation model in the shell already encodes these tiers.

---

## 5. Build phases

Build in order. Stop at the end of each phase and wait for the user to approve before continuing.

### PHASE 2 — Live data layer

Goal: every panel pulls real, live data from the FPL API. No accounts or paywall yet. All panels function for everyone.

Tasks:
1. Create or confirm the Netlify proxy function for the FPL API. Cover the endpoints needed: bootstrap-static (players, teams, gameweeks), fixtures, manager entry, manager picks, gameweek live data, manager history.
2. Remove all static JSON data files and any code that reads them.
3. Wire every panel to live data. Replace each placeholder block with the real working feature described in the panel's heading and description text already in the shell.
4. Add a single Manager ID input. Validate it. Once entered, it drives every personalised panel. Store it in the browser for the session so the user does not re-enter it on every panel.
5. Build proper loading, empty and error states for every panel. The FPL API is slow on matchday; handle that gracefully.
6. Cache slow-changing bootstrap data sensibly; refresh it at least daily. Live matchday data must not be cached.

Suggested order within Phase 2, so the user can review progress: Home and My Team first, then Players and Planner, then Live and Intelligence.

Deliverable: a fully working app, all panels live, still entirely free, on a `phase-2-live-data` branch.

### PHASE 3 — Accounts

Goal: proper user accounts so a user's identity and Manager ID persist across devices.

Tasks:
1. Add Supabase authentication. Email and password sign-up and sign-in, plus password reset.
2. On sign-up, let the user save their FPL Manager ID to their account.
3. A signed-in user's Manager ID, watchlist and preferences load from their account, not just browser storage.
4. Enable Row Level Security on every Supabase table. A user can only read and write their own rows.
5. The app must still work for signed-out users in a limited way: free panels usable, but personalised data and saved items require sign-in.
6. No paywall yet. Accounts exist; everything is still accessible once signed in.

Deliverable: working accounts on a `phase-3-accounts` branch. Supabase project details to be provided by the user.

### PHASE 4 — Free and paid tiers, billing

Goal: the Pro paywall and payment.

Tasks:
1. Add a `tier` field to the user account: `free` or `pro`.
2. Gate every Pro panel. A free user sees the panel in the navigation with a lock indicator, and on opening it sees a clear preview of what it does plus an upgrade prompt. Never a blank wall; show the value.
3. Integrate Stripe for billing. Offer a monthly subscription and a season pass. Pricing to be confirmed by the user before this phase.
4. On successful payment, update the user's tier to `pro` via a secure server-side process. Never set the paid tier from client-side code alone.
5. Handle subscription lifecycle: active, cancelled, expired, payment failed.
6. Confirm before building: test that Stripe accepts the account, with the app positioned as a sports analytics tool, not gambling.

Deliverable: working free and paid tiers with billing on a `phase-4-billing` branch.

### PHASE 5 — Polish and launch

Tasks:
1. Full accessibility audit against WCAG 2.2 AA. Fix every failure.
2. Performance pass: fast first load, lazy-load where sensible, efficient API use.
3. Cross-device and cross-theme testing.
4. A simple landing or marketing page if the user wants one.
5. Merge to `main`. Confirm the Netlify deploy is connected to the repo so commits deploy automatically.

---

## 6. How to work with the user

- At the start of each phase, restate what you will build and ask any open questions before writing code.
- Do not assume Supabase or Stripe details. Ask the user for project IDs, keys and pricing when each phase needs them.
- If anything is unclear or you are less than confident, stop and ask. Do not guess.
- Present each phase as a working build the user can open and test, with a short note of what was done, any assumptions made, and any recommended polish items.
- Keep responses focused. Plain English. No filler.

---

## 7. Open questions to raise with the user before relevant phases

- Phase 2: confirm the user's FPL Manager ID for testing.
- Phase 3: Supabase project ID and connection details.
- Phase 4: confirmed monthly price and season pass price; confirmation that Stripe accepts the account under sports-analytics positioning.
- Phase 5: does the user want a landing page, and is Netlify auto-deploy connected.

Start with Phase 2 only. Confirm the plan with the user, then begin.
