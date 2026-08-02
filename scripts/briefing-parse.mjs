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
        out.push({ club: b.name, dir, name: m[1].trim(),
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
        if (m) moves.push({ club: t.name, dir, name: m[1].trim(), hedged: HEDGE.test(entry) });
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
  return { prices, pens, moves, fixtures };
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
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
  const canon = (label) => {
    const n = norm(label);
    let best = null;
    for (const c of clubNames) {
      const cn = norm(c);
      if (cn === n) return c;
      /* "Forest" ⊂ "nottinghamforest", "Man Utd" ⊄ anything by substring, so
         also try the distinctive word. */
      if (cn.includes(n) || n.includes(cn)) { if (!best || c.length < best.length) best = c; }
    }
    if (best) return best;
    const words = n.match(/[a-z]{3,}/g) || [];
    for (const c of clubNames) { if (words.some((w) => norm(c).includes(w))) return c; }
    return null;
  };
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
