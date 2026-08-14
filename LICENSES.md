# Third-party licences

Every library bundled into the shipped app, with its licence and where the
code comes from. MIT and Apache-2.0 only — nothing copyleft goes into this
repository.

The three below are bundled from `node_modules` into `www/vendor.js` by
`scripts/build-web.mjs` (entry point `src/vendor/index.js`). They are not
loaded from a CDN: the shell has to work offline, the service worker
precaches them, and the exact versions are pinned by `package-lock.json`
rather than by somebody else's edge cache.

`dev/test-core.mjs` asserts the licence and repository of all three straight
from `node_modules`, so a wrong package cannot arrive unnoticed through a
careless install.

---

## uPlot

- **Licence** MIT
- **Copyright** © Leon Sorokin
- **Source** https://github.com/leeoniya/uPlot
- **Version** see `package-lock.json` (`uplot`)
- **Used for** every chart in the app: table sparklines, the overall-rank
  trajectory, and the player-detail form and price series. Its stylesheet is
  bundled alongside as `www/vendor.css` and themed in `index.html`.

```
The MIT License (MIT)

Copyright (c) 2024 Leon Sorokin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Fuse.js

- **Licence** Apache-2.0
- **Copyright** © Kiro Risk
- **Source** https://github.com/krisk/Fuse
- **Version** see `package-lock.json` (`fuse.js`)
- **Used for** the ⌘K command palette's fuzzy, typo-tolerant search, with
  weighted keys (command name > aliases > description).

Apache-2.0 is reproduced in full at https://www.apache.org/licenses/LICENSE-2.0
and shipped in the package at `node_modules/fuse.js/LICENSE`. The notice
required by section 4:

```
Fuse.js
Copyright (c) Kiro Risk

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## tinykeys

- **Licence** MIT
- **Copyright** © Jamie Kyle
- **Source** https://github.com/jamiebuilds/tinykeys
- **Version** see `package-lock.json` (`tinykeys`)
- **Used for** all keyboard chords and shortcuts: the ⌘K palette toggle, the
  eleven `g <key>` navigation chords, `j`/`k` row-walking, `?` and Escape.

**Note on identity.** There is an unrelated **GPL-licensed** project also
called "tinykeys" (a P5.js library). This is not that project. The package
depended on here declares `"repository": "jamiebuilds/tinykeys"` and
`"license": "MIT"`, and `dev/test-core.mjs` asserts both from `node_modules`
so the distinction is enforced rather than remembered.

```
MIT License

Copyright (c) 2020 Jamie Kyle

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
