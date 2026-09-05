# Accessibility audit — 5 September 2026

`scripts/check-a11y.mjs` holds WCAG 2.2 AA as assertions over `index.html`
(and `record/index.html`) and runs in CI on every push. It was written, run
once in report mode to count what the app shipped with, and then every
finding was fixed. The counts below are that first run and the run after.

| Check | What it asserts | Before | After |
|---|---|---|---|
| Focus | A global `:focus-visible` ring of at least 2px in a token colour, and no rule removing the outline from a control without drawing a replacement | 2 | 0 |
| Sparklines and inline SVGs | Every sparkline (the SVG fallback and the uPlot host) carries `role="img"` and an `aria-label` describing the trend; every other inline SVG is either decorative (`aria-hidden`) or labelled | 14 | 0 |
| Contrast | Every ink token at 4.5:1 against every surface it can sit on, in both themes; UI-only tokens at 3:1; filled buttons judged by the ink on them | 8 | 0 |
| Motion | The global `prefers-reduced-motion: reduce` collapse covers duration, iteration count and smooth scrolling; script-driven smooth scrolling checks the preference | 6 | 0 |
| Form labels | Every `<input>`, `<select>` and `<textarea>` has an accessible name: `aria-label`, a `<label for>`, a wrapping `<label>`, or is hidden | 21 | 0 |
| **Total** | | **51** | **0** |

## What was fixed

**Focus.** `.jargon:focus` removed the outline and replaced it only with a
colour change; the outline is back. The command-palette input set
`outline:none`; it now keeps the ring, drawn inside the panel so it is not
clipped.

**Sparklines.** Every sparkline was `aria-hidden`, which hid the one thing
it conveys. `sparkLabel()` now describes the shape in words ("Trend over 8
points, rising: from 3 to 9, low 2, high 11") on both the SVG and the uPlot
host. Eleven icon SVGs in the top bar, menu and Manager ID modal sat inside
labelled controls with no `aria-hidden`, so a reader met an unnamed image
before the label; they are decorative now. The Simulators finish-position
heatmap is labelled and points to the table above it that carries the same
figures.

**Contrast.** Light `--amber` (`#b9741a`) is body-size text in 45 places and
measured 3.3:1 on the darkest light surface; it is `#8f5a12` (5.1:1). Light
`--accent-alert` (`#cc3d39`, 4.3:1) is `#c23632` (4.8:1). The dark theme
already cleared every pair. `BRAND.md` and `DESIGN.md` record the new
values.

**Motion.** The global reduce rule collapsed durations but not iteration
counts, so five infinite pulses (the live dot, the ticker dot, the pull-to-
refresh spinner, the Live tab ping, the Home hero dot) kept repainting; it
now sets `animation-iteration-count: 1` and `scroll-behavior: auto` as well.
One `scrollIntoView({behavior:'smooth'})` in the Squad Planner now checks the
preference first.

**Labels.** Twenty controls carried only a placeholder or a nearby heading:
the account email and password, the replacement finder, the watchlist and
compare searches, the rival ID, the Ten Seasons record, position and player
fields, the simulator count, the What-if match, fixture, result and goal
fields, the line-up team, and the Squad Planner search and position filter.
Each now has an `aria-label` matching its visible purpose.

## Deliberate exemptions

None. Every finding was fixed rather than exempted. If a future change
needs one, record it here and in the rule in `scripts/check-a11y.mjs`, so
the exemption is a decision somebody can argue with.

## What the guard cannot see

It is static. It cannot measure rendered contrast of translucent fills
(`--amber-soft` over a surface), keyboard order, or live-region timing.
`dev/test-ui.mjs`, `dev/test-simplenav.mjs` and the QA checklist cover those
in a real browser.
