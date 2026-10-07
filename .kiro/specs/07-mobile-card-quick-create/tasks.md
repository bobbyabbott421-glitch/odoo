# Implementation Plan: Mobile Lead Card + Quick Create (spec 07)

## Overview

This plan derives from `design.md` and `requirements.md` in this directory. It builds the two
mobile presentation pieces of PART 4 and wires them minimally into the CRM kanban stack:

- `CrmMobileLeadCard` (record mode + queued-create mode).
- `CrmMobileQuickCreate` (offline bottom sheet).

Everything new is gated on `isSmall()` via `useCrmOffline()`; desktop CRM rendering is
unchanged. New OWL code uses the plugin API only (no legacy offline service bridge). No new
offline machinery, no second cache, no data-model change, nothing outside `addons/crm/`, no
new dependency, no manifest glob change, no manifest version bump (that is spec 08).

Task 0 adds the shared-hook `queuedWrites(resModel)` read accessor the strip depends on; tasks
1-3 build the card; task 4 wires the card into the kanban record/renderer and the board; task 5
builds the sheet; task 6 wires the sheet entry point from the Controller; task 7 proves the
sheet's systray extras; task 8 adds the Controller-owned optimistic pending-create strip,
rendered FROM THE CONTROLLER as a full-width element ABOVE the kanban columns (spec 08 moves
each card into its pipeline stage column); task 9 adds the Python replay test; task 10
verifies; task 11 records the carry-forward and the Step 10 manual-check list AND edits
`.kiro/steering/spec-plan.md`.

### Allowed new files (exactly these; no others, no new globs)

- `addons/crm/static/src/mobile/crm_mobile_lead_card/crm_mobile_lead_card.js`, `.xml`, `.scss`
- `addons/crm/static/src/mobile/crm_mobile_quick_create/crm_mobile_quick_create.js`, `.xml`, `.scss`

Wiring edits THREE existing production files only: `crm_offline_hooks.js` (the shared hook: add
the `queuedWrites(resModel)` read accessor ONLY, task 0.1), `crm_kanban_renderer.js` (the
per-card component registration ONLY) and `crm_kanban_view.js` (the Controller: the New-button
overrides AND the pending-create strip template). Tests go in
`addons/crm/static/tests/crm_offline.test.js` (paired desktop/mobile via `test.tags(...)`) and
a new method in class `TestCrmOffline` in `addons/crm/tests/test_crm_offline.py`. The two new
crm templates (the kanban-record primary inherit and the kanban-VIEW primary inherit for the
strip) live inside the allowed `crm_mobile_lead_card.xml` via `t-inherit`, NOT new standalone
template files. The hook's EXISTING tests stay unchanged. If any task concludes another new
file is needed, it MUST stop and raise an open question with the user, not create the file.

### Size guard (applies to PRODUCTION source files only — Item 9)

The ~300-line size guard applies to the PRODUCTION source files only
(`crm_offline_hooks.js`, `crm_kanban_renderer.js`, `crm_kanban_view.js`, and the new component
`.js` files `crm_mobile_lead_card.js`/`crm_mobile_quick_create.js`), measured as ~300 ADDED
lines per file. If any such file would grow by more than ~300 lines, STOP and ask the user
before proceeding. The guard does NOT apply to `crm_offline.test.js`: it must carry every new
test; report its growth in the PR but do NOT stop for it. Per-task size-guard notes are
repeated inline below on the production-file tasks only.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1"] },
    { "id": 1, "tasks": ["0.2"] },
    { "id": 2, "tasks": ["1.1", "1.2"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.0"] },
    { "id": 7, "tasks": ["4.2"] },
    { "id": 8, "tasks": ["5.1", "5.2"] },
    { "id": 9, "tasks": ["6.1"] },
    { "id": 10, "tasks": ["7.1"] },
    { "id": 11, "tasks": ["8.1"] },
    { "id": 12, "tasks": ["9.1"] },
    { "id": 13, "tasks": ["12.1"] },
    { "id": 14, "tasks": ["10.1"] },
    { "id": 15, "tasks": ["11.1"] }
  ]
}
```

Note: tasks that write `crm_offline.test.js` (0.2, 1.2, 2.1, 3.1, 4.0, 4.2, 5.2, 6.1, 7.1, 8.1,
12.1) are serialized into separate waves above because they all edit the same file. Task 12.1
(the forecast-board gate) edits `crm_kanban_view.js` (shared with 6.1 and 8.1) and
`crm_mobile_lead_card.xml`, so it is placed in its own wave after both 6.1 and 8.1 to avoid a
file conflict. Task 0.1 edits
`crm_offline_hooks.js` and runs FIRST (wave 0), before the strip in task 8 that depends on the
new accessor; the card tasks (1-3) do not depend on it. Task 4.0 (the real-board render test)
is placed AFTER 4.1 because it exercises the production wiring that 4.1 adds. The per-card
registration in `crm_kanban_renderer.js` (4.1), the hook accessor in `crm_offline_hooks.js`
(0.1), and the Controller edits in `crm_kanban_view.js` (6.1 New-button overrides, 8.1 strip
template) edit DIFFERENT production files from each other; 6.1 and 8.1 both edit
`crm_kanban_view.js`, so they are kept in different waves to avoid a file conflict.

## Tasks

- [x] 0. Shared-hook queued-writes accessor
  - [x] 0.1 Add `queuedWrites(resModel)` to the shared hook (production code)
    - Edit `addons/crm/static/src/mobile/crm_offline_hooks.js`: add ONE read accessor
      `queuedWrites(resModel)` to the object `useCrmOffline()` returns. It reads
      `offline._ormToSync()` AT CALL TIME (so it stays reactive, exactly like `hasQueuedWrite`),
      filters `Object.values(offline._ormToSync())` to entries whose `value.model === resModel`,
      and returns an ARRAY of those entries' `value` objects (each
      `{ model, method, args, kwargs, extras }`). Built on the SAME `_ormToSync()` signal the
      hook already reads — NO second store, no new machinery.
    - Do NOT touch the hook's existing members or exports beyond adding this one accessor; the
      hook's EXISTING tests stay unchanged (do not edit them).
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5; Property 4_
    - SIZE GUARD note: `crm_offline_hooks.js` is a PRODUCTION file (~300-added-line guard
      applies, though this is a tiny addition) — if it would grow by more than ~300 lines, STOP
      and ask the user.
  - [x] 0.2 Test the `queuedWrites` accessor (paired desktop/mobile)
    - Edit `addons/crm/static/tests/crm_offline.test.js`. Add a NEW test (do NOT edit the hook's
      existing tests). Paired desktop/mobile via `test.tags(...)`:
      - "spec07 queuedWrites returns only requested model": seed a `crm.lead` entry AND another
        model's entry; assert `queuedWrites("crm.lead")` returns ONLY the `crm.lead` entry's
        `value` object(s).
      - "spec07 queuedWrites empty when none": with no entries for `crm.lead`, assert it returns
        an empty array.
      - "spec07 queuedWrites updates with the queue": add an entry → it appears; drain the
        queue → it is gone (reactive at call time).
    - Removal check: this accessor is a PURE hook read with no production-wiring line of its own
      to remove, so its real wiring removal check lives with the strip in task 8.1 (remove the
      `queuedWrites` call in the strip derivation, or make it return `[]`, → the strip test goes
      red; restore). Additionally, as a self-contained check on THIS test, break the model
      filter so the accessor returns all models → the "returns only requested model" assertion
      fails; restore. State both explicitly rather than writing "n/a".
    - Drive connectivity through the real `setOffline` helper; do not patch `setOffline` or
      hand-set any flag.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5; Property 4_

- [x] 1. CrmMobileLeadCard component (record mode)
  - [x] 1.1 Create the card component in record mode
    - Create `addons/crm/static/src/mobile/crm_mobile_lead_card/crm_mobile_lead_card.js`,
      `crm_mobile_lead_card.xml`, `crm_mobile_lead_card.scss`.
    - JS: a plain OWL 3 `Component` using `useProps({ record?, queuedValues?, parkedError?,
      actionId? })`; read `useCrmOffline()` for `isSmall()`, `isOffline()`,
      `hasQueuedWrite(model, id)`, `isAvailableOffline(actionId, "form", resId)`. No other
      plugin resolved directly (plugin-API-only constraint). Guard every field read so a missing
      field renders empty.
    - JS: import `formatMonetary` from `@web/views/fields/formatters`; format
      `expected_revenue` as monetary using the record's `company_currency` (the same
      `currency_field` the arch monetary widget uses) — NOT a bare number. In queued-create
      mode format the raw entered amount the same way when a currency is resolvable, else show
      it plainly.
    - XML: render `name`, the partner/contact name (`partner_id` display name falling back to
      `contact_name`/`partner_name`), and the formatted `expected_revenue` from `record` in
      record mode.
    - SCSS: the card tap surface is the kanban article / card root (the whole card is the tap
      area that opens the form); set `min-height: 44px` on that card root/article tap surface
      (DOM geometry, Fact 7). The card has no button of its own; the in-card uncached-lead
      message is non-interactive text and carries NO 44px requirement.
    - _Requirements: 1.1, 1.2, 1.3; Property 1_
    - SIZE GUARD note: `crm_mobile_lead_card.js` — if this file would grow by more than ~300
      lines, STOP and ask the user.
  - [x] 1.2 Paired desktop/mobile render tests for the card
    - Edit `addons/crm/static/tests/crm_offline.test.js`. Mock `crm.lead` fields with the
      SAME production types (`name` Char, `contact_name` Char, `partner_id` Many2one,
      `expected_revenue` Monetary/Float as in `crm_lead.py`, plus `company_currency`).
    - Mobile test ("spec07 card renders name/partner/revenue", `test.tags("mobile")`): mount
      `CrmMobileLeadCard` in record mode; assert the three fields render and `expected_revenue`
      is formatted via `formatMonetary` (not a bare number). This standalone-mounted card has
      NO kanban article, so it is checked for render/format ONLY — the 44px card-tap-surface
      assertion is NOT made here (it is on the real board in task 4.0 / 4.2).
    - Desktop test ("spec07 card not rendered on desktop", `test.tags("desktop")`): assert
      `CrmMobileLeadCard` is NOT rendered (Property 1 desktop-negative).
    - Removal check: this standalone render test has no single production line to remove, so
      its real removal check is the task-4.0 real-board test ("spec07 board renders the card");
      state that explicitly rather than writing "n/a". Drive connectivity through the real
      `setOffline` helper; do not patch `setOffline` or hand-set any flag.
    - _Requirements: 1.5, 1.6; Property 1_

- [x] 2. Pending-sync indicator in the card (record mode)
  - [x] 2.1 Add the pending-sync indicator and its tests
    - Edit `crm_mobile_lead_card.js`/`.xml`: in record mode show the pending-sync indicator
      when `hasQueuedWrite("crm.lead", record.resId)` is true; derive the state from the
      framework queue (`_ormToSync()` via `useCrmOffline()`) with NO card-owned dirty flag.
      Indicator is a single boolean state, not a per-entry badge.
    - Edit `crm_offline.test.js` (mobile + offline):
      - "spec07 indicator shows with queued web_save": queue a `crm.lead` `web_save`; assert
        the indicator shows.
      - "spec07 indicator clears when queue drains": drain the queue; assert the indicator is
        absent AND assert the card element still exists (never "absent" alone).
      - "spec07 one indicator for two queued edits" (Fix 8 / Item 4): a lead with TWO queued
        edits (a stage-move `web_save` AND another `web_save`) shows exactly ONE indicator, not
        two. (A queued create has no server id, so a create + edit on one lead is impossible.)
      - "spec07 action_feedback does not flip indicator": queue a `mail.activity`
        `action_feedback`; assert the lead indicator is unchanged.
    - Removal check: temporarily make the card ignore `hasQueuedWrite` (hardcode the indicator
      condition to `false`) → the "indicator shows with queued web_save" test goes red;
      restore. Drive connectivity through the real `setOffline` helper; do not patch
      `setOffline` or hand-set any flag.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5; Property 4_

- [x] 3. Uncached-lead in-card message
  - [x] 3.1 Add the uncached-lead message and its paired tests
    - Edit `crm_mobile_lead_card.js`/`.xml`: in record mode, render a translatable (`_t`)
      in-card message when `isSmall() && isOffline() && !isAvailableOffline(actionId, "form",
      resId)`. Render it as card STATE (not gated on a tap/click, since the framework disables
      an uncached card's tap target). Non-button element; carry `data-available-offline` on any
      interactive part. Keep normal tap behavior when the form IS available offline. Not shown
      in queued-create mode.
    - Edit `crm_offline.test.js`:
      - Mobile + offline test ("spec07 uncached message present"): message element EXISTS for an
        uncached lead.
      - Mobile + offline test ("spec07 cached lead no message"): message element ABSENT for a
        cached lead AND assert the card element exists.
      - Desktop test ("spec07 uncached message not on desktop"): neither card nor message is
        rendered.
    - Removal check: remove the `!isAvailableOffline(...)` guard → the message wrongly shows for
      a cached lead → the "cached lead no message" / "absent for cached" assertion goes red;
      restore. Note: acceptance row 9 (uncached explanation proven end-to-end through the
      pipeline/tour) is OWNED by spec 08; spec 07 only proves the in-card message by unit test.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5; Property 5_

- [x] 4. Additive card host wiring
  - [x] 4.0 Real-board render test for the wired card
    - Edit `crm_offline.test.js`. These card-host tests mount the PRODUCTION card arch
      VERBATIM: a `spec07VerbatimKanbanArch` constant mirroring `crm_lead_views.xml:524-562`,
      rendered through the REAL `crm_kanban` view against the shared mock EXTENDED with the
      card's fields (`company_currency`, `recurring_revenue`, `recurring_plan`, `priority`,
      `contact_name`, `partner_name`, `tag_ids`, `date_deadline`, `color`, `is_rotting`,
      `rotting_days`) plus the `crm.recurring.plan` and `crm.tag` relation mocks. Not a
      hand-trimmed arch — the real arch verbatim.
    - Mobile test ("spec07 board renders the card", `test.tags("mobile")`): assert a
      `CrmMobileLeadCard` exists inside a REAL rendered kanban card (not a directly-mounted
      component). This test is the removal-check anchor referenced by task 4.2 (remove the
      `KanbanRecord: CrmKanbanRecord` static-components override → this test goes red) and by
      task 1.2. Board render assertions now covered on this verbatim-arch board:
      - the partner is shown exactly ONCE — the arch partner block is hidden via SCSS
        (`display: none !important`, which beats Bootstrap `.d-flex`) and the mobile card shows
        it once;
      - a partnerless lead falls back to `contact_name` on the mobile card;
      - `expected_revenue` is formatted with the record's own currency;
      - `recurring_revenue` + `recurring_plan` are still shown ONCE (not hidden);
      - the lead `name` is shown ONCE.
    - Mobile test ("spec07 card tap surface 44px", `test.tags("mobile")`): on the REAL board,
      read `getBoundingClientRect()` (or computed `min-height`) on the card tap surface (the
      kanban `<article>` / card root, which exists only on the real board); assert its height
      >= 44. (The in-card message is text and is NOT asserted for 44px.)
    - Rely on the production registry entry; no `{ force: true }`, no hand-set flags, no
      patching of `setOffline`.
    - _Requirements: 1.4, 1.7, 10.1, 10.7, 10.8; Properties 1, 6_
  - [x] 4.1 Wire the card into the kanban record and renderer (production code)
    - Edit `crm_mobile_lead_card.xml`: add a crm kanban-record template authored as a PRIMARY
      inherit — `t-name="crm.MobileKanbanRecord" t-inherit="web.KanbanRecord"
      t-inherit-mode="primary"` — inserting `<CrmMobileLeadCard
      record="props.record" actionId="env.config.actionId"/>` as the FIRST child of the article
      via `<xpath expr="article/*[1]" position="before">` (NOT `position="inside"`, which would
      APPEND the card AFTER the arch body/footer), gated on `isSmall()`. Primary inherit so
      `web.KanbanRecord` is NOT mutated for other views. RESULTING DOM ORDER: the mobile card is
      FIRST in the article, then the (partially hidden) arch body with its footer
      priority/activity widgets.
    - Edit `crm_mobile_lead_card.js` (or a small `CrmKanbanRecord` subclass declared alongside;
      keep it inside the allowed files): `CrmKanbanRecord extends KanbanRecord`, `static
      template = "crm.MobileKanbanRecord"`, `static components = { ...super.components,
      CrmMobileLeadCard }`.
    - Edit `addons/crm/static/src/views/crm_kanban/crm_kanban_renderer.js`: register
      `CrmKanbanRecord` via a `static components` override (`KanbanRecord: CrmKanbanRecord`) so
      the whole `crm_kanban` view uses it with no change to any other view. This is the renderer
      edit's ONLY responsibility (the strip is owned by the Controller, task 8.1).
    - Edit `crm_mobile_lead_card.scss`: under a small-screen + mobile-card scope class
      (`.o_crm_mobile_card_host`), hide ONLY these duplicated arch nodes (verified arch
      `crm_lead_views.xml:525–542`):
      - the arch name node (`.fw-bold.fs-5` / the `field[name=name]` rendered element),
      - the `expected_revenue` field element INSIDE `.o_kanban_card_crm_lead_revenue` (NOT the
        whole block — hiding the block would also hide recurring revenue + plan),
      - the partner block div (`<div class="d-flex" invisible="not partner_id">`),
      - the `contact_name` field element,
      - the `partner_name` field element.
      Keep visible: `recurring_revenue` + `recurring_plan` inside
      `.o_kanban_card_crm_lead_revenue`, and the footer `priority` and
      `activity_ids`/`kanban_activity` widgets. The SCSS hide rule and the DOM order above must
      agree (mobile card first, footer widgets after).
    - _Requirements: 1.7, 10.1, 10.6, 10.7, 10.8, 10.9; Properties 1, 6_
    - SIZE GUARD note: `crm_kanban_renderer.js` and `crm_mobile_lead_card.js`/`.scss` — if the
      per-card registration or the card component pushes any one production file over ~300
      added lines, STOP and ask the user.
  - [x] 4.2 Tests + removal checks for the additive wiring
    - Edit `crm_offline.test.js`:
      - Mobile test ("spec07 lead name appears once"): on the REAL board the visible lead name
        appears exactly ONCE — arch name node hidden (`offsetParent` null / not visible),
        mobile-card name visible (visibility-aware query). For a lead WITH recurring revenue,
        assert the recurring part (`recurring_revenue` + `recurring_plan`) is still shown ONCE
        (no data lost).
      - Mobile test ("spec07 card precedes footer widgets", Fix 2): on the REAL board, assert
        the `CrmMobileLeadCard` node precedes the footer `priority`/`activity` widgets in
        document order (the mobile card renders above the arch body).
      - Mobile + offline test ("spec07 additive wiring preserves card behavior"): on the REAL
        spec07 verbatim-arch `crm_kanban` board assert REAL behavior offline — (a) the card
        menu OPENS (dropdown-toggle → Edit item visible); (b) an offline stage move through the
        kanban MODEL move path on THIS board queues the expected `crm.lead` `web_save` on lead 6
        (reuse the existing `mountCrmKanbanCapturingModel` / `selectStageInStatusbar` /
        `moveRecords` helpers already in `crm_offline.test.js`; do NOT use raw drag-and-drop,
        which is desktop-only); (c) [separate test] tapping a CACHED card opens its form via a
        `WebClient` `doAction` (Req 3.4 / 10.4); (d) the `priority` widget RENDERS in the footer
        (a readonly `<span>`, so the real offline priority write is a Step 10 deviation and is
        NOT asserted here). Real touch drag-and-drop is NOT asserted here — it is on the Step 10
        list (task 11).
      - Desktop test ("spec07 no mobile card in board on desktop"): arch card unchanged, no
        mobile card rendered.
    - Removal checks (one per wired path), each stated in the PR:
      - Remove the `KanbanRecord: CrmKanbanRecord` static-components override in
        `crm_kanban_renderer.js` → the task-4.0 "spec07 board renders the card" test goes red;
        restore.
      - Remove the SCSS hide rule (`display: none !important`) → the arch nodes become visible
        on the verbatim-arch board, so "spec07 board renders the card" (name appears once /
        partner shown once) goes red; restore.
    - Rely on the production registry entry; no `{ force: true }`, no hand-set flags, no
      patching of `setOffline`.
    - _Requirements: 1.7, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9; Properties 1, 6_

- [x] 5. CrmMobileQuickCreate sheet component
  - [x] 5.1 Create the quick-create sheet component
    - Create `addons/crm/static/src/mobile/crm_mobile_quick_create/crm_mobile_quick_create.js`,
      `crm_mobile_quick_create.xml`, `crm_mobile_quick_create.scss`.
    - JS: plain OWL 3 `Component` with `useProps({ close, groups, context, extrasBase })`; read
      `useCrmOffline()`. The sheet has NO model and NO `env.config` of its own: it does NOT read
      `model.env.config`. Fields: `name`, `contact_name` (free-text Char), `phone`,
      `email_from`, `expected_revenue`, `stage_id`. NO partner field (Property 7).
    - XML: `data-available-offline` on every input and select AND on both Create and Cancel
      buttons; the attribute stays on throughout (invalid/disabled state does not strip it).
      Stage `<select>` populated from `props.groups`: each option value = `group.serverValue`,
      label = `group.displayName`, in array order including empty and folded groups; a group
      whose `serverValue` is falsy (the "None"/no-stage group) is filtered out and yields NO
      option; disabled when no usable groups.
    - JS validation (client-side only, no round-trip): empty `name` → do nothing, mark name
      invalid, queue nothing; non-numeric `expected_revenue` → mark invalid, queue nothing;
      malformed `email_from` → mark invalid, queue nothing. A programmatically-invoked confirm
      with empty name returns without queuing.
    - JS on valid Create: queue `scheduleORM("crm.lead", "web_save", [[], VALUES],
      { context: props.context, specification: {} }, { extras: EXTRAS })` via `useCrmOffline()`,
      then `close()`. VALUES rules: TRIM the entered `name`; OMIT the empty optional fields
      `contact_name`/`phone`/`email_from`; OMIT `expected_revenue` when it was left untouched;
      and omit `stage_id` when the selector is disabled. Build EXTRAS at Create time by
      spreading `props.extrasBase` (`{ actionId, actionName, viewType }` the Controller built
      from its `env.config`) and adding `displayName` (the TRIMMED entered name, or
      `_t("New lead")`), `changes` (a plain `{field: displayValue}` object), and `timeStamp:
      Date.now()`. The sheet does NOT read `model.env.config` and does NOT call
      `getScheduleORMExtras([])` (which throws on `records[0]`).
    - SCSS: `min-width: 44px` AND `min-height: 44px` on each input, the stage select, and the
      Create and Cancel buttons (all sheet interactive controls >= 44x44).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 6.1, 6.2, 6.3,
      6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4, 8.5; Properties 2, 3, 7, 8_
    - SIZE GUARD note: `crm_mobile_quick_create.js` — if this file would grow by more than ~300
      lines, STOP and ask the user.
  - [x] 5.2 Tests for the quick-create sheet
    - Edit `crm_offline.test.js`. Mock models declare each field with production types; mock
      `root.groups` entries exposing `serverValue`, `displayName`, `isFolded`. Pass a mock
      `extrasBase` prop in the sheet tests.
    - Mobile + offline tests:
      - "spec07 sheet fields carry data-available-offline": every input/select + Create +
        Cancel carry the attribute AND are not `[disabled]` / `.o_disabled_offline`.
      - "spec07 stage selector lists groups" (mocked groups): options match
        `serverValue`/`displayName` in array order including an EMPTY stage and a FOLDED group;
        a group with a falsy `serverValue` (the "None" group) yields NO option; disabled when no
        usable groups. (The REAL grouped-kanban stage test is in task 6.1.)
      - "spec07 valid create queues one web_save": pressing Create queues EXACTLY one entry
        (assert the WHOLE queue) — `web_save` with args `[[], VALUES]`, kwargs
        `{ context, specification: {} }`; assert `specification` present (`{}`) and `context`
        carries `default_type`; assert EXTRAS spreads `extrasBase` and adds
        `displayName`/`changes`/`timeStamp`; assert no other entry.
      - "spec07 create trims name and omits empty/untouched fields": via the CAPTURED sheet
        instance, a whitespace-padded `name` is TRIMMED in VALUES and in `EXTRAS.displayName`,
        and empty optional `contact_name`/`phone`/`email_from` plus an untouched
        `expected_revenue` are OMITTED from VALUES.
      - "spec07 create includes filled optionals": a separate test asserts that filled
        `contact_name`/`phone`/`email_from`/`expected_revenue` ARE included in VALUES.
      - "spec07 empty name queues nothing": Create with empty name queues nothing (queue
        unchanged/empty) and marks the name field invalid; Create and Cancel keep
        `data-available-offline`.
      - "spec07 invalid revenue/email queues nothing": non-numeric `expected_revenue` and
        malformed `email_from` each mark the field invalid and queue nothing.
      - "spec07 programmatic confirm empty name queues nothing": call the confirm handler
        directly with empty name; assert nothing queued.
      - "spec07 sheet controls 44px": `getBoundingClientRect()` on each input, the stage select,
        and Create/Cancel >= 44 in BOTH dimensions (on the mounted sheet).
    - Removal check: this task does not wire the sheet to the New button (that is task 6, which
      owns the open-the-sheet removal checks); state that explicitly rather than writing "n/a".
      Drive connectivity through the real `setOffline` helper.
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 5.8, 5.10, 5.11, 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 8.1,
      8.2, 8.3, 8.4, 8.5; Properties 3, 8_

- [x] 6. Quick-create entry wiring
  - [x] 6.1 Override the Controller entry point and test it (with removal checks)
    - Edit `addons/crm/static/src/views/crm_kanban/crm_kanban_view.js`: in the existing CRM
      `crmKanbanView.Controller` subclass, override (for `isSmall() && isOffline()` only):
      - `get isNewButtonAvailableOffline` → return `true`.
      - `createRecord()` → build `extrasBase = { actionId, actionName, viewType }` from
        `this.env.config` (the same three fields `getScheduleORMExtras` reads from
        `model.env.config`) and open `CrmMobileQuickCreate` via `BottomSheetPlugin`
        (`usePlugin(BottomSheetPlugin)`), passing props `{ close, groups: root.groups,
        context: root.context, extrasBase }`.
      - Online or desktop: both fall through to `super` unchanged.
    - Edit `crm_offline.test.js`:
      - Mobile + offline test ("spec07 New enabled offline"): the New button is enabled.
      - Mobile + offline test ("spec07 tapping New opens the sheet"): tapping New opens the
        `CrmMobileQuickCreate` sheet (and that the sheet receives `extrasBase` + `context`).
      - Mobile + offline test ("spec07 real grouped-kanban stage selector", Fix 3): exercise the
        stage selector through the REAL offline-loaded grouped `crm_kanban` (not only mocked
        groups), opened offline (grouped), tap New, open the sheet, and assert the LITERAL
        option labels `["Start", "Middle", "Won"]` with values `["1", "2", "3"]`; a lead-less
        stage is ABSENT (the mock has no `group_expand`, so empty-stage-selectable is a Step 10
        item, not asserted here); the "None"/falsy-`serverValue` group yields NO option; and
        with an ACTIVE search filter the selector lists ONLY the in-scope (domain-scoped) stages
        as a LITERAL case (requirement 5.9).
      - Desktop/online test ("spec07 New unchanged online/desktop"): New button unchanged and
        the sheet is NOT opened.
    - Removal checks (stated in the PR):
      - Remove the `isNewButtonAvailableOffline` override → "New enabled offline" test red;
        restore.
      - Remove the `createRecord` override → "tapping New opens the sheet" test red; restore.
      - Make the sheet read stages from a hardcoded list instead of `root.groups` (via the
        passed `groups` prop) → the "real grouped-kanban stage selector" test fails; restore.
    - Rely on production wiring; no `{ force: true }`, no patched `setOffline`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.9; Property 2_
    - SIZE GUARD note: `crm_kanban_view.js` — this task plus task 8.1 both edit it; if either
      would push the file over ~300 added lines, STOP and ask the user.

- [x] 7. Systray-render guard test (Blocker 2)
  - [x] 7.1 Prove the queued create renders in the offline systray without error
    - Edit `crm_offline.test.js` (mobile + offline): drive the REAL Create path (open the
      sheet from the task-6 entry point, fill, Create), then open the offline systray; assert
      the row renders with its label (`STATUS.CREATED` / `displayName`) AND `expect.errors(0)` /
      no thrown error.
    - Removal check: drive the REAL Create path, open the systray, then remove `changes` from
      the PRODUCTION EXTRAS builder (in the sheet's `createRecord`/Create handler, NOT a
      controlled test fixture) and confirm THIS systray test goes red; restore. (The systray
      CREATE branch reads `Object.entries(extras.changes)` and `extras.displayName`.)
    - _Requirements: 7.1, 7.2, 7.3, 7.4; Property 8_

- [x] 8. Optimistic pending-create strip (Controller-owned)
  - [x] 8.1 Render the pending-create strip from the Controller and test it
    - Edit `crm_mobile_lead_card.xml`: add a PRIMARY-inherit crm template of `web.KanbanView`
      (`t-name` e.g. `crm.MobileKanbanView`, `t-inherit="web.KanbanView"
      t-inherit-mode="primary"`) that inserts a full-width
      `<div class="o_crm_mobile_pending_strip w-100">` with `position="before"` the
      `<t t-component="this.props.Renderer">` node, gated on `isSmall()`. The strip is rendered
      FROM THE CONTROLLER as a full-width element ABOVE the kanban columns (a full-width sibling
      ABOVE the renderer's flex row), NOT a kanban column and NOT a flat strip in the host
      renderer. (No new standalone template file — the strip template lives in the allowed
      `crm_mobile_lead_card.xml`.)
    - Edit `addons/crm/static/src/views/crm_kanban/crm_kanban_view.js`: set the
      `crmKanbanView.Controller` `static template` to that crm template. In the Controller,
      derive the strip's queued creates by calling `this.crmOffline.queuedWrites("crm.lead")`
      (NOT by resolving `OfflinePlugin` directly) and filtering to entries with an EMPTY
      `args[0]` id list (empty-id `web_save`) — regardless of origin (quick-create OR form view)
      and regardless of `actionId` — and render one `CrmMobileLeadCard` in queued-create mode
      per entry in the strip, gated on `isSmall()`. Resolve each entry's stage label ONLY from
      the loaded `root.groups` by matching `group.serverValue === stage_id` →
      `group.displayName` (serverValue→displayName via the `stageGroups` prop); an unmatched/
      unresolved `stage_id` shows NO stage (no fallback, never crash). Pass `parkedError =
      value.extras.error` to each queued-create card so a parked entry shows the "needs retry"
      marker and a non-parked one shows "pending sync". Guard every field read so a missing
      field renders empty. (Placing each card in its pipeline stage column is deferred to
      spec 08.)
    - Edit `crm_mobile_lead_card.js`/`.xml`: in queued-create mode, show the "pending sync"
      indicator when `parkedError` is falsy, or a translatable "needs retry" marker (derived
      from `parkedError` = `extras.error`) when the entry is parked — NO CRM-specific error UI
      or dialog; the systray stays the only error surface. Update the queued-create props to
      include the parked/error state (`parkedError`).
    - Edit `crm_offline.test.js`:
      - Mobile + offline test ("spec07 strip shows queued create"): after a queued create, a
        strip card shows the queued values (name, contact_name, revenue, stage) + "pending sync"
        indicator; assert the strip DOM node is BEFORE the columns container, spans FULL width,
        and the columns still lay out normally.
      - Mobile + offline test ("spec07 strip shows a form-path create"): a `crm.lead` `web_save`
        create queued from the FORM path (empty id list, not from the sheet) ALSO shows in the
        strip — the strip is not filtered by origin or `actionId`.
      - Mobile + offline test ("spec07 strip stage label resolution"): a queued create whose
        `stage_id` matches a `root.groups` `serverValue` shows that `displayName` (resolved via
        the `stageGroups` prop); an unmatched `stage_id` shows NO stage (no fallback) without
        crashing.
      - Mobile + offline test ("spec07 strip parked create shows needs-retry", Fix 5): a strip
        card whose queued create is PARKED (`extras.error` set) shows the translatable "needs
        retry" marker (derived from `extras.error`), NOT "pending sync", and does NOT crash
        (guarded field reads; no CRM-specific error UI/dialog). A NON-parked queued create shows
        "pending sync". The card reads `extras.error` via the hook accessor's returned
        `value.extras`.
      - Desktop test ("spec07 no strip on desktop"): no strip rendered.
    - Removal check (stated in the PR): remove the `this.crmOffline.queuedWrites("crm.lead")`
      call in the strip derivation (or make it return `[]`) in `crm_kanban_view.js` → the
      "strip shows queued create" test goes red; restore. (This is also the real wiring removal
      check for the task-0.1 hook accessor.)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9; Property 4_
    - SIZE GUARD note: `crm_kanban_view.js` (this task plus task 6.1 both edit it) — if the
      Controller file would grow by more than ~300 added lines, STOP and ask the user.

- [x] 9. Python replay test
  - [x] 9.1 New TestCrmOffline method replaying the queued create
    - Edit `addons/crm/tests/test_crm_offline.py`: add a NEW method to class `TestCrmOffline`
      (do NOT modify the pre-existing `test_offline_websave_create_replay`; do NOT create a
      second module; do NOT re-add the import in `tests/__init__.py` — already imported).
    - The method replays the exact framework shape — preferred:
      `odoo.service.model.call_kw(self.env['crm.lead'], "web_save", [[], VALUES],
      {"context": ctx, "specification": {}})`; equivalently
      `self.env['crm.lead'].browse([]).with_context(**ctx).web_save(VALUES, specification={})`
      (empty recordset `self`, `VALUES` as the FIRST positional `vals`). It is NOT
      `web_save([], VALUES, specification={})` as positionals (in a `call_kw`, `args[0]`
      becomes `self`, not a positional) and NOT `web_save({...}, {})`.
    - Run the replay for BOTH pipelines: a lead pipeline (context `default_type='lead'`) AND an
      opportunity pipeline (context `default_type='opportunity'`). In each case assert the
      resulting `crm.lead` carries the entered values, the chosen stage, AND the correct `type`
      from the pipeline context. Replay BOTH payload shapes: a FULL payload (all fields) AND a
      MINIMAL payload (`name` + `stage_id` only, mirroring the sheet's omit-empties behavior),
      asserting the minimal replay still creates a valid lead.
    - Removal check: none (pure server-side assertion).
    - _Requirements: 11.1, 11.2; Properties 3, 8_

- [x] 10. Verification
  - [x] 10.1 Run checks and report verbatim
    - Run `.kiro/scripts/check.sh quick`, then `.kiro/scripts/check.sh full`. Do not retype the
      underlying commands. Report the script's output VERBATIM.
    - All five test commands and all scope checks MUST pass. Acceptance row 5 (crm manifest
      version bumped one minor increment) is EXPECTED to fail until spec 08 — report it as an
      explicit, expected deviation. Never claim "check.sh full passes" or "all acceptance rows
      pass."
    - Time-box: a `quick` run takes ~20s; if one is still running near 2 minutes, STOP and
      report. After two `quick` runs on one issue, STOP and show the log. Do not use sub-agents
      for test-fix loops. If a run fails for an environment reason (a path, the database), say
      so rather than working around it.
    - Confirm the scope checks stay green: nothing touched outside `addons/crm/`;
      `requirements.txt`/`security/` unchanged; no new offline machinery or forbidden primitive
      names in CRM source or comments; no existing test file modified except (if needed)
      `addons/crm/tests/__init__.py`; no `only()`/`debug()` in any `.test.js`.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 11. Carry-forward record + Step 10 manual-check list (documentation/reporting only — NO source/test code)
  - [x] 11.1 Record spec-08 prerequisites and the Step 10 manual checks (PR + spec-plan.md)
    - This is a DOCUMENTATION/REPORTING task only; it writes NO source or test code. It edits
      `.kiro/steering/spec-plan.md` AND captures the same in the PR description. Editing
      `.kiro/steering/spec-plan.md` is ALLOWED: it is under `.kiro/`, which is EXEMPT from the
      `addons/crm/` write boundary. Because `.kiro/` is gitignored, the edit MUST be force-added
      with `git add -f .kiro/steering/spec-plan.md` (and again immediately before committing).
    - Edit `.kiro/steering/spec-plan.md` to record in the carry-forward (NOT marking spec 07
      merged):
      - (a) placing each pending-create card inside its pipeline STAGE COLUMN is spec 08's work
        (spec 07 renders the strip from the Controller as a full-width element ABOVE the kanban
        columns);
      - (b) the end-to-end uncached-explanation assertion through the pipeline/tour (acceptance
        row 9) is OWNED by spec 08;
      - (c) the spec-07 Step 10 manual-check list (below).
    - Capture the same carry-forward in the PR description (align with the design's Known
      limitations / carry-forward section). The spec-plan.md edit is IN ADDITION TO the PR
      description, not a substitute.
    - Step 10 manual-check list — behaviors the Hoot unit lane cannot prove, to confirm on a
      real device / installed PWA:
      - Real TOUCH drag-and-drop of a card on a phone (the harness drives the kanban model move
        path, not real touch DnD, which is desktop-only in the harness; see task 4.2).
      - Real card TAP opening the form on a device for a cached lead (requirement 3.4 / 10.4).
      - The real systray row for a queued create on a device (the unit lane asserts the row
        renders without error; the on-device appearance is manual).
      - Any item explicitly deferred from the task-4.2 real-board behavior checks that could not
        be exercised in the harness.
    - _Requirements: 9.7, 10.4; and the KL-A / row-9 carry-forward (owned by spec 08)_

- [x] 12. Pipeline-board gate (forecast leak fix)
  - [x] 12.1 Gate the mobile card/New/strip to the stage-grouped pipeline board (production + test)
    - Production: add a `_crmMobileStageBoard` getter on `crmKanbanView.Controller`
      (`crm_kanban_view.js`) that returns true only when
      `root.groupByField?.name === "stage_id"`. Gate ALL spec-07 mobile additions on it:
      `isNewButtonAvailableOffline`, `createRecord` (sheet open), and the pending-create
      `pendingCreateCards` strip derivation. Apply the SAME check in the
      `crm.MobileKanbanRecord` card-host template `t-if` (`crm_mobile_lead_card.xml`), so the
      mobile card renders only on the stage-grouped board. This prevents the mobile card / New /
      strip from leaking onto the forecast board (grouped by `date_deadline`).
      Files: `crm_kanban_view.js`, `crm_mobile_lead_card.xml`.
    - Test: "spec07 forecast board has no mobile card/New/strip" (`test.tags("mobile")`):
      mount the `forecast_kanban` grouped by `date_deadline` offline and assert NO
      `CrmMobileLeadCard` renders, tapping New opens NO sheet, and NO pending-create strip is
      rendered.
    - Removal check (run, confirmed): force `_crmMobileStageBoard` to return `true` → the
      "spec07 forecast board has no mobile card/New/strip" test goes red; restore.
    - _Requirements: 1.7, 4.1, 9.1, 10.1; Properties 1, 2, 4, 6_
    - SIZE GUARD note: `crm_kanban_view.js` — this task plus tasks 6.1/8.1 all edit it; if the
      Controller file would grow by more than ~300 added lines, STOP and ask the user.

## Notes

- This workflow produces planning artifacts only; it does not implement the feature. Begin
  execution by opening `tasks.md` and clicking "Start task" next to a task item.
- Each task names the exact files it creates/edits, the specific test(s) it adds, the removal
  check for each production-wiring path, and the requirement/AC and design Property it
  satisfies.
- No optional property-based-test tasks are generated: the repo has no approved property-
  testing facility, and adding one would violate the no-new-dependencies constraint. Design
  Correctness Properties are discharged by the deterministic unit/integration tests above.
- Paired desktop/mobile JS tests use `test.tags(...)`; desktop tests prove the mobile card/
  sheet/strip/message are NOT rendered. New mobile components are tested in the mobile preset.
  Mock models declare each field with the SAME type as production.
- Size guard (Item 9): the ~300-line guard applies to the PRODUCTION source files
  (`crm_offline_hooks.js`, `crm_kanban_renderer.js`, `crm_kanban_view.js`, and the new
  component `.js` files). If any such file would grow by more than ~300 added lines, STOP and
  ask the user. It does NOT apply to `crm_offline.test.js`, whose growth is reported in the PR
  but is not a stop condition.
- Open-question rule: if any task concludes a NEW file (beyond the two allowed component
  directories) is needed, STOP and raise it with the user — do not create it.
