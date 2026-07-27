# Matchday Edge

The calm, clear edge for **European fantasy football** — the sibling app to
Gameweek Edge, running the identical model over the UEFA Champions League
Fantasy game.

## Why it lives in this repo

Because the model must not be copied. Gameweek Edge's `index.html` is the
single source of truth for the match model, the expected-points model and the
squad optimiser — and it has to stay that way, because the eleven test files
and both backtests locate those functions **by name inside that file** and
evaluate them verbatim. That is what makes "the model we grade is the model we
ship" true.

So Matchday Edge does not contain a model. `build.mjs` lifts the
league-agnostic functions out of `../index.html` at build time (via
`../scripts/extract-engine.mjs`) and writes them to `dist/engine.js`, which the
app loads. An improvement to the minutes model lands in both apps on the next
deploy, with nobody porting anything.

```
ucl/
  netlify.toml     this site's Netlify config (base directory = ucl)
  build.mjs        assembles dist/ from app/ + the shared engine
  app/             the shell: fetch, arrange, render. No model code.
  functions/ucl.js UEFA feed → the FPL vocabulary the engine speaks
  dist/            build output (gitignored)
```

## Deploying

Matchday Edge is a **second Netlify site from the same repository**:

| | Gameweek Edge | Matchday Edge |
|---|---|---|
| Base directory | *(repo root)* | `ucl` |
| Config read | `/netlify.toml` | `/ucl/netlify.toml` |
| Build command | `npm run build:web` | `node build.mjs` |
| Publish | `www` | `dist` (i.e. `ucl/dist`) |
| Functions | `netlify/functions` | `ucl/functions` |

Setting the base directory is what stops the two sites fighting over the
publish directory — Netlify reads the `netlify.toml` inside the base, not the
one at the repo root. Netlify still clones the whole repository, so the build
can reach `../index.html`.

Build locally from the repo root with `npm run build:ucl` (or `npm run
build:all` for both sites).

## Accounts and Pro

One account, one subscription, both apps. Both sites talk to the **same
Supabase project** and the same `gwedge_profiles` row, and `tier` lives on that
row — so the existing Stripe webhook that sets `tier = 'pro'` already unlocks
Matchday Edge. There is nothing extra to buy and no second integration.

## ⚠️ The data layer is unverified

`functions/ucl.js` normalises UEFA's feeds into the FPL vocabulary the shared
engine expects. It was written **without a reachable upstream** — the network
policy on the machine that built it blocked `gaming.uefa.com` — so the field
names it reads are plausible, not confirmed.

It is built to fail visibly rather than quietly: every field goes through
`pick()`, which returns `null` (never `0`, never `''`) when nothing matches, so
a mis-named field shows as missing data rather than as a confident wrong
number. But that only limits the damage; it does not make the numbers right.

**Do this before trusting any projection:**

```bash
npx netlify dev            # from the ucl/ directory
curl localhost:8888/api/ucl/health | jq
```

`health` returns the upstream record count, how many survived mapping,
`unmappedKeys`, and a raw-vs-mapped sample pair. Then:

1. If `mapped` is 0 but `upstream` is not, the position or id field is wrong —
   fix `POS` / `normPlayer` first, nothing else works until then.
2. Read `unmappedKeys`. Anything meaningful there (xG, expected assists,
   minutes) is a field worth adding to `normPlayer`.
3. If the request itself fails, the paths in `FEEDS` are wrong. That block is
   the only thing to edit.

`dev/test-ucl.mjs` covers the mapping logic against synthetic payloads in
several plausible upstream spellings, so a change to the normalisers is safe
to make — but no test can tell you the real feed looks like the fake one.

## What it does today

Four views, all on the shared engine:

- **Projected points** — `nativeXP` per player, ranked. Note that Gameweek
  Edge blends this with FPL's own `ep_next`; UEFA publishes no equivalent, so
  here the native model stands alone and is correspondingly less certain.
- **Team of the matchday** — the constrained optimiser over the squad rules
  the proxy declares (15 players, max 3 per club, 100.0m).
- **Match forecasts** — Poisson + Dixon–Coles expected goals, outcome
  probabilities and clean-sheet odds, refitted on this competition's results.
- **Matchday difficulty** — attacking and defensive difficulty from the match
  model rather than a fixed seeding.

## The short-season problem (read this before planning a launch)

`nativeXP` refuses to project a player until their club has **five matches**
behind it — below that the realised rates are noise and the model declines to
guess. In Fantasy Premier League that costs you the opening month of a
38-gameweek season. Here the league phase is **eight matchdays**, so:

| Matchday | Player projections | Match forecasts & difficulty |
|---|---|---|
| 1–4 | ❌ none | ✅ from the first result |
| 5–8 | ✅ | ✅ |
| Knockouts | ✅ | ✅ once the draw is out |

Two consequences worth being deliberate about:

1. **More than half the league phase has no player projections**, and unlike
   FPL there is no official expected-points figure to blend with or fall back
   on. The app says so explicitly rather than rendering an empty table — see
   the "too early" state in `emptyState()`. `dev/test-ucl.mjs` pins that
   message and cross-checks the threshold against `nativeXP`'s own gate, so
   the two cannot drift apart silently.
2. **Match forecasts and matchday difficulty are the launch product**, not
   player projections. They work from the first played fixture. If Matchday
   Edge is marketed on projected points from matchday 1, it will look broken
   when it is in fact being careful.

The honest fixes, in order of value:

- **Refit the priors across Europe.** `PLSIM.priors` covers Premier League and
  Championship clubs; every other European club currently starts on the
  generic prior. A joint fit over the big-five leagues would let the model
  start from a real position on matchday 1 instead of a shrug — and it is the
  same offline fitting pipeline that produced the existing priors.
- **Seed player rates from domestic form.** A player's league season is
  already several matches old when the European campaign starts; that is the
  sample the model is refusing to use. Feeding domestic per-90 rates in as a
  prior would move projections forward by weeks.

Neither is a small job, but both are the difference between an app that is
useful in September and one that becomes useful in November.

## Known limitations

- **No congestion signal.** Gameweek Edge sees midweek European ties via the
  FPL-Core-Insights dataset keyed on FPL team ids. Nothing equivalent exists
  here, so domestic-league fatigue before a European tie is invisible — which
  is a real gap, since it is the same players.
- **No ownership, no prices moving, no manager link.** UEFA does not publish
  a public entry endpoint the way FPL does, so the Rival Scout / EO / Template
  class of feature has no data behind it.
- **Knockout fixtures do not exist until the draw**, so forecasts thin out at
  exactly the point of the season people care most.
- **Priors are Premier League-fitted.** `PLSIM.priors` covers PL and
  Championship clubs; every other European club falls back to the generic
  prior until enough of this competition's results accumulate for the live fit
  to take over. Refitting priors across Europe is the single biggest available
  improvement to forecast quality here.
