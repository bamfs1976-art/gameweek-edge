# Ten seasons of history

Gameweek Edge reasons about the current season. That works from roughly
gameweek five onward, and fails completely before gameweek one — the model
refuses to answer below five games played, which is correct, and which left the
Pre-season Draft ranking every player at zero.

This pipeline fixes that, and pays for itself three more times on the way.

## Where the data comes from

[`vaastav/Fantasy-Premier-League`](https://github.com/vaastav/Fantasy-Premier-League)
(MIT) — the same open dataset `dev/fetch-vaastav.mjs` already pulled for the
single-season backtest. Nothing new is depended on; the existing source is just
read in full, ten seasons instead of one.

Two files per season:

| File | Why |
|---|---|
| `gws/merged_gw.csv` | one row per player-fixture — the gameweek record |
| `players_raw.csv` | one row per player, carrying `code` and `element_type` |

`players_raw.csv` is not optional. `element` is a **per-season** id and is not
stable across seasons; `code` is FPL's permanent player id and is what careers
are joined on. Joining on name would be wrong — the `name` column has had three
different formats over the decade (`Aaron_Cresswell`, `Aaron_Cresswell_376`,
`Aaron Cresswell`) — and wrong in the worst way, silently splitting long
careers into fragments. `merged_gw.csv` also has no `position` column before
2022-23, so positions come from here too.

## The pipeline

```bash
npm run history          # fetch every season, then build the artefact
npm run history:fetch    # ~45MB of CSV into dev/fixtures/vaastav/ (gitignored)
npm run history:build    # → data/fpl-history.json (committed, ~540kB / 173kB gzipped)
node dev/backtest-history.mjs   # → data/backtest-history.json
```

`.github/workflows/history.yml` runs the whole thing weekly and commits only if
the reduced output actually changed. That workflow is also what makes this work
in CI at all: the app never reaches `raw.githubusercontent.com`, because the
CSV has already become a static file by the time anyone loads the page.

**The browser never sees a gameweek row.** ~250k player-fixture records reduce
to ~1,600 careers, each a fixed-order numeric array per season. The artefact
publishes its own `cols` order, so consumers never hardcode one.

Served at `/api/history` and `/api/backtest-history` — static files behind
redirects rather than functions, because they change once a season, not once a
request. Routing them under `/api/` keeps a single base URL for the packaged
iOS build to point at.

## Eras: what can and cannot be compared

The available columns change over the decade. This is recorded per season in
the artefact's `era` flags, detected from the header rather than hardcoded.

| Seasons | Has |
|---|---|
| 2016-17 → 2018-19 | basic stats only — no position, no xG, no starts |
| 2019-20 → 2021-22 | same, plus `position` from 2020-21 |
| 2022-23 → 2025-26 | **expected goals, assists, goals conceded**, `starts` |
| 2024-25 | manager assets (`mng_*`) |
| 2025-26 | **defensive contribution** (DefCon) |

Two consequences the code takes seriously:

- **DefCon has one season of history.** The Rank Threats panel gets almost
  nothing from this dataset, and the code says so rather than implying depth.
- **There is no ten-season backtest of the shipping model**, because the model
  reads expected-goals inputs that only exist from 2022-23. See below.

Also recorded: 2019-20 numbers its gameweeks 1–29 then 39–47 after the COVID
suspension. It is still a 38-gameweek season, so the artefact counts distinct
gameweeks and flags the gap in `gwGap` rather than reporting a max of 47.

## What it feeds

### 1. Pre-season Draft priors

`draftXP6` now takes a prior. Before gameweek one, FPL has zeroed every total,
so the prior is the only thing separating two players — measured, the board goes
from **0 of 120 players ranked to 120 of 120**.

Three rules keep it honest:

1. **Minutes-weighted.** 0.9 goal involvement per 90 from 180 minutes is not
   evidence; from 3,000 minutes it is.
2. **Recency-weighted, never to zero.** 0.72 per season with a 0.05 floor — last
   season counts about three times a season four years ago, but a long record of
   durability still counts for something.
3. **Era-gated.** Every read of xG or DefCon checks the era flags first. Reading
   a column that did not exist yields a confident zero, which is worse than no
   answer.

Confidence ships with every prior and is not cosmetic. A player with no Premier
League record — a promoted club's striker, an overseas signing — gets a
*positional baseline*, flagged **"No PL record"** in the UI, never a silent
zero. Ranking an unknown last is a bug dressed as an opinion. Goalkeepers get
save and clean-sheet baselines rather than a goal-involvement baseline, or an
unknown keeper would be zero on every axis and sort bottom anyway.

The blend hands back to live data as minutes accumulate: by 1,800 minutes the
current season dominates and the prior has mostly stepped aside.

### 2. Model Accountability — every season, graded separately

`dev/backtest-history.mjs` runs the same walk-forward, no-lookahead method as
the single-season backtest across all ten seasons, and reports two modes it
never blends:

- **`shipping`** (2022-23 →) — the model as it ships, on the inputs it reads.
  Four seasons. This is the number that means what it says.
- **`proxy`** (2016-17 → 2021-22) — the same structure fed *realised* rates
  where expected ones do not exist. A different, noisier model, reported for
  shape and excluded from the pooled headline.

The model beat the three-gameweek form baseline in **all ten** seasons. Pooled
appearance-conditional MAE across the four shipping seasons is **2.095** over
34,505 player-gameweeks.

The 2023-24 figure reproduces `dev/backtest-vaastav.mjs` exactly (2.157,
n=8,501) — a cross-check that the multi-season runner grades the same model the
same way. `dev/test-history.mjs` asserts it.

### 3. Career shape — floor versus ceiling

Expected points is an average, and an average hides the only thing separating
two players both projected at 5.5: whether that is a steady four every week or
three blanks and a haul. The armband doubles whichever it is.

`histShape` returns the distribution — haul rate, blank rate, spread, best
gameweek, home/away split — plus a **regression read**: realised goals and
assists against expected. Surfaced in:

- **Captaincy Lab** — career haul/blank next to the simulated ones. Where they
  disagree, the gap is the story.
- **Transfer Planner** — a caution when the incoming player is scoring above his
  chances, or the outgoing one below them. Same mistake, opposite directions.
- **Rank Threats** — whether a threat is real or riding a run that will end.

The regression read needs expected goals, so it is **absent** rather than
guessed for careers that predate 2022-23.

### 4. Ten Seasons panel

All-time records, any two careers side by side, and a daily guess-the-player
puzzle. The puzzle is deterministic from the UTC date — same player for
everyone, no server, no state beyond the date — drawn from the ~114 players with
600+ points and 80+ appearances, because a guessing game whose answer is a
player nobody has heard of is not a game. The pool is ordered by stable player
code so a rebuild cannot silently reshuffle today's answer.

## Known limitations

- **Survivorship bias.** Players with ten-year Premier League careers are, by
  definition, good ones. Any ageing curve built naively from this will flatter
  older players, because the ones who declined left the league. Nothing here
  currently builds one — that is the reason.
- **Scoring rules changed.** DefCon (2025-26) materially lifted defender and
  midfielder scoring. Recency weighting means the current rules dominate the
  priors, which is the right default, but a raw ten-season points-per-90
  comparison across eras is not like-for-like.
- **Points can be negative.** Kayne Ramsay's entire Premier League career is 180
  minutes and −2 points. Anything assuming a non-negative career total is wrong
  about FPL.
- **`xP` is deliberately not read.** vaastav's own expected-points column is
  filled in after the match, so anything derived from it carries lookahead bias.
  Both the fetch script and the reducer drop it, and a test asserts it never
  reaches the output.

## Tests

`dev/test-history.mjs` (109 assertions, wired into `npm test`) covers the
artefact's shape, the cross-season join, era-flag correctness, aggregate
consistency, the priors, the fallback path, the pre-season Draft behaviour,
career shape, the daily puzzle's determinism, and the backtest's mode
separation. It skips cleanly when the artefact has not been built, so a fresh
clone still passes `npm test`.

Like the rest of the model, the prior engine lives in `index.html` and is
extracted by name (`scripts/history/priors.mjs`) rather than reimplemented — so
what the tests grade is what the panels run.
