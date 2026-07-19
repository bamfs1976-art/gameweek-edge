# Your launch checklist — what, how, when

Everything on this list is yours; everything else (assets, copy, weekly
content packs, monitoring, fixes) is handled. Dates assume the 2026/27
season starts the weekend of 15–16 August.

> ✅ **Done (18 July): transactional email is live.** Resend is verified
> for `gameweekedge.co.uk` (DKIM + SPF + MX + DMARC in Netlify DNS) and
> wired into Supabase as custom SMTP, sender `noreply@gameweekedge.co.uk`.
> Signups, confirmations and password resets now send real mail — no more
> "quota exceeded". Free tier is 100 emails/day (3,000/month); upgrade
> Resend if a launch spike exceeds that. The `re_…` API key lives only in
> Supabase's SMTP field.

---

## This weekend (Fri 18 – Sun 20 July) — ~90 minutes total

**1. Switch on the keys (~45 min).** Follow `LAUNCH.md` top to bottom:
   - Anthropic: console.anthropic.com → API keys → create key, add a
     little billing credit.
   - Stripe: create the two products (Pro Monthly £3.99 recurring, Season
     Pass £24.99 one-time). The product IDs (`prod_…`) are fine — the app
     accepts them directly. Copy the secret key. Add the webhook
     (`https://gameweekedge.co.uk/api/stripe-webhook`, three events
     listed in LAUNCH.md step 4b), copy the signing secret.
   - Supabase: project settings → API → copy the `service_role` key. Then
     Authentication → URL Configuration → set the site URL.
   - Paste everything into Netlify → Site configuration → Environment
     variables (the full variable list is in LAUNCH.md step 4a; use the
     fresh VAPID keys I've generated for you — file delivered separately,
     delete it after pasting).
   - Netlify → Deploys → **Trigger deploy** (env changes need a redeploy).

**2. Phone QA (~20 min).** Work down `QA_CHECKLIST.md`: add to home
   screen, link your team, buy Pro with Stripe test card 4242 4242 4242
   4242, enable push, ask the Scout a question. Tell me anything that
   misbehaves — I fix, you re-test.

**3. Set up the X profile (10 min).** Create/claim **@gameweekedge**,
   paste the bio from `MARKETING.md` §5, upload the profile picture
   (`assets/social/gwe-profile-400.png`) and the header banner
   (`assets/social/gwe-banner-1500x500.png`) — both already delivered
   in chat too.

**3b. Delete the env-values file (1 min).** Once every value from the
   `gwe-env-values-v2.txt` sheet is pasted into Netlify, delete the file
   anywhere you saved it. The VAPID private key must exist only in
   Netlify.

**3c. BAProTips housekeeping (10 min, any time this week).** The old
   app is replaced by Bookings Desk: in Netlify, disable/delete the old
   BAProTips site (or at least any scheduled functions on it); archive
   the GitHub repo (Settings → Archive); and if an Anthropic key was
   ever pasted into that app, delete that key in the Anthropic console.

**4. Start warming your Reddit account (5 min/day, from today).** Just
   comment normally in r/FantasyPL threads once a day. If your account is
   brand new this matters a lot; if it's aged with karma, one comment
   every couple of days is enough.

**5. Message the r/FantasyPL mods (5 min).** Go to
   reddit.com/message/compose?to=/r/FantasyPL and send the mod message —
   ready to paste in `MARKETING.md` Appendix A. Post nothing until they
   reply.

---

## Next week (Mon 21 – Fri 25 July) — soft launch, ~1 hour

**6. Post the X launch thread (15 min).** Copy in `MARKETING.md` §5, six
   tweets, attach the framed screenshots from the asset pack (tweet 2 =
   Match Centre, 3 = Debrief, 4 = Price/Suspension). Pin the first tweet.
   Best time: Tue–Thu, 6–8pm UK.

**7. Join 3–4 FPL Discords (20 min).** Search "FPL Discord" — the big
   community servers plus one or two smaller ones. Be a normal member
   first; share the app only where a tools/self-promo channel invites it.

**8. Send the app to your mini-league (10 min).** Use the `mates` short
   link I've created. Ask them for one thing each: what confused you?
   Forward answers to me verbatim.

---

## Week of 28 July — the Reddit launch, ~1 hour + replies

**9. Post to r/FantasyPL** exactly as the mods approved (post copy:
   `MARKETING.md` §5; use the `reddit` short link, in a comment if rules
   require). Tue–Thu, 6–8pm UK. Then **live in the thread for 48 hours**
   — answer everything, using the replies FAQ (`MARKETING.md` Appendix B)
   so you never have to think from scratch. Forward feature asks to me;
   I'll ship the quick ones while the thread is still hot.

---

## Week of 4 August — content ramp, ~30 min/week from here

**10. Start posting the weekly content packs.** Every Monday morning I
    generate the week's posts (price watch, model ledger, suspension
    watch, captaincy) as ready-to-paste image + text. You review, tweak
    if you like, post. That's the whole job now.

**11. Optional: Product Hunt.** If you want it, tell me and I'll prepare
    the full listing; you create the account and hit launch on a
    Tue/Wed/Thu.

---

## GW1 week (~11–16 August) — the spike

**12. Deadline minus 48h:** post the captaincy pick (in that week's pack).
**13. Deadline day:** post the "set your team" reminder + flags.
**14. During matches:** screenshot the live Match Centre bonus race from
    your phone and post it — in-play posts travel furthest.
**15. Monday after GW1:** post your own GW Debrief screenshot with the
    "get yours" line from the pack.

---

## Decisions only you can make (any time before the Reddit post)

- **Custom domain?** ~£10/yr, looks more permanent in launch posts. If
  yes: buy it, add in Netlify → Domain management, tell me the name and
  I'll swap the OG/canonical tags in one commit.
- **Real screenshots:** when your live app has your real team on it, send
  me 6 raw phone screenshots (squad, Match Centre, Debrief, Prices,
  Captaincy, Suspension watch) and I'll re-frame the asset pack with real
  data — always beats staged.

---

## Post-launch backlog (v1.1 ideas — not for launch)

Feature ideas worth building *after* launch, drawn from scouting five
public FPL repos (nickharris88/fpl-history, fredricksoong-ai/fpl-data-store,
vivekfrancis1/fpldilemmas, wwvv97/fpl-report, jguilhermealexandre/fpl-analysis).

> ⚠️ **Licence note:** none of those repos declares a licence, so we can't
> copy their code or processed data — these are idea-only. Any build would
> be original, from the official FPL API or a properly-licensed historical
> dataset (to be verified first).

- **Mystery Player daily game** (small) — Wordle-style "guess the player
  from their stats" puzzle. Cheap, on-brand, and a share/retention hook —
  the strongest *growth* lever of the three. Best candidate to build first
  post-launch, ideally timed for a content push.
- **Historical / career layer** (medium-large) — multi-season player
  timelines, consistency, home/away splits, all-time records, cross-season
  head-to-head. The biggest *product* upgrade and a natural fit for the
  terminal look; gated on sourcing clean historical data legitimately.
- **Wildcard optimiser** (medium) — one-tap "best legal 15 for £100m" xP
  solver with budget/position/club constraints, building on the existing
  draft-template scaffolding.
- **Read, don't lift:** fpldilemmas' projection-system write-up is worth a
  look to sharpen the xP model — reference only.
