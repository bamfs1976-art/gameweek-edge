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

