/* Fantasy EFL — the club-page snapshot.

   Seventy-two clubs play the official game and there is, as far as we can
   find, no other free tool for it. What there is no shortage of is people
   searching for their own club and finding nothing: "Swansea City fantasy
   EFL" has intent and no answer. A page per club is the obvious move, and
   the obvious way to build it is the wrong one — seventy-two near-identical
   pages with a name swapped are doorway pages, and search engines are right
   to bury them.

   So each page is built from the model that already runs in the app: the
   club's own rating, its fixture run, the players at that club worth
   picking this round, and who is one booking from a ban. That is a
   different page per club because the football is different, which is the
   only version of this worth publishing.

   This module is pure — snapshot in, page data out. The CLI at the bottom
   is the half that talks to the network, and it is run on a schedule by
   .github/workflows/efl-ledger.yml, never at build time. The build reads
   the committed JSON and renders from it, exactly as the FPL tool pages do
   (scripts/tools/), so a feed that is down means yesterday's pages rather
   than a broken deploy.

   Run: node scripts/efl/clubpages/snapshot.mjs [--out efl/data/club-pages.json] */
import { buildContext, clubScore, playerScore, playingShare, divisionName } from '../../../efl/app/assets/model.js';

/* A URL a person could have guessed. Kept here rather than in the renderer
   because the slug is part of the data contract: it is what the sitemap,
   the links between pages and any inbound link all agree on, and deriving
   it in two places is how they stop agreeing. */
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* How many of a club's players are worth listing. Enough to be a useful
   page, few enough that it is a shortlist rather than a squad dump. */
export const PLAYERS_PER_CLUB = 6;
/* Fixtures shown per club. The app's own run length. */
export const FIXTURES_AHEAD = 5;

/**
 * Turn a normalised Fantasy EFL snapshot into the data the club pages need.
 * Pure: no fetch, no clock beyond the `built` stamp the caller passes.
 *
 * @param {Object} snapshot  from efl/app/assets/provider.js
 * @param {{built?:string}} [opts]
 */
export function buildClubSnapshot(snapshot, opts = {}) {
  const ctx = buildContext(snapshot);
  const scored = ctx.players.map((p) => playerScore(ctx, p));
  const byClub = new Map();
  for (const r of scored) {
    if (!byClub.has(r.player.clubId)) byClub.set(r.player.clubId, []);
    byClub.get(r.player.clubId).push(r);
  }

  const clubs = ctx.clubs.map((club) => {
    const rated = clubScore(ctx, club);
    const squad = (byClub.get(club.id) || []).slice().sort((a, b) => b.score - a.score);

    const fixtures = (rated.run && rated.run.rounds ? rated.run.rounds : [])
      .slice(0, FIXTURES_AHEAD)
      .map((r) => ({
        round: r.round,
        blank: !!r.blank,
        double: !!r.double,
        matches: (r.matches || []).map((m) => ({
          opponent: (ctx.clubById[m.opponentId] || {}).name || 'Unknown',
          home: !!m.home,
          rating: m.rating,
        })),
      }));

    /* Availability and card risk are the two things a manager cannot see
       from a league table, and both change the pick. They go on the page
       whether or not the player is in the shortlist. */
    const unavailable = squad
      .filter((r) => r.player.availability.status !== 'available')
      .map((r) => ({ name: r.player.name, position: r.player.position, status: r.player.availability.status, news: r.player.availability.note || '' }));
    const cardRisk = squad
      .filter((r) => r.suspension && r.suspension.level === 'edge')
      .map((r) => ({ name: r.player.name, position: r.player.position, note: r.suspension.label || '' }));

    return {
      id: club.id,
      name: club.name,
      short: club.short,
      slug: slugify(club.name),
      division: club.division,
      divisionName: divisionName(club.division),
      position: club.position,
      points: club.points,
      played: club.played,
      form: club.form || [],
      rating: Math.round(rated.score * 10) / 10,
      summary: rated.summary,
      factors: (rated.factors || []).map((f) => ({ label: f.label, value: Math.round(f.value * 100) / 100 })),
      fixtures,
      players: squad.slice(0, PLAYERS_PER_CLUB).map((r) => ({
        name: r.player.name,
        position: r.player.position,
        rating: Math.round(r.score * 10) / 10,
        status: r.player.availability.status,
        minutesShare: Math.round(playingShare(ctx, r.player).value * 100),
        summary: r.summary,
      })),
      unavailable,
      cardRisk,
    };
  }).sort((a, b) => b.rating - a.rating);

  return {
    built: opts.built || new Date().toISOString(),
    round: snapshot.currentRound,
    source: snapshot.source,
    clubs,
  };
}

/* ── loading it ──────────────────────────────────────────
   Separated from the CLI, and with its two collaborators injectable, for
   one reason: the first version of this file put the whole thing inside an
   `if (import.meta.url === …)` block, which nothing could reach from a
   test. It called officialProvider() with no argument, every test passed,
   and it threw on the first real run. A shell thin enough to read is not
   the same as a shell that has been run. */

/** How few clubs mean the feed is broken rather than small. The EFL has 72. */
export const MINIMUM_CLUBS = 60;

export async function loadClubSnapshot(deps = {}) {
  const fetchDocuments = deps.fetchDocuments || (await import('../lib.mjs')).fetchDocuments;
  const buildOfficialSnapshot = deps.buildOfficialSnapshot
    || (await import('../../../efl/app/assets/provider.js')).buildOfficialSnapshot;
  const now = deps.now || Date.now();

  /* The same two calls the ledger's recorder makes, and deliberately so:
     fetchDocuments goes through this site's own /api/efl proxy rather than
     the upstream host, and buildOfficialSnapshot is the mapping the app
     itself runs. A second route to the same feed is a second thing to keep
     in step, and this is the one place where "the pages say what the app
     says" is actually enforced. */
  const documents = await fetchDocuments();
  const snapshot = buildOfficialSnapshot(documents, { now });
  const snap = buildClubSnapshot(snapshot, { built: new Date(now).toISOString() });

  /* The feed publishes an injury as an OBJECT, and the keys it uses are not
     documented anywhere we can read. The mapper tries the usual ones and
     falls back to flagging the player injured with nothing to say, which is
     safe but less useful than the real sentence. Rather than guess again,
     say what the object actually looks like in the log of the run that
     found it, so the next fix is informed rather than another guess. */
  const unavailable = snap.clubs.flatMap((c) => c.unavailable);
  if (unavailable.length && !unavailable.some((u) => u.news)) {
    const sample = ((documents && documents.players) || []).find((p) => p && p.injuryDetails
      && typeof p.injuryDetails === 'object' && Object.keys(p.injuryDetails).length);
    if (sample) {
      /* The keys answered "where is the text"; the status vocabulary
         answers "is this man injured or merely doubtful", which is worth
         far more to the model than the sentence is. Both are recorded. */
      const statuses = [...new Set(((documents && documents.players) || [])
        .map((p) => p && p.injuryDetails && p.injuryDetails.status)
        .filter((v) => typeof v === 'string' && v.trim()))].sort().slice(0, 12);
      snap.diagnostics = { injuryDetailsKeys: Object.keys(sample.injuryDetails).sort(), injuryStatuses: statuses };
      console.log(`· ${unavailable.length} players are flagged injured and none carries a readable note. `
        + `injuryDetails keys: ${snap.diagnostics.injuryDetailsKeys.join(', ')}`
        + (statuses.length ? ` | status values: ${statuses.join(', ')}` : ''));
    }
  }

  /* A snapshot that lost half the league is not a smaller snapshot, it is a
     broken feed, and writing it would publish 30 pages and silently delete
     42. Refuse instead: the last good file stays committed and the pages
     with it. */
  if (snap.clubs.length < MINIMUM_CLUBS) {
    throw new Error(`the feed returned ${snap.clubs.length} clubs, and the game has 72`);
  }
  return snap;
}

/* ── the CLI ─────────────────────────────────────────────
   Run by .github/workflows/efl-ledger.yml, never at build time. */
if (import.meta.url === 'file://' + process.argv[1]) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  const argOut = process.argv.indexOf('--out');
  const out = argOut > -1 ? process.argv[argOut + 1] : 'efl/data/club-pages.json';

  try {
    const snap = await loadClubSnapshot();
    mkdirSync(join(ROOT, dirname(out)), { recursive: true });
    writeFileSync(join(ROOT, out), JSON.stringify(snap, null, 1) + '\n');
    console.log(`\u2713 ${out} — ${snap.clubs.length} clubs, round ${snap.round}, from ${snap.source && snap.source.label}`);
  } catch (err) {
    console.error('\u2717 Refusing to write the club-page snapshot: ' + err.message);
    process.exit(1);
  }
}
