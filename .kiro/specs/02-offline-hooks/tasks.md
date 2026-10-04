# Implementation Plan: 02-offline-hooks

## Overview

Spec 02 creates two files: the shared composable hook `useCrmOffline()` in
`addons/crm/static/src/mobile/crm_offline_hooks.js`, and its Hoot unit-test module
`addons/crm/static/tests/crm_offline.test.js`. The hook is a thin reactive adapter over
`OfflinePlugin` and `UIPlugin` acquired via `usePlugin`; it adds no offline machinery and
reads the single framework signal `_ormToSync()` for queued-write state. Both files load
through the crm manifest's existing asset globs, so no manifest edit and no version bump
occur in this spec. Tasks build in order: implement the hook, write the dual-preset tests,
then verify scope and run the project checks.

## Tasks

- [x] 1. Implement the `useCrmOffline()` hook
  - Create `addons/crm/static/src/mobile/crm_offline_hooks.js`.
  - Import `usePlugin` from `@odoo/owl`, `OfflinePlugin` from
    `@web/core/offline/offline_plugin`, and `UIPlugin` from `@web/core/ui/ui_plugin`.
  - Export `useCrmOffline()`; acquire both plugins with `usePlugin(...)` inside the hook body
    (call-in-`setup()` contract, no `useService`).
  - Return the five members: `isOffline` -> `offline.isOffline()`, `isSmall` ->
    `ui.isSmall()`, `isAvailableOffline(actionId, viewType, resId)` delegating to the plugin,
    `scheduleORM(model, method, args, kwargs, options)` as a verbatim pass-through with no
    try/catch, and `hasQueuedWrite(resModel, resId)`.
  - Implement `hasQueuedWrite` over `Object.values(offline._ormToSync())`: no-arg form returns
    `entries.length > 0`; keyed form returns true when some entry has
    `value.model === resModel` and `Array.isArray(value.args[0])` includes `resId`. Parked
    entries (with `extras.error`) match the same way; no special handling.
  - Each returned member reads the signal at call time (function, not a setup-time snapshot).
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 7.2_

- [x] 2. Write dual-preset unit tests for the hook
  - [x] 2.1 Create the probe component and test scaffolding
    - Create `addons/crm/static/tests/crm_offline.test.js`.
    - Define a tiny probe OWL component whose `setup()` calls `useCrmOffline()` and stores the
      returned object on a module-visible reference; mount it with `mountWithCleanup`.
    - Use the web test helpers (`mockOffline` with `setOffline`, `getService(OfflinePlugin)`,
      `getService(UIPlugin)`) as in `offline_systray.test.js`.
    - _Requirements: 6.1_

  - [x] 2.2 Cover read members and queued-write/scheduling cases
    - `isOffline`: false when online, true after `setOffline(true)`.
    - `isSmall`: assert it is `true` under the mobile preset and `false` under the desktop
      preset (not compared against the plugin getter, which would be circular).
    - `isAvailableOffline`: seed plugin state and assert the hook returns the plugin's answer
      for cached vs uncached action/view/record.
    - `hasQueuedWrite`: no-entry (both forms false); matching entry after
      `scheduleORM("crm.lead", "web_save", [[7]], {}, ...)`; non-matching (wrong model/id);
      no-arg any-write (false empty, true once scheduled); parked entry with `extras.error`
      counted true.
    - `scheduleORM`: calling the hook's pass-through adds the entry to `_ormToSync()`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 6.1_

  - [x] 2.9 Pair every test block across both presets
    - Provide a `test.tags("desktop")` and a `test.tags("mobile")` variant per scenario,
      matching `offline_systray.test.js`; exercise the mobile hook under the mobile preset.
    - Confirm the file contains no `only()` and no `debug()`.
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 3. Verify scope and run checks
  - Confirm only the two allowed files were created and no file outside `addons/crm/` was
    touched; confirm the crm manifest `version` stays `1.9` and no new asset glob was added
    (both files fall under the existing `crm/static/src/**` and
    `crm/static/tests/**/*.test.js` globs).
  - Run `.kiro/scripts/check.sh full` and report the output verbatim. Acceptance (rows 10 and
    12) requires BOTH the desktop and mobile JS presets (commands 3 and 4); `check.sh quick`
    runs only the desktop preset, so `full` is required here, not `quick`.
  - _Requirements: 6.2, 6.3, 7.1, 7.2, 7.3, 7.4_

- [x] 4. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The optional property-based tests (formerly 2.3-2.8) are **won't-do**: Hoot has no
  property-testing facility in this repo, and a JS property-testing library would be a new
  dependency, which constraints.md forbids. The design's Correctness Properties are covered by
  the example/edge cases in task 2.2 instead.
- Each task references specific requirements for traceability.
- Branch creation is already done; this spec does not bump the manifest version (that belongs
  to spec 08).
- Task 3 runs `check.sh full` because both the desktop and mobile presets are required by the
  acceptance gate; `check.sh quick` would not run the mobile preset.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.9"] },
    { "id": 4, "tasks": ["3"] }
  ]
}
```
