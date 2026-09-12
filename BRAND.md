# Gameweek Edge — Brand Guidelines

The reference for keeping Gameweek Edge looking and sounding consistent everywhere — the app, the landing page, social and store listings.

## 1. Brand in one line
**Gameweek Edge** — the calm, clear edge for Fantasy Premier League managers.
**Tagline:** *FPL, with an edge.*

## 2. Positioning
The clarity of the official FPL site, with the depth serious managers rely on — plus an AI scout that ties it together. Not a tipster. Not loud. Confident, expert, calm.

## 3. Voice & tone
- **Calm and confident.** We give an edge, we don't hype.
- **Plain English.** Short sentences. No filler, no jargon walls.
- **Expert, not arrogant.** Explain the "why", respect the manager's call.
- **British English** throughout (favour, colour, defence).
- Do say: "predicted points", "your edge", "the smart companion".
- Don't say: "guaranteed", "nailed on", "tipster", anything gambling-adjacent.

## 4. Name & trademark rule (non-negotiable)
- The brand is **Gameweek Edge**. Never use "FPL" or "Premier League" *as part of the product name*.
- "Fantasy Premier League" / "FPL" may only appear **descriptively** in body copy (e.g. "the smart companion for Fantasy Premier League managers").
- Every public surface carries the disclaimer: *not affiliated with, endorsed by, or associated with the Premier League or the official Fantasy Premier League game.*
- **The same rule applies to every sibling app**, against that competition's rights holder. It governs the visual identity too, not just the name: no competition marks, no borrowed palettes, no starball.

## 4a. Euro Matchday Edge — retired

**Euro Matchday Edge** was the sibling app for UEFA Champions League Fantasy, at `/euro/`, in floodlit navy. It has been removed: UEFA's Fantasy feeds refuse server-side clients (403 from every network tested, under every ordinary header), so the app could not be given the player data it existed to project without inventing it.

The brand rules it demonstrated still stand, because they are the rules for **any** sibling app:

- **Name rule.** A competition's name — "Champions League", "UCL", "UEFA", "Premier League" — never appears in a product name, only descriptively in body copy. Pick a word the competition uses but does not own ("Matchday", "Gameweek").
- **Sibling, not sub-brand.** Its own name and its own colour, the same voice and the same mark shape. That shared shape is what makes two apps read as a family.
- **Relationship line:** *one account, one subscription, both apps.*
- **Disclaimer on every public surface:** not affiliated with, endorsed by, or associated with the rights holder or its official game.
- **No competition imagery.** A sibling ships none at all and has no third-party `img-src` in its CSP, so there is no switch to get wrong.

## 5. Logo
- The mark is a rounded square in pitch green with a white upward "form" line and a node — momentum and an edge.
- Clear space: keep at least half the mark's height clear on all sides.
- Minimum size: 24px (app), 32px (print/web header).
- **Don't:** recolour the mark, stretch it, add effects, or place it on a busy background without the green tile.
- Source artwork: `assets/icon-only.png` (icon — the mark above bold **GWE** lettering), `assets/icon-mark.png` (chart-only variant for tiny sizes like the favicon), `icons/` (web/PWA), `icons/og.png` (social). Regenerate with `node scripts/gen-art.mjs && node scripts/gen-pwa-icons.mjs`.

## 6. Colour
The app is a dark terminal by default; light is a variant. Every value is a
token in `index.html` and `DESIGN.md` carries the full table; the ones the
brand rests on:

| Token | Terminal | Light | Use |
|---|---|---|---|
| Green (`--green`) | `#00d26a` | `#147e48` | The single accent: logo tile, active states, the key figure. Ink on it is `--on-brand` (`#0a0c0f` / white) |
| Hot (`--hot`) | `#b6ff3c` | `#0f6d3d` | THE key number on a screen |
| Ink (`--text`) | `#e8ecf1` | `#10171e` | Primary text |
| Ink-2 (`--text-2`) | `#aab3be` | `#586673` | Secondary text |
| Background (`--bg`) | `#0a0c0f` | `#f4f6f8` | The canvas (`theme-color`, manifest, native status bar) |
| Surface (`--surface`) | `#111418` | `#ffffff` | Cards |
| Amber (`--amber`) | `#f5a524` | `#8f5a12` | Caution, price fall, the Pro affordance |
| Red (`--red`) | `#ff4d4f` | `#c93834` | Risk, injury, over budget |
| Blue (`--blue`) · Purple (`--purple`) | `#4f92ff` · `#a78bfa` | `#2e6ac2` · `#795ac6` | Data accents |

Fixture-difficulty scale: 1 `#2ecf73` → 3 `#d9dee3` → 5 `#e05a55`, always with the figure printed in the cell.
Contrast: body text ≥ 4.5:1, large text/UI ≥ 3:1 (WCAG 2.2 AA), measured by `dev/test-tokens.mjs` and `scripts/check-a11y.mjs` on every run.

## 7. Typography
- **Everything a person reads:** Inter (400–800).
- **Every number:** IBM Plex Mono with tabular figures.
- Share cards use the same two faces (`lib/gwe-share.js`).

## 8. Layout
- 8pt spacing grid. 4px radii; pills stay round. Depth from a 1px border, not a shadow.
- Lead with the decision — the captain call, the transfer, the key number — then the tables one level deeper.
- The terminal (dark) is the default; the light theme is fully supported.

## 9. Naming of features (canonical)
The `NAV` registry in `index.html` is the source of truth; `docs/NAMING.md` carries the full table and the retired variants. Panels: My Week · Overview · Gameweek recap · Gameweek Debrief · The Wire · Scout AI (with Ask the Scout) · The Model · My Squad · Transfer Planner · Captaincy Lab · Chip Strategy · Squad Planner · Manager Report · Live · Players · Scout Board · Player Compare · Price Predictor · Set Piece Register · Rotation Risk · Latest News · Fixtures · Simulators · Watchlist · Alerts · Mini-Leagues · Rival Scout · Ownership · Match Centre · Title Race · Clubs · Ten Seasons · Glossary · New to FPL.

Retired and never to be reintroduced as names: Live Rank, Live Percentile (as a panel name), DefCon Threats, Auto-Sub Tracker, What-If Simulator, EO Tracker, Template Meter, Fixture Planner, Points Planner, Clean Sheet Matrix, Injury Monitor, Differentials (as a panel), Pre-season Draft, Dashboard, This Gameweek (as a panel), AI Scout, Model Accountability, Match Centre (as a panel; it remains the area name).

## 10. Assets
- App icon & splash: generated by `scripts/gen-art.mjs` and `scripts/gen-pwa-icons.mjs`.
- Social share image: `scripts/gen-og.mjs` → `icons/og.png` (1200×630).
- Marketing page: `landing.html` (served at `/welcome`).
