# Feature Video Plan: Gameweek Edge (square, social)

## What this is
A 24.8 second square feature showcase for social, built to be understood with the sound off. It is the companion to `brag-output/brag.mp4`, which is the landscape sales film. That one argues a position; this one shows the product working.

## The angle
Lead with the proof, then show four tools doing their job.

Most FPL tools open by claiming to be smart. Gameweek Edge can open by proving it, because the model is graded in public: **1,000 projections written down before their deadlines and graded against real results, mean absolute error 1.9 points**, over the first four gameweeks of 2026/27. No competitor can open that way, so the video does.

After that, four cards. Each one holds real numbers pulled from the app's own MCP server on 20 September 2026, not invented examples.

## Format: square — 1080x1080
Chosen for reach across X, Reddit, LinkedIn and Instagram from one file. It is never full-screen anywhere, which is the trade, but it is never letterboxed either.

## Duration: 24.77 seconds, six beats
## Tone
- Preset: `app-store`
- Creative direction: a control panel demonstrating itself, calmly
- Interpretation: one feature per card, consistent card chrome, quick 0.45 to 0.6 second reveals and a light SFX layer on every card. Faster than the sales film because a feed scrolls, but no louder, because `BRAND.md` says we give an edge and do not hype.

## Data provenance
Every figure on screen is real and dated. Pulled 20 September 2026 from the Gameweek Edge MCP server, which reads the live app:

| On screen | Source | Note |
|---|---|---|
| 1,000 projections, 4 gameweeks, MAE 1.902 | `fpl_model_record` | Rounded to 1.9 on screen |
| Gvardiol 8.3 xP, 8% haul | `fpl_captain_options` | Haul is the chance of 10 or more points |
| Haaland 8.1 xP, 27% haul | `fpl_captain_options` | Blank probability 4.6%, not shown |
| Bogle 7.9 xP, 23% haul | `fpl_captain_options` | |
| Kostoulas, 95% to rise | `fpl_price_predictions` | 84,442 net transfers behind it |
| Suspension Watch, 0 at risk | `fpl_suspension_watch` | Genuinely zero at gameweek 5 |
| GW points 64, live rank 150k | `landing.html` | The app's own published example figures |
| Percentile · Bonus · DEFCON · Rank threats · Auto-subs | `docs/FEATURES.md` | The five real Live views |

**The Suspension Watch row says zero because it is zero.** Nobody is one yellow from a ban at gameweek 5; the Premier League card ladder has not caught anyone yet. Showing a real zero is better than inventing a name, and a live dashboard reading zero still proves the app is watching.

## Storyboard (as shipped)

Scenes never overlap. Each dissolves its content to nothing on the canvas before the next clip opens.

### Scene 1 — The proof — clip 0.00 to 4.23
Two lines centred at 92px: **"1,000 projections."** in Inter 600, **"Graded in public."** in Inter 400 `--text-2`. Beneath at 46px: **"Mean error: 1.9 points."** with `1.9` in `--hot`, the colour the brand reserves for the key number on a screen.
- `0.30s` — the headline rises 18px over 0.55s
- `1.60s` — the sub-line arrives. **Beat-locked to the 1.60s strong cue.**
- dissolves out from 3.70s

### Scene 2 — Scout AI — clip 4.23 to 10.01
The chat card in the app's own tokens, header carrying the green live dot, the label and the chrome line **"Never invents stats."**
- `4.23s` — the card scales in from 0.972
- `4.75s` — **"Gvardiol or Haaland (C)?"**
- `5.80s` — **"Gvardiol 8.3 to Haaland's 8.1. But Haaland hauls more often."** **Beat-locked to the 5.80s strong cue.** This is the whole product in one sentence: the model has a view on points and a separate view on risk, and it tells you both.
- dissolves out from 9.50s

### Scene 3 — Captaincy Lab — clip 10.01 to 14.22
A four-column table, chrome line **"Every captain, ranked."** Columns: Player · Team · xP · Haul. Numbers in IBM Plex Mono with tabular figures, so they align down the column.
- `10.01s` — card in
- `10.54s / 11.06s / 11.60s` — Gvardiol, Haaland, Bogle arrive one per beat
- dissolves out from 13.70s

The haul column is the point. Two players can sit 0.2 points apart and be completely different bets, and this is the only column that says so.

### Scene 4 — Live — clip 14.22 to 18.44
Chrome line **"One matchday, five views."**
- `14.22s` — card in. **Beat-locked to the 14.22s strong cue.**
- `14.76s` — two tiles: **GW points 64**, **Live rank 150k**
- `15.81s` — the five real view names as chips: Percentile, Bonus, DEFCON, Rank threats, Auto-subs
- dissolves out from 17.91s

### Scene 5 — Before it costs you — clip 18.44 to 22.12
The two tools that save a manager points rather than win them.
- `18.44s` — card in
- `18.96s` — **Price Predictor · Kostoulas, Brighton · 95% to rise**
- `19.49s` — **Suspension Watch · One yellow from a ban · 0 at risk**. **Beat-locked to the 19.49s strong cue.**
- dissolves out from 21.59s

### Scene 6 — Lockup — clip 22.12 to 24.76
The real mark with a green glow that breathes on the music, the wordmark, the tagline **"FPL, with an edge."**, then **"Free to start. Ad-free."**
- `22.12s` — the lockup arrives as one unit. **Beat-locked to the 22.12s strong cue.**
- `22.12s` — the disclaimer fades in at the base and holds to the end
- `23.17s` — **gameweekedge.co.uk** in `--green`
- `23.56s` — the music begins its 1.2 second fade to silence

## Audio
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`, warm and business-y, 114.84 BPM. The app-store pick rather than the sales film's vol-12, because feature cards want a pulse.
- Level 0.32 from frame 0, fading to zero from 23.56s. Measured at -29.7 dB over the final 0.4 seconds against -19.2 dB across the video.
- Cue source: the bundled preset at `assets/music/cues/`. **Strong-cue locks: 1.60s, 5.80s, 14.22s, 19.49s and 22.12s.** Every scene boundary and every card reveal sits on the beat grid.
- SFX: a consistent light layer, one soft `interface/drop` per feature card at 0.65 and one `interface/bong_001` on the lockup at 0.70. This is the app-store posture: present on every card rather than saved for three moments.
- Audio-reactive: subtle. The Scout card's live dot breathes on bass, the logo glow on RMS. No waveform, no equaliser, no pulsing type.

## Readability check (every line clears the floor)

Settled hold runs from the end of a line's entrance to the moment its scene starts dissolving, so each figure is conservative.

| Text | Words | Floor | Settled hold | Pass |
|---|---|---|---|---|
| "1,000 projections. Graded in public." | 5 | 1.5s | 0.85 to 3.70 = 2.85s | yes |
| "Mean error: 1.9 points." | 4 | 1.2s | 2.10 to 3.70 = 1.60s | yes |
| "Never invents stats." (card chrome) | 3 | 0.9s | 4.83 to 9.50 = 4.67s | yes |
| "Gvardiol or Haaland (C)?" | 4 | 1.2s | 5.20 to 9.50 = 4.30s | yes |
| "Gvardiol 8.3 to Haaland's 8.1. But Haaland hauls more often." | 10 | 3.0s | 6.30 to 9.50 = 3.20s | yes |
| Table rows (scanned, 4 tokens each) | — | 0.8s | 12.00 to 13.70 = 1.70s | yes |
| "One matchday, five views." (chrome) | 4 | 1.2s | 14.82 to 17.91 = 3.09s | yes |
| Live tiles (64, 150k) | — | 0.8s | 15.26 to 17.91 = 2.65s | yes |
| Live chips (five labels) | — | 1.5s | 16.26 to 17.91 = 1.65s | yes |
| "Kostoulas, Brighton · 95% to rise" | — | 1.5s | 19.41 to 21.59 = 2.18s | yes |
| "One yellow from a ban · 0 at risk" | — | 1.5s | 19.94 to 21.59 = 1.65s | yes |
| "FPL, with an edge." | 4 | 1.2s | 22.74 to 24.76 = 2.02s | yes |
| "Free to start. Ad-free." | 4 | 1.2s | 22.74 to 24.76 = 2.02s | yes |
| "gameweekedge.co.uk" | 1 | 0.8s | 23.62 to 24.76 = 1.14s | yes |

## Brand compliance gate (BRAND.md)
- No em dash in any visible copy. Checked.
- British English throughout. Checked.
- "FPL" and "Fantasy Premier League" descriptive only, never in the product name. Checked.
- The disclaimer holds for 2.6 seconds on the outro. Checked.
- Green is the single accent. `--hot` appears once, on `1.9` in scene 1, which is that screen's key number (§6).
- Every number in IBM Plex Mono with tabular figures. Checked.
- Depth from a 1px border, never a shadow. 6px radii on cards, pills stay round. Checked.
- Banned vocabulary absent: guaranteed, nailed on, tipster, anything gambling-adjacent. Checked.
- Every player named is in the current player universe: Gvardiol, Haaland, Bogle and Kostoulas all came from live tool calls today.

## Gate results
- `hyperframes check`: lint 0 errors, runtime 0 errors, layout 0 issues across 9 samples, motion 0 errors, contrast **40/40 pass WCAG AA**.
- Six advisory `nested_structure_needs_subcomposition` warnings remain. They ask for the root to be assembled only from sub-composition files, which is a Studio timeline-ergonomics preference, not a rendering fault. Splitting six scenes into six files would also split the audio-reactive sampling, which a sub-composition timeline cannot drive on host-root elements. Removing the wrapper divs was tried and made it worse: the warning simply moved to the next nested element and the layout audit went red. Left as is deliberately.
- Render: 1080x1080, 30fps, 743 frames, H.264 plus AAC, 24.77s.
- Poster: pulled at 2.8s (the proof card, fully settled) and baked as frame 0, so every platform's thumbnail grabber lands on a frame that states the claim on its own.

## Shelf life
Scenes 2, 3 and 5 carry live gameweek numbers, so they date. The captain projections were for gameweek 5 and the price call was for that night. Re-render before a campaign, or ask for a version with the figures removed. Scene 1's model record only improves with time, and scenes 4 and 6 do not date at all.
