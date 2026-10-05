# Bugfix Requirements Document

## Introduction

Spec 04 fixes three correctness defects in the CRM lead form-save and kanban-move paths
when the salesperson is offline, and proves the existing framework queue semantics are
unchanged. All three defects stem from CRM-owned code issuing a server call that has no
offline queue fallback, or from a server-only control being unreachable offline.

The CRM form record override (`CrmFormRecord._save` in
`addons/crm/static/src/views/crm_form/crm_form.js`) and the CRM kanban group list
(`CrmKanbanDynamicGroupList.moveRecords` in
`addons/crm/static/src/views/crm_kanban/crm_kanban_model.js`) both call
`checkRainbowmanMessage(...)` after a stage change. That helper
(`addons/crm/static/src/views/check_rainbowman_message.js`) issues a plain
`orm.call("crm.lead", "get_rainbowman_message", [[recordId]])`. Offline, the framework
queues the save/move, but this follow-up `orm.call` is not a queued fallback, so it
raises a connection-lost error — **Bug 1**.

The same `_save` override already force-copies `email_from`/`phone` into `this._changes`
before `super._save(...)` when the partner-sync flags are set. The framework carries
`this._changes` into the queued offline `web_save` automatically, so the queued offline
write should carry `email_from`/`phone` exactly as the online write does. The fix for
Bug 1 must not move or gate that copy — **Bug 2** is to preserve and prove this.

The "Won" button (`addons/crm/views/crm_lead_views.xml`) calls the server-only
`action_set_won_rainbowman` and carries no `data-available-offline` attribute, so the
framework disables it offline; even if clicked, a `type="object"` call has no queue
fallback and fails — **Bug 3**. Offline, marking a lead won must queue exactly one
`action_set_won` call (never the rainbowman variant), show the lead as won
optimistically, and replay on reconnect.

Scope note: this spec covers PART 2 items 1–2, the PART 3a mark-won-without-rainbowman
clause, and acceptance row 8 (queue semantics unchanged). PART 2 items 3–8 belong to
spec 05 and are out of scope here. The manifest version bump belongs to spec 08 and is
not performed here; acceptance row 5 (version bump) is therefore expected to fail until
spec 08.

Offline state in model/record/controller code is read the way framework model code reads
it: `this.model.offlinePlugin.isOffline()` (`OfflinePlugin`, consumed by
`RelationalModel` at `relational_model.js:130` as
`offlinePlugin = usePlugin(OfflinePlugin)`). The `useCrmOffline()` hook from spec 02
CANNOT be used here because this is model/record/controller code, not an OWL component.

## Bug Analysis

### Current Behavior (Defect)

Rainbowman lookup offline (Bug 1):

1.1 WHEN the connection is offline AND the user saves a lead form with a changed
`stage_id` THEN the system queues the save and then issues
`orm.call("crm.lead", "get_rainbowman_message", [[recordId]])` via
`checkRainbowmanMessage`, which raises a connection-lost error.

1.2 WHEN the connection is offline AND the user moves a lead across stages in a kanban
grouped by `stage_id` THEN the system queues the move and then issues
`orm.call("crm.lead", "get_rainbowman_message", ...)` via `checkRainbowmanMessage`,
which raises a connection-lost error.

Email/phone propagation into the queued offline write (Bug 2):

1.3 WHEN the connection is offline AND a lead is saved with the partner-sync flags
(`partner_email_update` / `partner_phone_update`) set THEN the forced copy of
`email_from`/`phone` into the queued offline `web_save` is at risk of being skipped or
re-ordered by a naive Bug 1 fix that gates or moves work on the offline path, so the
queued write could omit `email_from`/`phone` that the online write would carry.

Mark-won offline (Bug 3):

1.4 WHEN the connection is offline THEN the "Won" button carries no
`data-available-offline` attribute, so the framework's `SELECTORS_TO_DISABLE` pass
disables it (adds `disabled` + `o_disabled_offline`), making it unclickable.

1.5 WHEN the connection is offline AND the "Won" button is clicked THEN the system
attempts the server-only `action_set_won_rainbowman` call, which has no queue fallback
and fails with a connection-lost error; the lead is not shown as won.

### Expected Behavior (Correct)

Rainbowman lookup offline (Bug 1):

2.1 WHEN the connection is offline AND the user saves a lead form with a changed
`stage_id` THEN the system SHALL skip the rainbowman lookup entirely — never issue it,
never queue it, raise no error — and complete the queued save; offline state SHALL be
read via `this.model.offlinePlugin.isOffline()`.

2.2 WHEN the connection is offline AND the user moves a lead across stages in a kanban
grouped by `stage_id` THEN the system SHALL skip the rainbowman lookup entirely — never
issue it, never queue it, raise no error — and complete the queued move; offline state
SHALL be read via `this.model.offlinePlugin.isOffline()`.

Email/phone propagation into the queued offline write (Bug 2):

2.3 WHEN the connection is offline AND a lead is saved with the partner-sync flags set
THEN the system SHALL force-copy `email_from`/`phone` into `this._changes` on the SAME
code path for both online and offline (before `super._save(...)`, regardless of
connectivity), so the queued offline `web_save` carries `email_from` and `phone` exactly
as the online write does; the Bug 1 fix SHALL NOT move or gate this copy.

Mark-won offline (Bug 3):

2.4 WHEN rendering the lead form THEN the "Won" button SHALL carry
`data-available-offline` so the framework pass leaves it clickable offline.

2.5 WHEN the connection is offline AND the "Won" button is clicked THEN the system SHALL
call no server method directly. FIRST, BEFORE saving, IF the record has no server id
(`record.isNew` — a brand-new opportunity, OR a lead created offline and not yet synced)
THEN the system SHALL block the click with a warning notification ("Sync this opportunity
before marking it won"), SHALL NOT save, SHALL NOT queue anything (not even the offline
`web_save` create a save would enqueue), SHALL NOT set the optimistic won display, and SHALL
return `false`. Rationale: the queue replays calls verbatim with no id remapping, so
`action_set_won`'s id would have to come from another queued call (the offline create),
which is forbidden; the control cannot be statically disabled per-record offline-only
without changing online behavior, since the framework's `SELECTORS_TO_DISABLE` pass keys on
the presence of the static `data-available-offline` attribute, not a dynamic expression.
OTHERWISE (the record HAS a server id) the system SHALL `await record.save()` so any pending
offline edit is queued as a `web_save` BEFORE the won call, mirroring the base controller
which captures `saved = await record.save()` and only proceeds `if (saved !== false)`: IF
the save returns `false` (e.g. an invalid or empty required field makes the save fail) THEN
the system SHALL NOT queue `action_set_won`, SHALL NOT set the optimistic won display, and
SHALL return `false` so the button does not proceed (matching the online behavior where an
invalid-field save is rejected and the button does nothing). ONLY WHEN the save succeeds
(`saved !== false`) does the system queue exactly ONE additional call —
`scheduleORM("crm.lead", "action_set_won", [[record.resId]], {context}, {extras})` — and set
the optimistic won display, and in that case it SHALL queue NO rainbowman call
(`get_rainbowman_message` / `action_set_won_rainbowman` MUST NOT be queued or issued). The
resulting offline queue order (`web_save` then `action_set_won`, in `extras.timeStamp` order)
SHALL match the online flow (base controller saves the record, then the button executes),
which relates to the queue-ordering invariant in 3.8. When there is no pending edit,
`record.save()` returns early (a non-`false` result) and queues nothing, so only the
`action_set_won` entry is present.

2.6 WHEN the connection is offline AND the "Won" button is clicked on a record WITH a server
id THEN the system SHALL show the lead as won optimistically by setting `probability = 100`
and `won_status = 'won'` for display via the framework's `record._applyValues({ probability:
100, won_status: 'won' })` followed by `this.model.notify()` — which folds the values into
the committed baseline (`_values`), the reactive `data`, `_textValues`, `_initialTextValues`,
and the eval context together, leaving `_changes` untouched so the record stays non-dirty —
NOT via `record.update()` (which would populate `_changes` and dirty the record); it SHALL
NOT set `stage_id` offline (the server resolves the won stage via `_stage_find`).

2.7 WHEN the connection is offline AND the lead has been marked won AND the user then
saves or leaves the form THEN the system SHALL NOT queue any additional `web_save`
carrying `probability` or `won_status` (the optimistic values are display-only and MUST
NOT make the record dirty).

2.8 WHEN the connection returns AND the queued `action_set_won` call replays THEN the
server SHALL set the won stage and `probability = 100`, and the lead SHALL reload with
the server's won stage.

### Unchanged Behavior (Regression Prevention)

Online rainbowman and mark-won paths:

3.1 WHEN the connection is online AND a lead form is saved with a changed `stage_id`
THEN the system SHALL CONTINUE TO issue the rainbowman lookup
(`get_rainbowman_message`) via `checkRainbowmanMessage`.

3.2 WHEN the connection is online AND a lead is moved across stages in a kanban grouped
by `stage_id` THEN the system SHALL CONTINUE TO issue the rainbowman lookup via
`checkRainbowmanMessage`.

3.3 WHEN the connection is online AND the "Won" button is clicked THEN the system SHALL
CONTINUE TO call `action_set_won_rainbowman` and display the rainbowman effect.

3.4 WHEN the connection is online AND a lead is saved with the partner-sync flags set
THEN the system SHALL CONTINUE TO force-copy `email_from`/`phone` into the write so the
partner inverse methods run.

3.5 WHEN a lead is saved with `resModel !== "crm.lead"` or without a `stage_id` change
THEN the system SHALL CONTINUE TO behave exactly as before (no rainbowman lookup).

Desktop and framework invariants:

3.6 WHEN the CRM is used on desktop THEN the system SHALL CONTINUE TO behave exactly as
before this fix (new behavior is only the offline gating and the offline Won path; the
desktop online experience is unchanged).

3.7 WHEN offline writes are replayed THEN the system SHALL CONTINUE TO use the existing
web offline framework queue unchanged: no new sync queue, no conflict detection, no
`write_date` comparison, no field merge, no conflict dialog, no CRM-specific error UI.

Queue semantics unchanged (acceptance row 8):

3.8 WHEN two offline writes are made to one lead THEN the system SHALL CONTINUE TO replay
them in `extras.timeStamp` order against the server, last write wins, with no conflict
dialog.

3.9 WHEN a replayed call is rejected by the server THEN the system SHALL CONTINUE TO park
the entry in the existing web offline systray with its error (`extras.error`) for manual
retry, and SHALL NOT show any CRM-specific error UI.

Existing tests that MUST keep passing:

3.10 WHEN the JS unit suite runs under both the desktop and mobile presets THEN the
existing `addons/crm/static/tests/crm_offline.test.js` hook tests
(`isOffline` / `isSmall` / `isAvailableOffline` / `hasQueuedWrite` / `scheduleORM`) SHALL
CONTINUE TO pass.

3.11 WHEN the Python test suite runs THEN the existing `TestCrmOffline` tests
(`test_shortcuts_extend_parent`, `test_manifest_http_salesman`) in
`addons/crm/tests/test_crm_offline.py` SHALL CONTINUE TO pass.

## Bug Condition and Properties

**Key definitions:**
- **F**: the CRM form/kanban/mark-won code before this fix.
- **F'**: the CRM form/kanban/mark-won code after this fix.

### Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type { connectivity, action, stageChanged, partnerSyncFlags }
  OUTPUT: boolean

  // Rainbowman offline (Bug 1): offline save/move with a stage change
  // Mark-won offline (Bug 3): offline Won-button click
  RETURN X.connectivity = OFFLINE
     AND (
          (X.action = FORM_SAVE   AND X.stageChanged = TRUE)
       OR (X.action = KANBAN_MOVE AND X.stageChanged = TRUE)
       OR (X.action = MARK_WON)
     )
END FUNCTION
```

### Property — Fix Checking

```pascal
// Offline stage change: no rainbowman lookup, write still queued, no error
FOR ALL X WHERE isBugCondition(X) AND X.action IN {FORM_SAVE, KANBAN_MOVE} DO
  result ← F'(X)
  ASSERT no_rainbowman_call(result)
     AND write_is_queued(result)
     AND no_error(result)
END FOR

// Offline mark-won: first `saved ← record.save()`, mirroring the base
// controller's `saved !== false` guard. If the save fails (saved = false,
// e.g. an invalid required field) nothing is queued for the won action, no
// optimistic won is set, and the method returns false (button does not
// proceed). Only on a successful save is a preceding web_save queued iff
// there was a pending edit, then exactly one action_set_won, no rainbowman,
// optimistic won shown, and no extra web_save carrying probability/won_status.
// If the record has no server id (record.isNew — a new or offline-created
// lead), checked BEFORE save, the won action cannot be queued (its id would
// come from another queued call); the click is blocked with a warning notification
// and nothing is queued.
FOR ALL X WHERE isBugCondition(X) AND X.action = MARK_WON DO
  result ← F'(X)
  IF record_before.isNew THEN
    // No server id (checked BEFORE save): cannot queue (no id remapping). Blocked
    // with a notification; NOTHING is queued (not even the offline create a save
    // would enqueue), nothing saved.
    ASSERT queued_calls_added(result) = []   // the whole queue is unchanged
       AND no_rainbowman_call(result)
       AND result.record.won_status != 'won'
       AND warning_notification_shown(result)
       AND result.returnValue = FALSE
  ELSE IF result.saved = FALSE THEN
    // Record HAS an id but the save failed (e.g. invalid required field): button
    // does not proceed.
    ASSERT count(queued_calls(result), ("crm.lead","action_set_won",[[resId]])) = 0
       AND no_rainbowman_call(result)
       AND result.record.won_status != 'won'
       AND result.returnValue = FALSE
  ELSE
    ASSERT count(queued_calls(result), ("crm.lead","action_set_won",[[resId]])) = 1
       AND (X.hasPendingEdit
              ? queued_calls(result) = [ web_save_for(resId), ("crm.lead","action_set_won",[[resId]]) ]
                  AND timeStamp(web_save_for(resId)) < timeStamp(action_set_won_for(resId))
              : queued_calls(result) = [ ("crm.lead","action_set_won",[[resId]]) ])
       AND no_rainbowman_call(result)
       AND result.record.probability = 100
       AND result.record.won_status = 'won'
       AND NOT record_dirty(result.record)
  END IF
END FOR
```

### Property — Email/Phone Propagation (Bug 2)

```pascal
// For an offline save needing partner sync, the queued web_save carries
// email_from and phone just as the online write would.
FOR ALL X WHERE X.connectivity = OFFLINE AND X.partnerSyncFlags = TRUE DO
  queued ← F'(X).queued_web_save
  ASSERT queued.values.email_from = X.record.email_from
     AND queued.values.phone      = X.record.phone
END FOR
```

### Property — Preservation Checking

```pascal
// For every non-buggy input (notably all online paths, non-crm.lead saves,
// and saves without a stage change) the fixed code behaves identically.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

## Acceptance Criteria (test obligations)

JavaScript — appended to `addons/crm/static/tests/crm_offline.test.js`, passing under
BOTH the desktop and mobile presets:

- AC-J1: Online, a stage change on form save DOES issue the rainbowman lookup
  (`get_rainbowman_message`). (3.1)
- AC-J2: Offline, a stage change on form save does NOT issue the rainbowman lookup and
  does not error; the write is queued. (2.1)
- AC-J3: Offline kanban `moveRecords` across stage does NOT issue the rainbowman lookup
  and does not error; the move is queued. (2.2)
- AC-J4: The queued offline `web_save` carries `email_from` and `phone`. (2.3)
- AC-J5: The "Won" button is clickable offline (not disabled by the framework pass). (2.4)
- AC-J6: Clicking "Won" offline queues exactly one `action_set_won` entry for that lead
  and NO `get_rainbowman_message` / `action_set_won_rainbowman` call; the record shows won
  (`probability` 100 and `won_status` 'won'); the rendered DOM reflects won — the Won
  button is now HIDDEN (its `invisible="won_status == 'won' ..."` modifier hides it once
  `won_status` is 'won') and the won state is displayed (the `web_ribbon` "Won" ribbon,
  with `invisible="won_status != 'won'"`, becomes visible), proving the optimistic update
  reaches the view and not just the record object; saving or leaving the form afterwards
  adds no `web_save` carrying `probability` or `won_status` and the record is not dirty.
  (2.5, 2.6, 2.7)
- AC-J7: Online, clicking "Won" still calls `action_set_won_rainbowman`. (3.3)
- AC-J8: Two offline `web_save` writes to ONE lead with ascending `extras.timeStamp`
  (e.g. timeStamp 1 then 2) drive a REAL replay through the framework: going back online
  (`setOffline(false)`) triggers `_syncORM()`, which replays each entry via
  `orm.silent.call(...)` with a ~1s gap (advance timers with `runAllTimers()`). Assert via
  the mock server (`onRpc`) that the two `web_save` calls ARRIVE in `extras.timeStamp`
  order (the earlier-timeStamp write first, then the later), and that the SECOND write's
  value is the one that ends up on the record (last write wins) — asserting on what the
  mock server received and the resulting record value, not just the queued entries. No
  conflict dialog appears; the framework queue is unchanged. This test genuinely needs
  RPCs to resolve, so it uses the realistic harness the existing
  `addons/web/static/tests/webclient/offline_systray.test.js` uses — `mockOffline()` +
  mount `WebClient` + `onRpc` + `runAllTimers()` + read the systray DOM — rather than the
  signal-only `setOffline` used by the hook tests. (3.8)
- AC-J9: A queued offline write whose replay the mock server REJECTS (an `onRpc` handler
  returning a non-`ConnectionLost` error / `RPCError` when the replay fires) drives a REAL
  replay: go back online (`setOffline(false)`), let `_syncORM()` run (advance timers with
  `runAllTimers()`); the non-`ConnectionLost` error re-schedules the entry with
  `extras.error` (parked, still in `_ormToSync` with `extras.error` set). Assert the entry
  is shown in the existing offline systray as an error (the `[data-icon='error']` /
  `.text-danger` entry, per the existing systray test). Assert the parked entry carries the
  SERVER's error, not merely some error: its `extras.error` INCLUDES "Server rejected the
  write", and the systray error element's `data-tooltip` (bound to `element.error ??
  element.displayName` in `offline_systray.xml`) INCLUDES it. With the systray dropdown open
  at that point, assert the parked entry is surfaced ONLY through the framework systray and
  no CRM-specific error dialog or toast was raised: no `.modal` and no danger notification
  (`.o_notification_bar.bg-danger`) appear — `expect('.modal').toHaveCount(0)` and
  `expect('.o_notification_bar.bg-danger').toHaveCount(0)`. These are the real framework
  DOM selectors: a danger toast renders `o_notification_bar bg-danger`
  (`web/static/src/core/notifications/notification.xml`) and a dialog renders `.modal`.
  (A bespoke CRM class such as `.o_crm_offline_error` is NOT asserted, because no such
  class exists anywhere and asserting its absence would prove nothing.) Uses the same
  realistic harness as AC-J8 (`mockOffline()` + `WebClient` mount + `onRpc` +
  `runAllTimers()` + systray DOM assertions, reusing the existing systray test's DOM
  assertions as the model); the framework queue is unchanged. (3.9)
- AC-J10: Offline, editing a field and then clicking "Won" queues the two entries in order
  `web_save` (carrying the edit) THEN `action_set_won` for that lead (the `await
  record.save()` runs before the won call so the offline queue order matches the online
  flow). (2.5; ordering relates to Row 8 / Req 3.8)
- AC-J11: Offline, mount `crm_form` with an invalid/empty required field (clear a field
  that is required on the `crm.lead` form so `record.save()` returns `false`), then click
  "Won"; assert NOTHING is queued for the lead (no `action_set_won`, no `web_save`) and the
  lead is NOT shown as won (`won_status` is not 'won', the Won button is still visible).
  This proves the offline Won branch mirrors the base controller's `saved !== false` guard,
  so an invalid-field save offline matches online (the save is rejected and the button does
  nothing). The test clears the required `name` field to force `record.save() === false`.
  (2.5)
- AC-J12: Offline, mount `crm_form` as a NEW opportunity (no `resId`, so `record.isNew` is
  true), set a valid `name`, and click "Won"; assert the WHOLE offline queue is empty after
  the click (`_ormToSync()` has no entries — not just no `action_set_won`, but also no
  `web_save` create, because the `record.isNew` guard runs BEFORE `record.save()`), the lead
  is NOT shown as won (`won_status` is not 'won', the Won button is still visible), and a
  warning notification ("Sync this opportunity before marking it won") appears. This proves
  the `record.isNew` guard: a record whose id would come from another queued call is never
  queued, and the guard preflights the save so no create is queued either. (2.5)
- AC-J12b: Offline, mount `crm_form` as a new opportunity and SAVE it offline first (queuing
  exactly one `web_save` create with `args[0] === []`; the record keeps no server id, so
  `record.isNew` stays true), then click "Won"; assert the existing create entry is unchanged
  and NO entry is added (same queue size, no `action_set_won`), the lead is NOT shown as won,
  and the warning notification appears. This proves the guard applies equally once the record
  exists only as a queued offline create. (2.5)

Python — appended to class `TestCrmOffline` in `addons/crm/tests/test_crm_offline.py`:

- AC-P1: Applying the exact queued `web_save` call for an offline edit yields the same
  lead+partner state (`email_from`/`phone` propagation) as the online write path. The
  Python test builds and applies a `web_save` with EXACTLY the arguments the JS test
  (AC-J4) asserts are queued, so the JS "what is queued" and the Python "what the server
  does with it" assertions are tied to the same call shape. (2.3)
- AC-P2: Applying the queued `action_set_won` call leaves the lead won (`won_status`
  'won', in a won stage, `probability` 100). (2.8)

No optional property-based test tasks are generated for this spec.

## Non-Functional Requirements and Constraints

- NFR-1: Only the files these bugs need may change. Expected edits:
  `addons/crm/static/src/views/crm_form/crm_form.js` (offline-gate the rainbowman call
  plus a CRM form controller override hosting the mark-won offline interception),
  `addons/crm/static/src/views/crm_kanban/crm_kanban_model.js` (offline-gate the
  rainbowman call), and `addons/crm/views/crm_lead_views.xml` (add
  `data-available-offline` to the "Won" button). Tests are appended to
  `addons/crm/static/tests/crm_offline.test.js` and
  `addons/crm/tests/test_crm_offline.py`. No new source files are created for this spec.
- NFR-2: No new offline machinery, no new dependency, no manifest version bump, no
  access/security changes. Offline state is read via the model's `offlinePlugin`.
- NFR-3: Desktop behavior is unchanged; new behavior is only offline gating and the
  offline Won path.
- NFR-4: The existing framework queue is reused unchanged (timestamp-ordered replay,
  last-write-wins, parked-on-rejection in the existing systray).
- NFR-5: Verification runs `check.sh quick` and `check.sh full`; all five test commands
  and all scope checks pass; acceptance row 5 (crm manifest version bumped one minor
  increment) is EXPECTED to fail until spec 08.
