# Gameweek Edge — Feature & Function Reference

**Live app:** https://gameweekedge.netlify.app
**Tagline:** *FPL, with an edge* — a model‑first Fantasy Premier League companion.
**Repo:** `bamfs1976-art/gameweek-edge` · **Companion model repo:** `bamfs1976-art/Plsimulator`

This document is the single source of truth for what the app does, how it is
built, and where it can grow. It is generated from the current `index.html`
source, not from memory.

> **Developing on it?** See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for local
> setup (offline mock API + smoke test), recipes for adding panels/endpoints,
> conventions and the deploy flow.

---

## 1. What Gameweek Edge is

A single‑page web app (also packaged as an iOS app via Capacitor) that layers a
**fitted team‑strength model** and **validated player projections** on top of the
official Fantasy Premier League data. Where most FPL tools are broad stat
dashboards, Gameweek Edge is *opinionated*: it produces a model captain, a
best‑value pick, an expected‑points (xP) pool, a model Team of the Week, a
transfer solver, and a hybrid AI scout — all grounded in its own numbers.

Everything runs from the live official FPL API through a serverless proxy. When
the 2026/27 season opens, the app populates automatically — no manual update.

**Core pillars**

| Pillar | Delivered by |
|---|---|
| Model‑driven xP picks | Captaincy Lab, Scout AI, Transfer Solver, Fixture Planner |
| Gameweek snapshot | Dashboard, This Gameweek |
| Live matchday | Live Percentile, Bonus Tracker, DefCon Threats, Auto‑Sub Tracker, What‑If |
| Team linking | Squad, Transfers, Captaincy, Live Percentile, Manager Report, Mini‑Leagues |
| Intelligence & AI | Scout AI, Ask the Scout, EO/Template/Rival tools |
| Content | The Wire (auto blog), Team of the Week |

---

## 2. Site map

Navigation is organised into **7 areas** and **38 panels**. Free panels are open
to everyone; **Pro** panels require an upgrade (or owner access, see §9).

```
Home
├── Dashboard            (free)  Season snapshot, key actions, live alerts
├── This Gameweek        (free)  The 4 weekly decisions + crowd moves
└── The Wire             (free)  Auto-written data briefings + Team of the Week

My Team
├── Pre-season Draft     (free)  2026/27 squad builder — real FPL rules, xP6, AI diagnosis
├── My Squad             (free)  Live pitch from your picks + live points
├── Transfer Planner     (free)  Transfer Solver + replacement finder + AI plan
└── Captaincy Lab        (free)  Captain ranking by xP (safe + differential)

Live  (Pro)
├── Live Percentile      (Pro)   Estimated GW percentile, live through the matchday
├── Bonus Tracker        (Pro)   Provisional 3-2-1 bonus from live BPS
├── Your DEFCON          (Pro)   Your players vs the defensive-contribution threshold
├── DefCon Threats       (Pro)   Players you don't own who are scoring now
├── Auto-Sub Tracker     (Pro)   Live projection of bench substitutions
└── What-If Simulator    (Pro)   Rank impact of a goal / assist / clean sheet

Intelligence  (Pro)
├── EO Tracker           (Pro)   Effective ownership across the top of the game
├── Template Meter       (Pro)   How close your squad is to the top-10k template
├── Rival Scout          (Pro)   Track up to 5 rivals, overlap + gaps
├── Scout AI             (Pro)   Model Team of the Week + AI scout report
└── Ask the Scout        (Pro)   Hybrid AI coach (local engine + optional LLM)

Players
├── Player List          (free)  Full sortable table + Cards view + CSV export
├── Player Compare       (free)  Up to 4 players side by side
├── Differentials        (free)  <12% owned in form + DefCon leaders
├── Price Predictor      (free)  Rise/fall % tonight (threshold model) + value tables
├── Injury Monitor       (free)  Fitness flags by ownership
├── Set Piece Register   (Pro)   Official taker notes + penalty/FK/corner order
└── Rotation Risk        (Pro)   Start-rate risk for premium players

Planner
├── Fixture Planner      (free)  6-GW model FDR grid, xGF, clean-sheet odds
├── Clean Sheet Matrix   (free)  P(clean sheet) per club per GW, 6/10-GW window
├── Mini-Leagues         (free)  Classic + H2H standings, GW awards
├── Chip Strategy        (free)  Chip allocation + best GWs (AI-assisted)
├── Manager Report       (Pro)   Season review: points, rank, chips, captain/transfer ROI
├── Watchlist            (free)  Saved players
└── Alerts               (free)  Price/injury/deadline + model-watch alerts

League
├── Title Race           (free)  Season odds from the backtested model
├── Team Form            (free)  Club form over the last 5/10/20 games
├── Projected XI         (free)  Estimated starting lineups (starts/minutes/availability)
├── Match Forecasts      (free)  Model W/D/L + xG per fixture (Pro adds BTTS/O2.5/scores)
├── Season Simulator     (Pro)   Full-season Monte Carlo
└── Scenario Lab         (Pro)   Pin results and re-run the season
```

**Global chrome:** top bar (menu, brand, refresh, My Team), left sidebar
(area/panel tree), mobile bottom nav (6 areas), theme toggle (light/dark),
deadline strip, account menu, upgrade modal, player‑detail modal.

---

## 3. Panel-by-panel reference

### Home

**Dashboard** — season snapshot tiles, this gameweek's headline actions, and a
live alerts strip. Entry point for unlinked users (with a "load demo team" path).
Topped by a **terminal ticker strip** (model confidence, captain, your rank +
last‑GW movement or Model XI ΣxP, top differential, flag/price counts, data
time) — the first slice of the "GWE terminal" dashboard direction; all values
reuse figures already computed on the page. Below the four panels sits a
full‑width **Signals feed** — a monospace, tagged log of the model read of the
gameweek (fitness flags, tonight's price movers, the biggest transfer swings,
and top defensive‑return form from Core Insights), ordered by how soon each
needs a decision. Every line is drawn from figures already on the dashboard, so
empty categories simply drop out (pre‑season shows fewer lines). The Model XI
panel is a dense terminal table (position groups, fixture, price, forward xP
sparkline, per‑position percentile) with a one‑tap pitch view.

**Power‑user layer** — a **⌘K command palette** (fuzzy search across panels,
actions and every player, jump straight to a profile) plus a **keyboard layer**:
`g` chords to jump between panels, `j`/`k` to walk the rows of the current panel,
`Enter` to open, and `?` for the shortcut cheatsheet. The palette is reachable
from the ⌘K chip in the dashboard ticker on desktop.

**This Gameweek** — the "four weekly decisions" journey card (captain,
transfers, team, chips) with progress, plus **Crowd moves** (most captained /
transferred in / selected / top scorer, each with photo, crest and tap‑through
to the profile). Shows your GW points vs the average when linked.

**The Wire** — a self‑writing blog. Every article is generated from live data +
the model, refreshed each gameweek, no human writer:
- **Team of the Week** — the official Dream Team rendered as a mini pitch.
- **Talking Points** — top hauls / form kings + where the crowd is moving.
- **Differentials the Model Likes** — <10% owned, high xP.
- **Price Watch** — risers, fallers, "heating up".
- **Fixture Swings** — kindest / toughest 5‑game runs (model clean‑sheet + xG ease).
- **The Captaincy Index** — every armband option ranked by xP.

### My Team

**Pre-season Draft** — a 2026/27 squad builder for planning before the game
launches, under the standard FPL rules (15 players: 2 GK / 5 DEF / 5 MID /
3 FWD, £100.0m, max 3 per club).
- **Player pool** from the bootstrap with **predicted prices** (last season's
  final price / launch estimate, labelled). Relegated‑club players are excluded
  by checking club names against the model bundle's 2026/27 team list; a note
  explains that promoted‑club players appear when FPL launches. Filter the pool
  by **search, position, max price and min ownership** (price / ownership range
  sliders) before it ranks by xP6.
- **xP6** — projected points over GW1–6: last season's per‑90 points rate
  (minimum‑minutes floor) × minutes share × availability × a fixture‑ease
  factor from the club's first six 2026/27 fixtures (win‑probability edge via
  the Dixon‑Coles `plsimMatch` on the bundle's fitted ratings). Clearly
  labelled a pre‑season estimate. Minutes‑security badges throughout.
- **Pitch layout** consistent with My Squad (rows auto‑arrange by position,
  ghost slots for unfilled places); tapping any player opens a popover with
  predicted price, xP6, minutes security and the first‑6 fixtures
  difficulty‑coloured.
- **Rules engine** — over‑budget drafting is allowed (bank shows negative in
  red) but an over‑budget or incomplete squad cannot be **saved**; a valid
  draft persists to `ge-draft-v1`.
- **Squad diagnosis** — a free local heuristic verdict (budget balance, club
  concentration, spend spread, minutes risks, total xP6 vs a greedy "template"
  draft built from the same pool) plus a Pro‑gated **AI diagnosis** through the
  authenticated `/api/ai` endpoint (task `draft`).
- **Import my live team** — once the new season's game is live and a manager
  ID is linked, one click replaces the draft with the live 15.

**My Squad** — your 15 players on a professional pitch (striped turf, vector
markings) with real player photos + club crests, name/points label bars,
captain highlight; plus a gameweek summary (points, rank, value, bank, chip).
- **Share** — a square results card (GW points, rank, captain, star player).
- **Reveal** — a portrait **Team Reveal** pitch image of your starting XI (names,
  clubs, prices, captain/vice badges, bench strip, squad value) for socials.
  Both are drawn on a `<canvas>` with no external images (nothing taints the
  canvas under the CSP) and use the Web Share API, falling back to a download.

**Transfer Planner**
- **Transfer Solver** — recommends the best **0–3 transfer** plan over the fixture
  horizon. Greedy on cumulative horizon xP with a per‑position candidate cap;
  respects budget (sale value ≈ current price), the 3‑per‑club cap, and
  position‑for‑position swaps. Weighs each −4 hit against the points it buys and
  highlights the net‑best number of moves; free‑transfers control (1–5). Exact
  for a single transfer, heuristic beyond.
- **3-GW plan** — a multi-week solver: beam search (width 8) over transfer
  *sequences* for the next three gameweeks, scoring each state by per-GW
  best-XI xP (doubles/blanks included) minus −4 hits, with free-transfer
  accrual (max 5) and roll decisions. Respects budget, 3-per-club and position
  quotas. Visible caveat: selling prices are approximated as current price
  (exact selling price needs an FPL login the public API doesn't allow).
- **Find a replacement** — pick a player to move on; rank alternatives within
  budget by projected points **or** by playing‑style similarity (cosine on
  z‑scored per‑90 vectors).
- **Position tables** — top projected players per position over the horizon.
- **AI Transfer Planner** — Claude weighs squad, budget, fixtures and xP.

**Captaincy Lab** — ranks candidates by xP with safe / differential framing;
photo cards for the top picks and a ranked list with next‑fixture difficulty.

### Live (Pro)

**Live Percentile** — your live gameweek score with an estimated percentile
versus all managers (a normal approximation around the gameweek average,
sd ≈ 18), plus live match win‑probabilities re‑forecast on the current score.
Deliberately framed as a statistical estimate: a true live rank requires the
full FPL population, which no public API exposes. Panel id stays `liverank`.

**Bonus Tracker** — projects the provisional **3‑2‑1 bonus** from live BPS for
every match in play *before* the API confirms it, using the official tie rule
(joint winners take consecutive slots → 3,3,1 / 3,2,2). Your players highlighted;
"Provisional" until confirmed.

**DefCon Threats** — high‑scoring players you don't own, ranked by damage to your
rank.

**Auto‑Sub Tracker** — live projection of which bench players sub in and the
points swing.

**What‑If Simulator** — model the rank impact of a goal / assist / clean sheet
before a match ends.

### Intelligence (Pro)

**EO Tracker** — effective ownership, the real measure of rank gain at the top.

**Template Meter** — squad overlap with the top‑10k template and where your edge sits.

**Rival Scout** — track up to five rivals; squad overlap, differentials each way,
points gaps; AI rival brief.

**Scout AI** — the model's **Team of the Week** on a pitch + top predicted by
position + an on‑demand AI scout report.

**Ask the Scout** — the hybrid AI coach (see §6). Answers captaincy, transfer,
differential, value, defence and fixture questions, grounded in the model.

### Players

**Player List** — every player in one view.
- **Table view:** 21 sortable columns — Player, Team, Pos, Price, Sel%, Total
  Pts, GW Pts, Form, PPG, **xP**, Mins, Goals, Assists, **xGI/90**,
  **npxG/90**, **xGC/90**, **DefC/90**, Bonus, BPS, ICT, Season Value. **npxG/90**
  (non‑penalty xG per 90 — open‑play threat) comes from the Core Insights mirror
  (§5) and shows a dash where unavailable, sorting below real values. Click any
  header to sort asc/desc; sticky player column; caps at 300 rows per sort.
- **Cards view:** responsive grid of photo cards (headshot + crest + name,
  team/pos/price, pts·xP·ownership).
- **Filters:** search, position, team.
- **Export CSV:** downloads exactly the filtered/sorted view — all 23 fields
  (including `npxG_per90`), quoted/escaped, UTF‑8 BOM for Excel, named per gameweek.
- Any row/card opens the full **player‑detail modal**.

**Player‑detail modal** (reached from any player anywhere)
- Header: photo, crest, position, price, ownership; Form‑percentile / Dream‑Team chips.
- KPIs: xP next, xP next‑5, value (xP/£m), form.
- Colour‑coded fixture ticker (model difficulty).
- Form graph (per‑GW points with minutes shading), home/away splits, previous
  seasons (from `element-summary`).
- Underlying numbers: xGI/90, xG/90, xA/90, xGC/90 (def), DefCon/90, season value, G/A.
- Closest playing‑style twin (tap to hop to it).
- On‑demand AI verdict.

**Player Compare** — up to four players side by side on form, xG, price,
ownership, ICT and **minutes security** (three‑tier badge).

**Differentials** — <12% owned in form, plus a **Defensive‑contribution leaders**
table (the 2025/26 DefCon scoring category).

**Price Predictor** — a threshold model estimates each player's **% likelihood
of a price rise/fall tonight** (net transfers vs an ownership‑scaled threshold,
logistic mapping, capped 5–95%, labelled an estimate), with sorted riser/faller
lists; net‑transfer momentum is kept as a secondary signal, plus
**points‑per‑million** best/worst value tables.

**Injury Monitor** — fitness flags, suspension risk and return chance by ownership.

**Set Piece Register** — official written **taker notes** (from `set-piece-notes`)
plus confirmed penalty / direct‑FK / corner order.

**Rotation Risk** — start‑rate risk for premium players from actual minutes.

### Planner

**Fixture Planner** — model‑FDR grid (from win odds), expected goals for, and
clean‑sheet odds; plus the upcoming match outlook. Horizon toggles **6 / 10 / 15
gameweeks or the whole Season** (the full remaining‑season grid competitors
paywall — here free, and across four lenses: Overall / Attack / Defence / the
official FPL rating). Teams re‑rank easiest‑run‑first; a purple underline marks
each club’s best run in the window. **Team filter** chips hide/show any club in
the grid (with **All** and, when a team is linked, **My teams** shortcuts).

**Clean Sheet Matrix** — for every 2026/27 club (from the shared model bundle),
the probability of a clean sheet in each of the next 6 or 10 gameweeks'
fixtures. P(CS) = P(opponent scores 0), read off the same Dixon‑Coles score
grid the season simulator samples (`lgScoreGrid` → `lgCleanSheets`). Rows sort
by average CS% over the window; cells show opponent + H/(a) on a green→red
scale; doubles stack in the cell, blanks show –. Cached per bundle fetch.
Pre‑season the window is GW1–6 of the new season.

**Mini‑Leagues** — your **classic** and **head‑to‑head** leagues. Classic shows
total + rank movement and a **Gameweek awards** tool (best captain, bench
tragedy, differential hero across the top 10). H2H shows W‑D‑L, points‑for and
league points.

**Chip Strategy** — chips used/available and the best gameweeks to play each,
AI‑assisted. Includes a **Fixture‑swing gameweek ranking** (`gwSwing`): every
gameweek in the next ~19 ranked by fixture difficulty for the teams people own
(ownership‑weighted, from the fitted match model, not a static grid), calling
out the easiest weeks for Bench Boost / Triple Captain and the toughest (owned
sides clashing) for a Free Hit. The weighting matters — a plain league average
barely moves because every match has a favourite and an underdog. Team‑agnostic,
so it shows before a team is linked and pre‑season.

**Manager Report** (season review)
- KPI tiles: best GW, average, bench points wasted, green arrows / hits.
- Season shape: best rank, consistency (std dev), best green‑arrow run, above‑average rate.
- **Points‑by‑gameweek** chart (green vs each week's average).
- **Overall‑rank trajectory** chart (log scale, chip markers).
- **Chip returns** breakdown.
- On‑demand **Captain Analysis** (accuracy vs optimal, points missed, most‑captained).
- On‑demand **Transfer ROI** (net points swing per move since made, hit efficiency).

**Watchlist** — saved players (synced to account when signed in).

**Alerts** — price‑change / injury / deadline reminders and **model‑watch** alerts
(when the model's view of a player shifts). Optional push notifications.

---

## 4. The model

### Team‑strength engine (`plsim*` in `index.html`, mirrors the Plsimulator repo)
- **Poisson** goal model with a **Dixon‑Coles** low‑score correction.
- Constants: home base **1.62**, away base **1.32** goals; DC **rho ≈ −0.074**;
  Bayesian prior weight 8; 24 fitting iterations; per‑club home advantage.
- On every load it re‑fits attack/defence multipliers on the season's finished
  fixtures from the live API (falls back to offline‑fitted priors early season).
- Offline calibration (Plsimulator repo) fits on ~2,796 PL + Championship
  results 2023‑26 with exponential date‑decay (250‑day half‑life) and an
  xG‑blended target (α·xG + (1−α)·goals). A promoted‑team prior is estimated from
  history. Outputs: per‑fixture expected goals, clean‑sheet odds, 3+‑goal odds,
  win probability, and a 1–5 model FDR.
- **Validation:** walk‑forward RPS ≈ **0.2123** (vs de‑vigged Pinnacle market
  ≈ 0.1994) — competitive with the bookmaker and ahead of a uniform baseline.

### Player expected points (`xP`, `nativeXP`)
- `xP` blends the FPL `ep_next` estimate with a **native** model:
  minutes × expected goal involvement per 90 × fixture strength, plus
  clean‑sheet points from the match model, scaled by chance‑of‑playing.
- **Native model validation:** walk‑forward MAE **0.96** vs 1.04 for a 5‑GW form
  baseline (24,173 player‑matches, 2025/26).
- `horizonXP` sums xP over the next N fixtures — the currency for the Transfer
  Solver, replacement finder and Fixture Planner.
- **Playing‑style vectors:** per‑90 xG, xA, threat, creativity, influence, shots,
  defensive actions — z‑scored within position; cosine similarity powers the
  style‑twin and "closest style" transfer mode.
- **Minutes security** (`minutesSecurity`) — a pure 0–100 score: 65% starts
  share + 35% minutes share, scaled by availability (status flag +
  chance‑of‑playing). Tiers: **secure ≥75 / watch 50–74 / risky <50**. The same
  score drives the Projected XI panel and is surfaced as a badge in the
  Pre‑season Draft pool and squad cards, a Player Compare row, and the
  player‑detail modal. Pre‑season it reads from last season's starts/minutes
  (labelled as such).

- **Goalkeeper shot‑stopping** (`goals_prevented`, from Core Insights §5): a
  bounded term adds ~1 point per goal prevented per 90 (post‑shot xG faced minus
  goals conceded) that the fixed saves / concede / clean‑sheet terms cannot see.
  Guarded by `el._ci`, so it is inert without the mirror. Coefficient set from a
  seeded Monte‑Carlo (`dev/model-validate.mjs`): it cuts synthetic GK MAE ~43%
  and pulls the projection for elite and leaky keepers back toward truth.

> Discipline note: the validated `nativeXP` formula is deliberately **not**
> silently re‑wired when new fields (xGI/xGC) are surfaced — those are shown as
> stats and only folded into the projection after a backtest that beats the
> current model. The goalkeeper `goals_prevented` term above followed exactly
> that rule: surfaced first, then wired in only once `dev/model-validate.mjs`
> showed it helps (and the change is a no‑op when the mirror is absent).

---

## 5. Data sources — official FPL API

All calls go through the Netlify proxy (`/api/fpl/*` → `functions/fpl.js`), which
whitelists endpoints, adds a browser‑like User‑Agent, returns CORS headers and
edge‑caches slow data (never live data).

| Endpoint | Client loader | Used for |
|---|---|---|
| `bootstrap-static` | `loadBootstrap` (12h) | teams, players, events, types |
| `fixtures` | `loadFixtures` (10m) | all fixtures + live stats |
| `entry/{id}` | `loadEntry` | manager summary |
| `entry/{id}/history` | `loadHistory` | season history + chips |
| `entry/{id}/event/{gw}/picks` | `loadPicks` | squad picks |
| `entry/{id}/transfers` | `loadTransfers` (3m) | transfer log (ROI) |
| `element-summary/{id}` | `loadSummary` (10m) | per‑GW history, splits, seasons |
| `event/{gw}/live` | `loadLive` | live points, BPS, bonus, explain |
| `event-status` | `loadEventStatus` | bonus‑added / confirmation |
| `dream-team/{gw}` | `loadDreamTeam` (10m) | Team of the Week |
| `set-piece-notes` | `loadSetPieceNotes` (6h) | official taker notes |
| `leagues-classic/{id}/standings` | `loadStandings` | classic leagues + awards |
| `leagues-h2h/{id}/standings` | `loadH2HStandings` | head‑to‑head leagues |

**Official CDN assets** (no proxy): club crests
`resources.premierleague.com/premierleague/badges/50/t{code}.png` and player
photos `.../photos/players/110x140/p{photo}.png`, with graceful colour‑tile /
kit‑shirt fallbacks.

**Not yet used (authenticated‑only):** `my-team/{id}` (exact selling price, free‑
transfer count) — needs FPL login, out of scope for the public proxy.

### Advanced stats — FPL Core Insights (secondary source)

The official API carries xGI/xGC but not the deeper Opta‑like numbers. We layer
those in from the open **[FPL Core Insights](https://github.com/olbauday/FPL-Core-Insights)**
dataset (used freely with attribution), aligned by the official FPL element id:

- A scheduled function (`netlify/functions/core-insights.js`, twice daily) pulls
  the per‑match `playermatchstats` files, aggregates them per player over the
  season, and upserts a compact row into `gwedge_core_insights` (service‑role,
  RLS‑locked, like `gwedge_predictions`). Pre‑season it targets last season —
  the right prior for GW1.
- `core-insights-data.js` serves that table as compact JSON at
  `/api/core-insights`; the client merges it onto player objects in `boot()`
  (`el._ci`). **Everything is guarded by the presence of `_ci`**, so with the
  mirror unconfigured or unreachable the app behaves exactly as before.
- Headline field: goalkeeper **`goals_prevented`** (post‑shot xG faced minus
  goals conceded — shot‑stopping above expectation), which feeds `nativeXP`
  (see §4). Also surfaced in the player‑detail modal: non‑penalty xG, xGOT,
  big chances missed, chances created and touches in the box.
- **DefCon hit rate** (`defcon_hit_rate`, `defcon_per_start`): the per‑match
  fraction of starts (≥60 mins) a player clears the defensive‑contribution
  threshold (DEF 10 CBIT, MID/FWD 12 CBIRT) for the +2 — a *consistency* metric
  the official API cannot give (no per‑match breakdown). Surfaced on the
  Differentials **DefCon picks** table (ranked by hit rate, with a per‑start
  actions column) and the player modal; the aggregator joins `players.csv` for
  the position‑specific threshold. Where the mirror is absent the Differentials
  table falls back to a model estimate of the hit rate (prefixed `~`).
- No new env vars — reuses `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

---

## 6. AI assistant (hybrid)

- **Local grounding engine** (free, no key): answers captaincy, transfer,
  differential, value, defence and fixture questions **from the app's own model
  outputs** (xP, fixtures, value, ownership, style). Deterministic, private,
  ships out of the box. It is the floor for **Ask the Scout** and runs whenever
  no LLM key is set or the network drops.
- **LLM layer** (optional): a serverless function `functions/ai.js` calls an LLM
  when `ANTHROPIC_API_KEY` is set in the Netlify environment, for conversational
  replies and richer reports. Without a key, features degrade to the local engine
  / a "needs setup" state rather than breaking.
- **AI tasks** routed through the shared `runAI` runner and `/api/ai`:
  `digest`, `review`, `scout`, `player`, `chips`, `rival`, `transfers`, `draft`
  (pre‑season squad diagnosis), and the conversational `ask`. Results are cached
  per gameweek where sensible; Pro‑gated buttons control cost on free panels.

---

## 7. Architecture

- **Front end:** one self‑contained `index.html` (vanilla JS, no framework). A
  `NAV` model defines areas/panels; a `WIRED` registry maps each panel id to an
  async `hydrate*` function that fetches live data and renders. `PANEL_CONTENT`
  holds descriptions/layouts.
- **Serverless (Netlify Functions):** `fpl` (FPL proxy), `ai` (LLM),
  `checkout` / `portal` / `stripe-webhook` (billing), `push-key` /
  `push-subscribe` / `push-unsubscribe` / `push-cron` (web push).
- **Routing (`netlify.toml`):** `/api/fpl/*`, `/api/ai`, `/api/checkout`,
  `/api/portal`, `/api/stripe-webhook`, `/api/push-*`; `/welcome` → landing page.
  Build command `npm run build:web`, publish dir `www`.
- **Caching:** in‑memory + `localStorage` (`cached()` with per‑key TTLs) on the
  client; edge cache on the proxy (5 min for slow data, never for live).
- **PWA / native:** `manifest.webmanifest`, service worker `sw.js`, Capacitor
  iOS wrapper (`capacitor.config.json`, `ios/`) reusing the same functions via
  an absolute base URL. Native bridge `native.js` (haptics etc.), no‑op on web.
- **Auth/sync:** optional Supabase accounts (`auth.js`) — Manager ID, tier,
  watchlist and rivals sync across devices via `gwedge_*` tables.

---

## 8. Design system / UI components

- **Brand:** deep pitch‑green gradient system, light/dark theme (theme‑aware,
  persisted), rounded surfaces, KPI accent tiles.
- **Pitch graphic:** striped turf + crisp non‑scaling‑stroke SVG markings;
  player tokens are real photo cutouts + club crest + stacked name/points bars,
  captain ring/armband; graceful kit‑shirt fallback. Reused by My Squad, Scout
  Team of the Week and The Wire Dream Team.
- **Tables:** `dlTable` ranked lists (clickable to the profile), the Player List
  `ptable` (sticky header + first column), fixture FDR grid.
- **Cards:** player photo cards (`plc`), KPI tiles (`kpi`), stat grids.
- **Charts:** inline SVG — points‑by‑GW bars, rank‑trajectory line/area,
  form sparkline, mini bar/line charts.
- **Feedback:** skeleton loaders, empty/error state boxes, toasts, haptics.

---

## 9. Accounts, tiers & owner access

- **Free vs Pro:** tier stored in `ge-tier` (`free`/`pro`); Pro unlocks the
  gated panels and AI buttons. Billing via Stripe checkout/portal; tier syncs
  to the Supabase profile.
- **Owner access:** an allowlist (SHA‑256 of the owner's email, no plaintext) is
  checked after Supabase sign‑in; a match upgrades the account to Pro locally +
  in the cloud and shows "Owner — full access". Gated behind real auth, so it is
  not a shared secret.
- **Instant per‑device unlock:** `localStorage.setItem('ge-tier','pro')` then
  reload.

---

## 10. Known gaps & roadmap

From the competitive review (FPL Core, fplreview, fpl.team, FPL Pulse, LiveFPL,
Premier Fantasy Tools, Fantasy Football Hub/Fix):

- **Shipped differentiators:** fitted model xP, hybrid AI scout, deep player
  stats + full sortable list, transfer solver, live bonus projector, DefCon,
  auto blog, Team of the Week, H2H.
- **Possible next steps:**
  - Full MILP transfer optimiser vs the current beam-search 3-GW plan.
  - Authenticated `my-team` integration for exact selling price / free transfers.
  - Native push depth (fpl.team / LiveFPL parity).
  - Editorial expansion of The Wire; column presets on the Player List.
  - Extend the photo‑token treatment to EO/Template/Rival lists and DefCon feed.
  - Reddit/sentiment or ownership‑trend signals.

- **Shipped from this review (open‑source data ingestion):**
  - **FPL Core Insights** advanced‑stats mirror — goalkeeper `goals_prevented`
    now sharpens `nativeXP`; non‑penalty xG / xGOT / big chances surfaced in the
    player modal (see §5).
  - **vaastav real‑actuals backtest** — `dev/backtest-vaastav.mjs` grades the
    shipping model against a real historical season (MIT‑licensed dataset)
    instead of only the synthetic generator, so validation is no longer purely
    a simulation study (see docs/MODELLING.md).

---

## Appendix A — localStorage keys

| Key | Purpose |
|---|---|
| `ge-mid` | linked FPL Manager ID |
| `ge-tier` | `free` / `pro` |
| `ge-theme` | light / dark preference |
| `ge-onboarded` | first‑run flag |
| `ge-watch` | watchlist player ids |
| `ge-draft-v1` | saved pre‑season draft (player ids) |
| `ge-rivals` | rival manager ids |
| `ge-alert-prefs` | alert toggles |
| `ge-journey-{gw}` | "plan my week" progress |
| `ge-modelwatch` | last model snapshot for change alerts |
| `ge-api-base` | override API base (native/testing) |
| `ge-c-*` | cached API responses (per‑key TTL) |

## Appendix B — File layout (web)

```
index.html                     the entire app (UI, model, panels)
landing.html                   marketing page (/welcome)
native.js / auth.js            native bridge / Supabase client
sw.js  manifest.webmanifest    PWA
netlify.toml                   routing + build config
netlify/functions/
  fpl.js        FPL API proxy (endpoint allowlist)
  ai.js         LLM endpoint (ANTHROPIC_API_KEY)
  checkout.js portal.js stripe-webhook.js   billing
  push-key.js push-subscribe.js push-unsubscribe.js push-cron.js  web push
ios/  capacitor.config.json    iOS wrapper
dev/
  mock_fpl.py                  offline mock FPL API + static server
  smoke.mjs                    headless all-panels smoke test
CONTRIBUTING.md                local setup, recipes, conventions
docs/FEATURES.md               this document
```

## Appendix C — Panel → hydrate function

Every panel id maps to an async `hydrate*` renderer in `index.html` via the
`WIRED` registry (e.g. `allplayers → hydrateAllPlayers`, `bonus →
hydrateBonus`, `gwhistory → hydrateGwhistory`). The player‑detail modal
(`openPlayer`) and Transfer Solver (`solvePlan`/`renderSolver`) are shared across
panels.

---

*Generated from the live source. Update this file whenever panels, endpoints or
the model change so it stays the build‑and‑improve reference.*
