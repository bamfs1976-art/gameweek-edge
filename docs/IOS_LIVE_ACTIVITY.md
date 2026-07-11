# iOS Live Activity + Home/Lock-Screen Widget

Gameweek Edge surfaces your **live gameweek points and rank** on the iOS
Home Screen, Lock Screen, and Dynamic Island — the single biggest thing the
web/PWA can't do and where the incumbent FPL apps are weakest.

The web app already computes the live snapshot (see `updateLiveActivity()` in
`index.html`, called from the Live Rank panel). It hands that snapshot to a
small **Capacitor plugin (`GWLive`)**, which writes it to a shared App Group
and drives a **WidgetKit** widget + an **ActivityKit** Live Activity. On web
and pre-iOS-16.1 the plugin is absent and every call no-ops.

## Files in this repo (already scaffolded)

| File | Target | Purpose |
|---|---|---|
| `ios/App/GWLiveWidget/GWShared.swift` | **App + Widget** | Shared snapshot model + Live Activity attributes |
| `ios/App/GWLiveWidget/GWLiveWidget.swift` | Widget | Home/Lock-screen widget + Live Activity UI + `@main` bundle |
| `ios/App/GWLiveWidget/Info.plist` | Widget | Widget extension manifest |
| `ios/App/App/GWLivePlugin.swift` | App | Capacitor plugin: write snapshot, reload widget, start/update/end activity |
| `ios/App/App/GWLivePlugin.m` | App | Registers the plugin as `Capacitor.Plugins.GWLive` |

The JS side is done — no further web changes are needed.

## One-time Xcode wiring

You need Xcode on a Mac; these steps can't be automated from the repo.

1. **Sync Capacitor** so the web build is copied in:
   ```
   npm run build:web && npx cap sync ios
   open ios/App/App.xcworkspace
   ```

2. **Add a Widget Extension target**: File → New → Target → **Widget Extension**.
   - Product name: `GWLiveWidget`
   - **Include Live Activity: ✓**
   - Uncheck "Include Configuration Intent" (this widget is static).
   - When prompted, do **not** activate the auto-created scheme changes you don't want; keep the target.
   - Delete the boilerplate `.swift`/`Info.plist` Xcode generated in the new
     group and instead **add the three files** already in
     `ios/App/GWLiveWidget/` (right-click the group → Add Files…).

3. **Share the model file**: select `GWShared.swift` → File Inspector →
   **Target Membership** → tick **both** `App` and `GWLiveWidget`.

4. **Add the plugin to the App target**: make sure `GWLivePlugin.swift` and
   `GWLivePlugin.m` are members of the `App` target (they live in
   `ios/App/App/`).

5. **App Group** (shared storage) — add to **both** targets:
   Signing & Capabilities → **+ Capability → App Groups** → add
   `group.app.gameweekedge` (must equal `kGWAppGroup` in `GWShared.swift`).

6. **Enable Live Activities**: in the **App** target's `Info.plist` add
   ```
   NSSupportsLiveActivities = YES
   ```
   (optionally `NSSupportsLiveActivitiesFrequentUpdates = YES`).

7. **Deployment target**: the Live Activity needs iOS 16.1+. The widget's
   Home/Lock-screen views work on iOS 16+. Set the widget target's minimum
   to iOS 16.0 (the code guards 16.1/16.2 APIs).

8. Build to a device (Live Activities don't show in older simulators; use a
   physical iPhone or an iOS 16.2+ simulator).

## How it runs

- On the **Live Rank** panel, `updateLiveActivity({gw,points,rankText,toPlay,playing,captain})`
  fires on first render and on every 45s auto-refresh.
- `GWLive.update` saves the snapshot to the App Group and calls
  `WidgetCenter.reloadAllTimelines()`, so the Home/Lock-screen widget follows.
- The first time `playing > 0`, the plugin **starts** the Live Activity; it
  **updates** on subsequent snapshots and **ends** when the gameweek is done
  (`playing === 0 && toPlay === 0`).
- The user adds the widget the usual way (long-press Home Screen → **+** →
  Gameweek Edge) or to the Lock Screen via the wallpaper editor.

## Optional: push-driven updates

Today the Live Activity refreshes while the app has run recently (App Group +
WidgetKit budget). For always-fresh scores with the app fully closed, add
**ActivityKit push tokens**: capture `activity.pushTokenUpdates` in
`GWLivePlugin`, POST the token to a new Netlify function, and have
`push-live.js` send `contentState` updates to APNs (`.../push/liveactivity`).
That's a follow-on; the local path above already covers the common case.
