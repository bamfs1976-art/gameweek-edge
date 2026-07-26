# Social Video — Pipeline

Six videos share one renderer, one look and **one audio bed**: the weekly
**Gameweek Recap** plus five on-demand videos drawn from the app's own
analytics. A seventh is a template plus a JSON file, not a second pipeline.

| Video | Trigger | Template | Data | Release tag |
|---|---|---|---|---|
| Gameweek Recap | Tue 09:00 UTC | `template.html` | `fetch-data.mjs` | `recap-gw{n}` |
| Budget Rotation | manual | `template-rotation.html` | `fetch-video.mjs --kind rotation` | `rotation-{tag}` |
| Set-Piece Takers | manual | `template-setpieces.html` | `fetch-video.mjs --kind setpieces` | `setpieces-{tag}` |
| Out Of Position | manual | `template-oop.html` | `fetch-video.mjs --kind oop` | `oop-{tag}` |
| Attack Or Defence | manual | `template-lean.html` | `fetch-video.mjs --kind lean` | `lean-{tag}` |
| Where The Chips Go | manual | `template-chips.html` | `fetch-video.mjs --kind chips` | `chips-{tag}` |

`render.mjs` and `preview.mjs` both take `--template`, `--data` and `--name`,
defaulting to the recap so existing invocations are unchanged. Scene times come
from each template's own `RECAP_SCENES`, so a retimed video previews at the
right moments without the preview script being touched.

```bash
node scripts/recap/fetch-video.mjs --kind lean
node scripts/recap/preview.mjs --template template-lean.html --data lean.json --name v-lean
node scripts/recap/render.mjs   --template template-lean.html --data lean.json --name lean
# → scripts/recap/out/lean.mp4
```

## The five on-demand videos

All five are **manual, not scheduled**. Their subjects change when the fixture
or squad picture changes, not on a timetable, and publishing weekly would put
out near-identical videos. One workflow —
`.github/workflows/social-video.yml` — covers all five with a `kind` choice
input; the position, price ceiling and horizon inputs apply to `rotation` only.

Every one of them **extracts its model from `index.html` at runtime** rather
than reimplementing it, so what the video says is what the app says. A second
copy of `rotationChain` or `oopFlag` here would drift within a month.

### A video with no data is not an error

`fetch-video.mjs` exits **2** with a plain-English reason when a subject has
nothing to say yet — no clearly out-of-position players before a ball is
kicked, too few fixtures to call a club's venue lean. The workflow treats
exit 2 as `skip=true` and finishes green without publishing. Manufacturing a
video out of thin data would be the worse outcome.

- **Budget Rotation** — the exactly-solved cheapest way to cover one squad
  slot across the opening run, from `rotationChain`. Two shapes, chosen by the
  data rather than the editor: *hold, then switch* (the chain, each switch
  marked on the timeline) and *one club, all the way* (when holding a single
  player genuinely beats every rotation, the video says so). A blank gameweek
  renders as *blank*, not as a hard fixture; colouring it red would say the
  opposite of what it means.
- **Set-Piece Takers** — first-choice penalties, direct free-kicks and corners
  by club, from the official order fields via `setPieceClubRows`.
- **Out Of Position** — defenders and midfielders whose non-penalty xG per 90
  sits a rung above their position's median, from `oopFlag`.
- **Attack Or Defence** — for each club, whether the model prefers you buy its
  attack or its defence over the window, from `clubLean`.
- **Where The Chips Go** — the planner's chip placements across the half, with
  the gameweek, the fixture and the captain behind each one.

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
.github/workflows/gw-recap.yml     scheduled recap pipeline
.github/workflows/social-video.yml manual pipeline, all five on-demand videos
scripts/recap/
  fetch-data.mjs                   FPL → recap.json, GW detection
  fetch-video.mjs                  FPL + index.html model → {kind}.json
  render.mjs                       Playwright frames → ffmpeg → mp4 (with audio)
  preview.mjs                      local contact-sheet of key frames (no ffmpeg)
  music.mjs                        synthesised royalty-free ambient bed
  music.mp3                        the supplied bed every video actually uses
  shared.css / shared.js           the chrome and the timeline the series shares
  template.html                    recap  ─┐
  template-rotation.html           rotation │ each self-contained,
  template-setpieces.html          setpieces│ animated, 1080×1080
  template-oop.html                oop      │
  template-lean.html               lean     │
  template-chips.html              chips   ─┘
  out/{name}.mp4                   the rendered video
```

`shared.css` and `shared.js` hold the parts that must look and move
identically across the series — the brand chrome, the easing, the staggered
reveal and the deterministic `seek(t)` contract `render.mjs` drives. The
original recap template keeps its own inline copy: it is the proven,
already-shipping one and was deliberately left untouched.

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
