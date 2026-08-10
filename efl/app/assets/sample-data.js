/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — sample data.

   ── WHAT THIS IS, PLAINLY ──────────────────────────────────
   Every number this file produces is INVENTED. There is no free, reliable
   feed for Championship, League One and League Two player data that this
   project already pays for or holds a key to, so the app ships with a
   generated dataset instead of an empty screen. The UI is required to say
   so on every page — see `renderSourceBanner()` in ui.js, which reads
   `source.live` and refuses to go quiet when it is false.

   ── WHAT IS REAL AND WHAT IS NOT ───────────────────────────
   Real:      the 72 club names, and which division each is listed in.
              Used descriptively, as the rest of this site uses club names.
   Invented:  every result, table position, goal, minute, injury and,
              emphatically, every PLAYER NAME. The names are assembled from
              two ordinary word lists by a seeded generator. They are not
              real footballers and are not intended to resemble any.

   ── WHY IT IS GENERATED RATHER THAN HAND-WRITTEN ───────────
   A hand-written fixture list drifts out of sync with a hand-written table
   the first time either is edited, and then the demo is quietly lying about
   itself: a club top of the table with three defeats in its results. So
   nothing here is written down twice. Club strengths are the only input;
   the season is then simulated forward from them, and the table, the form
   strings, the home/away splits, the clean sheets and every player's goals
   are all *read back out of the simulated results*. The table always
   matches the results because it is derived from them.

   Deterministic: same `seed` and same `now`, same dataset. That is what
   lets dev/test-efl.mjs assert on it.
   ═══════════════════════════════════════════════════════════ */

/** @typedef {import('./types.js')} */

export const DIVISIONS = [
  { id: 'championship', name: 'Championship', short: 'CHA', tier: 2 },
  { id: 'league-one', name: 'League One', short: 'LG1', tier: 3 },
  { id: 'league-two', name: 'League Two', short: 'LG2', tier: 4 }
];

export const DIVISION_BY_ID = Object.fromEntries(DIVISIONS.map((d) => [d.id, d]));

/* Clubs are listed strongest-first within each division. That ordering is
   the ONLY strength input the simulation gets; everything else falls out of
   it. It is a plausible ordering, not a prediction. */
const CLUB_SOURCE = {
  championship: [
    ['Leicester City', 'LEI'], ['Southampton', 'SOU'], ['Ipswich Town', 'IPS'],
    ['Norwich City', 'NOR'], ['Middlesbrough', 'MID'], ['West Bromwich Albion', 'WBA'],
    ['Coventry City', 'COV'], ['Sheffield United', 'SHU'], ['Watford', 'WAT'],
    ['Bristol City', 'BRC'], ['Millwall', 'MIL'], ['Blackburn Rovers', 'BLB'],
    ['Swansea City', 'SWA'], ['Hull City', 'HUL'], ['Preston North End', 'PRE'],
    ['Queens Park Rangers', 'QPR'], ['Stoke City', 'STK'], ['Sheffield Wednesday', 'SHW'],
    ['Cardiff City', 'CAR'], ['Derby County', 'DER'], ['Portsmouth', 'POR'],
    ['Oxford United', 'OXF'], ['Luton Town', 'LUT'], ['Plymouth Argyle', 'PLY']
  ],
  'league-one': [
    ['Birmingham City', 'BIR'], ['Wrexham', 'WRE'], ['Bolton Wanderers', 'BOL'],
    ['Charlton Athletic', 'CHA'], ['Huddersfield Town', 'HUD'], ['Barnsley', 'BAR'],
    ['Blackpool', 'BLP'], ['Peterborough United', 'PET'], ['Wigan Athletic', 'WIG'],
    ['Reading', 'REA'], ['Stockport County', 'STO'], ['Leyton Orient', 'LEY'],
    ['Lincoln City', 'LIN'], ['Rotherham United', 'ROT'], ['Mansfield Town', 'MAN'],
    ['Exeter City', 'EXE'], ['Northampton Town', 'NTH'], ['Bristol Rovers', 'BRR'],
    ['Wycombe Wanderers', 'WYC'], ['Burton Albion', 'BUR'], ['Stevenage', 'STV'],
    ['Shrewsbury Town', 'SHR'], ['Crawley Town', 'CRW'], ['Cambridge United', 'CAM']
  ],
  'league-two': [
    ['Bradford City', 'BRD'], ['Notts County', 'NOT'], ['Walsall', 'WAL'],
    ['Chesterfield', 'CHE'], ['Port Vale', 'PVA'], ['Doncaster Rovers', 'DON'],
    ['Gillingham', 'GIL'], ['Salford City', 'SAL'], ['Colchester United', 'COL'],
    ['Crewe Alexandra', 'CRE'], ['Milton Keynes Dons', 'MKD'], ['Barrow', 'BRW'],
    ['Grimsby Town', 'GRI'], ['Bromley', 'BRO'], ['Fleetwood Town', 'FLE'],
    ['Newport County', 'NEW'], ['Swindon Town', 'SWI'], ['Accrington Stanley', 'ACC'],
    ['Harrogate Town', 'HAR'], ['Tranmere Rovers', 'TRA'], ['Cheltenham Town', 'CHT'],
    ['Carlisle United', 'CRL'], ['Morecambe', 'MOR'], ['Sutton United', 'SUT']
  ]
};

/* ── Deterministic randomness ─────────────────────────────
   mulberry32: 32-bit, seedable, good enough for demo data and small
   enough to read. Math.random() is deliberately never called in this
   file — a dataset that changes on reload cannot be tested, and a
   fixture table that reshuffles when you hit refresh reads as a bug. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* Poisson draw by inversion. Match scorelines are Poisson in every model
   this site runs, including the one Gameweek Edge grades itself on, so the
   sample data is generated the same way rather than by rolling a die. */
function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L && k < 12);
  return k - 1;
}

/* ── Names ────────────────────────────────────────────────
   Assembled, not collected. See the header: these are not real players.
   The lists are ordinary British given names and surnames, so a collision
   with a real person's name is possible by chance; nothing about the
   generated record is derived from, or intended to describe, anyone. */
const FIRST_INITIALS = 'ABCDEFGHIJKLMNOPRSTW'.split('');
const SURNAMES = [
  'Ackroyd', 'Ambrose', 'Baverstock', 'Beckwith', 'Birtwistle', 'Blakemore', 'Boothroyd',
  'Braithwaite', 'Brindley', 'Cadwallader', 'Calderwood', 'Carmichael', 'Chadwick',
  'Chesterton', 'Clitheroe', 'Cowperthwaite', 'Crossland', 'Danbury', 'Dearnley',
  'Doughty', 'Duckworth', 'Eastcott', 'Ellersley', 'Fairbrother', 'Farthing', 'Fenwick',
  'Fothergill', 'Garforth', 'Gawthorpe', 'Goodliffe', 'Greenhalgh', 'Hardacre',
  'Hathersage', 'Haverfield', 'Hollingworth', 'Huddlestone', 'Ingleby', 'Inskip',
  'Jephcott', 'Kettlewell', 'Kirkbride', 'Langtree', 'Lathwell', 'Leadbetter',
  'Lockwood', 'Maddocks', 'Marchbank', 'Meredew', 'Micklewright', 'Nettleship',
  'Norbury', 'Oglethorpe', 'Ollerenshaw', 'Pendlebury', 'Pickersgill', 'Postlethwaite',
  'Quarmby', 'Ravenscroft', 'Redmayne', 'Rimmington', 'Rowbotham', 'Satterthwaite',
  'Scholefield', 'Shackleton', 'Sidebottom', 'Snelgrove', 'Stanbridge', 'Swinburne',
  'Tattersall', 'Thirlwell', 'Thurgood', 'Titchmarsh', 'Trenholme', 'Underwood',
  'Vardon', 'Wainwright', 'Whitcombe', 'Whittingham', 'Wilberforce', 'Winterbottom',
  'Woodhouse', 'Wrightson', 'Yardley', 'Youngman'
];

/* ── Squad shape ──────────────────────────────────────────
   Fourteen players a club: enough for the finder to be worth filtering and
   small enough that the whole dataset stays a few hundred kilobytes in
   memory. Order matters — index 0 of each position is the first-choice
   player, and nailed-on minutes fall away down the list. */
const SQUAD_SHAPE = ['GK', 'GK', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF',
  'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'];

const AVAILABILITY_NOTES = {
  doubtful: ['Knock — assessed on Friday', 'Managed minutes after illness',
    'Tight hamstring, late call', 'Trained apart midweek'],
  injured: ['Hamstring — expected back in three weeks', 'Ankle, out short term',
    'Groin injury, no return date', 'Calf strain — a fortnight'],
  suspended: ['Serving a one-match ban', 'Suspended — fifth booking'],
  unavailable: ['Not registered for this round', 'Away on international duty',
    'Recalled by parent club']
};

/* Fantasy EFL's exact scoring tariff is published by the official game and
   changes between seasons, so this app does not restate it as fact. The
   sample points below are a DEMONSTRATION tariff of the usual shape
   (appearance, goals by position, assists, clean sheets) purely so the
   sample players have a plausible points column to sort. Nothing in the
   recommendation model reads it. */
const DEMO_TARIFF = {
  goal: { GK: 6, DEF: 6, MID: 5, FWD: 4 },
  cleanSheet: { GK: 4, DEF: 4, MID: 1, FWD: 0 },
  assist: 3
};

/* The Saturday at, or just after, `now` — 15:00 UTC, the EFL's default. */
function upcomingSaturday(now) {
  const d = new Date(now);
  d.setUTCHours(15, 0, 0, 0);
  const shift = (6 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + shift);
  return d.getTime();
}

const DAY = 86400000;
const WEEK = 7 * DAY;
/* Kickoff slots inside a round, cycled through so a round is not twelve
   simultaneous 15:00s. Offsets are from the round's Saturday 15:00. */
const SLOTS = [0, -2.5 * 3600000, 2.5 * 3600000, -28 * 3600000 + 4.75 * 3600000];

/**
 * Circle-method double round robin. Returns rounds[] of [homeIdx, awayIdx].
 * Twenty-four clubs gives 23 rounds a half and 46 in a season, which is the
 * real EFL length — handy, because "round 46" then means what it should.
 */
function roundRobin(n, rng) {
  const order = [...Array(n).keys()];
  /* One deterministic shuffle so the schedule is not alphabetical-by-strength,
     which would put every top-of-the-table clash in the same week. */
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const half = [];
  const rot = order.slice(1);
  for (let r = 0; r < n - 1; r += 1) {
    const pairs = [[order[0], rot[rot.length - 1]]];
    for (let i = 0; i < (n - 2) / 2; i += 1) pairs.push([rot[i], rot[rot.length - 2 - i]]);
    /* Alternate which side is at home per round so nobody plays ten straight
       away games. */
    half.push(pairs.map(([a, b], i) => ((r + i) % 2 ? [b, a] : [a, b])));
    rot.unshift(rot.pop());
  }
  return [...half, ...half.map((round) => round.map(([h, a]) => [a, h]))];
}

/* ── Options ──────────────────────────────────────────────
   `currentRound` is the round managers are picking for: rounds below it are
   played, this one and above are not. */
export const SAMPLE_DEFAULTS = { seed: 20260810, currentRound: 17, totalRounds: 46 };

/**
 * Build the whole sample snapshot.
 * @param {{seed?:number, now?:number, currentRound?:number}} [opts]
 * @returns {{source:Object, clubs:Object[], players:Object[], fixtures:Object[], currentRound:number}}
 */
export function buildSampleSnapshot(opts = {}) {
  const seed = opts.seed == null ? SAMPLE_DEFAULTS.seed : opts.seed;
  const now = opts.now == null ? Date.now() : opts.now;
  const currentRound = opts.currentRound == null ? SAMPLE_DEFAULTS.currentRound : opts.currentRound;
  const rng = mulberry32(seed);
  const saturday = upcomingSaturday(now);

  /* ── clubs ─────────────────────────────────────────── */
  const clubs = [];
  const byDivision = {};
  for (const div of DIVISIONS) {
    const list = CLUB_SOURCE[div.id];
    byDivision[div.id] = [];
    list.forEach(([name, short], i) => {
      /* Strength runs 1.28 → 0.74 down the listed order, jittered so the
         table does not come out in the order it was typed in. */
      const base = 1.28 - (i / (list.length - 1)) * 0.54;
      const club = {
        id: slug(name),
        name,
        short,
        division: div.id,
        strength: Math.max(0.6, base + (rng() - 0.5) * 0.1),
        position: 0, played: 0, won: 0, drawn: 0, lost: 0, points: 0,
        goalsFor: 0, goalsAgainst: 0, cleanSheets: 0,
        form: [],
        home: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 },
        away: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 },
        last5: { played: 0, points: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0 },
        _results: []
      };
      clubs.push(club);
      byDivision[div.id].push(club);
    });
  }
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));

  /* ── fixtures ──────────────────────────────────────── */
  const fixtures = [];
  for (const div of DIVISIONS) {
    const list = byDivision[div.id];
    const schedule = roundRobin(list.length, rng);
    schedule.forEach((round, r) => {
      round.forEach(([h, a], i) => {
        const roundNo = r + 1;
        fixtures.push({
          id: `${div.short}-R${roundNo}-${i + 1}`,
          division: div.id,
          round: roundNo,
          homeId: list[h].id,
          awayId: list[a].id,
          kickoff: new Date(saturday + (roundNo - currentRound) * WEEK
            + SLOTS[(i + roundNo) % SLOTS.length]).toISOString(),
          finished: roundNo < currentRound,
          status: 'scheduled'
        });
      });
    });
  }

  /* ── blanks and doubles ────────────────────────────────
     Real Fantasy EFL rounds are not all twelve-a-side: cup weekends leave
     clubs without a league game (a blank), and the rearranged match lands in
     a later round (a double). One of each per division, inside the window
     the fixture ticker shows, so those code paths are exercised by the demo
     rather than only by a season that has not happened yet. */
  for (const div of DIVISIONS) {
    const blankRound = currentRound + 2;
    const moveTo = currentRound + 4;
    const victim = fixtures.find((f) => f.division === div.id && f.round === blankRound);
    if (!victim) continue;
    victim.round = moveTo;
    victim.status = 'postponed';
    victim.kickoff = new Date(saturday + (moveTo - currentRound) * WEEK - 4 * DAY
      + 4.75 * 3600000).toISOString();
  }

  /* ── simulate the played rounds ─────────────────────── */
  const HOME_EDGE = 1.14;
  const BASE_GOALS = 1.32;
  for (const f of fixtures.filter((x) => x.finished).sort((a, b) => a.round - b.round)) {
    const home = clubById[f.homeId];
    const away = clubById[f.awayId];
    const hGoals = poisson(rng, BASE_GOALS * HOME_EDGE * (home.strength / away.strength));
    const aGoals = poisson(rng, BASE_GOALS / HOME_EDGE * (away.strength / home.strength));
    record(home, away, hGoals, aGoals, true, f.round);
    record(away, home, aGoals, hGoals, false, f.round);
  }

  function record(club, opponent, scored, conceded, atHome, round) {
    const split = atHome ? club.home : club.away;
    const result = scored > conceded ? 'W' : scored === conceded ? 'D' : 'L';
    const pts = result === 'W' ? 3 : result === 'D' ? 1 : 0;
    club.played += 1;
    club.won += result === 'W' ? 1 : 0;
    club.drawn += result === 'D' ? 1 : 0;
    club.lost += result === 'L' ? 1 : 0;
    club.points += pts;
    club.goalsFor += scored;
    club.goalsAgainst += conceded;
    club.cleanSheets += conceded === 0 ? 1 : 0;
    split.played += 1;
    split.won += result === 'W' ? 1 : 0;
    split.drawn += result === 'D' ? 1 : 0;
    split.lost += result === 'L' ? 1 : 0;
    split.goalsFor += scored;
    split.goalsAgainst += conceded;
    club._results.push({ round, result, pts, scored, conceded, atHome, opponentId: opponent.id });
  }

  /* Form strings, the five-match window and the table itself are all read
     back out of `_results`. Nothing is asserted twice. */
  for (const club of clubs) {
    club._results.sort((a, b) => a.round - b.round);
    const last5 = club._results.slice(-5);
    club.form = last5.map((r) => r.result);
    club.last5 = {
      played: last5.length,
      points: last5.reduce((s, r) => s + r.pts, 0),
      goalsFor: last5.reduce((s, r) => s + r.scored, 0),
      goalsAgainst: last5.reduce((s, r) => s + r.conceded, 0),
      cleanSheets: last5.filter((r) => r.conceded === 0).length
    };
  }
  for (const div of DIVISIONS) {
    byDivision[div.id]
      .slice()
      .sort((a, b) => b.points - a.points
        || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
        || b.goalsFor - a.goalsFor
        || a.name.localeCompare(b.name))
      .forEach((club, i) => { club.position = i + 1; });
  }

  /* ── players ───────────────────────────────────────── */
  const players = [];
  for (const club of clubs) {
    const squad = SQUAD_SHAPE.map((position, i) => {
      const seen = SQUAD_SHAPE.slice(0, i).filter((p) => p === position).length;
      return { position, depth: seen };
    });
    /* How the club's goals and assists are shared out. Weights are per
       player-slot; they are normalised below, so only their ratios matter. */
    const shareWeight = (p) => {
      const byPos = { GK: 0.02, DEF: 0.5, MID: 1.15, FWD: 1.9 }[p.position];
      return byPos * Math.pow(0.62, p.depth);
    };
    const totalShare = squad.reduce((s, p) => s + shareWeight(p), 0);

    squad.forEach((slot, i) => {
      const name = `${FIRST_INITIALS[Math.floor(rng() * FIRST_INITIALS.length)]}. `
        + SURNAMES[Math.floor(rng() * SURNAMES.length)];
      /* Nailed-on down to rotation: first choice starts ~92% of games, the
         next ~55%, the third ~22%. Goalkeepers are more binary than that,
         which is why they get their own curve. */
      const startRate = slot.position === 'GK'
        ? (slot.depth === 0 ? 0.94 : 0.06)
        : Math.max(0.05, 0.9 * Math.pow(0.55, slot.depth) + (rng() - 0.5) * 0.12);
      const starts = Math.min(club.played, Math.round(club.played * startRate));
      const subApps = slot.position === 'GK' ? 0
        : Math.round((club.played - starts) * (0.45 - slot.depth * 0.08) * rng() * 2);
      const appearances = Math.min(club.played, starts + Math.max(0, subApps));
      const minutes = starts * (78 + Math.round(rng() * 12))
        + Math.max(0, appearances - starts) * (14 + Math.round(rng() * 18));

      const share = shareWeight(slot) / totalShare;
      const minuteShare = club.played ? minutes / (club.played * 90) : 0;
      const goals = Math.round(club.goalsFor * share * 0.92 * minuteShare * 1.35);
      const assists = Math.round(club.goalsFor * share * 0.62 * minuteShare * 1.35);
      /* Clean sheets a player was actually on the pitch for: the club's
         shut-outs, scaled by the share of matches they started. */
      const cleanSheets = club.played
        ? Math.round(club.cleanSheets * (starts / club.played))
        : 0;

      const availability = drawAvailability(rng, slot.depth);
      const last5 = buildLast5(rng, club, slot, startRate, availability);

      players.push({
        id: `${club.id}-${i + 1}`,
        name,
        clubId: club.id,
        division: club.division,
        position: slot.position,
        appearances,
        starts,
        minutes,
        goals,
        assists,
        cleanSheets,
        points: seasonPoints(slot.position, { appearances, starts, goals, assists, cleanSheets }),
        last5,
        availability,
        /* No feed publishes Fantasy EFL ownership, so the field is null and
           the UI hides the column rather than inventing a percentage. The
           finder offers a modelled "form differential" in its place. */
        ownership: null
      });
    });
  }

  function drawAvailability(rng2, depth) {
    const roll = rng2();
    /* ~86% of a squad is available in a normal week; fringe players pick up
       marginally more of the "not registered" cases. */
    if (roll > 0.14) return { status: 'available', note: 'No reported issue', chancePlaying: 100 };
    if (roll > 0.09) return pick('doubtful', rng2, 75);
    if (roll > 0.035) return pick('injured', rng2, 0);
    if (roll > 0.02) return pick('suspended', rng2, 0);
    return pick(depth > 1 ? 'unavailable' : 'doubtful', rng2, depth > 1 ? 0 : 50);
  }
  function pick(status, rng2, chance) {
    const notes = AVAILABILITY_NOTES[status];
    return { status, note: notes[Math.floor(rng2() * notes.length)], chancePlaying: chance };
  }

  function buildLast5(rng2, club, slot, startRate, availability) {
    const recent = club._results.slice(-5);
    return recent.map((r) => {
      const started = rng2() < startRate;
      const benchMinutes = rng2() < 0.35 ? 8 + Math.floor(rng2() * 22) : 0;
      const minutes = started ? 70 + Math.floor(rng2() * 21) : benchMinutes;
      /* A player's chance of a goal in a match scales with the club's goals
         that day and how far up the pitch they play. */
      const attack = { GK: 0, DEF: 0.06, MID: 0.16, FWD: 0.3 }[slot.position]
        * Math.pow(0.6, slot.depth) * (minutes / 90);
      const goals = rng2() < attack * r.scored ? 1 : 0;
      const assists = rng2() < attack * 0.7 * r.scored ? 1 : 0;
      const cleanSheet = r.conceded === 0 && minutes >= 60;
      const points = minutes === 0 ? 0
        : (minutes >= 60 ? 2 : 1)
          + goals * DEMO_TARIFF.goal[slot.position]
          + assists * DEMO_TARIFF.assist
          + (cleanSheet ? DEMO_TARIFF.cleanSheet[slot.position] : 0);
      return {
        round: r.round,
        minutes: availability.status === 'injured' && r.round === recent[recent.length - 1].round
          ? 0 : minutes,
        started,
        goals,
        assists,
        cleanSheet,
        points
      };
    });
  }

  function seasonPoints(position, s) {
    return s.appearances + s.starts
      + s.goals * DEMO_TARIFF.goal[position]
      + s.assists * DEMO_TARIFF.assist
      + s.cleanSheets * DEMO_TARIFF.cleanSheet[position];
  }

  /* `strength` and `_results` are generator internals — the app's types do
     not declare them, so they do not leave this file. */
  const publicClubs = clubs.map(({ strength, _results, ...club }) => club);

  return {
    source: {
      id: 'sample',
      live: false,
      label: 'Sample data',
      description: 'Generated demonstration data — real club names, invented results, '
        + 'invented players. Nothing here is a live Fantasy EFL feed.',
      generatedAt: new Date(now).toISOString()
    },
    clubs: publicClubs,
    players,
    fixtures,
    currentRound
  };
}
