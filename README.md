# Gameweek Edge

The calm, clear companion that gives Fantasy Premier League managers a measurable edge. A single-file web app (`index.html`, vanilla JS) that runs three ways from one codebase:

- **Web app / PWA** — installable on phones from the browser (this is the no-Mac way onto an iPhone).
- **iOS app** — the same app wrapped natively with Capacitor (see [`README_MOBILE.md`](README_MOBILE.md)).
- **Live data** — pulled from the official FPL API through a Netlify serverless proxy.

## Run / deploy (web + PWA)

The app is built into `www/` and deployed on **Netlify**:

```bash
npm install
npm run build:web      # assembles www/ (index.html, native.js, PWA manifest, sw, icons)
npx netlify dev        # run locally with the FPL proxy working
```

Deploy by connecting this repo to Netlify. The included `netlify.toml` already sets:
- **build command** `npm run build:web`, **publish** `www`
- the FPL proxy function (`netlify/functions/fpl.js`) routed at `/api/fpl/*`

Once deployed, the site is a full PWA: offline-capable app shell (service worker), installable, with brand icons and a standalone display.

## Install on iPhone (no App Store, no Mac)

1. Open the deployed site in **Safari** on the iPhone.
2. Tap **Share** → **Add to Home Screen**.
3. Launch it from the home-screen icon — it runs full-screen, like an app.

On Android, Chrome shows an **Install app** prompt for the same site.

> PWA notes: works offline after first load; push notifications require iOS 16.4+ and are added in a later phase; it is not listed in the App Store. For a store-listed native build, see the cloud-build options in `README_MOBILE.md`.

## Live FPL data

All data comes live from the official FPL API via the proxy (the FPL API has no CORS and blocks direct browser calls). Bootstrap/fixtures are cached with a TTL; manager and live-matchday data are never cached. Enter your **FPL Manager ID** (topbar → *Link Team*) to load your squad, points and rank.

**All 21 panels are wired to live data.**

- **Free:** Dashboard, This Gameweek, My Squad (live pitch), Transfer Planner, Captaincy Lab, Fixture Planner, Differentials, Price Predictor, Injury Monitor, Chip Strategy, Watchlist (saved on device), Alerts, Player Compare.
- **Pro** (gated behind the paywall): Live Rank, DefCon Threats, Auto-Sub Tracker, What-If Simulator, EO Tracker, Template Meter, Rival Scout, Set Piece Register, Rotation Risk.

**Pro paywall:** free users see a value preview and an upgrade prompt on each Pro panel; Pro users get the live tools (lock badges disappear). The tier is real and gated end to end. Card/in-app payment is wired in Phase M4 — for now an honest in-app "Preview Pro" unlock lets the Pro experience be used and tested on the device.

## Project layout

```
index.html              the app (single source of truth)
src/native/index.js      native bridge (Capacitor) → bundled to www/native.js
manifest.webmanifest     PWA manifest        sw.js  PWA service worker
icons/                   PWA icons
scripts/build-web.mjs    assembles www/
netlify/functions/fpl.js FPL API proxy        netlify.toml  build + routing
ios/                     native Xcode project (see README_MOBILE.md)
www/                     build output (gitignored)
```
