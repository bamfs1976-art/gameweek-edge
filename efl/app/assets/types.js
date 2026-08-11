/* ═══════════════════════════════════════════════════════════
   FANTASY EFL — the shapes every other file in this app agrees on.

   These are JSDoc typedefs rather than TypeScript because nothing in
   Gameweek Edge is compiled: the app ships as the files you see. Editors
   still get completion and `// @ts-check` still type-checks a file that
   opts in, which is the useful half of TypeScript without the build step.

   THE RULE THIS FILE EXISTS TO ENFORCE: no view, no scoring function and
   no page script may read a field that is not declared here. The provider
   (provider.js) is the only place allowed to know what an upstream feed
   looks like, and its job is to turn that into these shapes. That is what
   makes swapping the data source a one-file change rather than a rewrite.
   ═══════════════════════════════════════════════════════════ */

/**
 * @typedef {'championship'|'league-one'|'league-two'} DivisionId
 * Fantasy EFL spans the three EFL divisions. Nothing in this app models
 * the Premier League — that is Gameweek Edge's job, at `/`.
 */

/**
 * @typedef {'GK'|'DEF'|'MID'|'FWD'} PositionId
 */

/**
 * @typedef {'available'|'doubtful'|'injured'|'suspended'|'unavailable'} AvailabilityStatus
 * 'unavailable' is the honest catch-all: on international duty, not
 * registered, loan recalled — anything that keeps a player out without
 * being an injury or a ban.
 */

/**
 * @typedef {Object} Availability
 * @property {AvailabilityStatus} status
 * @property {string} note              Short human sentence, e.g. "Hamstring — assessed late".
 * @property {number|null} chancePlaying 0-100, or null when nobody has published one.
 */

/**
 * @typedef {Object} Club
 * @property {string} id                Stable slug, e.g. 'norwich-city'.
 * @property {string} name              Full club name.
 * @property {string} short             Three-letter code for dense tables.
 * @property {DivisionId} division
 * @property {number} position          Current league position (1 = top).
 * @property {number} played
 * @property {number} won
 * @property {number} drawn
 * @property {number} lost
 * @property {number} points
 * @property {number} goalsFor
 * @property {number} goalsAgainst
 * @property {number} cleanSheets
 * @property {('W'|'D'|'L')[]} form     Recent league results, oldest first. Five
 *                                     where the source publishes five; the
 *                                     official feed publishes three.
 * @property {SplitForm} home           Home-only record.
 * @property {SplitForm} away           Away-only record.
 * @property {Last5} last5              The recent-form window the club views use.
 * @property {number|null} ownership    Percentage of managers who have picked this
 *                                      club. UNLIKE players, this one is real: the
 *                                      official game publishes it per club. Null
 *                                      when the active source does not carry it.
 * @property {number|null} fdrHome      The official game's own 1-5 difficulty for
 *                                      playing this club at their place, where
 *                                      published. Shown beside our modelled rating,
 *                                      never used in place of it.
 * @property {number|null} fdrAway      As above, away.
 */

/**
 * @typedef {Object} SplitForm
 * @property {number} played
 * @property {number} won
 * @property {number} drawn
 * @property {number} lost
 * @property {number} goalsFor
 * @property {number} goalsAgainst
 */

/**
 * @typedef {Object} Last5
 * @property {number} played
 * @property {number} points           League points won in the window.
 * @property {number} goalsFor
 * @property {number} goalsAgainst
 * @property {number} cleanSheets
 */

/**
 * @typedef {Object} Fixture
 * @property {string} id
 * @property {DivisionId} division
 * @property {number} round            Fantasy EFL round number.
 * @property {string} homeId           Club id.
 * @property {string} awayId           Club id.
 * @property {string} kickoff          ISO 8601 timestamp.
 * @property {boolean} finished
 * @property {'scheduled'|'postponed'} status
 */

/**
 * A single appearance, as the "last five" strip reads it.
 * @typedef {Object} PlayerForm
 * @property {number} round
 * @property {number} minutes
 * @property {boolean} started
 * @property {number} goals
 * @property {number} assists
 * @property {boolean} cleanSheet
 * @property {Object|null} stats       The raw stats this appearance was scored from,
 *                                     where the source carries them — so a score can
 *                                     be re-derived rather than taken on trust.
 * @property {number} points           Fantasy EFL points scored in that round.
 */

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {string} clubId
 * @property {DivisionId} division
 * @property {PositionId} position
 * @property {number} appearances
 * @property {number} starts
 * @property {number} minutes
 * @property {number} goals
 * @property {number} assists
 * @property {number} cleanSheets
 * @property {number} points           Season Fantasy EFL points.
 * @property {PlayerStats} stats       Season totals for the stats the tariff pays
 *                                     for. Every field is nullable and null means
 *                                     NOT PUBLISHED, never zero — a defender with
 *                                     null tackles has not had none, we just do not
 *                                     know. The UI renders those as "—".
 * @property {PlayerForm[]} last5      Oldest first. Empty when the source publishes
 *                                     no per-match history — the official feed's
 *                                     free tier is season aggregates only.
 * @property {Availability} availability
 * @property {number|null} ownership   Percentage, or null when nothing publishes it.
 *                                     Null is the normal case for PLAYERS: the
 *                                     official game publishes ownership for clubs
 *                                     but not, as far as any public endpoint shows,
 *                                     for players. See README.
 */

/**
 * Season totals in the currency the game actually pays in. Keys match the
 * rule names in tariff.js exactly, so a column, a score and a sentence can
 * all be produced from the same key.
 *
 * @typedef {Object} PlayerStats
 * @property {number|null} saves
 * @property {number|null} penaltySaves
 * @property {number|null} goalsConceded
 * @property {number|null} clearances
 * @property {number|null} blocks
 * @property {number|null} tackles
 * @property {number|null} interceptions
 * @property {number|null} keyPasses
 * @property {number|null} shotsOnTarget
 * @property {number|null} yellowCards
 * @property {number|null} redCards
 */

/**
 * What every ranked list in this app returns. The `factors` array is the
 * point: a recommendation that cannot explain itself is not a
 * recommendation, it is a horoscope.
 *
 * @typedef {Object} Recommendation
 * @property {'player'|'club'} kind
 * @property {string} id               Player or club id.
 * @property {number} score            0-100, comparable only within `kind`.
 * @property {RecommendationFactor[]} factors
 * @property {string} summary          Plain-English sentence built from `factors`.
 */

/**
 * @typedef {Object} RecommendationFactor
 * @property {string} key              Machine name, e.g. 'form'.
 * @property {string} label            Human name, e.g. 'Recent form'.
 * @property {number} value            0-1, normalised within the club's own division.
 * @property {number} weight           The weight applied, from the model's weight table.
 * @property {string} note             One clause of the plain-English summary.
 */

/**
 * The envelope every page receives. `source` is not decoration: the UI is
 * required to show it, because a modelled number over sample data must
 * never be able to pass itself off as a live one.
 *
 * @typedef {Object} EflSnapshot
 * @property {DataSource} source
 * @property {Club[]} clubs
 * @property {Player[]} players
 * @property {Fixture[]} fixtures
 * @property {number} currentRound
 */

/**
 * @typedef {Object} DataSource
 * @property {string} id               'sample' | 'efl-official' | 'remote' | provider-defined.
 * @property {boolean} live            False for anything generated locally.
 * @property {string} label            Shown in the data badge, e.g. "Sample data".
 * @property {string} description      One sentence for the footer note.
 * @property {string} generatedAt      ISO timestamp of the snapshot.
 * @property {Coverage} [coverage]     What this source could and could not fill in.
 */

/**
 * A source that answers some questions and not others is the normal case,
 * not the broken one — the official game's unauthenticated endpoints carry
 * season totals but no per-match history. The UI reads this to say which
 * numbers are thinner than they look, instead of quietly showing a form
 * meter built from nothing.
 *
 * @typedef {Object} Coverage
 * @property {boolean} playerMatchHistory  Per-round player results (drives form).
 * @property {boolean} playerDetailedStats Tackles, interceptions, key passes…
 * @property {boolean} clubGoals           Goals scored/conceded per club.
 * @property {boolean} clubOwnership       Percentage of managers picking each club.
 * @property {boolean} officialFdr         The game's own 1-5 fixture ratings.
 * @property {string[]} notes              Human sentences for anything false above.
 */

export {};
