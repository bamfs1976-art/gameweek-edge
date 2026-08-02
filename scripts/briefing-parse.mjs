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
    const m = line.match(/Penalt(?:ies|y)\s+([A-ZÀ-Ý][\p{L}'’.-]*(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,2})/u);
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

