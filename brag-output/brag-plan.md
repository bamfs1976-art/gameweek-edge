# Brag Plan: Gameweek Edge

## What is this app?
Gameweek Edge is an ad-free companion for Fantasy Premier League managers: predicted points from a model that is graded in public, live scoring, price predictions and an AI scout that reads your actual squad and tells you what to do next.

## The angle
This is a sales video, not a dev launch video. The product's own comparison section already contains the sharpest sales argument it will ever have, and it is a three-step ladder:

> The official app tells you what happened. Live-rank sites tell you where you are. Gameweek Edge does both, and tells you what to do next.

The video is that ladder, delivered with restraint, then proved by showing the Scout AI actually answering a real captaincy question with real numbers. The angle is *proof, not promise*. Nothing is claimed that the product does not already claim on its own landing page, and the one scene that matters shows the app doing the thing rather than describing it.

Tone discipline is set by `BRAND.md`: calm, confident, British English, plain sentences, no hype, no em dashes, and the rights-holder disclaimer on every public surface, which includes this video.

## Hook (first 2-3 seconds)
A single line on the dark terminal canvas, in large light-weight Inter:

**"What did your captain cost you?"**

It is a question every FPL manager has asked on a Monday morning, it is the exact promise the product makes on its own landing page (the per-gameweek debrief "that tells you what your captain cost you"), and it costs the viewer nothing to answer in their head. A thin green rule draws under it as it settles.

## Key moments (the middle)
- The three-line positioning ladder arriving one line at a time, the first two in secondary grey, the payoff line in full ink with "Gameweek Edge" picked out in pitch green.
- The Scout AI exchange, rebuilt as the app's own dark surface card and carrying **the model's real gameweek 5 call**, read from `data/record/gw-05.json`: the manager asks "Haaland or Schade (C) this week?", the scout picks the differential over the template on 10.3 predicted points to 10.0, and `10.3` lands in IBM Plex Mono in the `--hot` green the app reserves for the key number on a screen.
- The trust line sitting in the card header as chrome: grounded in your squad, never invents stats. This is the claim that separates the product from a tipster, and it holds for the whole scene rather than competing for reading time.

## Outro / punchline
The real mark, the name, the real tagline *FPL, with an edge.*, then the commercial ask: free to start, Pro from £3.99 a month, and the domain. The disclaimer holds quietly at the base of the frame for the whole scene.

## User flow worth showing
Entry → key action → result, from the landing page's own "How it works":
1. **Entry** — open the app, link your team with a Manager ID.
2. **Key action** — ask the Scout a plain question about your squad ("Haaland or Schade (C) this week?").
3. **Result** — a grounded answer with the model's predicted points behind it, so you know what to do before the deadline. The video uses the real call the model recorded for gameweek 5 on 17 September 2026, 29 hours before the deadline.

Scene 3 is that flow's key action and result, shown in the app's own UI. Entry is compressed into the outro's "free to start", because a sales video should spend its seconds on the payoff, not the onboarding.

## Tone
- Preset: `polished`
- Creative direction: a quiet, confident product film for people who take their fantasy team seriously
- Interpretation: four scenes, long holds, slow crossfades, light-to-medium type weights, one accent colour and nothing else. Motion is slow and settled. The product is not a joke, so nothing in the edit winks. Confidence comes from how little the video needs to say.

## Format: landscape — 1920x1080
## Duration: 23.47 seconds (four scenes, dissolving through the canvas)

## Visual identity (from the project)
- Background: `#0a0c0f` (`--bg`, the terminal canvas and the app's `theme-color`)
- Surface: `#111418` (`--surface`, cards) with a 1px `rgba(255,255,255,0.08)` border, never a shadow
- Accent: `#00d26a` (`--green`, the single accent)
- Key figure: `#b6ff3c` (`--hot`, reserved for THE key number on a screen)
- Text: `#e8ecf1` (`--text`), secondary `#aab3be` (`--text-2`)
- Display font: Inter (400-800), vendored locally from the same Google Fonts the app loads
- Body font: Inter; every number in IBM Plex Mono with tabular figures, per `BRAND.md` §7
- Strongest visual element: the Scout AI chat card from the landing page, rebuilt in the app's real surface tokens, plus the real logo mark from `assets/icon-mark.png`
- Grid: 8pt spacing, 4px radii, pills stay round

## Share copy (draft)
Gameweek Edge is live: predicted points, live scoring and an AI scout that reads your actual squad. The official app tells you what happened, live-rank sites tell you where you are, this tells you what to do next. Free to start at gameweekedge.co.uk.

## Audio direction
- Role: warm, low bed with sparse professional accents
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean, the polished pick)
- Music treatment: starts at 0.0 at volume 0.30, no ducking, fades to silence from 22.26s to 23.46s so the final frame settles into quiet
- Music cue guidance: bundled preset read from `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`, tempo 109.96 BPM. Strong cues locked: **8.74s** (the rule signs off the payoff line), **10.93s** (the Scout card arrives), **12.55s** (the Scout answers) and **18.56s** (the card dissolves into the lockup). Beat grid for the sequential ladder in Scene 2: 4.39, 5.34, 6.56.
- Audio-reactive treatment: subtle. Use music RMS to let the green glow behind the logo mark breathe in the outro, and to give the Scout card a very slight presence lift on bass. No waveform, no equaliser bars, no pulsing type.
- SFX posture: sparse. Three cues in the whole video, all soft, all at 0.5 to 0.65 volume.
- Audio-coupled moments: the ladder lines arriving one by one on the beat grid; the Scout answer landing on the 12.55s strong cue; the logo lockup at 19.10s.
- Restraint rule: no sound may arrive on top of a line the viewer is still reading, and nothing percussive or aggressive. If a cue is not clearly improving the moment, leave it out.

## Storyboard (as shipped)

Scenes do not overlap. Each one dissolves its content to nothing on the canvas before the next clip opens, which keeps the transitions soft without ever putting two blocks of text in the same frame.

### Scene 1 — The question — clip 0.00 to 3.87
Dark terminal canvas, a soft green lift in the lower third and nothing else. **"What did your captain cost you?"** rises 26px and fades in over 0.55s from 0.30s, centred, Inter 400 at 86px in `--text`. A 2px `--green` rule draws left to right beneath it from 1.09s over 0.7s. The scene dissolves out from 3.27s.
Sequential/interaction: none. One line, one rule, one hold.
Audio intent: the music is already playing, low. A held breath.
Audio-coupled idea: none. The scene opens on music alone, which is the more confident move.
Transition mood: soft dissolve → Scene 2

### Scene 2 — The ladder — clip 3.87 to 10.93
Left-aligned stack of three lines at 58px, each rising 18px and fading in over 0.5s. Verbatim from the project's own comparison section:

1. `4.39s` — "The official app tells you what happened." in `--text-2`
2. `5.34s` — "Live-rank sites tell you where you are." in `--text-2`
3. `6.56s` — "Gameweek Edge tells you what to do next." in `--text`, with "Gameweek Edge" in `--green`

All three hold together, so the ladder reads as one argument rather than three flashes. At `8.74s` a 560px green rule draws under the payoff line, signing the claim. The scene dissolves out from 10.37s.
Sequential/interaction: yes, three lines arriving one by one on consecutive beat-grid points.
Audio intent: the argument building. Each line placed, not thrown.
Audio-coupled idea: one `interface/drop_002` at 6.51s on line 3 only. Lines 1 and 2 are silent so the payoff carries the only sound.
Transition mood: soft dissolve → Scene 3

### Scene 3 — The Scout answers — clip 10.93 to 19.10
The product doing its job. A 1420px `--surface` card, 1px border, 6px radius, built in the app's real tokens.

- `10.93s` — the card rises 18px and scales from 0.965 over 0.75s. **Beat-locked to the 10.93s strong cue.** Its header carries the live green dot, the label "Scout AI", and the trust line **"Grounded in your squad. Never invents stats."** as right-aligned chrome, so that claim is on screen for the whole scene rather than competing for reading time later.
- `11.46s` — the manager's bubble, right-aligned on `--surface-2` with the tail corner squared off, exactly as the app's own `.bub.u` rule does: **"Haaland or Schade (C) this week?"**
- `12.55s` — the scout's bubble, left-aligned on `--green-soft`: **"Schade edges it: 10.3 predicted points to 10.0, and Brentford at home. Haaland stays the safer template pick."** Both figures are set in IBM Plex Mono with tabular figures. **Beat-locked to the 12.55s strong cue.** The second sentence matters: the model takes the differential and still tells you what the safe call is, which is the difference between a model and a tipster.
- `16.93s` — `10.3` lifts to `--hot` over 0.4s, once, after the answer has been read. No movement, just the colour the brand reserves for the one key number on a screen.
- The scene dissolves out from 18.56s, beat-locked to that strong cue.

Sequential/interaction: yes, a simulated chat exchange, question then answer, with the key figure lighting up after the answer lands.
Audio intent: the moment the video earns its claim. Calm and precise, not triumphant.
Audio-coupled idea: one `interface/drop_001` at 12.50s as the answer arrives. Nothing on the question, nothing on the colour lift.
Transition mood: soft dissolve → Scene 4

### Scene 4 — Lockup and the ask — clip 19.10 to 23.46
Centred lockup. The real mark from `assets/icon-mark.png` at 148px with a 34px radius and a soft green glow behind it, the wordmark **Gameweek Edge** at 74px Inter 700, and the tagline **"FPL, with an edge."** in `--text-2`, all arriving as one unit at 19.10s.

- `20.19s` — **"Free to start. Pro from £3.99 a month."**, the figure in IBM Plex Mono.
- `20.19s` — the disclaimer fades in at the base of the frame and holds to the end: *"Not affiliated with, endorsed by, or associated with the Premier League or the official Fantasy Premier League game."* Required on every public surface by `BRAND.md` §4.
- `21.28s` — **gameweekedge.co.uk** in `--green` at 38px Inter 600.
- `22.26s` — the music begins its 1.2s fade to silence.

Sequential/interaction: the lockup lands as one unit, then the ask arrives beneath it.
Audio intent: arrival, then quiet.
Audio-coupled idea: one `interface/bong_001` at 19.05s on the lockup. Nothing after it.
Music: fades to silence from 22.26s.

**Music mood for this video:** steady, clean and low, an unobtrusive bed that lets three soft cues do all the punctuation.
**Audio summary:** the bed runs at a constant low level from the first frame, three soft accents mark the only three moments that matter (the payoff line, the scout's answer, the logo), and the track fades out under the lockup so the video ends in quiet rather than mid-bar.

## Readability check (every line clears the floor)

Settled hold is measured from the end of a line's entrance to the moment its scene starts dissolving, so each figure is the conservative one. The dissolve adds roughly another half second of readable time on top.

| Text | Words | Floor | Settled hold | Pass |
|---|---|---|---|---|
| "What did your captain cost you?" | 6 | 1.8s | 0.85 to 3.27 = 2.42s | yes |
| "The official app tells you what happened." | 7 | 2.1s | 4.89 to 10.37 = 5.48s | yes |
| "Live-rank sites tell you where you are." | 7 | 2.1s | 5.84 to 10.37 = 4.53s | yes |
| "Gameweek Edge tells you what to do next." | 8 | 2.4s | 7.06 to 10.37 = 3.31s | yes |
| "Grounded in your squad. Never invents stats." | 7 | 2.1s | 11.68 to 18.56 = 6.88s | yes |
| "Haaland or Schade (C) this week?" | 6 | 1.8s | 11.96 to 18.56 = 6.60s | yes |
| "Schade edges it: 10.3 predicted points to 10.0, and Brentford at home. Haaland stays the safer template pick." | 18 | 5.4s | 13.05 to 18.56 = 5.51s | yes |
| "FPL, with an edge." | 4 | 1.2s | 19.80 to 23.46 = 3.66s | yes |
| "Free to start. Pro from £3.99 a month." | 8 | 2.4s | 20.69 to 23.46 = 2.77s | yes |
| "gameweekedge.co.uk" | 1 | 0.8s | 21.78 to 23.46 = 1.68s | yes |

## Brand compliance gate (from BRAND.md)
- No em dash appears anywhere in the video copy. Checked.
- British English throughout. Checked.
- "FPL" and "Fantasy Premier League" appear only descriptively, never as part of the product name. Checked.
- The disclaimer appears on the outro and holds for 3.3 seconds. Checked.
- Every player named is in the current player universe. Checked against `data/record/gw-05.json` (659 players, recorded 17 September 2026): Haaland and Schade are both in it, Salah is not.
- No competition marks, no borrowed palettes, no starball. Checked.
- Banned words absent: guaranteed, nailed on, tipster, and anything gambling-adjacent. Checked.
- The single accent rule holds: green is the only accent, `--hot` is used once, for the one key number.
- Every number on screen is set in IBM Plex Mono with tabular figures. Checked.
- Depth comes from a 1px border, never a shadow. Checked.

## Gate results
- `hyperframes check`: lint 0/0, runtime 0/0, layout 0 issues across 9 samples, motion 0/0, contrast 16/16 pass WCAG AA.
- Render: 1920x1080, 30fps, 704 frames, H.264 plus AAC, 23.47s.
- Poster: pulled at 17.5s (the Scout card, fully settled, with `10.3` already in `--hot`) and baked as frame 0 so every platform's thumbnail grabber lands on it.
