# Exploration — authenticated `my-team/{entry_id}`

Can Gameweek Edge read the FPL **`my-team`** endpoint to get a manager's
exact bank, free transfers, chip availability and player selling prices?
Findings and recommendation.

## What it would add

Everything else is already available from public endpoints:

| Data | Public source we already use |
|---|---|
| Squad picks | `entry/{id}/event/{gw}/picks` (public after deadline) |
| Chips used, past bank/value | `entry/{id}/history` |
| Transfer history | `entry/{id}/transfers` |

`my-team` adds only four genuinely new fields: **exact current bank**,
**free-transfer count**, **chip availability** (not just what's been used),
and **per-player purchase / selling price** (the sell-on-50%-profit rule).
These would make the Transfer Solver exact on budget and remove the standing
caveat *"the public API doesn't expose your exact selling price."*

## Why it is hard

- **No OAuth, no API keys.** FPL has no third-party auth. `my-team` requires
  a logged-in **Django session cookie** (`pl_profile` + `sessionid`),
  obtained by POSTing email + password to
  `users.premierleague.com/accounts/login/`.
- **Bot protection.** Cloudflare + DataDome sit in front of the login; scripted
  logins from datacenter IPs (our Netlify functions) are routinely challenged
  (403 / captcha). Even with correct credentials it is unreliable.
- **Browser can't do it.** Cross-origin, httpOnly cookies on a different domain
  — a direct browser call is impossible (CORS).

## Options weighed

1. **Server-side credential login** (collect email + password) — would mean
   handling users' FPL passwords: a real security and trust liability, and
   fragile against DataDome / any 2FA. **Rejected.**
2. **User pastes their session cookie** — expires (logout / ~30 days), hard for
   a non-technical user to extract, and still stores a sensitive token.
   **Rejected for general use.**
3. **Browser-side call** — not possible (CORS + cross-domain cookies).
   **Rejected.**
4. **Manual, credential-free fallback (recommended)** — an optional settings
   field for **bank** and **free transfers**, combined with the public picks,
   makes the Transfer Solver exact on budget/FT without ever touching
   credentials. Selling price can be approximated from the FPL rule using a
   price snapshot taken when the manager first links their ID.

## Recommendation

**Do not build authenticated `my-team`.** The net-new data is small and the
only paths to it require handling FPL credentials or session tokens — not
worth the security exposure or the reliability hit from bot protection. If
budget/FT exactness is wanted, ship option 4 (a small optional manual input),
which is safe and deterministic. The app stays fully functional on public
data, as it is today.
