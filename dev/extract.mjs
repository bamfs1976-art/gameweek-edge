/*
 * ONE brace matcher for the whole repository — and it is not this file's.
 *
 * The app is a single-file index.html, so there is nothing to import: every
 * suite and probe locates named functions in the source, brace-matches them
 * out, and evaluates them in a sandbox. EIGHTEEN files did that, with
 * FOURTEEN distinct implementations of the same scanner — copied, then
 * drifted, each repaired only when it happened to bite the file it was in.
 *
 * Two of those repairs never propagated, and both fail SILENTLY:
 *
 *   REGEX LITERALS. esc() is one line and contains /[&<>"']/ — a character
 *   class holding both quote marks. A scanner that knows strings but not
 *   regexes sees those quotes open and close phantom strings, loses the
 *   closing brace, and keeps going. Measured on the real file: 638 lines
 *   past the end of the function, dragging in 35 unrelated functions and 25
 *   top-level consts. Nothing threw. The harness was simply evaluating a
 *   large slice of the app nobody had asked for. Fifteen of the eighteen
 *   were blind to this.
 *
 *   THE `async` KEYWORD. It sits BEFORE the word `function`, so a scanner
 *   anchored on `function name(` slices from after it and drops it. If the
 *   body contains an await that is a SyntaxError, which is survivable. If it
 *   does not, the extraction succeeds and hands back a function returning a
 *   value where the app returns a promise — a test passing against semantics
 *   the app does not have. dev/test-congestion.mjs carried a hand-written
 *   `'async ' +` workaround, with a comment explaining the bug, for as long
 *   as the bug existed.
 *
 * THE SCANNER ITSELF IS scripts/extract-engine.mjs. That file already had
 * the best of the fourteen — the only one that also skips `${...}`
 * interpolation inside template literals, and the only one with a test file
 * of its own (dev/test-engine.mjs, "braces that are not braces"). It is the
 * build-time extractor for the shared engine bundle, where an over-capture
 * would ship half the app to a renderer, so it was written carefully.
 *
 * Consolidating onto a fresh implementation here would have replaced
 * fourteen scanners with fifteen, and the survivor would have been weaker
 * than one it displaced. So this file adds no scanner. It delegates, and
 * supplies the small conveniences the callers actually differ over: pulling
 * a function by name, a const, an array const, a whole line.
 */
import { sliceBalanced } from '../scripts/extract-engine.mjs';

/* Brace-match from `startIdx` to the closing brace of the first block after
   it. Kept under the name every caller already used. */
export function extractBlock(src, startIdx) {
  return sliceBalanced(src, startIdx);
}

/* A named function declaration, `async` included when it is there. */
export function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('function not found: ' + name);
  const pre = src.slice(Math.max(0, idx - 10), idx);
  return (/\basync\s+$/.test(pre) ? 'async ' : '') + extractBlock(src, idx);
}

/* A `const NAME={...}` object literal, terminated. */
export function extractConst(src, name) {
  const idx = src.indexOf('const ' + name + '=');
  if (idx < 0) throw new Error('const not found: ' + name);
  return extractBlock(src, idx) + ';';
}

/* extractConst brace-matches from the first `{`, which is right for an
   object literal and wrong for an array of them: `const X=[{a},{b}]` gives
   back just `{a}`. Array constants get their own extractor rather than a
   reshaped source, because the source should read the way it wants to. */
export function extractArrayConst(src, name) {
  const idx = src.indexOf('const ' + name + '=[');
  if (idx < 0) throw new Error('array const not found: ' + name);
  return sliceBalanced(src, idx, '[', ']') + ';';
}

/* A whole single-line declaration, for scalars and one-liners. */
export function extractDecl(src, name) {
  const i = src.indexOf('const ' + name + '=');
  if (i < 0) throw new Error('declaration not found: ' + name);
  return src.slice(i, src.indexOf('\n', i));
}

/* Some names exist both at top level and shadowed inside a function; anchor
   to the line start so a sandbox gets the one the app's top-level code
   sees. */
export function extractTopDecl(src, name) {
  const i = src.indexOf('\nconst ' + name + '=');
  if (i < 0) throw new Error('top-level declaration not found: ' + name);
  return src.slice(i + 1, src.indexOf('\n', i + 1));
}

/* The first line matching a pattern, verbatim. */
export function extractLine(src, re) {
  const m = src.match(re);
  if (!m) throw new Error('line not found: ' + re);
  return m[0];
}

/* Most callers work against one source and want `grabFn('name')` rather than
   `extractFn(html, 'name')`. This binds the family to a source so the call
   sites read the way they always did. */
export function binder(src) {
  return {
    src,
    block: (i) => extractBlock(src, i),
    fn: (n) => extractFn(src, n),
    konst: (n) => extractConst(src, n),
    arrayKonst: (n) => extractArrayConst(src, n),
    decl: (n) => extractDecl(src, n),
    topDecl: (n) => extractTopDecl(src, n),
    line: (re) => extractLine(src, re),
  };
}
