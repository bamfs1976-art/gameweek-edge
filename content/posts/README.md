# Articles

Markdown files in this folder become pages at `/articles/<slug>/` when the
site builds, with an index at `/articles/` and an RSS feed at
`/articles/feed.xml`. Nothing is published until a file here qualifies.

## File name

`YYYY-MM-DD-slug.md`. The date and the slug come from the name unless the
front matter overrides them.

## Front matter

```
---
title: The title as it appears on the page
description: One or two sentences for the listing, the meta description and the feed
date: 2026-09-20
author: Your name
tags: model, captaincy
draft: true
---
```

`draft: true` keeps a post out of the build. A date in the future does the
same until the day arrives. A file starting with an underscore is ignored,
which is what `_template.md` is for.

## Markdown supported

Headings (`#` to `####`), paragraphs, **bold**, *italic*, `code`, links,
images, bullet and numbered lists, block quotes, fenced code and a rule
(`---`). Raw HTML is escaped, not rendered. British English, no em dashes,
the same as the app.
