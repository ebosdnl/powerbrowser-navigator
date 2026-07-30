# Power Browser Navigator

Power Browser Navigator is developed as responsibility-based source fragments and
built into one userscript for installation.

## Commands

```sh
npm install
npm run build
npm test
npm run check
```

`npm run build` bundles the reusable core ES modules with esbuild, injects the
feature-owned CSS, and composes the ordered browser feature files into
`dist/bb-powerbrowser.user.js`. Userscript managers still receive one self-contained
file with no runtime package dependencies.

## Source layout

- `src/core`: testable ES modules for context, lifecycle, logging, selectors, and utilities
- `src/config`: icons, navigator items, and settings definitions
- `src/styles`: userscript styles
- `src/api`: GraphQL, authentication, artifact, and application-family data
- `src/features`: Betty 5, Next-gen, bearer, search, and navigation features
- `src/ui`: navigator, settings dialog, and application-switcher UI
- `src/main.js`: route synchronization and application composition

The generated `dist/bb-powerbrowser.user.js` is the distributable artifact.

## Feature lifecycle

Long-running features are registered with `start`, `sync`, and `stop` hooks.
Route changes call `sync`, while `stop` provides one cleanup path for timers,
observers, patched APIs, and event listeners.

## Diagnostics

Set the stored `powerBrowserLogLevel` value to `debug`, `info`, `warn`, `error`,
or `silent`. Production defaults to `debug`.

The Info tab includes a redacted event timeline for data loading,
authentication, GraphQL, and feature failures. Authentication headers, cookies,
CSRF values, passwords, secrets, and tokens are removed before display or copy.

The sandbox switcher uses a shared authentication state and offers Retry and
Open My Betty actions when automatic recovery cannot load the application
family.

## Settings schema

`npm run validate:settings` validates the real settings configuration for
duplicate keys, missing tabs, unsupported control types, missing labels or
descriptions, and invalid toggle defaults. It is included in `npm run check`.

## Releases

Pull requests and pushes to `main` run linting, formatting checks, unit tests,
and bundle verification. Pushing a tag such as `v3.1.0` creates a GitHub release
containing the built userscript.
