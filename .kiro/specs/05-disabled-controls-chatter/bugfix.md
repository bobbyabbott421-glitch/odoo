# Bugfix Requirements Document

## Introduction

Spec 05 fixes six CRM controls that misbehave offline, covering PART 2 items 3–8 and
owning acceptance row 7 (every DISABLE control is disabled/unreachable offline and
re-enabled online; every SKIP call is not issued offline and raises nothing). Row 7 is
proven by paired desktop/mobile tests, NOT by the framework's guarantee alone.

The six primary controls, with the offline-inventory section each maps to:

1. **Team switcher** (`team_switcher.js`, `crm_search_model.js`). Manager probe
   `user.hasGroup("sales_team.group_sale_manager")` (SKIP, :21); Manage Teams
   `doAction("sales_team.crm_team_action_config")` (DISABLE, :46); cached
   `get_team_switcher_data` (SKIP, :142).
2. **Lead-generation dropdown** (`lead_generation_dropdown.js`). Module-state and access
   probes (:139, :165) and the install/import/request navigations (:206, :241, :257) —
   all DISABLE.
3. **Recurring-revenue aggregate** (`crm_column_progress.js`). Probe
   `user.hasGroup("crm.group_use_recurring_revenues")` (SKIP, :14).
4. **Predictive-scoring tooltip button** (`crm_pls_tooltip_button.js`). save /
   `prepare_pls_tooltip_data` / reload (:45, :51, :57) — all DISABLE; widget surfaces
   (crm_lead_views.xml:99, :131).
5. **Activity menu CRM entry** (`activity_menu_patch.js`). `loadAction`/`doAction` for
   `crm.crm_lead_action_my_activities` (:39, :45) — DISABLE.
6. **Chatter on the lead form** (lead form arch + mail chatter, crm_lead_views.xml:300).
   Read-only offline with no uncaught error — DISABLE.

Beyond these six, row 7 requires every other DISABLE/SKIP inventory surface to be proven
by a test. A key correction drives this spec: **the framework disables only `<button>`**
(`SELECTORS_TO_DISABLE = ["button:not([data-available-offline]):not([disabled])"]`,
offline_plugin.js:48). Controls declared `<a type="object">` / `<a type="action">` render
as `<a>` through `ViewButton` (`<t t-tag="this.props.tag">`, view_button.xml:5) and are
NOT disabled by that pass. Those `<a>`-rendered controls therefore need their own offline
handling inside `addons/crm/` (see Bug 7), and the row-7 coverage table proves each
surface with a real control.

Scope note: PART 2 items 1–2 and mark-won are spec 04 (merged). Activities offline (PART
3b) are spec 06; the chatter's activity controls are noted but NOT changed here. The
manifest version bump is spec 08; acceptance row 5 is expected to fail until spec 08.

### How offline state is read

All affected controls live in OWL components (the activity-menu and chatter paths are
patched mail Components, which still have `setup()`), so each reads offline/small-screen
state through `useCrmOffline()` from
`addons/crm/static/src/mobile/crm_offline_hooks.js` (spec 02). No control resolves
`OfflinePlugin`/`UIPlugin` independently.

### Reactivity and reconnect detection

`isSaleManager` (team switcher) and `showRecurringRevenue` (column progress) must be
**reactive state** (OWL `signal`/`proxy`), not plain instance properties, so a value set
on reconnect re-renders the view with no other user action. Reconnect detection uses
`useOnChange(() => [offline.isOffline()], cb, { initialRun: false })` from `@odoo/owl`
(tracks only the offline signal; disposed with the component; precedent `useEffect` in
kanban_controller.js:132). Each reconnect callback checks `status(this)` is not
`"destroyed"` before setting state, and runs a skipped probe exactly once.

## Bug Analysis

### Current Behavior (Defect)

**Bug 1 — Team switcher.** 1.1 Offline mount issues the manager probe (team_switcher.js:21),
hitting the server. 1.2 `onClickManageTeams` (:45) can `doAction` (:46) if reached
programmatically; its `DropdownItem` may render as a non-button, so framework disable does
not guarantee unreachability. 1.3 The result is a plain property, so a reconnect re-probe
would not re-render.

**Bug 2 — Lead-generation dropdown.** 2.1 Offline, first `toggleDropdown` (:120) issues
`searchRead("ir.module.module", ...)` (:139) and `checkAccessRight` (:165). The "Generate"
`<button accesskey="c">` has no `data-available-offline`. 2.2 `dropdownWasAlreadyOpened` is
set during the first open, so a naive offline guard placed after it would permanently
suppress the probes even after reconnect. 2.3 Item handlers can issue
`button_immediate_install` (:206), import `doAction` (:241), install-request `doAction`
(:257).

**Bug 3 — Recurring-revenue aggregate.** 3.1 Offline mount issues the probe
(crm_column_progress.js:14). 3.2 `showRecurringRevenue` is a plain property gating the whole
MRR block including the `<b>MRR</b>` label (crm_column_progress.xml); returning `{}` from
the aggregate getter alone still leaves a bare "MRR" label when the standard aggregate is 0.
3.3 No reactive hide offline and no reconnect re-probe.

**Bug 4 — PLS tooltip button.** 4.1 Offline, `onClickPlsTooltipButton` (:38) issues
`record.save()` (:45), `prepare_pls_tooltip_data` (:51), `record.load()` (:57). The template
root is a real `<button>` (crm_pls_tooltip_button.xml) with no `data-available-offline`, so
click/keyboard/hotkey are framework-disabled, but there is no programmatic guard.

**Bug 5 — Activity menu CRM entry.** 5.1 Offline, the `crm.lead` activity group (a
`<div t-custom-click>`) and its Late/Today/Future links (`<span t-custom-click.stop>`,
mail activity_menu.xml) issue `loadAction` (:39) and `doAction` (:45). Non-buttons are not
framework-disabled, so they stay reachable by click, middle-click and new-window.

**Bug 6 — Chatter on the lead form.** 6.1 Offline, opening a cached lead runs
`Chatter.load()` → `thread.fetchThreadData()`. `fetchNewMessages` swallows its own error
(thread_model.js:563), but `fetchThreadData` then `await`s
`store.fetchStoreData("mail.thread", {...})` (thread_model_patch.js), which rejects on RPC
failure (store_service.js). `load()` is called un-awaited (chatter.js `_onMounted`/
`useOnChange`), so offline this is an **unhandled promise rejection**. 6.2 Non-button write
paths stay live: the attachment dropzone `onDrop` uploads via
`attachmentUploader.uploadFile` (chatter_patch.js:132); if the composer is open when the
connection drops, typing and Enter-to-send (composer non-button paths) still post, and
composer paste uploads via the composer's own `attachmentUploader.uploadFile`
(composer.js:661). 6.3 If `load()` is skipped offline, thread data never loads even after
reconnect.

**Bug 7 — `<a type=...>`-rendered CRM controls (framework does NOT disable).** 7.1 Offline,
the following render as `<a>` (ViewButton) and are NOT disabled, so clicking issues a
server call / navigation with no fallback: the two "set automated probability" links
(crm_lead_views.xml:90, :140), the team dashboard links (crm_team_views.xml:276, :286,
:291, :302, :307, :318, :323, :331), the campaign redirect link (utm_campaign_views.xml:19),
and the activity-report row click (crm_activity_report_views.xml:31, `list action=` →
`openRecord`). 7.2 The share-target item (`crm_share_target_item.js:19`) is CRM JS calling
`orm.webSearchRead("crm.team", ...)` with no offline guard.

### Expected Behavior (Correct)

Each item carries an AC ID referenced by design.md's coverage table and tasks.md.

**Bug 1 — Team switcher.**
- **AC-TS-1** Offline, the manager probe is NOT issued; the user is treated as
  not-a-manager (Manage Teams hidden); no RPC, no error.
- **AC-TS-2** Offline, the team-switcher trigger `<button>` is framework-disabled (PART 2
  item 3: the dropdown renders disabled). The selected team stays visible as a search facet
  via `crm_search_model.js` (`applySearch`/`getCurrentSearch`, :233).
- **AC-TS-3** Offline, `onClickManageTeams` returns early so a programmatic call does
  nothing (no `doAction`, no error).
- **AC-TS-4** On reconnect, if the probe was skipped it runs exactly once; `isSaleManager`
  is reactive state so **Manage Teams appears with no other user action**. `get_team_switcher_data`
  never raises offline (cached read).

**Bug 2 — Lead-generation dropdown.**
- **AC-LG-1** Offline, `toggleDropdown` returns BEFORE setting `dropdownWasAlreadyOpened`,
  so the module-state `search_read` probe is not issued, and the first open AFTER reconnect
  still issues it and renders the items. The test activates the Generate button through the
  REAL `alt+c` hotkey chord (the hotkey plugin rewrites `accesskey="c"` to `data-hotkey="c"`
  and skips the disabled button offline). NOTE: `toggleDropdown`'s `checkAccessRight`
  (`has_access`) call runs only for dropdown elements carrying a `model` property; NONE of the
  shipped `dropdownContentElements` carry `model`, so that branch is UNREACHABLE for the
  shipped UI — it is a defensive guard, and no test drives it (there is no `has_access` spy).
- **AC-LG-2** Offline, the install confirm (`button_immediate_install`), `redirectToImport`
  (import `doAction`), and `requestAccess` (install-request `doAction`) are each guarded so a
  direct call offline triggers none of them.

**Bug 3 — Recurring-revenue aggregate.**
- **AC-RR-1** Offline, the probe is NOT issued.
- **AC-RR-2** Offline, the whole recurring-revenue block (value AND the `<b>MRR</b>` label)
  is hidden via a getter that is false while offline; the standard aggregate's zero is NOT
  hidden. Proven with a zero standard aggregate: no "MRR" label appears offline.
- **AC-RR-3** On reconnect, if the probe was skipped it runs exactly once; `showRecurringRevenue`
  is reactive state so **the MRR value appears with no other user action**.

**Bug 4 — PLS tooltip button.**
- **AC-PLS-1** Offline, the `<button>` is framework-disabled (click, Enter/keyboard, hotkey);
  tests prove click and Enter issue no RPC.
- **AC-PLS-2** Offline, `onClickPlsTooltipButton` returns early so a programmatic call issues
  no save/`prepare_pls_tooltip_data`/load and shows no error.
- **AC-PLS-3** Online, the button saves, recomputes, reloads and opens the tooltip as before.

**Bug 5 — Activity menu CRM entry.**
- **AC-AM-1** Offline, the `crm.lead` branch of `openActivityGroup` returns at the very top
  (before `this.dropdown.close()`), so click, middle-click and new-window all load/navigate
  nothing and raise nothing. No visual affordance and no notification is added (JS guard
  only).
- **AC-AM-2** Online, the `crm.lead` entry opens my-activities as before; other models' entries
  are unchanged (fall through to `super`).

**Bug 6 — Chatter on the lead form.**
- **AC-CH-1** Offline, opening a cached lead raises no unhandled promise rejection; cached
  messages are visible read-only. `CrmChatter.load()` is async: it early-returns (setting
  `_loadSkipped`) when `isOffline()` is true, and otherwise wraps `super.load()` in a
  try/catch that swallows a `ConnectionLostError` (re-arming `_loadSkipped`) and rethrows any
  other error. This is required because the offline signal can be briefly ONLINE during an
  offline reopen — cache-served reads trigger `RPC:RESPONSE`, which flips the plugin back
  online for ~a frame — so a single `isOffline()` sample is unreliable and the thread fetch
  may run and then fail once the signal settles; the try/catch guarantees no unhandled
  rejection whatever the timing. Proven by opening the lead ONLINE first, then reopening it
  OFFLINE, asserting the previously loaded messages are shown and only the framework's own
  `web_read` refetch error occurs (no `/mail/store` unhandled rejection).
- **AC-CH-2** Offline, the composer is closed (on mount offline and on the online→offline
  transition), so typing, Enter-to-send and composer paste-upload are impossible; the draft on
  `thread.composer` is preserved. Enter offline posts nothing.
- **AC-CH-3** Offline, dropping a file on the chatter dropzone uploads NOTHING (the
  chatter's `attachmentUploader.uploadFile` is wrapped to a no-op in `CrmChatter`). For a
  SAVED lead the drop does nothing at all (no upload, no queue entry). For an UNSAVED lead the
  drop's pre-upload `saveRecord()` is the form's own save (form_compiler.js:23, shared with
  Follow/Schedule-activity) and cannot be blocked for the drop alone, so offline it queues
  exactly one ordinary create (same as pressing Save) and uploads nothing — Known Limitation
  KL-2. Send message / Log note are framework-disabled `<button>`s.
- **AC-CH-4** On reconnect, if the thread fetch was skipped/failed offline (`_loadSkipped`),
  the chatter refetches exactly once — issuing exactly one `mail.thread` `/mail/store` request
  — and the messages render. The reconnect handler calls the GUARDED `this.load` (not
  `super.load`), so if the connection drops again mid-refetch the `ConnectionLostError` is
  swallowed and `_loadSkipped` is re-armed, and the next reconnect retries — never an
  unhandled rejection. Online, every chatter write path works as before, and another model's
  form chatter is entirely unchanged.

**Bug 7 — `<a type=...>` controls and share target.**
- **AC-A-1-guard** Offline, the lead-form automated-probability `<a>` (crm_lead_views.xml:90,
  :140) is blocked in `CrmFormController.beforeExecuteActionButton` (offline AND
  `name === "action_set_automated_probability"` → `return false`): no RPC, no queue entry, no
  navigation, no visual change. Online it works (falls through to `super`). ONLINE rendering
  unchanged (row 10).
- **AC-A-1-known** Offline, the team-dashboard and campaign `<a>` controls and the
  activity-report row click (on views CRM does not own a js_class for) stay clickable but fail
  SILENTLY: no navigation, no error dialog or notification, and nothing added to the queue
  (`type="object"` via `lostConnectionHandler`; `type="action"` navigation does not happen).
  Online they work. This is Known Limitation KL-1 and an explicit acceptance-row-7 deviation.
- **AC-A-2** Offline, `crm_share_target_item.js` skips `webSearchRead` and renders the item
  DISABLED (not hidden) with no error; on reconnect it runs the read exactly once (same
  `useOnChange` pattern). Online the read is issued.

**Out-of-scope views / forecast (framework-owned, proven not re-implemented).**
- **AC-OV-1** Offline, an uncached analytic/forecast view falls back via the framework view
  fallback (action_plugin.js:1308 picks an available view / the OfflineActionHelper); proven
  with one test.
- **AC-OV-2** Offline, an unavailable app/menu is filtered by menu_providers.js:39
  (`isAvailable` → `isOffline() && !isAvailableOffline`); proven with one test.
- **AC-OV-3** Offline, the view-switcher buttons for unavailable view types are framework
  `<button>`s and are disabled; proven with one test.

### Unchanged Behavior (Regression Prevention)

- **U1** Online, every probe/lookup/navigation/fetch the shipped UI issues is still issued
  (team manager probe, lead-gen `ir.module.module` searchRead, recurring-revenue probe, PLS
  save/recompute/reload, activity-menu `loadAction`/`doAction`, chatter thread-data fetch,
  the `<a>` controls, the share-target `webSearchRead`). The lead-gen `checkAccessRight`
  branch is a defensive guard that the shipped elements never reach (no element carries
  `model`), so it is not among the issued probes and is not tested.
- **U2** Desktop is unchanged; all new behavior is gated on offline state. Online rendering of
  every `<a>` control is byte-for-byte unchanged (row 10).
- **U3** `crm_search_model.js` facet behavior (`applySearch`/`getCurrentSearch`) is preserved;
  `get_team_switcher_data` must not raise offline (cached read, :142).
- **U4** Non-`crm.lead` activity-menu entries keep mail's behavior.
- **U5** Every existing test passes unmodified. No PRE-EXISTING test file is edited: this
  spec's new JS tests are APPENDED to `addons/crm/static/tests/crm_offline.test.js`, which was
  CREATED by spec 02 (it is not a pre-existing framework test file, and appending to it is not
  editing someone else's test). This spec adds no Python test, so
  `addons/crm/tests/__init__.py` is NOT touched. A pre-existing test that already exercises one
  of these surfaces is `crm_team_switcher.test.js` (left untouched).

## Impact

- CRM-owned frontend controls gain offline guards; no server-side change. No model, access
  rule, security group, dependency, or manifest change (version bump is spec 08). No new
  files (CrmFormRenderer/CrmChatter live in the existing `crm_form.js`). No new offline
  machinery.

## Acceptance Mapping

This spec owns **acceptance row 7**. Two acceptance-row-7 deviations are explicit Known Limitations (design.md Known Limitations), proven by test and repeated in the PR: **KL-1** `<a type=...>` view buttons on views crm doesn't own stay clickable offline but fail silently; **KL-2** an offline file drop on an unsaved lead queues one ordinary create (the form's own save) and uploads nothing. It also must leave `<a>`-control online rendering
unchanged (**row 10**). design.md carries a coverage table with one row per DISABLE and SKIP
inventory row, giving the mechanism (framework auto-disable of a `<button>`, CRM guard, or
framework-owned view/menu fallback) and the AC ID + test that proves it.

Verification: `check.sh quick` and `check.sh full` are run; all five test commands and all
scope checks pass; acceptance row 5 (version bump) is expected to fail until spec 08.
