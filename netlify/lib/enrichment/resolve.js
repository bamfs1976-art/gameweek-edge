/* Gameweek Edge — entity resolution.
 *
 * Joining six providers means joining on names, and names are where this
 * project has been burned before: a surname split that dropped ten players
 * because of a trailing space, and prose mentions counted as squad
 * membership. Both were silent. So the rules here are:
 *
 *   - The official FPL id wins whenever a provider supplies one.
 *   - A name-only match REQUIRES club agreement. Never name alone.
 *   - More than one candidate is AMBIGUOUS and is returned for review, not
 *     resolved by picking the first.
 *   - Nothing is fuzzy-matched and silently accepted. There is no edit
 *     distance in this file by design.
 *
 * Club aliases are built from the authoritative FPL team list passed in, not
 * from a hard-coded seasonal array, so promotion and relegation need no code
 * change.
 */

/** Case-fold, strip diacritics, normalise apostrophes/hyphens, collapse space. */
function normalizeName(raw) {
  return String(raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // diacritics
    .replace(/[‘’ʼ′']/g, '')        // apostrophe variants -> nothing
    .replace(/[‐-―-]/g, ' ')                  // hyphen/dash variants -> space
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim().toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Surname heuristic used only as a secondary key, never on its own. */
function surnameOf(raw) {
  const parts = normalizeName(raw).split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/* Suffixes and prefixes that appear in one feed's club name and not another's. */
const CLUB_NOISE = /\b(fc|afc|association football club|football club|the)\b/g;

function normalizeClub(raw) {
  return normalizeName(raw).replace(CLUB_NOISE, ' ').trim().replace(/\s+/g, ' ');
}

/* Aliases that normalisation alone cannot bridge, because they are different
   words rather than different spellings. Keyed by normalised alias. Extend
   here rather than in an adapter — one table, testable in isolation. */
const EXTRA_ALIASES = {
  spurs: 'tottenham hotspur',
  tottenham: 'tottenham hotspur',
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'nottm forest': 'nottingham forest',
  "nott m forest": 'nottingham forest',
  forest: 'nottingham forest',
  wolves: 'wolverhampton wanderers',
  brighton: 'brighton hove albion',
  'brighton and hove albion': 'brighton hove albion',
  newcastle: 'newcastle united',
  leeds: 'leeds united',
  'west ham': 'west ham united',
  'sheffield utd': 'sheffield united',
  bournemouth: 'afc bournemouth',
  palace: 'crystal palace',
  hull: 'hull city',
  coventry: 'coventry city',
  ipswich: 'ipswich town',
  luton: 'luton town'
};

/**
 * Build a club resolver from the AUTHORITATIVE FPL team list.
 * @param {Array<{id:number,name:string,short_name?:string}>} fplTeams
 */
function buildClubIndex(fplTeams = []) {
  const byAlias = new Map();
  const add = (alias, team) => {
    const k = normalizeClub(alias);
    if (!k) return;
    /* First writer wins: a real FPL name must never be displaced by an alias
       that happens to normalise onto it. */
    if (!byAlias.has(k)) byAlias.set(k, team);
  };
  for (const t of fplTeams) {
    const team = { fpl_id: t.id, name: t.name, short_name: t.short_name || null };
    add(t.name, team);
    if (t.short_name) add(t.short_name, team);
    /* "Manchester City" -> also reachable as "city"? No: that is ambiguous
       across City sides. Only unambiguous extras go in EXTRA_ALIASES. */
  }
  for (const [alias, canonical] of Object.entries(EXTRA_ALIASES)) {
    const target = byAlias.get(normalizeClub(canonical));
    if (target) add(alias, target);
  }
  return {
    /** @returns {{fpl_id:number,name:string}|null} */
    resolve(raw) {
      if (!raw) return null;
      return byAlias.get(normalizeClub(raw)) || null;
    },
    size: byAlias.size
  };
}

/**
 * Build a player resolver over the authoritative FPL element list.
 * @param {Array<object>} elements FPL bootstrap `elements`
 * @param {ReturnType<buildClubIndex>} clubIndex
 */
function buildPlayerIndex(elements = [], clubIndex = null) {
  const byId = new Map();
  const byNameClub = new Map();   // "normname|teamid" -> [player]
  const bySurnameClub = new Map();

  const push = (map, key, p) => {
    if (!key) return;
    const arr = map.get(key) || [];
    arr.push(p);
    map.set(key, arr);
  };

  for (const e of elements) {
    const full = `${e.first_name || ''} ${e.second_name || ''}`.trim();
    const p = {
      fpl_id: e.id,
      display_name: e.web_name || full,
      full_name: full,
      normalized_name: normalizeName(full),
      normalized_web: normalizeName(e.web_name),
      surname: surnameOf(full),
      team_fpl_id: e.team,
      element_type: e.element_type
    };
    byId.set(e.id, p);
    push(byNameClub, `${p.normalized_name}|${p.team_fpl_id}`, p);
    if (p.normalized_web && p.normalized_web !== p.normalized_name) {
      push(byNameClub, `${p.normalized_web}|${p.team_fpl_id}`, p);
    }
    push(bySurnameClub, `${p.surname}|${p.team_fpl_id}`, p);
  }

  /**
   * Resolve one external record to an FPL player.
   *
   * @param {{fplId?:number|null, name?:string, club?:string}} input
   * @returns {{status:'resolved'|'ambiguous'|'unresolved', player?:object,
   *            candidates?:object[], reason:string, method?:string}}
   */
  function resolve({ fplId = null, name = '', club = '' } = {}) {
    if (fplId != null && byId.has(Number(fplId))) {
      return { status: 'resolved', player: byId.get(Number(fplId)), method: 'fpl_id', reason: 'provider supplied an FPL id' };
    }
    if (fplId != null) {
      return { status: 'unresolved', reason: `provider FPL id ${fplId} is not in the authoritative element list`, method: 'fpl_id' };
    }
    if (!name) return { status: 'unresolved', reason: 'no FPL id and no name' };

    /* Club agreement is REQUIRED for any name-based match. Without a club we
       stop here rather than matching on a name that several players share. */
    const team = clubIndex ? clubIndex.resolve(club) : null;
    if (!team) {
      return { status: 'unresolved', method: 'name', reason: club
        ? `club "${club}" did not resolve to an FPL team, so a name match was not attempted`
        : 'no club supplied, and this project does not match on name alone' };
    }

    const n = normalizeName(name);
    let hits = byNameClub.get(`${n}|${team.fpl_id}`) || [];
    let method = 'name+club';
    if (!hits.length) {
      hits = bySurnameClub.get(`${surnameOf(name)}|${team.fpl_id}`) || [];
      method = 'surname+club';
    }
    if (hits.length === 1) return { status: 'resolved', player: hits[0], method, reason: 'unique within club' };
    if (hits.length > 1) {
      return {
        status: 'ambiguous', method, candidates: hits.map((h) => ({ fpl_id: h.fpl_id, display_name: h.display_name })),
        reason: `${hits.length} players at ${team.name} match "${name}" — returned for review rather than guessed`
      };
    }
    return { status: 'unresolved', method, reason: `no player at ${team.name} matches "${name}"` };
  }

  return { resolve, byId, size: byId.size };
}

module.exports = { normalizeName, normalizeClub, surnameOf, buildClubIndex, buildPlayerIndex, EXTRA_ALIASES };
