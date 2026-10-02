/*
 * Email and Telegram alerts: when a reminder is due, which players count as
 * newly flagged, the signed unsubscribe link, the message text, and the
 * Telegram linking flow (with a fake database). No network.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = require(join(ROOT, 'netlify', 'lib', 'alert-channels.js'));
const W = require(join(ROOT, 'netlify', 'functions', 'telegram-webhook.js'));
const U = require(join(ROOT, 'netlify', 'functions', 'alerts-unsubscribe.js'));

let n = 0, failures = 0;
const ok = (c, label) => { n++; if (!c) { failures++; console.error('  ✗ ' + label); } };
console.log('• email and Telegram alerts');

const H = 3600e3, now = Date.parse('2026-10-03T08:00:00Z');
ok(A.dueWindow(now + 23.5 * H, now, {}).key === 'd24', 'the 24-hour reminder is due a day out');
ok(A.dueWindow(now + 23.5 * H, now, { d24: true }) === null, 'and only once');
ok(A.dueWindow(now + 5 * H, now, { d24: true }).key === 'd6', 'the 6-hour reminder follows');
ok(A.dueWindow(now + 5 * H, now, {}).key === 'd6', 'a run that starts late sends the reminder that fits now, not the 24-hour one');
ok(A.dueWindow(now + 0.9 * H, now, { d24: true, d6: true }).key === 'd1', 'the last reminder lands inside the final 75 minutes');
ok(A.dueWindow(now + 30 * H, now, {}) === null, 'nothing is due more than a day out');
ok(A.dueWindow(now - H, now, {}) === null, 'nothing after the deadline');

const els = (st, ch) => [{ id: 1, web_name: 'Saka', team: 1, status: st, chance_of_playing_next_round: ch, news: 'Knock' }];
const prev = A.snapshotOf(els('a', null));
ok(A.newlyFlagged({}, els('d', 75)).length === 0, 'the first run records and never alerts');
ok(A.newlyFlagged(prev, els('d', 75)).length === 1, 'a fit player turning doubtful is news');
ok(A.newlyFlagged(A.snapshotOf(els('d', 75)), els('d', 25)).length === 1, 'so is a doubt getting worse');
ok(A.newlyFlagged(A.snapshotOf(els('d', 25)), els('d', 75)).length === 0, 'an improving doubt is not an alert');
ok(A.newlyFlagged(prev, els('a', null)).length === 0, 'no change, no alert');
ok(/Saka \(ARS\): doubtful, 75% chance of playing\. Knock/.test(A.flagLine(els('d', 75)[0], { 1: 'ARS' })), 'a flag reads as one plain sentence');

const key = 'k'.repeat(32), uid = '11111111-2222-3333-4444-555555555555';
const sig = A.signUnsub(uid, 'email', key);
ok(A.verifyUnsub(uid, 'email', sig, key), 'a signed unsubscribe link verifies');
ok(!A.verifyUnsub('someone-else', 'email', sig, key), 'and cannot switch off another account');
ok(!A.verifyUnsub(uid, 'email', sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0'), key), 'a tampered signature fails');

const em = A.emailFor('deadline', { gwName: 'Gameweek 7', window: A.WINDOWS[0], when: A.whenUk(now + 24 * H) }, 'https://x/u');
ok(/Gameweek 7 deadline in 24 hours/.test(em.subject) && /Stop these emails: https:\/\/x\/u/.test(em.text) && /Stop these emails/.test(em.html), 'every email names the deadline and carries its unsubscribe link');
ok(!/[—]/.test(em.text + em.subject), 'no em dashes in reader-facing copy');
ok(/<script/i.test(A.emailFor('flags', { lines: ['<script>x</script>'] }, 'u').html) === false, 'player news is escaped in the email body');

/* Telegram linking, against a fake table. */
const rows = [{ user_id: 'u1', link_code: 'ABCDEFGH23', telegram_chat_id: null, telegram_on: false }];
const fake = { from: () => {
  let filt = () => true, upd = null;
  const q = {
    select: () => q, limit: () => Promise.resolve({ data: rows.filter(filt).map((r) => ({ user_id: r.user_id })) }),
    update: (p) => { upd = p; return q; },
    eq: (col, v) => { filt = (r) => r[col] === v; if (upd) { rows.filter(filt).forEach((r) => Object.assign(r, upd)); return Promise.resolve({}); } return q; },
  };
  return q;
} };
const said = [];
const say = async (chat, text) => { said.push([chat, text]); };
ok(await W.handle({ message: { chat: { id: 99 }, text: '/start ABCDEFGH23' } }, fake, say) === 'linked', 'the bot links a chat from a valid one-time code');
ok(rows[0].telegram_chat_id === 99 && rows[0].telegram_on === true && rows[0].link_code === null, 'and stores the chat, switches it on and spends the code');
ok(await W.handle({ message: { chat: { id: 7 }, text: '/start ABCDEFGH23' } }, fake, say) === 'no match', 'a spent code links nothing');
ok(await W.handle({ message: { chat: { id: 99 }, text: '/stop' } }, fake, say) === 'stopped' && rows[0].telegram_on === false, '/stop switches Telegram alerts off');
const res = await W.handler({ httpMethod: 'POST', headers: {}, body: '{}' });
ok(res.statusCode === 401, 'the webhook refuses a call without Telegram\'s secret');

const u = await U.handler({ queryStringParameters: { u: uid, c: 'email', s: 'nope' } });
ok(u.statusCode === 200 && /not (valid|set up)/.test(u.body), 'a bad unsubscribe link changes nothing and says so');

console.log(failures ? `${failures} of ${n} check(s) failed` : `${n}/${n} checks passed`);
process.exit(failures ? 1 : 0);
