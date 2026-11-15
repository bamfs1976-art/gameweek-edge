# Project memory for Claude

## Modern web guidance (Google Chrome)

Source: https://github.com/GoogleChrome/modern-web-guidance

- Before building or changing any web feature, search the guidance first:
  `npx -y modern-web-guidance@latest search "<what you want to do>"`
  then `npx -y modern-web-guidance@latest retrieve "<id>"` and follow it.
  In a sandbox, set `NPM_CONFIG_CACHE=/tmp/npm-cache`.
- The guides assume Baseline Widely available features need no fallback. Anything newer needs the fallback the guide gives.
- Browser support note: the iOS app runs in WKWebView (Safari engine). Treat Safari as a must-support target, so Safari-unsupported APIs (for example `scheduler.yield()`, `<dialog closedby>`) always ship with their fallback.
- Live sites reviewed against the guidance on 2026-11-15: see `docs/MODERN_WEB_REVIEW.md` for the findings and priority order.
