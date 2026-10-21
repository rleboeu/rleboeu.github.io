# CLAUDE.md

Browser-based utilities built with React, TypeScript and Vite, hosted on GitHub Pages. All processing is client-side. See `README.md` for commands and deployment.

## Adding a utility

Every utility is registered in `src/tools/registry.ts`, which drives its route, its home-page card and the header search.

**Every utility must have hidden search `tags`.** They are never shown on the page; the header search (`src/tools/search.ts`) matches them alongside the name and description, so they are how people find a tool by what they want to do rather than by its exact name. When creating or changing a utility, add or update its tags to cover:

- Verbs and nouns for the task: `convert`, `encode`, `compress`, `resize`, …, plus their variants (`converter`, `conversion`, `encoder`).
- Every format, file extension and alias it handles, e.g. `jpg` and `jpeg`, `docx`, `doc` and `word`, `base64` and `b64`.
- Phrases people actually type, e.g. `pdf to word`, `png to jpg`, `extract text`. A tag that exactly equals a multi-word query ranks that tool first.
- Common synonyms and spellings, e.g. `photo`, `picture`, `image`; `base 64`.

Keep tags lowercase, and only list capabilities the tool really has, so search never surfaces a tool for something it can't do. When a tool gains a format or feature, add the matching tags in the same change.
