/* Gameweek Edge — the exact-plan solver, off the main thread.

   The page posts { id, lp, options }; this worker loads the vendored HiGHS
   engine once (vendor/highs.js + highs.wasm, fetched on first use and
   cached by the browser), solves, and posts { id, result } or { id, error }.
   A solve can take several seconds on an eight-gameweek plan, and on the
   main thread that is a frozen page. First-party, not vendored. */
self.window = self;   /* the vendored wrapper publishes window.HiGHSLoader */
let ready = null;
function engine() {
  if (!ready) {
    importScripts(new URL('../vendor/highs.js', self.location.href).href);
    ready = self.HiGHSLoader({ locateFile: (f) => new URL('../vendor/' + f, self.location.href).href });
  }
  return ready;
}
self.onmessage = async (ev) => {
  const { id, lp, options } = ev.data || {};
  try {
    const highs = await engine();
    const r = highs.solve(lp, options || {});
    /* Only what the page reads: status, objective, and each column's value. */
    const cols = {};
    for (const k of Object.keys(r.Columns || {})) cols[k] = { Primal: r.Columns[k].Primal };
    self.postMessage({ id, result: { Status: r.Status, ObjectiveValue: r.ObjectiveValue, Columns: cols } });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  }
};
