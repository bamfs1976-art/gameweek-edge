# Gameweek Recap Video — Pipeline

Automatically renders a branded **1080×1080 MP4** recap after each gameweek
settles and publishes it as a GitHub Release for you to download and post on
X. No servers, no X API, ~£0.

## Architecture (one scheduled GitHub Action)

```
Tue 09:00 UTC ─▶ .github/workflows/gw-recap.yml
                   │
                   ├─ 1. fetch-data.mjs → FPL API → scripts/recap/recap.json
                   │                       (finds latest finished+checked GW;
                   │                        exits 0 if a release already exists)
                   ├─ 2. render.mjs     → Playwright loads template.html, drives
                   │                       seek(t) at 30fps, screenshots frames,
                   │                       ffmpeg encodes recap-gw{n}.mp4
                   └─ 3. gh release      → Release "recap-gw{n}" with the MP4
                                           = delivery + notification + dedupe
```

A GitHub Release per GW is the idempotency marker (tag exists → skip), the
delivery (MP4 asset, never expires) and the notification (release email) in
one.

## Files

```
.github/workflows/gw-recap.yml   scheduled pipeline
scripts/recap/
  fetch-data.mjs                 FPL → recap.json, GW detection
  template.html                  self-contained animated 1080×1080 recap
  render.mjs                     Playwright frames → ffmpeg → mp4
  preview.mjs                    local contact-sheet of key frames (no ffmpeg)
```

None of this touches `index.html` or the app bundle; CI stays green.

## Trigger & idempotency

```yaml
on:
  schedule: [{ cron: '0 9 * * 2' }]   # Tue 09:00 UTC
  workflow_dispatch:
```

`fetch-data.mjs` picks the latest `bootstrap-static` event with
`finished && data_checked`. The workflow skips if release `recap-gw{n}`
already exists, so it is safe to run repeatedly.

## Data → content (official FPL API)

| Endpoint | Feeds |
|---|---|
| `bootstrap-static/` | GW points, price changes, ownership, `most_captained`, `average_entry_score`, `highest_score`, teams |
| `event/{n}/dream-team/` | Dream Team XI + top player |
| `resources.premierleague.com/.../photos` & `/badges` | player photos, club crests |

## Storyboard (~20s, square, silent)

1. Intro (0–2s) — "GAMEWEEK {n} · RECAP" + Gameweek Edge mark.
2. Top hauls (2–7s) — top 5 by GW points.
3. Dream Team (7–13s) — official XI, total, top scorer highlighted.
4. Numbers that mattered (13–17s) — biggest riser, most-captained return,
   biggest differential haul, average vs highest score.
5. Outro (17–20s) — "Full breakdown in the app — gameweekedge.co.uk".

Brand tokens: green `#15824a`, Bricolage Grotesque + Public Sans, the logo mark.

## Render

Deterministic frame capture: `template.html` exposes `window.seek(t)` that sets
every scene's state as a pure function of `t`; `render.mjs` screenshots 30fps
frames, then:

```
ffmpeg -r 30 -i frame-%04d.png -c:v libx264 -pix_fmt yuv420p -movflags +faststart recap.mp4
```

Silent (X autoplays muted). ~2–4 min per run. `ubuntu-latest` runners ship
ffmpeg; Chromium via `playwright install --with-deps chromium`.

## Cost

£0. Public-repo Actions are free; the private-repo free tier (2,000 min/mo)
easily covers a ~3-min weekly render.

## Later add-ons

- Royalty-free music bed.
- Personalised variant (uses a Manager ID: "your GW: X pts, green arrow").
- Full auto-post via the X API v2 (paid tier).
