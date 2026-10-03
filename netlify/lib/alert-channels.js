/* Gameweek Edge — email and Telegram alerts: the pure parts.
   Which deadline reminder is due, which squad players were newly flagged,
   the message text, and the signed one-click unsubscribe link. No network
   and no database here; the scheduled sender (functions/alerts-channels.js)
   and the bot webhook (functions/telegram-webhook.js) do the I/O.
   Unit-tested by dev/test-alert-channels.mjs. */
const crypto = require('crypto');

/* Three reminders a gameweek. Each is due inside its own band, so a run
   that starts late sends the one that fits now rather than all three at
   once: 24h (from 24 to 6 hours out), 6h (6 to 1.25) and 1h (the final
   75 minutes, so an hourly run cannot step over it). */
const WINDOWS = [
  { key: 'd24', hi: 24, lo: 6, label: '24 hours' },
  { key: 'd6', hi: 6, lo: 1.25, label: '6 hours' },
  { key: 'd1', hi: 1.25, lo: 0, label: 'about an hour' },
];
function dueWindow(deadlineMs, nowMs, sent) {
  const hrs = (deadlineMs - nowMs) / 3600e3;
  if (!(hrs > 0)) return null;
  for (const w of WINDOWS) if (hrs <= w.hi && hrs > w.lo) return (sent && sent[w.key]) ? null : w;
  return null;
}

/* A player is newly flagged when he was available (or unflagged) at the
   last look and now carries a status other than 'a', or his chance of
   playing has dropped. The first run only records, it never alerts. */
function snapshotOf(elements) {
  const s = {};
  for (const e of elements || []) s[e.id] = [e.status, e.chance_of_playing_next_round == null ? null : e.chance_of_playing_next_round];
  return s;
}
function newlyFlagged(prev, elements) {
  if (!prev || !Object.keys(prev).length) return [];
  const out = [];
  for (const e of elements || []) {
    const p = prev[e.id];
    if (!p) continue;
    const ch = e.chance_of_playing_next_round;
    const was = p[1] == null ? 100 : p[1], now = ch == null ? 100 : ch;
    if ((p[0] === 'a' && e.status !== 'a') || now < was) out.push(e);
  }
  return out;
}

const STATUS = { d: 'doubtful', i: 'injured', s: 'suspended', u: 'unavailable', n: 'not available' };
function flagLine(e, teams) {
  const ch = e.chance_of_playing_next_round;
  const club = teams && teams[e.team] ? ' (' + teams[e.team] + ')' : '';
  return e.web_name + club + ': ' + (STATUS[e.status] || 'flagged') + (ch != null && ch > 0 ? ', ' + ch + '% chance of playing' : '') +
    (e.news ? '. ' + e.news : '');
}

/* One-click unsubscribe, signed so a link cannot switch off someone else. */
function signUnsub(userId, channel, key) {
  return crypto.createHmac('sha256', key).update(userId + ':' + channel).digest('hex').slice(0, 32);
}
function verifyUnsub(userId, channel, sig, key) {
  if (!userId || !sig || !key) return false;
  const want = signUnsub(userId, channel, key);
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

const SITE = 'https://gameweekedge.co.uk';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Email: plain, readable on any client, one link back, one link out. */
function emailFor(kind, data, unsubUrl) {
  const subject = kind === 'deadline'
    ? data.gwName + ' deadline in ' + data.window.label
    : 'Fitness news on ' + (data.lines.length === 1 ? 'one of your players' : data.lines.length + ' of your players');
  const lines = kind === 'deadline'
    ? ['The ' + data.gwName + ' deadline is ' + data.when + '.', 'Set your team, your captain and your transfers before then.']
    : data.lines;
  const text = lines.join('\n') + '\n\nOpen Gameweek Edge: ' + SITE + '/\n\nStop these emails: ' + unsubUrl + '\n';
  const html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">' +
    lines.map((l) => '<p style="margin:0 0 10px">' + esc(l) + '</p>').join('') +
    '<p style="margin:16px 0"><a href="' + SITE + '/" style="color:#0a7d3c">Open Gameweek Edge</a></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">You asked for these alerts in Gameweek Edge. ' +
    '<a href="' + esc(unsubUrl) + '" style="color:#666">Stop these emails</a>.</p></div>';
  return { subject, text, html };
}
function telegramFor(kind, data) {
  return kind === 'deadline'
    ? '⏰ ' + data.gwName + ' deadline in ' + data.window.label + ' (' + data.when + '). Set your team and captain: ' + SITE + '/'
    : '🩹 Fitness news on your squad:\n' + data.lines.map((l) => '• ' + l).join('\n') + '\n' + SITE + '/';
}
/* "Sat 4 Oct, 11:00 UK time" in the reader's time zone. */
function whenUk(ms) {
  return new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' UK time';
}

module.exports = { WINDOWS, dueWindow, snapshotOf, newlyFlagged, flagLine, signUnsub, verifyUnsub, emailFor, telegramFor, whenUk, SITE };
