# Implementation Plan: 06-data-coverage

## Overview

Spec 06 is the PART 3 "data coverage" slice of the CRM offline project. It consumes the web
addon's existing offline framework and queue and adds no new machinery. All work lands in
EXISTING files (Option 2 — no new file):

- `addons/crm/static/src/activity_menu_patch.js` — the `Activity.onClickMarkAsDone` component
  patch (its `setup` uses `useCrmOffline()` — plugin API, no legacy service bridge), the
  inline-template schedule-sheet OWL component (exported), and the `OfflineSystray`
  classification patch.
- `addons/crm/static/src/views/crm_form/crm_form.js` — the `CrmChatter.scheduleActivity()`
  component override (opens the bottom sheet via `usePlugin(BottomSheetPlugin)` and queues
  `activity_schedule`; NOT a global store patch), the queue-derived optimistic rows + markers
  (with a module-level `WeakMap` keyed by the store record — `_activityMarkerOriginals`,
  holding each activity's original summary + `can_write` — restored on discard and reused
  across remount so the marker never doubles,
  and a queue-signature re-run so a park-in-place refreshes needs-retry), the double-mark-done
  attribute guard, the local-date state rule, and the `data-available-offline` set/remove
  wiring. (3c adds no code here — the `Field` patch was dropped; 3c is verify-and-prove.)
- `addons/crm/static/src/views/crm_form/crm_form.scss` — styling.
- `addons/crm/models/mail_activity.py` — Python side (already `_inherit`, already imported).
- `addons/crm/static/tests/crm_offline.test.js` — new JS tests (allowed new content).
- `addons/crm/tests/test_crm_offline.py` — new Python tests appended to `TestCrmOffline`.

Implementation language is JavaScript (OWL / ES modules) and Python (Odoo 20.0 ORM), as the
design specifies concrete code in both — no pseudocode, so no language choice is required.

Tasks are ordered so every test is written against the PRODUCTION wiring (no `force: true`,
no hand-set flags — per the spec-05 lessons), with a paired desktop/mobile JS test AND a
removal check (delete the production wiring, confirm the test fails, restore) for every new
wired path. The groups build in this order: 3c (verify-and-prove, no CRM code) → 3b schedule
→ 3b mark-done → 3b optimistic rows / markers / reconcile → 3a create + row-9 DOM proofs →
Python replay tests. No optional property-based-test tasks are generated (there is no property-testing
facility in this repo; properties are expressed as deterministic example/edge-case tests).

The manifest `version` stays `1.9` here (the bump is spec 08).

## Execution rules

- Run the task groups in order in THIS chat.
- After two `check.sh quick` runs on one issue, STOP and show the log — do not iterate
  silently.
- If a sub-agent fails or stalls, continue in the main chat. Do NOT use sub-agents for
  test-fix loops (spec-05 lesson).
- NEVER rewrite a test to bypass production wiring: no `force: true` registration, no
  hand-set flags, no patching `setOffline`.
- Tick a `tasks.md` item `[x]` ONLY when its test is green.
- Re-stage `.kiro` artifacts with `git add -f`.
- TEST-ENV CAVEAT (`_crypto`): if `offlinePlugin._crypto` is unavailable in the Hoot
  environment, `cacheMany2XSearch` / `searchMany2XRecords` SILENTLY NO-OP (they early-return
  on `!this._crypto`, `offline_plugin.js:298` / `:307`). If a prefetch or cache test (4.4,
  4.5, 4.9) hits that no-op, STOP and tell the user rather than working around it (do not
  hand-write the many2x cache or stub `_crypto` to force the path).

## Tasks

- [x] 1. Size guard checkpoint (read before and during every implementation task)
  - Keep each added block small and clearly commented. The design's conservative estimate is
    ~150–200 added lines in `activity_menu_patch.js`, ~105–150 in `crm_form.js` (no 3c `Field`
    patch — dropped), ~25–45 in `crm_form.scss`.
  - STOP and ask the user if, during implementation, ANY SINGLE existing file would grow by
    more than ~300 lines, OR if the schedule sheet needs a stylesheet or template OUTSIDE
    the existing files (anything beyond `crm_form.scss` or the inline `` xml`...` `` template).
    Do NOT create a new file; any file outside the allowed-files list needs explicit user
    approval first.
  - SIZE-GUARD EXCEPTION (review round 1, APPROVED by the user): as built, `crm_form.js`
    grew by ~497 added lines (288 → 785), OVER the ~300-added guard; the stop-rule was not
    applied during initial implementation. The user accepted this as a documented exception
    — the constraint that matters, NO new file, holds (the frozen allowed-files list is
    honoured), and `CrmChatter` is the cohesive home for all this behaviour. See the design
    "Size-guard exception" subsection for the per-file as-built numbers. `activity_menu_patch.js`
    (+211) and `crm_form.scss` (+20) stay within the guard.
  - _Requirements: 15.1, 15.2_

- [x] 2. 3c — Offline partner-field: verify-and-prove the framework forbids create (NO CRM code)
  - [x] 2.1 Write the 3c partner-create-forbidden + lookup JS tests (paired desktop/mobile) in `crm_offline.test.js`
    - 3c adds NO CRM runtime code — the create path is already closed by the framework
      offline. This task writes verify-and-prove tests only; there is nothing to implement.
    - Mount the crm lead form view with `partner_id` rendered by the GENERIC many2one widget
      (NO `widget` attribute) and `res.partner` DEFINED in the mock. OFFLINE: type an
      unmatched name and assert NO `.o_m2o_dropdown_option_create` /
      `.o_m2o_dropdown_option_create_edit` / `.o_m2o_dropdown_option_search_more` entry
      appears, AND pressing Enter/Tab commits nothing (no `{ id: false, display_name }`; the
      field value stays unchanged / empty). ONLINE: the same input offers Create / Create and
      edit. Pair desktop and mobile presets and assert both connectivity states.
    - State PLAINLY in the test comment: these tests PROVE THE FRAMEWORK'S behaviour (action
      suggestions built online-only, `relational_utils.js:450`; the `quickCreate` commit
      reachable only from one of those, `:515`; Enter/Tab commits nothing,
      `autocomplete.js:399-402`), upstream of ANY many2one widget. The REAL arch uses
      `widget="res_partner_many2one"`, which the crm unit-test bundle cannot register
      (registered only in `web.assets_backend`; `web.assets_unit_tests` lists only
      `partner_autocomplete/static/tests/**` — `partner_autocomplete/__manifest__.py`), so
      this test proves it via the generic many2one widget and the real-widget behaviour is
      confirmed in the Step-10 manual check. Do NOT register a stand-in widget under the name
      `res_partner_many2one` (no faking the widget).
    - Offline lookup via cache: a contact loaded online resolves its `display_name` and is
      found by an offline search of the partner field — served by the framework
      `many2x_res.partner` cache (no second cache).
    - There is NO CRM wiring to remove, so there is NO removal check (same posture as the
      row-9 tests, which also assert framework behaviour).
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3; Property 9_

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 3b — Mobile-only offline activity scheduling (schedule / log a call)
  - [x] 4.1 Implement the `CrmChatter.scheduleActivity()` override + the inline schedule-sheet component (AS BUILT)
    - AS BUILT (review round 1 — NOT a global store patch): the schedule swap is a
      **component-method override of `scheduleActivity()` on `CrmChatter`** (`crm_form.js`).
      Mail's chatter Activity button calls `this.scheduleActivity` (`chatter_patch.js:507`);
      the override opens the inline-`` xml`...` `` bottom-sheet via `usePlugin(BottomSheetPlugin)`
      and queues `activity_schedule` when `isSmall() && offline` for a crm lead; otherwise it
      falls through to `super.scheduleActivity()` (the normal `mail.activity.schedule` wizard).
      Uses the plugin API (`useCrmOffline` / `usePlugin`), NO legacy `env.services.offline`
      bridge, NO global `Store.prototype` patch. The schedule-sheet OWL component is defined and
      EXPORTED in `activity_menu_patch.js` and imported by `crm_form.js`.
    - The ACTIVITY TYPES are resolved by `CrmChatter.scheduleActivity()` (NOT by the sheet) via
      `_schedulableTypes()` — the shared `many2x_mail.activity.type` cache intersected with the
      prefetch's non-meeting allow-list (`_schedulableTypeIds`, keyed per OfflinePlugin) — and
      passed to the sheet as a plain `activityTypes` prop; a meeting-category type is never
      offered (Requirement 11.1). If the schedulable set is empty the override returns without
      opening the sheet (the button is disabled in that state anyway).
    - On submit, enqueue exactly
      `scheduleORM("crm.lead", "activity_schedule", [[leadId]], { activity_type_id, summary, date_deadline, user_id })`
      with systray `extras` (`actionName`, `displayName`) — no `ir.model` id, no onchange, no
      transient wizard. "Log a call" is the same call with a Call-type `activity_type_id`.
    - NO-SERVER-ID GUARD (review round 1): when `isSmall() && offline` but the lead has no
      server id, the override RETURNS WITHOUT calling super (super would save the unsaved
      record and queue a lead create) — queues nothing.
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 11.1, 12.4; Property 1_
  - [x] 4.2 Implement the `data-available-offline` set/remove wiring for the Activity button in `crm_form.js`
    - In `CrmChatter` `onMounted`/`onPatched`, set `data-available-offline` on
      `.o-mail-Chatter-activity` only when `isSmall() && offline && !record.isNew && the lead
      has a server id && the awaited many2x search for "mail.activity.type" is non-empty`.
    - REMOVE the attribute whenever any gate condition flips false (online, empty activity-type
      cache, or the lead loses its server id), so `onPatched` makes the attribute TRACK the
      gate and the framework re-disables the bare `<button>`.
    - _Requirements: 3.1, 4.1, 7.1, 7.3, 12.1; Property 3, Property 5_
  - [x] 4.3 Add schedule-sheet + bottom-sheet styling in `crm_form.scss`
    - Bottom-sheet layout and schedule-sheet field styling (classes used by the sheet
      component hosted in `activity_menu_patch.js`, loaded by the same backend glob).
    - _Requirements: 3.2_
  - [x] 4.4 Write the 3b mobile schedule + log-a-call JS test + removal check (paired desktop/mobile) in `crm_offline.test.js`
    - PRIME THE CACHE THROUGH THE REAL PREFETCH PATH: mount `CrmChatter` ONLINE first (so the
      activity-type prefetch of task 4.8 runs and fills the framework many2x cache), THEN go
      offline. Do NOT hand-write the many2x cache in the test.
    - Mobile + offline, lead with a server id and the (prefetched) cached activity type: the
      Activity button carries `data-available-offline`; press the real button, submit the
      sheet, and assert it queues EXACTLY
      `scheduleORM("crm.lead","activity_schedule",[[leadId]],{activity_type_id, summary, date_deadline, user_id})`.
    - Log-a-call case: pick the Call-type activity in the schedule sheet BY SELECTION FROM THE
      CACHED LIST — identified by its id / list choice, NOT by matching a translated name —
      submit, and assert the queued `activity_type_id` equals the Call type's id. State
      explicitly in the test: the Call type is identified by choice/id, never by matching a
      translated string.
    - Removal check: stub `CrmChatter._syncActivityOfflineAttr` to a no-op (so the
      `data-available-offline` wiring on `.o-mail-Chatter-activity` is never set), confirm the
      button stays framework-disabled offline and nothing queues, restore. (As built the
      scheduleORM lives in `CrmChatter.scheduleActivity()`, not a global store patch.)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5; Property 1_
  - [x] 4.5 Write the 3b empty-cache-disable JS test (paired desktop/mobile) in `crm_offline.test.js`
    - Mobile + offline with NO cached activity type (the awaited search returns `[]`):
      `CrmChatter` does not set `data-available-offline`, so the Activity button stays
      DISABLED (never a schedule sheet with an empty selector).
    - This test DELIBERATELY does NOT prime the cache through the prefetch path — it simulates
      the prefetch returning empty (the many2x search for `"mail.activity.type"` resolves
      `[]`). Do not hand-write the many2x cache.
    - _Requirements: 3.6, 7.1_
  - [x] 4.6 Write the 3b gate-false attribute-removal transition JS test + removal check in `crm_offline.test.js`
    - Under the gate the Activity button carries `data-available-offline`; flip a gate
      condition false (go online, or clear the cached activity types) and assert the attribute
      is REMOVED and the button is framework-disabled again.
    - Removal check: delete the attribute-removal half of the `onMounted`/`onPatched` wiring,
      confirm the attribute lingers (button stays enabled) and the test fails, restore.
    - _Requirements: 7.1, 7.3_
  - [x] 4.7 Write the 3b no-server-id guard JS test in `crm_offline.test.js`
    - A lead without a server id (`record.isNew`, or offline-created with its `web_save`
      create still queued) exposes no schedule control; assert the control is absent/disabled
      AND `_ormToSync()` is unchanged (nothing queued), checking the whole queue state.
    - _Requirements: 4.1, 4.2; Property 3_
  - [x] 4.8 Implement the activity-type cache prefetch in `CrmChatter` (`crm_form.js`)
    - On mount, WHEN `online && isSmall() && the lead has a server id` AND the prefetch has NOT
      yet run this page session for this `OfflinePlugin` instance: issue ONE unlimited `orm`
      `searchRead` of `mail.activity.type` with domain
      `['|', ('res_model', '=', false), ('res_model', '=', 'crm.lead')]` and fields
      `['id', 'display_name']` (the full applicable list, NOT the ~7-result autocomplete),
      then pass the result to `offlinePlugin.cacheMany2XSearch("mail.activity.type", result)`
      — feed the EXISTING framework many2x cache; add no new cache. Run it even when the cache
      already holds some types (fixing the partial-cache hole).
    - Track "has run" with a module-scoped `WeakSet` keyed by the `OfflinePlugin` instance
      (obtained via `useCrmOffline()` / `usePlugin(OfflinePlugin)`), NOT a module-level flag (a
      module-level flag leaks between Hoot tests). A SUCCESSFUL prefetch adds the plugin
      instance to the `WeakSet` (marks done); a `ConnectionLostError` leaves it UNMARKED so a
      later qualifying mount retries.
    - At most ONCE per mount AND at most once per session per plugin instance; NEVER offline
      and NEVER on desktop. Swallow `ConnectionLostError` and re-arm; after the `await`, check
      `status(this) !== "destroyed"` before touching state. No UI.
    - This primes the cache the schedule gate (tasks 4.2/4.4) and the empty-cache test (4.5)
      depend on, so it MUST be implemented before those schedule tests run.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8; Property 11_
  - [x] 4.9 Write the activity-type prefetch JS test + removal check (paired desktop/mobile) in `crm_offline.test.js`
    - A FIRST online mobile mount issues EXACTLY ONE prefetch `searchRead` of
      `mail.activity.type` EVEN WITH A PARTIALLY-FILLED CACHE (seed a partial cache first,
      confirm the read still fires), and the framework many2x cache THEN holds the FULL list
      (served by `searchMany2XRecords`, no second cache).
    - A SECOND mount in the same session (same `OfflinePlugin` instance, already marked in the
      `WeakSet`) issues NO prefetch. Desktop mount issues NO prefetch. Offline mount issues NO
      prefetch.
    - Removal check: delete the prefetch call, confirm the "cache then holds the full list" /
      "schedule control enabled" assertion fails, restore.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8; Property 11_

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 3b — Mobile-only offline mark-done (bypassing the popover)
  - [x] 6.1 Implement `patch(Activity.prototype /* component */, { onClickMarkAsDone })` in `activity_menu_patch.js`
    - Patch the component method `onClickMarkAsDone` (`activity.js:145`), NOT the model
      `markAsDone`: when `isSmall() && offline` AND the activity has a real server id AND is
      not itself pending, enqueue exactly
      `scheduleORM("mail.activity", "action_feedback", [[activityId]], {})` directly — no
      popover, no `fetchNewMessages`, no feedback; otherwise `super` (opens the popover as
      today).
    - Guard: an activity without a server id (temp negative id) queues nothing.
    - _Requirements: 5.2, 5.3, 6.1, 6.3, 12.3, 12.4; Property 1, Property 4_
  - [x] 6.2 Implement the `data-available-offline` set/remove wiring for the Done button in `crm_form.js`
    - In `CrmChatter` `onMounted`/`onPatched`, set `data-available-offline` on
      `.o-mail-Activity-markDone` only when `isSmall() && offline` AND the activity has a
      server id AND is not itself pending. Give an offline-created optimistic row
      `can_write = false` so mail's own Done button is not offered on it.
    - REMOVE the attribute whenever the mark-done gate flips false (online, the activity
      becomes pending, or it loses its server id), so the framework re-disables the bare
      `<button>`.
    - _Requirements: 5.1, 6.1, 6.2, 7.2, 7.3; Property 4_
  - [x] 6.3 Write the 3b mobile mark-done JS test + removal check (paired desktop/mobile) in `crm_offline.test.js`
    - Mobile + offline, an activity with a server id: the Done button is re-enabled; clicking
      it runs the patched `onClickMarkAsDone`, which queues
      `scheduleORM("mail.activity","action_feedback",[[activityId]],{})` WITHOUT opening the
      popover — assert NO `.o-mail-ActivityMarkAsDone` popover appears AND no `fetchNewMessages`
      RPC was sent; the row shows "done, pending sync".
    - Removal check: delete the `data-available-offline` on the Done button and/or the patched
      `onClickMarkAsDone` offline branch, confirm the test fails, restore.
    - _Requirements: 5.1, 5.2, 5.3, 5.5; Property 1_
  - [x] 6.4 Write the 3b mark-done guard JS test (no mark-done on a temp-id activity) in `crm_offline.test.js`
    - No mark-done on an activity carrying a temporary negative id (offline-created, create
      still queued): assert the Done button is absent/disabled (no `data-available-offline`,
      `can_write = false`) AND `_ormToSync()` is unchanged (nothing queued).
    - _Requirements: 6.1, 6.2, 6.3; Property 4_

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 3b — Optimistic activity rows, markers, and reconcile (in `crm_form.js`)
  - Review-fix seam (applied pre-commit): the schedule swap is `CrmChatter.scheduleActivity()`
    (component override using `usePlugin(BottomSheetPlugin)`), not a global `Store` patch; the
    `Activity` patch and the schedule swap read connectivity via `useCrmOffline()` (no legacy
    service bridge); a double-mark-done guard (early-return + Done-button suppression via
    `can_write`, restored on discard) prevents a duplicate `action_feedback`; both queued calls
    carry systray `extras` (actionName/displayName). Tested by FIX2–FIX6 in `crm_offline.test.js`.
  - [x] 8.1 Implement the queue-derived optimistic-row rebuild in `CrmChatter`
    - Subscribe to `_ormToSync()` and rebuild this lead's temp rows on mount and on every
      queue change: for each `crm.lead` / `activity_schedule` entry whose `args[0]` includes
      this lead's resId, build one temp `mail.store` `mail.activity` row from the entry's
      `kwargs`, inserted into `thread.activities` so mail's unchanged `mail.ActivityList`
      renders it (no mail-template change).
    - Temp id scheme: a deterministic negative id derived from the queue key (a stable
      `key → negId` map rebuilt from the queue), so the same queued schedule yields the same
      temp id across remounts. Reconcile: insert for each schedule entry not represented; drop
      temp rows whose key has left the queue.
    - Compute `state` with the server's rule against the LOCAL date
      (`luxon.DateTime.local().toISODate()`, not the UTC `new Date().toISOString()`):
      deadline `< today` → `overdue`, `= today` → `today`, `> today` → `planned`. Set
      `can_write = false` on temp rows.
    - A row is pending exactly while its own key is present in `_ormToSync()` — derived from
      the key, NOT from `hasQueuedWrite("crm.lead", leadId)`. Re-run the rebuild on a SIGNATURE
      of the queue (key + error flag), not the entry count, so a park-in-place refreshes the
      needs-retry marker.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5; Property 2_
  - [x] 8.2 Implement the translatable, queue-derived pending / needs-retry / done markers in `CrmChatter`
    - Append the translated marker via `_t(...)` into the row's RENDERED `summary` (no
      mail-template change): `_t("(pending sync)")` for a queued schedule;
      `_t("(done, pending sync)")` for an `action_feedback` entry matching an existing server
      activity (by id in `args[0]`); the translated needs-retry text when the matching entry
      is parked with `extras.error`.
    - Derive every marker from the matching `_ormToSync()` entry; NEVER write it destructively
      onto the stored record. Keep server-activity originals (summary AND `can_write`) in a
      module-level `WeakMap` keyed by the store record (`_activityMarkerOriginals`), restoring
      both when the entry leaves the queue — including when DISCARDED from the offline systray —
      so no stale marker lingers, and so a chatter remount restores from the true original
      (marker never doubled). Recompute on every queue-signature change and after the guarded
      refetch. Keep the offline systray
      as the only error surface (add no
      CRM error dialog/banner/second store).
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 5.5; Property 2, Property 8_
  - [x] 8.3 Implement the guarded reconnect reconciliation in `CrmChatter.load`
    - Refetch the thread ONLY through the already-guarded `CrmChatter.load` (`crm_form.js:245`):
      skip when offline AND wrap in try/catch for `ConnectionLostError`, re-arm, and refetch
      through the guarded method — never `super.load` directly. Temp rows whose key has left
      `_ormToSync()` drop (rebuilt-from-queue) and server rows fold in. For a replayed
      mark-done the reliably-proven outcome is server-side (the server archives/removes the
      activity, asserted on `MockServer.env`) and the cleared done-pending-sync marker; the
      live in-memory removal from the mounted chatter's list is best-effort (KL-B) and is
      covered end-to-end by the Python replay test, not asserted on the mounted component.
    - _Requirements: 10.1, 10.2, 10.3, 10.4; Property 7_
  - [x] 8.4 Add pending / needs-retry / done marker styling in `crm_form.scss`
    - Styling for the pending / needs-retry / done-pending-sync markers (text lives in the
      rendered `summary`; CSS is styling only).
    - _Requirements: 9.1_
  - [x] 8.5 Write the 3b pending-marker-source + survives-remount JS test + removal check in `crm_offline.test.js`
    - The pending marker tracks the activity's OWN queue entry in `_ormToSync()`, not
      `hasQueuedWrite("crm.lead", leadId)` — a queued lead EDIT must NOT mark an unrelated
      activity pending. Then leave the form and reopen it offline: the SAME temp row reappears
      (same key-derived id, no duplicate, not vanished), proving rows are rebuilt from the
      queue, not held in memory.
    - Removal check: delete the `_ormToSync()` subscription / rebuild-on-mount, confirm the
      remount test fails, restore.
    - _Requirements: 8.2, 8.3, 8.5, 9.2, 9.5; Property 2_
  - [x] 8.6 Write the 3b parked-error JS test (KL-B) in `crm_offline.test.js`
    - On a real reconnect where the replay is REJECTED, assert the reliably-observable facts:
      the entry is parked with the server's actual error text (observed at its first
      appearance, server called exactly once), the framework offline systray classifies the
      CRM entry and surfaces that raw text WITHOUT crashing, and NO CRM-specific error UI
      appears, and the server is called EXACTLY ONCE (not re-sent). Per KL-B (observed, cause
      not established) the parked entry is observable in the in-memory queue only transiently
      with the chatter mounted, and BOTH the chatter row and the systray read that same
      in-memory map — neither is claimed durable — so long-term in-memory persistence is NOT
      asserted. KL-B is flagged for Step 10 manual validation.
    - _Requirements: 1.5, 9.3, 9.10; Property 8, Property 8b_
  - [x] 8.7 Write the 3b reconcile-on-reconnect JS test + removal check in `crm_offline.test.js`
    - Real reconnect (`mockOffline()` + `WebClient` + `doAction(80)` + `setOffline(false)` +
      `runAllTimers()`): the server receives the queued `activity_schedule` (verified via
      `onRpc` step), the queue drains, and the optimistic row's pending marker is reconciled
      away. Removal check: stub `_syncOptimisticActivities` to a no-op and confirm that
      scheduling offline queues the call but renders NO optimistic row (the reliable offline
      form, matching 8.5's removal check; an online "stale row persists" check is not reliable
      under KL-B), then restore.
    - _Requirements: 10.1, 10.2, 10.3, 10.4; Property 7_
  - [x] 8.8 Write the 3b desktop-still-disabled JS test (desktop unchanged) in `crm_offline.test.js`
    - Desktop + offline: the chatter Activity button (`.o-mail-Chatter-activity`) and the
      per-activity Done button (`.o-mail-Activity-markDone`) are DISABLED (framework pass;
      `CrmChatter` sets no `data-available-offline` on desktop), and the patched
      `onClickMarkAsDone` falls through to `super`.
    - _Requirements: 7.3, 12.1, 12.4; Property 5_
  - [x] 8.9 Write the online-unchanged (both presets) JS test in `crm_offline.test.js`
    - Online, under BOTH the desktop and mobile presets: scheduling opens the
      `mail.activity.schedule` wizard and mark-done opens the popover (whose Done issues
      `action_feedback` + `fetchNewMessages`) — the offline branch is taken only when
      `isSmall() && offline`.
    - _Requirements: 12.2, 12.3, 12.5; Property 6_
  - [x] 8.10 Teach the offline systray to classify queued CRM calls, and test it (in `activity_menu_patch.js` + `crm_offline.test.js`)
    - Production: `patch(OfflineSystray.prototype, { setup })` (reached via the `systray`
      registry entry's `Component`, class not exported) wraps the per-instance `groupEntries`
      to fill a translated `{ label, color }` (palette colors reused from the framework) for
      ONLY `crm.lead/activity_schedule`, `mail.activity/action_feedback`, and the spec-04
      `crm.lead/action_set_won`; all other methods untouched. Fixes the framework
      `status.color` TypeError (`offline_systray.xml:51-53`) for CRM-queued methods, including
      the latent spec-04 mark-won defect. No new file, no mail/web change, no second surface.
    - Tests (paired desktop/mobile): queue all three CRM calls, open the systray, assert each
      renders a labelled badge with no error icon and no crash. Removal check (desktop): strip
      the status the wrapper fills and confirm the systray render throws the `color` TypeError.
    - _Requirements: 9.10, 17.1, 17.2, 17.3, 17.4; Property 8b_

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. 3a — Offline create proof + row-9 DOM proofs (JS)
  - [x] 10.1 Write the 3a G-3a-1 offline-create queue+replay JS test (paired desktop/mobile) in `crm_offline.test.js`
    - Offline, creating a lead and saving queues a `web_save` CREATE (distinct from an edit's
      `web_save`); on reconnect the mock server receives the create. Assert the WHOLE queue
      state, not just "my call is present". (This exercises the framework queue path; no new
      CRM runtime code is required for create to queue.)
    - Rejected-create case: after the offline create is queued, do a REAL reconnect
      (`mockOffline()` + `WebClient` + `setOffline(false)` + `runAllTimers()`) where the create
      replay is REJECTED by the server. Assert the entry is PARKED in the offline systray with
      its `extras.error` (including the server's actual error text) — not silently dropped.
    - _Requirements: 1.1, 1.2, 1.4, 1.5; Property 7_
  - [x] 10.2 Write the 3a G-3a-2(a) uncached-card-leaves-cached-kanban JS test (paired desktop/mobile) in `crm_offline.test.js`
    - Assert `.o_kanban_record.o_disabled_offline` exists, click it, then assert the cached
      rows stay — `.o_kanban_view` count 1 AND `.o_form_view` count 0 AND no error dialog AND
      `.o_offline_action_helper` count 0 (the helper is NOT shown). This depends on the
      framework reroute (`action_plugin.js:1314-1315`), not CRM wiring, so the DOM proof IS
      the assertion. Do NOT claim "helper".
    - _Requirements: 2.1, 2.2; Property 10_
  - [x] 10.3 Write the 3a G-3a-2(b) direct-navigation-lands-on-cached-rows JS test (paired desktop/mobile) in `crm_offline.test.js`
    - Direct-navigate offline to the uncached lead; assert the user lands on the cached
      multi-record view with real rows — `.o_form_view` count 0, no error dialog, AND
      `.o_offline_action_helper` count 0 (helper NOT rendered on a cached reroute). Verify the
      actual class/template name `web.OfflineActionHelper` renders before asserting its
      absence. Do NOT claim "helper". Case (c) is KL-A (documented, not tested as a met
      requirement).
    - _Requirements: 2.3, 2.4, 2.5; Property 10_

- [x] 11. Early verification checkpoint — run `check.sh quick`
  - Run `.kiro/scripts/check.sh quick` (do NOT retype the commands). A quick run takes ~20s;
    if one is still running near 2 minutes, STOP and report (do not rewrite tests to bypass
    production wiring). Report the script's output verbatim.
  - _Requirements: 15.4, 15.5_

- [x] 12. Python replay tests appended to `TestCrmOffline` in `test_crm_offline.py`
  - [x] 12.1 Write the queued `activity_schedule` replay Python test
    - Apply the EXACT queued `activity_schedule` call on `[[leadId]]` with the same kwargs the
      JS test asserts is queued, through the ORM; assert it yields a `mail.activity` linked to
      the lead with those same arguments (activity_type_id, summary, date_deadline, user_id,
      res_model `crm.lead`, res_id `leadId`).
    - _Requirements: 3.3, 10.1; Property 1, Property 7_
  - [x] 12.2 Write the queued `action_feedback` mark-done replay Python test
    - Apply the queued mark-done `action_feedback` on `[[activityId]]`; assert the activity is
      marked done (archived/removed per `_action_done`) AND a `mail.message` is posted on the
      lead.
    - _Requirements: 5.4, 10.3; Property 1, Property 7_
  - [x] 12.3 Write the queued offline `web_save` create replay Python test
    - Apply the queued offline `web_save` create for a lead through the ORM; assert it yields a
      server lead carrying the entered values (the G-3a-1 Python half, distinct from the
      existing edit-sync test). Do NOT re-add or modify existing test methods.
    - _Requirements: 1.2, 1.3; Property 7_

- [x] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. SPEC-PLAN NOTE (documentation / propose only — NOT a code change)
  - Propose the `spec-plan.md` note for spec 07/08 (the row-9 explanation UI: the mobile lead
    card shows the framework `OfflineActionHelper` for an uncached lead, asserted by spec 08's
    pipeline test) at Step 8 of the workflow. Do NOT edit `spec-plan.md` now; this is a
    proposal to the user, not a code change.
  - _Requirements: 2.5_

- [x] 15. Staging discipline — re-stage `.kiro` spec artifacts
  - Re-stage every `.kiro` spec artifact with `git add -f` (Odoo's gitignore ignores
    dot-dirs), both after task execution and again immediately before committing. Pair
    `git diff` with `git status --short` to catch new/untracked files.
  - _Requirements: 15.2_

- [x] 16. Final verification — run `check.sh full` and report verbatim
  - Run `.kiro/scripts/check.sh full` (do NOT retype the commands) and report its output
    verbatim.
  - Phrase the verification EXACTLY this way: `check.sh quick` and `check.sh full` are run;
    all five test commands and all scope checks pass; acceptance row 5 (crm manifest version
    bumped one minor increment) is EXPECTED to fail until spec 08 (the version stays `1.9`
    here), reported as an explicit expected deviation, not a regression; and Row 9's literal
    wording ("shows the offline action helper") is NOT claimed met (decision R1, carried
    forward to specs 07/08). NEVER write "check.sh full passes" or "all acceptance rows pass".
  - If the script fails for an environment reason (a path, the database), say so rather than
    working around it.
  - 3c real-widget limit (state in the PR description): 3c is verify-and-prove — NO CRM code
    implements it; the framework forbids creating a contact from the partner field offline
    (action suggestions built online-only, `relational_utils.js:450`; `quickCreate` reachable
    only from one of those, `:515`; Enter/Tab commits nothing, `autocomplete.js:399-402`). The
    3c unit test (task 2.1) proves this with the GENERIC many2one widget, because the real
    `res_partner_many2one` widget is backend-only and absent from the crm unit-test bundle
    (`partner_autocomplete/__manifest__.py`); the real `res_partner_many2one` widget (and
    `partner_autocomplete`'s own company-autocomplete suggestions) is confirmed by the Step-10
    manual check (open a lead OFFLINE in the real client and confirm the contact field offers
    no create / create-edit / search-more affordance and Enter/Tab commits nothing). The 3c
    unit dropdown/lookup assertions are DESKTOP-ONLY (on a small screen the many2one renders
    through `web.KanbanMany2One`, which needs a `res.partner` `card` template the unit mock
    lacks, so the mobile autocomplete errors with "Missing 'card' template"); the mobile
    partner-create-offline behaviour is confirmed by the Step-10 manual check. The PR
    description MUST state this generic-vs-real-widget limit of the unit test, and that no CRM
    code implements 3c (framework-enforced).
  - _Requirements: 13.6, 15.4, 15.5_

## Notes

- No task is marked optional (`*`): there is no property-testing facility in this repo, so all
  tests are deterministic example/edge-case tests and all are implemented.
- Every new wired path has a paired desktop/mobile JS test AND a removal check (delete the
  production wiring, confirm the test fails, restore) — the removal checks live in tasks
  4.4 (schedule wiring), 4.6 (attribute removal), 4.9 (activity-type prefetch), 6.3
  (mark-done wiring), 8.5 (queue subscription / rebuild-on-mount), 8.7 (optimistic-row rebuild),
  8.10 (systray classification wrapper), and the pre-commit review-fix tests (FIX2 double
  mark-done guard, FIX3 discard-restores-marker, FIX4 park-in-place refresh, FIX5 named systray
  rows, FIX6 local-date state), per the spec-05 lesson. 3c (task 2.1) is verify-and-prove with NO CRM
  wiring, so it has NO removal check (same posture as the row-9 tests); its dropdown/lookup
  assertions are desktop-only, because on a small screen the many2one renders through
  `web.KanbanMany2One`, which needs a `res.partner` `card` template the unit mock lacks (the
  mobile 3c behaviour is covered by the Step-10 manual check).
- The activity-type prefetch (task 4.8, Requirement 16 / Property 11) primes the EXISTING
  framework many2x cache online-mobile on mount, gated on "has not run this session" via a
  `WeakSet` keyed by the `OfflinePlugin` instance (not a module-level flag), issuing an
  unlimited `searchRead` so the cache ends up with the full list even if it already held some
  types. Schedule tests (task 4.4) still prime the cache THROUGH this real prefetch path
  (mount online, then go offline) rather than hand-writing the cache. Task 4.5 deliberately
  simulates the prefetch returning empty.
- Tests are written against the PRODUCTION wiring: no `force: true` registration, no hand-set
  flags; connectivity is driven through the framework's `setOffline` helper.
- Each task references the requirement ids it implements and, where relevant, the design
  Property it exercises.
- Checkpoints (tasks 3, 5, 7, 9, 13) and the early quick run (task 11) give incremental
  validation; the final `check.sh full` (task 16) is the PR gate.
- The manifest `version` stays `1.9`; the bump belongs to spec 08 and is out of scope here.

## Task Dependency Graph

Tasks within a wave are independent and never write the same file. `crm_form.js` tasks
(4.8, 4.2, 6.2, 8.1, 8.2, 8.3), `activity_menu_patch.js` tasks (4.1, 6.1, 8.10),
`crm_form.scss` tasks (4.3, 8.4), the `crm_offline.test.js` tasks (2.1, 4.4, 4.5, 4.6, 4.7,
4.9, 6.3, 6.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10 (SYS classification + removal check), the
pre-commit review-fix tests FIX2–FIX6, 10.1, 10.2, 10.3), and the `test_crm_offline.py`
tasks (12.1, 12.2, 12.3) are each serialized into separate waves to avoid same-file write
conflicts. 3c (task 2.1, `crm_offline.test.js`) is verify-and-prove with NO production
dependency, so it runs first, alone in wave 0. The prefetch implementation (4.8,
`crm_form.js`) runs in wave 1 — before the schedule tests (4.4, 4.5) that depend on the
primed cache — and its test (4.9, `crm_offline.test.js`) runs after it, alone in wave 2
(every other wave already holds one `crm_offline.test.js` task).

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["4.1", "4.3", "4.8"] },
    { "id": 2, "tasks": ["4.9"] },
    { "id": 3, "tasks": ["4.2"] },
    { "id": 4, "tasks": ["4.4", "6.1"] },
    { "id": 5, "tasks": ["4.5", "6.2", "8.4"] },
    { "id": 6, "tasks": ["4.6", "8.1"] },
    { "id": 7, "tasks": ["4.7", "8.2"] },
    { "id": 8, "tasks": ["6.3", "8.3"] },
    { "id": 9, "tasks": ["6.4"] },
    { "id": 10, "tasks": ["8.5"] },
    { "id": 11, "tasks": ["8.6"] },
    { "id": 12, "tasks": ["8.7"] },
    { "id": 13, "tasks": ["8.8"] },
    { "id": 14, "tasks": ["8.9"] },
    { "id": 15, "tasks": ["8.10"] },
    { "id": 16, "tasks": ["10.1"] },
    { "id": 17, "tasks": ["10.2"] },
    { "id": 18, "tasks": ["10.3"] },
    { "id": 19, "tasks": ["12.1"] },
    { "id": 20, "tasks": ["12.2"] },
    { "id": 21, "tasks": ["12.3"] }
  ]
}
```
