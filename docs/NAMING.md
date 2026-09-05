# Feature naming — one name per feature

The `NAV` registry in `index.html` is the source of truth. Every panel has
exactly one name, used in the rail, the area tab strip, the ⌘K palette, the
More index, the keyboard cheatsheet, page titles, the landing page, the
README and the docs. Views inside a hub panel (for example *Percentile* inside
Live) keep their view names; they are not features in their own right.

Push notifications name the **event** ("Overnight price changes", "Your
players are involved") and deep-link to a panel. None named a panel by a
retired label, so none changed in this pass; the deep links they carry use
ids that `PANEL_ALIAS` still resolves.

## The table

| NAV id | Canonical name | Variants found before this pass | Where the variants were | Applied |
|---|---|---|---|---|
| `myweek` | **My Week** | This Gameweek, Your week, this gameweek | README, QA checklist, FEATURES, landing pricing | README, QA, FEATURES, landing updated. "This Gameweek" survives only as the Simple-mode **destination** label, which lands on My Week (linked) or Overview (unlinked) |
| `dashboard` | **Overview** | Dashboard | README, QA, FEATURES headings, landing pricing, FIRST_RUN_UX prose, an owner-only analytics KPI label | README, QA, landing updated. The Analytics KPI ("Dashboard only") and the historical FIRST_RUN_UX review keep the word: one is an owner metric, the other a dated document |
| `gw-actions` | **Gameweek recap** | Gameweek summary (card title) | index.html | Card titles inside a panel may describe a section; left |
| `gwdebrief` | **GW Debrief** | Per-gameweek debrief; and a card *inside Manager Report* titled "GW Debrief" | landing comparison row; index.html | Landing updated. The Manager Report card is now "Your gameweek, reviewed" so two panels no longer share a heading |
| `blog` | **The Wire** | The Wire — latest news (the NAV label itself), The Wire — what the model is seeing, Briefings | NAV, More index, empty state | NAV label trimmed to the name; descriptor moved to the More index line |
| `scout` | **Scout AI** (the panel) · **Ask the Scout** (the chat inside it) | AI Scout, AI Scout Report, AI Scout & chat, AI scout grounded in your squad, Ask the AI scout | Pro benefits, upgrade modal, card title, More index, landing (three places), README, QA, MARKETING | All product surfaces updated to Scout AI / Ask the Scout. Lower-case "an AI scout" in body copy is descriptive, not a name, and stays (BRAND.md §2 uses it the same way) |
| `accountability` | **The Model** (views: Track record, How it works) | Model Accountability, Methodology, The model graded in public | index.html prose, README, function comments, three Netlify function headers | Visible prose and README updated. Comments and function headers keep the old word; they are not user-facing. The readiness brief's "Model Accountability" means this panel |
| `squad` | **My Squad** | — | | consistent |
| `transfers` | **Transfer Planner** | Transfer Solver (a card inside), AI Transfer Planner (a card inside), 3-GW plan, Transfer planner (lower case) | index.html cards, FEATURES, landing | Landing updated. Card titles inside the panel describe its sections and stay |
| `captain` | **Captaincy Lab** | captaincy lab (lower case), The Captaincy Index (a Wire article) | landing, FEATURES | Landing updated. The Wire article keeps its title; it is an article |
| `chips` | **Chip Strategy** | Chip Planner, Chip Adviser, Chip plan | index.html prose, README, QA | Prose updated to Chip Strategy. "AI Chip Adviser" remains the name of the AI card inside the panel |
| `draft` | **Squad Planner** | Pre-season Draft, the Draft | README, MARKETING | README updated. `dev/test-ui.mjs` asserts the old name is *absent*, which still holds |
| `gwreport` | **Manager Report** | GW Debrief (cheatsheet row and card title), GW History (retired alias), Season review, YOUR MANAGER REPORT | index.html, FEATURES | Cheatsheet row and card title updated. FEATURES now lists it free, under My Team, as the NAV does |
| `liverank` | **Live** (views: Percentile, Bonus, DEFCON, Rank threats, Auto-subs) | Live Rank, Live Percentile, Live matchday, live rank, Live overall rank | BRAND §9, README, landing (four places), FEATURES, MARKETING | BRAND, README, landing, FEATURES updated. "Live rank" was also a claim the product does not make (it is an estimated percentile), so the landing copy now says percentile |
| `allplayers` | **Players** (lenses: Differentials, Fitness, …) | Differentials, Injury Monitor | cheatsheet, README, QA, FEATURES, landing | Cheatsheet, README, QA, landing updated. Lens names stay as lens names |
| `scoutboard` | **Scout Board** | — | | consistent |
| `compare` | **Player Compare** | — | | consistent |
| `price` | **Price Predictor** (views: Price moves, Transfer market) | price moves | landing | Landing updated |
| `setpiece` | **Set Piece Register** | set-pieces, set-piece register | landing, upgrade modal | Both updated |
| `rotation` | **Rotation Risk** | — | | consistent |
| `news` | **Latest News** | Latest player news, Injury and press-conference news | card title, More index | Left: descriptions, not names |
| `fixtures` | **Fixtures** (views: grid, points, clean sheets) | Fixture Planner, Points Planner, Clean Sheet Matrix, Fixtures & odds | cheatsheet, index.html prose, BRAND §9, README, QA, FEATURES, landing | All updated. Points Planner and Clean Sheet Matrix survive only as view captions inside the panel |
| `seasonsim` | **Simulators** (views: Season, What-if) | Season Simulator, What-If Simulator, Scenario Lab | upgrade modal, BRAND §9, README, landing | All updated; view names stay |
| `watchlist` | **Watchlist** | — | | consistent |
| `alerts` | **Alerts** | Smart alerts, Push alerts (card) | landing, index.html | Landing updated |
| `leagues` | **Mini-Leagues** | Mini-leagues, Leagues (bottom-tab short form) | landing, DESTINATIONS | Landing updated. "Leagues" stays as the Terminal-mode tab short form, the same convention as "Squad" for My Squad |
| `rivals` | **Rival Scout** | rival scout, Rival intelligence | landing, Pro benefits | Landing updated |
| `eo` | **Ownership** (views: Your EO, The template) | EO Tracker, Template Meter, EO, template | upgrade modal, BRAND §9, README, landing, FEATURES | All updated |
| `results` | **Matchday** (views: Results, Forecasts, Line-ups) | Match Centre (as the panel), Results | cheatsheet, index.html link, landing, MARKETING, YOUR_LAUNCH_CHECKLIST | Cheatsheet, link and landing updated. **Match Centre is the area** that holds Matchday, Title Race, Clubs and Ten Seasons, so the launch and marketing docs' "Match Centre" reads as the area and stands |
| `titlerace` | **Title Race** | — | | consistent |
| `dossier` | **Clubs** (views: Dossier, Recent form) | Club Dossier, Team Form | comments, FEATURES | View names |
| `archive` | **Ten Seasons** | Ten seasons of history, Ten Seasons panel | README | README updated |
| `glossary` | **Glossary** | FPL & model terms (card) | index.html | Card title, left |
| `fplbasics` | **New to FPL** | Fantasy Premier League, in two minutes (card) | index.html | Card title, left |
| `design` | **Design System** | — | | consistent |

## Rules going forward

1. A new panel gets its name in `NAV` first; everything else copies it.
2. A view inside a hub has a view name and is never promoted to a feature
   name in copy ("the Percentile view of Live", not "Live Percentile").
3. Bottom-tab and rail labels may be short forms (Squad, Leagues) in Terminal
   mode; Simple mode uses the full panel names because there is room.
4. Push notifications name the event, never the panel.
5. `BRAND.md` §9 mirrors this file, not the other way round.
