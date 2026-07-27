/* Convenience wrapper so `npm run build:ucl` works from the repo root.
   The real build lives in ucl/build.mjs, next to the site it builds, because
   that is where Netlify runs it from (base directory `ucl`). */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..', 'ucl'));
await import('../ucl/build.mjs');
