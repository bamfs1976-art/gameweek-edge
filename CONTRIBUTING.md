# Contributing to Gameweek Edge

A short, practical guide to running the app locally, testing changes, and
extending it. For *what* the app does, see [`docs/FEATURES.md`](docs/FEATURES.md).

---

## 1. TL;DR

```bash
# one-time
npm install
npx playwright install chromium      # for the smoke test only

# run locally against fake FPL data (no internet, no real API needed)
npm run mock                         # serves http://127.0.0.1:8700
# open http://127.0.0.1:8700 and paste the snippet in §3 into the console

# quick "nothing obviously broke" check (mock must be running)
npm run smoke
```

Deploys are automatic: **push to `main` → Netlify builds and publishes**
`https://gameweekedge.netlify.app`. There is no separate release step.

---

## 2. How the project is shaped

The web app is **one self-contained file, `index.html`** — UI, styling, the
team-strength/xP model, and every panel. There is no front-end framework and no
build step for the app logic itself (`npm run build:web` just copies/prepares
files into `www/` for Netlify and the iOS wrapper).

Two structures drive everything:

- **`NAV`** — the areas → panels tree (ids, labels, `tier: free|paid`).
- **`WIRED`** — maps each panel id to an async `hydrate<Panel>(host)` function
  that fetches live data and renders the panel's HTML into `host`.

Data reaches the browser through the **Netlify proxy** (`netlify/functions/fpl.js`)
which whitelists FPL endpoints. Slow-changing responses are cached in-memory +
`localStorage` via `cached(key, ttlMs, loader)`.

See `docs/FEATURES.md` §7 (Architecture) and Appendix B (file layout) for the
full picture.

---

## 3. Running locally with the mock API

The mock server (`dev/mock_fpl.py`, pure Python 3 standard library — no deps)
serves `index.html` **and** answers every FPL endpoint the app calls with
deterministic fake data. This lets you develop and test completely offline.

```bash
npm run mock            # or: python3 dev/mock_fpl.py   (honours $PORT)
```

Then open <http://127.0.0.1:8700> and, in the browser console, point the app at
the mock and load the demo manager:

```js
localStorage.setItem('ge-api-base', 'http://127.0.0.1:8700');
localStorage.setItem('ge-mid', '101');     // demo manager id
localStorage.setItem('ge-tier', 'pro');    // unlock Pro panels for testing
localStorage.setItem('ge-onboarded', '1'); // skip the first-run modal
location.reload();
```

Notes:
- The dataset is synthetic (six players per club, all four positions, so even
  Scout AI's Team of the Week forms). It's for exercising rendering, sorting,
  filtering, the model plumbing and every panel — **not** for judging real
  projections.
- Club crests and player photos come from the official PL CDN, which is
  unreachable offline, so you'll see the colour-tile / kit-shirt fallbacks
  locally. They load for real on the deployed HTTPS site.
- To go back to the real API, `localStorage.removeItem('ge-api-base')`.

---

## 4. Testing a change

### Automated smoke test
`dev/smoke.mjs` renders **all 29 panels** on a phone viewport and fails on any
console/page error or horizontal overflow. Run it with the mock up:

```bash
npm run smoke           # exits non-zero if any panel errors or overflows
```

It ignores offline-CDN network noise (missing photos/crests). Env overrides:
`BASE`, `MID`, `PLAYWRIGHT_PKG`, `CHROMIUM` (see the file header).

### Manual verification (do this for anything non-trivial)
Drive the actual flow you changed in the browser — link the demo team, open the
panel, sort/filter/click through it, and check both **light and dark** themes
and a **narrow (≈390px) viewport**. The smoke test proves it renders; it does
not prove the feature is correct.

A handy pattern for a focused headless check while iterating:

```bash
node -e "/* or a throwaway playwright script that renderPage('yourPanel')
            and screenshots #app — see dev/smoke.mjs for the setup */"
```

---

## 5. Common tasks (recipes)

### Add a new panel
1. **`NAV`** — add `{id, label, icon, tier}` under the right area.
2. **`PANEL_CONTENT`** — add a `{desc, layout}` entry for the id.
3. Write `async function hydrate<Name>(host)` that loads data and sets
   `host.innerHTML`.
4. **`WIRED`** — register `id: hydrate<Name>`.
5. Add any CSS near the related block; keep wide content inside a
   `overflow-x:auto` wrapper so the page never scrolls sideways.
6. `npm run smoke` (the new panel is picked up if you also add its id to the
   `PANELS` list in `dev/smoke.mjs`).

### Add a new FPL endpoint
1. **Proxy allowlist** — add a regex to `ALLOW` in `netlify/functions/fpl.js`
   (and to the `isLive` test if it must never be cached).
2. **Client loader** — add a `load…` helper near the others in `index.html`,
   wrapping `api(path)` (optionally via `cached()`).
3. **Mock** — add a branch to `route()` in `dev/mock_fpl.py` returning fake data.
4. Never widen the proxy to an open relay — only the exact paths the app needs.

### Touch the model
The fitted team-strength engine (`plsim*`) and player projections (`xP`,
`nativeXP`, `horizonXP`) are **validated** (see `docs/FEATURES.md` §4 and the
`Plsimulator` repo's backtests). Do **not** silently change the projection
formula — add new inputs as displayed stats, and only fold them into `nativeXP`
if a walk-forward backtest beats the current model.

---

## 6. Conventions

- **Style:** match the surrounding vanilla-JS idiom — short helpers, string-built
  HTML, `esc()` everything user/data-derived, `crest()`/`avatar()`/`ppFigure()`
  for player imagery. No new dependencies for the web app.
- **Responsive:** relative units, `minmax(0,1fr)` grids, `overflow-x:auto`
  scrollers for wide tables/charts. Test at ~390px.
- **Theme:** use CSS variables (`--surface`, `--text`, `--green-bright`, …) so
  both themes work; never hard-code theme-specific colours in inline styles.
- **Pro gating** is UX only (client-side). Do not put anything security-sensitive
  behind it; real secrets live in Netlify env vars and serverless functions.

---

## 7. Environment variables (Netlify)

Set these in the Netlify site environment (Site settings → Environment):

| Variable | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | the LLM layer for the AI reports (`functions/ai.js`). Without it the AI panels show an unavailable state; every other tool is unaffected. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | optional accounts / cross-device sync (`auth.js`). |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price ids | Pro billing (`functions/checkout.js`, `portal.js`, `stripe-webhook.js`). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | web push (`functions/push-*.js`). |

None are required to run locally against the mock. The app degrades gracefully
when a key is absent.

---

## 8. Commits & deploys

- Work on a branch; open a PR into `main`. Merging to `main` auto-deploys.
- Keep commits focused with a clear subject line and a short body explaining the
  *why*. Update `docs/FEATURES.md` when you add/change panels, endpoints or the
  model so it stays the source of truth.
- After deploy, confirm the change on `https://gameweekedge.netlify.app`
  (the live site has the real photos/crests and the configured env keys).

---

Questions or a bigger change in mind? Skim `docs/FEATURES.md` first — the
roadmap (§10) lists the known gaps worth picking up.
