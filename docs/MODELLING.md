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
appearance (1 + 1 at 60')  +  goals (xG90 · mins · fixture · goalPts)
  +  assists (xA90 · mins · fixture · 3)  +  clean sheet (csPts · CS · p60)
  +  bonus  +  defensive contribution  +  goalkeeper saves
```

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
| **4** | `squadSim` — **correlated** whole-XI projection: teammates share one clean-sheet outcome and one attacking shock per team, so a stacked defence / doubled-up attack gets the fatter tails it deserves; captain doubles. Surfaced as "Projected next GW" on My Squad. *(Rank-EV optimiser UI is the remaining follow-on.)* | **done (engine)** |
| **5** | `calibration` — Brier + reliability curve grading engine; `gwedge_predictions` prediction log (service-role, live); `netlify/functions/log-predictions.js` — an **hourly scheduled function** that extracts the shipping model from `index.html` and logs each upcoming gameweek's forecast, then backfills actuals once a GW finishes; `model-calibration.js` serves the aggregate accuracy, shown as **"Live prediction accuracy"** on the Accountability page. | **done** |
| **6** | Match model: `recencyWeight` (0.97/GW decay so recent form counts more) in the live refit, and `availAttackMult` — a team whose **top expected-involvement attacker is flagged** is downgraded (−10% out, −4% doubt), tying the fixture model to the news feed. | **done** |

The strategic payoff is P3–P4: forecasting **distributions** rather than
point estimates, then optimising for **expected rank** vs the field (given
ownership) rather than raw points — which is what actually moves a manager
up their mini-league. The remaining follow-ons are the two "populate/act"
halves: a rank-EV **team optimiser** on top of `squadSim`, and the
**scheduled prediction logger** that feeds `calibration` on the
Accountability page.

## Test & tooling

- `npm test` — 236 unit tests over the model core (every helper above).
- `node dev/model-validate.mjs [snap.json]` — accuracy backtest.
- `node dev/simulate-gameweek.mjs [--html out.html]` — the model's
  gameweek outputs.

> Harness note: the unit-test extractor matches functions by brace, and
> does not skip comments — so **model function comments must avoid
> apostrophes** (they read as string delimiters and break extraction).
