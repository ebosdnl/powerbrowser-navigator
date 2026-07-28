# Power Browser Navigator

Power Browser Navigator is developed as responsibility-based source fragments and
built into one userscript for installation.

## Commands

```sh
npm run build
npm run check
```

`npm run build` concatenates the files listed in `tools/source-layout.mjs` into
`dist/bb-powerbrowser.user.js`. The files intentionally share one userscript closure:
this preserves access to userscript-manager APIs and avoids introducing module
loading at runtime.

## Source layout

- `src/core`: startup state, diagnostics, caching, and SPA navigation
- `src/config`: icons, navigator items, and settings definitions
- `src/styles`: userscript styles
- `src/api`: GraphQL, authentication, artifact, and application-family data
- `src/features`: Betty 5, Next-gen, bearer, search, and navigation features
- `src/ui`: navigator, settings dialog, and application-switcher UI
- `src/main.js`: route synchronization and application composition

The generated `dist/bb-powerbrowser.user.js` is the distributable artifact.
