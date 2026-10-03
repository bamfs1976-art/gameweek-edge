/* Which alert channels this deployment can send, so the app only offers
   the ones that work. No secrets: a yes/no for email and the bot's public
   username for Telegram. */
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  body: JSON.stringify({
    email: !!(process.env.RESEND_API_KEY && process.env.ALERTS_SIGNING_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY),
    telegramBot: (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_BOT_USERNAME) || null,
  }),
});
