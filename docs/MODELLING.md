# Gameweek Edge — statistical modelling

How the app forecasts, where the edge comes from, and the roadmap for
improving it. All model code lives in `index.html`; the tools referenced
here are in `dev/`.

## Two layers

### 1. Match model (`plsim*`)
A Poisson attack/defence model with the **Dixon–Coles** low-score
correction (`RHO −0.074`), which fixes plain-Poisson bias on 0-0/1-0/0-1/
1-1 — exactly the scorelines clean sheets hinge on.

- Each team carries an **attack** and **defence** multiplier plus a
  home-advantage term. Expected goals for a fixture are
  `BASE · att_home · def_away · home` and `BASE · att_away · def_home`
  (`BASE_H 1.62`, `BASE_A 1.32` = league-average goals home/away).
- Multipliers are fit iteratively (`plsimRatings`, 24 passes) on this
  season's finished fixtures, with **offline priors as pseudo-matches**
  (weight 8) — Bayesian shrinkage that keeps August sane and sharpens as
  results accrue. Home advantage stays at its prior (too little live
  signal to refit mid-season).
- Backtested: **held-out RPS 0.2126** vs 0.2133 for the unweighted fit.

The match model feeds every fixture's team expected goals (λ) and
clean-sheet odds into the player layer, and powers Fixture Difficulty 2.0
(`fdrAttack`/`fdrDefence`).

### 2. Player model (`nativeXP` → `xP`)
`nativeXP` is expected points from first principles:

```
appearance (1 + 1 at 60')  +  goals (effGoalRate · mins · fixture · goalPts)
  +  assists (xA90 · mins · fixture · 3)  +  clean sheet (csPts · CS · p60)
  +  bonus  +  defensive contribution  +  goalkeeper saves
  −  goals conceded (GK/DEF)  −  expected cards / OG / pen-miss
```

`effGoalRate` is finishing-aware: it shrinks a player's realised goal rate
toward their xG (weight up to 0.45 by ~20 games), so proven finishers are
not permanently under-rated. The goals-conceded term mirrors the clean
sheet with the −1-per-2-conceded downside (from the match model's concede
rate), and the negatives term subtracts expected cards / own goals /
penalty misses from the realised rates.

`xP` blends `nativeXP` with FPL's own `ep_next`, **sample-adaptively**
(native weight 0.475 at 5 games → capped 0.70 by mid-season) and scales
by chance-of-playing. It returns `null` until a player has ≥5 games and
≥20 mins/game.

## What changed (P1 — shipped)

The first cut of `nativeXP` modelled only goals, assists, clean sheets and
appearance. It **systematically under-forecast** three real scoring
categories:

| Category | Why it mattered | How it's modelled now |
|---|---|---|
| **Bonus** | ~10–15% of returns; favours involvement profiles | realised per-90 bonus rate, minutes-scaled, ±30% by fixture |
| **Defensive contribution** (2025/26) | +2 for clearing a CBIRT threshold (DEF 10, MID/FWD 12) — real points for CDMs/defenders | logistic `P(hit)` around the threshold, at 60' |
| **Goalkeeper saves** | 1 pt per 3 saves — the main GK differentiator | realised save rate, `saves/3` |

Plus the sample-adaptive blend (lean on `ep_next` early, on our own model
as evidence accumulates).

### Validation
`node dev/model-validate.mjs` — a reproducible, seeded backtest. It
Monte-Carlos each synthetic player's *actual* points from independent
stochastic processes (Poisson goals/assists, Bernoulli clean sheets,
Poisson-threshold defensive contributions, save counts, bonus) and scores
the model against that ground truth, comparing the enhanced model to the
original.

Headline (synthetic): the original model's **signed bias** was
**−5.1 pts/game for goalkeepers** (it ignored saves entirely) and
**≈ −1.8 for defenders/mids** (bonus + defensive contribution); the
enhanced model removes almost all of it. For real actuals, pass a
snapshot: `node dev/model-validate.mjs snap.json` (build instructions in
the script footer).

> The synthetic figure is an upper bound that isolates the omission bias.
> The real-data mode is the honest test — run it against a finished
> gameweek to confirm the MAE improvement on live returns.

## Using the model each gameweek

`node dev/simulate-gameweek.mjs [--html out.html]` turns the model into the
outputs a manager acts on: a **captaincy ranking with the floor→ceiling
band** (P10/P50/P90 from a per-player Monte-Carlo), **haul/blank
probabilities**, **differential ceilings**, **value (xP per £m)** and a
**greedy Model XI**. It's the demonstration surface for the distribution
work below.

## Roadmap

| P | Change | Status |
|---|---|---|
| **1** | Bonus + defensive-contribution + GK saves in `nativeXP`; adaptive blend | **done** |
| **2** | `minutesModel` — `P(start)` / expected minutes from start-share + minutes-share **blended with live availability** (status + chance-of-playing from the news feed), so a doubt reshapes the minutes rather than a flat scale. `nativeXP` and `xP` now consume it (and `xP` no longer double-scales availability). | **done** |
| **3** | `pointsDist` — a real seeded per-player **Monte-Carlo** of the gameweek from the same components (mean, P10/P50/P90, haul/blank). Wired into the captain cards: the outcome band and **haul/blank %** are now simulated, not heuristic. | **done** |
| **4** | `squadSim` — **correlated** whole-XI projection: teammates share one clean-sheet outcome and one attacking shock per team, so a stacked defence / doubled-up attack gets the fatter tails it deserves; captain doubles. Surfaced as "Projected next GW" on My Squad. Plus `rankOptimiser` — a **rank-EV** transfer optimiser (`effEdge`/`rankEV`/`normCdf`) that scores each candidate move by its **ownership-adjusted edge over the field** rather than raw points, and calls out where max-points and max-rank diverge. Surfaced as the "Rank optimiser" card on the Transfers page. | **done** |
| **5** | `calibration` — Brier + reliability curve grading engine; `gwedge_predictions` prediction log (service-role, live); `netlify/functions/log-predictions.js` — an **hourly scheduled function** that extracts the shipping model from `index.html` and logs each upcoming gameweek's forecast, then backfills actuals once a GW finishes; `model-calibration.js` serves the aggregate accuracy, shown as **"Live prediction accuracy"** on the Accountability page. | **done** |
| **6** | Match model: `recencyWeight` (0.97/GW decay so recent form counts more) in the live refit, and `availAttackMult` — a team whose **top expected-involvement attacker is flagged** is downgraded (−10% out, −4% doubt), tying the fixture model to the news feed. | **done** |
| **7** | **Advanced data ingestion (open source).** Goalkeeper `goals_prevented` from the [FPL Core Insights](https://github.com/olbauday/FPL-Core-Insights) mirror sharpens `nativeXP`'s keeper term (~1 pt per goal prevented / 90, coefficient set by `dev/model-validate.mjs`; inert without the mirror). Plus a **real‑actuals backtest** (`dev/backtest-vaastav.mjs`) against a historical season from the MIT‑licensed [vaastav dataset](https://github.com/vaastav/Fantasy-Premier-League), so accuracy is no longer graded only on synthetic data. | **done** |

| **8** | **Consistency pass over the scoring rules and the accountability loop.** Four defects found by reviewing the model against itself rather than against a harness that grades the same code: (a) `pointsDist` / `squadSim` gated scoring on an appearance draw and then still scaled by the *unconditional* `minFrac`, charging the absence twice — every distribution ran 12-20% light, and 29% for a rotation risk, biting hardest on exactly the players the rank tools weigh; (b) goalkeeper saves were credited as `E[S]/3` rather than `E[floor(S/3)]`, a flat +0.33 pts/GW on every keeper (`savePts`, mirroring `concedePts`); (c) the defensive-contribution term used a hand-picked logistic in `nativeXP` and a Poisson threshold in the simulators — now one `dcHitProb` in both, so the point estimate is the expectation of the event simulated; (d) `horizonXP` applied availability a second time on top of `nativeXP`, charging a 50% doubt as 25% across the whole solver and transfer surface, while every other `fixtureXP` caller left the fallback branch unscaled — availability now lives in `fixtureXP`, once. Plus deductions drawn as whole points instead of shaved off an integer score, which had been silently deleting the entire probability mass at exactly 10 from every haul figure. **The accountability loop was also grading a different model than ships**: `log-predictions.js` built its bootstrap with no Elo map and no European calendar, so promoted clubs were logged on the generic prior and every club in Europe without its congestion discount; and it compared a single-fixture projection against a whole-gameweek actual, booking a phantom miss on every double. | **done** |

The strategic payoff is P3–P4: forecasting **distributions** rather than
point estimates, then optimising for **expected rank** vs the field (given
ownership) rather than raw points — which is what actually moves a manager
up their mini-league. Both halves are now shipped: the rank-EV **team
optimiser** (`rankOptimiser`) turns `squadSim`'s distribution work into a
concrete transfer call on the Transfers page, and the **scheduled
prediction logger** feeds `calibration` on the Accountability page.

## Accuracy — where the model is strong and where it is not

`node dev/backtest-season.mjs` walks a full simulated 2025/26 season
(2025/26 rules) forward: at each deadline the model sees only
season-to-date aggregates, predicts the gameweek, and is scored against
the realized points. Crucially the ground-truth generator is
**deliberately mis-specified** relative to the model — it injects
finishing skill vs xG, penalties, overdispersion/form streaks, minutes
regimes and negatives (reds/OGs/pen-misses) — so it stress-tests the
model's *specification*, not its self-consistency. (The live FPL API is
firewalled from CI, so this is a simulation study; a real snapshot ports
straight into `model-validate.mjs`.)

**Real‑actuals cross‑check (P7).** `node dev/backtest-vaastav.mjs` grades the
*shipping* `nativeXP` (extracted verbatim from `index.html`) against a real
historical season from the open vaastav dataset — real underlying stats and
real realised points, no synthetic generator. Fixture conditioning is
neutralised (it isolates the per‑90 scoring core; the Dixon‑Coles layer is
covered end‑to‑end by `backtest-season.mjs`), and vaastav's own `xP` column is
dropped for its documented lookahead bias. On 2023/24, **conditional on the
player appearing** the scoring core beats the 3‑GW form baseline on real
actuals (MAE 2.145 vs 2.37, and season PPG 2.176). On *all* player‑gameweeks raw MAE is
minutes‑dominated — recent form implicitly encodes rotation that a pure
scoring model omits — which is precisely the gap the separately‑validated
`minutesModel` closes in the live app. A trimmed sample season is committed so
the check runs offline in `npm test`; `npm run fetch:vaastav` pulls a full one.

**Club Elo as a prior where we have none.** `PLSIM.priors` are attack/defence
multipliers fitted offline, per club. Anything outside that table — a promoted
side with no entry, a club that changed its name — fell back to
`PLSIM_PROMOTED`: one generic number applied identically to every such team,
so a strong promoted side and a weak one got the same starting guess.

`/api/team-elo` reads the `elo` column from the open FPL‑Core‑Insights
`teams.csv`, keyed by the official FPL team id so there is no name matching.
The mapping is a log‑linear fit of *our own* priors against Elo across the
2026/27 clubs — correlation **+0.86** on attack and **−0.93** on defence — so it
reproduces the priors we already trust before being asked to extend them.

It is used **only** where no fitted prior exists. Held out leave‑one‑out, an
Elo‑derived prior is **67% closer on attack and 82% closer on defence** than the
generic promoted prior it replaces; against a real fitted prior its residual is
around 8%, so overriding one would be trading down, and it does not. That
comparison is pinned in `dev/test-core.mjs` against a committed Elo snapshot,
along with a check that the shipped coefficients still both *track* the fitted
priors and *spread* clubs as much as they do — closeness alone would be
satisfied by returning 1.0 for everyone, which is precisely the useless answer.
A rating outside a plausible band (800-2600 Elo) is dropped rather than clamped,
so a broken value falls back to the generic prior instead of becoming a
confident wrong one. Note the two guards are different things: that one drops
the *rating*, while `ELO_CLAMP` pins the *derived multiplier* to [0.55, 1.60] —
a backstop that does not bind at real Premier League Elo spreads, but that would
produce a clamped extreme rather than a fallback if it ever did.

**Stratified by outcome band.** One average over every player‑gameweek hides
where a model is actually weak, so the backtest also reports **RMSE split by
outcome**, after [OpenFPL](https://arxiv.org/abs/2508.09992): *Zeros* (did not
play), *Blanks* (played, ≤2), *Tickers* (3–4) and *Haulers* (≥5). The bands
partition the scored population — every row matches exactly one, asserted
rather than assumed.

The split earns its place immediately. Blended together, recent form beats the
scoring core on “all player‑gameweeks” and the reason is invisible. Split by
band on 2023/24 it is unambiguous: the core wins **every band in which the
player actually took the pitch** (blanks 1.848 vs 2.303, tickers 1.201 vs 2.100,
haulers 5.242 vs 5.528) and loses only the did‑not‑play band (2.737 vs 1.550) —
which is exactly the availability signal this run strips out by design. One row
now carries the whole confound instead of it contaminating the average.

> Every figure on this page is printed by the harness that produced it, on each
> `npm test` run. They move whenever the model does, so if this page and a run
> ever disagree, the run is right.

Error is **not** monotonic in the size of the outcome, which is worth stating
because it is the intuitive and wrong expectation: it is smallest in the band
nearest the model’s central prediction (tickers) and grows in both directions,
worst on the hauls that actually move rank.

For orientation, OpenFPL reports 0.818 / 1.291 / 1.517 / 5.142 across those
bands and the FPL Review Massive Data Model 0.689 / 1.189 / 1.594 / 5.172.
**Not like‑for‑like** with the figures above: both forecast a real gameweek
with real fixtures and minutes — their low *Zeros* number is a
minutes‑prediction result, not a scoring one — while this run neutralises
fixture conditioning to grade the per‑90 core alone. Their numbers are the
shape to expect across bands, not a scoreboard.

**What holds up:**
- `nativeXP` MAE **beats a 3-GW form baseline** (2.39 vs 2.79 synthetic; 2.145
  vs 2.37 on real appearance‑conditional actuals) and season‑PPG, so the added
  categories earn their place.
- `pointsDist` haul-probability is **well calibrated** (Brier 0.0711, reliability
  tracks the diagonal), and the **p90 ceiling is honest**: 9.93% of actuals beat
  it against a 10% target. The p10 floor is limited by discreteness — most
  players floor at 0 and an actual cannot fall below that — so only 2.91% land
  under it and the nominal 80% band therefore covers 87%. The tail a captain
  pick actually reads is the upper one.
- Captaining the model returns **+2.8 pts/GW over the highest-form pick**
  (9.10 vs 6.30), with regret against perfect hindsight down to 12.83.

**Fixes shipped off the first backtest** (bias by position, before → after):
1. **Goals-conceded term** for GK/DEF — was the biggest miscalibration:
   GK **+0.55 → −0.13**, DEF **+0.71 → −0.04**. The model scored the
   clean-sheet upside but never the −1-per-2-conceded downside.
2. **Overdispersed `pointsDist`** — a gamma-Poisson form multiplier gives
   returns the right-skew (streaks/hauls) a plain Poisson misses.
3. **Two-state minutes model** — a start-plus-cameo mixture (with a
   minutes-implied start floor) instead of a flat minutes-share scale.
4. **Expected-deduction term** for cards / own goals / penalty misses.
5. **Finishing-aware goals** (`effGoalRate`) — shrunk goals-vs-xG blend.

Net: overall MAE **2.61 → 2.39**, and the per-position bias spread collapsed
from `[−0.13, +0.71]` to a tight, near-uniform band — see P8 for where it
stands now.

**What the P8 consistency pass moved** (`dev/backtest-season.mjs`, same harness
before and after — only the model changed):

| | before | after |
|---|---|---|
| MAE (`nativeXP`) | 2.41 | **2.39** |
| GK MAE / bias | 1.54 / **+0.17** | **1.48** / **−0.06** |
| DEF MAE | 2.33 | **2.31** |
| MID MAE | 2.60 | **2.58** |
| captain pts/GW | 8.20 | **9.10** |
| haul Brier | 0.0730 | **0.0711** |
| actuals above p90 (target 10%) | **17.70%** | **9.93%** |

and on real returns (`dev/backtest-vaastav.mjs`): appearance-conditional MAE
2.155 → **2.145**, with three of the four outcome bands improving (zeros 2.771 →
2.737, blanks 1.871 → 1.848, tickers 1.230 → 1.201; haulers 5.229 → 5.242).

The captain line is the one that matters most for a manager: correcting the
conditional-minutes error raised every distribution, but it raised the rotation
risks furthest, which is what changed the ranking rather than just the level.

**One thing got honestly worse.** Overall bias moved −0.16 → **−0.22**. The old
goalkeeper saves over-credit and the over-generous defensive-contribution
logistic were *positive* errors sitting on top of a model that under-forecasts;
removing them stopped two wrongs cancelling and exposed the real residual. It is
now small, uniform and one-directional across GK/DEF/MID, which is the shape a
single global recentre fixes — and that recentre belongs on live returns via the
P5 loop, not fitted to this simulation.

**What the backtest now flags next:**
- **Forwards** are still under-forecast (~−0.4 pts/GW): bonus
  concentration, rebounds and secondary chances that pure-xG misses. A
  forward-specific calibration term is the next win — best fit on live
  data, not this simulation.
- The residual upper-tail thinness tracks that forward under-forecast (the
  hauling position breaching its own ceiling), so the same fix closes it.
- **Minutes-regime state — now shipped.** `minutesModel` blends a
  recency-weighted start/minute share from `element-summary` history
  (`recentMinutes`, via `el._recent`) for the linked squad, so a newly
  nailed or benched player is caught long before the season average moves.
- **Player-level concede — now shipped.** `concedePts` blends each
  defender's own `expected_goals_conceded_per_90` with the team clean-sheet
  odds, so a leaky defender on a decent team is rated below a stingy one.
- These last-mile parameters (overdispersion `k`, finishing weight, a
  global recentre) should be tuned on real returns via the **P5 calibration
  loop**, not to the synthetic DGP.

## Recorded validations

### DECAY_BASE — fitted, and found inert at the horizon we ship

`solvePlanMulti` discounts future gameweeks by `DECAY_BASE^n`. The value
(0.9) was taken from the public open-fpl-solver's `decay_base`, so it was a
borrowed default rather than a measured one. `dev/fit-decay.mjs` measures it.

**Method.** A rolling-horizon simulation over four real seasons (2021-22 to
2024-25, vaastav): start from a random legal squad, and at each gameweek
build projections from data strictly before that deadline, run the app's own
`solvePlanMulti`, apply only that week's action (transfers, bank, free
transfers, hits), pick the XI by projection and score it on **actual**
points with auto-subs. Every decay value sees the same seasons, the same
starting squads and the same projections, so the comparison is **paired** —
which removes most of the variance that would otherwise swamp a season-level
signal. vaastav's own `xP` column is never read: its README warns it is
filled in post-match.

**Result — points per season vs no discounting (2 standard errors):**

| horizon | runs | 0.6 | 0.8 | 0.9 | 0.95 |
|---|---|---|---|---|---|
| **3 (shipped)** | 96 | −9.8 ± 17.2 | −7.6 ± 14.6 | **−4.4 ± 13.6** | −8.3 ± 12.2 |
| 4 | 48 | +3.5 ± 21.6 | +1.2 ± 25.7 | **+12.8 ± 20.4** | −0.6 ± 17.8 |
| 8 | 48 | **+43.1 ± 29.6** | +40.0 ± 24.5 | +25.3 ± 25.8 | +18.7 ± 21.6 |

**At the three-gameweek horizon the app actually runs, the discount does
nothing measurable.** Every value sits within noise of 1.0 (no discount),
with a slightly negative point estimate. It is not possible to distinguish
0.9 from switching the mechanism off.

**Discounting only earns its keep over long horizons.** At horizon 8 every
discount beats none by 19–43 points a season and most are individually
significant — which is precisely the regime open-fpl-solver operates in
(`horizon: 8`), and explains why the parameter exists there.

**A longer horizon is not the answer either.** Undiscounted horizon 8 scores
~2005 points against ~2044 at horizon 3; even at its best decay it only
reaches ~2048. Planning further ahead on projections this uncertain loses
more than the discount recovers.

**Why 0.9 stays.** It costs nothing measurable, it is directionally correct
(a distant projection genuinely is less certain), and it is the value that
becomes materially right if the horizon is ever extended. There is also a
bias worth stating: the harness projects with a simpler model than the app
ships, and a *worse* forecast warrants *more* discounting. So this experiment
is tilted toward finding decay useful — and still found no benefit at
horizon 3. That argues against lowering the value, not for it.

**What it does change.** Decay reduces speculative hits (49 → 44 points of
hits a season at horizon 3) but the transfers it suppresses were worth about
what they cost, so the totals net out.

**Limitations.** The harness uses a proxy projection (rolling shrunk points
per 90 plus an opponent-strength term) rather than the app's full expected
points model, which cannot be reconstructed point-in-time from this dataset;
it enforces the three-per-club rule outside the solver rather than inside it;
and it models neither chips nor price changes. It grades the *sequencing*
decision, not the projection.


### 2026/27 pre-season — match model vs the betting market (GW1)

Before GW1 the match model has no finished fixtures to fit, so its team
ratings equal the offline priors. We reproduced the model's GW1 output
(team expected goals and clean-sheet odds for all 20 teams) and compared it
to a Pinnacle-derived market board (projected goals + clean-sheet % from
totals/handicap markets). This is an independent check that the priors are
calibrated, not a self-consistency test.

- **Attack** — our team xG vs market projected goals: **Pearson r = 0.94**.
- **Defence** — our clean-sheet % vs market clean-sheet %: **r = 0.92**.
- **Rankings agree at both ends**: easiest GW1 fixtures ARS / MUN / MCI
  (FDR 1), hardest COV / HUL / BOU (FDR 5) — matching the market and the
  community FDR boards (Meerkat, Marcello).

**Divergence — the model is compressed at the extremes.** The market prices
the elite-vs-weak mismatches more aggressively than the shrunk priors do:
Arsenal (home to Coventry) reads **46% CS for us vs 62%** for the market,
and **2.36 xG vs 2.67**. This is the same pre-season compression seen in the
logged predictions (top GW1 xP only 5.4). It is expected from prior
shrinkage and self-corrects as live results feed the fit; the honest fix, if
any, is to widen the prior spread via the **P5 calibration loop** on real
returns rather than fit to one bookmaker's board.

> Reproduced with `dev/` model math against the GW1 fixture list; the live
> FPL API is firewalled from CI, so the market board was the external
> reference.

### 2026/27 pre-season — chip model vs the community FH4 / WC6 consensus

Checked `chipAdvice` against the pre-season community chip plan (Free Hit
GW4, Wildcard GW6). **Partial agreement — one bounded gap.**

- **Where it agrees**: the model correctly encodes the proven, event-driven
  chip theory — Triple Captain and Bench Boost on the next **double**, Free
  Hit on the next **blank** (with the highest confidence on a blank straight
  after a double), Wildcard on an injury pile-up (three-plus flagged XI
  players). That is where these chips return the most points.
- **The gap**: the community FH4 / WC6 calls are **fixture-swing** driven —
  Free Hit the gameweek the popular template teams collectively hit hard
  fixtures (the Man Utd v Man City clash in GW4), Wildcard at the post-
  international-break inflection (GW6) to reshape for the GW6–15 run. Before
  any double or blank is scheduled, `chipAdvice` returns **hold** for Free
  Hit and Wildcard (its copy already says *"hold for a blank or a big
  fixture swing"*), so it does not reproduce FH4 / WC6.

**Conclusion**: the model was right for the DGW/BGW meta but silent on early-
season fixture-swing chip timing.

**Closed (shipped).** `chipSwings` now computes the swing windows from the FDR
grid + live team ownership and surfaces them on the Fixture Planner as
"Fixture-swing chip windows":
- **Free Hit** = the gameweek where the ownership-weighted mean difficulty of
  the field's teams peaks (flagged only when it clears the window average by
  ≥12%) — the field scores least, so a one-week bespoke XI gains most.
- **Wildcard** = the boundary where the current best-fixture teams (lowest
  difficulty over the prior 3 GWs) turn hardest over the following N, i.e. the
  reshape that sheds the most difficulty.

These complement — do not replace — the double/blank calls in `chipAdvice`.

## Test & tooling

- `npm test` — unit tests over the model core (every helper above), the
  prediction-logger and Core-Insights aggregator, plus the real-actuals backtest.
- `node dev/backtest-season.mjs` — walk-forward season backtest + the
  "where to improve" report (the section above is generated from it).
- `node dev/model-validate.mjs [snap.json]` — A/B accuracy backtest (now
  including the goalkeeper `goals_prevented` refinement); `snap.json` runs it
  against real finished-gameweek actuals. Its ground-truth generator used to
  omit the goals-conceded deduction entirely and draw the clean sheet
  independently of it — so a model carrying a correct `−1 per 2 conceded` term
  was marked down for it. It now draws one goals-against count and reads the
  clean sheet off it, as `backtest-season.mjs` and the file's own
  goals-prevented generator already did. Under that corrected harness, the P8
  terms move overall MAE 0.40 → **0.30** and bias +0.33 → **+0.14** (GK 0.38 →
  **0.25**; forwards unchanged, as they carry neither term).
- `npm run fetch:vaastav [season]` then `node dev/backtest-vaastav.mjs [season]`
  — real-actuals backtest against the open vaastav dataset (P7). Runs on a
  committed trimmed sample offline; pull a full season for a fuller run.
- `node dev/simulate-gameweek.mjs [--html out.html]` — the model's
  gameweek outputs.

> Harness note: the unit-test extractor matches functions by brace, and
> does not skip comments — so **model function comments must avoid
> apostrophes** (they read as string delimiters and break extraction).
