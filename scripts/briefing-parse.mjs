/*
 * Pure parsers for a hand-compiled pre-season briefing.
 *
 * Split out from check-briefing.mjs so the extraction can be tested without a
 * network call. Every function here is a claim EXTRACTOR — it decides what the
 * document is asserting, and nothing about whether the assertion is true.
 *
 * The parsing is deliberately conservative: where the briefing hedges, that
 * hedge is carried on the claim rather than discarded, because a checker that
 * reports the API disagreeing with an explicit "unconfirmed" teaches its
 * reader to stop reading it.
 */

/* Club blocks are "## <n>. <Club> (...)" under "# The 20 clubs". Anchoring on
   the numbering rather than on any heading keeps the league-wide headlines and
   the shortlist out of the per-club parse. */
export function clubBlocks(src) {
  const out = [];
  const re = /^## (\d+)\.\s+(.+)$/gm;
  const heads = [...src.matchAll(re)];
  heads.forEach((h, i) => {
    const start = h.index + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : src.length;
    out.push({ n: +h[1], name: h[2].replace(/\s*\(.*$/, '').trim(), body: src.slice(start, end) });
  });
  return out;
}

/* A price claim is an FPL price. A transfer fee is written the same way — a
   name, brackets, £X.Xm — so the two are separated by WHERE they appear, not
   by how they read. The document is consistent about this: FPL prices live in
   the pick bullets and the shortlist, fees live in prose and in the In/Out
   lines. An earlier attempt discriminated on punctuation instead and read
   "Mayenda (~£21.5m to Rennes)" as a £21.5m footballer, which is £6m above
   anything the game has ever priced. */
const PICK_LINE = /^-\s*(Value|Premium|Differentials)/i;
export function priceClaims(src) {
  const out = [];
  const lines = src.split('\n');
  /* The shortlist is a section, not a bullet prefix — everything from its
     heading to the next top-level one is fair game. */
  const from = lines.findIndex((l) => /^#\s*Quick FPL shortlist/i.test(l));
  const to = from > -1 ? lines.findIndex((l, i) => i > from && /^#\s/.test(l)) : -1;
  const re = /([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,3})\s*\(([^)]*?)£(\d+\.\d)m/gu;
  lines.forEach((line, i) => {
    const inShortlist = from > -1 && i > from && (to === -1 || i < to);
    if (!PICK_LINE.test(line.trim()) && !inShortlist) return;
    for (const m of line.matchAll(re)) {
      out.push({ name: m[1].trim(), price: +m[3], est: /~/.test(m[2]) || /est\./i.test(m[0]) });
    }
  });
  return out;
}

/* "Penalties X primary, Y backup" / "Penalties X (Y backup)" / "Penalties X."
   Only the FIRST name is taken as the primary claim — the alternates in these
   lines are hedges, and checking a hedge against an order field is noise. */
export function penaltyClaims(blocks) {
  const out = [];
  for (const b of blocks) {
    const line = (b.body.match(/^- Set-piece & penalties:.*$/m) || [])[0];
    if (!line) continue;
    /* Cut at the sentence boundary FIRST. The name class has to allow a dot
       (initials, "B.Fernandes"), which means a greedy match runs straight
       through "Penalties Bruno. Direct free-kicks…" and returns the player
       "Bruno. Direct". It did, on United, and a loose test assertion hid it. */
    const from = line.slice(line.search(/Penalt(?:ies|y)/));
    const sentence = from.split(/\.(?:\s|$)/)[0];
    const m = sentence.match(/Penalt(?:ies|y)\s+([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,2})/u);
    if (!m) continue;
    const name = m[1].trim();
    if (/^(uncertain|unresolved|shared|no)$/i.test(name)) continue;
    out.push({ club: b.name, name, hedged: /watch|uncertain|unresolved|provisional|likely/i.test(line) });
  }
  return out;
}

/* "**In:** A (…), B (…)" and "**Out:** …" — the leading name of each
   comma-group, which is the player. */
export function moveClaims(blocks) {
  const out = [];
  for (const b of blocks) {
    for (const dir of ['In', 'Out']) {
      const line = (b.body.match(new RegExp('^\\*\\*' + dir + ':\\*\\*(.*)$', 'm')) || [])[1];
      if (!line) continue;
      /* A rumour is a hedge, not a claim. The briefing says so itself —
         "Mateta (ST, rumoured exit, unconfirmed)" — and reporting the API
         disagreeing with an explicit maybe teaches the reader to stop reading
         the report.

         Scoped per PLAYER, not per line. These lines routinely end
         "…, ~£64m, Jan 2026. Rumoured exits: Kroupi, Scott" — one confirmed
         sale followed by two guesses. Hedging the whole line would excuse the
         confirmed one, which is the half worth checking. Everything from a
         "Rumour"/"Rumoured" marker onwards is hedged; before it, only a
         segment that hedges itself. */
      const cut = line.search(/\bRumou?r(?:ed|s)?\b/i);
      for (const seg of line.split(/\)\s*[,.;]\s*/)) {
        const m = seg.match(/([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,3})\s*\(/u);
        if (!m) continue;
        const at = line.indexOf(seg);
        const after = cut > -1 && at >= cut;
        out.push({ club: b.name, dir, name: m[1].trim(), text: seg,
          hedged: after || /rumou?r|unconfirmed|reported|not confirmed|needs confirming|loan/i.test(seg) });
      }
    }
  }
  return out;
}


/* ── The HTML edition ───────────────────────────────────────
   The same briefing also ships as a standalone scout terminal, and there the
   claims are already a structured `TEAMS` array rather than prose. That is a
   far better thing to check: no regex is guessing where a name ends, and it
   carries one claim type the markdown never stated in a machine-readable way
   — the opening fixtures, gameweek by gameweek, with home or away. Those are
   the claims the API can settle outright.

   Prefer this source wherever both exist. */
export function teamsFromHtml(src) {
  const i = src.indexOf('const TEAMS');
  if (i < 0) return null;
  const start = src.indexOf('[', i);
  let depth = 0, q = null, esc = false;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (!depth) return new Function('return ' + src.slice(start, j + 1))(); }
  }
  return null;
}

/* A club states its penalty taker TWICE: once in the set-piece line, and again
   inside the reason a player is a pick ("Watkins — nailed striker and penalty
   taker, the reliable armband"). Reading only the set-piece line was a real
   hole: correcting it left five clubs recommending a player on the strength of
   a penalty duty the same document had just reassigned to somebody else.

   Restricted to the three PICK fields. They have a reliable shape — "Name
   (price) — claim" — so the subject of a sentence is its opening name. The
   summary field is narrative and does not ("Losing Jimenez removes their
   penalty taker" has no pick subject at all), so scanning it would invent
   players rather than find claims. */
const PENS_FIELDS = ['value', 'prem', 'diff'];
const PENS_MARK = /\bpens?\b|\bpenalt/gi;
/* "backup pens" is not a claim to be the taker — it is the opposite, and it is
   compatible with whoever the set-piece line names. Semenyo's City entry says
   exactly that. Looking back a short way covers "backup pens/FK" and "2nd on
   pens" without swallowing the next clause. */
const PENS_NOT = /(?:backup|deputy|alt|2nd|second|behind)\W{0,12}$/i;
const LEAD_NAME = /^\s*([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,2})/u;
/* Capitalised sentence openers that are English, not players. Sweeping every
   lead word in the three pick fields across all 20 clubs turns up exactly
   these — the vocabulary of a pick blurb is small. A missed one is not silent:
   it falls through to the antecedent below, and only becomes a claim if that
   antecedent disagrees with the set-piece line. */
const NOT_A_NAME = /^(a|an|the|both|neither|either|no|none|nailed|key|thin|whichever|watch|expect|if|his|her|their|treat)\b/i;
export function pensProseClaims(teams) {
  const out = [];
  for (const t of teams || []) {
    for (const field of PENS_FIELDS) {
      const text = String(t[field] || '');
      /* The subject carries across sentences, because the writing does:
         "Igor Thiago (FWD ~£7.0m) — standout pick. Nailed, on pens, 21 goals."
         The pens claim is in the second sentence and its subject is in the
         first. Reading the sentence alone attributes the penalties to a player
         called "Nailed". */
      let subject = null;
      for (const sentence of text.split(/\.(?:\s|$)/)) {
        const nm = sentence.match(LEAD_NAME);
        if (nm && !NOT_A_NAME.test(nm[1])) subject = nm[1].trim();
        let claims = false;
        for (const m of sentence.matchAll(PENS_MARK)) {
          if (!PENS_NOT.test(sentence.slice(0, m.index))) { claims = true; break; }
        }
        if (!claims || !subject) continue;
        out.push({ club: t.name, field, name: subject, text: sentence.trim(),
          hedged: /\bif\b|uncertain|unresolved|watch|likely|shares?\b/i.test(sentence) });
      }
    }
  }
  return out;
}

/* The markdown edition states its opening fixtures as prose — "GW1 Coventry
   City (H) easy, GW2 Aston Villa (A) moderate" — where the HTML edition states
   the same thing as data. Only the HTML one was ever parsed, so for a while the
   markdown narrated a fixture list nobody was checking and it drifted a whole
   season out of date without a single test going red.

   Bands are spelled out in the prose and abbreviated in the data; gameweek,
   opponent and venue are the parts that must match exactly. */
const MD_FX_LINE = /^\*\*Opening fixtures:\*\*.*$/m;
const MD_FX = /GW(\d) ([A-Za-z'’ .&-]+?) \((H|A)\) (very hard|moderate|hard|easy)/g;
const MD_BAND = { easy: 'easy', moderate: 'mod', hard: 'hard', 'very hard': 'vhard' };
export function mdFixtureClaims(blocks) {
  const out = [];
  for (const b of blocks) {
    const line = (b.body.match(MD_FX_LINE) || [])[0];
    if (!line) continue;
    for (const m of line.matchAll(MD_FX)) {
      out.push({ club: b.name, gw: +m[1], opp: m[2].trim(), home: m[3] === 'H',
        band: MD_BAND[m[4]] });
    }
  }
  return out;
}

/* One claim extractor over the structured teams. Deliberately mirrors what the
   prose parsers return, so the checker does not care which edition it was
   handed. */
const HEDGE = /rumou?r|unconfirmed|reported|not confirmed|needs confirming|tbc|advanced talks|loan/i;
export function claimsFromTeams(teams) {
  const prices = [], pens = [], moves = [], fixtures = [];
  /* A name followed by a bracketed price. In this edition the pick fields hold
     only picks, so there is no fee to tell apart — but the £ still has to be a
     price, and "£20m+" style fees never appear in these four fields. */
  const priceRe = /([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,3})\s*\(([^)]*?)£(\d+\.\d)m/gu;
  /* "Pens Saka primary (...)" here, "Penalties Saka primary" in the markdown.
     Both spellings, or every claim in this edition is silently dropped —
     which would look like a briefing that names no penalty takers at all. */
  const penRe = /\bPens?(?:alt(?:ies|y))?\s+([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,2})/u;
  const moveRe = /^([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,3})\s*\(/u;

  for (const t of teams || []) {
    for (const field of ['value', 'prem', 'diff']) {
      for (const m of String(t[field] || '').matchAll(priceRe)) {
        prices.push({ club: t.name, name: m[1].trim(), price: +m[3],
          est: /~/.test(m[2]) || /est\./i.test(m[0]) });
      }
    }
    const sp = String(t.sp || '');
    /* Same sentence cut as the markdown path, and for the same reason: this
       edition writes "Pens Bruno. FK Bruno. Corners Bruno." */
    const penFrom = sp.search(/\bPens?\b|\bPenalt/i);
    const pm = penFrom < 0 ? null : sp.slice(penFrom).split(/\.(?:\s|$)/)[0].match(penRe);
    if (pm && !/^(uncertain|unresolved|shared|no|Highly)$/i.test(pm[1].trim())) {
      pens.push({ club: t.name, name: pm[1].trim(), hedged: HEDGE.test(sp) || /watch|uncertain/i.test(sp) });
    }
    for (const [dir, list] of [['In', t.ins], ['Out', t.outs]]) {
      for (const entry of list || []) {
        /* "Retained: …" and "Rumours: …" are group headers, not one player. */
        if (/^(retained|rumours?|more expected|cb from)/i.test(entry)) continue;
        const m = String(entry).match(moveRe);
        if (m) {
          moves.push({ club: t.name, dir, name: m[1].trim(), text: String(entry),
            hedged: HEDGE.test(entry) });
        }
      }
    }
    for (const f of t.fx || []) {
      const [gw, opp, band] = f;
      const mm = String(opp).match(/^(.*?)\s*\((H\??|A\??)\)\s*$/);
      if (!mm) continue;
      fixtures.push({ club: t.name, gw: +gw, opp: mm[1].trim(),
        home: mm[2][0] === 'H', band,
        /* "(H?)" is the briefing telling you it is not sure of the venue —
           Hull's GW1 is written exactly that way. */
        hedged: /\?/.test(mm[2]) });
    }
  }
  return { prices, pens, moves, fixtures, pensProse: pensProseClaims(teams) };
}

/* The set-piece line and the pick rationale, disagreeing with each other. No
   API needed — this is the document contradicting itself, so it is worth
   catching offline and it stays a finding even if the set-piece line turns out
   to be the wrong half.

   The two halves rarely write a player the same way, so a strict comparison
   invents contradictions. "Enzo Le Fee" in the pick is "Le Fee" in the
   set-piece line — same last token — but "Bruno Fernandes" is just "Bruno",
   where the shared token is the FIRST. So: equal last tokens, or one name is a
   single token that appears anywhere in the other. */
const toks = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’]/g, '').trim().split(/\s+/).filter(Boolean);
export function samePlayer(a, b) {
  const x = toks(a), y = toks(b);
  if (!x.length || !y.length) return false;
  if (x[x.length - 1] === y[y.length - 1]) return true;
  if (x.length === 1) return y.indexOf(x[0]) > -1;
  if (y.length === 1) return x.indexOf(y[0]) > -1;
  return false;
}
export function pensSelfContradictions(pens, pensProse) {
  const spOf = {};
  for (const c of pens || []) spOf[c.club] = c;
  const out = [];
  for (const c of pensProse || []) {
    const sp = spOf[c.club];
    if (!sp || samePlayer(sp.name, c.name)) continue;
    out.push({ club: c.club, field: c.field, prose: c.name, sp: sp.name,
      text: c.text, hedged: c.hedged });
  }
  return out;
}

/* ── Transfers, checked against each other ──────────────────
   A transfer between two clubs in this document is TWO claims: it is in one
   club's Out list and the other's In list. So one can exist without the
   other, and three times in three days it did — Welbeck left Brighton and
   never arrived at Chelsea, Henderson left Brentford and never arrived at
   Chelsea, Rushworth left Brighton and never arrived at Coventry. Each was
   caught by a human reading a newspaper, which is not a system.

   The consequence is not cosmetic. A missing arrival makes a squad look
   thinner than it is and hides a signing from the pick lists underneath —
   Rushworth is a first-choice goalkeeper the block simply did not have.

   Rumours are excluded: an unconfirmed exit has no counterpart by
   definition, and reporting one would train a reader to skip the output.
   Loans are NOT excluded — a completed loan has two ends like any other
   move, and the phrase "loan made permanent" carrying the word "loan" is
   what would have let Rushworth through a lazier filter. */
const RUMOUR = /rumou?r|unconfirmed|not confirmed|needs confirming|tbc|advanced talks|approach reported|links?\b/i;
export function moveContradictions(moves, clubNames) {
  const canon = clubMatcher(clubNames);
  const key = (v) => String(typeof v === 'string' ? v : (v && v.name) || '');
  const out = [];
  for (const m of moves || []) {
    if (!m.text || RUMOUR.test(m.text)) continue;
    /* The counterparty is named inside the first bracket, beside the
       position and the fee. Only a club that is itself in this document can
       be expected to carry the other half — a sale to Real Madrid has no
       counterpart here, and that is not an error. */
    const paren = (String(m.text).match(/\(([^)]*)\)/) || [])[1];
    if (!paren) continue;
    let other = null;
    for (const part of paren.split(/[,;]/)) {
      const t = part.trim().replace(/^~?£.*$/, '');
      if (!t || t.length < 3 || /^\d/.test(t)) continue;
      const hit = canon(t);
      if (hit && key(hit) !== key(m.club)) { other = key(hit); break; }
    }
    if (!other) continue;
    const want = m.dir === 'Out' ? 'In' : 'Out';
    const found = (moves || []).some((n) =>
      key(n.club) === other && n.dir === want && samePlayer(n.name, m.name));
    if (!found) {
      out.push({ club: key(m.club), dir: m.dir, name: m.name, other, want,
        msg: `${m.name}: ${key(m.club)} lists ${m.dir === 'Out' ? 'an exit to' : 'an arrival from'} ` +
          `${other}, but ${other} has no matching ${want} entry` });
    }
  }
  return out;
}

/* ── Internal consistency ───────────────────────────────────
   The fixture claims check each other, with no API involved. Every fixture is
   two claims — the club's and its opponent's — and the briefing states both
   independently, so they can disagree. They do: in GW1 Chelsea are "at
   Fulham" while Fulham are "at Chelsea", and Brentford and Tottenham both
   claim to be at home to each other.

   This runs before any network call because it needs none, and because a
   document that contradicts itself should be caught the moment it lands
   rather than the next time someone has an internet connection.

   `nameOf` maps a briefing label ("Forest", "Man Utd", "Spurs") to the club
   whose block it is, since the two are written differently. */
export function fixtureContradictions(fixtures, clubNames) {
  const canon = clubMatcher(clubNames);
  const out = [];
  const byGw = {};
  for (const f of fixtures) {
    const me = canon(f.club), them = canon(f.opp);
    if (!me || !them) continue;
    (byGw[f.gw] = byGw[f.gw] || []).push({ ...f, me, them });
  }
  for (const gw of Object.keys(byGw)) {
    const claims = byGw[gw];
    const by = {};
    for (const c of claims) by[c.me] = c;
    const seen = new Set();
    for (const c of claims) {
      const mirror = by[c.them];
      const pair = [c.me, c.them].sort().join(' v ');
      if (seen.has(gw + pair)) continue;
      if (!mirror) continue;                    /* the other club lists no GW that far */
      seen.add(gw + pair);
      if (mirror.them !== c.me) {
        out.push({ gw: +gw, kind: 'opponent',
          msg: 'GW' + gw + ': ' + c.me + ' says it plays ' + c.them + ', but ' + c.them +
            ' says it plays ' + mirror.them });
      } else if (mirror.home === c.home) {
        out.push({ gw: +gw, kind: 'venue',
          msg: 'GW' + gw + ': ' + c.me + ' and ' + c.them + ' BOTH claim to be ' +
            (c.home ? 'at home' : 'away') });
      }
    }
  }
  return out;
}

/* ── One club-name matcher ──────────────────────────────────
   The briefing, the fixture text and the API each write club names
   differently: "Nottingham Forest" / "Forest" / "Nott'm Forest", "Brighton &
   Hove Albion" / "Brighton" / "BHA". There were three separate matchers here
   with three separate bugs — one had its `includes` arguments the wrong way
   round, so "Brighton & Hove Albion" matched nothing and that club's fixtures
   were silently left uncorrected while everything around them was rewritten.

   One matcher, four rules in order of confidence: exact, short code, either
   string containing the other, then a distinctive word in common. */
/* The clubs whose everyday name shares no word with the API's. The app has
   carried this table since the match model was fitted (PLSIM_ALIAS in
   index.html) — the same handful, for the same reason. Duplicated rather than
   imported because this file must stay dependency-free, and a test asserts
   the two agree so they cannot drift apart. */
export const CLUB_ALIAS = {
  manchesterunited: 'manutd', manutd: 'manutd', manchestercity: 'mancity', mancity: 'mancity',
  tottenham: 'spurs', tottenhamhotspur: 'spurs', spurs: 'spurs',
  nottinghamforest: 'nottmforest', nottmforest: 'nottmforest', forest: 'nottmforest',
  newcastleunited: 'newcastle', newcastle: 'newcastle',
  brightonandhovealbion: 'brighton', brightonhovealbion: 'brighton', brighton: 'brighton',
  afcbournemouth: 'bournemouth', bournemouth: 'bournemouth',
  ipswichtown: 'ipswich', ipswich: 'ipswich', hullcity: 'hull', hull: 'hull',
  coventrycity: 'coventry', coventry: 'coventry', leedsunited: 'leeds', leeds: 'leeds',
  wolverhamptonwanderers: 'wolves', wolves: 'wolves',
};
export function clubMatcher(labels) {
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '');
  const STOP = new Set(['city', 'united', 'town', 'albion', 'hove', 'and', 'the', 'fc', 'hotspur', 'wanderers']);
  const rows = labels.map((l) => {
    const full = typeof l === 'string' ? l : l.name;
    const short = typeof l === 'string' ? '' : (l.short || '');
    const n = norm(full);
    const words = (String(full).toLowerCase().match(/[a-z]{3,}/g) || [])
      .filter((w) => !STOP.has(w));
    return { value: l, full, short, n, sn: norm(short), words };
  });
  return (label) => {
    const n = norm(label);
    if (!n) return null;
    let hit = rows.find((r) => r.n === n);
    if (hit) return hit.value;
    /* Aliases first after an exact hit: "Tottenham Hotspur" and "Spurs" share
       no word at all, so no amount of substring cleverness will bridge them. */
    const a = CLUB_ALIAS[n];
    if (a) { hit = rows.find((r) => CLUB_ALIAS[r.n] === a || r.n === a); if (hit) return hit.value; }
    hit = rows.find((r) => r.sn && r.sn === n);
    if (hit) return hit.value;
    /* Either direction — "Brighton" ⊂ "brightonhovealbion" AND the reverse. */
    const both = rows.filter((r) => r.n.includes(n) || n.includes(r.n));
    if (both.length === 1) return both[0].value;
    if (both.length > 1) return both.sort((a, b) => a.n.length - b.n.length)[0].value;
    /* "Nott'm Forest" vs "Nottingham Forest": no substring, one shared word
       once the generic ones are dropped — "forest" is in both.

       This used to accept a PREFIX relationship between words as well, and
       that was wrong in a way nothing looked at until transfers began being
       checked against each other. Every label this matcher was fed used to
       be a Premier League club, so a rule that also matched "Villarreal" to
       Aston Villa and "New England Revolution" to Newcastle never met a
       foreign club and never misfired. Fed the selling club out of a
       transfer line, it did both immediately.

       The prefix rule turns out to buy nothing: the cases it was written
       for are already caught earlier. "Nott'm Forest" shares the whole word
       "forest"; "Wolves", "Spurs" and "Man Utd" go through CLUB_ALIAS;
       "Brighton" inside "Brighton & Hove Albion" is a substring. A whole
       shared word is the rule, and a prefix is not a word. */
    const words = (String(label).toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !STOP.has(w));
    const byWord = rows.filter((r) => r.words.some((w) => words.includes(w)));
    return byWord.length === 1 ? byWord[0].value : null;
  };
}
