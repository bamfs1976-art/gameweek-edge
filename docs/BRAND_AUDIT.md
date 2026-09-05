# Brand audit — 5 September 2026

Scope: `index.html`, `landing.html`, `privacy.html`, `manifest.webmanifest`,
the icon and social-image generators, `README.md`, `DESIGN.md`, measured
against `BRAND.md` as it exists in this repository.

## The finding that needs a decision

`BRAND.md` in this repository says: **green primary** (`#15824a`), green
bright (`#1f9d5c`) for accents and links, a **light theme by default** with
dark as the toggle, and a logo mark that is "a rounded square in pitch green".

The readiness brief describes `BRAND.md` as navy primary, green as a
positive-signal accent only, and a dark terminal default. **The file does not
say that.** Every surface below was therefore reconciled to the file as
written, which is what the brief asked for. If the intended brand is the navy,
dark-terminal one, `BRAND.md` has to change first, and the following would
then be a second pass, not a doc fix:

- the token block in `index.html` (`--green`, `--hero-*`, `--accent-cta`, the
  dark and light surface ramps), with `dev/test-tokens.mjs` re-run;
- `scripts/gen-art.mjs`, `scripts/gen-pwa-icons.mjs`, `scripts/gen-og.mjs` and
  the committed `icons/` and `assets/` they produce;
- `manifest.webmanifest`, `landing.html`, `privacy.html`;
- the head script that sets `data-theme` before first paint (light default);
- the "pitch green and daytime" sentence in `README.md` and the light-default
  paragraph in `DESIGN.md`.

Two things are needed before that pass can start: the navy hex (and whether it
is a fill, an ink, or both), and confirmation that dark becomes the default for
signed-out visitors. Neither is guessed here.

## What was found, surface by surface

| Surface | Before | BRAND.md says | Verdict | Change made |
|---|---|---|---|---|
| `index.html` `<meta name="theme-color">` | `#f4f6f8` (light canvas), rewritten at runtime by `applyTheme()` to the canvas of whichever theme is on | Nothing on browser chrome | The app deliberately keeps the browser chrome the colour of the canvas | None |
| `manifest.webmanifest` `theme_color` | `#15824a` (green) | Nothing on browser chrome | Disagreed with the app it installs: the title bar of the installed app flashed green, then the page rewrote it to the canvas | Set to `#f4f6f8`, the light canvas, so the installed app and the page agree |
| `manifest.webmanifest` `background_color` | `#f4f6f8` | Light background `#f4f6f8` | Agrees | None |
| `landing.html` theme-color and `--green` | `#15824a` | as above | Agrees | None |
| `privacy.html` theme-color and `--green` | `#15824a` | as above | Agrees | None |
| `index.html` token `--green` (ink, 104 uses) | `#147e48` | `#15824a` | `#15824a` measures 4.28:1 on `--surface-3`, below the 4.5:1 that `BRAND.md` §6 itself requires. The shipped value is the AA-corrected one | `BRAND.md` colour table now records `#147e48` as the ink green and keeps `#15824a` for fills (logo tile, icons, theme-color) |
| `index.html` dark `--bg` | `#10161c` | `#0f161d` | One unit apart; `dev/test-tokens.mjs` anchors on `#10161c` and `DESIGN.md` documents it | `BRAND.md` now records `#10161c` |
| `scripts/gen-art.mjs` (icons, splash) | Green `#15824a`, dark splash `#0f161d` | Green tile | Agrees for the fill. Dark splash uses the older dark hex; a splash screen has no text on it, so no contrast concern | None (regenerate if the dark hex is ever unified) |
| `scripts/gen-og.mjs` (social image) | Green gradient `#1f9d5c` to `#0f5f37` | Green brand | Agrees | None |
| `icons/` | Green tile, white form line | §5 logo | Agrees | None |
| Default theme (`index.html` head script) | Light unless `ge-theme` says dark | §8 "Light theme is default" | Agrees | None |
| `README.md` "pitch green and daytime" | Green, light | Green, light | Agrees with the file | None. Contradicts the brief, not the file |
| `DESIGN.md` "Light is the default" | Light | Light | Agrees | None |
| `DESIGN.md` "Not a terminal, not a trading dashboard, no neon" | — | Nothing on this | Contradicts `docs/FEATURES.md` ("the GWE terminal dashboard direction"), the ticker, the Signals feed and the `/design` page, all of which call themselves terminal | Documented only. This is the same decision as the navy question |
| `DESIGN.md` `--accent-cta` amber for actions | Amber CTA (`.btn-cta`: Link team) | §6 "primary buttons" green | Partial. `.btn-primary` is green; the one CTA button is amber so green stays reserved for positive data | Documented only. A brand call, not a bug |
| Fonts (`index.html`, `landing.html`) | Bricolage Grotesque, Public Sans, IBM Plex Mono | §7 the same three | Agrees | None |
| Feature names in `BRAND.md` §9 | Live Rank, EO Tracker, Template Meter, Fixture Planner, Mini-Leagues | — | Out of date against the NAV registry | Handled in `docs/NAMING.md`; §9 updated there |

## Summary of edits in this pass

1. `manifest.webmanifest`: theme_color `#15824a` → `#f4f6f8`, matching the canvas the app paints its own chrome with. `landing.html` and `privacy.html` keep the green chrome; they are static pages with no runtime theme.
2. `BRAND.md` §6: ink green recorded as `#147e48` (AA), fill green `#15824a`;
   dark background recorded as `#10161c`.
3. `BRAND.md` §9: feature names aligned to the NAV registry (see
   `docs/NAMING.md`).
4. Light amber `#b9741a` → `#8f5a12` and light alert red `#cc3d39` →
   `#c23632`, found by `scripts/check-a11y.mjs`: both are used as body-size
   text and measured 3.3:1 and 4.3:1 on the darkest light surface, below the
   4.5:1 that `BRAND.md` §6 requires. `BRAND.md` and `DESIGN.md` record the
   new values; the dark theme was already compliant and is unchanged.

Nothing else was recoloured. The navy-versus-green and terminal-versus-editorial
questions are the owner's, and they are the first two questions in the report
that accompanies this branch.
