# RaceWeek Edge

The calm, clear companion that gives **F1 Fantasy** managers a measurable edge — the sibling of [Gameweek Edge](https://gameweekedge.netlify.app) (FPL), built from the same shell, design system and philosophy: model-first, honest about estimates, useful before you pay for anything.

- **Single-file web app** (`index.html`, vanilla JS, no framework) — same architecture as Gameweek Edge: a `NAV` model of areas/panels, a `WIRED` registry of `hydrate*` renderers, light/dark themes, PWA-ready.
- **Works entirely offline / undeployed** — the 2026 grid, calendar, launch prices and the projection model are built in. Every panel renders and stays useful with no backend at all.
- **Live results feed (optional)** — deployed on Netlify, `/api/f1/*` proxies the community [Jolpica-F1](https://api.jolpi.ca) API (the Ergast successor) for real standings and results. Panels that use it degrade gracefully without it.

## Run

```bash
# any static server works
cd raceweekedge
python3 -m http.server 8080     # open http://localhost:8080
```

Deploy: point a Netlify site at this folder (base directory `raceweekedge`) — `netlify.toml` wires the results proxy at `/api/f1/*` and the app is an installable PWA out of the box (Add to Home Screen on iPhone, install prompt on Android).

## Smoke test

```bash
npm i --no-save playwright   # once
node dev/smoke.mjs           # walks all 29 panels + the builder flow headlessly
```

## What's inside — 7 areas, 29 panels

| Area | Panels |
|---|---|
| **Home** | Dashboard · This Race Week · The Pit Wall (auto-written briefings) |
| **My Team** | Team Builder · My Garage · Transfer Planner · DRS Boost Lab |
| **Race Day** | Race Centre · Points Simulator* · Sprint Strategy* · Hindsight Optimal* |
| **Intelligence** | Template Meter* · Rival Scout* · Race Engineer* · Model Accuracy |
| **The Grid** | Driver List · Constructors · Driver Compare · Price Predictor · Value Finder |
| **Planner** | Race Calendar · Track Insights · Chip Strategy · Watchlist · Alerts |
| **Season** | Standings · Teammate H2H · Title Race* · Season Review* |

\* Pro panels — free users see a value preview; an honest on-device "Preview Pro" unlock stands in until billing is wired (same pattern as Gameweek Edge).

The headline features — and why they were chosen — are documented with the full competitor analysis in [`docs/FEATURES.md`](docs/FEATURES.md).

## The 2026 game, encoded

Official rules are constants in `SCORING`: $100M cap, 5 drivers + 2 constructors, 2 free transfers (bank to 3, −10 each extra), 2026 scoring tables (quali 10→1, race 25…1, sprint 8→1, +1/position gained and overtake, +10 fastest lap & DotD, −20 race DNF / −10 sprint DNF), constructor Q3 and pit-stop bonuses, and the six chips. The 22-round calendar (post Bahrain/Saudi cancellations) with the six sprint weekends and lock-in times lives in `F1_CALENDAR`; the 11-team / 22-driver grid with official launch prices in `F1_TEAMS` / `F1_DRIVERS`.

**Honesty rule:** everything derived from the model (ratings, track traits, PPM estimates) is labelled as an estimate in the UI, and the Model Accuracy panel commits to a public round-by-round record — including the misses.

## Layout

```
index.html               the entire app (UI, data, model, panels)
manifest.webmanifest     PWA manifest        sw.js  service worker
icons/icon.svg           app icon
netlify.toml             routing             netlify/functions/f1.js  results proxy
dev/smoke.mjs            headless all-panels smoke test
docs/FEATURES.md         feature reference + competitor analysis
```

---

*Independent app — not affiliated with, endorsed by or associated with Formula 1, the FIA or the official F1 Fantasy game. F1 and Formula 1 are trademarks of Formula One Licensing BV, used descriptively.*
