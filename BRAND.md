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
| Token | Hex | Use |
|---|---|---|
| Green (primary, fill) | `#15824a` | Logo tile, icons, theme-color, filled buttons |
| Green (primary, ink) | `#147e48` | Green text and links in the app: `#15824a` measures 4.28:1 on the darkest light surface, so the ink is deepened to clear 4.5:1 |
| Green bright | `#1f9d5c` | Accents, highlights, links |
| Ink | `#10171e` | Primary text (light theme) |
| Ink-2 | `#586673` | Secondary text |
| Background | `#f4f6f8` | App/page background (light) |
| Surface | `#ffffff` | Cards |
| Dark background | `#10161c` | Dark theme base (`--bg` in `index.html`; `dev/test-tokens.mjs` measures against it) |
| Amber | `#8f5a12` | Caution / price-fall. Deepened from `#b9741a` (3.3:1) so it clears 4.5:1 as text on every light surface; the dark theme keeps `#f0a63a` |
| Red | `#cc3d39` | Risk / injury |
| Blue | `#2f6dc7` · Purple `#7a5cc7` | Data accents |

Fixture-difficulty scale: 1 `#2ecf73` → 3 `#d9dee3` → 5 `#e05a55`.
Contrast: body text ≥ 4.5:1, large text/UI ≥ 3:1 (WCAG 2.2 AA).

## 7. Typography
- **Display / headings:** Bricolage Grotesque (600–800), tight tracking (`-0.02em`).
- **Body / data:** Public Sans (400–800).
- **Mono (figures):** IBM Plex Mono.
- Numbers that change (points, rank) use the display or mono face with tabular figures.

## 8. Layout
- 8pt spacing grid. Generous radii (12–22px). Soft shadows, never heavy.
- Lead with graphics — the pitch, big numbers, colour-coded badges. Dense tables sit one level deeper.
- Light theme is default; dark theme fully supported.

## 9. Naming of features (canonical)
The `NAV` registry in `index.html` is the source of truth; `docs/NAMING.md` carries the full table and the retired variants. Panels: My Week · Overview · Gameweek recap · GW Debrief · The Wire · Scout AI (with Ask the Scout) · The Model · My Squad · Transfer Planner · Captaincy Lab · Chip Strategy · Squad Planner · Manager Report · Live · Players · Scout Board · Player Compare · Price Predictor · Set Piece Register · Rotation Risk · Latest News · Fixtures · Simulators · Watchlist · Alerts · Mini-Leagues · Rival Scout · Ownership · Matchday · Title Race · Clubs · Ten Seasons · Glossary · New to FPL.

Retired and never to be reintroduced as names: Live Rank, Live Percentile (as a panel name), DefCon Threats, Auto-Sub Tracker, What-If Simulator, EO Tracker, Template Meter, Fixture Planner, Points Planner, Clean Sheet Matrix, Injury Monitor, Differentials (as a panel), Pre-season Draft, Dashboard, This Gameweek (as a panel), AI Scout, Model Accountability, Match Centre (as a panel; it remains the area name).

## 10. Assets
- App icon & splash: generated by `scripts/gen-art.mjs` and `scripts/gen-pwa-icons.mjs`.
- Social share image: `scripts/gen-og.mjs` → `icons/og.png` (1200×630).
- Marketing page: `landing.html` (served at `/welcome`).
