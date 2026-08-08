# Vendored faces

Written by `node scripts/social/fetch-fonts.mjs`. Do not edit by hand.

The evergreen social cards render from committed PNGs, so the faces are
vendored rather than linked — a card re-rendered on a machine with no route
to fonts.gstatic.com must come out identical, not silently fall back.

Latin subsets only. All three families are SIL Open Font License 1.1,
which permits redistribution:

- Bricolage Grotesque — https://fonts.google.com/specimen/Bricolage+Grotesque
- Public Sans — https://fonts.google.com/specimen/Public+Sans
- JetBrains Mono — https://fonts.google.com/specimen/JetBrains+Mono
