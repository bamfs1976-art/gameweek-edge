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

Navigation is **7 areas** (plus an owner‑only Studio) holding **37 panels**.
The sidebar lists the areas only — an area is a destination, not a folder, and
lands on its first panel. The lateral move happens on the page: every panel
carries an **area tab strip** naming the handful of views that belong with it
(`areaTabsHtml`). Panels the active game has no capability for are absent
rather than dead; **Pro** panels show as a locked tab, because you cannot want
what you cannot see.

There is no "The Edge" area any more. It used to hold twelve unrelated paid
tools — the app's single biggest pile, and the one place a Pro tool could hide
from the topic it belonged to. Pro is a property of a *panel* now, not a place,
so each of those tools moved to where someone would look for it and kept its
lock. "League" (the Premier League) and "Mini‑Leagues" (yours) also sat two
aisles apart under near‑identical names; that is now **Match Centre** for the
football and **Rivals** for the people you are playing against.

```
Home
├── Dashboard            (free)  Season snapshot, this week's calls, live state
├── My Week              (free)  Your personalised gameweek brief
├── Gameweek recap       (free)  What just happened, and what it cost you
├── The Wire             (free)  Auto-written data briefings + Team of the Week
├── Scout AI             (Pro)   Model XI, scout report and the ask box
├── Methodology          (free)  How the model works, in full
└── Model Accountability (free)  Every published call, graded

My Team
├── My Squad             (free)  Live pitch from your picks + live points
├── Transfer Planner     (free)  Multi-GW beam solver + replacement finder + AI plan
├── Captaincy Lab        (free)  Captain ranking by xP (safe + differential)
├── Chip Strategy        (free)  Chip allocation + best GWs (AI-assisted)
├── Pre-season Draft     (free)  Squad builder — real FPL rules, xP6, AI diagnosis
├── GW Debrief           (free)  Your gameweek, scored against the model
└── Manager Report       (Pro)   Season review: points, rank, chips, captain/transfer ROI

Live
└── Live                 (free)  One matchday, five views — Percentile and Bonus
                                 free, Your DEFCON / Rank threats / Auto-subs Pro

Players
├── Players              (free)  One sortable table, ten lenses, Cards view + CSV
│                                (absorbed Differentials and the Injury Monitor)
├── Scout Board          (free)  Per-90 shortlist + price ladder, DefCon + bonus by club
├── Player Compare       (free)  Up to 4 players side by side
├── Price Predictor      (free)  Rise/fall % tonight (threshold model) + value tables
├── Set Piece Register   (Pro)   Official taker notes + penalty/FK/corner order
├── Rotation Risk        (Pro)   Midweek congestion, dead rubbers, start-rate risk
└── Latest News          (free)  Official player news, newest first

Planner
├── Fixtures             (free)  One horizon, three views: grid / points / clean sheets
│                                (absorbed the Points Planner and Clean Sheet Matrix)
├── Season Simulator     (Pro)   Full-season Monte Carlo (absorbed Scenario Lab)
├── What-If Simulator    (Pro)   Rank impact of a goal / assist / clean sheet
├── Watchlist            (free)  Saved players
└── Alerts               (free)  Price/injury/deadline + model-watch alerts

Rivals
├── Mini-Leagues         (free)  Classic + H2H standings, GW awards
├── Rival Scout          (Pro)   Track up to 5 rivals, overlap + gaps
├── EO Tracker           (Pro)   Effective ownership; your cover, edge and exposure
└── The Template         (Pro)   The most-owned XI, and how close yours is

Match Centre
├── Match Centre         (free)  Every match: scorers, cards, saves, the bonus race
├── Match Forecasts      (free)  Model W/D/L + xG per fixture (Pro adds BTTS/O2.5/scores)
├── Projected XI         (free)  Estimated starting lineups (starts/minutes/availability)
├── Title Race           (free)  Season odds from the backtested model
├── Club Dossier         (free)  One club: attack-or-defence, home/away, board, depth
└── Team Form            (free)  Club form over the last 5/10/20 games

Studio  (owner only — hidden unless the signed-in email is on the owner allowlist)
├── Social Studio        (owner) Share-ready PNG cards from the live model
└── Analytics            (owner) External visitors and area usage
```

Two panels sit outside the areas and are reachable by hash only: **Glossary**
(`#glossary`, also in the mobile More sheet) and **Design System** (`#design`).
Both are free; neither shows a tab strip, since neither belongs to an area's
list.

**Global chrome:** top bar (menu, brand, refresh, My Team), left sidebar
(flat area list), area tab strip on every page, mobile bottom nav (Home · My
Squad · Players · Match Centre · More) with the remaining areas in the More
sheet, theme toggle (light/dark), deadline strip, account menu, upgrade modal,
player‑detail modal.

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

**Social Studio** *(Studio area — owner only)* — share‑ready graphics built from
the live model, so the numbers on a posted card are the numbers in the product.

Gated to the site owner: `tier:'owner'` is stricter than `'paid'` — a Pro panel
is shown locked as an upsell, an owner panel is not shown at all. The area is
filtered out of the sidebar, the ⌘K palette and the mobile More sheet, and
`openPanel` sends the deep link to the dashboard, so `#social` does nothing for
anyone else. The gate reads `window.GE_OWNER`, which is set only after a
signed‑in email matches `OWNER_HASHES` — never from the client‑settable tier. Each card is drawn to
a 1080×1350 canvas (the portrait ratio Instagram and X both crop kindly) and
downloads as a PNG; cards rebuild from fresh data every time the panel opens,
which matters in the run‑up to GW1 when prices move daily.

Presets: **Chip plan** (when to play each chip this half) · **Best fixture runs**
(clubs by official FDR over the next six) · **Underpriced** and **Priced above
the model** (both halves of the value board) · **The Data XI** (highest projected XI, full £100.0m squad) · **Building
around Haaland** · **The Big Three** (Haaland + Bruno + Gabriel locked) · **Money
in the bank** (best XI holding ≥£3.0m back) · **Best by price** for each of the
four positions · **Best captains** for the next 7 gameweeks · **The
differentials** (<10% owned) · **Priced above the model** · **DefCon by budget**.

**From the newer analytics**, six more: **Who takes what** (first‑choice
penalties / free‑kicks / corners, club by club) · **Set and forget** or **One
slot, N clubs** (the exactly‑solved budget rotation — the title depends on
whether rotating actually beats holding, and when it doesn't the card says so
rather than manufacturing a chain) · **Attack or defence?** (which end of each
club is the one to buy) · **Most goals coming** (projected goals over the next
six, the number behind the colour) · **Paid on the wrong tariff** (out‑of‑
position players) · **Playing midweek** (European and cup congestion).

Three of those are *seasonal by nature* and correctly absent in July: the
out‑of‑position card needs 450 minutes before it will claim anything, and the
congestion card needs the cup competitions to have started. They appear on
their own once the data exists.

**Build your own.** Above the ready-made cards sits a builder, so the presets
answer the questions we thought of and the builder answers the rest. Two modes,
both feeding the same renderers the presets use — a hand-built card is
indistinguishable from a shipped one:

- **Ranked list** — search and add any players, then choose the number shown
  beside each: xP next gameweek, xP over 6 fixtures, total points, form, price,
  ownership, points per £m, DefCon hit rate, npxG/90 or baseline BPS/90. Sort by
  that number or keep your own order; the top ten make the card.
  Four further metrics read **per‑match history** — points per appearance,
  **return spread (SD)**, haul rate and blank rate. Those need
  `element-summary`, one request per player, which rules them out of a
  league‑wide leaderboard but is entirely affordable for a handful of
  hand‑picked players. Summaries are fetched only when such a metric is
  selected, cached per element for the session, and a player with too thin a
  sample prints a dash and sorts last rather than showing a fabricated zero.
- **Squad** — lock in the players you want and the optimiser builds the best
  legal 15 around them, inside a budget you set with a slider, optionally
  holding money back. If the locked picks cannot fit, the card says so rather
  than quietly dropping one.

Title and subtitle are editable, the preview redraws live, and the whole
configuration persists to `localStorage` so a half-built card survives a
refresh. `dev/test-builder.mjs` drives it in a real browser (search, add,
rename, switch metric, flip modes, reload) and `dev/test-social.mjs` asserts
every metric formatter offline, since a wrong formatter would put a price where
a percentage belongs on a public post.

**Squad cards show all fifteen.** An FPL squad is eleven starters *plus four
substitutes* inside £100.0m, so a card showing only the XI tells half the story
— the bench is where the budget is won or lost. The pitch cards therefore draw
the four subs as real player cards (portrait, crest, club, price) in a
**SUBSTITUTES** band under the pitch, labelled with what the bench costs, and
the totals strip prints **FORMATION · SQUAD OF 15 · IN THE BANK** so squad cost
plus bank always reads back to the £100.0m budget. Bench order is the one FPL
would actually use: reserve keeper first, then the outfield subs by projection.
`dev/test-social.mjs` asserts the arithmetic closes (XI cost + bench cost =
squad cost; squad cost + bank = budget) rather than leaving it to the eye.

**Imagery.** Cards carry official club crests and player portraits — a portrait
disc with the crest badged on its shoulder for pitch and ranked cards, crest
chips on the price/captain ladders — over the club‑colour gradient that shows
through when an image is missing. Every image is best‑effort: a new signing with
no photo, a promoted club with no badge, or a slow CDN costs a little polish and
nothing else, because the colour tile is always drawn underneath first.

Canvas export forces one piece of plumbing: drawing a cross‑origin image taints
the canvas and makes `toBlob()` throw, so card imagery is fetched through a
same‑origin proxy (`/api/img` → `netlify/functions/img.js`) rather than straight
from the Premier League CDN. That proxy is host‑allowlisted, size‑capped and
edge‑cached for a week; it is deliberately not a general‑purpose relay. In‑app
`<img>` tags are unaffected and still hit the CDN directly, since tainting only
matters for canvas readback.

> Crests and player photos are club trademarks and player image rights. The app
> already gates them behind the `USE_OFFICIAL_IMAGERY` master switch (§ helpers);
> flipping it to `false` drops every card back to club‑colour tiles with no other
> change. Worth a deliberate decision before cards are used commercially, since
> a downloaded PNG carrying the site's domain is distribution and promotion, not
> just in‑app display.

The XI cards run a **constrained squad optimiser** (`squadOptimise`): a legal
15‑man squad — 2/5/5/3, max 3 per club, inside budget — chosen to maximise the
expected points of the best XI it can field. Because the bench scores nothing in
the objective, cheap bench fodder falls out on its own. Forced picks (Haaland,
Bruno, Gabriel) are pinned and never swapped out, and a minimum bank is honoured
as a hard constraint. Exact optimisation is a multi‑dimensional knapsack, so the
solver uses a repaired feasible seed plus steepest‑ascent single **and paired**
swaps (budget couples the picks — funding an upgrade usually means downgrading
elsewhere), restarted from several seeds. Verified in `dev/test-social.mjs`
against exhaustive enumeration: exact at every budget on a structured pool,
exact on 29 of 30 random pools at realistic slack (worst shortfall 0.6%), and
within 5% even when squeezed to 1% above the cheapest legal squad. The honest
claim is *very close to optimal, almost always exactly it* — not provably
optimal.

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
  squad value (doubles/blanks included) minus −4 hits, with free-transfer
  accrual and roll decisions. Respects budget, 3-per-club and position
  quotas. Visible caveat: selling prices are approximated as current price
  (exact selling price needs an FPL login the public API doesn't allow).

**What a squad is worth beyond its eleven.** The objective used to be best‑XI
xP minus hits, which makes two real things invisible.

A **substitute is not worthless**. He comes on when someone is benched late,
injured early or does not play, and the first outfield sub is on far more often
than the third. Scoring the bench at zero tells the solver every bench is
equally good — which is how a recommendation quietly guts the cover. Bench
points now count, heavily discounted and ordered (reserve keeper 0.03, then
0.21 / 0.06 / 0.002 for the three outfield subs — the weights the open FPL
solver community has settled on). All four together are worth less than one
starter, which is asserted.

A **banked transfer is worth points**. Two transfers in one week is what fixes a
squad without a hit, so a search that scores only points‑this‑horizon will
always spend rather than save. Each extra banked transfer adds a declining
amount (2.0 for the second, then 1.6 / 1.3 / 1.1) — the first roll is the
valuable one and the fifth is nearly spare. A full bank is worth less than the
hits it would take to fill it, so banking can never beat a clearly worthwhile
transfer.

In the multi‑week search that bonus is a **terminal** value: it is applied once,
to the free transfers a plan *ends* with, because the option is realised after
the horizon rather than inside it. Charging it every gameweek would count the
same roll three times. The single‑week solver charges each option for the roll
it spends, measured against rolling everything, so both views agree — and the
plan table now shows that cost explicitly ("−2.0 roll spent") instead of
presenting doing nothing as free.

The 15‑man squad optimiser behind the social cards is deliberately left on
best‑XI xP: it is verified against an exhaustive brute‑force search on that
objective, and a £100m squad card is judged on the eleven it fields.
- **Find a replacement** — pick a player to move on; rank alternatives within
  budget by projected points **or** by playing‑style similarity (cosine on
  z‑scored per‑90 vectors).
- **Position tables** — top projected players per position over the horizon.
- **AI Transfer Planner** — Claude weighs squad, budget, fixtures and xP.

**Captaincy Lab** — ranks candidates by xP with safe / differential framing;
photo cards for the top picks and a ranked list with next‑fixture difficulty.
Plus a **captain planner** covering the next 7 gameweeks: the three
highest‑projected armbands for each upcoming gameweek, from the same
fixture‑by‑fixture projection the Fixtures panel’s Points view uses. Double gameweeks sum
both legs and are tagged `DGW`; a club that blanks drops out of that row.

### Live

**Live** — one matchday, five views. These were five destinations all answering
"what is happening to my team right now", and the one moment you want them is
the one moment you cannot afford to navigate: matches in play, points moving.
Leaving the number you were watching to go and find another one was the whole
cost of the old shape. They are views of one panel now (`LV_VIEWS`); the five
renderers are unchanged, and `#bonus`, `#dcwatch`, `#defcon` and `#autosubs`
still land on the view they always showed. The panel id stays `liverank` for
the deep links and the `g l` chord.

**The gate moved inside the panel.** Three of the five views are Pro and two
are free, so panel‑level gating could not express it — the same journey the
players table's column gate made. `renderPage` still locks a whole panel when
the *panel* is paid; here the panel is free and each view carries its own
tier, shown locked (blurred, inert, one lock strip) rather than hidden. A
locked view never runs its hydrator, so it does not fetch your picks and the
live feed to build a board you will not be shown. `needs` is per view too: a
game pack without a bonus system or without defensive contributions drops
those views entirely rather than showing a board that can never fill.

**Auto‑refresh** polls every 45s while a gameweek is in play and the tab is
visible. A hub refreshes its **active view in place** (`LIVE_REFRESH`) rather
than re‑running its own hydrator — rebuilding the chip row and repainting a
skeleton every 45 seconds would make a live screen blink, which is worse than
one that lags.

**View 1 — Percentile** *(free)* — your live gameweek score with an estimated
percentile versus all managers (a normal approximation around the gameweek
average, sd ≈ 18), plus live match win‑probabilities re‑forecast on the current
score. Deliberately framed as a statistical estimate: a true live rank requires
the full FPL population, which no public API exposes.

**View 2 — Bonus** *(free)* — projects the provisional **3‑2‑1 bonus** from live
BPS for every match in play *before* the API confirms it, using the official tie
rule (joint winners take consecutive slots → 3,3,1 / 3,2,2). Your players
highlighted; "Provisional" until confirmed.

**View 3 — Your DEFCON** *(Pro)* — your outfield starters against the
defensive‑contribution threshold (10 for defenders, 12 for midfielders and
forwards): who has banked the +2, and who is close.

**View 4 — Rank threats** *(Pro)* — high‑scoring players you don't own, ranked by
damage to your rank. Nothing to do with defensive contributions despite sitting
next to Your DEFCON — and it is still rendered by a function called
`hydrateDefcon`, which is exactly why the label matters.

**View 5 — Auto‑subs** *(Pro)* — live projection of which bench players sub in
and the points swing.

### Rivals

**EO Tracker** — effective ownership, the real measure of rank gain at the top.

**Template Meter** — squad overlap with the top‑10k template and where your edge sits.

**Rival Scout** — track up to five rivals; squad overlap, differentials each way,
points gaps; AI rival brief.

**Scout AI** — the model's **Team of the Week** on a pitch + top predicted by
position + an on‑demand AI scout report.

**Ask the Scout** — the hybrid AI coach (see §6). Answers captaincy, transfer,
differential, value, defence and fixture questions, grounded in the model.

### Players

**Players** — every player, every number, one table.
- **Table view:** 28 sortable columns — Player, Team, Pos, Price, Sel%, Total
  Pts, GW Pts, Form, PPG, **xP**, Mins, Goals, Assists, **xGI/90**,
  **npxG/90**, **xGC/90**, **DefC/90**, Bonus, BPS, Baseline BPS/90, ICT,
  Season Value, **Tonight** (price‑move probability, signed), **Fit%**,
  **YC** (yellows against the ban cutoff in force), **DC hit%**, **Mins%**,
  plus three Pro columns — **EO%**, **Tmpl** and **SetP**. **npxG/90**
  (non‑penalty xG per 90 — open‑play threat) comes from the Core Insights mirror
  (§5) and shows a dash where unavailable, sorting below real values. Click any
  header to sort asc/desc; sticky player column; caps at 300 rows per sort.
- **Lenses** — ten saved readings of the table, each setting its own columns,
  sort and shortlist: *All data*, *Scout*, *Differentials*, *Price*, *Fitness*,
  *DefCon*, *Rotation* (free) and *EO*, *Template*, *Set pieces* (Pro). The
  Differentials and Injury Monitor boards were a filter and a sort over this
  same data, so they are now lenses rather than destinations; `#diffs` and
  `#injuries` still resolve, landing on the lens they always showed
  (`PANEL_ALIAS` + `PANEL_LENS`). Lens names stay searchable in ⌘K.
- **The column gate** — Pro is enforced per **column**, not per panel, because
  once the paid boards fold into one table the column is the unit of value. A
  locked column is shown, not hidden: the heading stays legible and each cell
  carries a lock, both of which open the upgrade sheet. Three doors are shut,
  not one — the cell, the **sort** (ordering by a hidden column would hand over
  the ranking row by row) and the **CSV export**. A locked *lens* also stops
  filtering, so its shortlist is not free either.
  Only three columns are Pro, by a deliberate rule: a column is paid only when
  the paid board is the **only** place that number appears today. DC hit% (already
  on the Scout Board's defender brackets) and minutes security (already on Player
  Compare) therefore stayed free — a merge must not take back what was free.
- **Cards view:** responsive grid of photo cards (headshot + crest + name,
  team/pos/price, pts·xP·ownership).
- **Filters:** search, position, team.
- **Export CSV:** downloads exactly the filtered/sorted view, quoted/escaped,
  UTF‑8 BOM for Excel, named per gameweek. Free exports carry every free
  column including `PriceMoveTonight` and `ChanceOfPlaying`; the three Pro
  columns are appended only for a Pro reader.
- Any row/card opens the full **player‑detail modal**.

**Player‑detail modal** (reached from any player anywhere)
- Header: photo, crest, position, price, ownership; Form‑percentile / Dream‑Team chips.
- KPIs: xP next, xP next‑5, value (xP/£m), form.
- Colour‑coded fixture ticker (model difficulty).
- Form graph (per‑GW points with minutes shading), home/away splits, previous
  seasons (from `element-summary`).
- Underlying numbers: xGI/90, xG/90, xA/90, xGC/90 (def), DefCon/90, season value, G/A.
- Closest playing‑style twin (tap to hop to it).
- **Return consistency** — points per appearance alongside the **spread (SD)**
  of those returns, plus haul (10+) and blank (≤2) rates, and a profile tag:
  *Steady* / *Balanced* / *Explosive*. Two players on identical PPG can be
  completely different assets — one returns a steady five every week, the other
  blanks four times then hauls twenty — and only the spread separates them.
  Measured over **appearances only**, so it reads as return shape rather than
  rotation risk (minutes security has its own stats beside it); classification
  uses the coefficient of variation, which is scale‑free and so compares a
  budget defender with a premium striker fairly. Hidden under four appearances.
- On‑demand AI verdict.

**Bonus magnets — baseline BPS** *(Scout Board)* — bonus goes to the top BPS
scorers in a match, and most managers only read BPS after the fact. This asks it
the other way round: how much BPS does a player bank from open play **before**
returning? **Baseline BPS** strips out the BPS awarded for goals, assists, clean
sheets, saves, penalties and cards, leaving what accrues from tackles,
recoveries, interceptions, passing and the appearance itself. A midfielder on 12
baseline BPS needs one assist to be in the bonus conversation; one on 3 needs a
goal *and* an assist. Shown per 90 beside **bonus per start** — the outcome the
baseline is trying to predict.

Every count it subtracts is an exact bootstrap figure, so there is no estimation
in the arithmetic and no extra API calls. The **tariff is the assumption**: FPL
does not publish the BPS table through the API, so the values in `BPS_TARIFF`
are hard‑coded and are the thing to correct if the numbers ever look off. They
cover return‑linked actions only — the 2026/27 changes to CBI, tackles and saves
affect *baseline* actions, which are already inside the reported total and are
never subtracted. Baseline is clamped at zero, since a negative would only mean
the tariff has drifted from the game. Available as a Scout Board leaderboard, a
sortable `Base/90` column with CSV export, a player‑profile stat, a Social Studio
preset and a card‑builder metric.

**Who takes the bonus at each club** *(Scout Board)* — baseline BPS answers
"who banks BPS without returning"; this answers the question that decides a
transfer: when you take a Brighton defender, *which one* takes the bonus? Bonus
concentrates inside a squad, often on a player you would not guess, and picking
the wrong one costs a couple of points a week all season. Each club's top three
bonus earners with their baseline per 90 underneath, clubs ordered by the bonus
their squad banked in total — so the top of the list also reads as which sides
generate bonus at all. Minimum 270 minutes; players who have left are excluded.

**Scout Board** — a per‑90 shortlist by position with the next **six** fixtures,
heat‑mapped per column and filterable by price cap (the budget‑enabler finder).
Attackers show xG, xA, G+A and DefCon per 90; defenders show starts, attacking
returns, CBIT and clean sheets.

Below it, **Best at every price** is the squad‑building ladder: for the selected
position, the strongest options in each half‑million band, ranked on projected
points over the next 6 fixtures. Bands are derived from the prices actually in
the game, so the ladder stretches to fit each position, and a label covers its
half‑million (£4.5 spans £4.5–£4.9). It answers "who do I buy with the £4.6m I
have left", not "who is the best player".

Then **DefCon by budget** answers the question that actually comes up —
not "who is the best defensive returner" but "who is the best at the money I
have left". Defenders are split into half‑million bands (£4.0m up to £6.0m+)
and ranked inside each band by **hit rate** (how often they clear the threshold
for the +2, real per‑match data from Core Insights where the sample allows,
otherwise a tilde‑marked estimate), alongside actions per start and attacking
returns.

**Player Compare** — up to four players side by side on form, xG, price,
ownership, ICT and **minutes security** (three‑tier badge).

**Differentials** and the **Injury Monitor** are no longer panels — both were a
filter and a sort over the same player data, so they are lenses on the Players
table (*Differentials* and *Fitness*). Old links still work.

**Price Predictor** — a threshold model estimates each player's **% likelihood
of a price rise/fall tonight** (net transfers vs an ownership‑scaled threshold,
logistic mapping, capped 5–95%, labelled an estimate), with sorted riser/faller
lists; net‑transfer momentum is kept as a secondary signal, plus
**points‑per‑million** best/worst value tables.

Topped by the **Value board** — the forward‑looking counterpart. Every outfield
player is projected over their next 6 fixtures, then priced against the *median
rate for their own position*: `FAIR` is the price that rate implies and `DIFF`
is the gap, so the panel names both the **underpriced** and — rarer, and more
useful — the **overpriced**. Benchmarking within position is deliberate:
defenders score fewer points per pound than forwards by design, so one
league‑wide rate would brand every defender a bargain.

**Set Piece Register** — official written **taker notes** (from `set-piece-notes`)
plus confirmed penalty / direct‑FK / corner order.

**Club Dossier** — every other panel is organised by player or by fixture.
This one is organised by **club**, which is how a large part of the community
thinks in pre‑season: pick a team, work out which end of it is worth buying,
find the cheapest way in.

- **Attack or defence?** Percentile of the club's fitted attack and defence
  ratings within the league. A side that rates far higher going forward is a
  "buy the attack" club — clean sheets are the less reliable route in. Being
  *balanced* is reported differently for a side strong at both ends and one
  weak at both, because those are opposite messages.
- **Home vs away**, from real results rather than the model — the question "are
  they different at home" should be answered by what happened, not by the
  home‑advantage term we fitted. Attack and defence are judged separately,
  since a club can score differently by venue while conceding the same
  everywhere. Below four games at each venue there is no verdict at all.
- **The board** — every asset ranked by projected points with the role that
  earns them: set‑piece duty, defensive‑contribution reliability, **minutes
  security**, and an **out‑of‑position** badge where a player is paid on a
  better tariff than the job he does.
- **Competing for a shirt** — the club's depth at each position, ranked by
  minutes security, marking the places where two players sit close enough
  that the pecking order is unsettled. This is the question the creator
  dossiers spend three cards on per club: *if the first‑choice man is rotated
  or shifts position, who inherits the minutes?* Rotation Risk and the
  planner's rotation chains answer the opposite question — one slot, several
  clubs — so nothing else here covers it.

  It is deliberately **not** modelled as starting slots. The formation a club
  settles on is not in the FPL data, and guessing 3‑4‑2‑1 over 4‑2‑3‑1 changes
  who counts as a starter; the pecking order and where it is contested is the
  useful part either way. Players with no minutes at the club — summer
  signings, academy call‑ups, exactly who a depth question is about — cannot
  be ranked on minutes, so they are **named as unranked rather than dropped**.
- **The run ahead** — the club's own fixture row over the next eight.

The tactical half of the creator dossiers — formation, playing style, "new
manager alert", preseason friendly signals — is editorial and is deliberately
absent. We can't compute it and won't fake it. The same goes for **role
watch** ("great as an advanced ten, avoid in deep midfield"): the API does not
publish where on the pitch a player operates, and a proxy built from xG/xA
variance would be confidently wrong exactly when it mattered — a deep
midfielder on set pieces would read as advanced. The out‑of‑position badge is
the bounded, computable version of that idea.

**Rotation Risk** — start‑rate risk for premium players from actual minutes,
plus **midweek congestion**: the European and cup football the official FPL API
cannot see.

The FPL API describes exactly one competition. A club playing Thursday in the
Europa League before a Sunday fixture is invisible to it, yet that is the
single biggest driver of rotation there is — and by the time `starts` and
`minutes` reflect it, the points are already gone. `/api/euro-fixtures` reads
the Champions / Europa / Conference League and the domestic cups from the open
[FPL‑Core‑Insights](https://github.com/olbauday/FPL-Core-Insights) dataset,
which files each competition by the FPL gameweek its matches fall in and
carries the club's official element team id — so the join needs no name
matching.

Congestion is measured in **days before kickoff**, not fixtures per week,
because what tires a squad is the gap rather than the count: Thursday to Sunday
is punishing, Tuesday to the following Saturday is a normal week's rest. A
match at or inside 3.2 days counts in full, tapering to nothing at six days,
and only matches *before* the fixture count — a cup tie the following Wednesday
tires nobody on the Saturday.

The load is not shared evenly. A manager rests the players already sharing
minutes long before dropping a certain starter, so the same congested week
barely moves a nailed man and lands hard on the squad player. And it suppresses
the **start**, not the appearance: a rested player is on the bench, not out of
the squad, and a good share of him comes on for the last half‑hour, so the start
probability congestion removes is partly returned as a cameo. Expected minutes
fall; expected appearances fall much less.

Unlike start rate, this is a *forward‑looking* signal, so it works from GW1
rather than needing games in the bank. It degrades to nothing: a competition
that has not kicked off yet simply 404s per gameweek and no club is congested —
which is the correct answer in July, not a failure.

### Planner

**Fixtures** — one horizon, three views. The Fixture Planner, the Points
Planner and the Clean Sheet Matrix were three destinations asking the same
question — what do the coming weeks look like — and answering it at three
levels: the club, the player and the clean sheet. Choosing between them from
the nav meant deciding which level you wanted before seeing any of them. They
are views of one panel now (`FX_VIEWS`, and `PANEL_VIEW` keeps `#points5` and
`#csmatrix` landing on the view they always showed). The three renderers are
unchanged — the hub only decides which one owns the body.

The Clean Sheet view is **not** the grid's Defence lens, despite both printing
a clean‑sheet percentage per club per gameweek, and it is kept rather than
folded in for two reasons: it reads the published model bundle instead of
ratings fitted in the browser, so it still works before a ball is kicked (the
grid answers "Between seasons" then); and it stacks **both** fixtures of a
double gameweek, where the grid's per‑team map keeps one fixture per gameweek
and drops the other.

**View 1 — Fixture grid** — model‑FDR grid (from win odds), expected goals for,
and clean‑sheet odds; plus the upcoming match outlook.

**Every cell shows its lens's projection, not just a colour.** The grid used to
shade a cell by a 1–5 difficulty bucket and print only the opponent — but that
bucket is derived from a projection the model already computed and then threw
away for display. Two fixtures shaded the same "2" can be 1.6 and 2.5 expected
goals, which is the difference between a fixture worth planning around and one
that is not. Each lens now prints its own number with the fixture underneath:
win chance (Overall), expected goals (Attack), clean‑sheet odds (Defence), or
the official 1–5 rating (FPL FDR). The run **Total** is in the same unit —
summed for goals, expected clean sheets and official FDR; *averaged* for win
chance, since summing probabilities would be meaningless. A blank gameweek
reads as a dash, never a zero. Horizon toggles **6 / 10 / 15
gameweeks or the whole Season** (the full remaining‑season grid competitors
paywall — here free, and across four lenses: Overall / Attack / Defence / the
official FPL rating). Teams re‑rank easiest‑run‑first; a purple underline marks
each club’s best run in the window. **Team filter** chips hide/show any club in
the grid (with **All** and, when a team is linked, **My teams** shortcuts).

**View 2 — Points** — the top assets by projected points over the next 5 or 8
gameweeks, filtered by position, with a per‑gameweek breakdown: each cell is the
opponent and the expected points, greener for a bigger projected haul. Ranked
by the horizon total, availability baked in.

**View 3 — Clean sheets** — for every 2026/27 club (from the shared model bundle),
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

**Chip plan (GW1–19, official FDR)** — chips reset at the halfway point, so
each one is used inside its half or lost. That makes the planning window the
whole half, not the next few gameweeks, and it makes the question a fixture
question. This plan reads the **official FPL difficulty ratings** on each
fixture (`team_h_difficulty` / `team_a_difficulty`) rather than our own match
model — it is the shared language of FPL content, so a plan built on it can be
argued about with anyone.

The two difficulty scales behave differently, and that matters here: ours is
derived from win probability and is close to zero‑sum, so the league mean barely
moves week to week; official FDR rates each opponent on absolute strength, so a
week where the strong sides all play each other genuinely reads as harder.
Ranking gameweeks by mean FDR is therefore meaningful on the official numbers
and misleading on the model ones.

- **Bench Boost** → the easiest week of the half. A bench only pays when the
  fringe players have games worth starting.
- **Free Hit** → the hardest week, or a blank. The week the normal squad is
  worst placed is the week a bespoke XI gains most.
- **Triple Captain** → the softest fixture available to an elite attacker
  (quality‑gated, so it is never a fringe player with a kind draw).
- **Wildcard** → the biggest swing: where the most clubs turn from a hard run
  to an easy one, measured as improvement only, since clubs getting *worse* is a
  reason to have wildcarded already.

**International breaks are read off the calendar**, not hard‑coded. The domestic
season pauses for roughly a fortnight while national teams play, so the gap
between consecutive gameweek deadlines about doubles — a gap of 11+ days marks
the following gameweek as post‑break. Deriving it from `deadline_time` means it
tracks whatever is actually scheduled, every season, with no FIFA‑window list to
maintain, and it copes with a season shifted by a tournament. A midweek round
*shortens* the gap, so the test is one‑sided; GW1 is never flagged, since it
follows the summer.

A break then moves the chips:

- **Wildcard** is favoured — two clear weeks to plan a reshape, with injuries
  picked up on international duty already known. This is the classic wildcard
  window, so a post‑break week wins a close call.
- **Bench Boost** and **Triple Captain** are penalised. Both need players to
  actually start, and the fringe of a squad is exactly who gets rested or
  returns late; the armband is a gamble when news lands after a long flight.
- **Free Hit** is left neutral — the uncertainty cuts both ways.

None of it overrides a blank or a double, which are far stronger signals: a
double gameweek still takes the Bench Boost even straight after a break.

The plan also exposes `rank` — each chip's preference order *before* collisions
are resolved, i.e. what it wanted as distinct from what it got.

**The first few gameweeks discount the Bench Boost.** The reason is structural
rather than evidential: early on the budget goes into the XI and the bench is
deliberately cheap, so boosting four players bought to be cheap — before anyone
knows which of them start — wastes the chip whatever the fixtures look like.
Bench value accumulates over a season, so the penalty decays (GW1 +0.60 FDR
points, GW2 +0.45, GW3 +0.30, GW4 +0.15, nothing from GW5). Unlike the Free Hit
and Wildcard, GW1 is *included* rather than excluded — a GW1 Bench Boost is
usable, just poor — and a week good enough still takes it. A double gameweek
overrides the discount entirely.

**GW2–3 discount the Wildcard.** A wildcard that early is rarely right even
when the fixtures swing there: one or two weeks of football is mostly noise, the
template has not formed, prices have barely moved, and the players you would
chase are the ones who happened to return once. Unlike GW1 this is a heavy
*discount* rather than a ban (GW2 ×0.45, GW3 ×0.70 — another week of evidence is
another week of evidence), so a genuinely broken squad can still out‑score it,
and the card says so when an early week wins anyway.

**GW1 is excluded for the Free Hit and Wildcard.** Transfers are unlimited right
up to the GW1 deadline, so either chip there buys a squad you can already pick
for nothing — playing one burns it for the whole half. Bench Boost and Triple
Captain are unaffected, since they change scoring rather than squad access, and
GW1 remains a legitimate week for both. There is no equivalent restriction at
GW20: the second‑half chips unlock there, but transfers are not unlimited.

**Chips are spread, and held as late as the case allows.** Fixture difficulty is
a static season‑long rating: it is fully known today and learns nothing between
now and GW14. Form, minutes, price moves and who actually starts only exist
later. So where several weeks make effectively the same case, the chip goes to
the **latest** one clear of the others — holding a chip costs nothing, and a call
made in GW14 has thirteen gameweeks of evidence behind it that the same call in
GW4 does not.

Two rules make that work. Chips are kept at least **3 gameweeks apart**
(separation is a *constraint*, not something maximised — maximising distance
would push a chip earlier than it needs to be, spending it to buy no
information), and the Free Hit is additionally kept clear of the Wildcard, since
a Free Hit reverts the squad and throws away the shaping the Wildcard just paid
for. Bench Boost beside a Wildcard is deliberately **not** blocked: wildcarding
into a strong bench and boosting it is a real plan.

The consequence is that on flat fixtures nothing is committed early — the plan
holds all four chips into the back half rather than spending them on noise. Each
pick also carries its `horizon` and an `edge` (how much better the chosen week is
than an average one); picks more than 5 gameweeks out are flagged **pencilled
in**, and when the best week is barely better than average the card says the
fixture case is thin rather than dressing it up. Blanks and doubles are calendar
facts and stay firm regardless.

**The second half runs to a deadline.** GW20–38 is planned by the same engine,
but the back of that window behaves unlike anywhere else because the chips
expire with the season.

- A **Wildcard** buys the gameweeks that *follow* it, and the squad carries on
  past the chip reset at GW20 — only the chips renew, not the team. Its value is
  therefore set by how many gameweeks remain to GW38, not by which half it sits
  in, and it tapers to nothing over the final six (GW32 full value, GW35 half,
  GW38 none). A GW37 wildcard reshapes a team for two matches. The first half is
  untouched, since nineteen‑plus weeks always remain there.
- **Bench Boost** and **Triple Captain** are marked down in the last two
  gameweeks. Sides with nothing left to play for rest players, and a chip that
  needs eleven or fifteen specific players to start is a poor bet.
- **Free Hit** is deliberately unaffected — you pick a fresh XI that week and
  can simply avoid the clubs on the beach.

A blank or double still outranks all of it: a GW38 double gameweek takes the
Bench Boost, and that is asserted.

**A gameweek needs enough clubs to be a gameweek.** An FPL XI is eleven players
with at most three per club, so at least **four clubs** must have a fixture
before a week is playable at all. Below that it is not a blank gameweek, it is
missing fixture data — and a "gameweek" where every club blanks is not a
gameweek. Such weeks are dropped from the plan entirely, rather than being
offered as the ultimate Free Hit, which is exactly what an unguarded blank count
produced.

Blanks and doubles override the difficulty read when the calendar has them.
Chips are assigned in order of how **constrained** they are, not how valuable —
a blank pins Free Hit to a week, the swing pins the Wildcard, while the armband
is happy with any soft fixture — and each walks its own ranked list to take the
best week still free, so one chip can never silently drop out. The window rolls
to GW20–38 automatically once the second‑half chip set is live.

Official FDR is a season‑long rating of the opponent: it knows nothing about
form, injuries or a new manager, and the card says so.

**The squad rules come from the game, not from us.** Squad shape, budget and
the per‑club cap are FPL's to change, and FPL publishes them — so the app reads
them rather than assuming. `bootstrap-static.game_settings` carries
`squad_squadsize`, `squad_squadplay`, `squad_team_limit`, `squad_total_spend`,
`transfers_sell_on_fee` and `ui_currency_multiplier`; each `element_types` entry
carries `squad_select` (how many of that position make a 15) and
`squad_min_play` / `squad_max_play` (the legal formations). No extra request is
needed — it all ships inside the bootstrap the app already loads.

The optimiser, the social cards and the money formatter all read from that
rulebook, and the minimum clubs needed for a playable gameweek is *derived*
(⌈XI ÷ club cap⌉ = 4) rather than asserted. A hard‑coded constant does not fail
loudly when a rule moves; it quietly makes every number downstream wrong for a
whole season, which is exactly what happened across the game when the
free‑transfer cap went from two to five.

It degrades field by field: a missing or nonsensical value falls back to
today's rulebook rather than taking the whole block down, and a squad shape
that does not add up to the stated squad size is rejected outright — half‑stale
data is worse than none. Two rules are deliberately **not** read: the
free‑transfer cap and the 4‑point hit are not published anywhere in the API, and
mapping them onto a field whose meaning cannot be confirmed would be worse than
an honest constant.

**Transfers and chips are one plan, not two.** A transfer strategy computed
independently of the chips gives the wrong instruction: it says "fix your
flagged defender" in the week a wildcard is about to rebuild him for nothing.
A chip plan that ignores transfers gives an unplayable one: a Bench Boost in a
week you had no route to making the bench ready for. So there is a single
engine, surfaced in two layers on top of the plan above.

**Transfer runway** — what to do about the *next* chip. `deadWeight()` ranks
what in the squad is not earning its place: flagged out, suspended or gone, or
at most 50% to play (serious); a doubt, or a player with real minutes and no
starts (moderate); a starter who never finishes, under 55 minutes a start
(minor). `transferRunway()` reads that against the plan. A **rebuild** chip
(Wildcard, Free Hit) within three gameweeks means *carry* — bank the transfers
and stop paying to fix what the chip fixes free. Further out than that, the
damage costs more than a hit would, so fix the serious problems now. A **bench**
chip (Bench Boost, Triple Captain) is the opposite instruction entirely: it
multiplies the squad you have rather than replacing it, so the run‑up is for
clearing problems, never for saving transfers you will not spend.

**Transfer ledger** — the same plan walked forwards, one row per gameweek from
now to the last chip, showing what is in the bank at that deadline and whether
the week banks, spends or plays a chip. The free‑transfer balance is
**reconstructed from your own transfer history** rather than requiring an
authenticated `my-team` call: every gameweek grants one, the bank caps at five,
GW1 is unlimited so nothing comes out of it, and a Wildcard or Free Hit leaves
the balance untouched — which is precisely why arriving at one with a stack is
worth planning for. A bench chip week spends from the bank like any other.

The ledger exists to make the stack legible. Five banked transfers is a
mini‑wildcard you did not have to play a chip for, so banking is part of the
chip plan rather than doing nothing — but only up to the cap, past which the
weekly grant is silently lost, and the card names the weeks where that happens.
It assumes no hits, and says so.

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
- **Native model validation:** on real historical returns, appearance‑conditional
  MAE **2.15** vs 2.37 for a 3‑GW form baseline and 2.18 for season PPG
  (`dev/backtest-vaastav.mjs`); walk‑forward against a mis‑specified generator,
  MAE **2.39** vs 2.79 form and 2.58 PPG (`dev/backtest-season.mjs`). See
  `docs/MODELLING.md` for the full breakdown by outcome band.
- `horizonXP` sums `fixtureXP` over the next N fixtures — the currency for the
  Transfer Solver, replacement finder and Fixture Planner. Availability is
  applied once, inside `fixtureXP`, on whichever branch it takes.
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
  - Authenticated `my-team` integration for exact selling price (the free‑transfer
    balance is already reconstructed from transfer history — see Transfer ledger).
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
