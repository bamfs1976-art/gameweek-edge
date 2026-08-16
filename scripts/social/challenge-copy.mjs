/*
 * Card copy for the FPL Challenge GW2-5 set.
 *
 * The picks themselves live in docs/benchmarks/fpl-challenge-gw2-gw5.json,
 * which is a record written to be read years later: long prose, every caveat
 * spelled out, every figure traceable. A 1200×1200 card cannot carry that, so
 * this file holds the SHORT form.
 *
 * Two files stating the same picks is exactly the drift risk this project keeps
 * getting caught by, so nothing here is trusted: dev/test-challenge-picks.mjs
 * asserts that every name below appears in the matching priority list in the
 * benchmark, that every percentage matches the figure Tom Hadley's tables
 * actually carry for that player or opponent, and that no card ships without
 * its risk line. Edit this file and the suite will tell you if it disagrees
 * with the record.
 *
 * The prose is deliberately NOT parsed out of the benchmark. Regex over prose
 * is what produced the invented price conflicts and the dropped surnames
 * earlier in this work; short copy is written once, by hand, and checked.
 */

export const DECK = {
  title: 'FPL Challenge — GW2 to GW5',
  forWhom: 'Real Treforys · personal reference',
};

export const CARDS = [
  {
    id: 'challenge-00-overview',
    badge: 'Overview',
    kicker: 'Four weeks, four different games',
    h1: 'Play the rule,<em> not the season</em>',
    lead: 'Each challenge scores differently and caps your squad differently. '
      + 'The winning shape in one week is the losing shape in the next.',
    rows: [
      { k: 'GW2', n: 'Welcome Back', m: 'Promoted clubs double · up to 3 per club',
        note: 'One fixture decides it — the only promoted-v-promoted game.' },
      { k: 'GW3', n: 'All Out Attack', m: 'Goals & assists double · one per club',
        note: 'Defenders are close to worthless. Eleven clubs, all attackers.' },
      { k: 'GW4', n: 'Derby Day', m: 'Man Utd & Man City double · up to 3 per club',
        note: 'Both sides of one match — a hedge and an anti-correlation at once.' },
      { k: 'GW5', n: 'The Shield', m: 'Defensive contributions score 10 · one per club',
        note: 'A defender clearing the threshold outscores a goalscorer.' },
    ],
    risk: 'Squad size, budget, formation and whether transfers carry are NOT stated on the '
      + 'Challenge tiles. These are shapes and priority orders, not a locked XI.',
  },

  {
    id: 'challenge-gw2-welcome-back',
    badge: 'GW2',
    kicker: 'Welcome Back',
    h1: 'Back the one<em> soft fixture</em>',
    lead: 'Promoted-club players score <b>double</b>. Up to three per club.',
    key: 'Coventry v Hull is the only promoted-versus-promoted fixture in the round — '
      + 'the only one where doubled points are not asked to survive a Premier League defence.',
    picks: [
      { n: 'Carl Rushworth', m: 'GK · Coventry', chips: ['17 clean sheets'],
        why: 'A doubled clean sheet is the highest-<b>probability</b> doubled event on the board, '
          + 'and it is at home to the other promoted side.' },
      { n: 'Milan van Ewijk', m: 'DEF · Coventry', chips: ['set pieces'],
        why: 'Attacking right-back — doubles on the clean sheet <b>and</b> on an assist.' },
      { n: 'Haji Wright', m: 'FWD · Coventry', chips: ['penalties'],
        why: 'Main striker and penalty taker. A doubled penalty is the cleanest 8 points available.' },
    ],
    avoid: 'Ipswich, away at Old Trafford. Double points on a blank is a blank.',
    risk: 'An outside model ranks Coventry\'s defence 19th of 20. Three Coventry players is a '
      + 'concentrated bet on one match.',
  },

  {
    id: 'challenge-gw3-all-out-attack',
    badge: 'GW3',
    kicker: 'All Out Attack',
    h1: 'Eleven clubs,<em> all attackers</em>',
    lead: 'Goals and assists score <b>double</b>. Clean sheets and DefCon do not. One player per club.',
    key: 'The one week where defenders are close to worthless and the whole budget belongs '
      + 'to attackers in soft fixtures.',
    picks: [
      { n: 'Erling Haaland', m: 'Man City — home to Coventry', chips: ['penalties'],
        why: 'The softest attacking fixture in the round, and he takes the penalties.' },
      { n: 'Bruno Fernandes', m: 'Man Utd — away at Everton', chips: ['pens', 'FKs', 'corners'],
        why: 'Our register calls his set-piece monopoly the standout asset in that squad. '
          + 'Every route to a doubled assist runs through him.' },
      { n: 'A Liverpool attacker', m: 'away at Ipswich', chips: ['2nd-softest'],
        why: 'Which asset is a live-price question this build cannot answer offline.' },
      { n: 'An Aston Villa attacker', m: 'away at Hull', chips: ['3rd-softest'],
        why: 'Same reasoning, one rung down.' },
    ],
    avoid: 'Arsenal v Chelsea. Two strong defences cancelling is the wrong shape for a week '
      + 'that only pays goals and assists.',
    risk: 'One player per club means no stacking a soft fixture — the constraint, not the '
      + 'player pool, is what shapes this XI.',
  },

  {
    id: 'challenge-gw4-derby-day',
    badge: 'GW4',
    kicker: 'Derby Day',
    h1: 'Four doubled,<em> not six</em>',
    lead: 'Manchester United and Manchester City players score <b>double</b>. Up to three per club.',
    key: 'Doubling both sides of one match is a hedge and an anti-correlation at once: half the '
      + 'block is always on the right side, but a clean sheet for one is a blank for the other.',
    picks: [
      { n: 'Erling Haaland', m: 'Man City', chips: ['doubled', 'penalties'],
        why: 'Doubled, and the penalty taker.' },
      { n: 'Bruno Fernandes', m: 'Man Utd', chips: ['doubled', 'takes everything'],
        why: 'Penalties, direct free kicks and corners.' },
      { n: 'Mbeumo or Cunha', m: 'Man Utd', chips: ['mid-price'],
        why: 'Our register rates both as strong returns behind Bruno.' },
      { n: 'Cherki', m: 'Man City', chips: ['FKs', 'corners'],
        why: 'High assists, and the creator role in a rebuilt side.' },
    ],
    avoid: 'Doubled defenders from this fixture — the two defences cancel. Six doubled players '
      + 'riding one ninety minutes is variance, not edge.',
    risk: 'This rests on an INFERENCE that GW4 is the Manchester derby, at Old Trafford. Our '
      + 'register does not hold that fixture — it was narrowed to two possibilities, settled by '
      + 'the tile naming exactly these two clubs, and later corroborated by an outside thread '
      + 'that also gave the venue. Corroborated, not confirmed.',
  },

  {
    id: 'challenge-gw5-the-shield',
    badge: 'GW5',
    kicker: 'The Shield',
    h1: 'Pick the fixture,<em> then the player</em>',
    lead: 'Defensive contributions score <b>10</b> instead of 2. One player per club.',
    key: 'An opponent table beats a hit rate: what matters is how much defending the fixture '
      + 'actually asks for.',
    picks: [
      { n: 'Muharemović', m: 'DEF · Leeds — v Crystal Palace', chips: ['53%', '10.7/start', 'opp 62%'],
        why: 'Palace is the single highest row in the opponent table.' },
      { n: 'João Gomes', m: 'MID · Aston Villa — at Spurs', chips: ['47%', '11.7/start', 'opp 39%'],
        why: 'Tottenham tops the central-midfield table.' },
      { n: 'Vušković', m: 'DEF · Brighton — v Arsenal', chips: ['63%', '12.4/start', 'opp 44%'],
        why: 'Highest per-start figure in the entire £5.0m bracket.' },
      { n: 'Lacroix', m: 'DEF · Chelsea — at Brentford', chips: ['60%', '10.7/start', 'opp 43%'],
        why: 'Consistent hitter in a fixture that supplies the work.' },
      { n: 'Ballard', m: 'DEF · Sunderland — at Man City', chips: ['54%', 'opp 38%'],
        why: 'A Sunderland defender at the Etihad will not be short of defending to do.' },
    ],
    avoid: 'Man Utd defenders at Fulham — the lowest row in the table at 23%, so the fixture '
      + 'suppresses the very thing scoring 10. And all Man City players: they will dominate '
      + 'the ball, so their own defenders do nothing.',
    risk: 'Elliot Anderson is NOT here despite a 70% hit rate — that was earned at Forest and '
      + 'our register has him at Man City now.',
  },

  {
    id: 'challenge-99-risks',
    badge: 'Read this',
    kicker: 'What is actually being bet on',
    h1: 'Where this<em> could be wrong</em>',
    lead: 'Every pick in this set is a priority under stated assumptions. None of it is a '
      + 'prediction that anything will happen.',
    rows: [
      { k: '01', n: 'Minutes risk dominates', m: '',
        note: 'Three of the five Shield picks changed club this summer. A DefCon rate is worthless if the player does not start.' },
      { k: '02', n: 'No Premier League basis', m: '',
        note: 'Vušković\'s 63% is Bundesliga, Muharemović\'s 53% is Serie A. Neither has a Premier League minute — and our own app now refuses to print a hit rate for players in that position.' },
      { k: '03', n: 'Last season, other managers', m: '',
        note: 'Eight of seventeen opponent rows are marked as clubs that changed manager — including Crystal Palace, the row the top Shield pick leans hardest on.' },
      { k: '04', n: 'GW4 is an inference', m: '',
        note: 'The Manchester derby is derived, not held. It settles the moment the fixture list is read.' },
      { k: '05', n: 'The app does not model this', m: '',
        note: 'No per-gameweek scoring overrides, no per-club constraint solver. These picks were assembled by hand.' },
    ],
    risk: 'Committed to git before the deadline so the record shows they predate the football. '
      + 'Gradeable afterwards, which is the point.',
  },
];
