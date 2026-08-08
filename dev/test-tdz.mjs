/*
 * Top-level temporal-dead-zone guard.
 *
 * Run: node dev/test-tdz.mjs   (wired into CI)
 *
 * Why this file exists.
 *
 * Consolidating panels into hubs added this line at ~3690:
 *
 *   const HUB_SETVIEW={...,seasonsim:SM_HUB.setView,...};
 *
 * SM_HUB is a `const` declared about three thousand lines further down. The
 * other entries in that map are function declarations, which hoist, so the
 * shape looked identical and read fine. It is not fine: reading `.setView`
 * off a const in its temporal dead zone throws, and because this is a single
 * inline script, that one throw abandons the rest of the file. Nothing after
 * it is defined. The page renders its shell and then does nothing at all.
 *
 * Twenty test files were green while the site was a blank husk, because every
 * one of them extracts a slice of the script and exercises it in isolation —
 * exactly the arrangement that cannot see an ordering fault between slices.
 * A browser found it in one second; CI has no browser (dev/smoke.mjs needs
 * one, which is why it sits outside `npm test`). This is the cheap check that
 * closes the gap without one.
 *
 * What it checks: every top-level `const`/`let` initialiser, for a reference
 * to a top-level `const`/`let` binding declared LATER in the file, where that
 * reference is evaluated eagerly.
 *
 * "Eagerly" is the crux, and the reason this is not a two-line regex. The fix
 * for the bug above was `seasonsim:v=>SM_HUB.setView(v)` — textually the same
 * reference, but inside an arrow body, so it resolves when the hub is used
 * rather than when the map is built. A checker that cannot tell those apart
 * would fail the fix and be turned off within a week. So the scanner marks
 * everything from a `=>` or `function` up to the end of that element as
 * deferred, and ignores it.
 *
 * Known limits, stated rather than papered over:
 *  - Only top-level (column-0) declarations. Everything in this file that can
 *    exhibit the fault is at column 0; nested scopes are the compiler's job.
 *  - The deferral rule is lexical, not a parse. A deferred region ends at the
 *    next comma at the depth the `=>` was found, or when that bracket closes.
 *  - Class declarations are not tracked (the file has none).
 * It will not catch every TDZ fault in every codebase. It catches this one,
 * and the next one shaped like it, which is what it is for.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---- pull the inline script out of index.html ---- */
export function inlineScript(html) {
  const parts = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) parts.push(m[1]);
  /* The app script is the big one; the others are JSON-LD and tiny shims. */
  return parts.sort((a, b) => b.length - a.length)[0] || '';
}

/* ---- blank out strings, template literals, comments and regex literals ----
   Replaced with spaces rather than removed so every offset still lines up
   with the original, which keeps the reported line numbers honest. */
export function blankNonCode(src) {
  /* split('') and not [...src]: the spread iterates code points, so a single
     emoji anywhere above would shift every later array index one place off
     the string offsets these functions index by, silently blanking the wrong
     characters. This file has emoji. */
  const out = src.split('');
  const blank = (from, to) => { for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  const prevMeaningful = (at) => { let j = at - 1; while (j >= 0 && /\s/.test(src[j])) j--; return src[j] || ''; };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { let j = src.indexOf('\n', i); if (j < 0) j = src.length; blank(i, j); i = j; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const end = j < 0 ? src.length : j + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        /* ${...} inside a template can hold real code, but nothing in this
           file defers through one, so blanking it whole is safe and simple. */
        j++;
      }
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === '/') {
      /* Regex literal vs division: decided by what precedes it. */
      const p = prevMeaningful(i);
      if (p && /[\w$)\]]/.test(p)) { i++; continue; }
      let j = i + 1, cls = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        else if (src[j] === '\n') { j = -1; break; }
        j++;
      }
      if (j > 0) { blank(i + 1, j); i = j + 1; continue; }
      i++; continue;
    }
    i++;
  }
  return out.join('');
}

/* ---- top-level const/let declarations, in source order ---- */
export function topLevelBindings(code) {
  const found = [];
  const re = /^(const|let)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(code))) found.push({ name: m[2], at: m.index, kind: m[1] });
  return found;
}

/* Extent of the initialiser: from the `=` to the `;` that closes the
   statement at bracket depth zero. */
function initialiserRange(code, declStart) {
  const eq = code.indexOf('=', declStart);
  if (eq < 0) return null;
  let depth = 0;
  for (let i = eq + 1; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return [eq + 1, i];
  }
  return [eq + 1, code.length];
}

/* Identifiers in `text` that are evaluated eagerly — i.e. not sitting inside
   an arrow or function body. Returns [{name, offset}] with offsets absolute. */
export function eagerIdentifiers(code, from, to) {
  const text = code.slice(from, to);
  const out = [];
  /* deferDepth: bracket depth at which a `=>`/`function` was seen. Null when
     nothing is deferred. Cleared by a comma at that depth, or by that bracket
     closing (depth dropping below it). */
  let depth = 0, deferAt = null;
  const idRe = /[A-Za-z_$][\w$]*/y;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; if (deferAt !== null && depth < deferAt) deferAt = null; continue; }
    if (c === ',' && deferAt !== null && depth === deferAt) { deferAt = null; continue; }
    if (c === '=' && text[i + 1] === '>') { if (deferAt === null) deferAt = depth; i++; continue; }
    if (!/[A-Za-z_$]/.test(c)) continue;
    idRe.lastIndex = i;
    const m = idRe.exec(text);
    if (!m) continue;
    const word = m[0];
    i = idRe.lastIndex - 1;
    if (word === 'function') { if (deferAt === null) deferAt = depth; continue; }
    /* A property name never resolves a binding. Two shapes to skip:
       `.foo`, and an object key `{foo:` / `,foo:`. The key test needs the
       character BEFORE as well as the colon after, because `cond?foo:bar`
       also puts an identifier in front of a colon — and there `foo` is a
       genuine reference. Shorthand `{foo}` is a genuine reference too, and
       correctly falls through. */
    let p = from + m.index - 1; while (p >= from && /\s/.test(code[p])) p--;
    if (code[p] === '.') continue;
    let n = from + idRe.lastIndex; while (n < to && /\s/.test(code[n])) n++;
    if (code[n] === ':' && (p < from || code[p] === '{' || code[p] === ',')) continue;
    if (deferAt !== null) continue;
    out.push({ name: word, offset: from + m.index });
  }
  return out;
}

/* ---- run ---- */
const lineOf = (code, off) => code.slice(0, off).split('\n').length;

export function findTdz(script, lineBase = 0) {
  const code = blankNonCode(script);
  const decls = topLevelBindings(code);
  const declAt = new Map();
  for (const d of decls) if (!declAt.has(d.name)) declAt.set(d.name, d.at);

  const faults = [];
  for (const d of decls) {
    const range = initialiserRange(code, d.at);
    if (!range) continue;
    for (const ref of eagerIdentifiers(code, range[0], range[1])) {
      const at = declAt.get(ref.name);
      if (at === undefined || at <= d.at) continue;
      faults.push({
        holder: d.name, ref: ref.name,
        usedLine: lineBase + lineOf(code, ref.offset), declLine: lineBase + lineOf(code, at),
      });
    }
  }
  return faults;
}


/* The scanner needs its own guard. A checker that quietly stops discriminating
   is worse than no checker: it keeps printing OK. Half of these assert it
   FIRES, half assert it stays quiet — a scanner tuned until it never
   complains would pass the first half and a paranoid one would pass the
   second, so both halves have to hold. */
const SELF_CHECK = [
  ['plain forward ref',    'const A=B;\nconst B=1;', 1],
  ['property forward ref', 'const A={x:B.y};\nconst B={y:1};', 1],
  ['ternary before colon', 'const A=1?B:2;\nconst B=1;', 1],
  ['shorthand property',   'const A={B};\nconst B=1;', 1],
  ['array element',        'const A=[B];\nconst B=1;', 1],
  ['deferred arrow',       'const A={x:v=>B.y(v)};\nconst B={y:()=>0};', 0],
  ['deferred function',    'const A={x:function(){return B.y;}};\nconst B={y:1};', 0],
  ['backward ref',         'const B=1;\nconst A=B;', 0],
  ['name only in string',  'const A="B";\nconst B=1;', 0],
  ['name only in comment', 'const A=1; /* B */\nconst B=1;', 0],
  ['object key',           'const A={B:1};\nconst B=2;', 0],
  ['nested object key',    'const A={x:{B:1}};\nconst B=2;', 0],
];

function selfCheck() {
  const bad = [];
  for (const [name, src, want] of SELF_CHECK) {
    const got = findTdz(src).length;
    if (got !== want) bad.push(`  ${name}: expected ${want} fault(s), got ${got}`);
  }
  if (bad.length) {
    console.error('TDZ scanner self-check failed — the guard is not discriminating:');
    console.error(bad.join('\n'));
    process.exit(1);
  }
  return SELF_CHECK.length;
}

function main() {
const cases = selfCheck();
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = inlineScript(html);
if (script.length < 100000) {
  console.error(`could not find the app script in index.html (got ${script.length} chars)`);
  process.exit(1);
}

/* Report index.html line numbers, not offsets into the extracted script —
   a failure message you have to do arithmetic on is a failure message people
   learn to ignore. */
const lineBase = html.slice(0, html.indexOf(script)).split('\n').length - 1;
const faults = findTdz(script, lineBase);
if (faults.length) {
  console.error('TDZ: a top-level const/let is read before it is initialised.');
  console.error('The whole inline script aborts at that point — the page will be dead.\n');
  for (const f of faults) {
    console.error(`  ${f.holder} (line ${f.usedLine}) reads ${f.ref}, declared at line ${f.declLine}`);
  }
  console.error('\nEither move the declaration above its use, or defer the read into');
  console.error('an arrow body so it resolves at call time rather than at parse time.');
  process.exit(1);
}

console.log(`TDZ guard OK: ${cases} scanner self-checks, `
  + `${topLevelBindings(blankNonCode(script)).length} top-level bindings, none read early`);
}

/* Last line, and it has to be: main() reads SELF_CHECK, a const declared
   above it. Called any earlier and this file dies of exactly the fault it
   exists to catch — which is how the first draft behaved. The scanner only
   inspects index.html, so it would never have looked at itself.

   Importable too: `import { findTdz }` gets the scanner without the exit. */
if (process.argv[1] && process.argv[1].endsWith('test-tdz.mjs')) main();
