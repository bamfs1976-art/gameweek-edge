# RaceWeek Edge — Feature Reference & Competitive Analysis

**Tagline:** *F1 fantasy, with an edge* — a model-first companion for the official F1 Fantasy game.
**Template:** built on the [Gameweek Edge](../../docs/FEATURES.md) shell — same navigation model, design system, panel/hydrator architecture and free/Pro tiering.

---

## 1. The competitive landscape (researched July 2026)

| Tool | Strengths | Weaknesses |
|---|---|---|
| **F1 Fantasy Tools** (f1fantasytools.com) | Market leader. Cracked the price algorithm (Budget Builder), live scoring, hindsight optimal teams, league visualisation | Paid (from €2.50/mo) for headline features; desktop-spreadsheet feel |
| **BoxBox** (boxboxf1fantasy.com) | Free ML projections (10k-run Monte Carlo), practice-updated, **public accuracy record incl. misses** | Solo-focused, league-blind, no live scoring |
| **GridRival** | Polished app, own community | An *alternative game*, not a companion to the official one |
| **F1 Data Space** | League dashboards ("LiveFPL for F1"), race hubs | Weak on prediction/optimisation |
| **F1 Fantasy Pro / Gridside / F1 Pitwall / GP Fantasy Predictor** | Single-feature indies: rival tracking, timezone calendar + alerts, optimizers | Narrow, fragmented |

**Pain points users are loudest about** (Trustpilot/app-store reviews of the official game + competitor positioning):

1. Official app reliability — bugs, slow live points, poor notifications.
2. Price-change prediction — the most monetised feature in the niche; exactly computable from the 3-race rolling PPM window.
3. Live points during sessions.
4. Mini-league rival analysis — demand visible, nobody does FPL-style depth.
5. Deadline/timezone UX — lock is at quali start (Friday on sprint weekends!) and moves wildly across timezones.
6. Chip timing — every site publishes generic guides; **nobody computes personalised chip EV**.
7. Sprint-weekend strategy tooling.
8. Projection transparency — BoxBox's public accuracy tab is the trust benchmark.
9. Track-specific history & weather integration — white space.
10. Post-race decision review ("what did that transfer earn me?").

**Positioning:** the incumbent is paid and spreadsheet-dense; the free challenger is solo-focused. RaceWeek Edge's wedge: **free core price/projection tools + best-in-class rival, chip-EV and deadline experience**, with Pro on race-day tools and intelligence.

## 2. How the gaps map to panels

| Gap / demand | RaceWeek Edge answer | Tier |
|---|---|---|
| Price prediction (table stakes) | **Price Predictor** — 3-race PPM bands (0.2/0.3/0.4), *exact* "points needed this weekend to rise/hold" arithmetic per asset | Free |
| Team optimiser | **Team Builder** (budget-reserving greedy + swap improvement), **Transfer Planner** (penalty-aware singles + two-move combos over a 3-round horizon), **Hindsight Optimal** | Free / Pro |
| Captaincy | **DRS Boost Lab** — safe vs differential 2x picks, and when to reach for the 3x chip instead | Free |
| Personalised chip EV (white space) | **Chip Strategy** — EV for *your team* for every unused chip at every remaining round (Limitless vs the no-cap dream team, No Negative vs your DNF exposure at high-SC tracks, Final Fix at volatile venues, 3x on sprint weekends…) | Free |
| Rival intelligence | **Rival Scout** — track up to 5 rivals' teams; overlap, differentials each way, projected gap. **Template Meter** vs the model reference team | Pro |
| Deadline / timezone UX | Lock-in countdown everywhere, **Race Centre** with all sessions in the user's timezone, Friday-lock warnings on sprint weekends, **Alerts** panel | Free |
| Sprint tooling | **Sprint Strategy** — the six sprint rounds, sprint scoring differences, team projections per sprint | Pro |
| Transparency | **Model Accuracy** — plain-English methodology + a committed round-by-round record incl. misses (the BoxBox playbook) | Free |
| Track insight | **Track Insights** — overtaking ease, safety-car odds, street/permanent per round + the model's pick there; traits feed the projections | Free |
| Decision review | **Season Review** — chips log now, full transfer/boost ROI when the results feed lands | Pro |
| Live scoring | **Points Simulator** now (exact scoring engine); live session points on the deploy roadmap via the results proxy | Pro |
| Fast rules answers | **Race Engineer** — a grounded local assistant answering boost/chip/price/track/rules questions from the model | Pro |

## 3. The model

- **Projection:** per driver per round — interpolated quali/race/sprint points from expected positions, positions-gained, overtake points scaled by each track's passing ease, fastest-lap & DotD probabilities, DNF expectation amplified at high safety-car venues. Street circuits compress spreads.
- **Constructors:** both cars + P(both into Q3)×10 + pit-crew tier expectation.
- **Price model:** the game's own 3-race rolling PPM banding; recent-race points are model-estimated until the results feed supplies actuals — the thresholds and "points needed" arithmetic are the real rules either way.
- **Title Race:** seeded Monte Carlo (2,000 season sims) over the remaining calendar.
- **2026 caveat, stated in-app:** all-new regulations reset historical form; ratings are estimates that tighten as rounds land.

## 4. Data

- `F1_TEAMS` / `F1_DRIVERS` — the 11-team, 22-driver 2026 grid (Cadillac and Audi included) with official launch prices.
- `F1_CALENDAR` — 22 rounds (Bahrain & Saudi cancelled), 6 sprints (China, Miami, Canada, Silverstone, Zandvoort, Singapore), lock-in + race times (UTC estimates), and per-track model traits.
- `SCORING` — the official 2026 scoring card and transfer/chip rules.
- Optional live layer: `/api/f1/*` → Jolpica-F1 (Ergast successor) for standings/results, allowlisted in `netlify/functions/f1.js`.

## 5. Roadmap

- Live session scoring through the proxy (flagship competitor feature).
- Push delivery for the Alerts panel (Web Push, service worker is already in place).
- Practice-updated projections + weather feed (the 2026-regulations differentiator).
- League import when/if the official API allows; manual rival entry ships today.
- Accounts/sync + Stripe billing — reuse Gameweek Edge's Supabase/Stripe functions.
