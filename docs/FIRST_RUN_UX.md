# First-run UX review — why the app reads as confusing, and what to do

Written 8 Aug 2026, from user feedback that Gameweek Edge is *"too confusing on
first viewing"*. Scope is deliberately narrow: **the first ninety seconds**, for
someone who has never used the app, and in places has never played FPL.
`AUDIT.md` covers the product broadly; this covers the front door only.

---

## The finding, in one line

**The app is not short of onboarding. It is short of a front door.**

It already has a three-step spotlight tour, a glossary panel, jargon tooltips, a
beginner/expert density mode that defaults to beginner, dashboard show/hide
chips, an unlinked-state ribbon and beginner-only explainer lines under the main
cards. That is more first-run scaffolding than most tools in the category ship.

So the instinct — *add a tour, add tooltips* — is already spent, and adding more
of it will not move the feedback. The problem is structural, and it is three
concrete things.

---

## 1. Three things that are broken, not merely suboptimal

### 1.1 `gameweekedge.co.uk` opens the app, not the landing page

`netlify.toml` publishes `www` and has **no rule for `/`**, so the bare domain
serves `index.html` — the 36-panel app, opening on a dense terminal dashboard
with a ticker strip, a Signals feed and a Model XI table.

`landing.html` — the page written to explain the product, with the features,
pricing, FAQ and comparison — is reachable **only at `/welcome`**, and nothing
links to it. Its own nine CTAs all point *into* the app, so it works fine as a
funnel; it just has no traffic.

This matters right now more than it normally would: **every post in the August
content pack links to the bare domain.** The launch as currently written sends
new, possibly FPL-novice managers from X and Bluesky straight into the deep end.
Of everything in this document, this is the single highest-impact fix and the
cheapest — it is a routing rule, not a redesign.

### 1.2 The welcome modal is dead code

`maybeOnboard()` is defined at `index.html:3090` and **never called**. The modal
markup it drives (`index.html:2186`) — *"Link my team"* / *"Look around first"*
— is orphaned in the DOM.

It was switched off on purpose. The comment at `index.html:16619` reads:

> *Terminal shell: no blocking first-run modal — the persistent Link Team CTA in
> the topbar carries onboarding instead.*

That was a defensible call against a blocking modal. But the replacement is a
single button sitting among **seven** topbar controls (search, freshness, CSV
export, refresh, density, help, then the CTA), and CSV export and refresh are
power tools drawing equal visual weight to the primary action on first run. The
onboarding did not move to the topbar so much as evaporate.

### 1.3 The tour explains the furniture, not the job

`maybeTour()` *is* wired (`index.html:4749`) and fires 700ms after the dashboard
renders. Its three steps are **This Week · Action**, **Model XI**, and **Link
your team** — it names the panels rather than answering the question the user
arrived with. And it starts *after* the wall has already landed, so it reads as
a caption on something the user has already decided is too much.

---

## 2. The actual diagnosis

The dashboard is a **status board** — *here is everything we know* — at the
moment a new manager needs a **decision board** — *here is what to do*.

That is the right instrument for the expert this product was built for, and the
terminal styling signals "serious tool for people who already know" very
effectively. That signal is exactly the problem on first contact: it is
addressed to a reader who does not exist yet.

Three consequences worth naming separately, because they need different fixes:

| Symptom | Cause | Fix class |
|---|---|---|
| "I don't know where to start" | Five dashboard panels, no ranked first action | Content hierarchy |
| "I don't know what any of this means" | DefCon, EO, xP, RPS, percentile, template, Signals, The Wire | Language |
| "There's too much of it" | 7 areas, 36 panels, plus tab strips, bottom nav, More sheet and ⌘K — four concurrent navigation systems | Navigation |

---

## 3. Design principles for the fix

1. **One job on screen at a time.** The first screen answers one question:
   *what do I do this week?*
2. **Answer first, evidence on demand.** Lead every card with a plain sentence;
   the number is the proof, not the message. The model's credibility is the
   product, but it is the second thing a new user needs, not the first.
3. **Navigation breadth should scale with the user, not with the feature list.**
   A beginner should see four destinations. The 36 panels stay — they are the
   reason experts stay — but they are not the first impression.
4. **Never show a locked door before the room is worth entering.** Pro locks are
   good practice ("you cannot want what you cannot see") *once someone is
   oriented*. On first run they read as a paywall on a product not yet
   understood.
5. **No jargon on first contact without its expansion inline.** A tooltip only
   helps someone who already suspects they need it.

---

## 4. The proposed design

### 4.1 Fix the front door *(routing — small)*

Send first-time visitors to the landing page; send everyone else to the app.

- Add a `/` rule so the marketing page is the default for a cold visitor.
- Anyone with a linked team (`ge-mid`) or a session goes straight to the app —
  a returning user must never be made to walk through the pitch again.
- Keep every content-pack link on the bare domain; the routing does the work,
  so the posts need no change.

The one judgement call: a cold visitor who *is* an experienced FPL manager may
resent a marketing page. Mitigate with a prominent **"Open the app →"** in the
landing header, which already exists.

### 4.2 First run: three doors, not a dashboard *(medium)*

Replace the dead welcome modal with a full first screen — not a modal over the
wall, which is the worst of both. Three choices, weighted:

```
              Gameweek Edge
   The calm, clear edge for FPL managers

  ┌───────────────────────────────────────┐
  │  Link my FPL team                  →  │   ← primary
  │  Your squad, captain and rank         │
  └───────────────────────────────────────┘
  ┌───────────────────────────────────────┐
  │  Just show me this week's picks    →  │
  │  No sign-up. The model's calls        │
  └───────────────────────────────────────┘
  ┌───────────────────────────────────────┐
  │  I'm new to FPL                    →  │
  │  How the game works, in two minutes   │
  └───────────────────────────────────────┘
```

The third door is the gap in the current product. The **Glossary** is a
reference — it answers *what does this word mean* for someone who already has
the word. A newcomer needs *how does this game work*: what a captain does, what
a transfer costs, what a chip is, what the deadline means. Six short lines and
they can read every other screen.

### 4.3 The beginner dashboard: one question, three answers *(medium)*

In beginner density, the default dashboard becomes:

```
GW1 deadline · Fri 21 Aug, 6:30pm            [ Link my team ]

What should I do this week?

┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ CAPTAIN     │ │ TRANSFER    │ │ CHIP        │
│ <name>      │ │ <out → in>  │ │ Hold        │
│ Best odds   │ │ Frees up    │ │ Nothing     │
│ of a big    │ │ £0.5m and   │ │ worth       │
│ score       │ │ gains 1.2   │ │ playing yet │
│             │ │ points      │ │             │
│ Why? →      │ │ Why? →      │ │ Why? →      │
└─────────────┘ └─────────────┘ └─────────────┘

                                  See the detail →
```

Everything currently on the dashboard stays — Model XI, Differentials, Live
state, Signals — but behind *See the detail*, or on expert density where it
already belongs. The `dashHidden()` mechanism at `index.html:3280` already does
exactly this for Differentials; the change is to extend the default rather than
to build anything new.

### 4.4 Navigation: extend the density toggle to the nav *(medium)*

This is the key move, and it is much smaller than it sounds, because **the mode
system already exists**. `getDensity()` already returns `beginner` by default
until a team is linked, and already drives `.expert-only` / `.beginner-only`.
Today it only filters *content*. Make it filter *navigation* too:

| | Beginner nav (4) | Expert nav (unchanged) |
|---|---|---|
| | **This week** — the three calls, captaincy, transfers | Home |
| | **My team** — squad, debrief | My Team |
| | **Research** — players, fixtures, prices | Live · Players · Planner |
| | **Live** — matchday *(only during a live gameweek)* | Rivals · Match Centre |

Two rules make it work:

- **Hide Live outside a live gameweek.** An area that is empty six days a week
  is pure noise to a newcomer.
- **Hide Pro-locked panels in beginner nav.** They return the moment the user
  switches to expert or links a team — by which point the lock is an
  advertisement rather than a wall.

The toggle already sits in the topbar and in the More sheet, so the escape hatch
is there. Relabel it from **Beginner / Expert** to something that reads as a
promise rather than a judgement — **Simple / Everything** — since nobody likes
clicking a button that calls them a beginner.

### 4.5 Language *(small, high leverage)*

- **Expand every term on first use in beginner density.** "DefCon" →
  "Defensive points (DefCon)". "xP" → "predicted points". "EO" → "effective
  ownership". The `.jargon` tooltip stays for the second use onward.
- **Rename the two panels whose names describe themselves to nobody**: *Signals*
  and *The Wire*. Both are good names for a reader who already knows the
  product. Consider "What's changed" and "Briefings".
- **Keep "predicted points" everywhere and never "nailed on"** — already the
  house rule in `BRAND.md`, and it is the right one.

### 4.6 Buttons *(small)*

- On first run, hide **CSV export** and **refresh** from the topbar. Both are
  expert tools; both currently compete with the only button that matters.
- **One primary green CTA visible at a time.** Right now the Link Team CTA, the
  unlinked ribbon's *Link team* link and any panel-level *Link your team*
  state box can all be on screen together, which reads as nagging rather than
  as one clear next step.
- Give every "Why? →" a consistent affordance. The explain-this-pick drawer
  already exists and is the single best beginner feature in the app — it is
  under-used because it is under-signposted.

---

## 5. What to do first

Ordered by impact ÷ effort. The first two are bug fixes and could ship today.

| # | Change | Effort | Why it's first |
|---|---|---|---|
| ~~1~~ | ~~Route `/` to the landing page for cold visitors~~ — **done**, see §5.1 | XS | Every launch link currently opens the deep end. Nothing else matters until this is true |
| ~~2~~ | ~~Delete or revive `maybeOnboard()`~~ — **done**, deleted | XS | Dead code that reads as an intentional feature. Decide which, don't leave it |
| ~~3~~ | ~~Trim the beginner dashboard to the three calls~~ — **done** | S | Turns a status board into a decision board on the one screen everyone sees |
| ~~4~~ | ~~Hide CSV/refresh on first run; one CTA at a time~~ — **done** | S | Removes the two loudest distractions from the primary action |
| ~~5~~ | ~~Expand jargon on first use in beginner density~~ — **done** | S | Fixes "I don't know what this means" without another tooltip |
| ~~6~~ | ~~Extend density to the nav~~ — **done**, 5 areas / 12 panels | M | The big structural win, reusing a mechanism that already exists |
| ~~7~~ | ~~The "I'm new to FPL" explainer~~ — **done**, `#fplbasics` | M | The genuinely missing content, not just a rearrangement |
| ~~8~~ | ~~Rewrite the tour around the job, not the furniture~~ — **done** | M | Only worth doing after 3 and 6, or it captions the wrong thing |

### 5.2 What shipped for 3–8

**The toggle is now called Simple / Everything**, not Beginner / Expert. Nobody
enjoys clicking a button that calls them a beginner. The stored values are
unchanged (`beginner` / `expert`), so nothing else had to move.

**Simple is now a navigation filter as well as a detail filter** — the single
biggest change, and it reuses the mechanism that was already there rather than
inventing a second one. `SIMPLE_PANELS` lists twelve panels across five areas
(Home, My Team, Players, Planner, Live); Rivals, Match Centre and every
Pro-locked panel drop out of the nav until the user asks for Everything.

The rule that makes it safe: **this filters navigation only.** `openPanel` still
uses `canSeePanel`, so every deep link, bookmark, push notification and command
palette result reaches its panel exactly as before — a hidden panel is unlisted,
never unreachable. And if you arrive on one from outside, the area tab strip
falls back to the full list so you can still move sideways rather than being
stranded. `dev/test-simplenav.mjs` guards both.

**The dashboard opens on one card.** `dashHidden()` defaults simple mode to
hiding Model XI, Differentials, Live state and Signals, leaving the "this week ·
action" card — the captain, the transfer and the chip. A "Show everything +"
chip reveals the rest in one tap and remembers the choice.

**Terminal furniture waits for Everything.** CSV export and refresh leave the
top bar; so do the market and fitness counters and the ⌘K chip in the ticker
(the gameweek and the deadline stay — they are the two facts a new manager
actually needs). On the dashboard the metrics strip and the `DATA / SRC` line go
too: both restate what the action card and the "graded in public" strip already
say, and the strip's Model XI figure pointed at a panel simple mode no longer
shows.

**Jargon expands on first use.** `jt()` now appends a terse gloss the first time
a term appears in a render — *xP (predicted points)*, *EO (effective
ownership)* — with the full definition still in the tooltip. Once per panel
render, not once per session: a term explained three panels ago is not explained
on the page you are reading.

**`#fplbasics` explains the game, not the app.** Eight cards — the squad, the
bench, scoring, the captain, transfers and the −4, chips, the deadline, DefCon —
then what the app does with them. Entirely static, so it renders before a single
request lands, which matters because the person reading it is the least likely
to wait. Signposted from the simple dashboard, the tour and the glossary.

**The tour answers the question people arrive with:** your three calls → make it
yours → where everything else lives. The old middle step pointed at Model XI,
which simple mode no longer shows on arrival.

**Not done, deliberately:** hiding the Live area outside a live gameweek. The
signal (`window._gwLive`) is set after the nav is built, and a nav item that
appears a second later is worse than one that is always there. It needs the
gameweek state known before first paint.

### 5.1 What shipped for 1 and 2

**The front door** is a gate at the top of `<head>` in `index.html`, ahead of
the stylesheet, so it redirects without painting. Netlify cannot make this call
— whether someone has been here before lives in localStorage, not in the
request — so it has to be client-side, and it has to be early.

It sends a visitor to `/welcome` only when *every* one of these holds: the URL
is the bare root, there is no `#hash` and no `?panel=` / `?upgrade=` / `?app=`,
this is not an installed PWA or the native shell, and localStorage carries no
trace of a previous visit (`ge-visited`, `ge-mid`, `ge-tier`, the retired
`ge-onboarded`, or a Supabase auth token). Otherwise it marks the device seen
and gets out of the way. `utm_*` is deliberately *not* treated as intent, so a
tagged link from the content pack still gets the pitch.

**Shown once, ever.** `landing.html` sets `ge-visited` on load, which does two
jobs: it stops the trip back into the app bouncing to the pitch again — every
landing CTA points at `/` — and it keeps the promise that a returning manager
never sees the pitch twice, even if they never clicked through the first time.

**Two failure modes are guarded explicitly**, both covered by
`dev/test-frontdoor.mjs`:

- *Blocked storage fails open.* In private mode the landing page cannot record
  the visit, so a gate that failed closed would bounce forever with no escape.
  It bails into the app instead: the cost is one confusing first screen, not a
  lost product.
- *The Stripe return never hits the pitch.* Answering a completed payment with a
  marketing page would be the worst moment in the funnel to get this wrong.

**The onboarding modal is gone** — function, markup, CSS, listeners and the
`ge-onboarded` key. The landing page now does that job properly, so reviving a
modal that duplicates it would have been the wrong half of the decision.

---

## 6. How we'll know it worked

The app already has an owner-only **Analytics** panel, so this is instrumentable
rather than a matter of opinion. Before changing anything, capture a baseline
for:

- **Link rate** — share of first sessions that link a team. The single number
  that matters; everything else is a proxy for it.
- **Time to first panel change** — how long before a new visitor navigates
  anywhere. Long means paralysed, not engaged.
- **Bounce from the first screen**, split by referrer, so the social traffic
  from the August pack can be read separately from direct.
- **Density switches to expert** — a beginner who reaches for "Everything" is a
  success, not a failure. If nobody ever switches, the beginner view is too
  thin.

One caution on reading these: the fixes above will likely make *some* numbers
look worse before better. Routing cold traffic to the landing page will cut app
sessions and raise their quality. Judge on link rate, not on sessions.

---

## 7. Open questions for the owner

1. **Is the terminal aesthetic negotiable on the first screen only?** The
   proposal keeps it everywhere except first run. If it is load-bearing for the
   brand, 4.3 needs rethinking rather than dropping.
2. **How much does the FPL-novice audience actually matter?** Building 4.2's
   third door is only worth it if newcomers are a real segment rather than a
   sympathetic edge case. The referrer split in §6 would answer it.
3. **Does the landing page need rewriting too, or only routing to?** This review
   assumes it is fit for purpose; it has not been audited.
