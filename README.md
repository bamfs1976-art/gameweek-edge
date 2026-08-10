# Gameweek Edge

The calm, clear companion that gives fantasy managers a measurable edge. A single-file web app (`index.html`, vanilla JS) that runs three ways from one codebase:

- **Web app / PWA** — installable on phones from the browser (this is the no-Mac way onto an iPhone).
- **iOS app** — the same app wrapped natively with Capacitor (see [`README_MOBILE.md`](README_MOBILE.md)).
- **Live data** — pulled from the official game APIs through Netlify serverless proxies.

## Three games, one site

| App | Route | Game | Source |
|---|---|---|---|
| Gameweek Edge | `/` | Fantasy Premier League | `index.html` |
| Euro Matchday Edge | `/euro/` | UEFA Champions League Fantasy | [`euro/`](euro/README.md) |
| Fantasy EFL | `/fantasy-efl/` | Official Fantasy EFL — Championship, League One, League Two | [`efl/`](efl/README.md) |

Each has its own name and its own identity — Gameweek Edge is pitch green and
daytime, Euro Matchday Edge is floodlit navy, Fantasy EFL is indigo with a
three-stripe division motif — and all three ship from one deployment.

They are one Netlify site on purpose, not for tidiness. Supabase persists the
session in `localStorage`, which is **scoped per origin** — so on two domains
a user would sign in twice, and a Pro subscription bought on one would look
absent on the other. Same origin makes *one account, one subscription, every
game* true in the browser rather than only in the database.

Euro Matchday Edge shares the model, not the code: `scripts/build-web.mjs`
lifts the league-agnostic engine out of `index.html` at build time (see
`scripts/extract-engine.mjs`) and writes it to `www/euro/engine.js`. A fix to
the minutes model reaches both on the next deploy with nobody porting
anything.

**Fantasy EFL deliberately does not share it.** That game has no budget, no
player prices, no transfers and no price changes, so the FPL optimiser and its
cost-aware projections have nothing to say about it; extracting them would
mean shipping 45kB of code to answer questions the game does not ask. It
carries its own three small weighted models in `efl/app/assets/model.js`
instead. It is also **five real HTML pages** rather than one shell, so each
route has a genuine title, description, canonical URL and set of internal
links before any JavaScript runs.

> ⚠️ **Fantasy EFL runs on sample data.** No free, reliable feed covers
> player-level data for all three EFL divisions, so the app ships with a
> generated dataset and says so on every page — the banner is rendered from
> `source.live`, not written into the markup, so it disappears by itself when
> a real provider is configured. Club names are real; results, tables, players
> and injuries are invented, and every player *name* is generated. All data
> enters through one file, `efl/app/assets/provider.js`; see
> [`efl/README.md`](efl/README.md) for the models, the weights, and how to
> swap the provider.

### Game packs

A *game pack* (`GAMES` in `index.html`) says where the data comes from, what
the scoring looks like, and which of the game's **mechanics exist at all**.
Panels declare the capabilities they need (`needs:` in the `NAV` registry) and
a panel whose capability is missing is **removed, not locked**:

> A Pro panel still exists for a free user — it is shown locked, as an upsell.
> A Price Predictor in a game where prices never move is not locked, it is
> *meaningless*. Those are different states and the UI says so.

Today there is one pack and every capability is present, so nothing is hidden —
`dev/test-social.mjs` asserts exactly that, and separately proves the gate
still works by running a hypothetical pack through it. The value is that a
panel asks `hasCap('transferCost')` rather than assuming, so adding a second
game means adding a pack and a proxy function; no panel needs to know it
happened.

## Run / deploy (web + PWA)

The app is built into `www/` and deployed on **Netlify**:

```bash
npm install
npm run build:web      # assembles www/ (index.html, native.js, PWA manifest, sw, icons)
npx netlify dev        # run locally with the FPL proxy working
```

Deploy by connecting this repo to Netlify. The included `netlify.toml` already sets:
- **build command** `npm run build:web`, **publish** `www`
- the FPL proxy function (`netlify/functions/fpl.js`) routed at `/api/fpl/*`

Once deployed, the site is a full PWA: offline-capable app shell (service worker), installable, with brand icons and a standalone display.

## Install on iPhone (no App Store, no Mac)

1. Open the deployed site in **Safari** on the iPhone.
2. Tap **Share** → **Add to Home Screen**.
3. Launch it from the home-screen icon — it runs full-screen, like an app.

On Android, Chrome shows an **Install app** prompt for the same site.

> PWA notes: works offline after first load; push notifications require iOS 16.4+ and are added in a later phase; it is not listed in the App Store. For a store-listed native build, see the cloud-build options in `README_MOBILE.md`.

## Accounts (Supabase)

Sign-in is **optional** — signed out, everything works locally on the device. Sign in (sidebar → *Sign in to sync*) and your **Manager ID, tier, watchlist and rivals sync to the cloud** and follow you across devices.

- Email/password sign-up, sign-in and password reset via Supabase Auth.
- Data lives in `gwedge_*` tables with **row-level security** (`auth.uid() = user_id` on every policy) — each user can only read/write their own rows.
- On first sign-in, local and cloud data are **merged** (nothing is lost), then the cloud becomes the working copy.
- The Supabase URL + publishable key are in `index.html` (`SUPA`). The publishable key is public-safe; RLS does the protecting. The client SDK is bundled locally into `www/auth.js` (no third-party CDN).

> **One Supabase setting for email links:** in the Supabase dashboard → Authentication → URL Configuration, set the **Site URL** (and add to **Redirect URLs**) to your deployed Netlify URL, so sign-up confirmation and password-reset links return to the app.

## Advanced stats (FPL Core Insights — optional)

Beyond the official API, the app can layer in Opta‑like metrics from the open
[FPL Core Insights](https://github.com/olbauday/FPL-Core-Insights) dataset —
most usefully goalkeeper **goals prevented** (post‑shot xG faced minus goals
conceded), which sharpens the keeper projection. It is fully optional and needs
**no new env vars** (it reuses the Supabase service role):

- Create the table once: run `supabase/gwedge_core_insights.sql` in the Supabase
  SQL editor.
- A scheduled function (`core-insights.js`, twice daily) aggregates the open
  dataset into it; `/api/core-insights` serves it and the client merges it onto
  players. Until the table exists it simply no‑ops and the app uses official
  data only.

See `docs/FEATURES.md` §5 and `docs/MODELLING.md` (P7) for details.

## Billing (Stripe)

Pro is a real paid tier. Free users see a value preview + the upgrade modal; subscribing via **Stripe Checkout** sets their tier server-side.

- `netlify/functions/checkout.js` — creates a Checkout session (monthly subscription or season-pass one-off).
- `netlify/functions/stripe-webhook.js` — verifies Stripe's signature and sets `gwedge_profiles.tier` using the Supabase **service-role** key (the only place tier is set authoritatively), logging to `gwedge_billing_events`.
- The client opens Checkout, and on return pulls the new tier from the cloud (with a short retry for webhook lag).

**To switch it on**, set these env vars on the Netlify site (Site configuration → Environment variables):

| Variable | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys |
| `STRIPE_PRICE_MONTHLY` | Stripe → Products → your monthly price ID (`price_…`) |
| `STRIPE_PRICE_SEASON` | Stripe → Products → your season-pass price ID |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → add endpoint `https://<site>/api/stripe-webhook` → signing secret |
| `SUPABASE_URL` | `https://knodunjnsxelmpziupwk.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API → service_role key (**secret**, server-only) |

Until configured, the upgrade modal falls back to the on-device "Preview Pro" unlock. Set the Stripe webhook to send at least `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.

> **iOS App Store note:** Stripe web checkout is fine for the **web/PWA**. If you ship the Capacitor app to the App Store, Apple requires **in-app purchase** for digital subscriptions there — that's a separate integration (e.g. RevenueCat) from this Stripe web flow.

## Push alerts (Web Push)

Price-change, injury and deadline alerts delivered even when the app is closed — on the **PWA**, with **no Apple Developer account** (Web Push, not APNs).

- Subscriptions live in `gwedge_push_subs` (RLS-locked to the service role).
- `push-key` / `push-subscribe` / `push-unsubscribe` functions manage subscriptions; the service worker shows notifications and deep-links to the relevant panel.
- `push-cron` (scheduled hourly) diffs the FPL bootstrap for overnight price changes and new injury flags, and sends a deadline reminder in the final hours.
- Enable from the **Alerts** panel; the price/injury/deadline toggles control what you receive.

Env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` you own), plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (shared with billing). Generate keys with `npx web-push generate-vapid-keys`.

## Environment variables (all server-side, on Netlify)

| Feature | Variables |
|---|---|
| AI (all Claude features) | `ANTHROPIC_API_KEY` |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_SEASON`, `STRIPE_WEBHOOK_SECRET` |
| Accounts/billing/push backend | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |

Every feature degrades gracefully (a tidy setup note) until its keys are set.

## Live FPL data

All data comes live from the official FPL API via the proxy (the FPL API has no CORS and blocks direct browser calls). Bootstrap/fixtures are cached with a TTL; manager and live-matchday data are never cached. Enter your **FPL Manager ID** (topbar → *Link Team*) to load your squad, points and rank.

**All 38 panels (7 areas) are wired to live data** — see `docs/FEATURES.md` for the full panel reference.

- **Free:** Dashboard, This Gameweek, Pre-season Draft (2026/27 squad builder), My Squad (live pitch), Transfer Planner, Captaincy Lab, Fixture Planner, Clean Sheet Matrix, Differentials, Price Predictor, Injury Monitor, Chip Strategy, Watchlist (saved on device), Alerts, Player Compare.
- **Pro** (gated behind the paywall): Live Percentile (an estimated percentile, not a true live rank), DefCon Threats, Auto-Sub Tracker, What-If Simulator, EO Tracker, Template Meter, Rival Scout, **Scout AI**, Set Piece Register, Rotation Risk.

**Scout AI** is our own answer to third-party prediction sites, built on the data we already have plus Claude:
- A transparent **predicted-points (xP)** model — FPL's expected points scaled by availability and fixture difficulty — feeds an optimiser that picks the **Team of the Week** (best valid XI, max 3 per club) and the **captain**. Captaincy Lab now ranks by xP too.

### Claude AI features

All Claude calls go through **one** server function, `netlify/functions/ai.js` (per-task prompts). The **numbers come from our own models**; Claude reasons over the JSON we pass and is told not to invent data. Models are chosen per task (Haiku 4.5 for high-volume, Sonnet 4.6 for chat/reasoning).

- **Ask the Scout** — a chat coach grounded in your squad, xP, fixtures and candidates.
- **AI Scout Report** — captain, gameweek picks and a read on your team.
- **AI Transfer Planner** — concrete moves (out → in, cost, hit y/n) from your squad and fixtures.
- **Weekly Digest** & **Last Gameweek Review** — Dashboard cards.
- **Player verdicts** (Watchlist), **Chip Adviser** (Chip Strategy), **Rival Brief** (Rival Scout).

The Anthropic key stays server-side — set `ANTHROPIC_API_KEY` on the Netlify site to switch them all on (without it, each shows a tidy setup note). On-demand generations are **cached per gameweek** and the buttons on free panels are **Pro-gated** to control cost.

**Pro paywall:** free users see a value preview and an upgrade prompt on each Pro panel; Pro users get the live tools (lock badges disappear). The tier is real and gated end to end. Card/in-app payment is wired in Phase M4 — for now an honest in-app "Preview Pro" unlock lets the Pro experience be used and tested on the device.

## Ten seasons of history

Alongside the live API, the app reads a **reduced ten-season archive**
(2016-17 to 2025-26) built offline from the open
[vaastav dataset](https://github.com/vaastav/Fantasy-Premier-League) — ~250k
gameweek rows shrunk to ~1,600 careers (540kB, 173kB gzipped) and served as a
static file at `/api/history`. The browser never sees a gameweek row.

It answers the one question live data cannot, because before gameweek one there
is no live data: **who is worth picking?** Measured on the pre-season board, it
takes the Draft from *0 of 120 players ranked* to *120 of 120*.

- **Pre-season Draft** — minutes- and recency-weighted career priors, with a
  visible confidence badge and an explicit *"No PL record"* fallback for
  promoted-club and overseas players.
- **Model Accountability** — every season graded separately. The model beat the
  form baseline in all ten; the four seasons with expected-goals data are
  labelled *as shipped* and the six before them *proxy*, and the two are never
  pooled.
- **Captaincy / Transfers / Rank Threats** — career haul and blank rates next to
  the simulated ones, and a regression flag when a player is scoring above or
  below his underlying chances.
- **Ten Seasons panel** — all-time records, career comparison, and a daily
  guess-the-player puzzle.

Rebuild with `npm run history`; `.github/workflows/history.yml` does it weekly
and commits only when the reduced output changes. Full notes, including the era
caveats and known limitations, in **`docs/HISTORY.md`**.

## Project layout

```
index.html              the app AND the model (single source of truth)
euro/                   Euro Matchday Edge — the UCL app, served at /euro/
efl/                    Fantasy EFL — five pages, served at /fantasy-efl/
scripts/extract-engine.mjs  lifts the shared model out of index.html at build time
src/native/index.js      native bridge (Capacitor) → bundled to www/native.js
manifest.webmanifest     PWA manifest        sw.js  PWA service worker
icons/                   PWA icons
scripts/build-web.mjs    assembles www/
netlify/functions/fpl.js FPL API proxy        netlify.toml  build + routing
ios/                     native Xcode project (see README_MOBILE.md)
www/                     build output (gitignored)
```
