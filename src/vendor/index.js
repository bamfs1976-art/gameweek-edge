/*
 * Third-party runtime libraries, bundled into www/vendor.js.
 *
 * index.html is copied VERBATIM into www/ — it is not run through esbuild —
 * so a library cannot be imported from the inline script. This entry point
 * is the seam: esbuild bundles the three dependencies here and publishes
 * them on `window`, and the inline script uses them like any other global,
 * exactly as it already does with native.js and auth.js.
 *
 * No CDN tags. Everything ships from our own origin, is precached by the
 * service worker, and is pinned in package-lock.json.
 *
 * Licences (full text in LICENSES.md):
 *   uPlot   MIT        © Leon Sorokin        github.com/leeoniya/uPlot
 *   Fuse.js Apache-2.0 © Kiro Risk           github.com/krisk/Fuse
 *   tinykeys MIT       © Jamie Kyle          github.com/jamiebuilds/tinykeys
 *
 * tinykeys is deliberately named here with its repository: there is an
 * unrelated GPL-licensed "tinykeys" P5.js project, and taking that one by
 * mistake would put a copyleft licence into a closed shell. The package we
 * depend on declares `"repository": "jamiebuilds/tinykeys"` and MIT, and
 * dev/test-core.mjs asserts both from node_modules so the check survives a
 * careless `npm install`.
 */
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import Fuse from 'fuse.js';
import { tinykeys, createKeybindingsHandler } from 'tinykeys';

window.uPlot = uPlot;
window.Fuse = Fuse;
window.tinykeys = tinykeys;
window.createKeybindingsHandler = createKeybindingsHandler;
