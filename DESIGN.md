# Gameweek Edge — design system

One product, one voice. The app carries the marketing site's calm, editorial
language (`landing.html` is the source of truth), then adds analytics density.
Reference feel: The Athletic's match pages crossed with Linear's information
hierarchy. Not a terminal, not a trading dashboard, no neon.

Everything below ships as CSS custom properties in `index.html`'s token block.
Components never hardcode colour — if a hue isn't a token, it doesn't exist.
`dev/test-tokens.mjs` recomputes every contrast claim on every run and fails
the build when a token drops below its bar.

## Themes

Light is the default (it is the brand; the marketing site is light). Dark is a
first-class variant driven entirely by the same token names — deep ink
surfaces, the forest green lifted just far enough for AA, never lime-on-black.
The choice persists in `localStorage.ge-theme` and is applied before first
paint by a head script, so neither theme ever flashes.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#f4f6f8` | `#10161c` | canvas |
| `--surface` | `#ffffff` | `#171e26` | cards |
| `--surface-3` | `#eef1f4` | `#232b34` | the strictest surface — contrast is measured here |
| `--text` … `--text-4` | 4-step ink ramp | 4-step ink ramp | `--text-4` marks absence only (3:1 UI bar) |
| `--green` | `#147e48` | `#45c483` | the single brand accent |
| `--amber` / `--lock` | `#b9741a` / `#8a5410` | `#f0a63a` | "watch this / partial" + the Pro affordance |
| `--red` | `#c93834` | `#ff6b6b` | genuine negatives only: injury out, price fall confirmed, over budget |
| `--accent-cta` | amber fill, white ink | amber fill, ink `#10161c` | actions read as actions; green stays reserved for positive data |
| `--hot` | `#0f6d3d` | `#52cd8f` | THE key number on a screen |

2–3 surface elevation steps only; depth comes from `--shadow`/`--shadow-lg`
(soft editorial shadows in light, deeper ones in dark — never borders alone,
never glow).

## Position colours

One hue per position, used identically in pills (`.pos-pill.p1–.p4`), pitch
slots and tables. All ≥4.5:1 on `--surface-3` in both themes.

| Position | Light | Dark |
| --- | --- | --- |
| GK  `--pos-gk`  | `#8a690e` | `#e0b53f` |
| DEF `--pos-def` | `#2e6ac2` | `#6aa4f8` |
| MID `--pos-mid` | `#147e48` | `#45c483` |
| FWD `--pos-fwd` | `#c93834` | `#ff8a85` |

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

- **Display** `--font-display`: Bricolage Grotesque — headings, the wordmark,
  hero player names, modal titles.
- **UI & prose** `--font-body`: Public Sans — everything else. Labels,
  eyebrows, captions, sentences. *No mono prose, ever.*
- **Numerals** `--font-mono`: IBM Plex Mono, **only** for numbers, and always
  with `font-variant-numeric: tabular-nums` (the `.num`/`.mono` utilities and
  the numeric-cell rules apply both together).

Type scale is `--fs-min` (10px floor, build-enforced) → `--fs-2xl` (32px),
major-second ratio. Eyebrow labels are Public Sans 800, 10–11px, uppercase,
`.09–.1em` tracking.

## Geometry & motion

- Radii: `--r-sm` 6 / `--r-md` 8 / `--r-lg` 12 (cards) / `--r-xl` 16 /
  `--r-pill` 999 (chips, pills, toggles). The marketing site's soft geometry.
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
