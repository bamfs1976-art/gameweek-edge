# Fantasy EFL Video Plan (square)

## What this is
A 24.8 second square video for the Fantasy EFL side of Gameweek Edge, aimed at people who play the official Fantasy EFL game. It is a sibling to `brag-output/brag.mp4` (landscape FPL sales film) and `brag-output-features/features.mp4` (square FPL feature showcase), and it deliberately does not look like either of them.

## The unique offering, in one sentence
Everybody builds tools for Fantasy Premier League. This is a real model for a different game, and it can prove that Premier League instincts are actively wrong in it.

## The angle
Lead with the fact that disproves the viewer's assumption, then explain why an FPL tool cannot help them, then show the model working, then show the record.

The hook is the sharpest thing this app owns: **in Fantasy EFL, the forward is the worst-scoring position.** That is measured across 83,698 real appearances, it is the opposite of what every FPL player believes, and it lands in under two seconds. Nothing else in the product says "we actually studied this game" as fast.

## Format: square — 1080x1080
## Duration: 24.77 seconds, five beats
## Tone
- Preset: `app-store`
- Creative direction: an evidence board for a game nobody else covers
- Interpretation: one idea per card, quick reveals, a light sound cue per card. Calm and factual. The contrarian hook does the work, so nothing else needs to raise its voice.

## Visual identity (from `efl/app/assets/efl.css`, `[data-theme="dark"]`)
This is the point of difference with the FPL videos, so it is followed exactly.

- Accent: `--efl` `#7c8cf0` indigo, bright `--efl-bright` `#8f9dff`, soft wash `rgba(124,140,240,.14)`
- **The three-division stripe**, the app's signature, on every card and the outro: Championship `#8f9dff`, League One `#3ecfbb`, League Two `#f5a524`. `efl.css` puts it on `.hero::before` and explains why: three divisions is the fact that makes this game different, so the divisions get the colour.
- Background `#0a0c0f`, surfaces `#111418` / `#161a20` / `#1c2128`, borders `#1f242b` / `#262c34` / `#333a44`
- Text `#e6e8eb`, secondary `#9aa3ad`, tertiary `#8a94a0`
- **Display face is IBM Plex Mono**, not Inter. That is the EFL app's own `--font-display`, and it is the fastest way to make this read as a sibling rather than a recolour. Body copy stays Inter; numbers stay mono with tabular figures.
- 4px radii (`--r-md`), tighter than Gameweek Edge's 6px.
- No competition marks, crests, logos or borrowed palettes, per `efl.css`'s own note and `BRAND.md` §4a.

## Data provenance
Pulled 20 September 2026. Every figure is real.

| On screen | Source |
|---|---|
| Forward is the worst-scoring position, 83,698 appearances | `efl_round_picks` method note, and `README.md` on the verified tariff |
| Round 7 seven, 1-2-2-2, Bowen 82.5 (C), Larin 81.1, Cooper 80.7 | `efl_round_picks`, live |
| Club picks Bradford City and Plymouth Argyle | `efl_round_picks`, live |
| 4 rounds graded | `efl/data/rounds/round-02..05.json`, all carrying a `result` block |
| Top 10% vs field 3.7x | `result.model.topDecileLift` = 3.743 at round 5, across 3,566 players |
| Beaten a random seven every graded round | `result.baselines.percentile` = 0.999, 1, 0.998, 1 across rounds 2 to 5 |
| 72 clubs, 42 rounds | `README.md` health check, 11 August 2026 |
| 3,500+ players | `result.universe.players` = 3,566 at round 5, stated as a floor so it does not go stale |

## Storyboard (as shipped)

Scenes never overlap. Each dissolves before the next clip opens.

### Scene 1 — The fact — clip 0.00 to 4.23
Eyebrow in mono indigo: **FANTASY EFL**. Then at 88px: **"The forward is the worst-scoring position."** Then: **"Measured across 83,698 appearances."** with the figure in `--efl-bright` mono.
- `0.30s` eyebrow · `0.80s` headline · `2.12s` sub. **Beat-locked to the 2.12s strong cue.**
- dissolves from 3.70s

### Scene 2 — A different game — clip 4.23 to 10.01
Card with the stripe. Label **A DIFFERENT GAME**, chrome **"FPL instincts do not transfer."**
- `4.23s` card in. **Beat-locked to the 4.23s strong cue.**
- `5.28s` **NOT IN THIS GAME**: No budget · No prices · No transfers, as muted chips. **Strong cue.**
- `6.34s` **THE RULES**: Seven players · Two clubs · Max two per club, as indigo chips. **Strong cue.**
- dissolves from 9.50s

The two chip rows are the argument: the things an FPL optimiser is built for do not exist here, and the things that do exist are not what it models. That is why this app carries its own three weighted sums rather than borrowing the FPL engine.

### Scene 3 — The model's seven — clip 10.01 to 16.34
Card with the stripe. Label **ROUND 7 · THE MODEL'S SEVEN**, chrome **1-2-2-2** in mono.
- `10.01s` card in. **Strong cue.**
- `10.54s` J. Bowen with the captain badge, 82.5, West Ham United · Championship
- `11.60s` C. Larin, 81.1, Southampton · Championship
- `12.65s` O. Cooper, 80.7, Notts County · League One
- `13.70s` **CLUB PICKS**: Bradford City · Plymouth Argyle
- dissolves from 15.81s

Each row carries a division dot in that division's colour, so the palette is doing work rather than decoration.

### Scene 4 — The record — clip 16.34 to 21.06
Card with the stripe. Label **THE RECORD**, chrome **"Written down before kick-off."**
- `16.34s` card in · `16.86s` two tiles: **ROUNDS GRADED 4** and **TOP 10% VS FIELD 3.7x**
- `17.91s` **"Beaten a random seven every graded round."**
- dissolves from 20.54s. **Beat-locked to the 20.54s strong cue.**

### Scene 5 — Lockup — clip 21.06 to 24.74
The three-division stripe as a horizontal bar that breathes on the music, then **CHAMPIONSHIP · LEAGUE ONE · LEAGUE TWO** in mono indigo, **Fantasy EFL** at 80px, and **from Gameweek Edge**.
- `21.06s` lockup, and the disclaimer fades in at the base
- `22.12s` **72 clubs · 3,500+ players · 42 rounds** in mono
- `23.17s` **gameweekedge.co.uk/fantasy-efl**. **Strong cue.**
- `23.54s` the music begins its 1.2 second fade to silence

## Audio
- Music: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3`, mid-energy and slightly laid back, 114.84 BPM. A different track from both FPL videos on purpose.
- Level 0.32, fading to zero from 23.54s. Measured at -32.6 dB over the final 0.4 seconds against -24.4 dB across the video.
- **Strong-cue locks: 2.12s, 4.23s, 5.28s, 6.34s, 10.01s, 20.54s and 23.17s.** Every scene boundary sits on the beat grid.
- SFX: one soft `interface/drop` per card at 0.65, one `interface/bong_001` on the lockup at 0.70.
- Audio-reactive: the outro's three-division stripe breathes between 0.62 and 1.0 opacity on RMS. Nothing else reacts, and no text ever scales.

## Readability check (every line clears the floor)

| Text | Words | Floor | Settled hold | Pass |
|---|---|---|---|---|
| "Fantasy EFL" (eyebrow) | 2 | 0.8s | 0.75 to 3.70 = 2.95s | yes |
| "The forward is the worst-scoring position." | 6 | 1.8s | 1.35 to 3.70 = 2.35s | yes |
| "Measured across 83,698 appearances." | 4 | 1.2s | 2.62 to 3.70 = 1.08s | at floor |
| "FPL instincts do not transfer." (chrome) | 5 | 1.5s | 4.83 to 9.50 = 4.67s | yes |
| Chip row A (three short chips) | — | 1.5s | 5.78 to 9.50 = 3.72s | yes |
| Chip row B (three short chips) | — | 1.5s | 6.84 to 9.50 = 2.66s | yes |
| Player row 1 (name, rating, club) | — | 1.2s | 10.99 to 15.81 = 4.82s | yes |
| Player row 3 (name, rating, club) | — | 1.2s | 13.10 to 15.81 = 2.71s | yes |
| "Club picks: Bradford City · Plymouth Argyle" | — | 1.5s | 14.15 to 15.81 = 1.66s | yes |
| "Written down before kick-off." (chrome) | 5 | 1.5s | 16.94 to 20.54 = 3.60s | yes |
| Record tiles (4, 3.7x) | — | 0.8s | 17.36 to 20.54 = 3.18s | yes |
| "Beaten a random seven every graded round." | 7 | 2.1s | 18.36 to 20.54 = 2.18s | yes |
| "Championship · League One · League Two" | 5 | 1.5s | 21.68 to 24.74 = 3.06s | yes |
| "Fantasy EFL" + "from Gameweek Edge" | 5 | 1.5s | 21.68 to 24.74 = 3.06s | yes |
| "72 clubs · 3,500+ players · 42 rounds" | — | 1.5s | 22.57 to 24.74 = 2.17s | yes |
| "gameweekedge.co.uk/fantasy-efl" | 1 | 0.8s | 23.62 to 24.74 = 1.12s | yes |

The sub-line in scene 1 sits exactly on its floor. It is a short, number-led line directly under a headline the eye has already settled on, and the 0.53 second dissolve adds readable time on top, so it holds. If it ever reads rushed, take the time from the headline's hold rather than from anywhere else.

## Brand compliance
- No em dash in any visible copy. Checked.
- British English throughout. Checked.
- The disclaimer is the app's own, trimmed to one sentence: *"Independent tool. Not affiliated with, endorsed by or associated with the English Football League or the official Fantasy EFL game."* It holds for 3.1 seconds.
- No EFL, Championship or club marks, logos, crests or fonts. Club names appear as words, used descriptively, exactly as `efl.css` requires.
- Every number in IBM Plex Mono with tabular figures.
- Depth from a 1px border, never a shadow. 4px radii, pills stay round.
- No gambling-adjacent language, no "guaranteed", no "nailed on", no tipster framing.

## One naming point worth a decision
`BRAND.md` §4a says a competition's name never appears in a product name, only descriptively in body copy. The EFL app's own `<title>` follows that: *"Fantasy EFL Picks, Fixtures & Player Form | GameweekEdge"*, where Gameweek Edge is the product and "Fantasy EFL" describes the game covered. The outro mirrors that construction, with **Fantasy EFL** as the section name and **from Gameweek Edge** beneath it.

If you want it fully clean against §4a, the outro should lead with Gameweek Edge and carry "for Fantasy EFL" as the descriptor. That is a one-line change and a re-render.

## Gate results
- `hyperframes check`: lint 0 errors, runtime 0 errors, layout 0 issues across 9 samples, motion 0 errors, contrast **33/33 pass WCAG AA**.
- Five advisory `nested_structure_needs_subcomposition` warnings, the same ones carried by the other two videos and for the same reason: clearing them means splitting the root into per-scene sub-composition files, which is a Studio editing preference rather than a rendering fault, and which would also split the audio-reactive sampling.
- Render: 1080x1080, 30fps, 743 frames, H.264 plus AAC, 24.77s.
- Poster pulled at 3.0s (the hook, fully settled) and baked as frame 0, so the idle thumbnail is the contrarian fact.

## Shelf life
Scene 3 is round 7 and dates within a week. Scene 4 improves as more rounds are graded and should be refreshed to keep the count honest. Scenes 1, 2 and 5 do not date at all, so a re-cut is two card swaps.

## Missing asset
There is no indigo variant of the Gameweek Edge mark in `assets/`, so the outro uses the three-division stripe as its device rather than recolouring the pitch-green tile, which `BRAND.md` §5 forbids. An indigo mark would strengthen the lockup.
