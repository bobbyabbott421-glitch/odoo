# Spec 08 — Requirements

Covers PART 4 items 1 and 5, the browser tour, the manifest version bump, and
acceptance rows 5, 6, 10, 12, 14; plus spec-07 carry-forwards (pending-create
card into its stage column; row 9 in-card uncached message through the pipeline).

## R1 — Mobile pipeline, one stage at a time (PART 4 item 1; row 12)
1.1 On a small screen, the pipeline (crm_kanban grouped by stage_id) SHALL show
exactly ONE stage at a time, its body filling the viewport width.
1.2 A fixed header SHALL show the stage name, the lead count, and the revenue sum
(summed `expected_revenue`), guarded so a missing aggregate never throws.
1.3 Horizontal navigation SHALL move to the adjacent stage (prev/next), disabled
at the first/last stage.
1.4 The pipeline SHALL reuse the existing CRM kanban model, arch parser, and search
model; it SHALL NOT define a second kanban model.
1.5 Each cached stage SHALL render offline. Desktop and online SHALL render the
existing kanban column row unchanged (gated on `isSmall()` and the stage board).

## R2 — Mobile view arch (PART 4 item 5)
2.1 The pipeline SHALL activate through the existing mobile kanban arch
`view_crm_lead_kanban` (`class="o_kanban_mobile" js_class="crm_kanban"`); NO
parallel view record SHALL be added.
2.2 The `crm_kanban` view SHALL remain registered in the view registry and
referenced by `js_class` on the lead kanban views; a test SHALL demonstrate the
registry entry drives the pipeline.

## R3 — Pending-create card in its stage column (carry-forward a; row 6/8 context)
3.1 Each queued offline create SHALL render as a `CrmMobileLeadCard` INSIDE the
stage column whose `serverValue` equals the queued `stage_id`.
3.2 A queued create with no `stage_id` (or an unresolved stage) SHALL render in the
first stage column so it is never lost.
3.3 The flat full-width strip ABOVE the columns (spec 07) SHALL be removed; the
pending cards SHALL no longer render outside a stage column.
3.4 The queued state SHALL be read through the shared hook (`queuedWrites`); no new
store, no card-owned dirty flag.

## R4 — Uncached stage/lead offline (row 9; carry-forward b — spec 08 owns row 9)
4.1 When offline and the current stage's records view/search was not cached, the
pipeline SHALL render the framework `OfflineActionHelper` in the stage body — no
empty column, no error, no CRM-specific nocontent UI.
4.2 A tapped lead that was not cached online SHALL show the in-card uncached
message (spec 07 behaviour) rather than a blank region; spec 08 SHALL assert this
through the mounted pipeline (row 9 end-to-end).

## R5 — Browser tour (PART 4 / testing lane 3; row 6)
5.1 A single-run tour `crm_mobile_offline` SHALL: load the pipeline online, open a
cached lead, go offline, edit the lead and save, create a lead through the mobile
quick-create, schedule an activity, mark the lead won (no rainbowman), reconnect.
5.2 The tour SHALL run in mobile mode via a 375x667 touch viewport.
5.3 The tour SHALL be launched from a Python HttpCase test that, after reconnect,
asserts every change reached the server (edited lead, created lead, scheduled
activity, won state).
5.4 The 375x667 / touch viewport SHALL NOT apply to the other `TestCrmOffline`
methods: the tour SHALL live in a DEDICATED Python test class.

## R6 — Version bump (row 5)
6.1 The crm manifest `version` SHALL be bumped one minor increment, `1.9` → `1.10`.
6.2 No other manifest value SHALL change (no new depends, no new asset glob except
to exclude/lazily load, matching the existing style — none needed here).

## R7 — Wiring + boundaries (rows 2, 3, 4, 10, 11, 13)
7.1 Every new file SHALL be under `addons/crm/`; the new tour and test SHALL be
picked up by the manifest's existing asset globs (verified, no new glob added).
7.2 No change outside `addons/crm/` or `.kiro/`; no requirements.txt/security
change; no new offline machinery; no new dependency; no data-model change.
7.3 Desktop online CRM SHALL behave exactly as before (rows 10, 11); no existing
test file SHALL be modified except `tests/__init__.py` (unchanged here — the tour
class is appended to the already-imported `test_crm_offline.py`).

## R8 — Coverage (row 14)
8.1 Each new mobile JS file (crm_mobile_pipeline.js) SHALL have ≥80% statement
coverage, and every new code path SHALL be exercised by a new test, demonstrated by
reading the tests against the source (no coverage tool in the repo).

## Verification
`.kiro/scripts/check.sh full` is run; all five test commands and all scope checks
pass; acceptance row 5 (version bump) NOW passes (this spec performs the bump).
Report the script output verbatim; list any unfinished item as an explicit
deviation with its log and a Step 10 entry, never faked.
