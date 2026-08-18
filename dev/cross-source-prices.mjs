#!/usr/bin/env node
/* Cross-source FPL price agreement.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT REPLACES
 * ------------------------------------------
 * The first version of this check searched the benchmark FILES for a player's
 * name and then reached for a nearby "£X.Xm". It produced two false
 * corroborations on its first real run:
 *
 *   "Igor Thiago £8.0m <- also fpltips + LazyFPL"
 *        LazyFPL never stated Igor Thiago's price. The match came from a line
 *        in the LazyFPL capture that QUOTES fpltips' figure while recording it
 *        as an unresolved conflict.
 *
 *   "Haaland £15.5m <- also LazyFPL"
 *        That figure is OUR OWN REGISTER, quoted inside the LazyFPL capture in
 *        the course of recording a bug in an earlier price pass.
 *
 * A benchmark file is not a transcript of its source. It contains the source's
 * claims, our register's figures, other sources' figures, and the post-mortems
 * of our own parsing errors — all in the same prose. Searching it end to end
 * counts our own words as independent testimony. Manufacturing corroboration
 * is worse than manufacturing a conflict: a conflict gets investigated, and
 * agreement gets believed.
 *
 * It also missed Bruno Guimarães entirely, because the register spells him
 * with the diacritic and the capture without it.
 *
 * SO THIS VERSION SEARCHES NO PROSE AT ALL.
 * Each capture must declare `sourceStatedPrices` — an explicit list of what
 * THAT SOURCE said, and nothing else. A capture with no such field contributes
 * nothing and is NAMED in the output as not checkable, because a source that
 * is silent and a source that was never asked must not look the same.
 *
 * Two further rules, both from faults this project has already recorded:
 *
 *  - Names are compared with diacritics folded, so Guimarães and Guimaraes are
 *    one player.
 *  - A PRICE BAND IS NOT A PRICE. Hadley's tables group players under bracket
 *    labels like "£5.5m" and "£6m+". A bracket says the player is in a band,
 *    not that he costs exactly the label. Bands are reported as CONSISTENT or
 *    INCONSISTENT with an exact statement; they never count as one of the
 *    independent statements of a figure.
 *
 * Read-only. Prints a report and exits non-zero only on a genuine conflict.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const BENCH = path.join(ROOT, 'docs/benchmarks');
const BRIEFING = path.join(ROOT, 'docs/briefings/2026-27-preseason.md');

/* ---------------------------------------------------------------- names --- */

/** Fold diacritics, case and punctuation so Guimarães === Guimaraes. */
export function normName(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Link a short name to a longer one when the short name is a trailing word
 * sequence of exactly one longer name — "thiago" to "igor thiago".
 *
 * Ambiguity is refused, not guessed. If two long names end the same way the
 * short name stays its own key, so the report shows two rows rather than
 * silently merging two players. Same rule as resolve.js in the enrichment
 * layer, for the same reason.
 */
export function buildAliases(keys) {
  const alias = new Map();
  const longs = keys.filter((k) => k.includes(' '));
  for (const short of keys) {
    if (short.includes(' ')) continue;
    const hits = longs.filter((l) => l.split(' ').slice(-1)[0] === short);
    if (hits.length === 1) alias.set(short, hits[0]);
  }
  return alias;
}

/* ------------------------------------------------------------- register --- */

/**
 * Our own register's prices, read by anchoring on the price and scanning
 * BACKWARDS for the name that owns it.
 *
 * Direction matters. The forward version of this — find the name, then look
 * ahead for a price — is what produced "Haaland £500m vs settled £9.5m": it
 * jumped across a list of four players to the next marker, and the £9.5m
 * belonged to Saka. Anchoring on the price cannot jump, because the owning
 * name is whatever immediately precedes the opening bracket.
 *
 * TWO EXCLUSIONS, BOTH BECAUSE A FEE AND A GAME PRICE LOOK IDENTICAL.
 * "Marc Guehi (CB, Crystal Palace, £20m+, Jan)" is a transfer fee, and the
 * first run of this parser reported it as a £20.0m FPL price conflicting with
 * three sources' £6.0m. That is the Vuskovic/Van Hecke fault this project
 * already recorded once, reproduced by the very tool written to stop it.
 *
 *   1. The register's signing lines start "**In:**" or "**Out:**". Every
 *      figure on those lines is a fee. They are skipped wholesale.
 *   2. Nothing in FPL costs more than the most expensive player in the game.
 *      Anything above the ceiling is a fee that escaped rule 1.
 *
 * Both exclusions are COUNTED and returned, because a filter that silently
 * drops rows is indistinguishable from a source that never said anything.
 */
export const FPL_PRICE_CEILING_M = 16.0;

export function readRegister(md) {
  const out = new Map();
  const excluded = { onSigningLines: 0, aboveCeiling: [] };
  for (const line of md.split('\n')) {
    if (/^\s*\*\*(In|Out):\*\*/.test(line)) {
      excluded.onSigningLines += (line.match(/£\d/g) || []).length;
      continue;
    }
    /* Name, then an optional parenthetical qualifier, then the price. */
    const re = /([A-Z][\p{L}'’.-]*(?: [A-Z][\p{L}'’.-]*)*)\s*\((?:[^()£]{0,40}?,\s*)?(\*\*)?(~)?£(\d+(?:\.\d)?)m(?:,\s*published ([^*)]+))?/gu;
    let m;
    while ((m = re.exec(line))) {
      const [, name, , tilde, price, published] = m;
      const key = normName(name);
      if (!key || key.length < 3) continue;
      const value = parseFloat(price);
      if (value > FPL_PRICE_CEILING_M) { excluded.aboveCeiling.push(`${name} £${value}m`); continue; }
      const row = {
        name,
        price: value,
        estimate: Boolean(tilde),
        settled: Boolean(published),
        publishedOn: published ? published.trim() : null
      };
      /* A settled figure supersedes an estimate for the same player. */
      const prev = out.get(key);
      if (!prev || (row.settled && !prev.settled)) out.set(key, row);
    }
  }
  out.excluded = excluded;
  return out;
}

/* -------------------------------------------------------------- sources --- */

export function readCaptures(dir = BENCH) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const declared = [];
  const silent = [];
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const sp = json.sourceStatedPrices;
    if (!sp) { silent.push({ file: f, kind: json.kind || null }); continue; }
    declared.push({
      file: f,
      sourceId: sp.sourceId || f.replace(/\.json$/, ''),
      statedTotal: Number.isFinite(sp.statedTotal) ? sp.statedTotal : null,
      exact: Array.isArray(sp.exact) ? sp.exact : [],
      bands: Array.isArray(sp.bands) ? sp.bands : [],
      notEnumerated: sp.notEnumerated || null,
      /* "Two sources" is a count of files, not a measure of independence. One
         of these captures carries a platform AI-content label; another is the
         same author quoted twice. Where a capture knows something that
         weakens its own weight, it says so here and the report repeats it. */
      independence: sp.independence || null
    });
  }
  return { declared, silent };
}

/* ------------------------------------------------------------ agreement --- */

export function collate(captures, register) {
  /* `canonical` is how a capture pins an entry that the automatic surname
     alias would get wrong in either direction: "Guimaraes" and "B. Guimaraes"
     are one player and must merge, while the bare "Sangare" in one table is a
     THIRD Sangare and must not merge with the two the thread names. Neither is
     inferable from the strings, so both are declared in the data. */
  const nameOf = (e) => e.canonical || e.player;
  const keys = new Set();
  for (const c of captures) {
    for (const e of c.exact) keys.add(normName(nameOf(e)));
    for (const b of c.bands) keys.add(normName(nameOf(b)));
  }
  for (const k of register.keys()) keys.add(k);
  const alias = buildAliases([...keys]);
  const key = (n) => { const k = normName(n); return alias.get(k) || k; };

  const rows = new Map();
  const row = (n) => {
    const k = key(n);
    if (!rows.has(k)) rows.set(k, { key: k, display: n, exact: [], bands: [], register: null });
    return rows.get(k);
  };

  for (const c of captures) {
    for (const e of c.exact) row(nameOf(e)).exact.push({ source: c.sourceId, price: Number(e.price) });
    for (const b of c.bands) {
      row(nameOf(b)).bands.push({
        source: c.sourceId, floor: Number(b.floor),
        ceiling: b.ceiling === null || b.ceiling === undefined ? null : Number(b.ceiling),
        label: b.label || null
      });
    }
  }
  for (const [k, r] of register) {
    const target = rows.get(alias.get(k) || k);
    if (target) target.register = r;
  }

  const out = [];
  for (const r of rows.values()) {
    if (!r.exact.length && !r.bands.length) continue;
    const sources = [...new Set(r.exact.map((e) => e.source))];
    const prices = [...new Set(r.exact.map((e) => e.price))];
    const bandConflicts = r.bands.filter((b) =>
      r.exact.some((e) => e.price < b.floor - 1e-9 || (b.ceiling !== null && e.price > b.ceiling + 1e-9)));
    out.push({
      ...r,
      independentStatements: sources.length,
      agreedPrice: prices.length === 1 ? prices[0] : null,
      sourceConflict: prices.length > 1,
      bandConflicts,
      registerConflict: r.register && prices.length === 1 && !r.register.estimate
        && Math.abs(r.register.price - prices[0]) > 1e-9
    });
  }
  out.sort((a, b) => b.independentStatements - a.independentStatements || a.key.localeCompare(b.key));
  return out;
}

/* ----------------------------------------------------------------- main --- */

function main() {
  const md = fs.readFileSync(BRIEFING, 'utf8');
  const register = readRegister(md);
  const { declared, silent } = readCaptures();
  const rows = collate(declared, register);

  console.log('=== what this check can see ===');
  console.log(`register prices parsed: ${register.size} (${[...register.values()].filter((r) => r.settled).length} settled, `
    + `${[...register.values()].filter((r) => r.estimate).length} marked estimate)`);
  console.log(`  excluded as transfer fees: ${register.excluded.onSigningLines} on In:/Out: lines, `
    + `${register.excluded.aboveCeiling.length} above the £${FPL_PRICE_CEILING_M.toFixed(1)}m ceiling`
    + (register.excluded.aboveCeiling.length ? ` (${register.excluded.aboveCeiling.join(', ')})` : ''));
  for (const c of declared) {
    const enumerated = c.exact.length;
    const gap = c.statedTotal !== null && c.statedTotal > enumerated ? ` — ${c.statedTotal - enumerated} stated but NOT enumerated` : '';
    console.log(`  ${c.sourceId.padEnd(22)} ${String(enumerated).padStart(3)} exact, ${String(c.bands.length).padStart(3)} banded`
      + (c.statedTotal !== null ? `, ${c.statedTotal} stated${gap}` : ''));
    if (c.notEnumerated) console.log(`      ${c.notEnumerated}`);
    if (c.independence) console.log(`      independence: ${c.independence}`);
  }
  if (silent.length) {
    console.log('  captures declaring NO prices, so contributing nothing here:');
    for (const s of silent) console.log(`      ${s.file}`);
  }

  const corroborated = rows.filter((r) => r.independentStatements >= 2 && !r.sourceConflict);
  console.log(`\n=== ${corroborated.length} figures carrying two or more INDEPENDENT statements ===`);
  for (const r of corroborated) {
    const reg = r.register
      ? `  register ${r.register.estimate ? '~' : ''}£${r.register.price.toFixed(1)}m${r.register.settled ? ' (settled)' : ''}`
      : '  register holds no price';
    console.log(`  ${r.display.padEnd(20)} £${r.agreedPrice.toFixed(1)}m  <- ${r.exact.map((e) => e.source).join(' + ')}${reg}`);
  }

  const conflicts = rows.filter((r) => r.sourceConflict);
  console.log(`\n=== ${conflicts.length} figures where SOURCES DISAGREE ===`);
  for (const r of conflicts) {
    console.log(`  ${r.display.padEnd(20)} ${r.exact.map((e) => `${e.source} £${e.price.toFixed(1)}m`).join(' vs ')}`);
  }

  const regConf = rows.filter((r) => r.registerConflict);
  console.log(`\n=== ${regConf.length} figures conflicting with a NON-ESTIMATE register price ===`);
  for (const r of regConf) {
    console.log(`  ${r.display.padEnd(20)} sources £${r.agreedPrice.toFixed(1)}m vs register £${r.register.price.toFixed(1)}m`
      + (r.register.settled ? ` (settled ${r.register.publishedOn})` : ''));
  }

  const bandConf = rows.filter((r) => r.bandConflicts.length);
  console.log(`\n=== ${bandConf.length} figures outside a band another source put them in ===`);
  for (const r of bandConf) {
    for (const b of r.bandConflicts) {
      console.log(`  ${r.display.padEnd(20)} ${b.source} band ${b.label} vs stated `
        + r.exact.map((e) => `${e.source} £${e.price.toFixed(1)}m`).join(', '));
    }
  }

  const openRows = corroborated.filter((r) => !r.register);
  console.log(`\n=== ${openRows.length} corroborated figures our register still does not hold ===`);
  for (const r of openRows) {
    console.log(`  ${r.display.padEnd(20)} £${r.agreedPrice.toFixed(1)}m from ${r.independentStatements} sources`);
  }

  const bad = conflicts.length + regConf.length;
  console.log(`\n${bad === 0 ? 'No conflicts.' : `${bad} conflict(s) above need a source that can be held to them.`}`);
  process.exitCode = bad === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url))) main();
