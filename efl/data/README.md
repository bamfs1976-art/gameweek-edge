# The Fantasy EFL season ledger

One file per round, `rounds/round-NN.json`, written by
`scripts/efl/record-picks.mjs` before the round locks and completed by
`scripts/efl/grade-round.mjs` after it settles. Both run from
`.github/workflows/efl-ledger.yml` every three hours.

**These files are evidence, not output.** Their value is entirely in the
fact that each one was committed before the football it describes was
played, and git's history is what makes that checkable. Nothing in this
repository can back-fill one: the recorder refuses to write after a lockout
and refuses to overwrite, and there is no flag for either.

## What a round file contains

| Key | Written by | What it is |
|---|---|---|
| `round`, `recordedAt`, `lockoutAt`, `hoursBeforeLock` | recorder | When the picks were made, and how long before the deadline |
| `source` | recorder | Which feed answered, when, and which points column it published |
| `rules`, `weights` | recorder | The squad rules and model weights **in force at the time**, so a later change re-grades nothing |
| `picks.players` (7), `picks.captain`, `picks.clubs` (2) | recorder | The picks themselves, with the rating and fixture each was given |
| `picks.naive`, `picks.crowdClubs` | recorder | Baselines fixed **before** the round — a baseline chosen afterwards is not a baseline |
| `universe` | recorder | Every player in the round: rating, position, club, and season points at lockout |
| `clubUniverse` | recorder | Every club's cumulative points at lockout, when the feed publishes such a column |
| `result` | grader | Everything measured afterwards. `null` until the round settles |

The `universe` block is the bulky part (~70kB a round) and it is the reason
a round can be re-graded years later with a better metric without needing a
feed that no longer exists.

## How points are obtained

The official feed publishes a player's **season total**, not a per-round
figure, so a round's points are:

```
round points = total now − total at lockout
```

That subtraction is only this round's score if nothing else was played in
between, so the grader marks a round `clean` only while the window between
this round's last kick-off and the next round's first is still open. Outside
it the round is graded and marked `ambiguous`, and the season figures leave
it out.

## What the website sees

`scripts/efl/publish-record.mjs` builds `www/fantasy-efl/data/record.json` at
build time — the picks, the points and the baselines, without the working.
The page at `/fantasy-efl/record/` reads that one file and computes nothing
of its own, so it cannot disagree with the ledger.

## Running it by hand

```bash
node scripts/efl/record-picks.mjs   # writes a round, only inside the window
node scripts/efl/grade-round.mjs    # grades whatever has settled
node scripts/efl/publish-record.mjs # rebuilds the public projection
```

`EFL_API_BASE` points at a different feed; `EFL_LEDGER_DIR` points at a
scratch directory. Both exist for testing. The scheduled job sets neither.
