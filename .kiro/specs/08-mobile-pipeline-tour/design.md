# Spec 08 — Mobile pipeline view + wiring + tour + version bump — Design

Last spec of 8. Covers PART 4 items 1 and 5, the browser tour, the manifest
version bump `1.9` → `1.10`, acceptance rows 5, 6, 10, 12, 14, and the two
spec-07 carry-forwards (pending-create cards into the stage column; row 9 in-card
uncached message asserted through the pipeline — spec 08 owns row 9 end-to-end).

Branch `kiro/08-mobile-pipeline-tour`, cut from `kiro/00-setup` at `294c162`
(spec 07 merged there as PR #10). Base SHA for check.sh is `ee8c13e` (20.0).

## Facts (read from the tree; file:line)

- F1. Two `crm_kanban` kanban views: the mobile leads kanban
  `view_crm_lead_kanban` (`class="o_kanban_mobile" js_class="crm_kanban"`,
  crm_lead_views.xml:360-384) and the pipeline/opportunity kanban
  `crm_case_kanban_view_leads` (`default_group_by="stage_id"`,
  `on_create="quick_create"`, `js_class="crm_kanban"`, with the progressbar
  `sum_field="expected_revenue" recurring_revenue_sum_field="recurring_revenue_monthly"`,
  crm_lead_views.xml:504-566). Both resolve the `crm_kanban` view in the registry.
- F2. `crmKanbanView` is registered `registry.category("views").add("crm_kanban", ...)`
  (crm_kanban_view.js:168). Its Controller `static template = "crm.MobileKanbanView"`
  (a primary inherit of `web.KanbanView`, the spec-07 strip; crm_kanban_view.js:21).
  Model `CrmKanbanModel`, Renderer `CrmKanbanRenderer`, SearchModel `CrmSearchModel`
  (crm_kanban_view.js:160-166). The single kanban model/arch parser/search model.
- F3. `CrmKanbanRenderer extends RottingKanbanRenderer` registers
  `KanbanRecord: CrmKanbanRecord` (crm_kanban_renderer.js:16-19). `CrmKanbanRecord`
  is `web.KanbanRecord` subclass with `static template = "crm.MobileKanbanRecord"`
  (crm_mobile_lead_card.js:191-199) that injects a `CrmMobileLeadCard` as the first
  child of the article when `isSmall()` and the board is grouped by stage_id
  (crm_mobile_lead_card.xml:42-48).
- F4. Base `web.KanbanRenderer` template: a `.o_kanban_renderer.d-flex` row that
  `t-foreach="this.getGroupsOrRecords()"` renders each group as a
  `.o_kanban_group` column; records via `<KanbanRecord>` (kanban_renderer.xml:4-46).
  Group header via `KanbanHeader` component; a group's records are `group.list.records`.
- F5. Base `web.KanbanView` controller template renders
  `<t t-component="this.props.Renderer" t-if="this.model.isReady()">`, and
  `<t t-elif="this.model.couldNotLoadRootOffline"><OfflineActionHelper/></t>`
  (kanban_controller.xml:81-99). The spec-07 strip inherits this template and
  inserts `.o_crm_mobile_pending_strip` BEFORE the Renderer node
  (crm_mobile_lead_card.xml:62-70).
- F6. The Controller already exposes `_crmMobileStageBoard`
  (`model.root.groupByField?.name === "stage_id"`, crm_kanban_view.js:56-58),
  `pendingCreateCards` (empty-id `web_save` entries read through
  `crmOffline.queuedWrites("crm.lead")`, each `{ key, values, parkedError }`,
  crm_kanban_view.js:112-146), and `pendingStageGroups`
  (`root.groups` → `{ serverValue, displayName }`, crm_kanban_view.js:152-159).
- F7. `OfflineActionHelper` (template `web.OfflineActionHelper`,
  offline_action_helper.js:4-20) reads `env.config.{actionId,viewType}` and
  `env.searchModel`; renders `.o_view_nocontent` with a reset-to-cached-search
  action. The kanban controller renders it when `couldNotLoadRootOffline`.
- F8. `kanban_record.js:158-165`: offline, a record whose form is not available
  offline (`isAvailableOffline(actionId, "form", resId)` false and not sample)
  gets `o_disabled_offline`, so its tap target is disabled. The in-card uncached
  message is card STATE, shown by `CrmMobileLeadCard.showUncachedMessage`
  (`isSmall() && isOffline() && resId && !isAvailableOffline(actionId,"form",resId)`,
  crm_mobile_lead_card.js:140-152).
- F9. `useCrmOffline()` exposes `isOffline/isSmall/isAvailableOffline/scheduleORM/
  hasQueuedWrite/queuedWrites` over `OfflinePlugin`+`UIPlugin`
  (crm_offline_hooks.js). The only CRM reader of the queue signal.
- F10. Manifest `'version': '1.9'` (__manifest__.py:9); asset globs
  `web.assets_backend: 'crm/static/src/**'`, `web.assets_tests:
  'crm/static/tests/tours/**/*'`, `web.assets_unit_tests: 'crm/static/tests/**/*.test.js'`
  (__manifest__.py:76-116). New files under those trees need NO new glob.
- F11. HttpCase viewport: `browser_size` (default `'1366x768'`) and
  `touch_enabled` (default False) are CLASS attributes read when the browser
  starts (odoo/tests/common.py:1675, 2607). Repo precedent for a mobile tour is a
  DEDICATED class with `browser_size = '375x667'` + `touch_enabled = True`
  (e.g. mrp/tests/test_bom.py:3143-3145 `TestMrpMobileTour`,
  website_livechat/tests/test_livechat_basic_flow.py:455). `self.start_tour(url, name, login=...)`
  (crm/tests/test_crm_ui.py:17) launches a registered tour.
- F12. `test_crm_offline.py` has `TestCrmOffline(HttpCase, TestCrmCommon)`
  (tagged `post_install, -at_install`). It is imported in tests/__init__.py.
  JS mock: `Spec04Lead` (models.Model, crm.lead) with every production card field;
  `_records` leads 1/6/9 in stages 1/2/3; `_views` incl `kanban,false`/`form,false`.
  `mountSpec07Board()` mounts the REAL crm_kanban grouped by stage_id with the
  verbatim card arch; `setOffline`, `spec07ScheduleStripCreate` helpers exist
  (crm_offline.test.js).

## Decisions

- D1. **Branch base.** Seed said cut from `kiro/00-setup`; it was stale locally.
  Fast-forwarded to origin `294c162` (spec 07 merged, PR #10) and cut from there,
  as the user confirmed. Recorded; spec-plan.md updated to mark 07 merged.
- D2. **No second kanban model.** The mobile pipeline is a PRESENTATION layer over
  the existing `crm_kanban` model/arch parser/search model. It is a component
  (`CrmMobilePipeline`) the `CrmKanbanRenderer` renders INSTEAD of the horizontal
  column row, via a primary-inherit of `web.KanbanRenderer`
  (`crm.MobilePipelineRenderer`), gated on `isSmall() && _stageBoard`. Online or
  desktop → the base column row renders unchanged (F4). This satisfies "reuse the
  model/arch parser/search model; do not define a second kanban model" and "extend
  the existing mobile arch" (the arch stays `view_crm_lead_kanban`; no parallel
  view record).
- D3. **Mobile view arch.** `view_crm_lead_kanban` already carries
  `class="o_kanban_mobile" js_class="crm_kanban"` (F1). The pipeline activates
  through that js_class on the small-screen signal — no new/parallel view record.
  The "new view registered + referenced by js_class" wiring item is met by the
  existing `crm_kanban` registration (F2) + the js_class on the lead kanban views;
  a test asserts the registry entry drives the pipeline and that the arch is mobile.
- D4. **One stage at a time.** `CrmMobilePipeline` keeps a reactive `index` into
  `list.groups`. It renders a fixed header (`.o_crm_mobile_pipeline_header`: stage
  `displayName`, lead `count`, formatted revenue sum) and ONE column body
  (`.o_crm_mobile_pipeline_stage`) spanning the viewport width, with prev/next
  buttons (`.o_crm_mobile_pipeline_prev/next`) disabled at the ends. Records in the
  current group render through the existing `KanbanRecord` component (→
  CrmKanbanRecord → mobile card, F3), so the card/tap/drag wiring is reused.
- D5. **Revenue sum.** Read from the group's progressbar aggregate the same field
  the arch declares (`expected_revenue`, F1). `list.groups[i]` exposes
  `aggregates`/`count`; the header reads the group's own count and the summed
  `expected_revenue` aggregate, formatted with `formatMonetary` using the group's
  currency when resolvable, else plain (mirrors the card's revenue getter). Guarded:
  a missing aggregate renders `0`-free empty, never throws.
- D6. **Pending-create cards into the stage column (carry-forward a).** The strip
  moves OUT of the Controller's `crm.MobileKanbanView` inherit (removed) and INTO
  the pipeline: `CrmMobilePipeline` renders the Controller's `pendingCreateCards`
  (passed as a prop) whose `values.stage_id` matches the CURRENT stage's
  `serverValue` INSIDE that stage column, above the real records. A pending create
  with no `stage_id`, or one whose stage isn't the current column, is shown in the
  FIRST (default) stage column so it is never lost. Each renders a
  `CrmMobileLeadCard` in queued-create mode (existing). Desktop/online: no pending
  cards (the base column row renders; the Controller getter already returns `[]`
  off the stage board / desktop, F6).
- D7. **Uncached stage → OfflineActionHelper (rows 9/9-e2e).** When offline and a
  stage body cannot be shown because the view/search was not cached, the pipeline
  renders `OfflineActionHelper` in the stage body region instead of an empty
  column. Reuses the framework component (F7) — no CRM nocontent UI. Row 9's
  end-to-end proof: a mounted pipeline, offline, for an uncached lead/stage shows
  the helper (or, for a tapped uncached lead, the in-card message F8). The tour
  does not force an uncached state (it loads online first); the uncached assertion
  is a JS pipeline test (lane 2) which is where the brief maps row 9.
- D8. **Tour (lane 3, row 6).** New tour `crm_mobile_offline` in
  static/tests/tours/crm_mobile_offline.js (registry `web_tour.tours`). Steps, one
  run: load the pipeline online; open a cached lead; go offline
  (`setOffline(true)` via the offline plugin from the tour, or the connectivity
  helper the framework exposes); edit the lead and save; create a lead through the
  mobile quick-create bottom sheet; schedule an activity; mark won (no rainbowman);
  reconnect; assert each queued change drained. Launched from a DEDICATED Python
  class `TestCrmMobileOfflineTour(HttpCase, TestCrmCommon)` with
  `browser_size='375x667'` + `touch_enabled=True` (F11), appended to
  test_crm_offline.py so the mobile viewport does NOT bleed onto the other
  `TestCrmOffline` methods (seed requirement). After reconnect the Python asserts
  the server has the edited lead, the created lead, the scheduled activity, and the
  won state. Tour runs in mobile mode because the viewport is 375 wide (<768 → isSmall).
- D9. **Version bump (row 5).** `'version': '1.9'` → `'1.10'` (one minor increment,
  the only new value this spec changes besides new files). This flips acceptance
  row 5 from expected-fail (specs 03-07) to PASS; `check.sh full` acceptance block
  now passes.
- D11. **Strip vs row 11 (carry-forward a) — resolved by a marker.** Spec 07
  shipped four FROZEN mobile tests asserting the pending-create STRIP
  (`.o_crm_mobile_pending_strip`) is present with its card; row 11 forbids editing
  them. Carry-forward (a) wants the strip removed and cards in the stage column.
  Both cannot hold. Per the user's conflict rule (keep existing tests green; gate
  so old behaviour stays byte-for-byte where old tests exercise it): "pipeline
  mode" is gated on the `o_kanban_mobile` MARKER class on the arch
  (`archInfo.className`), present only on the production mobile lead kanban
  `view_crm_lead_kanban` and ABSENT from every spec-07 test arch
  (`<kanban js_class="crm_kanban">`). In pipeline mode the Controller's
  `pendingCreateCards` returns [] (strip empty) and the cards render inside their
  stage column (CrmMobilePipeline); without the marker the spec-07 strip renders
  byte-for-byte. New tests prove: pipeline mode → one card inside its column, no
  strip; no marker → strip still renders. Removal check: drop the marker gate →
  the column-placement test goes red. Fallback (if the marker proved impossible):
  render the strip `d-none` in pipeline mode and record the duplication — NOT
  needed, the marker works.
- D12. **Marker is `o_opportunity_kanban`, not `o_kanban_mobile` (brief-vs-source
  reconciliation).** The brief/constraint names `view_crm_lead_kanban`
  (`o_kanban_mobile`) as the mobile arch to extend, but source inspection shows
  that view is the LEADS kanban and is NOT stage-grouped; the actual stage
  pipeline "My Pipeline" opens is the OPPORTUNITY kanban
  `crm_case_kanban_view_leads` (`default_group_by="stage_id"`,
  `class="o_kanban_small_column o_opportunity_kanban"`, crm_lead_views.xml:504-505).
  The mobile pipeline (one stage at a time) only makes sense on a stage-grouped
  board, so the marker is `o_opportunity_kanban` (present on the real pipeline,
  absent from every spec-07 test arch). This attaches the pipeline to the board
  the user actually calls "the pipeline" and keeps the tour real. Recorded as a
  deviation from the brief's literal view name; no parallel view record is added
  (the existing `crm_case_kanban_view_leads` arch is reused via its js_class).
- D10. **Files.** New: crm_mobile_pipeline/crm_mobile_pipeline.{js,xml,scss};
  crm_mobile_pipeline.test.js; tours/crm_mobile_offline.js. Edited existing:
  crm_kanban_renderer.js (render the pipeline), crm_kanban_view.js (drop the strip
  template now the pipeline owns pending cards; pass pendingCreateCards to the
  renderer), crm_mobile_lead_card.xml (remove the `crm.MobileKanbanView` strip
  inherit), test_crm_offline.py (append tour class), __manifest__.py (version).
  No file outside addons/crm/ or .kiro/. No new glob (F10). No new dependency, no
  data-model change, no new offline machinery.

## Components

### CrmMobilePipeline (crm_mobile_pipeline.{js,xml,scss})
- Props (`useProps`): `list` (model root, required), `archInfo` (required),
  `pendingCards` (array, optional `() => []`), `openRecord` (function, optional),
  `canQuickCreate`/`quickCreateState`/`progressBarState` passthroughs as the base
  renderer passes to KanbanRecord (only what the card needs).
- `setup()`: `useCrmOffline()`; reactive `state = proxy({ index: 0 })`.
- Getters: `groups` (`list.groups || []`), `current` (`groups[index]`),
  `atStart`/`atEnd`, `headerCount`, `headerRevenue` (formatted), `currentPending`
  (pendingCards whose stage matches current serverValue, plus no-stage/unmatched
  when index===0). Navigation: `prev()/next()` clamp the index.
- Uncached body: `showOfflineHelper` getter — offline and the current group has no
  loadable records view cached. Renders `OfflineActionHelper` in the body.
- Template renders the fixed header, prev/next, the current stage body with the
  matching pending cards (queued-create mode) then `group.list.records` via
  `KanbanRecord` (static components include the renderer's record component).

### CrmKanbanRenderer (edit crm_kanban_renderer.js)
- Add `static template = "crm.MobilePipelineRenderer"` (primary inherit of
  `web.KanbanRenderer`) and `CrmMobilePipeline` + `OfflineActionHelper` to
  `static components`. The template wraps the base column `t-foreach` row in
  `t-if="not (this.crmOffline.isSmall() and this._stageBoard)"` and renders
  `<CrmMobilePipeline .../>` in the `t-else`. `setup()` adds
  `this.crmOffline = useCrmOffline()`; `_stageBoard` getter mirrors the Controller.
- Removal check: delete the `KanbanRecord: CrmKanbanRecord` / pipeline branch →
  pipeline tests go red.

### Controller (edit crm_kanban_view.js)
- Drop `static template = "crm.MobileKanbanView"` (back to the base) — the strip
  moves into the pipeline. Pass `pendingCreateCards`/`pendingStageGroups` to the
  Renderer (via a prop the renderer forwards to the pipeline). Keep
  `pendingCreateCards`/`pendingStageGroups`/`_crmMobileStageBoard` getters.

## Testing (lanes 2 + 3; row 12 both presets; row 14 coverage)

- JS (crm_mobile_pipeline.test.js), mobile preset for mobile-only behaviour,
  desktop preset for the "no pipeline on desktop" negative. Reuse `Spec04Lead`
  fixtures and `mountSpec07Board`-style mounts (F12). Tests:
  - cached stage renders offline: one stage body, header name/count/revenue sum.
  - next/prev navigates between adjacent stages; disabled at the ends.
  - exactly one stage visible at a time (others not in the DOM body).
  - pending-create card appears INSIDE its matching stage column (carry-forward a),
    and a no-stage pending create appears in the first column.
  - uncached stage/lead offline shows `OfflineActionHelper` / the in-card message
    (row 9 through the pipeline).
  - desktop: the base column row renders, NOT the pipeline (isSmall gate).
  - removal checks per wired path (renderer branch; pending prop; header revenue).
- Tour (lane 3): the single-run scenario above, asserted server-side in Python.
- Row 14: list each new mobile JS file (crm_mobile_pipeline.js) and the test(s)
  covering each path; ≥80% statements, every new path exercised. The reviewer reads
  the tests against the source (no coverage tool).

## Expected check.sh state

- `check.sh full`: all five commands pass; scope passes; acceptance row 1 (inventory)
  and row 5 (version now `1.10`) pass. Any JS test that cannot be made to pass in the
  budget is reported as an explicit deviation with its log, never faked.
