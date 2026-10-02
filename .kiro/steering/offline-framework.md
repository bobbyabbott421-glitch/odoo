---
inclusion: fileMatch
fileMatchPattern: 'addons/crm/**'
---
# Offline framework reference (read-only)

**Read-only reference.** This file documents framework code in `addons/web` that CRM
consumes. Do not change any file described here; extend from inside `addons/crm/`.
Paths and APIs were read from the tree — treat them as the source of truth over memory,
but re-read the file if a detail is load-bearing for a change.

## Offline plugin — `addons/web/static/src/core/offline/offline_plugin.js`

`OfflinePlugin extends Plugin`. Consume with `usePlugin(OfflinePlugin)`. Key signals
(call to read):

- `isOffline()` — connection currently lost. Toggled by `online`/`offline` browser
  events and by `RPC:RESPONSE` carrying a `ConnectionLostError` (catches a dead server
  that the browser still thinks is online).
- `syncingORM()` — a replay pass is in progress.
- `_ormToSync()` — the pending-write map (keyed), read by the systray and by callers
  needing the queued state.

Availability checks for cached data:

- `isAvailableOffline(actionId, viewType, resId)` — whether an action / view / record
  was visited online and cached. For `form` it checks the specific `resId`.
- `getAvailableSearches(actionId, viewType)` — cached search states, used by the
  offline action helper.
- `setAvailableOffline(actionId, viewType, {resId, search})` — marks something cached;
  the framework calls this as views are visited online.

A non-secure context swaps the real IndexedDB for a `FakeIndexedDB` and disables
offline entirely; `scheduleORM` then throws `NonSecureContextError`. Run on localhost
or HTTPS.

Legacy `useService("offline")` is a bridge over the same plugin and is marked for
removal — new CRM code uses the plugin.

## Sync queue (write replay)

Enqueue with:

```js
scheduleORM(model, method, args, kwargs, { id, extras })
```

- Stores `{ model, method, args, kwargs, extras }` in the IndexedDB table
  `orm-to-sync` (`ORM_SYNC_TABLE_NAME`) and in the `_ormToSync` signal. Key is
  `options.id` or a hash of the value.
- `extras.timeStamp` orders replay; the systray also reads `extras` (`actionName`,
  `displayName`, `changes`, `viewType`, etc.) for its UI.
- `removeScheduledORM(key)` drops an entry; `hasScheduledCalls` is a quick predicate.

Replay — `_syncORM()`:

- Runs under a `navigator.locks.request("db-sync", ...)` lock so only one tab replays.
- Processes entries **without** `extras.error`, sorted by `extras.timeStamp` ascending,
  one per ~1s, via `orm.silent.call(model, method, args, kwargs)` — **verbatim, no id
  remapping between calls.**
- On `ConnectionLostError` it stops (stays offline). On any other error it re-schedules
  the entry with `extras.error` set — **parked, not discarded** — for manual retry.
- Last write wins on the server. There is no conflict detection, no `write_date`
  comparison, no field merge, no conflict dialog. Do not add any.

Consequences for CRM: anything queued must have a fully client-resolvable argument
list. A call needing a server `onchange`, a transient wizard, or an id produced by
another queued call must be disabled offline, never queued.

## Systray — `addons/web/static/src/webclient/offline_systray/offline_systray.js`

Registered in the `systray` category at `sequence: 1000`. Shows queued changes grouped
by action, with per-method status (Created / Edited / Archived / Unarchived / Deleted).
`inError` is any entry with `extras.error`; the user can discard it through a
`ConfirmationDialog`. This is the only queued-change and error surface — do not build a
CRM-specific one.

## Offline-availability attribute

Defined on the plugin:

```js
SELECTORS_TO_DISABLE = ["button:not([data-available-offline]):not([disabled])"]
```

Going offline, `_offlineUI()` adds `disabled` + the `o_disabled_offline` class to every
matching element, and a `MutationObserver` on `document.body` (watching the
`data-available-offline` attribute and childList/subtree) re-applies this as the DOM
changes. Going online, `_onlineUI()` reverses it.

So a control stays usable offline **only** if its interactive element carries
`data-available-offline`. This runtime CSS-selector pass is the gate — JS logic alone
cannot keep a button live offline.

## Small-screen signal — `addons/web/static/src/core/ui/ui_plugin.js`

`UIPlugin.isSmall = signal(false)`, set from `utils.isSmall()` at setup and updated on
media-query changes. Read via `usePlugin(UIPlugin)` → `ui.isSmall()` (or the legacy
`useService("ui")` → `ui.isSmall`). Gate every new mobile behavior on this signal so
desktop is untouched.

Existing CRM precedent: `addons/crm/static/src/views/crm_form/crm_pls_tooltip_button.js`
uses `this.ui.isSmall` to choose `useBottomSheet`.

## Bottom sheet — `addons/web/static/src/core/bottom_sheet/bottom_sheet_plugin.js`

`BottomSheetPlugin.add(target, Component, props = {}, options = {})` always mounts a
component as a bottom-sheet overlay and returns a `remove()` function. Options it reads
include `onClose`, `class`, `role`, and `ref`. Note: `useBottomSheet` appears in the
option schema but `add()` does not consume it — it is read by higher-level APIs (e.g.
the popover) to choose *whether* to open a bottom sheet; calling `add()` directly always
opens one. So gate the call on the small-screen signal yourself. Legacy access is
`useService("bottom_sheet")`. Use this for the mobile quick-create sheet rather than a
custom overlay.

## Offline action helper — `addons/web/static/src/views/offline_action_helper.js`

`OfflineActionHelper` (template `web.OfflineActionHelper`) reads
`getAvailableSearches(actionId, viewType)` and offers to reset to a cached search. It is
already wired into the Kanban and List controllers as the fallback when a view is not
cached offline. Reuse it to explain an uncached stage/lead instead of rendering an empty
view.

## Relational-field (many2x) cache

On the plugin:

- `cacheMany2XSearch(resModel, result)` — stores encrypted `{id, display_name}` pairs in
  IndexedDB table `many2x_<resModel>` (`MANY2X_TABLE_PREFIX`).
- `searchMany2XRecords(resModel, name)` — offline name search over that table.
- `readMany2XRecords(resModel, resIds)` — offline name resolution for ids.

The cache is populated and consumed automatically for relational fields on cached
records:

- `addons/web/static/src/model/relational_model/relational_model.js` caches searched
  values.
- `addons/web/static/src/views/fields/relational_utils.js` falls back to
  `searchMany2XRecords` on `ConnectionLostError`.
- `addons/web/static/src/model/relational_model/static_list.js` falls back to
  `readMany2XRecords`.

CRM's partner field resolves and searches offline through this cache — do not add a
second partner cache. (Only populated when encryption is available, i.e. a secure
context.)

## PWA — `addons/web/static/src/core/pwa/pwa_service.js`

The shared service worker caches the backend entry point and serves the offline page.
CRM only extends the web-manifest controller
(`addons/crm/controllers/webmanifest.py`, which subclasses
`odoo.addons.web.controllers.webmanifest.WebManifest`); it does not override the service
worker, the manifest route, or the offline page route.
