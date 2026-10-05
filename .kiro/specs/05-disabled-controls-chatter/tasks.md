# Implementation Plan

## Overview

Fix six CRM controls plus the `<a type=...>` controls, the activity-report row click, and
the share target so they are honest offline (PART 2 items 3–8), proving acceptance row 7 by
paired desktop/mobile tests. Bugfix workflow: observe each bug-condition on unfixed code,
write AC tests, apply the minimal fix inside `addons/crm/`, re-run. No property-based tests.
AC IDs below reference bugfix.md "Expected Behavior (Correct)".

Allowed files (the only files any task may touch; NO new files):
- `addons/crm/static/src/components/team_switcher/team_switcher.js`
- `addons/crm/static/src/components/lead_generation_dropdown/lead_generation_dropdown.js`
- `addons/crm/static/src/views/crm_kanban/crm_column_progress.js` and `.xml`
- `addons/crm/static/src/views/crm_form/crm_pls_tooltip_button.js`
- `addons/crm/static/src/activity_menu_patch.js`
- `addons/crm/static/src/views/crm_form/crm_form.js` (register `Renderer`; house
  `CrmFormRenderer` and `CrmChatter` here)
- `addons/crm/static/src/webclient/share_target/crm_share_target_item.js`
- the file(s) for the `<a type=...>` fix (Fix 7) — inside `addons/crm/`, chosen by the
  task-1 proposal AFTER user confirmation; must leave online rendering unchanged (row 10)
- `addons/crm/static/tests/crm_offline.test.js` (append only)

This spec adds no Python test; `addons/crm/tests/__init__.py` is NOT touched.

Testing conventions (design.md "Testing Strategy"): `defineMailModels()`; connectivity via
the existing `setOffline(...)` helper, `mockOffline()` only where RPCs must fail; `onRpc`
spies; paired `test.tags("desktop")`/`test.tags("mobile")`; assert what the user sees;
reconnect tests assert the UI appears with no other action; ≥80% statement coverage on new
JS; never `only()`/`debug()`.

## Tasks

- [x] 1. Observe bug-conditions on UNFIXED code AND produce the Fix 7 proposal (DONE; decisions taken: 7a guard, 7b KL-1, 7c share guard, chatter KL-2)
  - [x] 1.1 Observe (development only, not kept): team-switcher offline mount issues hasGroup;
        lead-gen offline toggleDropdown issues the two probes; column-progress offline mount
        issues hasGroup and a `{}` aggregate still shows a bare "MRR" label at zero;
        PLS programmatic click issues save/recompute/load; activity-menu crm.lead entry issues
        loadAction/doAction; chatter cached-lead open offline → unhandled rejection.
  - [x] 1.2 For ONE real control per `<a type=...>` surface (crm_lead_views.xml:90/:140;
        a crm_team_views.xml dashboard link; utm_campaign_views.xml:19) and the activity-report
        row click (crm_activity_report_views.xml:31): observe what clicking does offline on
        unfixed code (it is NOT framework-disabled). For the share target
        (crm_share_target_item.js:19): observe the offline `webSearchRead`.
  - [x] 1.3 Write the Fix 7 proposal as a per-surface table with the NINE columns in
        design.md Fix 7 (control; view+model; arch-owning addon; click handler today; crm
        js_class present?; offline block seam; JS-driven disabled look; online unchanged;
        global-patch flag). Leave online rendering unchanged (row 10). Share target: guard or
        report un-runnable. **Get the user's confirmation BEFORE coding tasks 8–9.**
  - [x] 1.4 Report the chatter dropzone caveat (design.md DROPZONE CAVEAT): confirm whether an
        offline drop on an UNSAVED lead can be made to do nothing at all (no `saveRecord()`,
        no upload) from `CrmChatter` without a global patch; if not, surface it to the user
        BEFORE coding task 7.
  - **EXPECTED**: 1.1/1.2 observations fail on unfixed code (proves the bugs); 1.3/1.4 are
        written proposals, not code.

- [x] 2. Team switcher (AC-TS-1..4, U3)
  - [x] 2.1 Reactive `isSaleManager`; gate probe offline; `onClickManageTeams` offline guard;
        `useOnChange({ initialRun:false })` reconnect re-probe with `status(this)` check.
  - [x] 2.2 Tests T-TS-skip, T-TS-disable, T-TS-facet: offline no probe RPC, trigger disabled,
        facet shows selected team, programmatic Manage Teams inert, `get_team_switcher_data`
        no raise; reconnect → Manage Teams appears with no other action; online probe issued.

- [x] 3. Lead-generation dropdown (AC-LG-1..2)
  - [x] 3.1 `toggleDropdown`: offline return as the FIRST statement (before
        `dropdownWasAlreadyOpened`); guard install confirm, `redirectToImport`, `requestAccess`.
  - [x] 3.2 Tests T-LG-probe, T-LG-nav: offline the Generate button is framework-disabled and
        the REAL `alt+c` hotkey chord issues no module-state probe; direct nav handlers issue
        nothing; **alt+c offline then reconnect + alt+c → probe issued and items render**;
        online the probe is issued. (The `checkAccessRight` branch is a defensive guard —
        no shipped element carries `model` — so it is not exercised and has no spy.)

- [x] 4. Recurring-revenue aggregate (AC-RR-1..3)
  - [x] 4.1 Reactive `showRecurringRevenue`; gate probe offline; add `displayRecurringRevenue`
        getter (false while offline); swap the block `t-if` in `crm_column_progress.xml` to it;
        `getRecurringRevenueGroupAggregate` returns `{}` when not displaying; reconnect re-probe.
  - [x] 4.2 Tests T-RR: offline no probe RPC, with a ZERO standard aggregate the "MRR" label is
        ABSENT and the standard zero still shows; reconnect → MRR value appears with no other
        action; online probe issued.

- [x] 5. PLS tooltip button (AC-PLS-1..3)
  - [x] 5.1 Offline early-return guard in `onClickPlsTooltipButton`.
  - [x] 5.2 Tests T-PLS: offline button disabled, click + Enter issue no RPC, programmatic call
        issues no save/recompute/load; online saves/recomputes/reloads and opens the tooltip.

- [x] 6. Activity menu (AC-AM-1..2, U4)
  - [x] 6.1 `setup()` with `useCrmOffline`; return at the top of the `crm.lead` branch offline,
        before `dropdown.close()`; no template change, no notification.
  - [x] 6.2 Tests T-AM: offline crm.lead entry + Late/Today/Future (click/middle/new-window)
        load/navigate nothing and raise nothing; another model's entry still opens; online
        crm.lead opens my-activities.

- [x] 7. Chatter (AC-CH-1..4, U5)
  - [x] 7.1 In `crm_form.js`: `CrmFormRenderer` (sets `mailComponents.Chatter = CrmChatter`)
        registered as `crm_form` `Renderer`; `CrmChatter` overrides `load` (skip offline, mark
        skipped), `toggleComposer` (close offline) + a `useOnChange` close on going offline,
        wraps `attachmentUploader.uploadFile` (no-op offline) for the dropzone, and a
        `useOnChange({ initialRun:false })` reconnect `load`. Unsaved-lead drop is KL-2 (one
        ordinary create queued, no upload) — not blocked, by design.
  - [x] 7.2 Tests T-CH: the DESKTOP test opens the lead ONLINE (messages load) → set offline →
        REOPEN lead: cached messages shown, no unhandled rejection, composer closed and Enter
        posts nothing; SAVED-lead drop → no upload and no queue entry; UNSAVED-lead drop →
        exactly one create queued and no upload, no error (KL-2); Send/Log disabled; reconnect
        → thread data/messages load. DRAFT PRESERVATION (AC-CH-2) is asserted only by the MOBILE
        mounted-instance variant (KL-4): it types a DRAFT into the composer before going
        offline and asserts the draft is still present when the composer reopens on reconnect.
        Plus an online test that the uploader wrap DELEGATES to the original uploader online
        (no-op only offline), and an online test that another model's chatter is unchanged.

- [x] 8. `<a type=...>` controls + activity-report row click
  - [x] 8.1 GUARD the lead-form automated-probability link (Fix 7a): in
        `CrmFormController.beforeExecuteActionButton`, offline AND
        `name === "action_set_automated_probability"` → `return false` (no RPC, no queue, no
        nav, no visual change). Online unchanged.
  - [x] 8.2 Test T-A-lead (paired): offline click → no RPC and no queue entry; online works.
  - [x] 8.3 KNOWN LIMITATION tests (KL-1; no code — these controls are intentionally not
        guarded). The real foreign-owned controls cannot be mounted from a crm-owned test
        without a js_class on a foreign view, so these run on REPLICA arches: T-A-known
        (`<a type=object>`), T-A-action (`<a type=action>`), T-A-rowclick (list row-open)
        (paired): offline click → no navigation, no error dialog/notification, `_ormToSync()`
        unchanged; online → it works. (Uses `mockOffline()` so the RPC actually fails and
        `lostConnectionHandler` runs.) The replicas stand in for crm.team/utm/activity-report.

- [x] 9. Share target (Fix 7c, AC-A-2)
  - [x] 9.1 `useCrmOffline()` in `crm_share_target_item.js`; offline skip `webSearchRead` and
        render the item DISABLED (not hidden), set `_teamsProbeSkipped`; the online fetch's
        try/catch re-arms `_teamsProbeSkipped` on `ConnectionLostError` (rethrows others) and
        guards the post-await state write with `status(this)`; reconnect `useOnChange` runs
        `updateTeams` once if skipped.
  - [x] 9.2 Tests T-A-share (paired): offline no `webSearchRead` + item disabled; reconnect →
        read runs once; online → issued. T-A-share-error (paired) drives the failing +
        retrying reconnect through the PRODUCTION useOnChange on real setOffline transitions
        (flag armed via the real `onCompanyChange` offline path; only `orm.webSearchRead`
        patched). T-A-share-destroyed (paired) proves the `status(this)` guard: a deferred
        reconnect fetch resolved AFTER the component is destroyed writes no state.

- [x] 10. Framework-pass `<button>` surfaces + out-of-scope views (AC-OV-1..3)
  - [x] 10.1 Tests of the framework `<button>`-disable rule — offline disabled + no RPC;
        online enabled. ALL mount SYNTHETIC/REPLICA arches, never the production views.
        Same-model replicas (the surface's own model+js_class): T-B-leadform, T-B-leadmethods,
        T-B-meeting (crm.lead crm_form arch), T-B-team (crm.team crm_form arch), T-B-leadlist
        (crm.lead crm_list arch). Cross-model replicas (a crm.lead crm_form arch carrying a
        `<button>` named after a FOREIGN surface's method): T-B-settings-replica,
        T-B-related-replica, T-B-wizard-replica.
  - [x] 10.2 Tests T-OV-view (action_plugin.js:1308 fallback), T-OV-menu (menu_providers.js:39
        filter), T-OV-switcher (disabled view-switcher control): all PAIRED desktop+mobile.
        T-OV-switcher has a dedicated mobile variant that opens the small-screen view-switcher
        Dropdown and asserts the graph `<button>` item is disabled offline / enabled online.
        T-OV-menu's `control+k` palette is global (no small-screen gate) so it runs in both
        presets. Only T-B-leadlist remains desktop-only (KL-3: the list drops per-row
        selectors on small screens, so the header button cannot be revealed on mobile).

- [x] 11. Full verification
  - Run `.kiro/scripts/check.sh quick` then `.kiro/scripts/check.sh full`.
  - All five test commands and all scope checks pass; acceptance row 5 (version bump) is
    expected to fail until spec 08 — report it as an explicit, expected deviation.
  - Confirm no existing test file changed; `git add -f` all `.kiro/` spec artifacts.

## Notes

- Scope: PART 2 items 3–8 and acceptance row 7 (and row 10 for `<a>` online rendering). Mark-won
  (spec 04, merged) and chatter activity controls (spec 06) are out of scope; the chatter design
  notes what spec 06 will need.
- No new offline machinery, no dependency, no manifest/version change (spec 08), no
  access-rule/security change, no desktop-path change, NO new files.
- Task 1 proposal confirmed (decisions in the task-1 report). KL-1 and KL-2 are explicit
  acceptance-row-7 deviations recorded in design.md Known Limitations and the PR.
- `.kiro/` spec artifacts are git-ignored; `git add -f` them when staging/committing.

## Completion notes (final artifact)

- All tasks implemented and verified with `check.sh quick`; final `check.sh full` green
  except acceptance row 5 (manifest `1.9`, deferred to spec 08).
- Task 7 (chatter): desktop T-CH uses the real mail harness + WebClient offline reopen;
  the mobile T-CH variant is the mounted-instance form (KL-4). Expected offline
  ConnectionLostErrors are declared explicitly.
- Task 8 (`<a>` controls): the real foreign-owned controls (crm.team/utm/activity-report)
  cannot be mounted from a crm-owned test without a js_class on a foreign view; KL-1 is
  proven on replica arches by T-A-known / T-A-action / T-A-rowclick. The lead-form
  automated-probability control is guarded and tested on its real crm_form (T-A-lead).
- Task 10 (framework-pass): T-OV-view, T-OV-switcher (dedicated mobile view-switcher-dropdown
  variant) and T-OV-menu (global control+k palette) are now all PAIRED desktop+mobile. Only
  T-B-leadlist remains desktop-only (KL-3, row-12 deviation: the list renderer drops the
  per-row selection column on small screens, so the header button this test reveals cannot be
  shown on mobile). The preset-independent mechanism is also covered on mobile by the paired
  replica `<button>`-surface tests and T-A-* / T-OV-view on both presets.
- Reviewer round-2 additions: the three reconnect probes' status(this) destroy guards are
  covered by T-TS-reconnect-destroyed / T-RR-reconnect-destroyed / T-A-share-destroyed
  (deferred probe/fetch, destroy, resolve → no state write, no error). The share-target
  reconnect tests drive the PRODUCTION useOnChange on real setOffline transitions (flag armed
  via onCompanyChange offline; registration uses the production registry entry, not a forced
  test re-add). T-LG-probe activates via the real alt+c hotkey chord.
- Deviations recorded in design.md Known Limitations: KL-1, KL-2, KL-3, KL-4, KL-5, and the
  row-5 version bump.
