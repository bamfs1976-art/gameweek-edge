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
      sample-data.js   the generated demo dataset
      provider.js      THE DATA ADAPTER — the only file that knows where
                       data comes from
      model.js         fixture rating, player score, club score
      ui.js            shared render helpers (badges, states, a11y rules)
      efl.css          the stylesheet
      page-*.js        one module per route
  README.md        this file
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
routes as pretty URLs. One site, one build, one domain. There are no new
environment variables, no new API keys and no new function.

The CSP in `netlify.toml` already covers this app unchanged: everything it
loads is same-origin except Google Fonts, which is already allowed, and it
makes no `fetch` at all while it is on sample data.

---

# ⚠️ The data is sample data

**Nothing on these pages is a live Fantasy EFL feed.** There is no free,
reliable source covering player-level data for all three EFL divisions that
this project already has access to. `football-data.org` — the one third-party
feed the repo has a proxy for — covers the Championship on its free tier and
not League One or League Two, and its key (`FOOTBALL_DATA_KEY`) is optional
and may be unset.

So the app ships with a generated dataset, and **says so on every page**. The
banner is not a footnote someone can forget to update: it is rendered from
`snapshot.source.live`, so it appears while that flag is false and disappears
by itself the day a real provider is configured.

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

### Ownership is absent on purpose

No public feed publishes Fantasy EFL ownership. `Player.ownership` is
therefore `null`, there is no ownership column anywhere, and the finder offers
a **form differential** instead — an explicitly editorial, modelled measure of
strong recent output at a club that gets less attention. It is labelled as
modelled wherever it appears, and it says what it is not. If a provider ever
does publish ownership, `normalisePlayer()` already reads the field; turning
the column back on is a UI change, not a data one.

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

## Player score (0-100)

| Input | Weight |
|---|---|
| Recent form — points per appearance in the last five | 30% |
| Starts and minutes | 22% |
| Output — goals, assists, clean sheets, weighted by position | 20% |
| Next fixture | 20% |
| Home advantage | 8% |

Availability is applied as a **multiplier** over the total
(`available` 1.0, `doubtful` 0.72, `injured` 0.12, `suspended` 0.08,
`unavailable` 0.10), not as a sixth weighted slice. An injured player with
perfect form is not slightly worse — he is not a pick, and the arithmetic
should say so.

Form and output are normalised within division **and position**: a
goalkeeper's points are not on the same scale as a forward's, and pretending
otherwise is how every "best player" list ends up all forwards.

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
   every weight table sums to 1; all seven dashboard picks are produced, are
   available and have a fixture.

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
