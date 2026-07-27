# Euro Matchday Edge

The calm, clear edge for **European fantasy football** — the sibling app to
Gameweek Edge, running the identical model over the UEFA Champions League
Fantasy game.

## Why it lives in this repo, and on this URL

Two reasons, and neither is convenience.

**The model must not be copied.** Gameweek Edge's `index.html` is the single
source of truth for the match model, the expected-points model and the squad
optimiser — and it has to stay that way, because the test files and both
backtests locate those functions **by name inside that file** and evaluate
them verbatim. That is what makes "the model we grade is the model we ship"
true. So this app contains no model: `scripts/build-web.mjs` lifts the
league-agnostic functions out of `../index.html` at build time (via
`scripts/extract-engine.mjs`) and writes `www/euro/engine.js`, which the app
loads. An improvement to the minutes model reaches both apps on the next
deploy with nobody porting anything.

**The session is per-origin.** Supabase persists the auth session in
`localStorage`. On a separate domain a user would have to sign in again, and
the Pro tier they bought in Gameweek Edge would look absent here — the one
thing that must never happen when the pitch is "one subscription covers
both". Serving from `/euro/` on the same origin makes it true for free: same
`localStorage`, same session, same `gwedge_profiles` row.

```
euro/
  app/             the shell: fetch, arrange, render. No model code.
  README.md        this file
../netlify/functions/ucl.js   UEFA feed → the FPL vocabulary the engine speaks
```

## Deploying

There is nothing separate to deploy. `npm run build:web` emits `www/` (Gameweek
Edge) and `www/euro/` (this app) together, and the single `netlify.toml` at the
repo root routes `/api/ucl/*` to the UEFA proxy. One site, one build, one
domain.

**No second domain is needed, and buying one would cost you something.** The
session is per-origin, so a separate domain means signing in twice and a Pro
subscription that looks absent on whichever app you did not buy it from. If you
ever do want a vanity URL, add it as a Netlify **domain alias** that redirects
to `gameweekedge.co.uk/euro/` — an alias resolving to this origin, never a
second site serving its own copy.

## Accounts and Pro

One account, one subscription, both apps. Both sites talk to the **same
Supabase project** and the same `gwedge_profiles` row, and `tier` lives on that
row — so the existing Stripe webhook that sets `tier = 'pro'` already unlocks
Euro Matchday Edge. There is nothing extra to buy and no second integration.

## ⚠️ The data layer is unverified

`functions/ucl.js` normalises UEFA's feeds into the FPL vocabulary the shared
engine expects. It was written **without a reachable upstream** — the network
policy on the machine that built it blocked `gaming.uefa.com` — so the field
names it reads are plausible, not confirmed.

It is built to fail visibly rather than quietly: every field goes through
`pick()`, which returns `null` (never `0`, never `''`) when nothing matches, so
a mis-named field shows as missing data rather than as a confident wrong
number. But that only limits the damage; it does not make the numbers right.

**Do this before trusting any projection** — one command, no deploy, no keys,
from any machine that can reach `gaming.uefa.com`:

```bash
node dev/ucl-probe.mjs
```

The probe imports the real normalisers from `netlify/functions/ucl.js` — not a
copy — so what it reports is exactly what production does with the same
payload. It answers four questions in order and stops at the first one that
makes the rest meaningless:

1. **Do the feeds resolve?** The season token is the least certain part of the
   integration, so it tries a spread of encodings rather than making you
   iterate. If none answer, `FEEDS` is wrong and it says so and stops.
2. **Does each record map?** `id`, position and club are the three that must
   land — a player missing any is dropped. It reports how many were dropped
   *and why*, per missing field.
3. **What was not recognised?** The `unmappedKeys` list is the shopping list
   for `normPlayer`: anything meaningful there (xG, expected assists) is worth
   adding.
4. **Is there enough football?** `nativeXP` needs five matches per club, so a
   feed can be perfectly mapped and still too early — a state the probe names
   rather than conflating with a fault.

Its verdict is one of `READY`, `MAPPED_BUT_TOO_EARLY`, `MAPPING_INCOMPLETE`
or `FEED_UNREACHABLE`. Add `--json` for a machine-readable dump.

Production also exposes `/api/ucl/health` for a live spot-check, but the probe
is the better tool: it covers players, teams *and* fixtures, and it runs
against the real upstream without waiting on a deploy.

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
   player projections. They work from the first played fixture. If Euro Matchday
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
