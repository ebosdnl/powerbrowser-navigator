# Power Browser Navigator agent guide

## Purpose and architecture

Power Browser Navigator is developed as ordered source fragments and built into a
single Tampermonkey userscript. Make changes in `src/`; never edit
`dist/bb-powerbrowser.user.js` directly.

`tools/source-layout.mjs` controls concatenation order. Add every new browser
feature there and verify that anything it references is available in the combined
scope. `src/main.js` owns feature startup and route synchronization. Long-running
features must have one cleanup path for listeners, timers, observers, and hooks.

## Required workflow

1. Inspect the current worktree before editing and preserve unrelated changes.
2. Use `rg`/`rg --files` for repository searches.
3. Use `apply_patch` for source edits.
4. Run `npm run check` after implementation. It covers linting, formatting,
   TypeScript, settings validation, tests, build, and bundle freshness.
5. Confirm that `dist/bb-powerbrowser.user.js` was rebuilt and is current.
6. Report any live application state changed during verification.

The userscript cannot be replaced in Tampermonkey merely by rebuilding it. The
user must copy or update the generated bundle in Tampermonkey and reload Betty
Blocks before a live test exercises new code. Several development builds may use
the same package version, so a visible version number alone does not prove that
the latest bundle is installed.

## Version and setting changes

Keep the version synchronized in:

- `package.json`
- `package-lock.json`
- `src/metadata.user.js`

For a new setting, update the definition, its application/change handling, feature
startup, and product education where requested. Toggle features should normally
be opt-in and disabled by default unless the requirement says otherwise. Run
`npm run validate:settings` through the full check.

## Next-gen browser debugging

Use the signed-in in-app browser for live Betty Blocks behavior. Treat the URL as
SPA state, not proof that the referenced entity still exists. Click the actual
canvas node and re-read the URL before using an action-step ID. A stale step URL
can display the canvas while the drawer reports that the step no longer exists.

Before mutating live data:

- identify the exact action and step IDs;
- inspect the visible drawer and selected action;
- prepare request or console observation first;
- avoid Save, Cancel, Delete, Undo, or picker changes unless needed for the test;
- remember that Cancel on a newly created draft can remove the step;
- restore temporary selections when practical and state what was changed.

Do not assume a DOM element type from accessibility output. Inspect the actual
markup. Betty Blocks action-picker rows have used `[role="button"]` rather than
native buttons, with `svg[aria-label="Action"]` identifying action rows. Support
both picker commit paths:

- selecting a row and clicking **Select**;
- double-clicking a row.

## HAR analysis

When behavior is disputed, ask for a fresh HAR covering one minimal reproduction
and the exact current step URL. Parse requests chronologically and inspect:

- `operationName`;
- request variables;
- GraphQL response data and errors;
- subsequent mutations that may overwrite an earlier successful mutation.

Do not expose or copy CSRF tokens, cookies, authorization headers, or other HAR
secrets into source, logs, or responses. Lack of a console error does not mean the
feature did not run; the HAR is authoritative for network behavior.

## React, Apollo, and Redux state

A successful direct GraphQL mutation does not guarantee that the open Betty
Blocks UI updates. A raw `fetch` bypasses Apollo's mutation path, and changing DOM
text alone is temporary. React may render stale local state afterward, or a later
native Save may overwrite the server value.

After a direct action-step mutation:

- update the normalized Apollo `ActionStep` cache entry when available;
- let Apollo broadcast its watchers;
- update the existing Redux action object immutably when the canvas reads from
  Redux;
- preserve all current action-step data other than the field being changed;
- use narrowly targeted DOM synchronization only as a visual fallback.

Avoid a full action-query refetch while the step drawer contains unsaved changes.
The server may still contain the old Action selection, and replacing the full
action state can undo the user's new selection. Prefer a targeted cache update
that changes only the persisted field.

Power Browser also creates hidden dialogs. Never use the first generic
`[role="dialog"]` as the Betty Blocks drawer. Locate the visible dialog containing
the expected native control, such as
`button[data-test="select-variable"]`.

## Code quality

Keep feature files focused on the active implementation. Remove abandoned hooks,
generic selectors, synthetic input behavior, and compatibility fallbacks once the
working application path is understood. Retain defensive checks that protect
against stale routes, duplicate events, ambiguous action names, and non-Sub Action
steps.

Generated output, HAR recordings, and user data are not substitutes for source
tests. Add focused automated coverage when behavior can be isolated; always run
the complete repository check before handoff.
