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

> **Correction, same day.** This section originally read "this is the one
> worth acting on" and recommended all six strength fields. That was written
> from the field NAMES. Dumping the actual values showed
> **`strength_attack_*` and `strength_defence_*` are 0 for all twenty clubs**,
> and `strength` itself is `null` — only `strength_overall_home/away` carry
> anything, on a coarse 2-5 scale.
>
> Checking a field exists is not checking it has data, and this page spent two
> sections warning about exactly that before doing it. The recommendation
> below is rewritten to what the numbers support.

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

**What the numbers actually are, 16 Aug 2026:**

| Field | Populated? | Range |
|---|---|---|
| `strength_overall_home` | yes | 2–4, median 3, mean 2.9 |
| `strength_overall_away` | yes | 2–5, median 3, mean 3.3 |
| `strength_attack_home` / `_away` | **no — 0 for all 20** | — |
| `strength_defence_home` / `_away` | **no — 0 for all 20** | — |
| `strength` | **no — null** | — |

**Direction, measured rather than assumed.** The name does not say whether a
bigger number is a stronger club or a harder fixture, and inverting it would
invert every rating built on it. Correlated against each fixture's
`team_*_difficulty` (1–5, higher = harder) over all 380 fixtures:

```
home strength vs away difficulty   n=380  r=0.818
away strength vs home difficulty   n=380  r=0.818
```

**Higher means a stronger club.** Settled.

That r also sets expectations honestly: at 0.82 against the FDR we already
read, `strength_overall` largely *reproduces* the existing `fpl` lens rather
than replacing it. Four distinct values are in play, so it separates fixtures,
but not finely. The residual — and the venue-split attack-vs-defence matchup
once FPL populates it — is the part that is genuinely new.

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

- `loadSetPieceNotes` now requests `team/set-piece-notes` (the defect above);
  the proxy allowlist gains `^team\/set-piece-notes$` and the old path stays
  allowed so a rollback is a one-line app change
- **a fifth Fixture Difficulty lens, `Strength`**, built on
  `teams[].strength_*` — see below

Everything else on this page is a finding, not a decision. Adding a field to
the app is a product call, and the standing rule here is that outside data is
held and graded before it is adopted.

### The Strength lens

`STR` shows **your strength over theirs**, each club taken at the venue it is
actually playing at. 1.00 is parity; above 1 favours you. The run total
**averages** rather than sums, because a ratio does not add up — the same
reason the overall lens averages win probability.

It prefers the **attack-versus-defence** matchup and falls back to
overall-versus-overall, so it upgrades itself the day FPL populates those
fields, with no code change. It reports which basis it used, because a number
whose meaning changes underneath the reader is worse than no number.

Three things it deliberately refuses to do:

- **Zero is treated as absent, not as the weakest possible club.** FPL ships 0
  for every attack and defence field today. Read as a real strength it would
  make every club maximally weak; used as a divisor it is a division by zero
- **A missing edge grades 3, never 1.** Absent data must not manufacture an
  easy fixture, and 3 sits above `FDR_PATCH_MAX` so it cannot pull a purple
  patch into existence
- **Bands mirror around parity in log space** (1.5 against 1/1.5, 1.15 against
  1/1.15), so "one band better than even" means the same thing whichever side
  of a fixture you are reading

Tested in `dev/test-core.mjs` — 26 assertions, including the one that catches
the direction being inverted. Verified to fail: flipping the grade order turns
it red on three assertions.

## 4. If any of the rest is taken further, the order I would take it

1. **`scout_risks` / `scout_news_link`** — an editorial layer the app has none of
2. **`can_select` / `can_transact`** — the game's own answer to a question the
   draft builder currently infers
3. **`ep_this`** — a second outside projection, held and graded like the rest
4. **the `*_rank` family** — percentile context for no computation
5. **`fixtures/?event=N`** — payload only, and we cache; do it if a
   single-gameweek view ever loads cold

Nothing above needs an API key, a login, or a paid service.

---

## Price: what the API publishes, measured 22 Aug 2026

Prompted by "the FPL price change page is live — what can we consume?".
Measured by `dev/fpl-price-probe.mjs` from a GitHub runner (this sandbox
cannot reach fantasy.premierleague.com), run 8 of the FPL endpoint probe
workflow. Every number below came back from the live API.

### There is no price API

Nine `/api/` paths probed — `element-status/`, `price-changes/`, `prices/`,
`stats/prices/`, `stats/price-changes/`, `element-prices/`,
`bootstrap-prices/`, plus `companion/v1/` discovered from the page HTML.
**All nine answered 404 `text/html` at 179 bytes**, byte-identical to the
negative control. So a 404 here means absent, not blocked, and the price
page is not backed by a public REST endpoint we could call.

`companion/v1` is the mobile companion API base and 404s on its own.

### The page probe cannot locate the page — do not repeat it

Seven candidate page paths were tried. All seven answered **200 `text/html`
at exactly 10032 bytes** — and so did `/this-page-should-not-exist-xyz`.
fantasy.premierleague.com is a single-page app: one shell for every route,
routing resolved in the browser. **No conclusion about which page exists can
be drawn from HTTP status there.** The first run of this probe had no page
control and would have reported seven live pages as a finding.

### Nothing has moved price yet this season

All four change fields are present and **zero for all 600 players**:

| field | non-zero | note |
|---|---|---|
| `cost_change_event` | 0/600 | |
| `cost_change_event_fall` | 0/600 | |
| `cost_change_start` | 0/600 | |
| `cost_change_start_fall` | 0/600 | |

`0 player(s) have moved price this gameweek; 0 since the season started.`
Cross-checked: Haaland's `now_cost` is 155 and his GW1 `history[].value` is
also 155, consistent with no movement rather than a broken field.

**This observation cannot distinguish "prices frozen, nothing has moved yet"
from "field deprecated and no longer populated."** Both produce an all-zero
column. The measurement that separates them is to re-run this probe once
FPL's own page shows a change: if the fields populate, they work; if they
stay zero while the page shows movement, they are dead and we need another
source. Until then, treat the zeroes as "too early", not as "working".

### We already consume everything price-related that bootstrap publishes

14/14 price fields present, none missing. `now_cost`, `cost_change_event`,
`transfers_in_event`, `transfers_out_event`, `selected_by_percent`,
`value_form`, `value_season` and `now_cost_rank` are all referenced in
`index.html`. `cost_change_start` is not (0 references) — it is season-to-date
drift, which would be a reasonable addition to a player profile once it is
non-zero, but there is nothing to show today.

`value_form` / `value_season` are non-zero for only 31/600 and cap at 2.0 —
too early in the season to rank on.

### `element-summary` publishes the real owner count — and it is not worth using

`element-summary/{id}/history[]` carries `selected`, the actual number of
managers owning the player. Our shipped `priceChangeProb` has to estimate
that as `total_players × selected_by_percent / 100`, because bootstrap gives
no better. Measured across the ownership range:

| player | own% | actual `selected` | our estimate | error |
|---|---|---|---|---|
| Haaland | 69.4 | 6,209,794 | 6,325,563 | +1.9% |
| Rogers | 24.4 | 2,178,086 | 2,223,973 | +2.1% |
| Kelleher | 5.8 | 513,912 | 528,649 | +2.9% |
| Sels | 1.6 | 140,711 | 145,834 | +3.6% |
| George | 0.3 | 24,527 | 27,344 | +11.5% |
| Davies | 0.1 | 11,845 | 9,115 | −23.0% |
| Kamara | 0.0 | 555 | 9,115 | **16× too many** |

The error explodes as ownership falls, exactly as `selected_by_percent`
being published to one decimal place predicts. That looks like a strong case
for using `selected` instead — **and it is wrong**, because of our own floor.

The threshold is `max(20000, 0.30 × owners)`. The `0.30 × owners` term only
overtakes the 20,000 floor above 66,667 owners — **0.73% ownership**. So:

- **Below 0.73% ownership** the threshold is pinned at 20,000 and the owner
  error changes *nothing*. Kamara's 16× error moves the threshold not at all.
- **Above 0.73%** the estimate is accurate to within 3.5%, and the threshold
  moves by at most 3.5%.

Run through the shipped function, the largest probability change anywhere in
the sample is **two percentage points** (Sels 57%→59%, Kelleher 20%→21%).
That would cost one extra HTTP request per player — 600 calls to redraw the
price panel — to move a displayed estimate by ≤2pp. Not worth it.

Recorded so this is not re-investigated. If the threshold floor is ever
lowered, revisit: the floor is the only reason the estimate is good enough.
