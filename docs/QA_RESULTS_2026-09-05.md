# QA results — 5 September 2026

Branch `claude/distribution-readiness` (the readiness pass), run against the
built `www/` served locally with `dev/mock_fpl.py` behind `/api/fpl`. The
live FPL feed and the live site are not reachable from the sandbox this ran
in, so every check below is against the synthetic feed; the numbers on
screen are not real, the rendering, routing and chrome are.

Two viewports, as `QA_CHECKLIST.md` asks: a phone (390×844, touch, mobile
emulation) and a desktop (1280×1000). Script: a Playwright walk of the
first-run flow, the thirteen panels a first session touches, the display
mode switch, the theme toggle, keyboard focus and the public record page.
Screenshots were taken at each onboarding step and on Home, The Model and
Alerts in both themes.

**Result: 86 of 86 checks passed.**

## Guard suite and tests on the final commit

| Check | Result |
|---|---|
| Inline script parse (`node --check`) | pass |
| `node --check` on every Netlify function | pass |
| `scripts/check-shell.mjs` | pass (20 ids, 35 precache entries, no client-side secrets, no hard-coded suspension threshold) |
| `dev/test-core.mjs` | 1369 passed, 0 failed |
| `scripts/check-a11y.mjs` | 0 findings (51 before this pass, see `docs/A11Y_AUDIT.md`) |
| `scripts/check-mobile.mjs` | pass |
| `scripts/check-share.mjs` | pass |
| `scripts/vendor-suspension.mjs --check`, `vendor-share.mjs --check` | pass (offline; `--remote` runs in CI) |
| `npm test` (the whole suite, browser suites included) | pass, exit 0 |
| `npm run build:web` | pass; `www/` carries every path in the service worker's precache lists (`check-shell` reads `SHELL`, `EFL_SHELL` and `ROTATION`) plus `/record/` and `/lib/gwe-share.js` |

## Browser checks

| Viewport | Check | Result | Detail |
|---|---|---|---|
| phone | first run opens on the Manager ID step | pass |  |
| phone | no horizontal page scroll on first run | pass |  |
| phone | rating screen renders four stats | pass |  |
| phone | action screen shows one action and the sign-in prompt | pass |  |
| phone | bottom bar shows five panels + More | pass | This Gameweek|My Squad|Transfer Planner|Captaincy Lab|Price Predictor| |
| phone | visible controls are at least 44px tall | pass | [] |
| phone | bottom bar carries a safe-area padding rule | pass | 4px |
| phone | ticker chip holds one line | pass | {"h":30.75,"lines":2} |
| phone | no form control wider than the viewport | pass |  |
| phone | no page errors through onboarding | pass |  |
| phone | / renders My Week | pass | My Week |
| phone | / does not scroll sideways | pass |  |
| phone | /overview renders Overview | pass | Overview |
| phone | /overview does not scroll sideways | pass |  |
| phone | /squad renders My Squad | pass | My Squad |
| phone | /squad does not scroll sideways | pass |  |
| phone | /planner renders Transfer Planner | pass | Transfer Planner |
| phone | /planner does not scroll sideways | pass |  |
| phone | /captaincy renders Captaincy Lab | pass | Captaincy Lab |
| phone | /captaincy does not scroll sideways | pass |  |
| phone | /prices renders Price Predictor | pass | Price Predictor |
| phone | /prices does not scroll sideways | pass |  |
| phone | /fixtures renders Fixtures | pass | Fixtures |
| phone | /fixtures does not scroll sideways | pass |  |
| phone | /live renders Live | pass | Live |
| phone | /live does not scroll sideways | pass |  |
| phone | /leagues renders Mini-Leagues | pass | Mini-Leagues |
| phone | /leagues does not scroll sideways | pass |  |
| phone | /matchday renders Matchday | pass | Matchday |
| phone | /matchday does not scroll sideways | pass |  |
| phone | /model renders The Model | pass | The Model |
| phone | /model does not scroll sideways | pass |  |
| phone | /alerts renders Alerts | pass | Alerts |
| phone | /alerts does not scroll sideways | pass |  |
| phone | /more renders More | pass | More |
| phone | /more does not scroll sideways | pass |  |
| phone | Alerts: captain-not-starting toggle present and off by default | pass |  |
| phone | The Model shows the FPL record scorecard | pass |  |
| phone | Captaincy Lab has a Share button | pass |  |
| phone | More index offers the display-mode switch | pass |  |
| phone | switching to Simple gives the five-panel rail | pass | This Gameweek|My Squad|Transfer Planner|Captaincy Lab|Price Predictor| |
| phone | dark theme applies | pass |  |
| phone | keyboard focus shows a visible ring | pass | solid 2px |
| phone | no page errors across the panels | pass |  |
| phone | /record/ page serves | pass |  |
| desktop | first run opens on the Manager ID step | pass |  |
| desktop | no horizontal page scroll on first run | pass |  |
| desktop | rating screen renders four stats | pass |  |
| desktop | action screen shows one action and the sign-in prompt | pass |  |
| desktop | bottom bar hidden on desktop | pass | This Gameweek|My Squad|Transfer Planner|Captaincy Lab|Price Predictor| |
| desktop | no page errors through onboarding | pass |  |
| desktop | / renders My Week | pass | My Week |
| desktop | / does not scroll sideways | pass |  |
| desktop | /overview renders Overview | pass | Overview |
| desktop | /overview does not scroll sideways | pass |  |
| desktop | /squad renders My Squad | pass | My Squad |
| desktop | /squad does not scroll sideways | pass |  |
| desktop | /planner renders Transfer Planner | pass | Transfer Planner |
| desktop | /planner does not scroll sideways | pass |  |
| desktop | /captaincy renders Captaincy Lab | pass | Captaincy Lab |
| desktop | /captaincy does not scroll sideways | pass |  |
| desktop | /prices renders Price Predictor | pass | Price Predictor |
| desktop | /prices does not scroll sideways | pass |  |
| desktop | /fixtures renders Fixtures | pass | Fixtures |
| desktop | /fixtures does not scroll sideways | pass |  |
| desktop | /live renders Live | pass | Live |
| desktop | /live does not scroll sideways | pass |  |
| desktop | /leagues renders Mini-Leagues | pass | Mini-Leagues |
| desktop | /leagues does not scroll sideways | pass |  |
| desktop | /matchday renders Matchday | pass | Matchday |
| desktop | /matchday does not scroll sideways | pass |  |
| desktop | /model renders The Model | pass | The Model |
| desktop | /model does not scroll sideways | pass |  |
| desktop | /alerts renders Alerts | pass | Alerts |
| desktop | /alerts does not scroll sideways | pass |  |
| desktop | /more renders More | pass | More |
| desktop | /more does not scroll sideways | pass |  |
| desktop | Alerts: captain-not-starting toggle present and off by default | pass |  |
| desktop | The Model shows the FPL record scorecard | pass |  |
| desktop | Captaincy Lab has a Share button | pass |  |
| desktop | More index offers the display-mode switch | pass |  |
| desktop | switching to Simple gives the five-panel rail | pass | This Gameweek|My Squad|Transfer Planner|Captaincy Lab|Price Predictor| |
| desktop | dark theme applies | pass |  |
| desktop | keyboard focus shows a visible ring | pass | solid 2px |
| desktop | no page errors across the panels | pass |  |
| desktop | /record/ page serves | pass |  |

## QA_CHECKLIST.md sections and how far this run covers them

| Section | Covered here | Not covered here (needs the live feed or a device) |
|---|---|---|
| 1 Setup and routing | Real paths render the right panel, back/forward in `dev/test-simplenav.mjs` | Netlify redirects on the live site |
| 2 Link team | The Manager ID step validates and links against the mock | A real Manager ID, the 404 copy against the live API |
| 3 Free panels | Every free panel in the first-session set renders with no page error on both viewports | Live matchday numbers, the Weekly Digest and Review cards (need `ANTHROPIC_API_KEY`) |
| 4 Pro gating | Ran as Pro; the lock strip is asserted in `dev/test-social.mjs` | Stripe checkout |
| 5 AI features | Not run | All of it: no key in the sandbox |
| 6 Accounts | The sign-in prompt appears after the rating and never before | A real Supabase sign-up, the display-mode sync to `gwedge_profiles` (run `supabase/gwedge_profiles_display_mode.sql` first) |
| 7 Push | The captain-not-starting toggle is present and off by default | A real subscription; the alert fires only during a live gameweek |
| 8 PWA | Manifest, icons, theme-color and safe-area rules asserted by `check-mobile` | Install to a home screen; offline reload |
| 9 Accessibility | Focus ring visible on keyboard, 44px targets, no horizontal scroll, contrast by token | A screen-reader pass |
| 10 Themes | Dark theme applies and persists | Visual check of every panel in dark on a device |
| 11 Responsive | Phone and desktop, every panel without sideways scroll; the bottom bar is the five simple-mode panels plus More on the phone | Tablet widths (1024 is covered in `test-simplenav`) |
| 12 Performance | Not measured | Lighthouse on the live site |

## Things to look at by hand after the merge

- The share cards on an iPhone: tap Share on Captaincy Lab and confirm the
  native sheet opens (the desktop path downloads a PNG).
- `/record/` on the live site once the first gameweek has been recorded by
  `.github/workflows/fpl-record.yml`; until then it says so plainly.
- The display-mode sync: run the SQL, sign in on two devices, switch on one.
