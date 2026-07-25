# Scoping — Full-season planner

A deliberate scoping note for the one feature multiple competitors (Premier
Fantasy Tools, NextXI) have that Gameweek Edge does not: a **38-gameweek planner**
where a manager maps out transfers, chips, captains and formation across the
whole season on one board. This is a *large* feature — this doc is for deciding
whether and how to build it, not a spec to implement blind.

## 1. What it is

A season board: one column (or card) per gameweek from now to GW38. In each
gameweek the user can:

- set **transfers** (out → in), with running **bank** and **team value**;
- mark a **chip** (WC / FH / BB / TC / AM), one per slot, validated against
  chips already used;
- pick a **captain / vice**;
- choose a **formation**;
- add a free-text **note** (e.g. "DGW — triple up", "price rise deadline");
- see the resulting **projected points** per gameweek and cumulative, from the
  existing `xP` / `squadSim` model, plus the fixture difficulty already on the
  Fixture Planner.

The value over what we ship today: our Transfer Planner is a 0–3 move solver
plus a 3-GW beam search. It answers "what should I do now / soon". It does **not**
let a manager author and persist a whole-season plan they can revisit and adjust.

## 2. Why it is a big build (be honest)

Everything we have shipped so far is **stateless per view** — compute from live
data and render. A season planner is the first feature that needs a **persistent,
user-authored, multi-step document**: a squad evolving across 38 gameweeks under
FPL rules, saved and re-loaded. That is a different class of feature.

Hard parts:

1. **Forward squad simulation under the rules.** Applying a transfer in GW10
   changes the squad for GW10–38; bank and value must roll forward; the 3-per-club
   and position quotas must hold at every step; free-transfer accrual (max 5) and
   −4 hits must be tallied. This is stateful rules-engine work, not a render.
2. **Selling price.** Exact selling price needs the authenticated `my-team`
   endpoint the public proxy cannot use — so, like the Transfer Planner today, we
   approximate sale value as current price and label it. (Documented limitation.)
3. **Persistence + sync.** The plan must save. Options below.
4. **UI density.** 38 gameweeks × several controls each is a lot of surface,
   especially on mobile. Needs a compact, scannable layout with a detail view.
5. **Projection cost.** Re-projecting every gameweek on each edit must stay
   snappy — memoise per (squad-hash, gw).

## 3. Suggested data model

A plan is a compact JSON document, versioned:

```
plan = {
  v: 1,
  season: "2026/27",
  base: [elementId × 15],            // starting squad (linked team or a draft)
  gws: {                             // sparse — only gameweeks the user touched
    "10": { transfers:[{out,in}], chip:"wildcard"|null, captain, vice,
            formation:[d,m,f], note:"" },
    ...
  }
}
```

Everything else (bank, value, XI, points, free transfers) is **derived** by
replaying `base` through `gws` in order — never stored, so it can never drift
from the rules engine.

## 4. Persistence options (pick one)

| Option | Effort | Notes |
|---|---|---|
| **localStorage only** (`ge-plan-v1`) | Low | Ships fastest; per-device, no sync. Matches how the Pre-season Draft persists today (`ge-draft-v1`). |
| **localStorage + Supabase sync** | Medium | New `gwedge_plans` table, RLS `auth.uid()=user_id`, merged on sign-in — same pattern as watchlist / rivals. Cross-device. |

Recommendation: **ship v1 on localStorage**, add Supabase sync in a follow-up
once the board earns its keep. Do not build sync first.

## 5. Reuse — most of the engine already exists

- **Projection:** `xP`, `horizonXP`, `squadSim`, `bestXI` — per-gameweek points.
- **Fixtures / difficulty:** `plsimRatings` / `plsimMatch` / `plsimDiff`,
  `buildHorizon`, and the new full-season grid.
- **Transfer legality:** `draftValidate` / `draftCanAdd` already enforce budget,
  3-per-club and quotas for the Pre-season Draft — the same checks a plan step
  needs.
- **Chip logic:** `chipAdvice`, `chipSwings`, `gwSwing` for suggested timing.

So the **new** code is mainly: (a) the forward replay/rules engine that threads a
squad through gameweeks, (b) the board UI, (c) persistence. The analytics are
already ours.

## 6. Suggested phasing

- **Phase 1 — read-only season outlook.** For the *current* squad (no edits),
  show projected points + fixture difficulty per gameweek to GW38, with chip-window
  and captain suggestions overlaid. Almost entirely reuse; delivers 60% of the
  value and de-risks the projection cost. *Small.*
- **Phase 2 — editable transfers + chips + captain, localStorage.** Add the
  forward replay engine and the board controls; persist locally. *Large — the
  real build.*
- **Phase 3 — Supabase sync + notes + shareable plan.** *Medium.*

## 7. Risks / open questions

- **Selling-price approximation** will make long-horizon value drift; label it
  clearly and cap how far value is trusted.
- **Mobile UX** is the biggest design risk — 38 gameweeks needs a horizontal
  scroller with a per-GW detail sheet, not everything on screen.
- **Scope creep** toward a full "team of the season" optimiser — keep v1 a
  *manual* planner with model *suggestions*, not an auto-solver.

## 8. Recommendation

Build **Phase 1** first as its own shippable feature (season outlook for the
current squad) — it is small, reuses the engine, and validates demand before the
heavy Phase 2 rules engine. Decide on Phase 2 once Phase 1 is live and used.
