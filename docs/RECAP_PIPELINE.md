# Social Video — Pipeline

Two videos share one renderer, one look and **one audio bed**: the weekly
**Gameweek Recap** and the on-demand **Budget Rotation**. Adding a third is a
template plus a JSON file, not a second pipeline.

| Video | Trigger | Template | Data | Release tag |
|---|---|---|---|---|
| Gameweek Recap | Tue 09:00 UTC | `template.html` | `fetch-data.mjs` | `recap-gw{n}` |
| Budget Rotation | manual | `template-rotation.html` | `fetch-rotation.mjs` | `rotation-{tag}` |

`render.mjs` and `preview.mjs` both take `--template`, `--data` and `--name`,
defaulting to the recap so existing invocations are unchanged. Scene times come
from each template's own `RECAP_SCENES`, so a retimed video previews at the
right moments without the preview script being touched.

## Budget Rotation

The exactly-solved cheapest way to cover one squad slot across the opening
run — the same `rotationChain` the Fixture Planner uses, **extracted from
`index.html` at runtime** rather than reimplemented, so the plan in the video
is the plan in the app. A second copy would drift within a month.

It is **manual, not scheduled**: a rotation plan changes when the fixture
picture changes, not on a timetable, and publishing weekly would put out
near-identical videos. Inputs let you pick the position, the price ceiling and
the horizon.

Two shapes, chosen by the data rather than by the editor:

- **Hold, then switch** — the chain, with each switch marked on the timeline.
- **One club, all the way** — when holding a single player genuinely beats
  every rotation, the video says so instead of manufacturing a chain. A blank
  gameweek renders as *blank*, not as a hard fixture; colouring it red would
  say the opposite of what it means.

---

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
  render.mjs                     Playwright frames → ffmpeg → mp4 (with audio)
  music.mjs                      synthesised royalty-free ambient bed
  preview.mjs                    local contact-sheet of key frames (no ffmpeg)
  fetch-rotation.mjs             FPL + index.html model → rotation.json
  template-rotation.html         self-contained animated 1080×1080 rotation video
```

### Music

`render.mjs` muxes an audio bed. By default `music.mjs` synthesises an
original, royalty-free ambient pad (fully owned, safe to post). To use your
own licensed track instead, drop `music.mp3` (or `.m4a` / `.wav`) into
`scripts/recap/` — the render prefers a supplied file over the synth.

`music.mp3` is currently present and free to use, and **every video in the
series uses it** — same file, same mux, no per-video work. Consistent audio
across a series is what makes separate posts read as one channel.

### Re-rendering

`workflow_dispatch` takes a `force` input: run with **force = true** to
re-render a gameweek that already has a release (it replaces the release and
tag). Handy after changing the template or the music.

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
