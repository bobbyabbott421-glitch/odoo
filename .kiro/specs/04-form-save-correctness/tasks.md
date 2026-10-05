# Implementation Plan

This plan fixes three offline correctness defects on the CRM lead form-save, kanban-move,
and mark-won paths, and proves the framework queue semantics are unchanged. It follows the
exploratory bugfix workflow: write bug-condition and preservation tests first (observed on
UNFIXED code), then apply the fix, then re-run the same tests to confirm the fix and
absence of regressions.

Allowed files (the only files any task may touch — no new files, no manifest bump, nothing
outside `addons/crm/`):
- `addons/crm/static/src/views/crm_form/crm_form.js`
- `addons/crm/static/src/views/crm_kanban/crm_kanban_model.js`
- `addons/crm/views/crm_lead_views.xml`
- `addons/crm/static/tests/crm_offline.test.js` (append only)
- `addons/crm/tests/test_crm_offline.py` (append to class `TestCrmOffline` only)

Testing conventions (from design.md "Testing Strategy"), applied to every JS test task:
`defineMailModels()` is called so a view mount can resolve mail models (`discuss.channel`);
connectivity is driven by `OfflinePlugin.setOffline(...)` directly (NOT `mockOffline()`,
unless a test genuinely needs RPCs to fail); the queue is read through
`OfflinePlugin._ormToSync()`; view-mount tests use `web_test_helpers`
(`mountView` / `makeMockServer` / `defineModels`) to mount a real `crm_form` / `crm_kanban`
view with `onRpc` spies on `get_rainbowman_message` / `action_set_won` /
`action_set_won_rainbowman`; every JS test is paired `test.tags("desktop")` /
`test.tags("mobile")` so it passes under BOTH presets; new JS paths reach ≥80% statement
coverage; never use `only()` or `debug()`.

- [x] 1. Observe the bug-condition counterexamples on unfixed code (development step; no standalone exploration tests kept)
  - **Property 1: Bug Condition** - Offline writes hit the un-queueable rainbowman lookup and the server-only mark-won
  - **GOAL**: During development, surface concrete counterexamples demonstrating each bug by exercising the UNFIXED code, to confirm the root causes before implementing the fix
  - **Scoped approach (deterministic bugs)**: exercise each concrete failing case named below rather than generating random inputs
  - **IMPORTANT**: No separate "Bug1/Bug3 exploration" tests remain in the committed `crm_offline.test.js`. The three bug-condition counterexamples below were observed on unfixed code during development, and their assertions live on permanently as the AC tests written in task 5 — the exploration pairs would have duplicated those AC tests one-for-one, so they are NOT kept as separate tests:
    - Bug 1 (form): offline form stage-change skips rainbowman + queues the write → covered by **AC-J2** (task 5)
    - Bug 1 (kanban): offline kanban move skips rainbowman + queues the move → covered by **AC-J3** (task 5)
    - Bug 3: the "Won" button is clickable offline → covered by **AC-J5** (task 5)
  - Development observations (run against UNFIXED code, not committed as standalone tests):
    - Bug 1 (form): mount `crm_form`, set offline, change `stage_id`, save; on UNFIXED code `get_rainbowman_message` fires and/or a connection-lost error surfaces (counterexample for 2.1 / isBugCondition FORM_SAVE)
    - Bug 1 (kanban): mount `crm_kanban` grouped by `stage_id` (or exercise `CrmKanbanDynamicGroupList.moveRecords`), set offline, move a card across stage; on UNFIXED code `get_rainbowman_message` fires / errors (counterexample for 2.2 / isBugCondition KANBAN_MOVE)
    - Bug 3: mount `crm_form`, set offline; on UNFIXED code the "Won" button is disabled (`disabled` / `o_disabled_offline`) and, if reached, `action_set_won_rainbowman` fires with no fallback (counterexample for 2.4 / 2.5 / isBugCondition MARK_WON)
  - **EXPECTED OBSERVATION**: these counterexamples fail on UNFIXED code (this is correct — it proves the bugs exist)
  - Document the counterexamples found (e.g. "offline form save calls `get_rainbowman_message`", "Won button carries `o_disabled_offline` offline")
  - Mark complete when the counterexamples are observed and documented; the permanent assertions are added as AC-J2/AC-J3/AC-J5 in task 5, not as separate exploration tests
  - _Design: Bug Condition `isBugCondition`; Change 1, Change 2, Change 4, Change 5_
  - _Requirements: 2.1, 2.2, 2.4, 2.5; AC-J2, AC-J3, AC-J5, AC-J6_

- [x] 2. Write preservation property tests (BEFORE implementing the fix)
  - **Property 2: Preservation** - Online paths, email/phone propagation, and non-buggy saves unchanged
  - **IMPORTANT**: Follow the observation-first methodology — observe behavior on UNFIXED code, then pin it
  - Append to `addons/crm/static/tests/crm_offline.test.js`, each paired `test.tags("desktop")` + `test.tags("mobile")`; `defineMailModels()`; real view mounts with `onRpc` spies; queue read via `_ormToSync()`
  - Observe + pin (online, non-buggy): online stage-change form save STILL calls `get_rainbowman_message` (AC-J1 / Req 3.1); online "Won" click STILL calls `action_set_won_rainbowman` (AC-J7 / Req 3.3)
  - Observe + pin (email/phone propagation, Bug 2): offline save with the partner-sync flags set — inspect the queued `web_save` entry and assert its values carry `email_from` and `phone` exactly as the online write would (AC-J4 / Req 2.3). On UNFIXED code the copy already runs before `super._save`, so this PASSES now and must keep passing
  - Observe + pin (framework invariants): the existing spec-02 hook tests (`isOffline` / `isSmall` / `isAvailableOffline` / `hasQueuedWrite` / `scheduleORM`) remain in place and passing (Req 3.10)
  - Run these tests on UNFIXED code
  - **EXPECTED OUTCOME**: tests PASS (this confirms the baseline behavior to preserve)
  - Mark complete when the tests are written, run, and passing on unfixed code
  - _Design: Preservation Requirements; Property 3; Change 3 (Bug 2, no code change)_
  - _Requirements: 2.3, 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10; AC-J1, AC-J4, AC-J7_

- [x] 3. Fix Bug 1 — offline-gate the rainbowman lookup (form and kanban)

  - [x] 3.1 Gate the rainbowman call in `crm_form.js` (`CrmFormRecord._save`)
    - In `addons/crm/static/src/views/crm_form/crm_form.js`, keep the force-copy of `email_from`/`phone` into `this._changes` BEFORE `super._save(...)` exactly as today — ungated, on both connectivities (this is the Bug 2 fix; do NOT move or gate it)
    - After `const res = await super._save(...)`, change the existing `if (res && changeStage)` to additionally require online: `if (res && changeStage && !this.model.offlinePlugin.isOffline())` before calling `checkRainbowmanMessage(this.model.orm, this.model.effect, this.resId)`
    - Read offline state via `this.model.offlinePlugin.isOffline()` (do NOT use `useCrmOffline()` — this is record code, not an OWL component). Do NOT modify `check_rainbowman_message.js`
    - _Bug_Condition: isBugCondition(X) where X.connectivity = OFFLINE AND X.action = FORM_SAVE AND X.stageChanged = TRUE_
    - _Expected_Behavior: skip the rainbowman lookup entirely offline; complete the queued save; raise no error (expectedBehavior from design)_
    - _Preservation: online (`!isOffline()`) the condition is textually identical to today — Req 3.1, 3.4, 3.5_
    - _Design: Change 1_
    - _Requirements: 2.1, 2.3, 3.1, 3.4, 3.5_

  - [x] 3.2 Gate the rainbowman call in `crm_kanban_model.js` (`moveRecords`)
    - In `addons/crm/static/src/views/crm_kanban/crm_kanban_model.js`, in `CrmKanbanDynamicGroupList.moveRecords`, add the online guard to the existing rainbowman condition after `await super.moveRecords(...)`: `if (targetGroup && movedLeads.length && this.groupByField.name === "stage_id" && !this.model.offlinePlugin.isOffline())` before calling `checkRainbowmanMessage(this.model.orm, this.model.effect, movedLeads[0].resId)`
    - Read offline state via `this.model.offlinePlugin.isOffline()` (`CrmKanbanModel extends RelationalModel`). The framework still queues the move itself; only the follow-up lookup is skipped offline
    - _Bug_Condition: isBugCondition(X) where X.connectivity = OFFLINE AND X.action = KANBAN_MOVE AND X.stageChanged = TRUE_
    - _Expected_Behavior: skip the rainbowman lookup entirely offline; complete the queued move; raise no error (expectedBehavior from design)_
    - _Preservation: online the condition is textually identical to today — Req 3.2_
    - _Design: Change 2_
    - _Requirements: 2.2, 3.2_

- [x] 4. Fix Bug 3 — mark-won offline (XML attribute + form controller)

  - [x] 4.1 Mark the "Won" button offline-available in `crm_lead_views.xml`
    - In `addons/crm/views/crm_lead_views.xml`, add `data-available-offline="1"` to the `action_set_won_rainbowman` "Won" button so the framework's `SELECTORS_TO_DISABLE` pass (`button:not([data-available-offline]):not([disabled])`) excludes it and leaves it clickable offline
    - Only attribute PRESENCE matters to the selector; the value `"1"` is inert and changes no desktop/online behavior
    - _Bug_Condition: isBugCondition(X) where X.connectivity = OFFLINE AND X.action = MARK_WON (disabled-button sub-case)_
    - _Expected_Behavior: the Won button stays clickable offline (2.4)_
    - _Preservation: online the framework does not run the disable pass; the attribute is inert — Req 3.6_
    - _Design: Change 4, Row 8 (no queue change)_
    - _Requirements: 2.4_

  - [x] 4.2 Add `CrmFormController` offline Won path and register it on the `crm_form` entry
    - In `addons/crm/static/src/views/crm_form/crm_form.js`, import `getScheduleORMExtras` from `@web/model/relational_model/utils`
    - Override `setup()` to call `super.setup(...arguments)` and acquire `this.notification = useService("notification")` (import `useService` from `@web/core/utils/hooks`, `_t` from `@web/core/l10n/translation`)
    - Add `class CrmFormController extends formView.Controller` overriding `async beforeExecuteActionButton(clickParams)`: when `this.model.offlinePlugin.isOffline() && clickParams.name === "action_set_won_rainbowman"`, FIRST capture `const saved = await record.save()` (record from `this.model.root`) so any pending offline edit is queued as a `web_save` BEFORE the won call, mirroring the base controller which captures `saved = await record.save(...)` and only proceeds `if (saved !== false)` (confirmed in `form_controller.js`); if `saved === false` (e.g. an invalid or empty required field makes the save fail) `return false` IMMEDIATELY — queue NO `action_set_won`, set NO optimistic won — so an invalid-field save offline matches online (the save is rejected, the button does nothing); THEN if `record.isNew` (no server id — a brand-new opportunity, or one created offline and not yet synced) show `this.notification.add(_t("Sync this opportunity before marking it won."), { type: "warning" })` and `return false` — queue NOTHING, set no optimistic won — because the won call's id would have to come from another queued call (no id remapping); ONLY when the save succeeds AND the record has a server id, THEN queue exactly ONE call `this.model.offlinePlugin.scheduleORM("crm.lead", "action_set_won", [[record.resId]], { context: record.context }, { extras: getScheduleORMExtras(this.model, [record]) })`; queue/issue NO rainbowman variant
    - Set optimistic won WITHOUT dirtying via the framework's own cohesive helper, NOT `record.update()`: `record._applyValues({ probability: 100, won_status: "won" })` then `this.model.notify()` — `_applyValues` folds the values into `_values` (committed baseline), the reactive `data`, `_textValues`, `_initialTextValues` and the eval context together, leaving `_changes` untouched so the record stays non-dirty; do NOT set `stage_id` (the server resolves the won stage via `_stage_find`); then `return false` to halt the normal button execution so `action_set_won_rainbowman` is never issued
    - The method is `async` (it awaits `record.save()`); for every other case (online, or any other button) call and return `super.beforeExecuteActionButton(clickParams)` unchanged, preserving the online save-before-button behavior and the online rainbowman call
    - Register the controller by extending the existing views entry to `{ ...formView, Model: CrmFormModel, Controller: CrmFormController }`
    - _Bug_Condition: isBugCondition(X) where X.connectivity = OFFLINE AND X.action = MARK_WON_
    - _Expected_Behavior: `const saved = await record.save()` first so a pending edit is queued as a `web_save` ahead of the won call (queue order matches online); if `saved === false` (invalid required field) return false, queue nothing, set no optimistic won; else if `record.isNew` (no server id) show a warning notification and return false, queue nothing; else queue exactly one `action_set_won`; no rainbowman call; `probability = 100` and `won_status = 'won'` applied via `record._applyValues(...)` (non-dirty); `stage_id` not set offline (2.5, 2.6, 2.7); replay sets the server won stage (2.8)_
    - _Preservation: online + every non-won button returns `super(...)` unchanged — Req 3.3, 3.6, 3.7_
    - _Design: Change 5, Row 8 (reuses the framework queue unchanged)_
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 3.3_

- [x] 5. Append the JS fix-and-preservation suite (AC-J1..AC-J7, both presets)
  - Append to `addons/crm/static/tests/crm_offline.test.js`. Each test paired `test.tags("desktop")` + `test.tags("mobile")`; `defineMailModels()`; drive offline with `OfflinePlugin.setOffline(...)` directly (not `mockOffline()`); read the queue via `_ormToSync()`; real `crm_form` / `crm_kanban` mounts via `web_test_helpers` with `onRpc` spies; no `only()`/`debug()`
  - AC-J1 (Req 3.1): online, mount `crm_form`, change `stage_id`, save; assert `get_rainbowman_message` IS called
  - AC-J2 (Req 2.1): offline, mount `crm_form`, change `stage_id`, save; assert NO `get_rainbowman_message` RPC and no error; the write is queued (`_ormToSync()` has a `web_save` for the lead)
  - AC-J3 (Req 2.2): offline, `crm_kanban` grouped by `stage_id`, `moveRecords` across stage; assert NO `get_rainbowman_message` and no error; the move is queued
  - AC-J4 (Req 2.3): offline, save a lead with the partner-sync flags set; inspect the queued `web_save` entry and assert its values carry `email_from` and `phone`
  - AC-J5 (Req 2.4): offline, mount `crm_form`; assert the Won button is NOT disabled (no `disabled` / `o_disabled_offline` after the offline pass), proving `data-available-offline` keeps it clickable
  - The spec-04 mock `crm.lead` fixture defines `won_status` as `fields.Selection` with the production options (`[['won','Won'],['lost','Lost'],['pending','Pending']]`) to match production (`crm_lead.py:224`), so selection values resolve from `record.data` as in production
  - AC-J6 (Req 2.5, 2.6, 2.7): offline, click "Won" on a record WITH a server id; assert exactly one queued `action_set_won` entry for that lead via `_ormToSync()` and NO `get_rainbowman_message` / `action_set_won_rainbowman` RPC fired; assert `record.data.probability === 100` and `record.data.won_status === "won"` (applied via `record._applyValues`); additionally assert the rendered DOM reflects won — the Won button is now HIDDEN (its `invisible="won_status == 'won' ..."` modifier hides it once `won_status` is 'won') and the won state is displayed (the `web_ribbon` "Won" ribbon, with `invisible="won_status != 'won'"`, becomes visible), proving the optimistic update reaches the view and not just the record object; assert `record.dirty === false`; then save/leave and assert no additional `web_save` carrying `probability` or `won_status` is queued (record not dirty)
  - AC-J7 (Req 3.3): online, click "Won"; assert `action_set_won_rainbowman` IS called
  - AC-J10 (Req 2.5; ordering relates to Row 8 / Req 3.8): offline, edit a field, then click "Won"; assert the queue holds the two entries in order `web_save` (carrying the edit) THEN `action_set_won` for that lead, proving the `await record.save()` runs before the won call so the offline queue order matches the online flow
  - AC-J11 (Req 2.5): offline, mount `crm_form` with an invalid/empty required field (clear the required `name` field so `record.save()` returns `false`), then click "Won"; assert NOTHING is queued for the lead (no `action_set_won`, no `web_save` via `_ormToSync()`) and the lead is NOT shown as won (`won_status` not 'won', Won button still visible), proving the offline Won branch mirrors the base controller's `saved !== false` guard (invalid-field save offline matches online)
  - AC-J12 (Req 2.5): offline, mount `crm_form` as a NEW opportunity (`resId: false`, so `record.isNew` is true — equivalently a lead created offline and not yet synced), set a valid `name`, then click "Won"; assert NOTHING is queued anywhere (no `action_set_won` / `action_set_won_rainbowman` in the whole queue, since there is no `resId` to key on), the lead is NOT shown as won (`won_status` not 'won', Won button still visible), and a warning notification ("Sync this opportunity before marking it won", `.o_notification`) appears, proving the `record.isNew` guard
  - Ensure the two new gates, the controller's offline+won success branch (including the `const saved = await record.save()` save-first step), its `saved === false` early-return branch, its `record.isNew` notify-and-return branch, and its online/other-button `super` branch are each exercised for ≥80% statement coverage of the new JS
  - _Design: Testing Strategy → Unit Tests; Change 1, Change 2, Change 4, Change 5_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.3; AC-J1, AC-J2, AC-J3, AC-J4, AC-J5, AC-J6, AC-J7, AC-J10, AC-J11, AC-J12_

- [x] 6. Append the Row 8 queue-semantics tests (AC-J8, AC-J9, both presets)
  - Append to `addons/crm/static/tests/crm_offline.test.js`. Each test paired `test.tags("desktop")` + `test.tags("mobile")`; the framework queue is reused UNCHANGED; no `only()`/`debug()`
  - These two tests drive an ACTUAL replay through the framework rather than only inspecting the queued entries, so they genuinely need RPCs to resolve/fail — use the realistic harness the existing `addons/web/static/tests/webclient/offline_systray.test.js` uses: `mockOffline()` + mount `WebClient` + `onRpc` + `runAllTimers()` + read the systray DOM (NOT the signal-only `setOffline` used by the hook tests). Mechanism (confirmed from `offline_plugin.js` and that systray test): going back online (`setOffline(false)`) triggers `_syncORM()`, which filters out entries with `extras.error`, sorts the rest ascending by `extras.timeStamp`, and replays each via `orm.silent.call(model, method, args, kwargs)` with a ~1s gap between entries (advance timers with `runAllTimers()`); a successful entry is removed, a non-`ConnectionLost` error re-schedules the entry with `extras.error` (parked)
  - AC-J8 (Req 3.8): queue two `web_save` writes to the SAME lead while offline with ascending `extras.timeStamp` (e.g. timeStamp 1 then 2), go back online, let the framework replay (advance timers); assert via `onRpc` / the mock server that the two `web_save` calls ARRIVE in `extras.timeStamp` order (the earlier-timeStamp write first, then the later), and that the SECOND write's value is the one that ends up on the record (last write wins) — assert on what the mock server received / the resulting record value, not just the queued entries; NO conflict dialog appears
  - AC-J9 (Req 3.9): queue a write offline, make the mock server REJECT that call (`onRpc` throws `makeServerError({ message: "Server rejected the write" })` when the replay fires), go back online and let the replay run (advance timers); assert the entry is parked carrying the SERVER's error — its `extras.error` INCLUDES "Server rejected the write" (`_syncORM` stores `e.data.name + " - " + e.data.message`), not merely truthy — and is shown in the existing offline systray as an error (the `[data-icon='error']` / `.text-danger` entry, per the existing systray test), with the systray error element's `data-tooltip` INCLUDING "Server rejected the write" (`offline_systray.xml` binds `data-tooltip` to `element.error ?? element.displayName`; read it with `queryAttribute` from `@odoo/hoot-dom`). With the systray dropdown open at that point, assert the parked entry is surfaced ONLY through the framework systray and no CRM error dialog or toast was raised: `expect('.modal').toHaveCount(0)` and `expect('.o_notification_bar.bg-danger').toHaveCount(0)` (the real framework DOM — a danger toast renders `o_notification_bar bg-danger` per `web/static/src/core/notifications/notification.xml`, and a dialog renders `.modal`). Do NOT assert on a bespoke CRM error class such as `.o_crm_offline_error` (no such class exists, so it would prove nothing). Reuse the existing systray test's DOM assertions as the model
  - _Design: Testing Strategy → Unit Tests; Row 8_
  - _Requirements: 3.8, 3.9; AC-J8, AC-J9_

- [x] 7. Verify the bug-condition behavior now passes (via the permanent AC tests)
  - **Property 1: Expected Behavior** - Offline writes skip rainbowman; mark-won queues exactly one `action_set_won`
  - **IMPORTANT**: The bug-condition counterexamples from task 1 are permanently covered by the AC tests in task 5 — re-run those AC tests (**AC-J2** offline form skips rainbowman + queued, **AC-J3** offline kanban move skips rainbowman + queued, **AC-J5** Won clickable offline, plus AC-J6) — do NOT write new tests, and note there are no separate exploration tests to re-run
  - These AC tests encode the expected behavior; when they pass they confirm the bugs are fixed
  - **EXPECTED OUTCOME**: tests PASS (offline form/kanban save no longer calls `get_rainbowman_message` and raises no error; the Won button is clickable offline and queues exactly one `action_set_won` with no rainbowman call; optimistic won shown; record not dirty)
  - _Design: Fix Checking pseudocode_
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7; AC-J2, AC-J3, AC-J5, AC-J6_

- [x] 8. Verify the preservation tests still pass
  - **Property 2: Preservation** - Online paths, email/phone propagation, and framework invariants unchanged
  - **IMPORTANT**: Re-run the SAME tests from task 2 (and AC-J1/AC-J4/AC-J7 in task 5) — do NOT write new tests
  - **EXPECTED OUTCOME**: tests PASS (online stage-change save still calls `get_rainbowman_message`; online "Won" still calls `action_set_won_rainbowman`; the queued offline `web_save` still carries `email_from`/`phone`; the spec-02 hook tests still pass) — confirms no regressions
  - _Design: Preservation Checking pseudocode; Property 3_
  - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10; AC-J1, AC-J4, AC-J7_

- [x] 9. Append the Python integration tests to class `TestCrmOffline`
  - Append to class `TestCrmOffline` in `addons/crm/tests/test_crm_offline.py` (reuse the `TestCrmCommon` fixtures / `HttpCase` already imported); do NOT create a second CRM offline Python module and do NOT re-add the import. Leave the existing `test_shortcuts_extend_parent` and `test_manifest_http_salesman` untouched (Req 3.11)
  - AC-P1 (Req 2.3): take the exact queued `web_save` args for an offline edit with the partner-sync flags and apply them verbatim through the ORM; compare the resulting lead + partner `email_from`/`phone` to the online write path and assert they match. Build and apply the `web_save` with EXACTLY the arguments the JS test (AC-J4) asserts are queued, so the JS "what is queued" and the Python "what the server does with it" assertions are tied to the same call shape
  - AC-P2 (Req 2.8): apply the queued `action_set_won` call (`action_set_won` on `[[resId]]`) through the ORM and assert `won_status == 'won'`, the lead's `stage_id.is_won` is true (won stage), and `probability == 100`
  - _Design: Testing Strategy → Integration Tests; Change 5, Change 3_
  - _Requirements: 2.3, 2.8, 3.11; AC-P1, AC-P2_

- [x] 10. Checkpoint — run the project checks and record results
  - Run `.kiro/scripts/check.sh quick`, then `.kiro/scripts/check.sh full`, via the script — do NOT retype the underlying commands
  - Report the script's output VERBATIM. If it fails for an environment reason (a path, the database), say so rather than working around it
  - Record that all five test commands and all scope checks pass, with acceptance row 5 (crm manifest version bumped one minor increment) EXPECTED to fail until spec 08 — report that row-5 failure as an explicit, expected deviation, NOT a regression
  - Ensure all tests pass; ask the user if questions arise
  - _Design: Verification_
  - _Requirements: 3.6, 3.7, 3.8, 3.9, 3.10, 3.11; NFR-5_
