# Gameweek Edge — iOS app (Phase M1)

This repo now ships an iOS app built by **wrapping the existing single-file web app (`index.html`) in Capacitor**, exactly as set out in `MOBILE_APP_BRIEF.md`. `index.html` stays the one source of truth; the native layer adds only what a browser cannot do, behind capability checks.

## What Phase M1 delivers

- Capacitor iOS project (`ios/`) with 8 native plugins wired in.
- A native bridge (`src/native/index.js` → bundled to `www/native.js`) exposing `window.GENative`. Every method is a safe no-op on the plain web build, so the UI never has to branch.
- Native-feel polish, all gated to the native shell (`html.native`):
  - Status bar colour follows the light/dark theme; theme choice persists.
  - Safe-area handling so the topbar/drawer clear the notch and Dynamic Island (`viewport-fit=cover` + `env(safe-area-inset-*)`).
  - Pull-to-refresh on the dashboard with a branded spinner.
  - Haptics on nav changes, buttons and the refresh gesture.
  - Browser-isms disabled on app chrome (text selection, tap highlight, rubber-band overscroll); body copy stays selectable.
  - A polite, accessible **offline banner** driven by connectivity (web `online`/`offline` events + the native Network plugin).
  - App lifecycle (`resume`), keyboard and Android back wired via DOM events.
- Locked to **portrait** on iPhone (iPad keeps all orientations).
- **Privacy manifest** (`ios/App/App/PrivacyInfo.xcprivacy`) declaring no tracking, no data collection, and the one required-reason API actually used (UserDefaults via `@capacitor/preferences`).
- Brand app icon and light/dark splash screen generated into the Xcode asset catalogs.
- App identity: name **Gameweek Edge**, bundle id `com.gameweekedge.app` (change in `capacitor.config.json` if needed).

## Project layout

```
index.html              the app (single source of truth, web + native)
src/native/index.js     native bridge source (Capacitor plugins)
scripts/build-web.mjs    assembles www/ : copies index.html + bundles native.js
scripts/gen-art.mjs      regenerates source icon/splash artwork in assets/
capacitor.config.json    Capacitor + plugin config
assets/                  1024px icon + 2732px splash source art
ios/                     native Xcode project (commit; Pods/ is regenerated)
www/                     build output (gitignored, regenerated)
```

## Building the iOS app — requires macOS + Xcode

The web assets, native bridge, Xcode project and brand assets are all committed. The final compile must run on a Mac (Apple toolchain only). From a clean clone:

```bash
# 1. Install JS deps
npm install

# 2. Build the web bundle and copy it into the native project
npm run sync          # = build:web + cap sync

# 3. Install native pods (Mac, needs CocoaPods: `sudo gem install cocoapods`)
cd ios/App && pod install && cd ../..

# 4. Open in Xcode
npx cap open ios
```

In Xcode: select your Team under **Signing & Capabilities**, pick a simulator or a connected device, and press **Run**. To ship: **Product → Archive**, then distribute to TestFlight / the App Store.

> **One Xcode step for submission:** drag `App/PrivacyInfo.xcprivacy` into the **App** group in the Xcode navigator and tick the **App** target under *Target Membership* so the privacy manifest is bundled. (It's committed to the repo but not yet referenced in `project.pbxproj`, which can't be safely edited off-Mac.)

After any change to `index.html` or `src/native/`, re-run `npm run sync` (or `npm run ios`, which also opens Xcode) to push the latest web build into the native app.

## Not in M1 (see MOBILE_APP_BRIEF.md)

- Push notifications (the plugin is installed but registration waits for APNs credentials — Phase M2).
- Offline caching of live FPL data — Phase M2.
- Native accounts / biometrics / Sign in with Apple — Phase M3.
- In-app purchases for Pro — Phase M4. **Note:** in-app digital subscriptions must use Apple IAP, not Stripe.

## A note on the build environment

Phase M1 was scaffolded and verified on Linux: the web bundle builds, the inline app script passes a syntax check, `cap sync` succeeds and the icon/splash sets generate. The `.ipa` itself cannot be produced off macOS, so the Xcode archive step above is the one piece that must be done on a Mac.
