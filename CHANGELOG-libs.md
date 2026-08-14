# Three libraries in, three hand-rolled implementations out

What moved, why, and what changed in behaviour. All three are bundled from
`node_modules` into `www/vendor.js` by `scripts/build-web.mjs` — no CDN tags,
so the shell still works offline and the versions are pinned by
`package-lock.json`. Licences and provenance: `LICENSES.md`.

`index.html` is copied verbatim by the build rather than bundled, so the
inline script cannot `import`. `src/vendor/index.js` is the seam: esbuild
bundles the three packages and publishes them on `window`, exactly as
`native.js` and `auth.js` already do.

---

## 1. uPlot (MIT) — charts and sparklines

**Out:** a hand-written `spark()` that returned an SVG string, plus separate
bespoke SVG builders for the overall-rank trajectory and the player-detail
form bars.

**In:** one charting library for the whole app.

- `spark()` now returns a **placeholder** carrying its own data; a
  `MutationObserver` on `<body>` hydrates it into a uPlot canvas. The
  observer replaced per-render hydrate calls because there are five call
  sites across four panels and several render paths — a call per path is a
  regression waiting for the sixth.
- `chartHost()` / `chartHydrate()` do the same for full charts, so the
  string-building call sites keep their one-line return.
- `uchart()` is the shared builder: crosshair, live legend, touch, and a
  `ResizeObserver` per chart. It returns the instance, so a live panel can
  call `setData()` on the next tick instead of re-serialising SVG on every
  poll — the point of the "no visible jank in the live match centre" target.
- Themed entirely from the existing CSS custom properties (`chartVar()`
  reads them at runtime), so a theme switch moves the charts with the app.

**Converted:** table sparklines · overall-rank trajectory (log rank, inverted
so up is better) · player-detail form (points, with minutes as a second
series) · **player-detail price over the season** — new.

**One judgement call, stated plainly.** The brief asked for a full chart in
the *price predictor* panel. That panel is a nightly cross-section — tonight's
probability for every player — and has no time axis to plot. Rather than
invent one, the price time-series went where the API actually carries one:
`history[].value` per gameweek in player detail. The panel is unchanged.

**A second, smaller one.** For a 56×14 trend in a table row, three lines of
SVG were genuinely cheaper than a canvas plus a chart object. uPlot earns its
place on the full charts; the sparklines followed it so the app has one
charting library rather than two. The SVG path is kept as the fallback when
the vendor bundle has not loaded, which is also what a scraper or a print
gets.

## 2. Fuse.js (Apache-2.0) — palette search

**Out:** `cmdkScore()`, a three-tier scorer (prefix 3, substring 2,
subsequence 1).

**In:** weighted fuzzy search, ordered as asked — **name 0.6, aliases 0.3,
description 0.1**.

- The old scorer could not handle a typo. `captian` scored zero against
  `Captain`, and so did every misspelt surname — which is the search people
  actually run. It now returns Captaincy Lab, verified in a browser.
- The weights are the substantive part. Without them a description match
  ranks level with a name match, and typing "captain" surfaces every panel
  whose blurb mentions captaincy above the Captain panel itself.
- Entries gained `aliases` (panel ids, verb synonyms like "dark mode", a
  player's full name) so `sonny` finds Son and `csv` finds Export.
- Fuse scores 0 = perfect; that is inverted into the existing
  higher-is-better sort, so **the palette UI, keyboard behaviour, tie-breaks
  and 12-item cap are untouched**.
- `cmdkSearch(entries, q, FuseCtor)` takes the constructor as an argument, so
  `dev/test-core.mjs` exercises the real matcher with no DOM.
- `cmdkSearchFallback()` covers a missing bundle with substring matching —
  worse than Fuse, better than a palette that returns nothing.

## 3. tinykeys (MIT, **jamiebuilds/tinykeys**) — chords and shortcuts

**Out:** one keydown listener with nine ordered `if`s and a hand-rolled
`_pendingG` timestamp.

**In:** declarative bindings; the library owns parsing, modifier rules and
the sequence timer. What stays is the part that is ours — which app state
suppresses which key.

The repository is asserted, not assumed: there is an unrelated **GPL** P5.js
project also called "tinykeys", and `dev/test-core.mjs` checks the licence
and repo of all three packages straight out of `node_modules` so a careless
install cannot slip copyleft into a closed shell.

Preserved deliberately:

- **⌘K works inside text fields** — its own handler with `ignore:()=>false`,
  because closing the palette from its own input needs the keys that opened
  it. Both Ctrl and Meta on every platform, matching the old `metaKey||ctrlKey`.
- **A modifier press does not break an armed chord.** The old handler
  returned on meta/ctrl/alt without clearing `_pendingG`, so `g` → ⌘A → `f`
  still worked. Returning `true` from `ignore` reproduces that exactly,
  because tinykeys skips the event before touching its pending map.
- **`g` swallows an unrecognised character**, as the old chord branch did.
- All eleven chords, the 900 ms timeout, `j`/`k`/`Enter`, `?`, and Escape
  closing both the cheatsheet and every modal.

### The bug worth reading about

The chords were first registered as eleven separate sequences plus a regex
catch-all, so `g` would swallow a key it did not recognise. Registration
order was correct, a unit test asserted it, and the whole suite was green.

In a browser, `g` `f` opened Fixtures and then the very next `j` did nothing.
tinykeys stops at the first complete match, so when the chord fired it never
finished evaluating the catch-all — whose pending state was left
mid-sequence and ate the next keystroke inside the timeout.

Fixed by collapsing all eleven into **one** binding whose second press is a
regex, with the `G_CHORDS` lookup inside the handler exactly as the old
branch did it. A binding that always completes cannot strand a sibling.

That is also why `dev/test-ui.mjs` now exists: a binding map cannot show this
and a key press can. It drives real Chromium against the built `www/`,
checking chord state, the suppression rules, palette typo-matching and that
uPlot draws a canvas and the crosshair reads a value. It sits outside
`npm test` — CI has no display — following `dev/smoke.mjs`.

---

## Four defects the screenshots caught

Worth recording, because all four passed every unit test and the browser
test suite, and only became visible in a rendered image.

1. **The rank axis read `-6, -5.5`.** The series is the negated log of
   overall rank (uPlot has no reverse-axis flag), and a comment in the code
   claimed a tick formatter undid it. There was no formatter. Added
   `CHART_FMT`, a registry looked up **by name** — `chartHost` serialises its
   spec into a data attribute and a function cannot survive JSON, so a chart
   that needs a custom axis names one instead of passing a closure.
2. **`1,000,000` was clipped to `00,000`.** uPlot sizes the y-axis gutter for
   plain numbers. Each formatter now declares the width it needs.
3. **Sparklines rendered as filled blobs.** `fill` on a uPlot series is an
   area fill; it belonged on the point, not the series.
4. **A dot on every point instead of just the last.** `points.show` is a
   boolean — choosing *which* points is `points.filter`. The end dot marks
   where the series is now, which is the whole reading of a sparkline in a
   table row.

The first two were shipping wrong. The lesson is the same one
`dev/test-ui.mjs` was written for, one level further out: a browser test can
assert that a canvas exists and that a crosshair returns a value — it cannot
see that the number on the axis is nonsense.

---

## Guard suite

| check | result |
|---|---|
| inline-script parse | OK |
| `node dev/test-core.mjs` | **681 passed** (was 637; +44) |
| `node scripts/check-shell.mjs` | OK — 26 precache entries, PWA intact |
| `node --check` each Netlify function | 23/23 |
| `node dev/test-tdz.mjs` | OK — 209 top-level bindings |
| `npm test` (28 suites) | all green |
| `node dev/test-ui.mjs` (browser) | **23 passed** |

PWA unaffected: `/vendor.js` and `/vendor.css` were added to the service
worker precache and to the `BUILT` set in `check-shell.mjs`, so the shell
still installs and runs offline.

Untouched, as required: env vars, `auth.js` Supabase wiring, Netlify
functions, Stripe webhook code. No secrets added.
