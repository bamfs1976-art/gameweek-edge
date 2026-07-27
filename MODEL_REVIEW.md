# Gameweek Edge — model accuracy & effectiveness review

*Review date: 2026-07-27. Scope: the forecasting model (`plsim*`, `minutesModel`,
`nativeXP`, `xP`, `pointsDist`, `squadSim`, `rankOptimiser`, `calibration`) and the
P5 accountability loop, after the recent run of work — Elo priors, the European
congestion feed, outcome-band backtesting, the chip planner and the bench/FT-aware
solver. Read-only review; no model code was changed.*

> **Resolution (2026-07-27).** All eight findings are now fixed and shipped; the
> outcome is recorded as **P8** in `docs/MODELLING.md`. Headlines, same harness
> before and after: MAE 2.41 → **2.39**, captain **8.20 → 9.10 pts/GW**, actuals
> above p90 **17.70% → 9.93%** (target 10), haul Brier 0.0730 → **0.0711**, GK
> bias **+0.17 → −0.06**; on real returns appearance-conditional MAE 2.155 →
> **2.145** with three of four outcome bands improving. Overall bias moved
> −0.16 → **−0.22** — worse on paper, and honestly so: two positive
> specification errors had been cancelling a real under-forecast. The remaining
> residual is uniform and belongs to a global recentre on live returns.
>
> The review below is left as written, as the record of what was found.

## Verdict

The model core is in good shape and the recent work is real: the Elo prior, the
congestion-aware minutes model and the outcome-band backtest each close a gap that
was genuinely open, and every one of them is pinned by a test. The walk-forward
numbers reproduce, the real-actuals backtest reproduces, and `npm test` is green
(233 + 214 assertions).

But the review found **one specification error in the simulation layer that biases
every distribution the app shows** — `pointsDist` and `squadSim` discount expected
minutes twice — plus a smaller one in the goalkeeper term, and an availability
scaling applied twice across the whole transfer/solver surface. None of these show
up in `backtest-season.mjs`, because the harness grades the same code that contains
them.

Separately, the recent additions have quietly pulled the **accountability loop out of
sync with the shipping model**: the hourly logger grades a version with no Elo priors
and no congestion, so the public "Live prediction accuracy" figure no longer measures
what users see.

Ranked findings below. F1–F3 are model defects with measured magnitudes. F4–F5 are
measurement-integrity issues. F6–F8 are claims that no longer match the code.

---

## Evidence base

Everything below was reproduced in this sandbox against the shipping source
(functions extracted from `index.html` by brace matching, as the test harness does):

| Harness | Result |
|---|---|
| `npm test` | 233 passed / 0 failed, 214 passed / 0 failed, backtest checks passed |
| `dev/backtest-season.mjs` | MAE 2.41 vs 2.79 form / 2.58 PPG · bias −0.16 · Spearman 0.47 · captain +1.90/GW · p10–p90 coverage 79.24% · haul Brier 0.0730 |
| `dev/backtest-vaastav.mjs` | appearance-conditional MAE 2.155 vs 2.37 form (beats form) · bands 2.771 / 1.871 / 1.230 / 5.229 |
| `dev/model-validate.mjs` | MAE −82.3% vs the pre-P1 model · GK `goals_prevented` −43.1% GK MAE |

Those all confirm the headline claims. The findings below come from probing the
model directly, which the harnesses do not do.

---

## F1 — `pointsDist` and `squadSim` discount expected minutes twice

**Severity: high. Affects every distribution the app shows.**

Both simulators gate the whole scoring block on an appearance draw, and then
*still* scale each per-90 rate by `m.minFrac` — the **unconditional** expected
minutes, which already averages in the matches the player does not appear in:

```js
const play = rnd() < m.pAppear;
if (play) {
  pts += pois(xg * m.minFrac * fx * form) * gPts;   // minFrac already includes P(no appearance)
  ...
}
```

Inside that branch the correct quantity is `E[minutes | appeared]`, i.e.
`minFrac / pAppear`. The code gets this exactly right for the 60-minute flag one
line above (`p60c = min(1, m.p60 / m.pAppear)`), which is what makes it look like an
oversight rather than a modelling choice.

Measured against `nativeXP` on the same inputs (120k trials):

| Player | pAppear | `nativeXP` | `pointsDist.mean` (shipped) | with conditional minutes | haul % shipped → corrected |
|---|---|---|---|---|---|
| GK | 0.850 | 5.703 | 4.718 (**−17.3%**) | 5.171 (−9.3%) | 6.64% → 9.03% |
| DEF | 0.850 | 6.490 | 5.217 (**−19.6%**) | 5.958 (−8.2%) | 11.61% → 15.68% |
| MID | 0.850 | 5.296 | 4.654 (**−12.1%**) | 5.129 (−3.2%) | 9.64% → 12.36% |
| FWD | 0.850 | 5.127 | 4.495 (**−12.3%**) | 4.982 (−2.8%) | 8.14% → 11.10% |
| MID, rotation risk | 0.583 | 3.867 | 2.740 (**−29.2%**) | 3.755 (−2.9%) | 3.93% → 9.70% |

Two things matter here beyond the size:

1. **The bias is not uniform — it scales with `1 − pAppear`.** A nailed starter loses
   12%; a rotation risk loses 29% and more than half his haul probability. So it does
   not wash out of comparisons. `rankOptimiser` builds `effEdge` on `pointsDist`, which
   means the rank-EV engine systematically over-penalises exactly the rotation-risk
   differentials it exists to surface.
2. **It is why `nativeXP` and `pointsDist` disagree in the UI.** The card shows `xP`
   (blended with `nativeXP`); the captain band, haul % and blank % beside it come from
   `pointsDist`. They are two estimates of the same quantity that differ by 12–20%.

Downstream: captain outcome bands and haul/blank on Captaincy Lab, "Projected next GW"
on My Squad (`squadSim`, same structure), the Rank optimiser card, and the
`haul_prob` / `blank_prob` columns the hourly logger writes to `gwedge_predictions`.

**Note on the calibration evidence.** `backtest-season.mjs` grades the shipped
`pointsDist`, so the reported Brier 0.0730 and reliability curve already contain this
bias. The curve reads `0.02→0.06`, `0.14→0.19`, `0.23→0.29`, `0.34→0.30` — three
buckets under-predicting, carrying 10,169 of 10,222 rows, against one over-predicting
bucket of 53. Raising the probabilities should improve the Brier, not worsen it. The
"well calibrated" claim in `docs/MODELLING.md` is defensible but is currently resting
on a simulator that under-states hauls.

---

## F2 — goalkeeper saves are credited as `E[S]/3`, not `E[floor(S/3)]`

**Severity: medium. Constant +0.33 pts/GW on every goalkeeper.**

`nativeXP` scores saves continuously:

```js
const sv90 = (el.saves||0) * 90 / Math.max(mins,90);
pts += (sv90 * m.minFrac) / 3;
```

FPL pays `floor(saves / 3)`, and the floor is not free — the expected remainder is
about one save, worth a third of a point, at every realistic save rate:

| saves/match | `E[S]/3` (model) | `E[floor(S/3)]` (FPL) | over-credit |
|---|---|---|---|
| 2.0 | 0.667 | 0.340 | +0.327 |
| 3.0 | 1.000 | 0.665 | +0.335 |
| 4.6 | 1.533 | 1.200 | +0.334 |
| 6.0 | 2.000 | 1.667 | +0.334 |

The same function already handles the identical "−1 per 2 conceded" mechanic
correctly, via the closed form in `concedePts` (verified exact against a direct sum:
λ=1.3 → 0.4186 both ways). The saves term is the one place the discretisation was
dropped.

`backtest-season.mjs` generates GK points as `Math.floor(saves/3)`, so this is already
being measured — it is most of the residual **GK bias +0.17**. Worth flagging before
anyone "fixes" it: correcting the saves term alone would push GK bias to roughly
−0.17, because it is currently masking an offsetting under-forecast elsewhere in the
keeper model. Land it with a GK recentre, and grade it on the live P5 log.

---

## F3 — `horizonXP` scales availability twice

**Severity: medium. Affects the entire transfer and solver surface.**

P2 removed the double availability scale from `xP`, but `horizonXP` still carries it:

```js
function horizonXP(b, el, hz) {
  const chance = el.chance_of_playing_next_round == null ? 100 : el.chance_of_playing_next_round;
  let total = 0;
  fxs.forEach(fx => total += fixtureXP(b, el, fx));   // fixtureXP -> nativeXP -> minutesModel, already scaled by chance
  return total * (chance / 100);                       // ...scaled again
}
```

Measured (3 identical fixtures):

| chance | 3 × `nativeXP` | `horizonXP` | ratio |
|---|---|---|---|
| 100% | 15.889 | 15.889 | 1.000 |
| 75% | 11.917 | 8.937 | **0.750** |
| 50% | 7.944 | 3.972 | **0.500** |
| 25% | 3.972 | 0.993 | **0.250** |

A 75% doubt is charged as 56%; a 50% doubt as 25%. The `fixtureXP` *fallback* path
(when `nativeXP` returns null) is not availability-scaled, so the trailing multiply is
correct there and wrong whenever the native model is live — which is the normal case
from GW5.

`horizonXP` feeds `solvePlan`, the multi-week solver's candidate pool, the deadline
card, Value Picks, the player list, similar-player search, `plCard`, and the AI
transfer planner context string. Fit players are unaffected, so this is a pure
distortion of flagged-vs-fit comparisons.

---

## F4 — `pointsDist` subtracts a fractional deduction from an integer score

**Severity: medium. Understates haul probability by ~2–2.5pp.**

```js
pts -= negExp * m.minFrac;   // e.g. 0.15 — expected cards/OG/pen-miss
```

Every other term in the loop is an integer draw. Subtracting a fractional constant
means a trial that scores exactly 10 lands on 9.85 and is not counted as a haul —
so the entire probability mass at exactly 10 is lost, regardless of how small the
deduction is. Charging the same expected deduction as a discrete event instead
(60k trials):

| Player | E[deduction] | P(exactly 10) | haul, shipped | haul, discrete | artifact |
|---|---|---|---|---|---|
| MID | 0.150 | 1.84% | 9.66% | 11.61% | **+1.95pp** |
| FWD | 0.200 | 2.85% | 10.64% | 13.17% | **+2.53pp** |
| DEF | 0.350 | 2.71% | 11.63% | 14.12% | **+2.49pp** |

A 0.15-point deduction removes a fifth of the haul probability. It also leaves
`p10`/`p50`/`p90` non-integral, which is why captain bands can show fractional
doubled values. The blank threshold happens to be unaffected (nothing crosses ≤2).

This compounds with F1 in the same direction — both suppress haul probability.

---

## F5 — the accountability loop grades a different model than ships

**Severity: high for the product claim, not for the model.**

`netlify/functions/log-predictions.js` extracts the model from `index.html` at runtime
specifically so that "what is graded is precisely what the app shows". Two of the
recent commits broke that, and the function comments acknowledge each individually
without anyone stepping back to the aggregate:

- `indexBoot()` never sets `b.elo`, so `plsimPrior` falls back to `PLSIM_PROMOTED`.
  The app uses the Elo-derived prior. **Promoted clubs are logged from a different
  match model than the one users see** — the exact clubs the Elo work was built for.
- `indexBoot()` never sets `b.euro`, so `congestionLoad` returns 0 everywhere. The app
  discounts starts for European and cup load. **Every club in Europe is logged without
  the congestion discount**, i.e. most premium assets from the group stage on.

Both are one line each in `indexBoot` (fetch `/api/team-elo` and `/api/euro-fixtures`,
the same sources the client uses). Until then, the Model Accountability page is
grading a strictly older model, and the divergence grows with each data-source
addition. `el._recent` is also absent, but that one is legitimate — it is per-user
`element-summary` data that has no server-side equivalent.

**Also:** the logger grades `xP` against `event/{gw}/live/` `total_points`, but
`buildNextFix` keeps only the *first* unplayed fixture per team (`if(!map[f.team_h])`).
In a double gameweek the prediction covers one match and the actual covers two, so
DGW rows book a large spurious under-forecast. `solvePlanMulti` handles doubles
correctly via `buildGwFixtures`, so the capability exists — it is `buildNextFix`, and
therefore the headline `xP` on every panel, that is single-fixture. Either aggregate
the fixtures or exclude DGW rows from grading; silently mixing them corrupts the
public number.

---

## F6 — the accuracy figure shown to users is wrong on both halves

`index.html:9298`, in the "Explain this pick" drawer:

> Blended 50/50 with the native model … validated MAE 0.96 vs 1.04 form baseline

Neither half holds:

- The blend has not been 50/50 since P1. It is sample-adaptive:
  `w = min(0.7, 0.35 + 0.025 * gp)` — 0.475 at 5 games, capped 0.70 from GW14.
- **0.96 vs 1.04 does not correspond to any current measurement.** The season backtest
  gives 2.41 vs 2.79; the real-actuals backtest gives 2.155 vs 2.37. This is the only
  accuracy number exposed in the product, and it understates the model's error by more
  than half.

Repeated at `index.html:9605` (the `nativeXP` header comment, "24,173 player-matches
of 2025/26") and `docs/FEATURES.md:838`.

---

## F7 — the outcome-band figures in `docs/MODELLING.md` have drifted

The band table is the model's public accuracy record, and every figure in it has moved
since it was written — the minutes-model and Elo commits changed the backtest without
the doc being regenerated:

| Band | `MODELLING.md` | current run |
|---|---|---|
| Zeros | 2.57 vs 1.63 | **2.771 vs 1.55** |
| Blanks | 1.85 vs 2.22 | **1.871 vs 2.303** |
| Tickers | 1.24 vs 2.23 | **1.230 vs 2.100** |
| Haulers | 5.47 vs 5.76 | **5.229 vs 5.528** |
| Appearance-conditional MAE | ≈2.17 vs 2.34 | **2.155 vs 2.37** |

The qualitative conclusion still holds — the core wins every band in which the player
took the pitch. Haulers actually improved (5.47 → 5.23) and Zeros worsened
(2.57 → 2.77), which is a real signal about the minutes work that the stale table
hides. Worth having the backtest emit these into the doc rather than hand-copying.

---

## F8 — smaller notes

- **`eloPrior` clamps where the docs say it drops.** `docs/MODELLING.md` states
  "ratings outside a plausible band are dropped rather than clamped". That is true of
  the *rating* (`ELO_MIN`/`ELO_MAX` in `team-elo.js`) but not of the *derived
  multiplier*: `ELO_CLAMP=[0.55,1.60]` silently pins the output. A rating well inside
  the accepted band can still produce a clamped, confidently-extreme prior. It will
  rarely bind at real Premier League Elo spreads, so this is a documentation precision
  issue rather than a live defect — but the two sentences currently describe different
  behaviour.
- **Sale value is still assumed to be current price** in `solvePlan` and
  `solvePlanMulti`, which overstates budget. It is disclosed in the solver copy, and
  the `AUDIT.md` recommendation (authenticated my-team) remains the real fix.
- **`nativeXP` and `pointsDist` model defensive contribution differently** — a logistic
  on the raw per-90 rate versus a Poisson threshold on the minutes-scaled rate. For a
  defender at 11 CBIT/90 against a threshold of 10 that is 0.75 versus 0.42, worth
  ~0.64 pts/GW. Only one can be right; the Poisson form is the more principled of the
  two, though it is under-dispersed against real CBIT counts.
- **Backfill writes one row at a time.** `log-predictions.js` issues a separate
  `update()` per player per gameweek (~500+ round trips per graded GW). Correctness is
  fine; it will get slow and expensive. An upsert batch mirrors the logging path.

---

## What the model itself still flags

Unchanged and still the largest open item on the modelling side — the backtest reports
it every run:

- **Forwards under-forecast by −0.43 pts/GW**, the worst positional residual, from
  bonus concentration and secondary chances that pure xG misses.
- **Upper tail thin**: 17.70% of actuals beat p90 against a ~10% target, with only
  3.06% below p10. The asymmetry says this is mostly the mean under-forecast above,
  not a shape problem — F1 and F4 both push in the same direction and are likely a
  meaningful share of it.

Both should be calibrated against the live P5 log rather than the synthetic DGP —
which is exactly why F5 is worth fixing first.

---

## Suggested order

1. **F5** — reconnect the logger to Elo and congestion, and decide the DGW grading
   rule. Everything else should be graded on live returns, and the loop that does that
   is currently measuring the wrong model.
2. **F1** — conditional expected minutes inside the `play` branch of `pointsDist` and
   `squadSim`. Largest measured distortion, one line each, and it is the fix that most
   changes what the app recommends.
3. **F3** — drop the trailing `chance/100` from `horizonXP` on the native path.
4. **F4** — charge the expected deduction as a discrete event.
5. **F6 / F7** — correct the user-facing accuracy claim and regenerate the band table.
6. **F2** — the goalkeeper saves floor, landed together with a GK recentre once F5
   gives live returns to recentre against.

Items 2–4 all move projections **up**, and F1 and F4 both raise haul probabilities.
They should land together and be re-graded as a set — the season backtest's
`bias −0.16` and `Brier 0.0730` are computed on the code containing them, so those
figures will move.
