# Fantasy EFL

The Gameweek Edge companion for the **official Fantasy EFL game** — weekly
player, club and captain picks across the Championship, League One and League
Two. Ships at `/fantasy-efl/` on this same origin, alongside Gameweek Edge at
`/` and Euro Matchday Edge at `/euro/`.

```
efl/
  package.json     marks the source as ESM for Node (tests import the models
                   directly). Deliberately OUTSIDE app/, so it never deploys.
  app/             everything that ships
    index.html               /fantasy-efl/            dashboard
    fixtures/index.html      /fantasy-efl/fixtures/   fixture ticker
    players/index.html       /fantasy-efl/players/    player finder
    clubs/index.html         /fantasy-efl/clubs/      club picker
    how-to-play/index.html   /fantasy-efl/how-to-play/ guide
    assets/
      types.js         the shapes everything agrees on (JSDoc typedefs)
      tariff.js        the verified Fantasy EFL scoring rules
      sample-data.js   the generated demo dataset
      provider.js      THE DATA ADAPTER — the only file that knows where
                       data comes from
      model.js         fixture rating, player score, club score, squad builder
      ui.js            shared render helpers (badges, states, a11y rules)
      efl.css          the stylesheet
      page-*.js        one module per route
  README.md        this file

../netlify/functions/efl.js   proxy for the official game's public feed
```

## Why it lives here, and on this URL

The same reason Euro Matchday Edge does: **the session is per-origin.**
Supabase persists the auth session in `localStorage`, so a separate domain
would mean signing in again and a Pro tier that looks absent on whichever app
you did not buy it from. One origin makes "one account, all three games" true
in the browser and not just in the database.

What it does **not** share with the other two apps is the model. Euro Matchday
Edge lifts the expected-points engine out of `../index.html` at build time,
because it plays the same game with the same currency. Fantasy EFL does not:
there is no budget, no player price, no transfer market and no price change in
this game, so the FPL optimiser and its cost-aware projections have nothing to
say about it. Extracting them would have meant shipping 45kB of code to
answer questions the game does not ask. This app carries its own small models
in `app/assets/model.js` instead — three weighted sums, all of them readable
in one sitting.

It is also **multi-page** where the other two are single-shell apps: five
routes, five real HTML files. That is a deliberate cost. Each page pays for
its own header markup, and in exchange each has a genuine `<title>`, meta
description, canonical URL and set of internal links that exist before any
JavaScript runs — which is what a search engine and a text browser can
actually read.

## Deploying

Nothing separate. `npm run build:web` copies `efl/app/` to
`www/fantasy-efl/` alongside everything else, and Netlify serves the directory
routes as pretty URLs. One site, one build, one domain. **There are no new
environment variables and no new API keys** — the official feed this app can
read needs neither.

The CSP in `netlify.toml` already covers this app unchanged: everything it
loads is same-origin except Google Fonts, which is already allowed. The
official-feed proxy at `/api/efl/*` is same-origin by design — `connect-src`
is `'self'` and nothing else, and adding a third party to it to save a hop is
how a content policy stops meaning anything.

---

# Data sources

Two of them. **The app reads the official feed by default**; the generated
dataset is one query string away.

## 1. The official Fantasy EFL feed — the default (`provider: 'official'`)

The official game publishes three JSON documents that need **no API key and no
account**:

| Document | Carries |
|---|---|
| `/json/fantasy/squads.json` | 72 clubs across all three divisions — league position, recent form, the game's own 1-5 fixture ratings, and **real ownership** (`percentSelected`) |
| `/json/fantasy/players.json` | every player: season totals, position, club, injury note |
| `/json/fantasy/rounds.json` | every round, its games, its status and its lockout time |

`netlify/functions/efl.js` proxies them at `/api/efl/*`; `provider.js` joins
and maps them. A fourth document, `player_profiles/{id}.json`, carries
per-match history and **requires a logged-in Fantasy EFL account** — this
project will not use it. Holding somebody's game credentials and making ~1,100
requests to refresh one page is a bad trade, and the gap is stated in the UI
rather than hidden.

### ⚠️ It has not been observed responding

`fantasy.efl.com` is unreachable from the machine this was written on — the
egress proxy refuses it, exactly as it refuses `api.football-data.org` for the
sibling function. The paths and field names come from the official game's own
front end as used by a working public site, not from a response anyone here
has seen. The mappers are unit-tested against a synthetic payload in that
shape, which catches a mapping bug and **cannot catch a wrong shape**.

That risk is real, so what it is allowed to *cost* is bounded rather than
hoped away. A shape that does not match has exactly two possible outcomes:

1. `assertOfficialShape()` names it — which document, which field, and what
   actually arrived — and the page shows that sentence.
2. The data really is the shape expected.

The third outcome, where a renamed field becomes a column of zeroes and the
app confidently shows numbers that mean nothing, is what the guard exists to
make impossible. There is **no fallback to sample data**: substituting
invented numbers for a feed that changed is the failure this whole design
exists to prevent.

### `/api/efl/health` — the one-request diagnosis

```
https://gameweekedge.co.uk/api/efl/health
```

Fetches all three documents and reports, per document: the HTTP status, how
many records came back, and which of the fields this app depends on are
actually present (`fieldsPresent` / `fieldsMissing`, plus the first record's
keys). `ok: true` means the feed is the shape the app expects. Never cached —
a health check that can answer from ten minutes ago is not a health check.

Its `EXPECTED` table and `assertOfficialShape()` are the same claim made
twice, once for a human opening a URL and once for the code; a test asserts
they do not drift apart.

### If it is wrong

Nothing needs a deploy to recover. Append **`?provider=sample`** to any
Fantasy EFL URL for the clearly-labelled generated dataset, and the error
state links to both that and the health check. To change it for everyone,
flip `DEFAULT_CONFIG.provider` back to `'sample'` in `provider.js`.

### What the free tier cannot answer

Every source declares a `coverage` object, and the UI renders it as a
disclosure under the data banner. A source that answers some questions and not
others is the normal case; the failure worth designing against is a form meter
built from nothing that looks exactly like one built from five rounds.

- **No per-match player history** → form falls back to season points per
  appearance. Measured, that is a real predictor (+0.408 against next-round
  points) and weaker than the five-round window (+0.447).
- **No minutes** → the model's strongest input falls back to appearance share.
  `playingShare()` handles this in one place, and a regression test pins it:
  a source with no minutes must still produce picks and a legal seven, not an
  empty page.
- **No club goals for/against** → those inputs to the club rating go flat, and
  `normalise()` answers a flat input with 0.5 for everyone, which is the honest
  response to "nothing separates them".

## 2. Sample data (`provider: 'sample'`)

Still here, still one query string away, and it **says so on every page** when
it is in use. The banner is not a footnote someone can forget to update: it is
rendered from `snapshot.source.live`, so it appears whenever that flag is false
and is absent otherwise. It is the fallback a human chooses, never one the app
substitutes.

What is real and what is not:

| | |
|---|---|
| **Real** | The 72 club names, and which division each is listed in. Used descriptively, as club names are used everywhere else on this site. |
| **Invented** | Every result, table position, goal, minute, injury — and **every player name**. Names are assembled by a seeded generator from two ordinary word lists. They are not real footballers and are not intended to resemble any. |

The dataset is *generated*, not hand-written, and that is a correctness
decision rather than a convenience one. Club strengths are the only input; the
season is simulated forward from them, and the league table, form strings,
home/away splits, clean sheets and every player's goals are all read back out
of the simulated results. Nothing is written down twice, so nothing can
disagree with itself — no club sits top of the table with three defeats in its
form guide. `dev/test-efl.mjs` asserts exactly that coherence.

It is also deterministic: the same `seed` and the same `now` give the same
dataset, every time. A demo that reshuffles on refresh cannot be tested and
reads as a bug.

## Where data enters the app, and how to replace the provider

**One file: `app/assets/provider.js`.** Nothing else in the app knows where
data comes from. Every page, table and scoring function reads only the shapes
declared in `app/assets/types.js`.

```
provider.js ── loadSnapshot() ── createProvider(config)
                                   ├─ sampleProvider()  ← the default
                                   └─ remoteProvider()  ← the seam for a real feed
                                          ↓
                                 normaliseSnapshot()    ← everything passes through here
                                          ↓
                                 EflSnapshot { source, clubs, players, fixtures, currentRound }
                                          ↓
                        model.js buildContext() → the pages
```

To point it at a real feed:

1. **Publish a same-origin endpoint.** Add a Netlify function and a redirect
   in `netlify.toml`, following the `/api/fpl/*` and `/api/ucl/*` pattern. It
   must be same-origin for two reasons: the site's CSP allows
   `connect-src 'self'` and nothing else, and an upstream API key belongs in
   the function's environment where the browser can never see it.
2. **Point the app at it**, before the page modules load:
   ```html
   <script>window.EFL_CONFIG = { provider: 'remote',
                                 endpoint: '/api/efl/snapshot' };</script>
   ```
3. **Adjust `normaliseSnapshot()`** if the upstream field names differ. It is
   already defensive — unknown enum values fall back, numeric strings coerce,
   missing objects become empty ones, and a player whose club is not in the
   feed is dropped rather than rendered as a row of dashes.

**There is no fallback from remote to sample.** If a live provider is
configured and fails, the pages show an error state. Silently substituting
invented data for a feed that went down is the exact failure this whole design
exists to prevent.

### Ownership: real for clubs, absent for players

This README used to say flatly that no public feed publishes Fantasy EFL
ownership. That is **true of players and false of clubs**, and the distinction
matters enough to be exact about:

- **Clubs** — the official game publishes `percentSelected`. `Club.ownership`
  carries it, the club picker shows it as a column and can sort by it, and both
  appear only when the active source supplies them. A strong club that few
  managers have picked is the closest thing to a genuine differential the game
  offers.
- **Players** — nothing public appears to publish it. `Player.ownership` stays
  `null`, there is no player ownership column, and the finder offers a **form
  differential** instead: an explicitly editorial, modelled measure of strong
  recent output at a club that gets less attention. It says what it is not,
  every time it appears. If a provider ever does publish it,
  `normalisePlayer()` already reads the field.

### The rule the sample data follows

Simulated football is generated. **Third-party assertions are not.** Goals,
minutes, positions and injuries are simulated football — inventing them is the
whole point of sample data, and the banner says so. Ownership and the official
1-5 fixture ratings are different in kind: they are the official game's
statements about what real managers picked and how hard it rates a fixture.
Generating those would be putting words in someone's mouth, so the sample data
leaves them `null` and the UI hides those columns until a source that actually
publishes them is connected.

---

# The models

All three live in `app/assets/model.js`, with their weights in exported tables
at the top of the file. Change a number there and the whole app changes with
it. Every input is normalised to 0-1 **within the club's own division** before
anything is combined, which is what makes a rating mean the same thing in
League Two as it does in the Championship — and what makes cross-division
comparison, the thing Fantasy EFL asks of you that no single-division game
does, possible at all.

## Fixture rating (1-5)

Each club gets one **opponent index**: a weighted blend of points per game
(50%), goals conceded (28%) and goals scored (22%), min-maxed across its own
division. A fixture's difficulty is the opponent's index, shifted by
`HOME_ADVANTAGE` (0.10, a fifth of a band) for the side at home, then banded
into five: `<0.2` → 1, `<0.4` → 2, `<0.6` → 3, `<0.8` → 4, else 5.

The composite is re-spread across the full 0-1 range before banding. Three
averaged inputs cluster around the middle, and without that step every fixture
in the league comes out a 3 — a scale that tells you nothing.

A **blank round** is scored as maximum difficulty in a run summary, because
for a fantasy manager a week with no game is worse than a hard one. A
**double** counts both matches.

## The scoring tariff (`tariff.js`)

The app used to decline to state Fantasy EFL's scoring rules, on the grounds
that guessing at another game's rules in public is worse than saying "look it
up". It is no longer a guess. The tariff in `tariff.js` was checked by
recomputing **83,698 real player-round records** — 35 rounds of a completed
season, published by the official game — from their raw statistics and
comparing with the official points figure. **83,688 reproduce exactly:
99.99%.** The ten misses are all off by one, which is what post-match stat
corrections look like.

Three consumers read it and must never drift apart: the model (which scores
output in the game's real currency), the player finder (which shows what each
stat was worth, in the cell), and the guide (which prints the table).

Two facts from it drive product decisions elsewhere in this app:

- **A goal is worth double to a goalkeeper what it is to a forward** (10 vs 5),
  defenders are paid for clearances, blocks and tackles, and midfielders get
  **two points per interception** — the most valuable repeatable stat in the
  game.
- Consequently, measured over those same appearances, mean points per
  appearance run **DEF 4.19 > GK 4.08 > MID 3.88 > FWD 3.14**. The forward is
  the *worst*-scoring position. Any model inheriting FPL's "captain your best
  forward" reflex is wrong here, and `roundPicks()` used to have exactly that
  reflex.

## Player score (0-100)

The weights are not picked by feel. They come from a walk-forward test on the
same dataset: for each of **52,158 player-rounds**, build a predictor from
earlier rounds only and correlate it with the points actually scored in the
*next* round.

| Predictor | Correlation with next-round points |
|---|---|
| **Average minutes, last 5 rounds** | **+0.515** |
| Total points, last 5 rounds | +0.494 |
| Season start rate | +0.461 |
| Points per appearance, last 5 rounds | +0.447 |
| Points per appearance, season | +0.408 |
| Points **per 90 minutes**, last 5 rounds | +0.065 |

| Input | Weight |
|---|---|
| Starts and minutes | 34% |
| Recent form — points per appearance in the last five | 26% |
| Output — everything the player is paid for, at the real tariff, per 90 | 16% |
| Next fixture | 16% |
| Home advantage | 8% |

**Minutes outweigh form**, which is the opposite of what this model shipped
with (form 30%, minutes 22% — the FPL habit). A player averaging under 30
minutes across his last five returns 0.59 points the following round; one
averaging 75+ returns 4.25.

**Per-90 is a trap** and the app was already right to avoid it: it flatters a
substitute who scores in a twenty-minute cameo. Form is always points per
*appearance*.

The fixture and home weights are then **scaled by position** and renormalised
so each position's weights still sum to 1:

| | Home advantage (measured) | Fixture emphasis |
|---|---|---|
| GK | +0.7% | ×1.70 |
| DEF | +6.0% | ×1.60 |
| MID | +8.9% | ×0.85 |
| FWD | +14.3% | ×0.70 |

A goalkeeper barely notices where he is playing; a forward notices a lot.
Fixture difficulty runs the other way: overall points move ~17% between the
easiest and hardest bands, but a goalkeeper's or defender's clean-sheet rate
moves **36.3% → 19.0%**, and a clean sheet is five points.

Availability is applied as a **multiplier** over the total
(`available` 1.0, `doubtful` 0.72, `injured` 0.12, `suspended` 0.08,
`unavailable` 0.10), not as a sixth weighted slice. An injured player with
perfect form is not slightly worse — he is not a pick, and the arithmetic
should say so.

Form and output are normalised within division **and position**: a
goalkeeper's points are not on the same scale as a forward's, and pretending
otherwise is how every "best player" list ends up all forwards.

## Building a legal seven (`buildSquad()`)

The dashboard's four "best in position" cards are useful and they are not a
team. Fantasy EFL takes **seven players — one goalkeeper and six outfielders**
— in one of three formations (`1-2-2-2`, `1-2-3-1`, `1-3-2-1`), with **at most
two from any one club**. A "one-club chip" lifts that cap, and the dashboard
has a toggle for it.

Those constraints are the whole difficulty. Without them the answer is "the
seven highest-rated players", which is usually illegal — the top of any
form-driven list clusters into the two or three clubs having a good month.

A greedy pass down a sorted list is what most tools do here and it is
measurably not optimal: taking the best midfielder can lock you out of two
better defenders at the same club. `buildSquad()` runs a depth-first search
with branch-and-bound over the top candidates per position — the club cap is
the only thing coupling positions, so the bound is tight and prunes hard. Three
formations over a pool of 12 per position settles in single-digit
milliseconds, and a test asserts it never scores below greedy.

## Club score (0-100)

| Input | Weight |
|---|---|
| Recent form — league points in the last five | 28% |
| Upcoming fixtures — mean difficulty of the next three | 28% |
| Goals conceded in the last five | 20% |
| Goals scored in the last five | 17% |
| How many of the next three are at home | 7% |

## Explaining itself

Both scores return a `Recommendation`: a number, a `factors[]` array of
`{key, label, value, weight, note}`, and a `summary` sentence assembled from
whichever factors contributed most — *"Strong recent form (27 points in 4
appearances), started 14 of 16 (88%)."* The sentence is a readout of the
arithmetic, not a caption written over it. Wherever a score is shown in the
interface, the reasoning is shown with it.

## What these models are not

They are not predictions and they carry no claim of accuracy. They rank the
options in front of you against stated criteria, using results that have
already happened. They cannot see team news, a manager change, a cup replay or
a dressing-room row. The interface language is deliberate throughout:
*recommended*, *favourable*, *strong option*, *modelled rating* — never *will*.

---

# Accessibility rules this app holds itself to

- **Fixture difficulty is never colour alone.** Every rating cell carries its
  number as visible text and a full sentence as its accessible name
  (*"away at Norwich City — difficulty 4 of 5, tough"*). A legend gives the
  word for every band.
- **Form is never colour alone.** Every pip carries its letter, and the strip
  has one accessible name reading the run out in order.
- **Availability is a word before it is a colour.**
- **Dense tables become stacked cards below 640px.** A twelve-column fixture
  grid cannot be made to work on a phone by shrinking it. Every cell carries a
  `data-label` that becomes its heading once the header row is hidden.
- Skip link, one `<h1>` per page, semantic headings, visible focus rings,
  `aria-live` on result counts, and `prefers-reduced-motion` disables the
  skeleton shimmer and every transition.

---

# Tests

`dev/test-efl.mjs`, wired into `npm test`. It covers the three things worth
covering and skips the one that is not:

1. **Sample-data coherence** — the table matches the results it was generated
   from; W/D/L sums to played; points match W/D/L; goals scored and conceded
   balance across each division; form strings match `last5`; the six-round
   window contains at least one blank and one double so those paths are
   exercised; the dataset is deterministic.
2. **Provider defensiveness** — a half-answered payload is repaired rather
   than thrown at the user; unknown enum values fall back; orphaned players
   are dropped; an empty club list is a real error; a failing remote provider
   surfaces the failure instead of quietly serving sample data.
3. **Model contracts** — ratings are integers in 1-5 and every band is used;
   home advantage points the right way; normalisation really is
   division-local; availability behaves as a multiplier and not a deduction;
   every weight table sums to 1 *per position as well as in the base*; minutes
   outweigh form (so a later tuning pass has to argue with the measurement);
   position emphasis points the way the data does; all seven dashboard picks
   are produced, are available and have a fixture.
4. **The tariff** — each position is paid for the right things and nothing
   else; the irregular minutes and clean-sheet rules behave; and **every
   sample appearance recomputes exactly from its own stats**. The real dataset
   reproduces 99.99% of the official points column; the sample data is held to
   100%, because there is no excuse for it.
5. **The squad builder** — the shape is one of the three legal formations,
   never more than two players from one club, the chip lifts that and never
   scores worse, the captain is the best player *in* the seven, and the search
   never comes out below a greedy pass.
6. **The official feed** — the competition-to-division mapping is derived
   rather than hard-coded; fields survive the mapping; a stat the feed omits
   stays `null` rather than becoming zero; and — the regression that motivated
   `playingShare()` — **a source publishing no minutes still produces picks and
   a legal seven** instead of a silently empty page.

Plus a static pass over the five routes: unique title, unique description,
correct canonical, Open Graph tags, links to every sibling route, exactly one
tab marked `aria-current`, and the independence notice on each. That contract
rots silently, so it is asserted rather than remembered.

Deliberately **not** tested: the exact score of a given player. Those weights
are meant to be re-tuned, and pinning them would make tuning a chore rather
than a decision.

---

# Legal

Independent tool. Not affiliated with, endorsed by or associated with the
English Football League, the Championship, League One, League Two or the
official Fantasy EFL game. Those names, and the club names used throughout,
are trademarks of their respective owners and are used descriptively only. No
official logos, crests, fonts or imagery are used anywhere in this app — the
visual identity is Gameweek Edge's own, with an EFL-indigo accent and a
three-stripe division motif drawn in CSS.

The `how-to-play` page describes the *decisions* the game asks you to make. It
does not reproduce the official rules or scoring tariff, and it says so: for
scoring, deadlines and eligibility, read the official game.
