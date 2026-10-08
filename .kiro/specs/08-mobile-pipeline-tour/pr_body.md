## Spec 08 — Mobile pipeline view + wiring + tour + manifest version bump

Last of the eight specs. Covers PART 4 items 1 and 5, the browser tour, the
manifest version bump `1.9` → `1.10`, acceptance rows 5, 6, 10, 12, 14, and the
two spec-07 carry-forwards (pending-create cards into their stage column; row 9
in-card uncached explanation asserted through the pipeline — spec 08 owns row 9).

Branch cut from `kiro/00-setup` @`294c162` (spec 07 merged there, PR #10). PR
targets `kiro/00-setup`.

### Review round 1 (this update)

- **Folded stages fixed.** A folded group carries a `count` but no loaded records.
  Online: navigating to a folded stage now expands it
  (`_ensurePipelineStageExpanded` → `group.toggle()`), so its cards load. Offline:
  a folded never-loaded stage shows the framework helper (honest — its data is
  unavailable), but a stage with loaded records does not, and an empty cached
  stage (count 0) shows neither cards nor helper. Three new tests + removal checks.
- **Tour legs.** Added the **mark-won** leg (offline Won button → queued
  `action_set_won`, Won button disappears optimistically); the Python runner now
  asserts the lead is won on the server after reconnect, alongside the edit and
  the quick-create. The **activity-schedule** leg was dropped after 3 unstable
  runs (see Deviations) and kept covered by the Python replay test.
- **Stale comment fixed.** `o_kanban_mobile` → `o_opportunity_kanban` in
  `crm_kanban_view.js` (two comments) and `requirements.md` R2.1.

### What the feature does

- **Mobile pipeline** (`crm_mobile_pipeline/`): one stage at a time, full width,
  with a fixed header (stage name, lead count, `expected_revenue` sum) and
  prev/next navigation. A presentation layer over the existing `crm_kanban`
  model / arch parser / search model — **no second kanban model**. Rendered by
  `CrmKanbanRenderer` via a primary inherit of `web.KanbanRenderer`, gated on
  `isSmall()` + a stage board + the `o_opportunity_kanban` arch marker.
- **Pending-create cards in their stage column** (carry-forward a): in pipeline
  mode each queued offline create renders inside the column whose `stage_id`
  matches (no-stage/unmatched → first column). The spec-07 flat strip is
  **suppressed only in pipeline mode** via the marker, so the four frozen spec-07
  strip tests stay byte-for-byte green.
- **Uncached / folded stage offline** (row 9): the pipeline renders the framework
  `OfflineActionHelper` in the stage body instead of an empty column.
- **Browser tour** `crm_mobile_offline` on a 375x667 touch viewport from a
  dedicated `TestCrmMobileOfflineTour` class — load the pipeline online, open a
  cached lead, go offline, edit + save, mark won, quick-create a lead, reconnect;
  Python asserts the edit, mark-won, and create all reached the server.
- **Version bump** (row 5): crm manifest `1.9` → `1.10`.

### Per-file line counts (vs branch point `kiro/00-setup`)

New files:
- `crm_mobile_pipeline/crm_mobile_pipeline.js` — 87
- `crm_mobile_pipeline/crm_mobile_pipeline.xml` — 229
- `crm_mobile_pipeline/crm_mobile_pipeline.scss` — 42
- `static/tests/crm_mobile_pipeline.test.js` — 587
- `static/tests/tours/crm_mobile_offline.js` — 146

Modified files (net vs branch point):
- `__manifest__.py` — +1/-1 (version)
- `static/src/views/crm_kanban/crm_kanban_renderer.js` — +214 (pipeline branch,
  index state, folded-stage expansion, pending-card derivation, uncached-helper)
- `static/src/views/crm_kanban/crm_kanban_view.js` — +39 (`_crmMobilePipelineMode`
  marker gate; strip suppressed in pipeline mode)
- `static/src/mobile/crm_mobile_lead_card/crm_mobile_lead_card.xml` — +7/-3
  (comment only; the spec-07 strip template is byte-for-byte)
- `tests/test_crm_offline.py` — +71 (the `TestCrmMobileOfflineTour` class)

No production file grew by more than ~300 lines. No file outside `addons/crm/` or
`.kiro/`. No new dependency, offline machinery, data-model change, or asset glob.

### Decisions

- **D11 — strip vs row 11, resolved by a marker.** Spec 07 shipped four frozen
  mobile tests asserting the pending-create strip is present; row 11 forbids
  editing them. "Pipeline mode" is gated on an arch MARKER class the spec-07 test
  arches do not carry; in pipeline mode the strip is suppressed and cards render
  in the column, without the marker the spec-07 strip renders byte-for-byte. New
  tests prove both sides.
- **D12 — the marker is `o_opportunity_kanban`, not `o_kanban_mobile`.** The brief
  names `view_crm_lead_kanban` (`o_kanban_mobile`), but that is the LEADS kanban
  and is not stage-grouped. The actual stage pipeline "My Pipeline" opens is
  `crm_case_kanban_view_leads` (`default_group_by="stage_id"`,
  `class="... o_opportunity_kanban"`). The pipeline only makes sense on a
  stage-grouped board, so the marker is `o_opportunity_kanban`. Recorded as a
  brief-vs-source deviation. No parallel view record is added.

### Removal-check table (each fails with its wiring removed)

| Wired path | Test that goes red if removed |
|---|---|
| Pipeline branch / `_mobilePipelineActive` | `registry crm_kanban drives the pipeline`; `pipeline renders one stage ...` |
| `KanbanRecord: CrmKanbanRecord` | records vanish from the stage column |
| `currentPendingCards` (column placement) | `pending create renders inside its matching stage column` |
| Marker gate (`o_opportunity_kanban`) | `plain (unmarked) arch still renders the spec-07 strip` |
| `showPipelineOfflineHelper` branch | `uncached stage shows the offline action helper`; `folded never-loaded stage shows the helper` |
| `_ensurePipelineStageExpanded()` in `pipelineNext` | `folded stage expands on navigation and shows its cards` |
| `count > 0` guard in `showPipelineOfflineHelper` | `empty cached stage shows neither cards nor helper` |
| Nav guards / empty-group defaults | `pipeline guard branches: end-of-range nav + empty groups` |

### check.sh full — all green (round-1 re-run)

```
Scope 1-5: PASS
Acceptance row 1 (inventory): PASS
Acceptance row 5 (version 1.9 -> 1.10): PASS
Command 1 (crm Python, fresh db): 0 failed, 0 error(s) of 148 tests — PASS
Command 2 (TestCrmOffline): 0 failed, 0 error(s) of 8 tests — PASS
Command 3 (JS unit desktop): PASS
Command 4 (JS unit mobile): 180 Hoot tests passed — PASS
Command 5 (forbidden-statement guard): PASS
ALL CHECKS PASSED
```

### Deviations (honest, rebuilt from what is true)

- **Tour omits the activity-schedule leg of row 6.** The offline schedule control
  is gated on the online activity-type prefetch having cached non-meeting types
  into the many2x cache (KL-C: a session-scoped allow-list). That caching is not
  reliably ready within the single-run tour's timing; after 3 runs the schedule
  step could not be made stable, so it was dropped rather than weaken the rest of
  the tour. Offline activity scheduling is proven by the Python replay test
  `test_offline_activity_schedule_replay` and the spec-06 JS lane. The edit,
  mark-won, and quick-create legs ARE exercised end to end in the tour.
- **Marker is `o_opportunity_kanban`** rather than the brief's literal
  `view_crm_lead_kanban`/`o_kanban_mobile` (D12).
- **Row 9 is asserted through the mounted pipeline (JS lane 2)**, where the brief
  maps it; the tour loads online first and never hits an uncached stage. The
  uncached-stage and folded-stage helper paths are unit-proven.
- **Connectivity in the tour** is toggled by calling `setOffline` on the real
  `OfflinePlugin` reached through the prototype of
  `odoo.__WOWL_DEBUG__.root.env.services.offline` (test-only; production
  components use the plugin API).

### Step-10 manual-check list (spec 08)

- Real touch swipe/drag between stages on a device (unit lane uses prev/next).
- The activity-schedule leg end to end on a device (dropped from the tour; see
  Deviations).
- Row 9 end to end on a device: open an uncached/folded lead/stage offline and
  confirm the `OfflineActionHelper` / in-card message shows (unit-proven, device
  unconfirmed).
- The real offline systray row for the tour's queued create/edit/won on a device.

Do not merge — opening for review.
