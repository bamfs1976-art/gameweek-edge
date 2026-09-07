/* Gameweek Edge — the card-ban ladder, for the push sender.

   The rule is not written here. vendor/suspension_core.js carries
   PLDCore.nextSuspension byte for byte from the Bookings Desk
   (bamfs1976-art/pl-bookings) and vendor/suspension_scheme.js the Premier
   League ladder it reads. Both ship alongside the function through
   included_files in netlify.toml, and the app loads the same two files, so
   a push alert can only ever say what the Injuries panel says.

   loadRule() returns null when the files are not to hand. The caller then
   sends no suspension alert at all, rather than one from a rule of its own:
   scripts/check-shell.mjs fails the build if a threshold is typed back in. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = ['suspension_core.js', 'suspension_scheme.js'];

/* Same search as log-predictions.js makes for index.html: the bundled
   copy first, the repo checkout second, the working directory last. */
function readVendor(name) {
  const candidates = [
    path.join(__dirname, 'vendor', name),
    path.join(__dirname, '..', '..', 'vendor', name),
    path.join(process.cwd(), 'vendor', name),
  ];
  for (const p of candidates) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { /* next */ } }
  return null;
}

let cached;
function loadRule() {
  if (cached !== undefined) return cached;
  const srcs = FILES.map(readVendor);
  if (srcs.some((s) => !s)) return (cached = null);
  /* The vendored files are browser scripts: an IIFE that hangs PLDCore off
     the global, and a top-level var. A fresh context gives them a global of
     their own and keeps them out of this module's scope. */
  const ctx = vm.createContext({});
  vm.runInContext(srcs.join('\n'), ctx);
  const C = ctx.PLDCore, S = ctx.GE_SUSPENSION;
  if (!C || typeof C.nextSuspension !== 'function' || !S) return (cached = null);
  cached = {
    /* The call the app makes (suspNext in index.html): the club's match
       number is taken as the gameweeks already played, gw - 1. */
    next: (yellows, gw) => C.nextSuspension(Math.max(0, yellows || 0), Math.max(0, (gw || 1) - 1), S),
    scheme: S,
  };
  return cached;
}

/* The one moment the hourly sender reports: the caution picked up since
   the last snapshot is the one that leaves a player a single yellow from
   his next ban. Returns that rung as {at, ban, by}, or null.

   A player whose count did not move is never reported, however close he
   stands, so each player is announced once and not every hour. A player
   who has just reached a rung is not "one from a ban" either: under the
   shared rule the watch moves on to the next rung, and the ban itself is
   FPL's status flag, which the fitness alert already covers. */
function justOneFromBan(rule, yellowsNow, yellowsBefore, gw) {
  if (!rule) return null;
  const y = yellowsNow || 0, before = yellowsBefore || 0;
  if (y <= before) return null;
  const n = rule.next(y, gw);
  if (!n || n.dead || n.need !== 1) return null;
  return { at: n.at, ban: n.ban, by: n.by };
}

module.exports = { loadRule, justOneFromBan };
