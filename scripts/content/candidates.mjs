/*
 * Daily content — the candidate builders.
 *
 * Pure functions: data in, candidate stories out. No network, no clock, no
 * filesystem, so every builder can be exercised against synthetic seasons in
 * dev/test-content.mjs — which matters because the states worth testing (a
 * club five games into a run, a template pick walking into a wall) are
 * exactly the ones a live feed will not be in when you happen to look.
 *
 * None of them force a result. On a quiet day the correct number of
 * candidates is zero, and the selector's floor turns that into silence
 * rather than filler.
 */

export const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
export const money = (c) => '£' + (c / 10).toFixed(1) + 'm';

/* Best option in each half-million band, per position, and how clear it is. */
export function priceVerdicts(idx, xp, teamName) {
  const out = [];
  for (const type of [1, 2, 3, 4]) {
    const bands = {};
    idx.elements.forEach((e) => {
      if (e.element_type !== type || xp[e.id] == null) return;
      const band = Math.round(e.now_cost / 5) * 5;      /* half-million buckets */
      (bands[band] = bands[band] || []).push(e);
    });
    for (const [band, list] of Object.entries(bands)) {
      if (list.length < 3) continue;                    /* no verdict without a field */
      const ranked = list.sort((a, b) => xp[b.id] - xp[a.id]);
      const gap = xp[ranked[0].id] - xp[ranked[1].id];
      out.push({
        kind: 'price-verdict', subject: String(ranked[0].id),
        headline: `The best ${POS[type]} at ${money(Number(band))}`,
        sub: `${ranked.length} options at the price, ranked by our projected points`,
        effect: { gap },
        data: {
          band: money(Number(band)), position: POS[type],
          rows: ranked.slice(0, 4).map((e) => ({
            name: e.web_name, team: teamName(e.team), xp: +xp[e.id].toFixed(2),
            cost: money(e.now_cost), owned: parseFloat(e.selected_by_percent || '0')
          }))
        }
      });
    }
  }
  return out;
}

export function differentials(idx, xp, teamName) {
  return idx.elements
    .filter((e) => xp[e.id] != null && parseFloat(e.selected_by_percent || '0') < 8)
    .sort((a, b) => xp[b.id] - xp[a.id])
    .slice(0, 6)
    .map((e) => ({
      kind: 'differential', subject: String(e.id),
      headline: `${e.web_name} is barely owned`,
      sub: `${POS[e.element_type]} · ${teamName(e.team)} · ${money(e.now_cost)}`,
      effect: { xp: xp[e.id], ownership: parseFloat(e.selected_by_percent || '0') },
      data: { name: e.web_name, team: teamName(e.team), position: POS[e.element_type],
        cost: money(e.now_cost), xp: +xp[e.id].toFixed(2),
        owned: parseFloat(e.selected_by_percent || '0') }
    }));
}

export function templateRisks(idx, next, teamName) {
  return idx.elements
    .filter((e) => parseFloat(e.selected_by_percent || '0') > 20 && next[e.team])
    .map((e) => ({ e, d: next[e.team].difficulty }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 5)
    .map(({ e, d }) => ({
      kind: 'template-risk', subject: String(e.id),
      headline: `A hard week for ${e.web_name} owners`,
      sub: `${next[e.team].home ? 'Home to' : 'Away to'} ${teamName(next[e.team].opp)}`,
      effect: { ownership: parseFloat(e.selected_by_percent || '0'), difficulty: d },
      data: { name: e.web_name, team: teamName(e.team),
        owned: parseFloat(e.selected_by_percent || '0'),
        opponent: teamName(next[e.team].opp), home: next[e.team].home,
        difficulty: +d.toFixed(1) }
    }));
}

export function valuePicks(idx, teamName) {
  const ppm = (e) => (e.now_cost ? (e.total_points || 0) / (e.now_cost / 10) : 0);
  const byPos = {};
  idx.elements.filter((e) => (e.minutes || 0) > 450)
    .forEach((e) => { (byPos[e.element_type] = byPos[e.element_type] || []).push(e); });
  const out = [];
  for (const [type, list] of Object.entries(byPos)) {
    if (list.length < 5) continue;
    const vals = list.map(ppm).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    const best = list.sort((a, b) => ppm(b) - ppm(a))[0];
    out.push({
      kind: 'value', subject: String(best.id),
      headline: `${best.web_name} is the ${POS[type]} bargain`,
      sub: `Points per £m, measured against the ${POS[type]} median`,
      effect: { ppm: ppm(best), medianPpm: median },
      data: { name: best.web_name, team: teamName(best.team), position: POS[type],
        cost: money(best.now_cost), points: best.total_points || 0,
        ppm: +ppm(best).toFixed(1), medianPpm: +median.toFixed(1) }
    });
  }
  return out;
}

export function purplePatches(runs, teamName, weeks = 5) {
  return Object.entries(runs)
    .map(([team, run]) => {
      const slice = run.slice(0, weeks);
      if (slice.length < 3) return null;
      const avg = slice.reduce((a, r) => a + r.difficulty, 0) / slice.length;
      return { team: Number(team), avg, slice };
    })
    .filter(Boolean)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 4)
    .map(({ team, avg, slice }) => ({
      kind: 'purple-patch', subject: String(team),
      headline: `${teamName(team)} hit a good run`,
      sub: `${slice.length} fixtures averaging ${avg.toFixed(1)} out of 5 for difficulty`,
      effect: { avgDifficulty: avg, weeks: slice.length },
      data: { team: teamName(team), avgDifficulty: +avg.toFixed(1),
        fixtures: slice.map((r) => ({ gw: r.event, opp: teamName(r.opp),
          home: r.home, difficulty: +r.difficulty.toFixed(1) })) }
    }));
}

/* How much a club's fixtures improve between the next few and the ones after
   — the "wait, then buy" story those wildcard-planning posts are made of. */
export function fixtureSwings(runs, teamName, span = 3) {
  return Object.entries(runs)
    .map(([team, run]) => {
      if (run.length < span * 2) return null;
      const near = run.slice(0, span).reduce((a, r) => a + r.difficulty, 0) / span;
      const later = run.slice(span, span * 2).reduce((a, r) => a + r.difficulty, 0) / span;
      return { team: Number(team), swing: near - later, near, later, run };
    })
    .filter((x) => x && x.swing > 0)
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 4)
    .map(({ team, swing, near, later, run }) => ({
      kind: 'fixture-swing', subject: String(team),
      headline: `${teamName(team)}'s fixtures ease off`,
      sub: `Next ${span} average ${near.toFixed(1)}; the ${span} after average ${later.toFixed(1)}`,
      effect: { swing },
      data: { team: teamName(team), before: +near.toFixed(1), after: +later.toFixed(1),
        fixtures: run.slice(0, span * 2).map((r) => ({ gw: r.event, opp: teamName(r.opp),
          home: r.home, difficulty: +r.difficulty.toFixed(1) })) }
    }));
}

/* ── Best fixture run ────────────────────────────────────────────────
   The community's pre-season staple: every club's kindest stretch, ranked,
   with the window named. The distinction from purplePatches is the whole
   point — that one reads the OPENING five gameweeks, which answers "who
   starts well". This asks "when is each club at its easiest, anywhere in the
   horizon", which is the question a transfer plan is actually built on. A
   club whose best run is GW9-13 is a club to wait for, and nothing that only
   reads the opening can tell you that.

   Windows of RUN_MIN..RUN_MAX are all considered and the best-scoring one
   per club wins. Longer is better at equal difficulty, because four kind
   fixtures is a plan and two is a coincidence — but only mildly, or every
   club's answer would be "the longest window available". */
export const RUN_MIN = 3;
export const RUN_MAX = 6;
export const RUN_LENGTH_TILT = 0.06;

export function bestRun(run, min = RUN_MIN, max = RUN_MAX) {
  let best = null;
  for (let len = min; len <= max; len++) {
    for (let i = 0; i + len <= run.length; i++) {
      const slice = run.slice(i, i + len);
      const avg = slice.reduce((a, r) => a + r.difficulty, 0) / len;
      /* Score is difficulty with a small bonus per extra fixture, so a
         genuinely easier short run still beats a mediocre long one. */
      const scoreV = avg - RUN_LENGTH_TILT * (len - min);
      if (!best || scoreV < best.score) best = { score: scoreV, avg, slice, len };
    }
  }
  return best;
}

export function fixtureRuns(runs, teamName, limit = 5) {
  return Object.entries(runs)
    .map(([team, run]) => {
      if (!run || run.length < RUN_MIN) return null;
      const b = bestRun(run);
      return b ? { team: Number(team), ...b } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ team, avg, slice, len }) => {
      const from = slice[0].event, to = slice[slice.length - 1].event;
      return {
        kind: 'fixture-run', subject: String(team),
        headline: `${teamName(team)}'s best run is GW${from}–${to}`,
        sub: `${len} fixtures averaging ${avg.toFixed(1)} out of 5 for difficulty`,
        effect: { avgDifficulty: avg, weeks: len },
        data: { team: teamName(team), from, to, avgDifficulty: +avg.toFixed(1),
          fixtures: slice.map((r) => ({ gw: r.event, opp: teamName(r.opp),
            home: r.home, difficulty: +r.difficulty.toFixed(1) })) }
      };
    });
}

/* ── Chip windows ────────────────────────────────────────────────────
   The `chip-window` kind has existed in stories.mjs since the pipeline was
   written and nothing has ever produced one, so it could never be picked —
   a declared story type that was unreachable code, exactly like the
   set-piece tag in the club threads.

   `plan` is the app's own chipPlanFdr output, so the card and the Chip
   Strategy panel cannot disagree. Only picks carrying a real EDGE are
   offered: the planner computes how much better the chosen week is than an
   average one, and a live run showed a whole half where every gameweek sat
   within 0.1 FDR of the mean. Posting a confident chip week off that would
   be false precision, so a flat half simply produces no candidate. */
export const CHIP_MIN_EDGE = 0.15;
const CHIP_LABELS = { wildcard: 'Wildcard', benchboost: 'Bench Boost',
  triplecaptain: 'Triple Captain', freehit: 'Free Hit' };

export function chipWindows(plan, teamName) {
  if (!plan || !plan.picks) return [];
  return Object.keys(CHIP_LABELS)
    .map((key) => {
      const p = plan.picks[key];
      if (!p || p.gw == null) return null;
      /* A blank or a double is a hard calendar fact and needs no edge; the
         difficulty-ranked picks do. */
      const firm = !!(p.blank || p.double);
      const edge = p.edge != null ? p.edge : 0;
      if (!firm && edge < CHIP_MIN_EDGE) return null;
      /* The subtitle is the caveat rather than the reason. The headline
         already names the chip and the week and the card body carries the
         number behind it, so a subtitle repeating either would make the
         card say one thing three times — and the qualifier is the part a
         reader is most likely to skip and most needs. */
      return {
        kind: 'chip-window', subject: key,
        headline: `${CHIP_LABELS[key]} looks like GW${p.gw}`,
        sub: p.provisional
          ? 'A window, not an instruction — and the fixture list this far out can still move'
          : 'A window, not an instruction — your own squad decides the week',
        /* The kind normalises on edge; a firm blank or double is maximal. */
        effect: { edge: firm ? 15 : edge * 15 },
        data: { chip: CHIP_LABELS[key], gw: p.gw, edge: +edge.toFixed(2),
          blank: p.blank || 0, double: p.double || 0,
          afterBreak: p.afterBreak || 0, congested: p.congested || 0,
          provisional: !!p.provisional,
          player: p.el ? p.el.web_name : null,
          opponent: p.opp != null && teamName ? teamName(p.opp) : null }
      };
    })
    .filter(Boolean);
}
