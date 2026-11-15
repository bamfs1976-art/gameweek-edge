# Modern Web Guidance review of the live sites

Date: 15 November 2026
Guidance: https://github.com/GoogleChrome/modern-web-guidance
Pages checked: https://gameweekedge.co.uk/ (the app), /landing.html, /privacy.html. gameweekedge.app was not reachable from the review environment.
Method: live HTML and headers pulled, then the app and landing page loaded in Chromium as a Pixel 7 with 4x CPU slowdown.

## Measured results

| Page | HTML on the wire | FCP | LCP | CLS | Long tasks |
|---|---|---|---|---|---|
| App | 361 KB (1.24 MB unzipped) | 1.19 s | 2.57 s | 0 | 8 tasks, 830 ms total, longest 145 ms |
| Landing | small (36 KB unzipped) | 0.51 s | 0.51 s | 0 | 1 task, 161 ms |

No console errors. No horizontal scroll on mobile. Layout shift is zero on both pages.

## What is already good

- Security headers: strict CSP, HSTS, nosniff, frame-ancestors none, referrer and permissions policies.
- `esc()` helper used when building HTML strings.
- `lang="en-GB"`, canonical links, Open Graph tags, one h1 per page.
- 14 `prefers-reduced-motion` rules in the app.
- Sign-in fields use `type="email"` and `autocomplete="email"` / `current-password`.
- Brotli compression is on.

## Findings, most important first

### 1. Main-thread work on the app (guide: break-up-long-tasks)
One inline script of about 1 MB plus 143 KB of inline CSS. Eight long tasks on load (830 ms in total on a mid-range phone). Long tasks delay taps and hurt INP.
Fix: split heavy start-up work into chunks and yield every 50 ms. Use `scheduler.yield()` with a `setTimeout` fallback, which Safari and the iOS app need.

### 2. Script loading order (guide: optimize-script-priority)
12 external scripts load with no `defer` or `async`, so each one blocks parsing.
Fix: add `defer` to scripts not needed for first paint. Add `fetchpriority="low"` to late, non-critical ones such as share and save helpers. Use `fetchpriority="high"` on no more than one or two.

### 3. Modals built from divs (guides: light-dismiss-a-dialog, prevent-page-scroll-under-modal-dialog)
Ten modals and drawers use `<div role="dialog" aria-modal>`. Focus trapping, Esc handling and background inertness are hand-written.
Fix: move to native `<dialog>` opened with `showModal()`. Add `closedby="any"` with the click-outside fallback (Safari lacks `closedby`). Add `overscroll-behavior: contain` on `dialog:modal` and on `dialog::backdrop` with `overflow: hidden`. Do not lock scroll by setting overflow on `html` or `body`.

### 4. Raw HTML insertion (guides: sanitize-untrusted-html, trusted-types)
317 `innerHTML` assignments. Most use `esc()`, but the CSP still allows `'unsafe-inline'` scripts, so one missed escape becomes an XSS hole.
Fix: audit any `innerHTML` that renders data from the FPL API, Supabase or user input. Where the Sanitizer API (`setHTML`) is supported, use it, with the current `esc()` path as fallback. Longer term, move inline handlers out so the CSP can drop `'unsafe-inline'` and add Trusted Types.

### 5. Clickable divs and small tap targets (guide: accessibility)
26 `<div onclick>` and 4 `<span onclick>`. These miss keyboard and screen-reader support unless extra code is added. 14 buttons or links on the app and 8 on the landing page are smaller than 24 by 24 px on mobile.
Fix: swap for `<button type="button">` and raise tap targets to at least 24 px (44 px preferred on touch).

### 6. Next-page speed (guides: improve-next-page-load-performance, cross-document-transitions)
No speculation rules and no view transitions. Landing to app, and blog or tool pages to app, are full reloads.
Fix: add a `speculationrules` script with `prefetch` at `moderate` eagerness on the landing and content pages. Add `@view-transition { navigation: auto; }` inside a `prefers-reduced-motion: no-preference` block on all pages.

### 7. Tables on small screens (guide: responsive-table)
29 tables, 1 caption, 7 `scope` attributes. 12 `overflow-x: auto` wrappers exist.
Fix: add `<caption>` (can be visually hidden) and `scope="col"` to header cells. Make each scroll wrapper focusable with `tabindex="0"` and a label so keyboard users can scroll it.

### 8. Theme and polish
- The app's `theme-color` is a single dark value. The landing page already uses light and dark versions. Match it in the app.
- The privacy page has no `<main>` landmark and uses a different `theme-color` (#15824a) from the rest of the site.
- Images built in JavaScript have no width and height. CLS is zero today, but set them to keep it that way.

## Suggested order

1. Script `defer` and priority (small change, quick win).
2. Long-task chunking with `scheduler.yield()` and fallback.
3. Native `<dialog>` migration, one modal at a time.
4. `innerHTML` audit on external data.
5. Buttons and tap targets.
6. Speculation rules and view transitions.
7. Table semantics and theme polish.
