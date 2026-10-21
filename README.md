# rleboeu.github.io

A collection of browser-based utilities (file conversion, text encoding, …) built with React, TypeScript and Vite, hosted on GitHub Pages.

All processing happens client-side; there is no server.

## Development

```sh
npm install
npm run dev      # start dev server
npm run build    # type-check and build to dist/
npm run preview  # serve the production build locally
npm run lint     # oxlint
```

## Adding a tool

1. Create a component under `src/tools/<tool-name>/`.
2. Register it in `src/tools/registry.ts`, including its hidden search `tags` (see `CLAUDE.md`). It gets a route (`/#/<path>`), a card on the home page and a result in the header search automatically, and is lazy-loaded so its dependencies only download when the tool is opened.

## Deployment

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the site and deploys `dist/` to GitHub Pages. The repository's **Settings → Pages → Source** must be set to **GitHub Actions**.

Routing uses `HashRouter`, so deep links work on GitHub Pages without a 404 fallback.
