# Season research — sources, repos and features not yet used

*Compiled 13 August 2026, one day before the season opens. Scope: free APIs,
open datasets, public repositories and competitor features that could improve
**Gameweek Edge** and the **Premier League Bookings Desk**. A twin of this file
lives in `pl-bookings/docs/SEASON_RESEARCH_2026-08.md` with the same findings
and a desk-specific action list.*

---

## How to read this

The two apps already refuse to print numbers they cannot stand behind, so this
file marks its own evidence the same way.

| Mark | Meaning |
|---|---|
| **✅ Verified** | I fetched it from this machine and checked the response. Column names, row counts and totals below are real. |
| **⚠️ Reported** | From documentation or press coverage only. Plausible, not seen. |
| **🚫 Unverifiable here** | The host is blocked by this environment's egress proxy. Same position `football-data.org` and `fantasy.efl.com` were in — settle it with a CI probe from a machine that can reach it, exactly as `/api/efl/health` did. |

Blocked from this machine: `premierleague.com`, `footballapi.pulselive.com`,
`api.clubelo.com`, `api.open-meteo.com`, `fantasy.premierleague.com`,
`fantasyfootballscout.co.uk`, `fantasyfootballfix.com`, `fplform.com`.
`raw.githubusercontent.com` is reachable, which is why the largest finding below
is the one that is fully verified.

---

## 0. Corrections, after acting on this file

Two claims below were wrong when written and are corrected here rather than
quietly edited out.

**"You read one column."** `team-elo.js` does. But `netlify/functions/core-insights.js`
is a full Core Insights aggregator that has been running twice daily for two
seasons — `goals_prevented`, xGoT, non-penalty xG, chances created, touches in
the box, and a DefCon **hit rate** rather than an average, upserted to Supabase
and served to the client by `core-insights-data.js`. Three of the six things
§1 proposes were already shipped. §1 is left standing for the parts that are
still true (per-match xG history, cross-competition rotation, set-piece xG).

**"A dead `assistant` chip string."** There is no such thing. Every `assistant`
in `index.html` is the AI chat role or a CSS class. The grep that produced that
claim was mine and it was bad.

**What the audit did find**, by reading the aggregator rather than the README:
it was reading `By Gameweek/`, which carries every competition. Measured on
2025-26, 2,586 of 15,340 appearance rows were cup and European ties; 30 of 291
regular starters had a DefCon hit rate out by five points or more, worst 16;
league-wide `goals_prevented` read 17.4 against a true 13.4. The errors ran
*downward* on hit rate, because a Europa League start is a start FPL pays
nothing for — so the app understated the defensive reliability of the
most-owned players in the game. Fixed: it now reads
`By Tournament/Premier League/` and refuses to write if a non-league match id
appears. That bug was worth more than everything else in this document.

---

## 1. The headline: you already proxy the dataset that fixes both apps

`netlify/functions/team-elo.js` reads **one column** — `teams.csv.elo` — from
[olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights).
The comment in that file is careful about why Elo is worth taking and why it
does not override a fitted prior. All of that reasoning is sound. What it
misses is that the same repository, on the same no-key `raw.githubusercontent.com`
path the function already fetches, publishes about **200 more columns**,
per player, per match, keyed by official FPL IDs, refreshed twice a day.

### What is actually in there — ✅ Verified

**`data/{season}/By Gameweek/GW{n}/playermatchstats.csv`** — one row per player
per match, 63 columns:

```
player_id, match_id, minutes_played, goals, assists, total_shots, xg, xa,
shots_on_target, successful_dribbles, big_chances_missed, touches_opposition_box,
touches, accurate_passes, accurate_passes_percent, chances_created,
final_third_passes, accurate_crosses, accurate_long_balls, tackles_won,
interceptions, recoveries, blocks, clearances, headed_clearances, dribbled_past,
duels_won, duels_lost, ground_duels_won, aerial_duels_won, was_fouled,
fouls_committed, saves, goals_conceded, xgot_faced, goals_prevented,
sweeper_actions, dispossessed, high_claim, corners, saves_inside_box, offsides,
tackles, start_min, finish_min, team_goals_conceded, penalties_scored,
penalties_missed, top_speed, distance_covered, walking_distance,
running_distance, sprinting_distance, number_of_sprints, defensive_contributions
```

I checked 2025-26 GW20 (298 rows): `fouls_committed`, `was_fouled`, `tackles`,
`recoveries`, `xg` and `defensive_contributions` are **298/298 populated**.
The fouls total for the round is 205 across ten matches — 20.5 per match, which
is the right number for the Premier League, so the column is real data and not a
placeholder. The physical columns (`distance_covered`, `top_speed`, sprints) are
**empty for 2025-26** but present in the 2026-27 header; whether they fill once
matches are played is unknown.

**`.../player_gameweek_stats.csv`** — the FPL bootstrap fields *per gameweek*
rather than season-to-date, including `yellow_cards`, `red_cards`, `bps`,
`bonus`, `minutes`, `set_piece_threat`, `penalties_order`,
`defensive_contribution_per_90`, `chance_of_playing_next_round`.

**`.../matches.csv`** — team-level per match: possession, `home_fouls_committed` /
`away_fouls_committed`, corners, and xG decomposed into
`xg_open_play` / `xg_set_play` / `non_penalty_xg` / `xg_on_target_xgot`, plus
**both teams' Elo at kickoff** (`home_team_elo`, `away_team_elo`).

**`teams.csv`** — carries `elo` (which you use), and also **`pulse_id`** and
**`fotmob_name`**. Those two are free join keys into the official Premier League
match centre and into FotMob. The 2026-27 file is live and correct: 20 clubs
including Coventry (1661), Hull (1533) and Ipswich (1640).

History goes back through 2025-26 in the same shape, so anything built on it is
backtestable on day one.

**Terms**: no key, no account, twice daily at 07:30 and 17:30 UTC, used freely
with a link back to the repository.

### What this unlocks for Gameweek Edge

1. **Per-match xG, xA and xGoT.** Today the app reads FPL's season-cumulative
   `expected_goals`. Per-match values give you form windows, variance, and
   "he is out-shooting his return" as a *trend* rather than a season ratio.
2. **`goals_prevented`** — the honest goalkeeper metric. FPL pays saves; save
   count rewards a keeper behind a bad defence. `goals_prevented` (xGoT faced
   minus goals conceded) is shot-quality-adjusted and is the number that
   actually separates keepers. Nothing else free carries it.
3. **DefCon as a hit-rate, not an average.** `defensive_contributions` per match
   turns "9.2 DC per 90" into "hit the threshold in 5 of the last 6" — which is
   what a DefCon owner is buying, and what no season aggregate can show.
4. **Rotation Risk without the rate limit.** `football-data.js` spends its whole
   caching strategy on the fact that football-data.org allows ten requests a
   minute for the entire site. Core Insights publishes a `By Tournament`
   directory (⚠️ README claims cup, friendly and Euro coverage; I confirmed the
   `Premier League` folder resolves, and did not find cup folders at the one
   gameweek I probed — they would only exist in rounds where cup ties fell).
   Worth a look before the next fixture pile-up; it costs nothing per request.
5. **Set-piece threat from the source.** `xg_set_play` per club per match is a
   measured set-piece output. The Set Piece Register currently reads FPL's
   `set-piece-notes` and taker orders — who takes them, not whether they work.
6. **Match-level Elo at kickoff** — the correct input for a walk-forward
   backtest, instead of today's rating applied to a past fixture.

### The risk, and how you already handle it

This is one dataset from one maintainer. It should get the exact treatment
`efl/app/assets/provider.js` gets: every field enters through one file, a shape
guard that produces a **named error saying which document and what arrived**,
and no silent fallback to invented numbers. The Elo function already refuses
ratings outside 800–2600 for this reason; the same instinct scales.

---

## 2. FPL 2026/27 — three changes that touch shipped code

⚠️ **Reported** throughout this section; `premierleague.com` and
`fantasyfootballscout.co.uk` are both blocked from here, so verify before
editing constants.

### a. The BPS table changed — check `BPS_TARIFF`

Reported changes for 2026/27:

- One BPS per **three** clearances, blocks and interceptions (was one per two).
- The **−1 BPS for being successfully tackled has been removed** entirely.
- The reward for saving a penalty was **reduced**.

The comment above `BPS_TARIFF` in `index.html` (line ~8253) already anticipates
the first two correctly: CBI and tackles are baseline actions, they sit inside
the reported `bps` total, and `bpsFromReturns` never subtracts them — so those
two changes cannot corrupt `baselineBps`. That reasoning holds.

**The penalty save is different, and it is a live risk.** `penSave:15` *is*
subtracted. If the pen-save tariff moved, every goalkeeper who saved a penalty
gets a wrong baseline. One caution before touching it: the coverage I found
describes the change as "eight BPS to seven", which does not match the 15 in
your tariff — so either the reporting is about a different quantity, or your
constant was already wrong. Do not edit on my summary. `dev/test-bps-tariff.mjs`
re-derives the tariff from real match data on every run; the right move is to
let it speak once GW1 data exists, and to add penalty saves to what it derives.

### b. FPL now does live ranks and projected bonus itself

Reported: from 2026/27 the official game updates **overall rank and mini-league
standings live**, and adds **projected bonus after 20 minutes** of each fixture.

That commoditises two of the four things the Live panel sells. The header
comment at `index.html:10169` says the headline number is a
normal-approximation percentile rather than a true rank, and `provBonusPts` is
described as "what lets our live total lead the official app before bonus locks
in". Against a native live rank, an approximation is now *worse* than the free
alternative, and a 20-minute projected bonus closes most of the lead.

This is a positioning problem, not a code bug, and the answer is to pivot the
panel to what FPL still will not show:

- **Auto-sub risk before it happens** — you already compute autosubs; FPL only
  shows them after the fact.
- **Rival-specific effective ownership** — your rank against *your* mini-league,
  not the field.
- **Conditional rank** — "if Haaland returns, you gain 40k; if he blanks you
  lose 12k". You have the percentile machinery to do this and nobody else does
  it well.
- **The in-play win-probability timeline.** `plsimLiveProbs` already computes a
  conditional remaining-time Poisson forecast every render. Plotting it across
  the match *is* the "match momentum" chart FotMob and Sofascore are loved for
  — except yours is a fitted model rather than a shot-count proxy, and you are
  already paying the compute.

### c. What did **not** change

DefCon rules are unchanged from 2025/26, and chips remain two sets of four
(Wildcard, Free Hit, Triple Captain, Bench Boost). The `assistant` chip string
appears in `index.html`; if that is 2025/26's Assistant Manager, it is now
dead code and worth grepping out before someone trusts it. Saying "these did
not change" in the Glossary and New to FPL panels is genuinely useful content
in week one — most of the audience does not know.

---

## 3. Free sources not currently in use

| Source | Key? | What it gives | Worth it? |
|---|---|---|---|
| **FPL-Core-Insights** (rest of it) | No | §1 — per-match everything | **Yes. Highest value in this document.** |
| **Understat** | No | Shot-level xG with **x/y coordinates**, PPDA, 6 leagues, 2014→ | Yes, for shot maps — the only free coordinate data left |
| **api.clubelo.com** 🚫 | No | Daily Elo for every European club, CSV | Yes — the one thing Core Insights cannot give: a rating for a promoted club *before* it plays a PL match |
| **Open-Meteo** 🚫 | No | Hourly precipitation/wind by lat-lon, free, no key | Cheap and novel — see §5 |
| **Pulse API** (`footballapi.pulselive.com`) 🚫 | No | Powers premierleague.com; referee per fixture, lineups. `pulse_id` is already in `teams.csv` | Probe it. Could replace the rate-limited referee call outright |
| **openfootball/football.json** | No | Public-domain fixtures/results | Only as a second opinion for a shape guard |
| **The Odds API** | Free tier | ~40 bookmakers, **500 requests/month** (~16/day) | Yes — see §5; enough for one daily snapshot |
| **TheSportsDB v1** | Free key | Badges, TV listings. V2 (better TV filtering) is $9/mo | Only if the broadcaster line ships |
| **StatsBomb open data** | No | Full event data, free | Research only — historical, not in-season |
| **FBref** | — | — | **Dead.** ⚠️ Lost its Opta licence in January 2026; advanced stats were removed. Do not build on it, and if anything in the portfolio scrapes it, that path is gone |

The FBref collapse is the reason Understat's value went up this year: it is now
essentially the last free source of coordinate-level shot data.

---

## 4. Repositories worth reading (not depending on)

- **[sertalpbilal/FPL-Optimization-Tools](https://github.com/sertalpbilal/FPL-Optimization-Tools)**
  — the community-standard MILP optimiser (pandas + sasoptpy + HiGHS). Python,
  so not a dependency for a single-file app, but the *formulation* is portable:
  multi-period horizon, transfer cost priced into the objective rather than
  applied after, and chip usage as a decision variable rather than a suggestion.
  That is a better shape than a per-week greedy pick.
- **[sertalpbilal/fpl_hindsight_optimization](https://github.com/sertalpbilal/fpl_hindsight_optimization)**
  — optimal decisions for a whole season with perfect hindsight. This is exactly
  the benchmark Fantasy EFL's public record already grades against ("the best
  seven possible in hindsight"). Doing the same for FPL gives **The Model** page
  an absolute ceiling to plot against, which is far more honest and more
  interesting than a comparison to an average.
- **[bapairaew/open-fpl](https://github.com/bapairaew/open-fpl)** — read for
  planner UX, not code.
- **[douglasbc/scraping-understat-dataset](https://github.com/douglasbc/scraping-understat-dataset)**
  — a working Understat pipeline if §3 is taken up.
- **[vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League)**
  — already used by `dev/backtest-vaastav.mjs`. Still the right choice there.

---

## 5. Features from comparable products you are not maximising

Ordered by *value per unit of work*, given what is already built.

1. **Live win-probability timeline** (§2b). The compute already runs; only the
   drawing is missing. FotMob and Sofascore's momentum charts are their most
   praised feature, and both keep them free — this is table stakes now, not a
   premium hook.
2. **Shot maps.** FotMob shipped free heatmaps in February 2026 and Sofascore
   has had them for years; both are free tier. You cannot fake a heatmap from
   aggregate data — but Understat's x/y shot data gives you a real shot map,
   which is the more decision-useful half anyway.
3. **Elite-manager tracking.** Fantasy Football Fix's most-loved feature is
   watching top managers' moves live with push. You have public entry access,
   push infrastructure and Rival Scout. "What the top 10k did this week" is
   reachable with the endpoints you already whitelist.
4. **A season-in-review share card.** The Spotify Wrapped pattern is the highest
   organic-reach feature in this whole category, and you already have a share-card
   renderer (`scripts/promo`, `scripts/social`), `gwhistory` and `archive`.
   Nothing new is needed except the composition. Worth scheduling now for May
   rather than discovering it in May.
5. **Reddit sentiment digest.** "Panic sells and captain consensus from
   r/FantasyPL" is a differentiated daily-return feature, `ai.js` already exists
   with per-task prompts and per-gameweek caching, and it costs one Haiku call
   a day.
6. **Price-change push for watchlisted players only.** You have the predictor and
   you have push. Check they are wired to each other and scoped to the watchlist
   — a general price alert is noise, a watchlist one is why people open the app.

---

## 6. UX and interface — 2026 platform features that are pure deletion

All four suit a single-file vanilla app better than they suit a framework one,
because in each case the win is *removing* hand-rolled code.

- **CSS anchor positioning + the Popover API** reached Baseline in early 2026
  (Firefox 147 completed it). Every tooltip and dropdown that currently
  positions itself in JavaScript can hand that to the browser.
- **Same-document View Transitions** — a handful of lines around `openPanel()`
  gives the whole shell native-feeling transitions. Use the same-document form;
  cross-document is still missing in Firefox.
- **`content-visibility: auto`** on table rows is the cheapest available answer
  to the table-virtualisation problem the bookings desk has listed as open. No
  library, no windowing logic, no scroll maths.
- **Charts**: do not add a library. Inline SVG in the share-card style keeps the
  single-file rule and matches the existing visual language.

---

## 7. Deliberately not recommended

- **Sportmonks Expected Lineups** — €159/month as an add-on. Confirmed lineups
  are free from the official feed an hour before kickoff.
- **Scraping FBref** — the data is gone, not merely harder to get.
- **A charting framework** — see §6.
- **Paid odds tiers** — the free 500/month is enough for one daily snapshot,
  and the snapshot is the part that matters.

---

## 8. What I would do first, in this repo

| # | Action | Why now |
|---|---|---|
| 1 | ~~Verify `BPS_TARIFF.penSave`~~ **Done — no change needed.** `dev/test-bps-tariff.mjs` already treats it as underdetermined (one penalty-save row in the sample, 16.3 solved against a tariff of 15) and says in its own header that published summaries contradict each other and the code. The shipped 15 stands | The test was already right; the reported "8 to 7" is about something else |
| 2 | ~~Dead `assistant` chip~~ **Withdrawn — it does not exist.** See §0 | — |
| 3 | ~~Widen `team-elo.js`~~ **Superseded.** The aggregator existed; its competition scope was the actual defect, now fixed | See §0 |
| 4 | Plot `plsimLiveProbs` across the match as a momentum timeline | The compute is already paid for; it is the single most-loved feature in comparable apps |
| 5 | Re-scope the Live panel around auto-subs, rival EO and conditional rank | FPL's native live rank has taken the old positioning |
| 6 | `goals_prevented` into the goalkeeper view | Free, unique among free sources, and genuinely better than save count |
| 7 | Probe the Pulse API from CI | Would relieve the football-data.org rate limit that shapes an entire function |

---

*Sources:*
[FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights) ·
[FPL 2026/27 rule changes](https://fploracle.team/blog/fpl-2026-27-rule-changes-explained) ·
[FBref / Opta, 2026](https://www.liamhenshaw.com/writing/where-to-find-football-data) ·
[FPL-Optimization-Tools](https://github.com/sertalpbilal/FPL-Optimization-Tools) ·
[fpl_hindsight_optimization](https://github.com/sertalpbilal/fpl_hindsight_optimization) ·
[open-fpl](https://github.com/bapairaew/open-fpl) ·
[Understat scraping dataset](https://github.com/douglasbc/scraping-understat-dataset) ·
[openfootball](https://github.com/openfootball/football.json) ·
[Web platform Baseline 2026](https://web.dev/blog/web-platform-01-2026) ·
[FotMob vs Sofascore](https://footyapps.com/guide/fotmob-vs-sofascore)
