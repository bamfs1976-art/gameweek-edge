> ⚠️ **Superseded — do not post from this file.**
> It plans a seventeen-day run-in from 5 Aug, and that window has passed. The
> live pack is **`CONTENT_PACK_16-21_AUG.md`**: six days to the deadline, one
> post a day, every caption copy-paste with nothing to fill in.
> Kept for the asset list in §2 and the two evergreen posts that were never
> date-bound — the DefCon explainer and the "how the model grades itself" trust
> post.

# Gameweek Edge — content pack

### Wed 5 Aug → GW1 deadline (Fri 21 Aug, early evening) · **X + Bluesky, one pack**

Supersedes the three separate packs (`contentpack20260804`, `contentpackaugtogw1`,
`contentpackblueskyaugtogw1`). One idea per slot, written twice — an X version
and a Bluesky version — so the two feeds can never drift apart. The GW1 weekend
itself has its own run-of-show: **`GW1_WEEKEND_PLAN.md`**, which picks up from
the moment the deadline passes on the 21st.

---

## 0. Before you post anything — three setup jobs

| # | Job | Why it blocks | Done |
|---|---|---|---|
| 1 | ~~Render the DefCon explainer card.~~ **Done** — `assets/social/gwe-defcon-explainer.png`, built by `npm run social` from `scripts/social/defcon-explainer.html`. | Post 1 (Wed 5 Aug) needed it. | ☑ |
| 2 | **Batch-render the Social Studio cards** listed in §2 and drop them in `assets/social/`. Must be done **in the app, signed in as owner** — the Studio draws from the live FPL API, so these cannot be generated from the repo. | Seven of the fourteen posts attach one. | ☐ |
| 3 | **Bio + pin, both platforms.** Unofficial-status line in the bio (not on every post); pin the Standard vs The Edge post once it's up on the 14th. | Keeps individual posts clean and legally covered. | ☐ |

---

## 1. What changed from the old packs

**Social Studio replaces the screenshot-and-brackets workflow.** The Studio area
renders share-ready 1080×1350 PNGs straight from the live model, and it rebuilds
from fresh data every time the panel opens — which is exactly what you want in
the run-up to GW1, when prices move daily. So most posts below say *render card
X* rather than *screenshot panel Y and fill in `[brackets]`*. The numbers on the
card are then, by construction, the numbers in the product.

Where no card exists for the idea, it's still a phone screenshot with
`[brackets]` — filled from the app, never invented.

**The pack starts Wed 5 Aug**, not 1 Aug. The old three-week arc assumed a 1 Aug
launch that has already passed; this is a **seventeen-day run-in**, and the arc
is now *teach → prove → sharpen → convert*:

| | Wed 5 – Fri 14 Aug — *teach & prove* | Sat 15 – Thu 20 Aug — *sharpen* | Fri 21 Aug — *convert* |
|---|---|---|---|
| **Job** | Give away real analysis; show the model grades itself | Turn analysis into a concrete GW1 squad | Highest-intent moment of the year |
| **Posts** | 7 | 5 | 2 |
| **The Edge push** | One (Fri 14, after a week of free value) | — | One, in the deadline post |

**Four ideas are new**, drawn from panels the earlier packs never used: the
**Chip plan** (GW1–19), the **Pre-season Draft**, the **Set Piece Register**
(*who takes what*), and **DefCon by budget**. These are the posts nobody else in
the FPL feed can make, because they need a model behind them.

**Suspension watch stays skipped** — no cards until matches are played. It
switches on during GW1 weekend; see the weekend plan.

---

## 2. Assets to render (one sitting, Social Studio → `assets/social/`)

| Card | Studio preset | Used by |
|---|---|---|
| `gwe-defcon-explainer.png` | *(already in repo — `npm run social`)* | Post 1 |
| `gwe-underpriced.png` | **Underpriced** | Post 2 |
| `gwe-chip-plan.png` | **Chip plan** | Post 3 |
| `gwe-fixture-runs.png` | **Best fixture runs** | Post 6 |
| `gwe-who-takes-what.png` | **Who takes what** | Post 8 |
| `gwe-data-xi.png` | **The Data XI** | Post 9 ⭐ |
| `gwe-best-captains.png` | **Best captains** | Post 11 |
| `gwe-defcon-budget.png` | **DefCon by budget** | Post 12 |
| `gwe-standard-vs-edge.png` | *(already in repo — `npm run social`)* | Post 7 |

Two posts carry a **phone screenshot** instead (no card exists): Post 5 (Model
Performance strip) and Post 10 (Price Predictor). Three carry no image at all by
design — Posts 4, 8b and 13.

---

## 3. Platform rules, side by side

| | **X** | **Bluesky** |
|---|---|---|
| Length | Comfortable; still keep it scannable | **300 chars hard.** Every version below is counted and fits |
| Longer ideas | Fine in one post | Run as a **thread** (post + replies) — native, reads well |
| Alt text | Nice to have | **Expected.** Every image. Supplied below |
| Discovery | Replies to bigger accounts; the feed is the channel | **Custom feeds + starter packs.** Include `#FPL` to be eligible |
| Hashtags | Sparing, optional | One (`#FPL`), sometimes two |
| Links | Fine | Render as a card, but the URL still eats characters |
| Scheduling | Typefully | Buffer (Typefully is X-only) — **never auto-mirror the X copy** |

**Brand quick-ref** — calm, British English, *"predicted points"* not *"nailed
on"*. Paid tier is **The Edge**, £3.99/mo or £24.99 season. Free tier includes
live rank, Bonus Tracker, Match Centre and GW Debrief. Link:
**gameweekedge.co.uk**. Disclaimer lives in the bio; it goes in a post only
where noted.

---

# PART ONE — Wed 5 Aug → Fri 14 Aug · *teach & prove*

## POST 1 — DefCon explainer *(Wed 5 Aug, 6–8pm)*

Top of funnel. Teaches something, needs no live data, and it's the talking point
of the season. **Attach `gwe-defcon-explainer.png`.**

**Alt text:** "Explainer card — Defensive Contribution points for 2026/27.
Defenders: 10 clearances, blocks, interceptions and tackles for +2. Midfielders
and forwards: 12 of those plus ball recoveries for +2. Capped at 2 points per
match."

**X:**
> Defensive Contribution points are the cheapest edge in FPL — and they're back for 2026/27.
>
> • Defenders: 10 clearances, blocks, interceptions & tackles → +2
> • Mids & forwards: 12 of those, plus ball recoveries → +2
> • Capped at 2 a match, so one threshold is the whole prize.
>
> Which is why a defensive mid can be a near-nailed cheap returner. Gameweek Edge tracks who's banking it, live.
>
> gameweekedge.co.uk

**Bluesky** *(3-post thread, card on post 1)*:
> **1/** Defensive Contribution points are the cheapest edge in FPL — and they're back for 2026/27. How they actually work 👇 #FPL

> **2/** • Defenders: 10 clearances, blocks, interceptions & tackles → +2
> • Mids & forwards: 12 of those + ball recoveries → +2
> • Capped at 2 a match.

> **3/** Which is why a defensive mid can be a near-nailed cheap returner. Gameweek Edge tracks who's banking it, live. gameweekedge.co.uk

---

## POST 2 — Where the value is *(Fri 7 Aug, 6–8pm)*

The Pre-season Draft prices players from last season's rate and projects **xP6**
— points over GW1–6. That's a sharper claim than "points per million" and it's
yours alone. **Attach `gwe-underpriced.png`.**

**Alt text:** "Underpriced card — players the model projects to outscore their
2026/27 price over the first six gameweeks."

**X:**
> Pre-season, and the model already thinks the market has these wrong.
>
> Biggest gaps between projected points over GW1–6 and what you'll pay:
> • [name] — [xP6] at £[x.x]m
> • [name] — [xP6] at £[x.x]m
> • [name] — [xP6] at £[x.x]m
>
> Not tips. Predicted points from a model that gets graded against real results all season — and you can check the grading yourself.
>
> gameweekedge.co.uk

**Bluesky:**
> The model already thinks the market has these wrong. Biggest gaps between projected GW1–6 points and price:
> • [name] — [xP6] at £[x.x]m
> • [name] — [xP6] at £[x.x]m
> • [name] — [xP6] at £[x.x]m
> Predicted points, graded vs real results. Not tips. #FPL
> gameweekedge.co.uk

---

## POST 3 — The chip plan ⭐ *(Sat 8 Aug, late morning)*

**The best post in the first week.** Everyone is picking a squad; almost nobody
has planned their chips, and the app plans all four across GW1–19 off official
FDR, with international breaks read from the calendar rather than hard-coded.
**Attach `gwe-chip-plan.png`.**

**Alt text:** "Chip plan card — recommended gameweeks for Wildcard, Bench Boost,
Triple Captain and Free Hit across gameweeks 1 to 19."

**X:**
> Everyone's picking a squad this week. Almost nobody's planned their chips.
>
> The model plans all four across the first half:
> • Wildcard — [GW]
> • Bench Boost — [GW]
> • Triple Captain — [GW]
> • Free Hit — [GW]
>
> It reads the international breaks off the calendar, discounts an early Bench Boost (your bench isn't worth boosting yet) and holds each chip as late as the case allows.
>
> Your plan, with the reasoning, in the app 👇 gameweekedge.co.uk

**Bluesky** *(2-post thread, card on post 1)*:
> **1/** Everyone's picking a squad this week. Almost nobody's planned their chips. The model plans all four across GW1–19 — and shows why each lands where it does 👇 #FPL

> **2/** • Wildcard — [GW] · Bench Boost — [GW]
> • Triple Captain — [GW] · Free Hit — [GW]
> It holds each as late as the case allows, and marks down an early Bench Boost — your bench isn't worth boosting yet.
> gameweekedge.co.uk

---

## POST 4 — The conversation post *(Sun 9 Aug, ~7pm)* — no image

Cheap, high-engagement, seeds the feed between the two anchors. Reply to
everyone who answers — that's the whole point of it.

**X** *(native poll, 3-day duration)*:
> Pre-season squad check. Where's your money going?
>
> □ Two premium forwards
> □ Premium mid + premium def
> □ Spread it — no player over £9m
> □ Still no idea, ask me on the 20th

**Bluesky** *(no polls — ask it straight)*:
> Pre-season squad check: two premium forwards, a premium mid + premium defender, or spread it with nobody over £9m?
>
> Genuinely curious which way the feed leans before GW1 — reply with your structure and I'll tell you what the model makes of it. #FPL

---

## POST 5 — How the model grades itself *(Tue 11 Aug, 6–8pm)* — **anchor**

The credibility post, and the one thing that separates you from every tipster
account. It lands especially well on Bluesky, where the crowd is sceptical of
hype. **Attach:** phone screenshot of the **MODEL PERFORMANCE** strip on the
Dashboard.

**Alt text:** "Model performance strip on the Gameweek Edge dashboard, showing
backtest RPS of 0.213."

**X:**
> Anyone can post "captain this guy". Almost nobody shows you whether they were right.
>
> Gameweek Edge grades every prediction against the real result and publishes the hit rate — so you can audit the model before you trust a single pick. Backtest RPS 0.213, out in the open, all season.
>
> That's the whole point. Predicted points you can check.
>
> gameweekedge.co.uk

**Bluesky:**
> Anyone can post "captain this guy". Almost nobody shows whether they were right.
>
> Gameweek Edge grades every prediction against the real result and publishes the hit rate. Backtest RPS 0.213, in the open.
>
> Predicted points you can audit. #FPL
> gameweekedge.co.uk

---

## POST 6 — The opening fixtures *(Thu 13 Aug, 6–8pm)*

**Attach `gwe-fixture-runs.png`.**

**Alt text:** "Best fixture runs card — clubs ranked by fixture difficulty over
the opening six gameweeks."

**X:**
> The fixtures are out, and the model's read of the opening six is not the one the eye test gives you.
>
> Kindest runs (GW1–6):
> • [club] — [summary]
> • [club] — [summary]
> Hardest to captain into early: [club].
>
> Difficulty here comes from fitted win odds and expected goals, not last season's table. Plan your first two transfers before everyone else does 👇
>
> gameweekedge.co.uk

**Bluesky:**
> The model's read of the opening six isn't the one the eye test gives you.
>
> Kindest runs (GW1–6):
> • [club] — [summary]
> • [club] — [summary]
> Hardest to captain into early: [club].
>
> Difficulty from fitted win odds, not last season's table. #FPL
> gameweekedge.co.uk

---

## POST 7 — Standard vs The Edge *(Fri 14 Aug, 6–8pm)* — **pin this**

Placed after nine days of free value, so it reads as a payoff rather than a
pitch. **Attach `gwe-standard-vs-edge.png`.** Pin it on both platforms — it's the
answer to "what's the paid bit?" for the rest of the run-in.

**Alt text:** "Comparison table — Standard versus The Edge. Both include
predicted points, Match Centre and live rank, GW Debrief, the price and
suspension model, and differentials. The Edge adds AI Scout, Rival Scout, EO
Tracker and Template Meter, the season and what-if simulators, and DEFCON tools."

**X:**
> Gameweek Edge, two ways:
>
> **Standard** (free, ad-free) — predicted points, Match Centre, live rank, price & suspension model, and a debrief that tells you what your captain actually cost you.
>
> **The Edge** (£3.99/mo · £24.99 season) — how to win your mini-league: AI Scout, Rival Scout, EO Tracker, the simulators.
>
> Standard tells you what to do this week. The Edge tells you how to win your league.
>
> gameweekedge.co.uk
> *Not affiliated with the Premier League or the official Fantasy Premier League game.*

**Bluesky:**
> Gameweek Edge, two ways:
>
> Standard (free, ad-free) — what to do this week.
> The Edge (£3.99) — how to win your league: AI Scout, Rival Scout, EO Tracker, the simulators.
>
> One app, one tap deeper. #FPL
> gameweekedge.co.uk

---

# PART TWO — Sat 15 Aug → Thu 20 Aug · *sharpen*

## POST 8 — Who takes what *(Sat 15 Aug, late morning)*

Penalties, free-kicks and corners, club by club, from the written taker notes in
the **Set Piece Register**. Enormously shareable in the week people finalise a
squad. **Attach `gwe-who-takes-what.png`.**

**Alt text:** "Who takes what card — first-choice penalty, free-kick and corner
takers for every club."

**X:**
> Half the differentials people are agonising over come down to one question: who's on penalties?
>
> First-choice takers, club by club — pens, free-kicks and corners, from written notes rather than last season's guesswork.
>
> A £5.5m midfielder on corners and pens is a different asset to a £5.5m midfielder who isn't 👇
>
> gameweekedge.co.uk

**Bluesky:**
> Half the differentials people agonise over come down to one question: who's on penalties?
>
> First-choice pen, free-kick and corner takers, club by club — from written notes, not last season's guesswork.
>
> A £5.5m mid on set pieces is a different asset. #FPL
> gameweekedge.co.uk

### POST 8b — the reply-bait follow-up *(Sun 16 Aug, ~7pm)* — no image

Post this as a standalone on both platforms. It's the highest-reply post in the
pack and it costs nothing to make.

> Name the one player you're building your GW1 squad around, and I'll tell you what the model projects for them over the opening six — and who it prefers at the same price.
>
> No sales pitch, just the number.

*(On Bluesky, add `#FPL`. Answer every single reply from the app — this is the
post that converts, because you're demonstrating the product one manager at a
time.)*

---

## POST 9 — The Data XI ⭐ *(Mon 17 Aug, 6–8pm)* — **centrepiece**

The most shareable thing you'll post before the season starts: a full £100.0m
squad, highest projected XI, built by the model. Give it the evening to itself
and don't crowd it. **Attach `gwe-data-xi.png`.**

**Alt text:** "The Data XI card — the model's highest-projected starting eleven
for gameweek 1 on a pitch view, inside a £100.0m budget."

**X:**
> This is the XI the model would build for GW1. Full £100.0m squad, no gut feel anywhere in it:
>
> GK: [name]
> DEF: [name], [name], [name]
> MID: [name], [name], [name], [name]
> FWD: [name], [name], [name]
>
> Bench: [name], [name], [name], [name]
>
> Every pick is there because of a projected points number you can open up and interrogate — including the ones you'll disagree with.
>
> gameweekedge.co.uk

**Bluesky** *(2-post thread, card on post 1)*:
> **1/** This is the XI the model would build for GW1 — full £100.0m squad, no gut feel anywhere in it. Every pick opens up to the projection behind it 👇 #FPL
> gameweekedge.co.uk

> **2/** GK: [name]
> DEF: [name], [name], [name]
> MID: [name], [name], [name], [name]
> FWD: [name], [name], [name]
> Bench: [name], [name], [name], [name]

---

## POST 10 — Price watch, before the rush *(Tue 18 Aug, 6–8pm)*

**Attach:** phone screenshot of the **Price Predictor**.

**Alt text:** "Price Predictor showing each player's percentage likelihood of a
price change tonight."

**X:**
> The first price changes of 2026/27 land within days of the season opening, and the early ones are the cheapest points you'll ever make.
>
> Set your watchlist now and you'll get a heads-up the evening a target looks like moving. It's a threshold model with the method shown — a likelihood, not a black box shouting RISER.
>
> Free, ad-free 👇 gameweekedge.co.uk

**Bluesky:**
> First price changes of 2026/27 land within days of kickoff — the early ones are the cheapest points you'll make.
>
> Set a watchlist now, get a heads-up the evening a target looks like moving. A threshold model with the method shown, not a black box. #FPL
> gameweekedge.co.uk

---

## POST 11 — First captaincy call *(Wed 19 Aug, 6–8pm)* — **switches on**

The captaincy post runs 48h before every deadline from here to May. This is the
first one. **Attach `gwe-best-captains.png`.**

**Alt text:** "Best captains card — armband options for gameweek 1 ranked by
predicted points, with fixture and ownership."

**X:**
> First captaincy call of 2026/27. From the Captaincy Lab:
>
> • **Safe** — [name], [xP] vs [fixture]
> • **Balanced** — [name], [xP] vs [fixture]
> • **Differential** — [name], [xP], [own]% owned
>
> The Lab shows you the ceiling and the floor on each, not just the average — because a 6.1 xP with a flat distribution and a 6.1 xP that's boom-or-bust are not the same armband.
>
> Pick with your eyes open 👇 gameweekedge.co.uk

**Bluesky:**
> First captaincy call of 2026/27, from the Captaincy Lab:
> • Safe — [name], [xP]
> • Balanced — [name], [xP]
> • Differential — [name], [xP], [own]%
>
> Ceiling and floor on each, not just the average. Two identical xPs can be very different armbands. #FPL
> gameweekedge.co.uk

---

## POST 12 — DefCon by budget *(Thu 20 Aug, 6–8pm)*

Closes the loop on the season's opening post. Fifteen days after explaining
DefCon, you name the players — the last genuinely useful free thing before the
deadline. **Attach `gwe-defcon-budget.png`.**

**Alt text:** "DefCon by budget card — the best defensive-contribution options at
each price point for gameweek 1."

**X:**
> Two weeks ago I explained Defensive Contribution points. Here are the players.
>
> Best DefCon option at each price point for GW1:
> • £4.5m — [name]
> • £5.0m — [name]
> • £5.5m — [name]
> • £6.0m+ — [name]
>
> +2 a match, capped, from a player who never has to touch the ball in the opposition box. The cheapest floor in the game.
>
> Full board 👇 gameweekedge.co.uk

**Bluesky:**
> Two weeks ago I explained DefCon points. Here are the players — best option at each price for GW1:
> • £4.5m — [name]
> • £5.0m — [name]
> • £5.5m — [name]
> • £6.0m+ — [name]
>
> The cheapest floor in the game. #FPL
> gameweekedge.co.uk

---

# PART THREE — Fri 21 Aug · *deadline day*

## POST 13 — Deadline nudge + The Edge *(Fri 21 Aug, ~1pm)*

Highest-intent moment of the entire run-in. Free value in the body, The Edge as
the payoff. **Post this one live** so you can pin the real deadline time rather
than a scheduled guess. No image — urgency reads better as plain text.

**X:**
> GW1 deadline is tonight — the season opens under the lights. Last checks before you lock in:
>
> ✅ Captain checked against the Lab, ceiling *and* floor
> ✅ Nobody flagged in the price or suspension model
> ✅ Chips planned, not just picked
> ✅ Your rivals' likely captains — and where your differential actually is
>
> The first three are free, for everyone. The fourth is The Edge.
>
> Good luck tonight 👇 gameweekedge.co.uk

**Bluesky:**
> GW1 deadline tonight — the season opens under the lights. Last checks:
> ✅ Captain checked vs the Lab, ceiling and floor
> ✅ Nobody flagged in the price model
> ✅ Chips planned, not just picked
> ✅ Rivals' captains — where's your differential?
>
> Good luck 🟢 gameweekedge.co.uk

**Then hand over to `GW1_WEEKEND_PLAN.md`** — the run-of-show starts at 18:30
that evening.

---

## 4. Calendar at a glance (all times UK)

| Date | Day | # | Post | X format | Bluesky format | Time |
|---|---|---|---|---|---|---|
| **5 Aug** | Wed | 1 | DefCon explainer | single + card | thread ×3 + card | 6–8pm |
| **7 Aug** | Fri | 2 | Where the value is | single + card | single + card | 6–8pm |
| **8 Aug** | Sat | 3 | The chip plan ⭐ | single + card | thread ×2 + card | late morning |
| **9 Aug** | Sun | 4 | Conversation post | poll | single | ~7pm |
| **11 Aug** | Tue | 5 | Model grades itself ⚓ | single + shot | single | 6–8pm |
| **13 Aug** | Thu | 6 | Opening fixtures | single + card | single + card | 6–8pm |
| **14 Aug** | Fri | 7 | Standard vs The Edge 📌 | single + card | single + card | 6–8pm |
| **15 Aug** | Sat | 8 | Who takes what | single + card | single + card | late morning |
| **16 Aug** | Sun | 8b | Reply-bait follow-up | single | single | ~7pm |
| **17 Aug** | Mon | 9 | The Data XI ⭐ | single + card | thread ×2 + card | 6–8pm |
| **18 Aug** | Tue | 10 | Price watch | single + shot | single + shot | 6–8pm |
| **19 Aug** | Wed | 11 | Captaincy (switches on) | single + card | single + card | 6–8pm |
| **20 Aug** | Thu | 12 | DefCon by budget | single + card | single + card | 6–8pm |
| **21 Aug** | Fri | 13 | Deadline + The Edge | single, **live** | single, **live** | ~1pm |

⭐ shareable anchor · ⚓ credibility anchor · 📌 pin it

**Fourteen posts in seventeen days.** Everything except Post 13 can be scheduled
in advance — Typefully for X, Buffer for Bluesky — but the `[bracket]` fills need
doing on the morning of each post, because the model moves.

⚠️ **Re-count the Bluesky posts after filling.** Every version above is written
to fit 300 characters *as drafted*, but a `[name]` bracket is six characters and
a real name can be fifteen. Posts 2, 6, 9 and 11 are the tight ones. If a filled
post breaks 300, cut the last sentence of the body, never the link.

---

## 5. Working the two feeds

**Shared discipline**
- **Lead free, land paid.** Twelve of the fourteen posts give something away.
  The two Edge posts (7, 13) sit where intent is highest, and never before you've
  earned it.
- **Reply, don't broadcast.** Two or three genuine replies a day to bigger FPL
  accounts, always with a real number or a card. Never a cold "check my app".
- **Don't crowd the anchors.** Posts 3, 5 and 9 carry the pack. Give each the
  day.
- **Never invent a player, price or projection.** Every `[bracket]` gets filled
  from the app on the morning of the post. If the app can't produce it, cut the
  line.

**X specifically**
- The poll (Post 4) is the one native format worth using; three-day duration so
  it's still live when Post 5 lands.
- Quote-post your own Data XI (Post 9) on the 20th with one line — *"still the
  model's XI, two price changes later"* — if it's held up. Free second bite.

**Bluesky specifically** — these compound, do them once, early:
1. **Get into the FPL custom feeds.** Search feeds for "FPL" and
   "Fantasy Premier League", pin the active ones. Most surface any post
   containing `#FPL` — that tag is your distribution, not an algorithm.
2. **Get on a starter pack**, then build your own — *"FPL tools & analysis
   2026/27"* — and include yourself. They circulate every August, which is now.
3. **Alt text every image.** It's an accessibility norm here and images without
   it are muted by a lot of people's moderation settings. Every alt string is
   written out above; use them verbatim.
4. **Post native.** Never auto-mirror the X copy. The tightened ≤300-char
   versions above exist for a reason.
5. **Pin Post 7** once it's up.

---

*After the deadline: `GW1_WEEKEND_PLAN.md` takes over. From GW2 the pack goes
weekly and live — suspension watch returns, price watch and the model-vs-results
ledger become real numbers, and the captaincy post runs 48h before every
deadline.*
