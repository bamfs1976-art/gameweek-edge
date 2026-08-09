# Gameweek Edge — Launch Guide (do these in order)

Everything is built. These are the only steps left, and they're all configuration — no coding. Budget about an hour. Use `QA_CHECKLIST.md` for the final testing.

The app already runs **without any of this** (free panels work); each step below switches on one more capability.

---

## Step 1 — Confirm the app is live on Netlify
You already connected the repo. Check: Netlify → your site → **Deploys** shows the latest `main` deploy as **Published**. Open the site URL — the app loads. ✅

> Every time I push to `main`, Netlify redeploys automatically.

## Step 2 — Create the accounts you need
1. **Anthropic** (powers all AI features): sign up at console.anthropic.com → **API keys** → create a key. Copy it. (Add a little billing credit.)
2. **Stripe** (payments): create an account at stripe.com. Then:
   - **Products** → add product **"Gameweek Edge Pro — Monthly"**, price **£3.99**, **recurring/monthly** → copy its **Price ID** (`price_…`).
   - Add product **"Gameweek Edge Pro — Season Pass"**, price **£24.99**, **one-time** → copy its **Price ID**.
   - **Developers → API keys** → copy your **Secret key** (`sk_…`).
   - (You'll add the webhook in Step 4b.)

## Step 3 — Gather the values you already have
- **Supabase URL:** `https://knodunjnsxelmpziupwk.supabase.co`
- **Supabase service-role key:** Supabase → your project → **Project settings → API → `service_role`** (secret — copy it).
- **VAPID keys** (for push — generate your own, never commit them):

  > ⚠️ **Security notice:** an earlier version of this file contained a live VAPID
  > private key committed to the repository. **That keypair must be treated as
  > compromised.** Generate a brand-new keypair (`npx web-push generate-vapid-keys`),
  > set the new values in the Netlify environment only, and redeploy. Existing push
  > subscriptions were created against the old key and will stop working — users
  > simply re-enable push from the Alerts panel to re-subscribe. Never paste key
  > values into this file or anywhere else in the repo.

  - `VAPID_PUBLIC_KEY=<set in Netlify env — generate with: npx web-push generate-vapid-keys>`
  - `VAPID_PRIVATE_KEY=<set in Netlify env — generate with: npx web-push generate-vapid-keys>`
  - `VAPID_SUBJECT=mailto:you@yourdomain.com`  ← put a real email you own

## Step 4 — Put everything into Netlify
**a)** Netlify → Site configuration → **Environment variables** → add each of these:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `STRIPE_SECRET_KEY` | your Stripe secret key |
| `STRIPE_PRICE_MONTHLY` | monthly Price ID |
| `STRIPE_PRICE_SEASON` | season Price ID |
| `STRIPE_WEBHOOK_SECRET` | from Step 4b |
| `SUPABASE_URL` | the URL above |
| `SUPABASE_SERVICE_ROLE_KEY` | the service-role key |
| `VAPID_PUBLIC_KEY` | your freshly generated public key |
| `VAPID_PRIVATE_KEY` | your freshly generated private key (never commit it) |
| `VAPID_SUBJECT` | `mailto:` your email |
| `FOOTBALL_DATA_KEY` | your football-data.org key (optional — referees and midweek fixtures; everything else works without it) |

**b) Add the Stripe webhook:** Stripe → **Developers → Webhooks → Add endpoint** → URL = `https://YOUR-SITE/api/stripe-webhook` → select events **checkout.session.completed**, **customer.subscription.updated**, **customer.subscription.deleted** → save → copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

## Step 5 — Tell Supabase your site URL (so login emails work)
Supabase → **Authentication → URL Configuration** → set **Site URL** to your deployed URL and add it under **Redirect URLs**.

## Step 6 — (Recommended) Custom domain + update share links
1. Netlify → **Domain management** → add your domain (e.g. `gameweekedge.app`) and follow the DNS steps.
2. In the repo, change the placeholder `https://gameweekedge.app` to your real domain in **`index.html`** and **`landing.html`** (the `og:` / canonical tags). Tell me your domain and I'll do this for you in one edit.

## Step 7 — Redeploy
After adding env vars, Netlify → **Deploys → Trigger deploy → Deploy site** (env-var changes need a fresh deploy). Wait ~1–2 min.

## Step 8 — Test on your phone
Work down **`QA_CHECKLIST.md`**. The essentials:
- Add the site to your home screen → it opens full-screen.
- Link your team → squad/points load.
- Open a Pro panel → upgrade → pay with Stripe **test card 4242 4242 4242 4242** (any future date/CVC) → you become Pro.
- Alerts → enable push → accept the prompt.
- Ask the Scout → ask a question → get an answer.

> Use Stripe **test mode** first; flip to live keys when you're happy.

## Step 9 — Launch 🚀
Share **`https://YOUR-SITE/welcome`** — that's the marketing page with the install call-to-action. Post it, and you're live.

---

### Optional, later
- **App Store / Play Store:** the iOS project is ready (`README_MOBILE.md`); needs a Mac or a cloud build (Codemagic), an Apple Developer account, and Apple in-app purchase for Pro (Stripe web checkout stays for the PWA).
- **Real screenshots** in the landing hero once you've got data showing.
