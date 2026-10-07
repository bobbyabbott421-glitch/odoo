# Requirements Document

## Introduction

Spec 07 of the CRM offline-mode effort adds the two mobile presentation pieces of PART 4
and wires them minimally into an already-rendered parent, the CRM kanban renderer:

- a mobile lead card (`CrmMobileLeadCard`), and
- a mobile quick create (`CrmMobileQuickCreate`), offered as a bottom sheet while offline
  on a small screen.

It also discharges the KL-A carry-forward from spec 06: a lead whose form was never cached
online, when tapped offline, shows an in-card explanation instead of a blank region.

Everything new is gated on the framework small-screen signal (`isSmall()` via
`useCrmOffline()`); desktop CRM rendering is unchanged. The offline sheet opens only when a
small screen is offline. The pending-create card is rendered from the Controller as a
full-width element above the renderer (above the kanban columns); spec 08 moves each card
into its pipeline stage column. The browser tour and the manifest version bump are also
deferred to spec 08. Acceptance row 9 (uncached-lead explanation proven end-to-end through
the pipeline/tour) is owned by spec 08; spec 07 implements the in-card message and proves it
with a JS unit test. New OWL code uses the plugin API only, never the legacy offline service
bridge.

Every acceptance criterion below is demonstrable by a test described in the design Testing
Strategy. The design Correctness Properties map onto these requirements as follows:
Property 1 → Requirements 1 and 10 (desktop-negative); Property 2 → Requirement 4;
Property 3 → Requirement 6; Property 4 → Requirements 2 and 13 (both read the same
`_ormToSync()` queue signal); Property 5 → Requirement 3; Property 6 → Requirement 10;
Property 7 → Requirement 5; Property 8 → Requirements 6 and 7. The strip accessor capability
(Requirement 13) and the strip rendering (Requirement 9) have no dedicated correctness
property; they are proven by the strip and accessor unit tests in the design Testing
Strategy. Requirement 14 (pipeline-board restriction) likewise has no dedicated correctness
property; it is proven by the forecast-board gate unit test (and its removal check) in the
design Testing Strategy. Every new mobile behaviour below is restricted to the board grouped
by stage_id (the `_crmMobileStageBoard` gate), so the forecast kanban — grouped by
date_deadline and disabled offline — inherits none of it (Requirement 14).

## Glossary

- **Mobile_Lead_Card**: The `CrmMobileLeadCard` OWL component. Rendered in record mode
  inside the kanban article for a real lead, or in queued-create mode in the host strip for
  a queued offline create.
- **Quick_Create_Sheet**: The `CrmMobileQuickCreate` OWL component, mounted as a bottom
  sheet for offline lead creation on a small screen.
- **Card_Host**: The CRM kanban rendering stack — `CrmKanbanRenderer`, the `CrmKanbanRecord`
  subclass of web `KanbanRecord`, and the CRM kanban Controller subclass — that renders the
  cards, the pending-create strip, and the New button.
- **Framework_Queue**: The web offline sync queue, read through `useCrmOffline()` /
  `_ormToSync()`; it replays `model`, `method`, `args`, `kwargs` verbatim and parks rejected
  calls in the existing offline systray.
- **Offline_Systray**: The existing web offline systray that renders queued and parked
  entries for manual retry.
- **isSmall**: The framework small-screen signal, read as `isSmall()` via `useCrmOffline()`.
- **isOffline**: The framework connectivity signal, read as `isOffline()` via
  `useCrmOffline()`.
- **hasQueuedWrite**: `useCrmOffline().hasQueuedWrite(model, id)` — true when the queue holds
  an entry whose `value.model === model` and whose `value.args[0]` id array includes `id`.
- **queuedWrites**: `useCrmOffline().queuedWrites(resModel)` — returns the array of queue
  entry values (`{model, method, args, kwargs, extras}`) for that model, read from the same
  `_ormToSync()` signal; reactive at call time.
- **isAvailableOffline**: `isAvailableOffline(actionId, viewType, resId)` via
  `useCrmOffline()` — true when the given view for the record was cached online.
- **Queued_Create**: A `crm.lead` `web_save` queue entry whose `args[0]` id list is empty
  (`[[], VALUES]`), representing an offline-created lead not yet synced.
- **VALUES**: The quick-create values dict built from only the entered fields: `name` is
  trimmed and always present; `contact_name`, `phone`, and `email_from` are trimmed and
  omitted when blank; `expected_revenue` is omitted when untouched; `stage_id` is omitted when
  the stage selector is disabled or no stage is chosen. A minimal confirm (name only) yields
  `{name}`.
- **EXTRAS**: The systray metadata object `{actionId, actionName, viewType, displayName,
  changes, timeStamp}` attached to a Queued_Create.
- **Stage_Groups**: The kanban model loaded groups (`root.groups`), served offline by the
  framework cached grouped read; each group exposes `serverValue` (server stage id),
  `displayName` (label) and `isFolded`, ordered by array position.

## Requirements

### Requirement 1: Mobile lead card rendering

**User Story:** As a field salesperson on a phone, I want a touch-friendly lead card, so
that I can read and act on a lead comfortably on a small screen.

#### Acceptance Criteria

1. WHILE isSmall() is true, THE Mobile_Lead_Card SHALL render the lead name.
2. WHILE isSmall() is true, THE Mobile_Lead_Card SHALL render the lead partner or contact
   name.
3. WHILE isSmall() is true, THE Mobile_Lead_Card SHALL render the lead expected revenue.
4. WHILE isSmall() is true AND the Mobile_Lead_Card is rendered on the real crm_kanban
   board, THE Mobile_Lead_Card tap surface (the kanban article/card tap area, which spans
   the card width and is rendered by web `KanbanRecord`, not by the standalone component)
   SHALL be at least 44 CSS pixels tall, measured on the real board. (A standalone-mounted
   card has no kanban article, so it is checked only for render and format, not for the
   44 CSS pixel tap-surface height.)
5. THE Mobile_Lead_Card SHALL render the in-card uncached-lead message as non-interactive
   text, which carries no 44 CSS pixel size requirement.
6. WHERE the screen is not small (isSmall() is false), THE Mobile_Lead_Card SHALL NOT be
   rendered.
7. WHILE isSmall() is true, THE Card_Host SHALL display the lead name exactly once on
   screen, with the arch card text rows hidden.

### Requirement 2: Pending-sync indicator read from the framework

**User Story:** As a field salesperson, I want each lead with an unsynced change to show a
pending-sync indicator, so that I know which changes are still waiting to reach the server.

#### Acceptance Criteria

1. WHILE isSmall() is true AND hasQueuedWrite("crm.lead", resId) is true, THE
   Mobile_Lead_Card SHALL show the pending-sync indicator.
2. WHEN the Framework_Queue drains the lead queued write, THE Mobile_Lead_Card SHALL clear
   the pending-sync indicator.
3. THE Mobile_Lead_Card SHALL derive the pending-sync state from the Framework_Queue
   (`_ormToSync()` via `useCrmOffline()`) and SHALL keep no card-owned dirty flag.
4. WHILE a lead has TWO queued edits (e.g. a stage-move web_save and another web_save), THE
   Mobile_Lead_Card SHALL show exactly one pending-sync indicator. (A queued create has no
   server id, so a create and an edit on one lead is impossible.)
5. WHEN a mail.activity `action_feedback` entry is queued, THE Mobile_Lead_Card SHALL leave
   the lead pending-sync indicator unchanged.

### Requirement 3: Uncached-lead in-card explanation

**User Story:** As a field salesperson, I want a lead I never opened online to explain
itself offline, so that I understand why I cannot open it instead of seeing a blank screen.

#### Acceptance Criteria

1. WHILE isSmall() is true AND isOffline() is true AND
   isAvailableOffline(actionId, "form", resId) is false, THE Mobile_Lead_Card SHALL show a
   translatable in-card message stating that the lead was not opened online and is
   unavailable offline.
2. THE Mobile_Lead_Card SHALL render the uncached-lead message as card state, independent of
   any tap or click on the card.
3. WHILE isSmall() is true AND isOffline() is true AND
   isAvailableOffline(actionId, "form", resId) is true, THE Mobile_Lead_Card SHALL NOT show
   the uncached-lead message.
4. WHILE isAvailableOffline(actionId, "form", resId) is true, THE Mobile_Lead_Card SHALL
   keep the normal tap behavior of the card.
5. WHERE the screen is not small (isSmall() is false), THE Mobile_Lead_Card SHALL render
   neither the card nor the uncached-lead message.

> Note: Acceptance row 9 of the overall effort is OWNED by spec 08, which proves the
> uncached-lead explanation through the pipeline and the browser tour. Spec 07 implements
> the in-card message and proves it with a paired mobile JS unit test (message present for
> an uncached lead, absent for a cached one).

### Requirement 4: Mobile quick-create entry point

**User Story:** As a field salesperson offline on a phone, I want the New button to open a
mobile quick-create sheet, so that I can create a lead without a connection.

#### Acceptance Criteria

1. WHILE isSmall() is true AND isOffline() is true, THE Card_Host SHALL keep the New button
   enabled by overriding `isNewButtonAvailableOffline` to return true.
2. WHEN the user taps New WHILE isSmall() is true AND isOffline() is true, THE Card_Host
   SHALL open the Quick_Create_Sheet by overriding `createRecord`.
3. WHILE online OR WHILE the screen is not small, THE Card_Host SHALL leave the New button
   and quick create behaving exactly as before (the inline kanban quick-create).
4. WHILE online OR WHILE the screen is not small, THE Card_Host SHALL NOT open the
   Quick_Create_Sheet.

### Requirement 5: Quick-create sheet contents and offline availability

**User Story:** As a field salesperson, I want the quick-create sheet to capture the lead
fields I need and stay usable offline, so that I can enter a lead quickly without creating a
contact.

#### Acceptance Criteria

1. THE Quick_Create_Sheet SHALL capture exactly name, contact_name, phone, email_from,
   expected_revenue, and stage_id.
2. THE Quick_Create_Sheet SHALL capture contact_name as free text, not as partner_id.
3. THE Quick_Create_Sheet SHALL have no partner field.
4. THE Quick_Create_Sheet SHALL place the `data-available-offline` attribute on every input
   and select and on both the Create and Cancel buttons.
5. WHILE the Quick_Create_Sheet is usable, THE Quick_Create_Sheet SHALL render every input,
   select, Create button, and Cancel button without the `[disabled]` attribute and without
   the `o_disabled_offline` class.
6. THE Quick_Create_Sheet SHALL populate the stage selector from Stage_Groups, using
   `group.serverValue` as each option value and `group.displayName` as each option label.
7. THE Quick_Create_Sheet SHALL list the stage options in the array order of Stage_Groups,
   including empty groups and folded groups.
8. IF no groups are available, THEN THE Quick_Create_Sheet SHALL disable the stage selector.
9. WHILE a search filter is active, THE Quick_Create_Sheet SHALL list the stages present in
   the filtered groups.
10. THE Quick_Create_Sheet SHALL exclude any group whose serverValue is falsy (the
    "None"/no-stage group) from the stage options.
11. WHILE isSmall() is true, THE Quick_Create_Sheet SHALL render each input, the stage
    select, and the Create and Cancel buttons at a size of at least 44 CSS pixels in width
    and at least 44 CSS pixels in height.

### Requirement 6: Quick-create queued create shape

**User Story:** As a field salesperson, I want an offline lead creation to queue a
self-contained, replayable create, so that my new lead reaches the server intact when the
connection returns.

#### Acceptance Criteria

1. WHEN the user confirms a valid quick-create WHILE offline, THE Quick_Create_Sheet SHALL
   queue exactly one `crm.lead` `web_save` call with args `[[], VALUES]`.
2. WHEN the user confirms a valid quick-create WHILE offline, THE Quick_Create_Sheet SHALL
   queue the `web_save` call with kwargs `{ context: root.context, specification: {} }`.
3. WHEN the user confirms a valid quick-create WHILE offline, THE Quick_Create_Sheet SHALL
   attach EXTRAS `{ actionId, actionName, viewType, displayName, changes, timeStamp }` to
   the queued call.
4. WHEN the user confirms a valid quick-create WHILE offline, THE Quick_Create_Sheet SHALL
   add no queue entry other than the single `crm.lead` `web_save`.
5. THE Quick_Create_Sheet SHALL include `specification` as `{}` in the queued kwargs so that
   replay does not raise a TypeError.
6. THE Quick_Create_Sheet SHALL carry the pipeline `default_type`, and `default_team_id`
   where set, in the queued `context` so that the replayed lead has the correct type and
   team.
7. IF the stage selector is disabled, THEN THE Quick_Create_Sheet SHALL omit stage_id from
   VALUES.
8. WHEN the user confirms a valid quick-create, THE Quick_Create_Sheet SHALL trim the name in
   VALUES and SHALL use the trimmed name as EXTRAS.displayName.
9. WHERE an optional field (contact_name, phone, or email_from) is blank, THE
   Quick_Create_Sheet SHALL omit that field from VALUES.
10. WHERE expected_revenue is untouched (empty), THE Quick_Create_Sheet SHALL omit
    expected_revenue from VALUES.
11. WHERE an optional field (contact_name, phone, email_from, or expected_revenue) is filled,
    THE Quick_Create_Sheet SHALL include that field in VALUES (optional text fields trimmed;
    expected_revenue coerced to a Number).

### Requirement 7: Systray renders the queued create without error

**User Story:** As a field salesperson, I want the queued create to appear in the existing
offline systray without breaking it, so that I can track and retry it through the normal
offline UI.

#### Acceptance Criteria

1. WHILE a Queued_Create produced by the real Create path is present offline, WHEN the user
   opens the Offline_Systray, THE Offline_Systray SHALL render the queued-create row with its
   label (Created / displayName).
2. WHILE a Queued_Create produced by the real Create path is present offline, WHEN the user
   opens the Offline_Systray, THE Offline_Systray SHALL raise no error.
3. THE Card_Host SHALL add no CRM-specific error UI for queued or parked creates.
4. IF a Queued_Create replay is rejected by the server, THEN THE Framework_Queue SHALL park
   the entry in the Offline_Systray for manual retry.

### Requirement 8: Client-side quick-create validation

**User Story:** As a field salesperson, I want the sheet to reject an invalid lead before
queuing, so that I never queue a create that cannot be saved.

#### Acceptance Criteria

1. IF name is empty when the user confirms, THEN THE Quick_Create_Sheet SHALL perform no
   create action, mark the name field invalid, and queue nothing.
2. IF expected_revenue is non-numeric when the user confirms, THEN THE Quick_Create_Sheet
   SHALL perform no create action, mark the expected_revenue field invalid, and queue
   nothing.
3. IF email_from is malformed when the user confirms, THEN THE Quick_Create_Sheet SHALL
   perform no create action, mark the email_from field invalid, and queue nothing.
4. WHILE a field is in an invalid state, THE Quick_Create_Sheet SHALL keep the
   `data-available-offline` attribute on both the Create and Cancel buttons.
5. WHEN the confirm handler is invoked programmatically with an empty name, THE
   Quick_Create_Sheet SHALL return without queuing anything.

### Requirement 9: Optimistic pending-create strip

**User Story:** As a field salesperson, I want a lead I just created offline to appear
immediately, so that I can see my new lead before it syncs.

#### Acceptance Criteria

1. WHILE isSmall() is true AND a Queued_Create exists, THE Card_Host SHALL render one
   Mobile_Lead_Card in queued-create mode per Queued_Create.
2. THE Mobile_Lead_Card in queued-create mode SHALL show the name, contact_name, expected
   revenue, and stage from the queued VALUES.
3. THE Mobile_Lead_Card in queued-create mode SHALL show the pending-sync indicator.
4. WHERE a field is missing from the queued VALUES, THE Mobile_Lead_Card SHALL render that
   field empty without raising an error.
5. THE Card_Host SHALL render a strip card for EVERY `crm.lead` `web_save` queue entry with
   an empty id list regardless of origin (quick-create or form view) and regardless of
   actionId.
6. THE Card_Host SHALL resolve a queued create's stage label **only** from the loaded groups
   (matching the queued `stage_id` against Stage_Groups `group.serverValue` to
   `group.displayName`); WHERE the stage is unresolved (no matching group, or no `stage_id`),
   THE Card_Host SHALL show no stage rather than crash, with no `extras.changes` fallback.
7. THE Card_Host SHALL render the pending-create strip as a full-width element ABOVE the
   kanban columns, from the Controller, not as a kanban column.
8. THE Card_Host SHALL derive the strip's queued creates through
   useCrmOffline().queuedWrites("crm.lead") (filtering to empty-id `web_save` entries) and
   SHALL NOT resolve the OfflinePlugin directly.
9. IF a strip card's queue entry is parked with extras.error, THEN THE Mobile_Lead_Card
   SHALL show a translatable "needs retry" marker derived from extras.error, with no
   CRM-specific error UI or dialog; otherwise (no error) THE Mobile_Lead_Card SHALL show the
   "pending sync" indicator.

> Note: The pending-create strip is rendered from the Controller as a full-width element
> ABOVE the kanban columns (not a flat strip in the host renderer); spec 08 moves each
> pending-create card into its pipeline stage column.

### Requirement 10: Additive wiring preserves existing card and desktop behavior

**User Story:** As a sales user, I want the mobile card wired in without replacing the
existing kanban card, so that drag, menu, selection, and the activity and priority widgets
keep working and desktop is unchanged.

#### Acceptance Criteria

1. THE Card_Host SHALL add the Mobile_Lead_Card inside the kanban article via a
   primary-inherit template without swapping `web.KanbanRecord`.
2. WHILE wired additively AND offline, WHEN the user opens a lead card's dropdown menu, THE
   Card_Host SHALL open the card menu.
3. WHILE wired additively AND offline, WHEN the user moves a lead to another stage through
   the kanban model move path, THE Card_Host SHALL queue the expected `crm.lead` `web_save`
   on that lead.
4. WHILE wired additively AND offline, WHEN the user taps a cached lead card, THE Card_Host
   SHALL open that lead's form (consistent with Requirement 3.4).
5. WHILE wired additively AND offline, WHEN the user clicks the priority widget on a lead
   card, THE Card_Host SHALL queue the priority write on that lead.
6. WHILE wired additively, THE Card_Host SHALL render the activity widget on the lead card.
7. THE Card_Host primary inherit SHALL NOT change `web.KanbanRecord` for any other view.
8. WHERE the screen is not small (isSmall() is false), THE Card_Host SHALL leave desktop
   rendering unchanged, with no mobile card, sheet, strip, or in-card message.
9. THE Card_Host SHALL insert the Mobile_Lead_Card as the first child of the kanban article
   (above the arch body, via `xpath expr="article/*[1]" position="before"`), so that the
   Mobile_Lead_Card precedes the footer priority and activity widgets in document order.

> Note: Real touch drag-and-drop of a card on a device cannot be exercised in the JS unit
> harness; it is a Step 10 manual check, not a unit-provable acceptance criterion here.

### Requirement 11: Server-side replay correctness

**User Story:** As a sales user, I want a replayed offline create to become a correct lead
on the server, so that no entered data or lead type is lost on reconnect.

#### Acceptance Criteria

1. WHEN the queued `web_save` create is replayed through
   `call_kw(crm.lead, 'web_save', [[], VALUES], {context, specification: {}})`
   (equivalently `browse([]).with_context(**ctx).web_save(VALUES, specification={})`) with a
   lead pipeline context (`default_type='lead'`), THE crm.lead SHALL carry the entered
   values, the chosen stage, and the type `lead`.
2. WHEN the queued `web_save` create is replayed through
   `call_kw(crm.lead, 'web_save', [[], VALUES], {context, specification: {}})`
   (equivalently `browse([]).with_context(**ctx).web_save(VALUES, specification={})`) with an
   opportunity pipeline context (`default_type='opportunity'`), THE crm.lead SHALL carry the
   entered values, the chosen stage, and the type `opportunity`.
3. THE server-side replay test SHALL replay BOTH a full payload (name + optional fields +
   stage, under the lead pipeline) AND a minimal payload (name + stage_id only, mirroring the
   sheet's omit-empty behaviour, under the opportunity pipeline), and the minimal payload
   SHALL produce a correct lead just as the full payload does.

### Requirement 12: Constraints and non-functional requirements

**User Story:** As a maintainer, I want spec 07 to stay within the CRM offline-mode
constraints, so that the change consumes the existing framework and does not regress the
rest of the system.

#### Acceptance Criteria

1. THE spec-07 code SHALL use the plugin API only (`useCrmOffline`, `usePlugin`, `signal`)
   and SHALL NOT use the legacy offline service bridge.
2. THE spec-07 code SHALL add no new offline machinery, no second cache, no change to queue
   conflict semantics, and no data-model change.
3. THE spec-07 code SHALL modify no file outside `addons/crm/`.
4. THE spec-07 code SHALL add no new dependency.
5. THE spec-07 code SHALL add or change no manifest asset glob.
6. THE spec-07 code SHALL create only the allowed new files
   (`crm_mobile_lead_card.js`/`.xml`/`.scss` and `crm_mobile_quick_create.js`/`.xml`/`.scss`)
   and SHALL create no other new file or directory; the `queuedWrites` accessor is added to
   `crm_offline_hooks.js`, which is an EDITED EXISTING file (not a new file), so the
   allowed-new-files set is unchanged and no new file or glob is introduced.
7. THE ~300-line size guard SHALL apply to the PRODUCTION source files
   (`crm_kanban_renderer.js`, `crm_kanban_view.js`, and the new component `.js` files) and
   SHALL NOT apply to `crm_offline.test.js`, whose growth is reported in the PR but is not a
   stop condition.
8. THE spec-07 work SHALL NOT bump the crm manifest version; acceptance row 5 (crm manifest
   version bumped one minor increment) is EXPECTED to fail until spec 08 and SHALL NOT be
   claimed as passing in spec 07.

### Requirement 13: Shared hook queued-writes accessor

**User Story:** As a mobile component author, I want one shared read accessor for queued
entries, so that mobile components do not resolve the OfflinePlugin directly.

#### Acceptance Criteria

1. THE useCrmOffline() hook SHALL expose a `queuedWrites(resModel)` accessor that returns the
   array of queue entry values (`{model, method, args, kwargs, extras}`) for that model, read
   from the `_ormToSync()` signal.
2. THE queuedWrites(resModel) accessor SHALL return only the entries whose `value.model`
   equals resModel.
3. WHEN the Framework_Queue changes, THE queuedWrites(resModel) accessor SHALL return the
   updated entries reactively at call time.
4. IF the queue holds no entry for resModel, THEN THE queuedWrites(resModel) accessor SHALL
   return an empty array.
5. THE useCrmOffline() hook's EXISTING tests SHALL remain unchanged, and a NEW test SHALL
   cover the queuedWrites accessor.

### Requirement 14: Pipeline-board restriction

**User Story:** As a sales user, I want the mobile offline additions to apply only to the
pipeline board grouped by stage, so that the forecast board (grouped by expected-closing date,
disabled offline) does not inherit any of them.

#### Acceptance Criteria

1. WHERE the board is grouped by stage_id (`root.groupByField?.name === "stage_id"`), THE
   Card_Host SHALL apply the new mobile behaviour (the offline New-button override, the
   quick-create sheet, the pending-create strip, and the injected Mobile_Lead_Card).
2. WHERE the board is NOT grouped by stage_id (for example the forecast kanban grouped by
   date_deadline), THE Card_Host SHALL NOT keep the New button enabled offline, SHALL NOT open
   the Quick_Create_Sheet, SHALL NOT render the pending-create strip, and SHALL NOT inject the
   Mobile_Lead_Card.
3. THE Card_Host SHALL gate the Controller overrides on the `_crmMobileStageBoard` getter and
   SHALL gate the injected Mobile_Lead_Card on the same stage_id check in the card-host
   template.
4. WHILE isSmall() is true AND isOffline() is true, WHEN the forecast kanban (grouped by
   date_deadline) is mounted, THE Card_Host SHALL show no New sheet, no pending-create strip,
   and no Mobile_Lead_Card.
