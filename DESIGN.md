# Gameweek Edge — design system

One product, one voice: a terminal. Dense, calm, exact. A near-black canvas,
one green, numbers in a monospace face with tabular figures, 4px geometry,
depth from a 1px line rather than a shadow. Reference feel: a trading
terminal's discipline with the plain-English copy of a good match report.
The marketing site (`landing.html`) keeps its own light, editorial look.

Everything below ships as CSS custom properties in `index.html`'s token block.
Components never hardcode colour — if a hue isn't a token, it doesn't exist.
`dev/test-tokens.mjs` and `scripts/check-a11y.mjs` recompute every contrast
claim on every run and fail the build when a token drops below its bar.

## Themes

The terminal (dark) is the default and lives on `:root`. Light is a variant,
kept for readers who want it, driven entirely by the same token names under
`[data-theme="light"]`. The choice persists in `localStorage.ge-theme` and is
applied before first paint by a head script, so neither theme ever flashes.

| Token | Terminal | Light | Role |
| --- | --- | --- | --- |
| `--bg` | `#0a0c0f` | `#f4f6f8` | canvas |
| `--surface` | `#111418` | `#ffffff` | cards |
| `--surface-3` | `#1a2026` | `#eef1f4` | the lightest terminal surface — contrast is measured here |
| `--border` | `#20262d` | `rgba(12,16,20,.08)` | the 1px line that does the work of a shadow |
| `--text` … `--text-4` | 4-step ink ramp | 4-step ink ramp | `--text-4` marks absence only (3:1 UI bar) |
| `--green` | `#00d26a` | `#147e48` | the single brand accent; `--on-brand` is the ink that sits on it |
| `--hot` | `#b6ff3c` | `#0f6d3d` | THE key number on a screen |
| `--red` | `#ff4d4f` | `#c93834` | genuine negatives only: injury out, price fall, over budget |
| `--amber` / `--lock` | `#f5a524` | `#8f5a12` / `#8a5410` | "watch this" and the Pro affordance |
| `--blue` | `#4f92ff` | `#2e6ac2` | info. The brief's `#3b82f6` measures 4.45:1 on `--surface-3`, so it is lifted |
| `--accent-cta` | green fill, canvas ink | amber fill, white ink | actions read as actions |

Shadows are off in the terminal (`--shadow` is transparent); only floating
layers cast (`--shadow-lg`). The brand gradient pair (`--grad-brand`,
`--grad-glow`) is a flat green in the terminal and the old blue-green sweep
in light.

## Position colours

One hue per position, used identically in pills (`.pos-pill.p1–.p4`), pitch
slots and tables. All ≥4.5:1 on `--surface-3` in both themes.

| Position | Terminal | Light |
| --- | --- | --- |
| GK  `--pos-gk`  | `#f5a524` | `#8a690e` |
| DEF `--pos-def` | `#4f92ff` | `#2e6ac2` |
| MID `--pos-mid` | `#00d26a` | `#147e48` |
| FWD `--pos-fwd` | `#ff4d4f` | `#c93834` |

Each has a `-soft` translucent fill for pill backgrounds.

## Confidence scale

Low / Medium / High renders as **one component everywhere** — `confChip(v)`,
the ConfidenceMeter: a 3-dot scale plus the word, on a tinted pill. Never a
bare word, never a bare number, never colour alone.

- High (≥70): `--conf-high` (brand green), 3 dots lit
- Medium (50–69): `--conf-med` (amber), 2 dots lit
- Low (<50): `--conf-low` (neutral), 1 dot lit

`confTier(v)` returns `'high' | 'med' | 'low'` and is the only mapping.

## Typography

- **Everything a person reads** `--font-display` and `--font-body`: Inter.
  Headings, labels, sentences, buttons.
- **Every number** `--font-mono`: IBM Plex Mono, always with
  `font-variant-numeric: tabular-nums` (the `.num`/`.mono` utilities and the
  table's numeric cells apply both together). Never mono prose.

Type scale is `--fs-min` (10px floor, build-enforced) → `--fs-2xl` (32px),
major-second ratio. Eyebrow labels are 10–11px, uppercase, `.09–.1em`
tracking; card titles the same, as `h2`.

## Geometry & motion

- Radii: 4px. `--r-sm` 3 / `--r-md` 4 / `--r-lg` 4 / `--r-xl` 6 /
  `--r-pill` 999 (chips, pills, toggles stay round).
- Motion: one scale — `--t-state` 150ms for state changes, `--t-layout` 250ms
  for layout moves, `--ease` shared. `prefers-reduced-motion` collapses all
  animation globally.

## Shell

- **GameweekBar** — the one sticky bar: brand mark, the gameweek chip
  (`#gwchip`: `GW2 · deadline in 5h 12m`, ticking every second, amber inside
  6h, red inside the last hour, `● live` during matches), the Link-team CTA,
  and a single overflow menu (search ⌘K, Depth, refresh, export, help,
  feedback).
- **One nav map, five destinations** — sidebar (desktop) and bottom tabs
  (mobile) render the same list, identical labels and order:
  Home · Squad · Players · Live · More. The Live item carries a pulsing dot
  (`body.gw-live .live-ping`) only while matches are in play.
- **More** is a real grouped index screen (Plan · Research · Account & help),
  not a drawer with a different vocabulary.

## Routing

Real paths, one per screen: `/squad`, `/players`, `/planner`, `/captaincy`,
`/fixtures`, `/live`, `/leagues`, `/prices`, `/chips`, `/scout`, `/debrief`,
`/glossary`, … (`PANEL_PATH` in `index.html` names the exceptions; every other
panel uses its id). Netlify serves the SPA fallback (`/* → /index.html`, last
rule, not forced). Legacy `#hash` and `?panel=` deep links still resolve, then
normalise to the path. Every screen sets its own `<title>` and meta
description and renders exactly one `h1`.

The **query string is the panel's state**. The path names the panel; `?view=`
names the tab inside a hub (`/players?view=diffs`, `/fixtures?view=cs`), and
each view writes its own keys as the reader changes things: the players
table's `sort`, `dir`, `pos`, `team`, `q` and `layout`; the fixture grid's
`win`, `from`, `lens` and `rows`; Match Centre's `gw` and the line-ups `team`; the
Manager Report's `gw`; a club dossier's `team`, form's `venue` and `win`;
Player Compare's `players`; a mini-league's `league`, `type`, `page`, `sort`,
`dir` and `layout`; the Scout Board's `pos`, `max`, `sort`, `dir`; the Points
Planner's `pos` and `n`; the clean-sheet matrix's `n`; the Squad Planner's
`ids`. Defaults are left out, so the bare path is always the default view.

`urlPick(key, memory, default, parse)` decides whose value wins on entry: the
link's when it names one, the default after a link or a traversal (back from
`?gw=3` must show the current gameweek again), memory otherwise. A tab change
is a history entry (`historyPoint()`), a filter change is not; scroll is saved
on the entry being left and restored after the hydrator resolves. The
**Copy link** control in the page header (`pageToolsHtml`) copies the address
on every view worth sending on; personal panels are left out.

## Key components

- **DecisionCard** (`.dc`, `.dc-hero`) — the three calls are the product.
  Captain: name at display size, xP as the dominant numeral (`--hot`),
  fixture + start probability as a supporting line, ConfidenceMeter in the
  header, the margin line (`captain margin +0.6 xP`) with inline glossary
  popovers. When no team is linked the card carries the
  `Model squad · not your team` tag inline — never a separate banner.
- **AlternativesRow** (`.dc-alts`) — vice + two alternatives, always visible:
  name, xP, delta vs captain. No disclosure triangles anywhere on the card.
- **Depth** — `Essentials` (default) / `Everything`, persisted
  (`ge-density`). Essentials is the decision cards; Everything adds named
  sections (Model XI, Differentials, Live state, Signals) with a jump nav
  (`.dash-jump`). This replaced the `+ MODEL XI …` chip rows and the separate
  Simple/Everything toggle.
- **LinkTeamFlow** (`linkTeamFlowHtml`) — Manager ID input with inline
  validation, the manager's name echoed back on success, a "where do I find
  this?" hint, and a "just browse the model squad" secondary path. The
  first-run screen for unlinked personalised panels.
- **PreviewEmptyState** (`previewEmptyState`) — every "link your team to see
  this" panel: a blurred preview of the real component behind one sentence of
  value and one primary input.
- **ProGate** (`proLockWrap`) — preview, not paywall: the real tool renders
  blurred and inert behind a single quiet strip (`PRO` pill + one line + one
  CTA). Locked lenses/columns/tabs show a small lock and open the upsell —
  a Pro control never silently does nothing.
- **SectionCard** (`sectionCard`, `cardHead`) — every named section: an
  `h2.card-title` on the left, a `.card-tools` slot on the right (a Share or
  Export button, a pager, a confidence chip), one 1px border, 16px padding.
  The dashboard's DecisionCards and quadrants, and every card that carries a
  control, are built through it.
- **DataTable** (`enhanceTable`) — one behaviour for every `.ptable`: a real
  thead, sortable headings with `aria-sort` and a focus ring, a per-column
  filter where a text column has fewer than 25 distinct values, a roving tab
  stop on the rows (arrows move, Enter opens), the panel's first table's sort
  in the URL as `tsort=`, and the edge-fade scroll affordance. Tables that
  sort their own model (players, scout board) carry `data-tbl="model"`.
  Numerics are right-aligned mono with tabular figures; text is Inter.
- **Players table** — sticky sortable header with glossary tooltips on
  column headings, sticky search, position chips with live counts +
  clear-all, capped rows with an explicit "filter to narrow" note. All
  horizontal overflow scrolls inside its own edge-faded container
  (`.pl-scroll`, `.fdr`, `.scroll`) — never the page.
- **GlossaryPopover** (`jt(term)`) — inline dotted-underline terms with a
  hover/focus definition from the single `GLOSSARY` map; the same
  definitions feed the table headers and the `/glossary` route.

## Accessibility

AA contrast on every text/background pair (build-enforced), 44px touch
targets on nav/tabs/chips, visible token-driven focus rings
(`:focus-visible`), labels on every icon-only control, a polite ARIA live
region (`announceLive`) narrating live value changes alongside the colour
flash, skeletons that match the final layout, and safe-area padding on the
bottom tab bar.
