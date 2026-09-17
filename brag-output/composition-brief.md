# Hyperframes Composition Brief: Gameweek Edge

## Objective
Create a short, polished sales video for Gameweek Edge (gameweekedge.co.uk), an ad-free companion app for Fantasy Premier League managers.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080, 30fps
- Duration: 22.95 seconds

## Source Material
- Project root: `/home/user/gameweek-edge`
- Primary files read: `landing.html`, `index.html`, `README.md`, `BRAND.md`, `MARKETING.md`
- Product name: **Gameweek Edge** (never "FPL Edge", never a name containing a competition mark)
- Tagline: *FPL, with an edge.*
- Strongest claim: the three-line ladder from the landing page's comparison section
- Key UI moment to recreate: the **Scout AI** chat exchange from `landing.html`, rebuilt in the app's real dark-surface tokens
- Real asset used: `assets/icon-mark.png` (the pitch-green tile with the white form line and node), copied to `composition/assets/img/gwe-mark.png`

### Copy that must appear verbatim
- "What did your captain cost you?"
- "The official app tells you what happened."
- "Live-rank sites tell you where you are."
- "Gameweek Edge tells you what to do next."
- "Haaland or Salah (C) this week?"
- "Salah edges it: higher predicted points (8.1 vs 7.6) and a softer home fixture."
- "Grounded in your squad. Never invents stats."
- "FPL, with an edge."
- "Free to start. Pro from £3.99 a month."
- "gameweekedge.co.uk"
- "Not affiliated with, endorsed by, or associated with the Premier League or the official Fantasy Premier League game."

## Creative Direction
- Tone preset: `polished`
- Creative direction: a quiet, confident product film for people who take their fantasy team seriously
- Interpretation: four scenes, long settled holds, soft 0.6s dissolves through the canvas, light-to-medium Inter weights, one accent colour. Motion is slow and placed. Nothing winks.
- Angle: proof, not promise. The video states the product's own positioning ladder, then proves it by showing the Scout AI answering a real captaincy question with the model's real predicted points. Every line is the project's own copy.
- Hook: one line alone on the dark terminal canvas, "What did your captain cost you?", with a green rule drawing beneath it.
- Outro: the real mark, the name, the tagline, the price, the domain, and the required disclaimer.

### Hard brand constraints (from `BRAND.md`, non-negotiable)
- **No em dash anywhere in visible copy.** The repo fails its own build on the first one.
- British English throughout.
- "FPL" and "Fantasy Premier League" only descriptively, never inside the product name.
- The disclaimer must appear on this video, because a video is a public surface (§4).
- Banned vocabulary: guaranteed, nailed on, tipster, anything gambling-adjacent, and generic SaaS verbs.
- Green is the **single** accent. `--hot` (`#b6ff3c`) is spent exactly once, on the one key number on screen (§6).
- Depth comes from a 1px border, never a shadow. 4px radii, pills stay round, 8pt spacing grid (§8).
- Every number in IBM Plex Mono with tabular figures (§7).

### Avoid
- Generic SaaS language
- Abstract filler visuals, gradient meshes, glowing blobs
- Any Premier League or competition imagery, marks, or borrowed palette
- Any redesign of the brand away from its own tokens

## Visual Identity
- Background: `#0a0c0f` (`--bg`)
- Surface: `#111418` (`--surface`), secondary surface `#1a2026` (`--surface-2`, the manager's bubble), `rgba(0,210,106,0.12)` (`--green-soft`, the scout's bubble), border `rgba(255,255,255,0.09)`
- Text: `#e8ecf1` (`--text`), secondary `#aab3be` (`--text-2`)
- Accent: `#00d26a` (`--green`)
- Key figure: `#b6ff3c` (`--hot`), used once
- Display + body font: Inter 400/500/600/700, vendored at `assets/fonts/`
- Numeric font: IBM Plex Mono 400/500/600, tabular figures, vendored at `assets/fonts/`
- Visual references: the Scout AI chat card, the app's card chrome, the real logo mark

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract. Scene summary:

1. **The question** — clip 0.00 to 3.87s — "What did your captain cost you?" alone, green rule draws under it.
2. **The ladder** — clip 3.87 to 11.46s — three positioning lines arrive on the beat grid (4.39 / 5.34 / 6.56) and hold together, then a green rule signs the payoff line at 8.74s.
3. **The Scout answers** — clip 11.46 to 18.56s — the Scout AI card with the trust line as header chrome, the question at 12.02s, the grounded answer at 13.11s, `8.1` lifting to `--hot` at 16.38s.
4. **Lockup and the ask** — clip 18.56 to 22.95s — mark, name, tagline, then price at 19.66s, domain at 20.75s, disclaimer holding from 19.66s.

Scenes never overlap: each dissolves its content to nothing on the canvas before the next clip opens, so no two text blocks share a frame.

## Audio
- Audio role: warm low bed with sparse professional accents
- Audio arc: constant low bed from frame 0, three soft cues marking the only three moments that matter, fade to silence under the lockup
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` at `data-volume` 0.30
- Music treatment: no ducking, no beat-chopping. `data-volume` stays at 1 and the timeline carries the level (0.30), tweened to 0 from 21.73s to 22.93s so the last frame settles into quiet.
- Music cue guidance: bundled preset at `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`, tempo 109.96 BPM. **Strong-cue locks: 8.74s (the rule under the payoff line), 13.11s (the Scout answers), 18.56s (the logo lockup) and 19.66s (the price line).** Beat grid for the Scene 2 ladder: 4.39, 5.34, 6.56. Every scene boundary sits on a beat.
- Audio-reactive treatment: subtle. Per-frame data pre-extracted to `assets/music/audio-data.js` (`window.AUDIO_DATA`, 30fps, 16 bands, 690 frames). Drive the green glow behind the logo mark from RMS and the Scout card's border presence from bass. No waveform, no equaliser, no pulsing type. Text scale never reacts.
- Audio-coupled moments:
  - Scene 2 line 3 (6.51s) — the payoff line is the only ladder line with a sound
  - Scene 3 scout answer (13.06s) — soft arrival
  - Scene 4 lockup (18.51s) — one low bell, nothing after it
- SFX selection: `interface/drop_001.ogg`, `interface/drop_002.ogg`, `interface/bong_001.ogg`, all copied to `assets/sfx/interface/`. Volumes 0.45 to 0.60, per the polished restraint rule.
- SFX analysis guidance: `~/.claude/skills/brag/assets/sfx/sfx-analysis.md` — all three picks are low high-frequency risk.
- Restraint rule: no cue lands on top of a line the viewer is still reading. Nothing percussive.

## Hyperframes Instructions
Follow `hyperframes-core` (composition contract and `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (audio-reactive sampling), `hyperframes-keyframes` (seek-safe keyframes) and `hyperframes-cli` (check and render).

Requirements:
- Show the real Scout AI exchange, in the app's own tokens. That scene is the point of the video.
- Every text element must clear the reading floor in `brag-plan.md`'s readability table.
- Stay within 23 seconds.
- `npx hyperframes check` must pass with zero findings before render, contrast included.
- Use only local assets. No network fetches at render time.
