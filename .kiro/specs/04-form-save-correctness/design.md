# Form-Save Offline Correctness Bugfix Design

## Overview

Spec 04 fixes three correctness defects on the CRM lead form-save and kanban-move
paths while the salesperson is offline, and proves the existing framework queue
semantics (ordering, parked-on-rejection) are unchanged.

All three defects share one root shape: CRM-owned code issues (or a server-only control
reaches) a server call that has **no offline queue fallback**, so offline it raises a
connection-lost error instead of being queued.

- **Bug 1 — rainbowman lookup offline.** After a stage change, both
  `CrmFormRecord._save` (`addons/crm/static/src/views/crm_form/crm_form.js`) and
  `CrmKanbanDynamicGroupList.moveRecords`
  (`addons/crm/static/src/views/crm_kanban/crm_kanban_model.js`) call
  `checkRainbowmanMessage(...)`, which issues a plain
  `orm.call("crm.lead", "get_rainbowman_message", ...)`. That follow-up call is not a
  queued fallback, so offline it throws. Fix: gate the call on
  `!this.model.offlinePlugin.isOffline()` at the two call sites.

- **Bug 2 — email/phone propagation into the queued offline write.** `CrmFormRecord._save`
  already force-copies `email_from`/`phone` into `this._changes` before
  `super._save(...)` when the partner-sync flags are set. The framework carries
  `this._changes` into the queued offline `web_save` automatically. The fix is to **not
  move or gate that copy** so it runs identically online and offline, plus tests that
  prove the queued write carries those values. No new code.

- **Bug 3 — mark-won offline.** The "Won" button
  (`addons/crm/views/crm_lead_views.xml`) carries no `data-available-offline` attribute,
  so the framework's `SELECTORS_TO_DISABLE` pass disables it offline; and it calls the
  server-only `action_set_won_rainbowman`, which has no queue fallback. Fix: mark the
  button offline-available, and add a CRM form controller that, offline, intercepts the
  Won click, queues exactly one `action_set_won`, and shows the lead won optimistically.

The whole fix is confined to `addons/crm/`. No new source files, no manifest version
bump, no new offline machinery, no dependency, no access-rule changes.

### Offline-state accessor rationale (applies to all three bugs)

Model/record/controller code reads connectivity the way framework model code does:
`this.model.offlinePlugin.isOffline()`.

- `RelationalModel` sets `offlinePlugin = usePlugin(OfflinePlugin)`
  (`addons/web/static/src/model/relational_model/relational_model.js:130`).
- `isOffline()` is the live connection signal on `OfflinePlugin`
  (`addons/web/static/src/core/offline/offline_plugin.js`; offline-framework steering),
  toggled by browser `online`/`offline` events and by a `ConnectionLostError` on
  `RPC:RESPONSE`.
- `CrmFormModel` extends `formView.Model` (which extends `RelationalModel`),
  `CrmKanbanModel` extends `RelationalModel`, and the new `CrmFormController` reads it via
  `this.model.offlinePlugin`. So all three sites have the same accessor.
- The `useCrmOffline()` component hook from spec 02 **cannot** be used here: it is an OWL
  component hook (`usePlugin` requires a component setup scope), and this is
  model/record/controller code, not an OWL component.

## Glossary

- **Bug_Condition (C)**: offline AND (form-save with a stage change, OR kanban move
  across stage, OR a Won-button click). The inputs that currently raise or disable.
- **Property (P)**: desired behavior under C — skip the rainbowman lookup and complete
  the queued write with no error (Bugs 1); queue exactly one `action_set_won` and show
  the lead won optimistically (Bug 3); the queued offline `web_save` carries
  `email_from`/`phone` (Bug 2).
- **Preservation (¬C)**: every online path, every non-`crm.lead` save, every save
  without a stage change, and all desktop behavior — byte-for-byte unchanged.
- **`CrmFormRecord._save`**: the override in `crm_form.js` that force-copies
  `email_from`/`phone` and, after `super._save`, conditionally calls the rainbowman
  lookup.
- **`CrmKanbanDynamicGroupList.moveRecords`**: the override in `crm_kanban_model.js` that,
  after `super.moveRecords`, conditionally calls the rainbowman lookup.
- **`checkRainbowmanMessage`**: `addons/crm/static/src/views/check_rainbowman_message.js`;
  issues `orm.call("crm.lead", "get_rainbowman_message", [[recordId]])`. **Not modified.**
- **`offlinePlugin.isOffline()`**: the live connection signal (see accessor rationale).
- **`scheduleORM(model, method, args, kwargs, { id, extras })`**: the framework queue
  enqueue API on `OfflinePlugin`.
- **`getScheduleORMExtras(model, records)`**: exported from
  `addons/web/static/src/model/relational_model/utils.js:869`; builds the standard
  `extras` object (`actionId`, `actionName`, `viewType`, `timeStamp: Date.now()`,
  `displayName`) that record.js uses for its own `scheduleORM` fallbacks.
- **`beforeExecuteActionButton(clickParams)`**: the form controller hook; the button's
  method name is `clickParams.name`.

## Bug Details

### Bug Condition

The bug manifests when the salesperson is offline and either (a) saves a lead form after
changing `stage_id`, or (b) moves a lead across stages in a kanban grouped by `stage_id`,
or (c) clicks the "Won" button. In (a)/(b) the CRM override calls
`checkRainbowmanMessage`, whose `orm.call("crm.lead", "get_rainbowman_message", ...)` has
no queue fallback and throws. In (c) the framework disables the un-attributed button, and
if reached, the server-only `action_set_won_rainbowman` throws.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X of type { connectivity, action, stageChanged, partnerSyncFlags }
  OUTPUT: boolean

  RETURN X.connectivity = OFFLINE
     AND (
          (X.action = FORM_SAVE   AND X.stageChanged = TRUE)
       OR (X.action = KANBAN_MOVE AND X.stageChanged = TRUE)
       OR (X.action = MARK_WON)
     )
END FUNCTION
```

### Examples

- **Bug 1 (form).** Offline, user drags `stage_id` to a new stage and saves. The save is
  queued (framework), then `checkRainbowmanMessage` fires `get_rainbowman_message` →
  `ConnectionLostError` surfaces to the user. Expected: no rainbowman lookup, no error.
- **Bug 1 (kanban).** Offline, user drags a card to another stage column. `moveRecords`
  queues the move, then `get_rainbowman_message` throws. Expected: no rainbowman lookup,
  no error.
- **Bug 2.** Offline, a lead with `partner_email_update` set is saved. The queued
  `web_save` must carry `email_from` (and `phone` when `partner_phone_update` is set),
  exactly as the online write would. A naive Bug 1 fix that gated/moved the copy would
  drop it.
- **Bug 3 (disabled).** Offline, the "Won" button is greyed out (`disabled` +
  `o_disabled_offline`) and cannot be clicked. Expected: clickable.
- **Bug 3 (call).** Offline, clicking "Won" (if reachable) calls
  `action_set_won_rainbowman` with no fallback → error, lead not won. Expected: queue one
  `action_set_won`, show the lead won optimistically.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Online, a stage change on form save still issues `get_rainbowman_message` via
  `checkRainbowmanMessage` (Req 3.1).
- Online, a kanban move across stage still issues `get_rainbowman_message` (Req 3.2).
- Online, clicking "Won" still calls `action_set_won_rainbowman` and shows the rainbowman
  effect (Req 3.3).
- Online, the partner-sync force-copy of `email_from`/`phone` still runs (Req 3.4).
- A save with `resModel !== "crm.lead"`, or without a `stage_id` change, behaves exactly
  as before — no rainbowman lookup (Req 3.5).
- Desktop CRM is unchanged (Req 3.6); the framework queue is reused unchanged — no new
  queue, conflict detection, `write_date` compare, field merge, conflict dialog, or
  CRM-specific error UI (Req 3.7, 3.8, 3.9).
- The existing JS hook tests (Req 3.10) and Python tests (Req 3.11) keep passing.

**Scope:**
Every input where `isBugCondition(X)` is false must be completely unaffected. In
particular, when `!isOffline()` the gated conditions are textually identical to today, so
the online paths are byte-for-byte unchanged behaviorally. The `data-available-offline`
attribute on the Won button is inert online. The CRM form controller calls and returns
`super.beforeExecuteActionButton(clickParams)` unchanged for every non-(offline+won) case.

## Hypothesized Root Cause

1. **Follow-up `orm.call` with no queue fallback (Bug 1).** `checkRainbowmanMessage`
   issues a direct `orm.call("crm.lead", "get_rainbowman_message", ...)`. The framework
   only provides offline fallback for the save/move itself (via `webSave` →
   `ConnectionLostError` → `_offlineSave`); an independent follow-up call is not covered
   and throws offline. The gate therefore belongs at the CRM call sites, so the
   `orm.call` is never reached offline — not inside `check_rainbowman_message.js`, which
   must not be modified.

2. **Copy ordering risk (Bug 2).** The force-copy into `this._changes` already runs
   before `super._save(...)`. The risk is a Bug 1 fix that moves or gates this copy on
   the offline path, which would omit `email_from`/`phone` from the queued write. Root
   cause avoidance: keep the copy ungated and ahead of `super._save`.

3. **Missing offline-availability attribute + server-only method (Bug 3).** The Won
   button lacks `data-available-offline`, so the runtime `SELECTORS_TO_DISABLE` pass
   disables it; and `action_set_won_rainbowman` recomputes/needs the server (rainbowman
   message), so it cannot be queued verbatim. The lead must be marked won through a
   queueable method (`action_set_won`) with the display updated optimistically.

## Correctness Properties

Property 1: Bug Condition — Offline writes skip rainbowman and mark-won queues one call

_For any_ input where the bug condition holds (`isBugCondition` returns true): for an
offline form save or kanban move with a stage change, the fixed code SHALL complete the
queued write, issue and queue NO `get_rainbowman_message` call, and raise no error; for an
offline Won click, the fixed code SHALL first `await record.save()` (so a pending edit is
queued as a `web_save` ahead of the won call, matching the online save-before-button
order), then queue exactly one
`scheduleORM("crm.lead", "action_set_won", [[resId]], {context}, {extras})`, queue/issue
NO `get_rainbowman_message` or `action_set_won_rainbowman` call, set `probability = 100`
and `won_status = 'won'` for display without dirtying the record, and NOT set `stage_id`.
The queued-call invariant for the won path is: exactly one `action_set_won` and no
rainbowman; when a pending edit exists, a `web_save` precedes it in `extras.timeStamp`
order; otherwise `action_set_won` is the only queued entry.

**Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8**

Property 2: Email/Phone Propagation — queued offline web_save carries email_from/phone

_For any_ offline save where the partner-sync flags are set, the queued offline `web_save`
SHALL carry `email_from` and `phone` exactly as the online write would, because the
force-copy into `this._changes` runs on the same code path (before `super._save`) for both
connectivities.

**Validates: Requirements 2.3**

Property 3: Preservation — non-buggy inputs unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false) —
notably all online paths, non-`crm.lead` saves, and saves without a stage change — the
fixed code SHALL produce the same result as the original code, preserving the online
rainbowman lookups, the online `action_set_won_rainbowman` path, the online force-copy,
the desktop experience, and the framework queue semantics.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**

## Fix Implementation

### Files that change (all of them; no others)

1. `addons/crm/static/src/views/crm_form/crm_form.js` — gate the rainbowman call offline;
   add a CRM form controller for the offline Won path and register it on the `crm_form`
   views entry.
2. `addons/crm/static/src/views/crm_kanban/crm_kanban_model.js` — gate the rainbowman call
   offline in `moveRecords`.
3. `addons/crm/views/crm_lead_views.xml` — add `data-available-offline` to the "Won"
   button.
4. `addons/crm/static/tests/crm_offline.test.js` — append JS tests (both presets).
5. `addons/crm/tests/test_crm_offline.py` — append Python tests to class `TestCrmOffline`.

No new source files. No manifest change. No file outside `addons/crm/`.
`check_rainbowman_message.js` is NOT modified.

### Change 1 — Bug 1 gate in `crm_form.js` (`CrmFormRecord._save`)

Keep the force-copy of `email_from`/`phone` into `this._changes` **before**
`super._save(...)` exactly as it is today — ungated, on both connectivities (this is the
Bug 2 fix). After `const res = await super._save(...)`, change the existing condition
`if (res && changeStage)` to additionally require online:

```
if (res && changeStage && !this.model.offlinePlugin.isOffline()) {
    await checkRainbowmanMessage(this.model.orm, this.model.effect, this.resId);
}
```

Online (`!isOffline()` true) the condition is textually identical to today, so the online
path is unchanged. Offline the `orm.call` is never reached.

### Change 2 — Bug 1 gate in `crm_kanban_model.js` (`moveRecords`)

The rainbowman block runs after `await super.moveRecords(...)`. Add the online guard to
the existing condition:

```
if (targetGroup && movedLeads.length && this.groupByField.name === "stage_id"
    && !this.model.offlinePlugin.isOffline()) {
    await checkRainbowmanMessage(this.model.orm, this.model.effect, movedLeads[0].resId);
}
```

Same accessor rationale (`CrmKanbanModel extends RelationalModel`). The framework still
queues the move itself; only the follow-up lookup is skipped offline.

### Change 3 — Bug 2 (no code change, framework proof)

No new code. The force-copy stays before `super._save`. Framework proof that the queued
offline `web_save` carries `email_from`/`phone`:

- `super._save()` → `webSave(...)` is attempted; offline it throws `ConnectionLostError`
  (`record.js:1328` call; `record.js:1335` `catch`), and the catch returns
  `this._offlineSave()` (`record.js:1336`).
- `_offlineSave()` (`record.js:1391`) sets
  `this._offlineChanges = markRaw({ ...(this._offlineChanges || {}), ...this._changes })`
  (`record.js:1393`), derives `offlineChanges` from it, then enqueues
  `scheduleORM(resModel, "web_save", [ [resId], offlineChanges ], { context, specification: {} }, { id, extras })`
  (`record.js:1397` onward).
- Because `CrmFormRecord._save` copied `email_from`/`phone` into `this._changes` **before**
  `super._save`, those keys are in `this._changes` when `_offlineSave` folds them into
  `_offlineChanges`, so they ride into the queued `web_save` verbatim.

The design's only obligation for Bug 2 is to keep that copy ungated and ahead of
`super._save`, and to add tests (AC-J4, AC-P1) that prove the queued write carries the
values. Confirmed read: `record.js:1328/1335/1336/1391/1393`.

### Change 4 — Bug 3 attribute in `crm_lead_views.xml`

The framework gate is a CSS selector:
`SELECTORS_TO_DISABLE = ["button:not([data-available-offline]):not([disabled])"]`
(offline-framework steering; `offline_plugin.js`). Going offline, `_offlineUI()` adds
`disabled` + `o_disabled_offline` to every matching element, and a `MutationObserver`
re-applies as the DOM changes. **Presence** of the attribute is what matters — the
selector is `:not([data-available-offline])`, so any element carrying the attribute (with
any value, including empty) is excluded and stays clickable.

The Won button today (`crm_lead_views.xml:9-12`):
```
<button name="action_set_won_rainbowman" string="Won"
    type="object" class="oe_highlight" data-hotkey="w"
    invisible="won_status == 'won' or type == 'lead' or not active"/>
```

Add `data-available-offline="1"` to it. The exact form written is
`data-available-offline="1"` (a concrete value, matching the existing CRM convention and
the framework's own usage); only presence is tested by the selector, so the value is inert.
This XML edit changes no desktop/online behavior: online the framework does not run the
disable pass, so the attribute has no effect.

### Change 5 — Bug 3 offline Won path (`CrmFormController` in `crm_form.js`)

Add a CRM form controller and register it alongside the existing Model. The registry entry
`registry.category("views").add("crm_form", { ...formView, Model: CrmFormModel })` becomes
`{ ...formView, Model: CrmFormModel, Controller: CrmFormController }`.
`CrmFormController extends formView.Controller`.

Import `getScheduleORMExtras` from `@web/model/relational_model/utils` (confirmed export at
`utils.js:869`; already imported from `"./utils"` by `record.js:16`). Its result already
includes `timeStamp: Date.now()` (`utils.js:872-874`), so no separate timestamp is needed —
reuse the exact extras shape record.js uses for its own `scheduleORM` fallbacks:
`getScheduleORMExtras(this.model, [record])`.

Override `beforeExecuteActionButton(clickParams)` (the method becomes `async`, and the
non-won branches `return` the `super` call unchanged):

The controller also overrides `setup()` to acquire the notification service
(`this.notification = useService("notification")`), used only by the new-record guard
below.

```
async beforeExecuteActionButton(clickParams) {
    if (this.model.offlinePlugin.isOffline()
        && clickParams.name === "action_set_won_rainbowman") {
        const record = this.model.root;
        // Save first, mirroring the base controller's online save-before-button:
        // the base formView.Controller captures `saved = await record.save(...)`
        // and only proceeds `if (saved !== false)`. Replicate that guard: a pending
        // offline edit is queued as a web_save BEFORE action_set_won, so the offline
        // queue order (web_save then action_set_won) matches online.
        const saved = await record.save();
        // Invalid/failed save (e.g. an invalid or empty required field): queue
        // nothing, set no optimistic won, and halt the button — matching the base
        // controller, where an invalid-field save is rejected and the button does
        // not proceed. With no pending changes, _save returns true early (non-false).
        if (saved === false) {
            return false;
        }
        // No server id (brand-new opportunity, or one created offline and not yet
        // synced): the won call cannot be queued because its id would have to come
        // from another queued call (the offline create), and the queue replays
        // verbatim with no id remapping. Block the click with a notification and
        // queue nothing.
        if (record.isNew) {
            this.notification.add(
                _t("Sync this opportunity before marking it won."),
                { type: "warning" },
            );
            return false;
        }
        // Queue exactly one queueable call (NOT the rainbowman variant).
        this.model.offlinePlugin.scheduleORM(
            "crm.lead",
            "action_set_won",
            [[record.resId]],
            { context: record.context },
            { extras: getScheduleORMExtras(this.model, [record]) },
        );
        // Optimistic won WITHOUT dirtying — the framework's own _applyValues folds
        // the values into the committed baseline, data, textValues and eval context
        // together, leaving _changes untouched.
        record._applyValues({ probability: 100, won_status: "won" });
        this.model.notify();
        // Do NOT set stage_id (server resolves the won stage via _stage_find).
        // Stop the normal button execution so the server call never happens.
        return false;
    }
    return super.beforeExecuteActionButton(clickParams);
}
```

**Why `const saved = await record.save()` first, with the `saved === false` guard (queue
order matches online; invalid saves are rejected).** The base
`formView.Controller.beforeExecuteActionButton` captures `saved = await record.save(...)`
and only proceeds `if (saved !== false)` (confirmed in `form_controller.js`): an invalid
save (e.g. an invalid or empty required field makes `record.save()` return `false`) halts
the button so it does nothing. The offline Won branch mirrors this exactly: it captures the
save result and, when `saved === false`, queues NO `action_set_won`, sets NO optimistic won
display, and returns `false` BEFORE either side effect — so an invalid-field save offline
matches online (the save is rejected, the button does nothing). Only on a successful save
does it queue `action_set_won` and set the optimistic won. On a successful save, replicating
`await record.save()` first means any pending offline edit is queued as a `web_save` BEFORE
the `action_set_won` entry, so the offline queue order (`web_save` then `action_set_won`, in
`extras.timeStamp` order) matches the online flow (save, then button). Confirmed read of
`record.js`: `record.save()` → `_save()`; offline with VALID pending changes, `webSave`
throws `ConnectionLostError` and the catch returns `_offlineSave()`, which queues the
`web_save` and resolves non-`false` (`record.js:1335/1336`, `_offlineSave` at
`record.js:1391`); with NO pending changes, `_save` returns `true` early after the
empty-`changes` guard (`record.js:~1241`: `this.dirty = false; return true;`) and queues
nothing; with an INVALID required field, `_save` returns `false` and queues nothing. So the
`saved === false` guard adds a preceding `web_save` only when there is a valid edit to flush,
and otherwise either proceeds (no edit) or halts (invalid edit). The method is therefore
`async`, and the non-won branches return the `super` call.

**Why `clickParams.name` is the method.** In `view_button_hook.js`, `onClickViewButton`
runs `options.beforeExecuteAction?.(clickParams)` and only afterward builds
`doActionParams = Object.assign({}, clickParams, {...})` for `action.doActionButton`. So
`clickParams.name` still holds the declared button method
(`"action_set_won_rainbowman"`) at the time our override runs.

**Why `return false` halts the server call (exact contract).** In `view_button_hook.js`:
- `function undefinedAsTrue(val) { return typeof val === "undefined" || val; }`
- `execute()` computes
  `_continue = _continue && undefinedAsTrue(await options.beforeExecuteAction?.(clickParams));`
  then `if (!_continue) { return; }` — this guard returns **before**
  `await action.doActionButton(doActionParams, { newWindow });`.

So returning `false` makes `undefinedAsTrue(false) === false`, `_continue` becomes false,
and `execute()` returns before `doActionButton` — `action_set_won_rainbowman` is never
issued. Returning `undefined`/`true` would continue; we return `false`. The base
`formView.Controller.beforeExecuteActionButton` saves the record first and lets the button
proceed; for the offline+won case we must NOT call `super` (that would attempt the normal
flow), so we handle it entirely and `return false`. For every other case (online, or any
other button) we call and return `super.beforeExecuteActionButton(clickParams)` unchanged,
preserving the online save-before-button behavior and the online `action_set_won_rainbowman`
call.

**Why the `record.isNew` guard (no server id).** The queue replays each call verbatim with
no id remapping between calls, so a queued `action_set_won` must carry a concrete server id
in `args[0]`. A record with no server id (`record.isNew` — a brand-new opportunity, or one
created offline whose create is itself still queued) has no such id: offline, `_offlineSave`
queues the create with `args[0] = []` and never assigns a server id (`record.js:1391-1401`),
so `record.resId` stays `undefined`. Queuing `action_set_won([[undefined]])` would be
unresolvable on replay. The control cannot be statically disabled per-record offline-only
from inside `addons/crm` without changing online behavior: the framework's
`SELECTORS_TO_DISABLE` pass keys on the *presence* of the static `data-available-offline`
attribute, not a dynamic expression, and the button's `invisible` modifier cannot read
offline state. So the controller blocks the click with a warning notification ("Sync this
opportunity before marking it won") and queues nothing. Online is unaffected (the whole
branch is gated on `isOffline()`), so online a new record still saves and then marks won
through the normal `action_set_won_rainbowman` flow.

**Why optimistic-won does not dirty the record (`_applyValues`).** The optimistic values are
applied with `record._applyValues({ probability: 100, won_status: "won" })` followed by
`this.model.notify()`. `_applyValues` (`record.js:478-493`) parses the given server-shaped
values and folds them into `_values` (the committed baseline), the reactive `data`,
`_textValues`, and `_initialTextValues`, then calls `_setEvalContext()` — all together —
WITHOUT touching `_changes`. So `dirty` stays false and `_changes` stays empty: no extra
`web_save` carrying `probability`/`won_status` is queued when the user later saves or leaves
the form, and the view's `invisible` modifiers re-evaluate against the committed values (the
Won button hides, the "Won" ribbon shows). This is the framework's own cohesive mechanism
for applying committed values without dirtying a record — it is used by `relational_model`
and `static_list` when applying reloaded server values — and is preferred over writing the
private fields (`_values`, `data`, `_textValues`, eval context) independently. There is no
public display-only API for this: `record.update()` routes through `_update()`, which sets
`this.dirty = true` and populates `_changes` (`record.js:1561-1563`), which is exactly what
must be avoided.

**Why one call, no id remapping.** `action_set_won` takes `[[record.resId]]` with a concrete
server id. The new-record guard above guarantees `record.resId` is a real server id by the
time this runs (a record visited online, or already synced), so the argument list is
client-resolvable — safe to queue verbatim per the framework's no-id-remapping replay. The
rainbowman variant is never queued or issued.

### Row 8 — queue semantics (no queue changes)

No queue changes. Replay ordering (`extras.timeStamp` ascending) and parked-on-rejection
(an entry re-scheduled with `extras.error` on a non-connection error) are provided by the
existing web `_syncORM()` and the offline systray (offline-framework steering). Spec 04
only adds callers: the explicit `scheduleORM` for `action_set_won`, and the framework's own
`web_save` fallback for edits/moves. `getScheduleORMExtras` supplies `extras.timeStamp`.
Tests assert ordering of two offline writes (AC-J8, Req 3.8) and parked-on-rejection
(AC-J9, Req 3.9) through the framework queue; no CRM error UI is added. AC-J9 proves the
absence of CRM error UI with the real framework DOM selectors — no `.modal` and no danger
notification (`.o_notification_bar.bg-danger`) — rather than a bespoke CRM error class
(none exists), so the parked entry is surfaced only through the framework systray. AC-J8/
AC-J9 reuse the existing queue-read patterns in `crm_offline.test.js` (`_ormToSync`, parked
`extras.error`) and change the queue in no way.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each bug on unfixed code, then
verify the fix works and preserves existing behavior. JS tests are appended to
`addons/crm/static/tests/crm_offline.test.js` and MUST pass under BOTH the desktop and
mobile presets (paired `test.tags("desktop")` / `test.tags("mobile")`, as the existing file
does). Python tests are appended to class `TestCrmOffline` in
`addons/crm/tests/test_crm_offline.py`. Deterministic example/edge tests only — NO
property-based test tasks for this spec.

The existing JS file establishes the realistic approach reused here:
`defineMailModels()` is called (the webclient services behind a mount resolve mail models
such as `discuss.channel`); connectivity is driven by `OfflinePlugin.setOffline(...)`
directly rather than `mockOffline()` (which installs a catch-all 502 and makes background
RPCs flaky) unless a test genuinely needs RPCs to fail; the queue is read through
`OfflinePlugin._ormToSync()`. For the view-mount tests (AC-J1/AC-J2/AC-J7) a real `crm_form`
view is mounted with `web_test_helpers` (`mountView` / `makeMockServer` / `defineModels`),
with `onRpc` spying on whether `get_rainbowman_message` / `action_set_won` /
`action_set_won_rainbowman` are called. For AC-J3 a kanban view grouped by `stage_id` is
mounted (or `moveRecords` is exercised on the CRM kanban model) with the same RPC spies.

### Exploratory Bug Condition Checking

**Goal**: surface counterexamples on UNFIXED code before implementing, confirming the root
causes.

**Test Plan**: on unfixed code, mount the `crm_form` view, go offline, save with a stage
change, and observe `get_rainbowman_message` firing / a connection-lost error (Bug 1).
Offline-click "Won" and observe it disabled / `action_set_won_rainbowman` firing (Bug 3).
Save offline with partner-sync flags and inspect the queued `web_save` to confirm whether
`email_from`/`phone` ride along (Bug 2).

**Test Cases**:
1. **Offline form stage-change** fires `get_rainbowman_message` (will fail on unfixed code).
2. **Offline kanban move** fires `get_rainbowman_message` (will fail on unfixed code).
3. **Offline Won** is disabled / calls `action_set_won_rainbowman` (will fail on unfixed).
4. **Offline save with partner-sync** — inspect queued `web_save` values (edge: confirms
   the copy survives).

**Expected Counterexamples**: a direct `orm.call` with no fallback throwing offline; a
button disabled by the selector pass; a server-only method reached offline.

**Note — no duplicate standalone exploration tests in the committed suite.** The three
bug-condition counterexamples above (offline form stage-change, offline kanban move, and
the offline Won control) were confirmed on unfixed code during development, but they are
NOT kept as separate standalone tests in the committed `crm_offline.test.js`: each would
have duplicated a permanent AC test one-for-one. Their assertions live on permanently as
the AC tests in the Unit Tests section below — **AC-J2** (offline form save skips the
rainbowman lookup and the write is queued), **AC-J3** (offline kanban move skips the
lookup and the move is queued) and **AC-J5** (the Won button is clickable offline) — which
fully cover that offline behavior. This methodology (observe counterexamples on unfixed
code first) is retained as a development step; only the duplicate standalone tests are
omitted.

### Fix Checking

**Goal**: for all inputs where the bug condition holds, the fixed code produces the
expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := fixedCode(X)
  IF X.action IN {FORM_SAVE, KANBAN_MOVE} THEN
    ASSERT no_rainbowman_call(result) AND write_is_queued(result) AND no_error(result)
  ELSE  // MARK_WON — saved := await record.save() runs first (saved !== false guard)
    IF result.saved = FALSE THEN
      // Invalid/failed save (e.g. invalid required field): button does not proceed
      ASSERT count(queued_calls(result), ("crm.lead","action_set_won",[[resId]])) = 0
         AND no_rainbowman_call(result)
         AND result.record.won_status != 'won'
         AND result.returnValue = FALSE
    ELSE IF result.record.isNew THEN
      // No server id (new or offline-created): cannot queue (no id remapping),
      // blocked with a warning notification, nothing queued
      ASSERT count(queued_calls(result), ("crm.lead","action_set_won",*)) = 0
         AND no_rainbowman_call(result)
         AND result.record.won_status != 'won'
         AND warning_notification_shown(result)
         AND result.returnValue = FALSE
    ELSE
      ASSERT count(queued_calls(result), ("crm.lead","action_set_won",[[resId]])) = 1
         AND (X.hasPendingEdit
                ? queued_calls(result) = [ web_save_for(resId), ("crm.lead","action_set_won",[[resId]]) ]
                    AND timeStamp(web_save_for(resId)) < timeStamp(action_set_won_for(resId))
                : queued_calls(result) = [ ("crm.lead","action_set_won",[[resId]]) ])
         AND no_rainbowman_call(result)
         AND result.record.probability = 100 AND result.record.won_status = 'won'
         AND NOT record_dirty(result.record)
    END IF
  END IF
END FOR
```

### Preservation Checking

**Goal**: for all inputs where the bug condition does NOT hold, the fixed code equals the
original.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT originalCode(X) = fixedCode(X)
END FOR
```

**Testing Approach**: expressed as deterministic example/edge tests (not property-based,
per the no-new-dependency constraint). Online paths are observed to still fire the
rainbowman lookups and `action_set_won_rainbowman`; non-`crm.lead` and no-stage-change
saves are observed to skip the lookup.

**Test Plan**: observe online/non-buggy behavior, then pin it with assertions that hold
after the fix. The gated conditions are textually identical to today when `!isOffline()`.

**Test Cases**:
1. **Online rainbowman preserved** — online stage-change save still calls
   `get_rainbowman_message` (AC-J1).
2. **Online Won preserved** — online Won still calls `action_set_won_rainbowman` (AC-J7).
3. **Existing hook tests preserved** — the spec-02 hook tests still pass (Req 3.10).

### Unit Tests

JavaScript, appended to `crm_offline.test.js`, each paired desktop + mobile. Mobile-preset
coverage is required for any new mobile-affecting path; both presets run.

The spec-04 mock `crm.lead` fixture defines `won_status` as `fields.Selection` with the
production options (`[['won','Won'],['lost','Lost'],['pending','Pending']]`) to match
production (`crm_lead.py:224`), so selection values resolve from `record.data` exactly as in
production and the optimistic-won `_applyValues` update is exercised faithfully.

- **AC-J1** (Req 3.1): online, mount `crm_form`, change `stage_id`, save; `onRpc` asserts
  `get_rainbowman_message` IS called.
- **AC-J2** (Req 2.1): offline (`setOffline(true)`), mount `crm_form`, change `stage_id`,
  save; assert NO `get_rainbowman_message` RPC and no error; the write is queued
  (`_ormToSync()` has a `web_save` for the lead).
- **AC-J3** (Req 2.2): offline, kanban grouped by `stage_id`, `moveRecords` across stage;
  assert NO `get_rainbowman_message` and no error; the move is queued.
- **AC-J4** (Req 2.3): offline, save a lead with the partner-sync flags set; inspect the
  queued `web_save` entry and assert its values carry `email_from` and `phone`.
- **AC-J5** (Req 2.4): offline, mount `crm_form`; assert the Won button is NOT disabled
  (no `disabled` / `o_disabled_offline` after the offline pass), proving
  `data-available-offline` keeps it clickable.
- **AC-J6** (Req 2.5, 2.6, 2.7): offline, click "Won" on a record WITH a server id; assert
  exactly one queued `action_set_won` entry for that lead via `_ormToSync()`, and NO
  `get_rainbowman_message` / `action_set_won_rainbowman` RPC fired; assert
  `record.data.probability === 100` and `record.data.won_status === "won"` (applied via
  `record._applyValues`); additionally assert the rendered DOM reflects won — the Won button
  is now HIDDEN (its `invisible="won_status == 'won' ..."` modifier hides it once
  `won_status` is 'won') and the won state is displayed (the `web_ribbon` "Won" ribbon, with
  `invisible="won_status != 'won'"`, becomes visible), proving the optimistic update reaches
  the view and not just the record object; assert `record.dirty === false`; then save/leave
  and assert no additional `web_save` carrying `probability` or `won_status` is queued
  (record not dirty).
- **AC-J7** (Req 3.3): online, click "Won"; `onRpc` asserts `action_set_won_rainbowman`
  IS called.
- **AC-J8** (Req 3.8): drive a REAL replay through the framework rather than only
  inspecting the queued entries. Mechanism (confirmed from `offline_plugin.js` and the
  existing `addons/web/static/tests/webclient/offline_systray.test.js`): going back online
  (`setOffline(false)`) triggers `_syncORM()`, which filters out entries with
  `extras.error`, sorts the rest ascending by `extras.timeStamp`, and replays each via
  `orm.silent.call(model, method, args, kwargs)` with a ~1s gap between entries (so the
  test advances timers with `runAllTimers()`); a successful entry is removed. Queue two
  `web_save` writes to the SAME lead while offline with ascending `extras.timeStamp` (e.g.
  timeStamp 1 then 2), go back online, let the framework replay (advance timers); assert
  via `onRpc` / the mock server that the two `web_save` calls ARRIVE in `extras.timeStamp`
  order (first the earlier-timeStamp write, then the later), and that the SECOND write's
  value is the one that ends up on the record (last write wins) — assert on what the mock
  server received / the resulting record value, not just the queued entries. No conflict
  dialog appears; the framework queue is unchanged. This test genuinely needs RPCs to
  resolve, so `mockOffline()` + `onRpc` is the correct tool here (unlike the signal-only
  `setOffline` the hook tests use); the realistic harness is the one the existing systray
  test uses: `mockOffline()` + mount `WebClient` + `onRpc` + `runAllTimers()` + read the
  systray DOM.
- **AC-J9** (Req 3.9): drive a REAL replay. Queue a write offline, make the mock server
  REJECT that call (`onRpc` returns a non-`ConnectionLost` error / `RPCError` when the
  replay fires), go back online (`setOffline(false)`) and let the replay run (advance
  timers with `runAllTimers()`); the non-`ConnectionLost` error re-schedules the entry
  with `extras.error` (parked, still in `_ormToSync` with `extras.error` set). Assert the
  parked entry carries the SERVER's error, not merely some error: `extras.error` INCLUDES
  "Server rejected the write" (`_syncORM` stores `e.data.name + " - " + e.data.message` for
  an `RPCError`). Assert the entry is shown in the existing offline systray as an error (the
  `[data-icon='error']` / `.text-danger` entry, per the existing systray test), and that the
  systray error element's `data-tooltip` INCLUDES "Server rejected the write"
  (`offline_systray.xml` binds `data-tooltip` to `element.error ?? element.displayName`). With
  the systray dropdown open at that point, assert the parked entry is surfaced ONLY through
  the framework systray and no CRM-specific error dialog or toast is raised: no `.modal` and
  no danger notification
  (`.o_notification_bar.bg-danger`) appear — `expect('.modal').toHaveCount(0)` and
  `expect('.o_notification_bar.bg-danger').toHaveCount(0)`. These are the real framework
  DOM selectors (a danger toast renders `o_notification_bar bg-danger` per
  `addons/web/static/src/core/notifications/notification.xml`; a dialog renders `.modal`);
  a bespoke CRM class such as `.o_crm_offline_error` is NOT asserted because no such class
  exists, so asserting its absence would prove nothing. Uses the same realistic harness as
  AC-J8 (`mockOffline()` + mount `WebClient` + `onRpc` + `runAllTimers()` + systray DOM),
  reusing the existing systray test's DOM assertions as the model; the framework queue is
  unchanged.
- **AC-J10** (Req 2.5; ordering relates to Row 8 / Req 3.8): offline, edit a field, then
  click "Won"; assert the queue holds the two entries in order `web_save` (carrying the
  edit) THEN `action_set_won` for that lead, proving the `await record.save()` runs before
  the won call so the offline queue order matches the online flow.
- **AC-J11** (Req 2.5): offline, mount `crm_form` with an invalid/empty required field
  (clear a field that is required on the `crm.lead` form so `record.save()` returns
  `false`), then click "Won"; assert NOTHING is queued for the lead (no `action_set_won`,
  no `web_save` via `_ormToSync()`) and the lead is NOT shown as won (`won_status` is not
  'won', the Won button still visible). This proves the offline Won branch mirrors the base
  controller's `saved !== false` guard, so an invalid-field save offline matches online
  (the save is rejected and the button does nothing). The test makes a required field
  invalid — the required `name` field — to force `record.save() === false`.
- **AC-J12** (Req 2.5): offline, mount `crm_form` as a NEW opportunity (no `resId`, so
  `record.isNew` is true — equivalently a lead created offline and not yet synced), set a
  valid `name`, and click "Won"; assert NOTHING is queued (no `action_set_won` /
  `action_set_won_rainbowman` anywhere in the queue — asserted across the whole queue, since
  there is no `resId` to key on), the lead is NOT shown as won (`won_status` is not 'won',
  the Won button still visible), and a warning notification ("Sync this opportunity before
  marking it won", `.o_notification`) appears. This proves the `record.isNew` guard: a
  record whose server id would come from another queued call is never queued.

Edge/guard coverage reuses the existing patterns (empty queue, parked `extras.error`,
model/id matching) already present in the file; new paths added by this spec (the two
gates, the controller override's offline+won success branch, its `saved === false`
early-return branch, its `record.isNew` notify-and-return branch, and its online/other-button
`super` branch) are each exercised by at least one new test for ≥80% statement coverage of
the changed JS.

### Property-Based Tests

None. Adding a JavaScript property-testing package would violate the no-new-dependency
constraint; the properties above are expressed as deterministic example and edge-case
tests.

### Integration Tests

Python, appended to class `TestCrmOffline` (uses the `TestCrmCommon` fixtures and
`HttpCase` already imported in the file). These replay the queued calls through the real
ORM to prove server-side correctness:

- **AC-P1** (Req 2.3): take the exact queued `web_save` args for an offline edit with
  partner sync and apply them verbatim through the ORM; compare the resulting lead +
  partner `email_from`/`phone` to the online write path and assert they match. The Python
  test builds and applies a `web_save` with EXACTLY the arguments the JS test (AC-J4)
  asserts are queued, so the JS "what is queued" and the Python "what the server does with
  it" assertions are tied to the same call shape.
- **AC-P2** (Req 2.8): apply the queued `action_set_won` call (`action_set_won` on
  `[[resId]]`) through the ORM and assert `won_status == 'won'`, the lead's `stage_id` is a
  won stage (`stage_id.is_won`), and `probability == 100`.

The existing `test_shortcuts_extend_parent` and `test_manifest_http_salesman` are untouched
and keep passing (Req 3.11).

## Verification

`check.sh quick` and `check.sh full` are run; all five test commands and all scope checks
pass; acceptance row 5 (crm manifest version bumped one minor increment) is EXPECTED to
fail until spec 08 (the version bump belongs to spec 08 and is not performed here). This is
reported as an explicit, expected deviation, not a regression.
