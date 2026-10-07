# Requirements Document

## Introduction

Spec 06 ("data coverage") is the PART 3 slice of the CRM offline project. It covers the
*content* a salesperson works with on a lead while offline — the lead record itself, its
stage/team, its activities, and its contact — by consuming the web addon's existing offline
framework and queue and adding no new machinery.

The spec is split into three parts, matching the design:

- **3a — Leads / stages / teams: verify and prove.** Offline edit, stage move, and mark-won
  are already correct (specs 04–05). Spec 06 adds the two unproven 3a facts: an offline
  *create* of a lead queues and replays (distinct from an edit), and the TRUE offline
  behaviour when a salesperson reaches an uncached lead (acceptance row 9). Probing shows the
  framework does NOT render the offline action helper on a reroute to a cached view, so row
  9's literal wording is accepted-and-documented as NOT met (decision R1) and the explanation
  UI is carried forward to specs 07/08.
- **3b — Activities on a lead (mobile-only).** Scheduling an activity, logging a call, and
  marking an activity done while offline, enabled only on small screens (`isSmall() &&
  offline`), swapped at the model/component level so desktop and all online behaviour is
  unchanged — with ONE qualification: on a small screen, online, a first qualifying mount adds
  a single invisible background request (the activity-type prefetch below; see Requirement 16
  and acceptance criterion 12.6). An online-mobile, on-mount prefetch feeds the applicable
  `mail.activity.type` rows into the framework's existing many2x cache, because the framework
  otherwise never caches `mail.activity.type` for a crm lead (and the one autocomplete path
  that could returns only ~7 results, a partial list), which would leave the schedule control
  disabled or truncated offline for most users.
- **3c — Contact lookup / the lead's partner field (verify-and-prove).** Forbidding the
  creation of a contact from the lead's partner field offline is **enforced by the framework**
  (the autocomplete's create / create-edit / search-more suggestions are built online-only,
  and Enter/Tab on free text commits nothing); spec 06 **proves** this and adds **no code**,
  while contact lookup continues through the framework's existing many2x cache (no second
  cache).

Everything is gated on the framework's small-screen signal where it changes behaviour,
consumes the existing queue (ordered replay, last-write-wins, parked-in-systray), changes no
data model, adds no dependency, and lives entirely under `addons/crm/`. No source or test
file, `.config.kiro`, or manifest is created or modified by this requirements document.

## Glossary

- **CRM_Offline_System**: The spec-06 behaviour added to the crm addon — the offline create
  proof, the row-9 DOM proof, the mobile-only activity schedule / log-a-call / mark-done
  paths, and the optimistic-row logic. (3c adds no runtime code; it verifies and proves the
  framework-enforced partner-field behaviour.) It consumes the web/mail framework and lives
  entirely under `addons/crm/`.
- **Offline_Queue**: The framework sync queue read through `_ormToSync()` and written through
  `scheduleORM(...)`; replays entries verbatim in timestamp order, last-write-wins against the
  server, parks rejected entries in the offline systray with `extras.error`. Consumed as-is.
- **Small_Screen_Gate**: The predicate `useCrmOffline().isSmall() && useCrmOffline().isOffline()`
  that gates every 3b behaviour change; false on desktop and false online.
- **Schedule_Sheet**: The inline-template OWL bottom-sheet component (defined/exported in
  `activity_menu_patch.js`, opened by `CrmChatter.scheduleActivity()`) that collects activity
  type (from the `activityTypes` prop it is given — the SCHEDULABLE non-meeting types),
  summary, and a local-date deadline. It has NO assignee control; the queued call's `user_id`
  is set implicitly to the current user by the submit callback.
- **Chatter_Activity_Button**: Mail's chatter "Activity" `<button>`
  (`.o-mail-Chatter-activity`, `chatter.xml:25`), whose click reaches the
  `CrmChatter.scheduleActivity()` component override (not a global store patch).
- **Activity_Done_Button**: Mail's per-activity "Done" `<button>`
  (`.o-mail-Activity-markDone`, `activity.xml:66`), whose click reaches the patched
  `Activity.onClickMarkAsDone`.
- **Optimistic_Row**: A `mail.store` `mail.activity` row shown while a schedule call is
  queued, derived from the Offline_Queue (not held in component memory) and keyed by a
  stable key-derived negative temp id.
- **Pending_Marker**: The translated text (via `_t(...)`) appended to a row's rendered
  `summary` to indicate pending-sync / needs-retry / done-pending-sync state; derived from the
  Offline_Queue, never written destructively onto the stored record.
- **OfflineActionHelper**: The framework component (`web.OfflineActionHelper`) rendered only
  when a kanban/list controller's own root could not load offline
  (`couldNotLoadRootOffline`); NOT rendered on a reroute to a cached view.
- **Partner_Field**: The lead's `partner_id` field (`widget="res_partner_many2one"` in the
  real arch, rendered through web's `Many2XAutocomplete` / `AutoComplete`). Offline it offers
  no reachable create path — the create / create-edit / search-more suggestions are built
  online-only (`relational_utils.js:450`), the `quickCreate` commit is reachable only from one
  of those (`:515`), and Enter/Tab on free text commits nothing (`autocomplete.js:399-402`).
  Spec 06 needs **no patch** for this (verify-and-prove); the dropped
  `Field.fieldComponentProps` patch would have changed `canCreate` / `canCreateEdit` /
  `canQuickCreate`, which no offline code path reads for a create.
- **Many2x_Cache**: The framework relational-field cache (`MANY2X_TABLE_PREFIX = "many2x_"`),
  tables `many2x_mail.activity.type` and `many2x_res.partner`, populated automatically for
  visible relational fields on records visited online. Consumed as-is.
- **Activity_Type_Prefetch**: The CRM_Offline_System behaviour, run on `CrmChatter` mount
  online-mobile only, that reads the SCHEDULABLE activity types applicable to `crm.lead` — an
  unlimited searchRead over domain
  `['&', '|', ('res_model', '=', false), ('res_model', '=', 'crm.lead'), ('category', '!=', 'meeting')]`,
  fields `id`, `display_name`, and `category` — EXCLUDING `meeting`-category types (a meeting
  needs the online calendar round trip). It records the resulting non-meeting ids as the
  per-plugin schedulable allow-list and feeds `{id, display_name}` to the existing
  `many2x_mail.activity.type` Many2x_Cache via
  `offlinePlugin.cacheMany2XSearch("mail.activity.type", result)`. It exists because the
  framework otherwise never caches `mail.activity.type` for a crm lead, or caches only a
  partial ~7-result list via the autocomplete (BLOCKING-DEFECT: the schedule control would
  stay disabled or show a truncated list offline for most users). It is gated on the prefetch
  not having run for this page session — tracked via a WeakSet keyed by the OfflinePlugin
  instance, NOT a module-level flag (which would leak between Hoot tests) — so it runs even
  when the cache already holds some types; a successful prefetch marks the instance done and a
  ConnectionLostError leaves it unmarked to retry. It adds no second cache and no new
  machinery, running at most once per session per plugin instance (and at most once per
  mount) and never on desktop or offline.
- **Server_Id**: A real server-assigned record id. A record with no Server_Id is either
  brand-new (`record.isNew`) or offline-created with its `web_save` create still queued.
- **Row_9**: Acceptance row 9 — the project acceptance criterion whose literal wording is
  "an uncached lead opened offline shows the offline action helper".
- **KL-A**: The documented known limitation that the framework shows no OfflineActionHelper on
  a cached reroute, and a no-cache lead form renders a blank region.

## Requirements

### Requirement 1: Offline create of a lead queues and replays

**User Story:** As a field sales user, I want a lead I create while offline to be captured
and sent to the server when the connection returns, so that no new lead I entered offline is
lost.

Derived from design 3a Expected behavior (offline-created lead) and the G-3a-1 gap. Maps design
Property 7 (queue semantics unchanged) and the create path of the offline-sync flow.

#### Acceptance Criteria

1. WHILE the browser is offline, WHEN a user creates a lead and saves it, THE CRM_Offline_System SHALL enqueue a `web_save` create entry in the Offline_Queue carrying the entered values.
2. WHEN the connection returns and the Offline_Queue replays, THE CRM_Offline_System SHALL cause the server to receive the queued `web_save` create call.
3. WHEN the queued `web_save` create call is applied through the Odoo ORM, THE CRM_Offline_System SHALL produce a server lead record carrying the entered values.
4. WHILE a lead has no Server_Id, THE CRM_Offline_System SHALL treat that lead as an invalid target for any follow-up queued call until its create has replayed.
5. IF a queued create replay is rejected by the server, THEN THE CRM_Offline_System SHALL park the entry in the offline systray with its `extras.error` and SHALL retain the entry rather than dropping it.

### Requirement 2: Reaching an uncached lead offline leaves the user on cached rows (TRUE Row 9 behaviour, R1)

**User Story:** As a field sales user, I want tapping an uncached lead while offline to leave
me on the pipeline I already loaded with its real rows, so that I never see an empty form or
an error.

Derived from design 3a Expected behavior cases (a)/(b)/(c), the row-9 decision R1, and KL-A.
Maps design Property 10. Reference KL-A.

#### Acceptance Criteria

1. WHILE the browser is offline AND a lead's kanban card is not available offline, THE CRM_Offline_System SHALL render that card carrying the `o_disabled_offline` class.
2. WHILE the browser is offline, WHEN a user clicks an uncached lead's `o_disabled_offline` kanban card, THE CRM_Offline_System SHALL keep the cached multi-record view in place showing real cached rows, SHALL show zero `.o_form_view` elements, SHALL show no error dialog, AND SHALL show zero OfflineActionHelper elements.
3. WHILE the browser is offline, WHEN a user navigates directly to an uncached lead whose action has a cached multi-record view, THE CRM_Offline_System SHALL land on that cached multi-record view showing real cached rows, SHALL show zero `.o_form_view` elements, SHALL show no error dialog, AND SHALL show zero OfflineActionHelper elements.
4. WHERE no cached multi-record view exists for the action (case c), THE CRM_Offline_System SHALL leave the region blank with no empty form, no error dialog, and no OfflineActionHelper, as documented under KL-A.
5. THE CRM_Offline_System SHALL document that Row_9's literal wording ("shows the offline action helper") is NOT met for cases a, b, or c in spec 06, and SHALL record that the uncached-lead explanation UI is carried forward to spec 07 and asserted by spec 08.

### Requirement 3: Mobile-only offline activity scheduling (schedule / log a call)

**User Story:** As a field sales user on a phone, I want to schedule an activity or log a call
on a lead while offline, so that my follow-up is captured and synced automatically.

Derived from design 3b Expected behavior (schedule / log a call) and the queued-call
interfaces. Maps design Property 1.

#### Acceptance Criteria

1. WHILE the Small_Screen_Gate is true AND the lead has a Server_Id AND the Many2x_Cache for `mail.activity.type` is non-empty, THE CRM_Offline_System SHALL set `data-available-offline` on the Chatter_Activity_Button so the framework re-enables it.
2. WHILE the Small_Screen_Gate is true, WHEN a user clicks the re-enabled Chatter_Activity_Button, THE CRM_Offline_System SHALL open the Schedule_Sheet instead of the `mail.activity.schedule` wizard.
3. WHEN a user submits the Schedule_Sheet, THE CRM_Offline_System SHALL enqueue exactly `scheduleORM("crm.lead", "activity_schedule", [[leadId]], { activity_type_id, summary, date_deadline, user_id })` with no `ir.model` id, no onchange, and no transient wizard.
4. THE Schedule_Sheet SHALL offer only the SCHEDULABLE activity types `CrmChatter.scheduleActivity()` passes to it (resolved by awaiting the async cache search before the sheet opens): the `mail.activity.type` Many2x_Cache intersected with the prefetch's non-meeting allow-list.
5. WHEN a user logs a call, THE CRM_Offline_System SHALL enqueue the same `activity_schedule` call with a Call-type `activity_type_id`, producing a pending Call-type activity rather than a completed call record.
6. WHEN the schedulable (non-meeting) cached-type set resolves empty, THE CRM_Offline_System SHALL leave the Chatter_Activity_Button disabled and SHALL NOT present the Schedule_Sheet with an empty selector.
7. THE CRM_Offline_System SHALL NOT offer a `meeting`-category activity type in the Schedule_Sheet offline (a meeting needs the online calendar round trip, Requirement 11.1): the Activity_Type_Prefetch domain excludes `category = 'meeting'`, and because the `mail.activity.type` Many2x_Cache stores only `{id, display_name}` (so `category` does not survive it) and is shared, the sheet offers only the ids in the prefetch's non-meeting allow-list even if a meeting type is already cached by an unrelated dropdown search.

### Requirement 4: No schedule or queue without a server id

**User Story:** As a field sales user, I want the app to avoid queuing a follow-up that
depends on an id the server has not assigned yet, so that offline work never produces an
un-replayable call.

Derived from design 3b Guards. Maps design Property 3.

#### Acceptance Criteria

1. WHILE a lead has no Server_Id, THE CRM_Offline_System SHALL NOT set `data-available-offline` on the Chatter_Activity_Button and SHALL expose no schedule control for that lead.
2. WHILE a lead has no Server_Id, WHEN a user attempts to schedule an activity, THE CRM_Offline_System SHALL enqueue nothing in the Offline_Queue, checking the condition before any queueing.

### Requirement 5: Mobile-only offline mark-done bypassing the popover

**User Story:** As a field sales user on a phone, I want to mark an existing activity done
while offline, so that my completed follow-up is captured and synced.

Derived from design 3b Expected behavior (mark done) and the every-button-in-the-mark-done-chain
analysis. Maps design Property 1.

#### Acceptance Criteria

1. WHILE the Small_Screen_Gate is true AND an activity has a Server_Id AND that activity is not itself pending, THE CRM_Offline_System SHALL set `data-available-offline` on that activity's Activity_Done_Button.
2. WHILE the Small_Screen_Gate is true, WHEN a user clicks the re-enabled Activity_Done_Button, THE CRM_Offline_System SHALL enqueue exactly `scheduleORM("mail.activity", "action_feedback", [[activityId]], {})`.
3. WHILE the Small_Screen_Gate is true, WHEN a user clicks the re-enabled Activity_Done_Button, THE CRM_Offline_System SHALL NOT open the mark-done popover AND SHALL NOT issue the popover's `fetchNewMessages` call.
4. WHEN the queued `action_feedback` call is applied through the Odoo ORM, THE CRM_Offline_System SHALL mark the activity done and post a `mail.message` on the lead.
5. WHILE a mark-done `action_feedback` entry remains in the Offline_Queue, THE CRM_Offline_System SHALL keep the activity row visible marked with the done-pending-sync Pending_Marker rather than removing it.
6. WHILE an `action_feedback` entry is already queued for an activity, THE CRM_Offline_System SHALL enqueue no second `action_feedback` for that activity (a repeated click or direct call queues nothing more), avoiding a duplicate that would fail on replay.
7. WHILE an `action_feedback` entry is queued for an activity, THE CRM_Offline_System SHALL suppress that activity's Activity_Done_Button (clear its `can_write`), and SHALL restore the button when the entry leaves the Offline_Queue.
8. THE CRM_Offline_System SHALL carry systray metadata (`extras.actionName`, `extras.displayName`) on the queued `action_feedback` so the offline systray shows a named row.
9. THE CRM_Offline_System's `Activity.onClickMarkAsDone` patch SHALL take the offline queue branch ONLY for an activity whose `res_model` is `crm.lead`; for an activity of any other model it SHALL fall through to `super` (the normal popover path) and queue nothing — the patch is on the global mail `Activity` component, so it must be scoped to crm.lead. (The Done button is re-enabled offline only inside `CrmChatter`, i.e. only on a crm lead's chatter.)

### Requirement 6: No mark-done on a pending (offline-created) activity

**User Story:** As a field sales user, I want the app to prevent marking done an activity that
was itself created offline, so that no queued call targets an id the server has not assigned.

Derived from design 3b Guards and "marking an offline-created activity done is FORBIDDEN".
Maps design Property 4.

#### Acceptance Criteria

1. WHILE an activity carries a temporary negative id (offline-created, create still queued), THE CRM_Offline_System SHALL NOT set `data-available-offline` on that activity's Activity_Done_Button.
2. THE CRM_Offline_System SHALL give an offline-created Optimistic_Row `can_write = false` so mail's own per-activity Done button is not offered on it.
3. IF a mark-done is attempted on an activity without a Server_Id, THEN THE CRM_Offline_System SHALL enqueue nothing in the Offline_Queue.

### Requirement 7: Schedule entry attribute tracks the gate (set and removed)

**User Story:** As a field sales user, I want offline controls to be enabled only when they
are actually usable offline, so that no control is left clickable when it would fail.

Derived from design 3b "The attribute is REMOVED when the gate turns FALSE". Maps design
Property 5 (desktop unchanged) in the gate-transition direction.

#### Acceptance Criteria

1. WHEN the Small_Screen_Gate becomes false — the browser goes online, OR the `mail.activity.type` Many2x_Cache becomes empty, OR the lead loses its Server_Id — THE CRM_Offline_System SHALL remove `data-available-offline` from the Chatter_Activity_Button.
2. WHEN an activity's mark-done gate becomes false — the browser goes online, OR the activity becomes pending, OR the activity loses its Server_Id — THE CRM_Offline_System SHALL remove `data-available-offline` from that activity's Activity_Done_Button.
3. WHEN `data-available-offline` is removed from a mail button, THE CRM_Offline_System SHALL allow the framework selector pass to re-disable that bare `<button>`, so the button is never left enabled outside the gate.

### Requirement 8: Optimistic activity rows derived from the queue

**User Story:** As a field sales user, I want a scheduled-offline activity to appear
immediately and still be there if I leave and reopen the lead, so that my offline work is
visibly captured without duplication.

Derived from design 3b Data Models (Optimistic Row) and offline-sync flow. Maps design
Property 2.

#### Acceptance Criteria

1. WHILE a schedule entry for a lead is present in the Offline_Queue, THE CRM_Offline_System SHALL render one Optimistic_Row for that lead built from the entry's `kwargs`, inserted into the thread so mail's unchanged `mail.ActivityList` renders it.
2. THE CRM_Offline_System SHALL assign each Optimistic_Row a deterministic negative temp id derived from its Offline_Queue key, so the same queued schedule yields the same temp id across remounts.
3. WHEN a user leaves the lead form and reopens it while offline, THE CRM_Offline_System SHALL rebuild the same Optimistic_Row from the Offline_Queue — the same temp id, neither duplicated nor vanished.
4. THE CRM_Offline_System SHALL compute each Optimistic_Row's `state` with the same rule as the server, comparing `date_deadline` against the LOCAL date (not the UTC date): a deadline before today yields `overdue`, equal to today yields `today`, and after today yields `planned`.
5. THE CRM_Offline_System SHALL mark an Optimistic_Row pending based only on its own queue entry's presence in the Offline_Queue, and SHALL NOT mark any activity pending from an unrelated queued lead write.

### Requirement 9: Pending / needs-retry / done markers are translatable and queue-derived

**User Story:** As a field sales user, I want each offline activity to clearly show whether it
is waiting to sync, needs retry, or is done-pending-sync, in my own language, so that I always
know its real state.

Derived from design 3b Data Models and offline-sync flow steps 3 and 6, and Error Handling.
Maps design Property 8.

#### Acceptance Criteria

1. THE CRM_Offline_System SHALL carry the Pending_Marker text in a rendered field (the row's `summary`) translated via `_t(...)`, with no mail-template change.
2. THE CRM_Offline_System SHALL derive the Pending_Marker from the matching Offline_Queue entry and SHALL NOT write it destructively onto the stored record.
3. IF the matching Offline_Queue entry is parked with `extras.error`, THEN THE CRM_Offline_System SHALL surface the parked entry (with the server's error text) in the offline systray for manual retry AND SHALL surface the translated needs-retry Pending_Marker on the affected row while that entry is observable. For a queued activity call on reconnect, the OBSERVED guarantees are: the server is called exactly once (not re-sent), and the parked entry carrying the server's error text is observable at its first appearance. KL-B (observed, cause NOT established): with the chatter mounted, BOTH the chatter row and the systray read the same in-memory `_ormToSync()` map, so the parked entry is observable only transiently; NEITHER is claimed durable, and online in-memory persistence of the needs-retry row is NOT guaranteed for this case (flagged for Step 10 manual validation).
4. WHEN the matching Offline_Queue entry leaves the queue after a successful replay, THE CRM_Offline_System SHALL remove the Pending_Marker and restore the original rendered text.
5. WHEN the thread is refetched through the guarded `CrmChatter.load`, THE CRM_Offline_System SHALL recompute every marker from the Offline_Queue so no stale marker remains.
6. THE CRM_Offline_System SHALL keep the offline systray as the only error surface and SHALL add no CRM-specific error dialog, banner, or second error store.
7. WHEN a queued entry that decorated a server activity leaves the Offline_Queue (replayed OR discarded from the offline systray), THE CRM_Offline_System SHALL restore that activity's original rendered summary AND its original `can_write`, keeping both originals in a module-level `WeakMap` keyed by the store activity record (not a field on the record and not a per-component map) so a chatter remount restores from the true original and never doubles the marker.
8. WHEN a queued entry is parked in place (its presence unchanged but `extras.error` newly set), THE CRM_Offline_System SHALL refresh the affected row's Pending_Marker to needs-retry, recomputing on a signature of the queue entries (key plus error flag), not merely on the entry count.
9. THE CRM_Offline_System SHALL carry systray metadata (`extras.actionName`, `extras.displayName` = lead and summary) on the queued `activity_schedule` so the offline systray shows a named row.
10. THE CRM_Offline_System SHALL ensure every call it queues (`crm.lead/activity_schedule`, `mail.activity/action_feedback`, and the spec-04 `crm.lead/action_set_won`) renders in the offline systray with a translated label and no crash — classifying those methods for the framework systray, which otherwise reads `status.color` on an undefined status and throws (see Requirement 17 and design KL-B / Property 8b).

### Requirement 10: Reconnect reconciliation of activity rows

**User Story:** As a field sales user, I want my offline activity changes to settle correctly
once the connection returns, so that scheduled activities become real and completed ones
disappear.

Derived from design 3b offline-sync flow steps 4–6. Maps design Property 7.

#### Acceptance Criteria

1. WHEN the connection returns, THE CRM_Offline_System SHALL replay queued `activity_schedule` and `action_feedback` calls verbatim in queue order, last-write-wins against the server.
2. WHEN a schedule entry's key leaves the Offline_Queue after a successful replay, THE CRM_Offline_System SHALL drop its Optimistic_Row and fold in the refetched server activity.
3. WHEN a mark-done `action_feedback` entry's key leaves the Offline_Queue after a successful replay, THE CRM_Offline_System SHALL clear that activity's done-pending-sync marker (its queue entry is gone), reflecting the server having archived the activity. The server-side archive is the asserted guarantee (on `MockServer.env` in the JS test and end-to-end in the Python replay test); the live in-memory removal of the row from an already-mounted chatter is best-effort (KL-B) and is not separately asserted on the mounted component.
4. WHEN reconnecting, THE CRM_Offline_System SHALL refetch the thread only through the guarded `CrmChatter.load`, skipping when offline and catching `ConnectionLostError` to re-arm, never calling `super.load` directly.

### Requirement 11: Calendar-event-from-activity unreachable offline; related widgets stay disabled

**User Story:** As a field sales user, I want features that genuinely need the server to be
visibly unavailable offline, so that nothing fails mid-action.

Derived from design 3b Scope note and Out of scope. Maps design Property 5 (desktop/other
surfaces unchanged).

#### Acceptance Criteria

1. WHILE the browser is offline, THE CRM_Offline_System SHALL keep scheduling a calendar event (meeting) from an activity unreachable.
2. WHILE the browser is offline, THE CRM_Offline_System SHALL keep the kanban/list activity widgets and the activity-list popover disabled, out of scope for spec 06.

### Requirement 12: Desktop and online behaviour unchanged

**User Story:** As a desktop sales user and as any online user, I want the activity and
partner controls to behave exactly as before, so that my existing experience does not regress.

Derived from design 3b Explicitly unchanged behavior and 3c Explicitly unchanged behavior.
Maps design Property 5 and Property 6.

#### Acceptance Criteria

1. WHILE the browser is offline AND the screen is not small (desktop), THE CRM_Offline_System SHALL leave the Chatter_Activity_Button and Activity_Done_Button framework-disabled and SHALL NOT set `data-available-offline` on them.
2. WHILE the browser is online, under both the desktop and mobile presets, WHEN a user schedules an activity, THE CRM_Offline_System SHALL open the `mail.activity.schedule` wizard as today.
3. WHILE the browser is online, under both the desktop and mobile presets, WHEN a user marks an activity done, THE CRM_Offline_System SHALL open the mark-done popover as today, whose Done call issues `action_feedback` and `fetchNewMessages`.
4. WHEN the Small_Screen_Gate is false, THE CRM_Offline_System's `CrmChatter.scheduleActivity()` override and `Activity.onClickMarkAsDone` patch SHALL fall through to `super`, taking no CRM offline branch, and SHALL read connectivity through the plugin API (`useCrmOffline`), never the legacy `this.env.services.offline` bridge.
5. WHILE the browser is online, THE CRM_Offline_System SHALL leave the Partner_Field create affordances exactly as today (3c adds no patch; the framework builds the create suggestions online).
6. WHILE the browser is online AND the screen is small, THE CRM_Offline_System SHALL add exactly one invisible background request on a first qualifying CrmChatter mount — the Activity_Type_Prefetch searchRead of `mail.activity.type` (see Requirement 16) — with nothing visible changing; on desktop online it SHALL add no request at all.

### Requirement 13: The lead's partner field offers no way to create a contact offline, as enforced by the framework

**User Story:** As a field sales user, I want the lead's contact field to offer no way to
create a new contact while offline, so that I never create an unsyncable contact in the field.

Derived from design 3c (verify-and-prove). Maps design Property 9. The create path is already
closed by the framework offline; spec 06 proves it and adds no CRM runtime code.

#### Acceptance Criteria

1. WHILE the browser is offline, WHEN a user types an unmatched name in the lead's Partner_Field, THE framework SHALL show no "Create" and no "Create and edit" entry (the autocomplete action suggestions are built online-only, `relational_utils.js:450`). ("Search more" is built by the same online-only guard, but it is not separately asserted by the 3c test: it never appears for an UNMATCHED name even online — it needs matches beyond the dropdown limit — so an offline-absence assertion for it would be vacuous. The proof here is the Create / Create-and-edit pair, which DO appear online for the same input and are absent offline.)
2. WHILE the browser is offline, WHEN a user presses Enter or Tab with unmatched free text in the lead's Partner_Field, THE framework SHALL commit no `{ id: false, display_name }` quick-create value (the `quickCreate` commit is reachable only from an online-only suggestion, `relational_utils.js:515`, and the Enter/Tab handler returns without committing, `autocomplete.js:399-402`), leaving the field value unchanged / empty.
3. THE CRM_Offline_System SHALL prove acceptance criteria 13.1–13.2 with a unit test that mounts the lead form with `partner_id` rendered by the GENERIC many2one widget (no `widget` attribute) and `res.partner` defined in the mock — because the real `res_partner_many2one` widget is registered only in `web.assets_backend` and is absent from the crm unit-test bundle (`web.assets_unit_tests` lists only `partner_autocomplete/static/tests/**`), so a unit test cannot mount it — and SHALL NOT register a stand-in widget under the name `res_partner_many2one`.
4. WHILE the browser is online, WHEN a user types the same unmatched name in the lead's Partner_Field, THE framework SHALL offer the "Create" and "Create and edit" entries (the online behaviour, preserved).
5. THE CRM_Offline_System SHALL confirm the real-widget behaviour (that the backend-registered `res_partner_many2one`, and `partner_autocomplete`'s own company-autocomplete suggestions, offer no way to create a contact offline on a lead) by a Step 10 manual validation, and SHALL state this generic-vs-real-widget limit of the unit test explicitly in the PR description.
6. THE CRM_Offline_System SHALL add no CRM runtime code for 3c — it verifies and proves the framework-enforced behaviour, and SHALL NOT add a `Field.fieldComponentProps` patch (which would change `canCreate` / `canCreateEdit` / `canQuickCreate` that no offline code path reads for a create), import from `@partner_autocomplete`, or patch `Many2One.prototype`.

### Requirement 14: Offline contact lookup via the existing cache only

**User Story:** As a field sales user, I want to look up contacts I loaded online while
offline, so that I can set a lead's contact without a connection.

Derived from design 3c Expected behavior and offline-sync flow. Maps design Property 9.

#### Acceptance Criteria

1. WHILE the browser is offline, WHEN a user searches the lead's Partner_Field, THE CRM_Offline_System SHALL return contacts served solely by the existing `many2x_res.partner` Many2x_Cache.
2. THE CRM_Offline_System SHALL add no second relational cache for offline contact lookup.
3. THE CRM_Offline_System SHALL provide no path to create a contact offline from the Partner_Field.

### Requirement 15: No new machinery, no out-of-scope change, and verification discipline

**User Story:** As a maintainer, I want spec 06 to stay inside its hard constraints and prove
its scope with the project's checks, so that the offline framework, data model, and other
addons are not disturbed.

Derived from design Architecture, Dependencies, Out of scope, and Verification. Maps design
Property 7 (queue semantics unchanged) and the cross-cutting constraints.

#### Acceptance Criteria

1. THE CRM_Offline_System SHALL add no new offline machinery, no second cache, no queue-semantics change, no data-model change, no dependency, and no access-rule, record-rule, or group change.
2. THE CRM_Offline_System SHALL make all changes within `addons/crm/` only, with no file created or modified outside `addons/crm/`.
3. THE CRM_Offline_System SHALL gate every behaviour change in 3b on the Small_Screen_Gate, leaving desktop and all online paths unchanged.
4. THE CRM_Offline_System SHALL be validated by the three JS test lanes in `crm_offline.test.js` (paired desktop/mobile) and the Python replay tests in `TestCrmOffline`, with each new wired path covered by a test and a removal check.
5. WHEN `check.sh quick` and `check.sh full` are run, THE CRM_Offline_System SHALL pass all five test commands and all scope checks, with acceptance row 5 (crm manifest version bumped one minor increment) EXPECTED to fail until spec 08 and Row_9's literal wording NOT claimed met (decision R1, carried forward to specs 07/08).

### Requirement 16: Activity-type cache prefetch (online, mobile only)

**User Story:** As a field sales user on a phone, I want the activity types to be available
offline for any lead I opened online, so that I can actually schedule an activity offline
rather than finding the control disabled.

Derived from design's "Activity-type cache prefetch (feeds the existing many2x cache)"
subsection and the new Established-facts bullets. Maps design Property 11. Reference the
BLOCKING-DEFECT fact that the framework otherwise never caches `mail.activity.type` for a crm
lead, leaving the schedule control disabled offline for most users.

#### Acceptance Criteria

1. WHILE the browser is online AND the screen is small AND the lead has a Server_Id AND the Activity_Type_Prefetch has not run for this page session (tracked per OfflinePlugin instance), WHEN CrmChatter mounts, THE CRM_Offline_System SHALL issue exactly one read of the applicable SCHEDULABLE activity types (full domain `['&', '|', ('res_model', '=', false), ('res_model', '=', 'crm.lead'), ('category', '!=', 'meeting')]` — the wizard base domain ANDed with a `meeting`-category exclusion, Requirement 11.1 — fields `id`, `display_name`, and `category`), SHALL record the resulting non-meeting ids as the per-plugin schedulable allow-list, and SHALL pass `{id, display_name}` to `offlinePlugin.cacheMany2XSearch("mail.activity.type", result)`, even when the Many2x_Cache already holds some types. (The full domain and fields are asserted exactly by the P2 test.)
2. WHILE the browser is online AND the screen is small AND the lead has a Server_Id, WHEN CrmChatter mounts AND the Activity_Type_Prefetch has already run this session (the OfflinePlugin instance is already marked), THE CRM_Offline_System SHALL issue no prefetch read.
3. WHERE the screen is not small (desktop), THE CRM_Offline_System SHALL issue no prefetch read.
4. WHILE the browser is offline, THE CRM_Offline_System SHALL issue no prefetch read.
5. THE CRM_Offline_System SHALL run the Activity_Type_Prefetch at most once per page session per OfflinePlugin instance (and at most once per CrmChatter mount), tracked via a WeakSet keyed by the OfflinePlugin instance and NOT a module-level flag, where a successful prefetch marks the instance done and a ConnectionLostError leaves it unmarked to retry.
6. IF the prefetch read raises a ConnectionLostError, THEN THE CRM_Offline_System SHALL swallow it and re-arm for a later qualifying mount, checking `status(this) !== "destroyed"` after the await, and SHALL show no UI.
7. THE CRM_Offline_System SHALL implement the Activity_Type_Prefetch by feeding the existing Many2x_Cache through `cacheMany2XSearch`, adding no second cache and no new machinery.
8. THE Activity_Type_Prefetch SHALL add one background RPC on mobile when online (a searchRead of `mail.activity.type`), leaving desktop and mobile-offline behaviour unchanged.
9. THE schedulable (non-meeting) allow-list recorded by the prefetch SHALL be held in a session-scoped `WeakMap` keyed by the `OfflinePlugin` instance (`_schedulableTypeIds`), NOT persisted to IndexedDB. CONSEQUENCE after an offline PAGE RELOAD: the in-memory allow-list is empty until a NEW online prefetch runs, so with no allow-list nothing is treated as schedulable and the schedule control stays disabled — a meeting-category type is never leaked from the shared many2x cache. Persisting the allow-list was PROBED and found infeasible without new machinery: the `OfflinePlugin` exposes no public API to store an arbitrary CRM value in the existing offline IndexedDB (its only write paths are the visited-UI table, the orm-to-sync queue, and the many2x cache, whose `_encryptAndFormat` keeps only `{id, display_name}` and cannot carry `category`); adding a store or writing to the private `_idb` is forbidden by constraints.md. The warm-session path (open the lead online, then go offline WITHOUT reloading) keeps the allow-list and offers the schedulable types, which is the primary field flow.

### Requirement 17: Queued CRM calls never crash the offline systray

**User Story:** As a field sales user, I want my queued offline CRM changes to appear in the
sync systray without breaking it, so that I can always see and retry them.

Derived from the design's offline-systray classification patch and KL-B. The framework offline
systray fills an entry's status only for the five record-write methods it knows
(`offline_systray.js:14`,`:32`) and its template renders `status.color`/`status.label`
unconditionally for every entry (`offline_systray.xml:51-53`); a queued call with any other
method leaves status undefined and crashes the systray render. CRM queues three such methods,
including the spec-04 `crm.lead/action_set_won` (a latent spec-04 defect found by spec 06).
Maps design Property 8b.

#### Acceptance Criteria

1. WHERE a queued entry's model/method is one CRM produces (`crm.lead/activity_schedule`, `mail.activity/action_feedback`, or `crm.lead/action_set_won`), THE CRM_Offline_System SHALL provide that entry a status with a translated label and a color drawn from the framework systray's existing palette, so the systray renders a badge for it.
2. WHEN the offline systray renders any such queued CRM entry, THE CRM_Offline_System SHALL NOT cause a `status.color` TypeError and SHALL NOT crash the systray render.
3. WHERE a queued entry's model/method is NOT one CRM produces, THE CRM_Offline_System SHALL leave the framework's classification unchanged, so no other addon's systray behaviour changes.
4. THE CRM_Offline_System SHALL implement this by patching the framework `OfflineSystray` component from within crm (reached via its systray registry entry, since the class is not exported), adding no new file, no mail/web-file change, and no second error surface — the systray remains the only queued-change/error UI.

## Correctness Properties mapping

Each correctness property in `design.md` maps to the requirement acceptance criteria below.
A later edit can add `**Validates: Requirements X.Y**` directly to each design property using
this table.

| Design property | Validates requirements |
|---|---|
| Property 1: Verbatim-replayable queued calls | 3.3, 5.2 |
| Property 2: Pending marker self-scoped to the activity's own queue entry | 8.5 |
| Property 3: No server id ⇒ no schedule, no queue | 4.1, 4.2 |
| Property 4: No mark-done on a pending activity | 6.1, 6.2, 6.3 |
| Property 5: Desktop unchanged | 12.1, 12.4, 7.3 |
| Property 6: Online unchanged under both presets | 12.2, 12.3, 12.5 |
| Property 7: Queue semantics unchanged | 1.1, 1.2, 10.1, 15.1 |
| Property 8: Parked row stays honest | 9.3, 9.10, 1.5 |
| Property 8b: Systray never crashes on a queued CRM call | 9.10, 17.1, 17.2, 17.3, 17.4 |
| Property 9: Offline, the lead's partner many2one offers no reachable create path (framework-enforced); lookup uses only the existing cache | 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3 |
| Property 10: Reaching an uncached lead offline leaves the user on cached rows; literal helper not shown | 2.2, 2.3, 2.4, 2.5 |
| Property 11: Activity-type prefetch feeds the cache online-mobile only | 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8 |
