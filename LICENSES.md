# Licences

## This repository's own licence: to be confirmed by the owner

There is no `LICENSE` file at the root of this repository, and `package.json`
declares none. The repository is public, so until a licence is chosen the
default position under copyright law applies: **all rights reserved**. Nobody
may copy, modify or redistribute the code, and the "open data" and "MIT is
fine" rules in the brief apply to what comes *in*, not to what goes *out*.

The decision is the owner's and is deliberately not made here. The candidates
worth weighing:

| Option | What it means for this project |
|---|---|
| **No licence (all rights reserved)** | The current state. Protects a commercial product with a paid tier. Anyone may read the code; nobody may reuse it. Contributors have no clear terms |
| **MIT** | Anyone may reuse the app, the model and the ledgers, including competitors, provided they keep the notice. Simplest for contributors; weakest for a product with Pro billing |
| **AGPL-3.0** | Reuse is allowed but anyone running a modified copy as a service must publish their changes. Keeps a fork from quietly becoming a rival closed product; incompatible with the "no copyleft" rule this file applies to third-party code |
| **Source-available (for example PolyForm Noncommercial)** | Readable and forkable for personal use; commercial use reserved to the owner |

Whichever is chosen: add a `LICENSE` file at the root, set `"license"` in
`package.json` to the matching SPDX identifier (or `"UNLICENSED"`), and
record the choice here with the date.

## Third-party licences

Every library bundled into the shipped app, with its licence and where the
code comes from. MIT and Apache-2.0 only — nothing copyleft goes into this
repository.

The three below are bundled from `node_modules` into `www/vendor.js` by
`scripts/build-web.mjs` (entry point `src/vendor/index.js`). They are not
loaded from a CDN: the shell has to work offline, the service worker
precaches them, and the exact versions are pinned by `package-lock.json`
rather than by somebody else's edge cache.

`dev/test-core.mjs` asserts the licence and repository of all three straight
from `node_modules`, so a wrong package cannot arrive unnoticed through a
careless install.

---

## uPlot

- **Licence** MIT
- **Copyright** © Leon Sorokin
- **Source** https://github.com/leeoniya/uPlot
- **Version** see `package-lock.json` (`uplot`)
- **Used for** every chart in the app: table sparklines, the overall-rank
  trajectory, and the player-detail form and price series. Its stylesheet is
  bundled alongside as `www/vendor.css` and themed in `index.html`.

```
The MIT License (MIT)

Copyright (c) 2024 Leon Sorokin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Fuse.js

- **Licence** Apache-2.0
- **Copyright** © Kiro Risk
- **Source** https://github.com/krisk/Fuse
- **Version** see `package-lock.json` (`fuse.js`)
- **Used for** the ⌘K command palette's fuzzy, typo-tolerant search, with
  weighted keys (command name > aliases > description).

Apache-2.0 is reproduced in full at https://www.apache.org/licenses/LICENSE-2.0
and shipped in the package at `node_modules/fuse.js/LICENSE`. The notice
required by section 4:

```
Fuse.js
Copyright (c) Kiro Risk

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## tinykeys

- **Licence** MIT
- **Copyright** © Jamie Kyle
- **Source** https://github.com/jamiebuilds/tinykeys
- **Version** see `package-lock.json` (`tinykeys`)
- **Used for** all keyboard chords and shortcuts: the ⌘K palette toggle, the
  eleven `g <key>` navigation chords, `j`/`k` row-walking, `?` and Escape.

**Note on identity.** There is an unrelated **GPL-licensed** project also
called "tinykeys" (a P5.js library). This is not that project. The package
depended on here declares `"repository": "jamiebuilds/tinykeys"` and
`"license": "MIT"`, and `dev/test-core.mjs` asserts both from `node_modules`
so the distinction is enforced rather than remembered.

```
MIT License

Copyright (c) 2020 Jamie Kyle

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Rotation signal — vendored from the Bookings Desk (first-party)

Not a third-party library: the same author's other repository,
`bamfs1976-art/pl-bookings`, which fitted the model. Recorded here because
this file's promise is to account for **everything bundled into the shipped
app and where the code came from**, and three files under `vendor/` are
shipped source that `package-lock.json` knows nothing about.

- **Source** https://github.com/bamfs1976-art/pl-bookings
- **Commit** `5ab0bfcbfb437b98755f7469bd9533d59220c792`
- **Branch** `claude/la-liga-booking-research-x5h55f` — the files do not exist
  on `main` upstream; see the note in `scripts/vendor-rotation.mjs`.
- **Files**
  - `vendor/rotation.js` ← `assets/rotation.js` — the module (`PLDRotation`).
    No dependencies, no DOM, no fetch, no state.
  - `vendor/rotation_model.js` ← `data/rotation_model.js` — the coefficients,
    fitted on 740 team-fixtures of 2025-26.
  - `vendor/pl_other_fixtures.js` ← `data/pl_other_fixtures.js` — cup and
    European dates. **Live data**, pulled daily by
    `.github/workflows/rotation-refresh.yml`.
- **Used for** team-level rotation risk on the Rotation Risk page: how many
  changes a manager is likely to make to his starting eleven, from the fixture
  calendar alone. It predicts **selection only** — rest days do not move a card
  or points projection, and `scripts/check-rotation.mjs` fails the build if
  anything on the points path starts reading it.

Provenance is proved rather than asserted. Each file carries a generated header
naming the source commit and its payload SHA-256; `scripts/vendor-rotation.mjs
--check` verifies the committed bytes offline, and `--check --remote` re-fetches
from the source and fails if the pinned copies have drifted. Both run in CI.

---

## Suspension rule — vendored from the Bookings Desk (first-party)

Same source, same arrangement, second module. The card-ban ladder (five
cautions by the club's 19th match, ten by the 32nd for two matches, fifteen at
any point for three) used to be typed out inside `index.html`; it now comes
from the repository whose subject is bookings, and `scripts/check-shell.mjs`
fails the build if a threshold is typed here again.

- **Source** https://github.com/bamfs1976-art/pl-bookings
- **Commit** `34bba4cd8978e0dc9df1327baad8dccee4e71ffd` (`main`)
- **Files**
  - `vendor/suspension.js` ← `assets/suspension.js` — verbatim. `PLDSuspension`,
    the watch strip built on the rule.
  - `vendor/suspension_core.js` ← `assets/core.js` — three functions sliced
    verbatim (`pCardsAtLeast`, `suspensionCycle`, `nextSuspension`) and
    exported as `PLDCore`. The rest of `core.js` is desk logic this app does
    not use and is not shipped.
  - `vendor/suspension_scheme.js` ← `data/pl_data.js` — the Premier League
    `SUSPENSION` literal, verbatim, exported as `GE_SUSPENSION`.
- **Used for** the suspension watch: the "one yellow from a ban" chips on
  player detail, the Alerts feed and the Signals feed, through `suspRisk()`
  and `suspCutoff()` in `index.html`, which call `PLDCore.nextSuspension`.
- **Verified by** `scripts/vendor-suspension.mjs --check` (offline, in `npm
  test`: hashes match and the loaded rule still says 5/10/15 gated at 19 and
  32) and `--check --remote` (CI: re-fetches and re-slices from the pinned
  commit).

---

## Share cards — vendored from the Bookings Desk (first-party)

- **Source** https://github.com/bamfs1976-art/pl-bookings
- **Commit** `34bba4cd8978e0dc9df1327baad8dccee4e71ffd` (`main`)
- **Files**
  - `vendor/share.js` ← `assets/share.js` — verbatim. `PLDShare`: the
    1080×1350 canvas renderer, its theme registry and drawing primitives.
  - `vendor/save.js` ← `assets/save.js` — verbatim. `PLDSave.file`: the native
    share sheet where a phone has one, the anchor fallback elsewhere.
- **Not vendored** `lib/gwe-share.js` is this repository's own: the Gameweek
  Edge theme (registered as `PLDShare.THEMES.GWE`) and the three adapters
  (Team of the Week, captain pick, squad rating). It composes cards from the
  renderer's exported primitives rather than its desk cards, because the desk
  cards' shared footer draws an age-and-gambling line a Gameweek Edge card
  must never carry.
- **Used for** every image and CSV that leaves the app: the Share buttons on
  the Model XI, Captaincy Lab and the first-run squad rating, the My Squad
  and Team Reveal cards, Social Studio and the CSV exports.
- **Verified by** `scripts/vendor-share.mjs --check` and `--check --remote`,
  and `scripts/check-share.mjs`, all in CI.
