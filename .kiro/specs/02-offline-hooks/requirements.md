# Requirements Document

## Introduction

Spec 02 of 8 in the CRM offline-mode effort (covers PART 4 item 4). It delivers one
shared composable hook, `useCrmOffline()`, that every later mobile CRM component consumes
so each component reads offline and small-screen state through a single entry point instead
of resolving the framework plugins independently. The hook is a thin, reactive adapter over
the existing `OfflinePlugin` and `UIPlugin`; it adds no offline machinery and introduces no
second source of truth. Only two files change: the hook module and its unit test.

## Glossary

- **Offline_Hook**: The `useCrmOffline()` composable exported from
  `addons/crm/static/src/mobile/crm_offline_hooks.js`.
- **OfflinePlugin**: The existing framework plugin at
  `addons/web/static/src/core/offline/offline_plugin.js`, acquired with `usePlugin(OfflinePlugin)`.
- **UIPlugin**: The existing framework plugin at
  `addons/web/static/src/core/ui/ui_plugin.js`, acquired with `usePlugin(UIPlugin)`.
- **Sync_Queue**: The `OfflinePlugin._ormToSync()` signal map of queued ORM calls, each
  entry shaped `{ key, value: { model, method, args, kwargs, extras } }`.
- **Queued_Write**: An entry in the Sync_Queue, including entries parked with `extras.error`
  after a failed replay.
- **Secure_Context**: A browser context where `window.isSecureContext` is true (localhost or
  HTTPS); outside it the framework disables offline features.
- **Component_Setup**: The synchronous body of an OWL component `setup()`, where OWL hooks
  may legally run.

## Requirements

### Requirement 1: Single composable hook surface

**User Story:** As a mobile CRM component author, I want one hook that exposes offline and
small-screen state, so that I do not resolve the framework plugins independently in each component.

#### Acceptance Criteria

1. THE Offline_Hook SHALL export a function `useCrmOffline()` that returns an object with the
   members `isOffline`, `isSmall`, `isAvailableOffline`, `hasQueuedWrite`, and `scheduleORM`.
2. WHERE `useCrmOffline()` is called, THE Offline_Hook SHALL run only within Component_Setup,
   acquiring the plugins through `usePlugin`.
3. THE Offline_Hook SHALL return each of `isOffline`, `isSmall`, `isAvailableOffline`, and
   `hasQueuedWrite` as a callable function.

### Requirement 2: Live reactive reads

**User Story:** As a template author, I want each hook member to read the live plugin signal
when called, so that templates re-render when offline or small-screen state changes.

#### Acceptance Criteria

1. WHEN `isOffline()` is called, THE Offline_Hook SHALL return the current value of the
   OfflinePlugin `isOffline` signal read at call time.
2. WHEN `isSmall()` is called, THE Offline_Hook SHALL return the current value of the UIPlugin
   `isSmall` signal read at call time.
3. THE Offline_Hook SHALL read every exposed signal at call time rather than capturing a
   snapshot during Component_Setup.

### Requirement 3: Plugin-only sources (no legacy bridges)

**User Story:** As a maintainer, I want the hook to use the plugin API directly, so that new
code does not depend on the legacy service bridges marked for removal.

#### Acceptance Criteria

1. THE Offline_Hook SHALL source `isOffline`, `isAvailableOffline`, `scheduleORM`, and the
   Queued_Write state from `usePlugin(OfflinePlugin)`.
2. THE Offline_Hook SHALL source `isSmall` from `usePlugin(UIPlugin)`.
3. THE Offline_Hook SHALL acquire offline and small-screen state through `usePlugin` only, and
   SHALL omit any use of `useService("offline")` or `useService("ui")`.

### Requirement 4: Queued-write predicate over the framework signal

**User Story:** As a mobile component, I want to know whether a record has a pending offline
write, so that I can show a waiting-to-sync indicator sourced from the one framework queue.

#### Acceptance Criteria

1. WHEN `hasQueuedWrite(resModel, resId)` is called with both arguments, THE Offline_Hook SHALL
   return true if any Sync_Queue entry has `value.model === resModel` and `resId` present in
   that entry's `value.args[0]`, and false otherwise.
2. WHEN `hasQueuedWrite()` is called with no arguments, THE Offline_Hook SHALL return true if
   the Sync_Queue holds any entry, and false otherwise.
3. THE Offline_Hook SHALL count an entry parked with `value.extras.error` as a Queued_Write.
4. THE Offline_Hook SHALL derive the Queued_Write result from the OfflinePlugin `_ormToSync()`
   signal alone, without a local flag or a second store.
5. THE Offline_Hook SHALL treat creates that carry no `resId` as out of scope, deferred to
   spec 07.

### Requirement 5: Pass-through scheduling

**User Story:** As a mobile component, I want to queue an offline ORM call, so that writes are
captured by the framework queue and replayed on reconnect.

#### Acceptance Criteria

1. WHEN `scheduleORM(...)` is called, THE Offline_Hook SHALL delegate to the OfflinePlugin
   `scheduleORM` method with the arguments unchanged.
2. IF `scheduleORM(...)` is called outside a Secure_Context, THEN THE Offline_Hook SHALL
   surface the `NonSecureContextError` raised by the OfflinePlugin without substituting other
   behavior.

### Requirement 6: Unit tests under both presets

**User Story:** As a reviewer, I want tests that exercise every predicate online and offline on
both presets, so that the hook's reactive behavior is verified for desktop and mobile.

#### Acceptance Criteria

1. THE Offline_Hook test module `addons/crm/static/tests/crm_offline.test.js` SHALL exercise
   each of `isOffline`, `isSmall`, `isAvailableOffline`, and `hasQueuedWrite` in both the online
   and offline states.
2. THE Offline_Hook test module SHALL run under the desktop preset and the mobile preset via
   `test.tags`.
3. THE Offline_Hook test module SHALL omit `only()` and `debug()`.

### Requirement 7: Scope and constraint conformance

**User Story:** As a reviewer, I want the change confined to its two allowed files and adding no
machinery, so that the spec stays within the effort's hard constraints.

#### Acceptance Criteria

1. THE Offline_Hook change SHALL create only `addons/crm/static/src/mobile/crm_offline_hooks.js`
   and `addons/crm/static/tests/crm_offline.test.js`.
2. THE Offline_Hook SHALL consume the existing offline framework and SHALL add no sync queue,
   cache, connectivity detector, offline state store, or other offline machinery.
3. THE Offline_Hook change SHALL leave the crm manifest version unchanged.
4. THE Offline_Hook files SHALL load through the manifest's existing asset globs, adding no new
   asset glob.
