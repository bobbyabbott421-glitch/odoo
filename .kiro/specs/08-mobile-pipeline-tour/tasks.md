# Spec 08 — Tasks

Priority order from the seed. Each task lists files, the test, and the removal
check. Do NOT tick a task while its test is red.

## 1. Version bump + manifest (R6; row 5)
- [x] 1.1 Bump `'version': '1.9'` → `'1.10'` in addons/crm/__manifest__.py.
  - Files: __manifest__.py.
  - Test: `check.sh full` acceptance "row 5" (base 1.9 → now 1.10) PASS.
  - Removal check: n/a (single-value change; the acceptance block proves it).

## 2. Mobile pipeline component + arch wiring (R1, R2, R5-arch; rows 1,12)
- [x] 2.1 Create crm_mobile_pipeline.{js,xml,scss}: one-stage-at-a-time body,
  fixed header (name/count/revenue sum), prev/next navigation, records via the
  renderer's KanbanRecord. `useProps`, controlled index (held in the renderer).
  - Files: crm_mobile_pipeline/crm_mobile_pipeline.js, .xml, .scss.
- [x] 2.2 Wire into CrmKanbanRenderer: `static template = "crm.MobilePipelineRenderer"`
  (primary inherit of web.KanbanRenderer) + components; render `<CrmMobilePipeline>`
  when `isSmall() && _stageBoard`, else the base column row. Pass pending cards.
  - Files: crm_kanban_renderer.js; crm_kanban_view.js (pass pendingCreateCards /
    pendingStageGroups to the Renderer; drop `crm.MobileKanbanView` template).
  - Test: "pipeline renders one cached stage offline (mobile)";
    "navigates adjacent stages, disabled at ends (mobile)";
    "exactly one stage body visible (mobile)";
    "no pipeline on desktop — base columns render (desktop)";
    "registry crm_kanban drives the pipeline (mobile)" (R2.2).
  - Removal check: remove the pipeline branch (render base columns always) →
    the mobile pipeline tests go red; restore. Remove the `KanbanRecord` →
    cards vanish inside the stage.

## 3. Pending-create card inside its stage column (R3; carry-forward a)
- [x] 3.1 Pending-create cards render INSIDE their stage column in pipeline mode
  (renderer `currentPendingCards`); no-stage/unmatched in the first column. The
  spec-07 strip is NOT removed — it is suppressed only in pipeline mode (the
  `o_opportunity_kanban` marker, D11/D12), so the four frozen spec-07 strip tests
  stay byte-for-byte green. The pipeline derives its own pending cards via the
  hook; the Controller's `pendingCreateCards` returns [] in pipeline mode.
  - Files: crm_mobile_pipeline.js/.xml; crm_kanban_renderer.js; crm_kanban_view.js
    (pipeline-mode suppression). crm_mobile_lead_card.xml strip template kept.
  - Test: "pending create renders inside its matching stage column (mobile)";
    "no-stage pending create renders in the first column (mobile)";
    "no flat strip above the columns (mobile)".
  - Removal check: make the pipeline ignore `pendingCards` → the two placement
    tests go red; restore.

## 4. Browser tour + Python runner (R5; row 6)
- [x] 4.1 Create tours/crm_mobile_offline.js: one run — load pipeline online, open
  a cached lead, go offline, edit+save, quick-create a lead, reconnect, drain.
  DEVIATION: the activity-schedule and mark-won legs of row 6 are NOT in the tour
  (they risk the single-run tour); they are proven by the existing Python replay
  tests (test_offline_activity_schedule_replay / test_offline_action_set_won_marks_
  lead_won) and the spec-04/06 JS lanes, and listed as Step-10 manual checks.
  - Files: tours/crm_mobile_offline.js.
- [x] 4.2 Append `TestCrmMobileOfflineTour(HttpCase, TestCrmCommon)` to
  test_crm_offline.py with `browser_size='375x667'`, `touch_enabled=True`,
  `start_tour('/odoo', 'crm_mobile_offline', ...)`; after reconnect assert the
  server state (edited lead, created lead, scheduled activity, won).
  - Files: test_crm_offline.py (append a NEW class; tests/__init__.py unchanged —
    the module is already imported).
  - Test: `check.sh full` command 1 (`/crm`) runs the tour class and passes.
  - Removal check: n/a for the tour itself; the dedicated-class requirement (R5.4)
    is proven by the other TestCrmOffline methods keeping the default viewport.

## 5. Coverage sweep (R8; row 14)
- [x] 5.1 Per-file coverage table (crm_mobile_pipeline.js — the only new mobile
  JS file). Every getter/method is exercised:
  - current / stageName / leadCount / revenueSum / countLabel →
    "pipeline renders one stage with header name/count/revenue"; guarded defaults
    (empty groups) → "pipeline guard branches".
  - atStart / atEnd / onPrev / onNext (both the active path and the end-of-range
    guard early-return) → "pipeline navigates adjacent stages" + "pipeline guard
    branches". ≥80% statements, every path exercised. (The renderer-side pipeline
    logic lives in the EXISTING crm_kanban_renderer.js — not a new mobile file —
    and is covered by the board tests + removal checks.)

## 6. Row 9 end-to-end through the pipeline (R4; carry-forward b)
- [x] 6.1 Uncached stage through the mounted pipeline: offline, an uncached stage
  body (count>0, no loaded records) shows `OfflineActionHelper` (renderer
  `showPipelineOfflineHelper`). Test: "uncached stage shows the offline action
  helper (mobile)". The in-card uncached-lead message (spec-07 CrmMobileLeadCard)
  renders inside the pipeline column (same card component), proven by the spec-07
  card tests; the pipeline helper is the pipeline-level proof of row 9.
  DEVIATION: row 9's helper is asserted through the mounted pipeline (JS lane 2,
  where the brief maps row 9), NOT through the browser tour — the tour loads
  online first so it never hits an uncached stage. Recorded as a Step-10 item.

## 7. PR #11 review round 1 (folded stages, tour legs, stale comment)
- [x] 7.1 Folded stages: online navigation expands a folded stage
  (`_ensurePipelineStageExpanded` → `group.toggle()`); offline a folded
  never-loaded stage shows the helper; an empty cached stage (count 0) shows
  neither. Tests: `folded stage expands on navigation ...`,
  `folded never-loaded stage shows the helper ...`,
  `empty cached stage shows neither cards nor helper`. Removal checks in the PR.
- [x] 7.2 Tour legs: added mark-won offline (queued `action_set_won`, Won button
  disappears optimistically) and assert won on the server after reconnect. The
  activity-schedule leg was dropped after 3 unstable runs (KL-C prefetch/cache
  timing) and recorded as a deviation; the Python replay test still proves it.
- [x] 7.3 Fixed the stale `o_kanban_mobile` comments in crm_kanban_view.js and the
  stale R2.1 wording in requirements.md (marker is `o_opportunity_kanban`).

## Finish
- [x] F1. `check.sh full` — ALL CHECKS PASSED (round 1 re-run); row 5 PASS.
- [ ] F2. Update spec-plan.md (spec 07 merged PR #10 294c162; spec 08 implemented).
  `git add -f` every `.kiro/` file. Commit, push, open PR against kiro/00-setup.
  PR body: per-file line counts, removal-check table, decisions, deviations, Step
  10 list, check.sh output. Do not merge.
