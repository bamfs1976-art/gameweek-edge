# The FPL season ledger

One file per gameweek, `gw-NN.json`, written by
`scripts/record/record-picks.mjs` inside the 36 hours before the deadline and
completed by `scripts/record/grade-gw.mjs` once FPL has finished scoring the
gameweek. Both run from `.github/workflows/fpl-record.yml` every three hours,
which commits whatever changed. The Fantasy EFL twin lives in
`efl/data/rounds`; the rules are the same.

**These files are evidence, not output.** Their value is that each was
committed before the football it describes was played, and git's history is
what makes that checkable. Nothing here can be back-filled: the recorder
refuses to write after a deadline and refuses to overwrite, and there is no
flag for either.

| Key | Written by | What it is |
|---|---|---|
| `gw`, `recordedAt`, `deadlineAt`, `hoursBeforeDeadline` | recorder | When the picks were made, and how long before the deadline |
| `source` | recorder | Which feed answered and how big it was |
| `picks.totw` | recorder | The model Team of the Week: formation, eleven players with the xP each was given and their fixture |
| `picks.captain` | recorder | The captain pick and the two alternatives it beat |
| `picks.prices` | recorder | The five most likely price moves, direction and probability |
| `picks.naiveXI` | recorder | The best legal XI by FPL's own form figure, fixed **before** the gameweek — a baseline chosen afterwards is not a baseline. Absent while nobody has form |
| `universe` | recorder | Every available player's xP, cost and form at the moment of the pick, so a later, better grade needs no feed that no longer exists |
| `result` | grader | Everything measured afterwards. `null` until FPL has scored the gameweek |

`result.totw.average` is FPL's published average manager score; `null` means it
was not published and the page shows "not graded". Nothing is estimated.

`scripts/record/publish-record.mjs` builds `www/record/record.json` at build
time; `/record/` and the scorecard under **The Model** in the app read that one
file and compute nothing of their own.

```bash
FPL_API_BASE=http://127.0.0.1:8700/api/fpl node scripts/record/record-picks.mjs   # against dev/mock_fpl.py
node scripts/record/grade-gw.mjs
node scripts/record/publish-record.mjs
```
