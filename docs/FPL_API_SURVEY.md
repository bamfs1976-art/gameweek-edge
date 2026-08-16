# What the FPL API serves, and what we ignore — 16 August 2026

Measured, not remembered. The sandbox this project is developed in cannot
reach `fantasy.premierleague.com` (the egress proxy answers 403), so this was
produced by `dev/fpl-endpoint-probe.mjs` running on a GitHub Actions runner —
workflow `fpl-endpoints.yml`, manual dispatch. Re-run it rather than trusting
this page after any FPL release.

**Coverage.** 32 paths from a hand-written list, plus every field on
`elements[]`, `teams[]`, `events[]` and the bootstrap top level. An endpoint
absent from this page was **not probed**, which is not evidence it does not
exist. A negative control (`this-endpoint-should-not-exist-xyz/`) returned 404,
which is what makes the 200s meaningful.

---

## 1. Routes

### One live defect, now fixed

`/api/set-piece-notes/` returns **404 with an HTML error page**.
`/api/team/set-piece-notes/` returns **200 with `{last_updated, teams[20]}`**.
The endpoint moved and our allowlist still pointed at the old path.

It had been failing silently — the single call site is
`loadSetPieceNotes().catch(()=>null)` — so the set-piece register simply had
no official data behind it. Nothing in the freshness check watches this feed.

**The content type is what identified it as a move.** Two other in-use routes
also 404'd in the same run, but as `application/json`:

| Route | Status | Body type | Reading |
|---|---|---|---|
| `set-piece-notes/` | 404 | text/html | no such route — **moved** |
| `dream-team/1/` | 404 | application/json | no dream team for an unplayed GW — **expected** |
| `entry/1/event/1/picks/` | 404 | application/json | no picks before the deadline — **expected** |

An HTML 404 is the web server saying the route does not exist; a JSON 404 is
the API saying the resource does not exist *yet*. Both of the JSON cases are
correct five days before the first deadline, and both call sites are guarded.

### Candidates that answer, and are not in the allowlist

| Path | Shape | Worth having? |
|---|---|---|
| `team/set-piece-notes/` | `{last_updated, teams[20]}` | **yes — this is the fix above** |
| `fixtures/?event=N` | `array[10]` | 3 KB against 118 KB for the full list. Useful for a single-gameweek view; we cache the full list anyway, so this is a payload saving rather than new data |
| `fixtures/?future=1` | `array[380]` | **untestable right now.** It returned all 380 — but pre-season every fixture *is* future, so this cannot distinguish "the parameter filters" from "the parameter is ignored". Re-probe once the season starts |
| `stats/most-valuable-teams/` | `array[0]` | exists, empty pre-season. Unknown whether it populates |
| `me/` | `{player, watched[]}` | answers unauthenticated with nothing in it. No use without a session, and we will not hold one |

`my-team/1/` returns **403**, not 404 — it exists and requires a login. We do
not authenticate as a user and should not start.

### Probed and absent

`game-settings/`, `bootstrap-dynamic/`, `teams/`, `element-types/`,
`entry/{id}/cup/`, `entry/{id}/cup-status/`, `event/{gw}/fixtures/`,
`leagues-entries-and-h2h-matches/league/{id}/`, `most-valuable-teams/`,
`player-stats/`, `elite/`, `region/`, `award/` — all 404.

Note that `game_settings`, `teams` and `element_types` are **not missing**,
they are keys inside `bootstrap-static/`. There is no separate route because
there does not need to be one.

---

## 2. Fields — where the real surface is

Routes are not where FPL adds things. `bootstrap-static/` is 1.35 MB and we
already download it on every load, so anything below is data we are **already
paying for and throwing away**.

Method: the literal field name was grepped against `index.html`. A name that
appears is weak evidence we use it; a name that appears **nowhere** is strong
evidence we do not. Read in that direction only.

### `elements[]` — 105 fields, 33 never mentioned

Grouped by what they would actually buy us:

**Team strength / difficulty**
- nothing here; see `teams[]` below

**Editorial risk — the most interesting group**
- `scout_risks`, `scout_news_link` — FPL's own Scout risk annotations. The app
  has an availability and minutes model but no editorial layer at all

**Set pieces**
- `corners_and_indirect_freekicks_text`, `direct_freekicks_text`,
  `penalties_text` — we already read the `_order` numbers, so this is the
  human-readable gloss beside an order we have. Modest, but it is the same
  data the broken endpoint was fetching, sitting in a payload we already hold

**Rates FPL computes that we compute ourselves**
- `saves_per_90`, `clean_sheets_per_90`, `starts_per_90` — we derive per-90
  rates by hand (see `dcRate90`). Worth diffing ours against theirs before
  adopting either

**Precomputed ranks — percentile context for free**
- `influence_rank`, `creativity_rank`, `threat_rank`, `now_cost_rank`, each
  with a `_type` variant that ranks **within position**. The scouting table
  builds its own comparisons; these are league-wide and positional percentiles
  with no computation

**Squad-builder guards**
- `can_select`, `can_transact` — whether a player may be picked at all. The
  draft builder currently reasons about status codes; these are the game's own
  answer

**Price movement**
- `cost_change_event_fall`, `cost_change_start`, `cost_change_start_fall`,
  `price_change_percent`, `value_form` — the FPL app already models price
  changes (`priceChangeProb`), so these are directly on-topic there. *(Not for
  the Fantasy EFL app, which is explicitly not a price/budget product.)*

**FPL's own projection**
- `ep_this` — expected points for the current gameweek, from FPL. We read
  `ep_next`. Holding both gives a second outside projection to grade our model
  against, which is exactly what this repository does with every other outside
  number

**Cosmetic / identity** — `birth_date`, `region`, `team_join_date`,
`known_name`, `opta_code`, `squad_number`, `team_code`, `special`,
`has_temporary_code`

### `teams[]` — 22 fields, 9 never mentioned

**This is the one worth acting on.**

```
strength_overall_home  strength_overall_away
strength_attack_home   strength_attack_away
strength_defence_home  strength_defence_away
```

FPL publishes its own team-strength model, **split by venue**, and we read
none of it. Our own fixture difficulty is `fdrAttack`/`fdrDefence`, five
hard-coded thresholds on a lambda:

```js
function fdrAttack(lam){
  if(lam>=2.0)return 1; if(lam>=1.6)return 2; if(lam>=1.25)return 3;
  if(lam>=0.9)return 4; return 5;
}
```

This session already established that our four-band difficulty scale is
["three bands wearing four labels"](briefings/2026-27-preseason.md) — easy
46.7%, moderate 25.8%, hard 23.6%, very hard 11.8% mean clean-sheet
probability. A venue-split strength model from the game itself is a third
independent scale to calibrate against, alongside the fplrotationplanner grid
and Tom Hadley's custom FDR already held as benchmarks.

Also unused: `team_division`, `link_url`, `pulse_id`.

### `events[]` — 29 fields, 13 never mentioned

`most_vice_captained` (we surface most-captained but not its shadow),
`transfers_made`, `ranked_count`, `highest_scoring_entry`, `can_manage`,
`can_enter`, `released`, `release_time`, `deadline_time_epoch`,
`deadline_time_game_offset`, `is_previous`, `cup_leagues_created`,
`h2h_ko_matches_created`.

`deadline_time_epoch` is worth a note: we parse the ISO string. An epoch that
FPL computed removes a timezone-parsing hazard for nothing.

### `element_stats` — 26 scored stats, **all 26 already handled**

```
minutes, goals_scored, assists, clean_sheets, goals_conceded, own_goals,
penalties_saved, penalties_missed, yellow_cards, red_cards, saves, bonus,
bps, influence, creativity, threat, ict_index,
clearances_blocks_interceptions, recoveries, tackles,
defensive_contribution, starts, expected_goals, expected_assists,
expected_goal_involvements, expected_goals_conceded
```

This is FPL's own list of what it scores, so a new entry here would be the
loudest possible signal of a rule change. **There is no unhandled scoring
stat.** The DEFCON family — `defensive_contribution`,
`clearances_blocks_interceptions`, `recoveries`, `tackles` — is fully covered.

### `chips` — eight entries, each chip twice

```
wildcard, wildcard, freehit, bboost, 3xc, freehit, bboost, 3xc
```

Two of every chip, which is the two-halves structure. Worth checking the chip
planner assumes that rather than one of each.

### bootstrap top level

`chips, events, game_settings, game_config, phases, teams, total_players,
element_stats, element_types, elements`

Never mentioned: **`game_config`**, `phases`, `element_stats`. `game_config` is
an entire configuration object we have never opened; `phases` is the
month-by-month ranking periods.

---

## 3. What was actually changed

Only the defect. Everything else on this page is a finding, not a decision —
adding a field to the app is a product call, and the standing rule on this
repository is that outside data is held and graded before it is adopted.

- `loadSetPieceNotes` now requests `team/set-piece-notes`
- the proxy allowlist gains `^team\/set-piece-notes$`; the old path stays
  allowed so a rollback is a one-line app change

## 4. If any of it is taken further, the order I would take it

1. **`teams[].strength_*`** — six numbers, venue-split, from the game itself,
   against a difficulty scale we already know is coarser than its labels claim
2. **`scout_risks` / `scout_news_link`** — an editorial layer the app has none of
3. **`can_select` / `can_transact`** — the game's own answer to a question the
   draft builder currently infers
4. **`ep_this`** — a second outside projection, held and graded like the rest
5. **the `*_rank` family** — percentile context for no computation
6. **`fixtures/?event=N`** — payload only, and we cache; do it if a
   single-gameweek view ever loads cold

Nothing above needs an API key, a login, or a paid service.
