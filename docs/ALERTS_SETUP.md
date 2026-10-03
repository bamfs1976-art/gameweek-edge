# Email and Telegram alerts: switching them on

The code is deployed with the app, and the database table
(`gwedge_alert_channels`) is live. Nothing sends until the keys below are set
in Netlify (Site configuration, Environment variables). Each channel switches
on by itself once its keys are present; the Alerts screen only offers
channels that work (`/api/alerts-config`).

## Email (Resend)

The sending domain `gameweekedge.co.uk` is already verified in Resend.

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | a Resend API key with sending access |
| `ALERTS_FROM` | optional, defaults to `Gameweek Edge <alerts@gameweekedge.co.uk>` |
| `ALERTS_SIGNING_KEY` | any long random string (signs the unsubscribe links); generate with `openssl rand -hex 32` |

## Telegram

1. In Telegram, message **@BotFather**, send `/newbot`, pick a name and a
   username (for example `GameweekEdgeBot`). It replies with a token.
2. Set in Netlify:

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_BOT_USERNAME` | the bot's username, without the @ |
| `TELEGRAM_WEBHOOK_SECRET` | any random string of letters, digits, `_` or `-` (`openssl rand -hex 24`) |

3. After the next deploy, register the webhook once (replace the two values):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url=https://gameweekedge.co.uk/api/telegram-webhook \
  -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

## What is sent

| Message | Who | When |
|---|---|---|
| Deadline reminder | anyone signed in who switched a channel on | 24 hours, 6 hours and about an hour before each deadline (each can be turned off) |
| Your squad's new fitness flags | Pro, with a linked team | within the hour of FPL flagging one of their players, or a doubt getting worse |

Sender: `netlify/functions/alerts-channels.js`, hourly. Web push is separate
(`push-cron.js`) and unchanged. Tests: `dev/test-alert-channels.mjs`.
