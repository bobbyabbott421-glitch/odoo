# Design Document

## Overview

Spec 02 delivers one shared composable hook, `useCrmOffline()`, exported from
`addons/crm/static/src/mobile/crm_offline_hooks.js`, plus its unit test module
`addons/crm/static/tests/crm_offline.test.js`. The hook is a thin, reactive adapter over
two existing framework plugins — `OfflinePlugin` and `UIPlugin` — so every later mobile
CRM component (specs 04–08) reads offline and small-screen state through a single entry
point instead of resolving the plugins independently.

The hook adds no offline machinery: no sync queue, cache, connectivity detector, offline
state store, or conflict resolver. It reads the framework's existing signals and delegates
to the framework's existing methods. The queued-write predicate is derived from the single
framework signal `OfflinePlugin._ormToSync()` — the same signal the offline systray reads —
so there is no second source of truth.

Only two files are created. No existing file is modified. The crm manifest version stays
`1.9`; the two files load through the manifest's existing asset globs (verified below).

## Architecture

```
Mobile CRM component setup()
        │
        │ useCrmOffline()
        ▼
┌─────────────────────────────────────────────┐
│ crm_offline_hooks.js                          │
│   usePlugin(OfflinePlugin) ─► offline          │
│   usePlugin(UIPlugin)      ─► ui               │
│                                               │
│   returns {                                    │
│     isOffline:         () => offline.isOffline()        │
│     isSmall:           () => ui.isSmall()               │
│     isAvailableOffline:(a,v,r) => offline.isAvailableOffline(a,v,r) │
│     hasQueuedWrite:    (m,id) => predicate(offline._ormToSync())    │
│     scheduleORM:       (...)  => offline.scheduleORM(...)           │
│   }                                           │
└─────────────────────────────────────────────┘
        │ reads live signals             │ delegates
        ▼                                ▼
OfflinePlugin.isOffline / _ormToSync /   OfflinePlugin.isAvailableOffline
isAvailableOffline / scheduleORM          scheduleORM
UIPlugin.isSmall
```

The hook holds no state of its own. Each returned member is a closure over the two plugin
instances acquired in `setup()`.

## Components and Interfaces

### Module: `addons/crm/static/src/mobile/crm_offline_hooks.js`

Imports:

```js
import { usePlugin } from "@odoo/owl";
import { OfflinePlugin } from "@web/core/offline/offline_plugin";
import { UIPlugin } from "@web/core/ui/ui_plugin";
```

Single export:

```js
export function useCrmOffline() {
    const offline = usePlugin(OfflinePlugin);
    const ui = usePlugin(UIPlugin);

    return {
        isOffline: () => offline.isOffline(),
        isSmall: () => ui.isSmall(),
        isAvailableOffline: (actionId, viewType, resId) =>
            offline.isAvailableOffline(actionId, viewType, resId),
        scheduleORM: (model, method, args, kwargs, options) =>
            offline.scheduleORM(model, method, args, kwargs, options),
        hasQueuedWrite: (resModel, resId) => {
            const entries = Object.values(offline._ormToSync());
            if (resModel === undefined) {
                return entries.length > 0;
            }
            return entries.some(
                ({ value }) =>
                    value.model === resModel &&
                    Array.isArray(value.args[0]) &&
                    value.args[0].includes(resId)
            );
        },
    };
}
```

#### Call-site contract (Requirement 1.2)

`useCrmOffline()` must be called in a component's `setup()` body. `usePlugin` is an OWL
hook and throws outside a component setup, so this is a hard precondition, not a style
choice. The hook is documented as "call in setup()" and acquires both plugins there.

#### Returned members

| Member | Signature | Behavior |
|--------|-----------|----------|
| `isOffline` | `() => boolean` | Reads `OfflinePlugin.isOffline()` at call time. |
| `isSmall` | `() => boolean` | Reads `UIPlugin.isSmall()` at call time. |
| `isAvailableOffline` | `(actionId, viewType?, resId?) => boolean` | Delegates to `OfflinePlugin.isAvailableOffline`, arguments unchanged. |
| `scheduleORM` | `(model, method, args, kwargs, options) => key` | Pass-through to `OfflinePlugin.scheduleORM`, arguments unchanged. Does not catch `NonSecureContextError`. |
| `hasQueuedWrite` | `(resModel?, resId?) => boolean` | Predicate over `OfflinePlugin._ormToSync()` (see below). |

Per Requirement 1.3, `isOffline`, `isSmall`, `isAvailableOffline`, and `hasQueuedWrite` are
all returned as callable functions (not snapshot values). `scheduleORM` is likewise a
function (it performs an action rather than reading state).

### `scheduleORM` pass-through (Requirement 5)

`scheduleORM` forwards `(model, method, args, kwargs, options)` to the plugin verbatim. The
plugin's own `scheduleORM` throws `NonSecureContextError` when `window.isSecureContext` is
false (confirmed in `offline_plugin.js`). The hook does **not** wrap this in a try/catch and
does not substitute other behavior — the error surfaces to the caller unchanged. Later specs
decide how to present it; this spec only guarantees transparent delegation.

### `hasQueuedWrite` semantics

`hasQueuedWrite` reads `OfflinePlugin._ormToSync()`, the framework's keyed pending-write map.
Each entry is shaped `{ key, value: { model, method, args, kwargs, extras } }` (confirmed in
`offline_plugin.js` `scheduleORM`/`_updateScheduledORMList`).

- **No arguments:** returns true if the map holds any entry (`Object.values(...).length > 0`),
  false otherwise. (Requirement 4.2)
- **With `(resModel, resId)`:** returns true if any entry has `value.model === resModel` AND
  `value.args[0]` is an array that includes `resId`; false otherwise. (Requirement 4.1)

  `args[0]` is the ids array for `write`/`web_save`. This is confirmed in
  `addons/web/static/tests/webclient/offline_systray.test.js`: an edit of record 22 is
  scheduled as `web_save` with args `[[22]]`, and a create is scheduled with args `[[]]` (an
  empty ids array).

- **Parked entries count.** An entry re-scheduled with `value.extras.error` after a failed
  replay is still unsynced, so it is counted as a queued write. The framework re-adds the same
  entry (same `model`/`args`) with `extras.error` set in `_syncORM`'s catch block, so the
  predicate matches it exactly as it matches a never-replayed entry; no special handling is
  needed. (Requirement 4.3)

#### Design note — single private framework signal (Requirement 4.4)

`_ormToSync` is an underscore-prefixed **private** framework signal. The hook reads it
directly because the framework exposes no per-record queued-write API: the public surface is
`hasScheduledCalls` (a bare any-entry boolean) and `_ormToSync()` itself. The offline systray
reads the same `_ormToSync()` signal the same way (via the legacy `offlineService.scheduledORM`
getter, which returns `offlinePlugin._ormToSync()`). `_ormToSync()` is the **only** framework
state `hasQueuedWrite` reads. The hook keeps no local flag and no second store, satisfying the
constraint "no second store / no new offline machinery."

#### Design note — creates have no resId (Requirement 4.5)

A create queued for a record that does not exist yet has no `resId`: its `args[0]` is an empty
array (`[[]]`, as the systray tests show). Therefore `hasQueuedWrite(resModel, resId)` cannot
match a pending create by id — there is no id to match. The no-argument form still reports it
(the map is non-empty). Surfacing a pending-sync indicator for a not-yet-created record is out
of scope for this spec and deferred to spec 07 (mobile quick create), which owns the create
flow and its record identity.

## Reactivity rationale

Each returned member is a **function that calls the signal at call time**, never a value
captured during `setup()`. OWL signals track reads: when a template calls `offline.isOffline()`
(through the hook member) during render, the component subscribes to that signal and re-renders
when it changes. The same holds for `ui.isSmall()` and for `hasQueuedWrite()` reading
`_ormToSync()`.

Snapshotting at setup time — e.g. `const isOffline = offline.isOffline()` returned as a plain
boolean — would read the signal once, outside any tracked render, and the value would never
update. That approach is **explicitly rejected**: it breaks reactivity and defeats the purpose
of the hook. (Requirements 2.1, 2.2, 2.3)

## Plugin-only sources (Requirement 3)

Offline state (`isOffline`, `isAvailableOffline`, `scheduleORM`, queued-write) comes from
`usePlugin(OfflinePlugin)`; small-screen state (`isSmall`) comes from `usePlugin(UIPlugin)`.
The hook uses `usePlugin` only and contains no `useService("offline")` or `useService("ui")`
call. The legacy service bridges are marked for removal in the framework; new CRM code uses the
plugin API directly.

## Data Models

The hook introduces no data model. It observes one framework structure, the Sync_Queue entry:

```
SyncQueueEntry = {
    key: string,
    value: {
        model:  string,       // e.g. "crm.lead"
        method: string,       // e.g. "web_save"
        args:   [ids, ...],   // args[0] is the ids array; [] for a create
        kwargs: object,
        extras: {             // systray metadata; may carry `error` when parked
            timeStamp: number,
            error?: string | true,
            ...
        }
    }
}
```

## Error Handling

- **Non-secure context:** `scheduleORM` surfaces the framework's `NonSecureContextError`
  unchanged (no catch, no substitution). Reads (`isOffline`, `isSmall`, `isAvailableOffline`,
  `hasQueuedWrite`) do not schedule and so never raise this error.
- **Called outside setup:** `usePlugin` raises the framework's own error; this is a programming
  error the hook does not mask.
- **Malformed queue entry:** `hasQueuedWrite(resModel, resId)` guards `value.args[0]` with
  `Array.isArray(...)` before calling `.includes`, so an entry whose `args[0]` is not an array
  (defensive) does not throw; it simply does not match.

## Testing Strategy

### Test module: `addons/crm/static/tests/crm_offline.test.js`

Approach: mount a tiny probe OWL component whose `setup()` calls `useCrmOffline()` and stores
the returned object on a module-visible reference, so each test can call the members and assert
their return values. Use `mountWithCleanup` and the crm/web test helpers.

Helpers (from `@web/../tests/web_test_helpers`, as used by the framework's own
`offline_systray.test.js`):

- `mockOffline()` — returns a `setOffline(bool)` toggler to drive online/offline.
- `getService(OfflinePlugin)` / `getService(UIPlugin)` — drive and inspect plugin state
  (e.g. `setAvailableOffline`, `scheduleORM`, read `isSmall()`).
- `isSmall` differs by preset, so assert `probe.isSmall()` is `true` under the mobile
  preset and `false` under the desktop preset. (Comparing against
  `getService(UIPlugin).isSmall()` would be circular — both read the same signal — so the
  expected value is pinned to the preset instead.)

Cases to cover:

1. **isOffline** — false when online; true after `setOffline(true)`.
2. **isSmall** — `true` under the mobile preset, `false` under the desktop preset (pinned to the preset, not compared against the plugin getter, which would be circular).
3. **isAvailableOffline** — delegates to the plugin; seed via
   `getService(OfflinePlugin).setAvailableOffline(...)` (or patch the plugin method) and assert
   the hook returns the plugin's answer for a cached vs uncached action/view/record.
4. **hasQueuedWrite — no entries** — returns false (both no-arg and `(model, id)` forms).
5. **hasQueuedWrite — matching entry** — after `scheduleORM("crm.lead", "web_save", [[7]], {}, {extras:{timeStamp:1}})`, `hasQueuedWrite("crm.lead", 7)` is true.
6. **hasQueuedWrite — non-matching** — wrong model or wrong id returns false.
7. **hasQueuedWrite — no-arg any-write** — false with an empty queue, true once any entry is
   scheduled.
8. **hasQueuedWrite — parked entry** — an entry carrying `extras.error` is counted (true).
9. **scheduleORM delegates** — calling the hook's `scheduleORM` adds the entry to the plugin's
   `_ormToSync()` (assert via the plugin, or via `hasQueuedWrite`).

### Both presets (Requirement 6)

Every test block runs under **both** the desktop and the mobile preset. Provide desktop and
mobile variants using `test.tags("desktop")` and `test.tags("mobile")`, matching the pattern in
`offline_systray.test.js` (which pairs a `test.tags("desktop")` and a `test.tags("mobile")`
variant per scenario). The new mobile hook must be exercised in the mobile preset. No `only()`
or `debug()` appears in the file.

### Coverage (row 14)

The module targets ≥80% statement coverage of `crm_offline_hooks.js`, with a test exercising
each returned member and each branch of `hasQueuedWrite` (no-arg vs keyed; matching vs
non-matching; parked). There is no coverage tool in the repo; the reviewer verifies coverage by
reading the tests against the source.

### Asset loading (Requirement 7.4, verified)

No manifest edit is required. The crm manifest already globs:

- `web.assets_backend`: `'crm/static/src/**'` — picks up
  `crm/static/src/mobile/crm_offline_hooks.js`.
- `web.assets_unit_tests`: `'crm/static/tests/**/*.test.js'` — picks up
  `crm/static/tests/crm_offline.test.js`.

Both new files fall under existing globs; no new glob is added and the manifest `version`
(`1.9`) is unchanged.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions
of a system — a formal statement about what the system should do.*

These properties are verified by the example and edge-case tests in task 2.2 run under both
presets, not by a property-based testing library: Hoot provides no PBT facility in this repo and
adding a JS PBT dependency is forbidden by `constraints.md`.

### Property 1: isOffline mirrors the plugin signal

For any sequence of offline/online toggles, calling the hook's `isOffline()` returns the same
boolean as `OfflinePlugin.isOffline()` read at the same moment.

**Validates: Requirements 2.1, 2.3, 3.1**

### Property 2: isSmall reflects the preset

The hook's `isSmall()` is `true` under the mobile preset and `false` under the desktop preset,
reading the `UIPlugin.isSmall` signal live at call time. (The expected value is pinned to the
preset rather than re-read from the plugin, which would be a circular assertion.)

**Validates: Requirements 2.2, 2.3, 3.2**

### Property 3: isAvailableOffline delegates faithfully

For any `(actionId, viewType, resId)`, the hook's `isAvailableOffline(actionId, viewType, resId)`
returns exactly what `OfflinePlugin.isAvailableOffline(actionId, viewType, resId)` returns.

**Validates: Requirements 1.1, 3.1**

### Property 4: keyed queued-write predicate

For any set of scheduled ORM entries, `hasQueuedWrite(resModel, resId)` is true if and only if
some entry has `value.model === resModel` and `value.args[0]` is an array containing `resId`,
regardless of whether that entry carries `extras.error`.

**Validates: Requirements 4.1, 4.3, 4.4**

### Property 5: no-argument queued-write predicate

For any set of scheduled ORM entries, `hasQueuedWrite()` with no arguments is true if and only
if the Sync_Queue holds at least one entry.

**Validates: Requirements 4.2, 4.4**

### Property 6: scheduleORM is a transparent pass-through

For any `(model, method, args, kwargs, options)`, calling the hook's `scheduleORM` has the same
effect on `OfflinePlugin._ormToSync()` as calling the plugin's `scheduleORM` with those exact
arguments, and in a non-secure context it raises the same `NonSecureContextError` without
substituting other behavior.

**Validates: Requirements 5.1, 5.2**
```
