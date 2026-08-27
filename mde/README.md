# Matchday Edge

UEFA Champions League Fantasy assistant. Personal use. Sibling of Gameweek Edge,
sharing its Supabase project, auth and design system.

**Two days. One plan.**

## Where this code is going

The design brief puts Matchday Edge in its own repository
(`bamfs1976-art/matchday-edge`, Netlify site `matchdayedge`). That repository does
not exist yet, so Phase 1 is being built here, in a folder with no ties to
anything above it: `rules.js` imports nothing, and the test imports nothing but
Node builtins and `rules.js`. Moving `mde/` into the new repository is a copy,
not a rewrite — the only edit needed is the path in the root `package.json` test
script.

Nothing here forks `index.html`, and nothing here imports from Gameweek Edge.

## What is built

| Phase | | |
|---|---|---|
| 1 | Rules engine + tests | **done** — `app/assets/rules.js`, `dev/test-rules.mjs` |
| 2 | `uefa.js` function, snapshot table, manual import | not started |
| 3 | Squad Builder: validation strip, day balance meter | not started |
| 4 | Matchday Planner: sub panel, auto-sub simulator | not started |
| 5 | Transfer Planner, chip board | not started |
| 6 | Limitless what-if, captain picks, push reminders, PWA shell | not started |

## The rules engine

`app/assets/rules.js` is the source of truth for every rule in section 3 of the
brief, encoded from the official 2026/27 rules page (updated 1 June 2026). One
module, no dependencies, every constant frozen. Every validator in the app reads
from here rather than carrying its own copy, because screens that disagree about
the rules disagree quietly and at the worst possible moment.

Validators **report, they do not block**. Each returns
`{ ok, breaches: [{ code, message, ...detail }] }` — a machine-readable code and
a sentence fit to put on screen. The squad builder is meant to let you assemble
an illegal squad and work the red strip down to nothing.

What it deliberately does **not** know: kick-off clock times and the day-by-day
split of a matchday. Deadline dates are published and fixed; the hours are not,
and they arrive with the fixture feed in Phase 2. Nothing in `rules.js` needs a
network call to be right.

### Tests

```
node mde/dev/test-rules.mjs
```

92 checks, wired into the root `npm test`. They cover every rule in section 3:
the calendar and its six stages, the club cap at each of them, the transfer
allowance matchday by matchday and the three separate routes to "nothing
carries", both chips and the matchdays they are barred from, all eight legal
formations, the squad and XI validators, the in-matchday sub and captain rules,
the auto-sub engine, and the scoring table position by position.

The suite has been mutation-tested: 25 deliberate one-line breaks to `rules.js`
— a club cap raised, a deadline moved, the 60-minute clean sheet threshold
dropped, the auto-sub formation guard removed — and all 25 turn it red.
