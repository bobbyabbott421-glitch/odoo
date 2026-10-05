# Bugfix Design Document

## Overview

Six CRM controls (plus the `<a type=...>` controls and the share target) are made honest
offline per PART 2 items 3–8, proving acceptance row 7 by test. Each fix is the minimum
change inside `addons/crm/`. Components read offline/small-screen state through
`useCrmOffline()` (spec 02). Reactive state (`signal`/`proxy`) holds any value a reconnect
probe sets, so the view re-renders with no other user action. Reconnect uses
`useOnChange(() => [offline.isOffline()], cb, { initialRun: false })`.

Key correction baked into this design: the framework's offline pass disables ONLY
`button:not([data-available-offline]):not([disabled])` (offline_plugin.js:48). Controls
authored as `<a type="object">` / `<a type="action">` render as `<a>` via `ViewButton`
(`<t t-tag="this.props.tag">`, view_button.xml:5) and are NOT disabled; they need their own
crm-side handling (Fix 7).

### Files changed / created

Modified (existing crm files) — **no new files**:

- `addons/crm/static/src/components/team_switcher/team_switcher.js`
- `addons/crm/static/src/components/lead_generation_dropdown/lead_generation_dropdown.js`
- `addons/crm/static/src/views/crm_kanban/crm_column_progress.js`
- `addons/crm/static/src/views/crm_form/crm_pls_tooltip_button.js`
- `addons/crm/static/src/activity_menu_patch.js`
- `addons/crm/static/src/views/crm_form/crm_form.js` — register a `Renderer` on the
  `crm_form` view and HOUSE `CrmFormRenderer` and `CrmChatter` here (Open Question 1 →
  option (a); no new file).
- `addons/crm/static/src/webclient/share_target/crm_share_target_item.js` — guard
  `webSearchRead` offline.
- the `<a type=...>` control fix (Fix 7) — file(s) TBD by the task-1 proposal, inside
  `addons/crm/` only, chosen to leave online rendering unchanged.
- `addons/crm/static/tests/crm_offline.test.js` (append only).

No activity-menu template change (Open Question 1 → affordance dropped; JS guard only).

## Glossary

- **DISABLE / SKIP / QUEUE** — offline-inventory classifications (offline_inventory.md).
- **Framework auto-disable** — the offline plugin's selector pass that disables every
  `<button>` without `data-available-offline` (offline_plugin.js:48); `<a>`-rendered
  controls are NOT covered.
- **CRM guard** — a JS early-return keyed on `useCrmOffline().isOffline()`, needed for
  non-`<button>` controls and for the programmatic path behind a framework-disabled button.
- **Reconnect re-probe** — `useOnChange(() => [offline.isOffline()], cb, { initialRun:
  false })` running a skipped SKIP probe once when the connection returns, writing reactive
  state.

## Bug Details

See bugfix.md "Current Behavior (Defect)" (Bugs 1–7). Summary: three controls run a
group/access probe or module lookup offline with no fallback; two run server
navigations/recomputes offline; the chatter emits an unhandled rejection from an awaited
`fetchStoreData` offline and keeps non-button write paths live; `<a type=...>` CRM controls
and the share-target JS are not covered by the framework's button-only disable pass.

## Expected Behavior

Per bugfix.md "Expected Behavior (Correct)", keyed by AC IDs (AC-TS-*, AC-LG-*, AC-RR-*,
AC-PLS-*, AC-AM-*, AC-CH-*, AC-A-*, AC-OV-*). Online behavior is unchanged (U1–U5).

## Hypothesized Root Cause

1. SKIP probes run unconditionally in `onWillStart`, held in plain (non-reactive)
   properties, so offline they hit the server and a reconnect result would not re-render.
2. Lead-gen `toggleDropdown` sets `dropdownWasAlreadyOpened` before any offline guard, so a
   late guard would suppress the probes permanently.
3. The PLS handler lacks a programmatic guard behind the framework-disabled button.
4. The activity-menu crm.lead entry/links are non-buttons the framework never disables.
5. The chatter awaits `fetchStoreData` (rejects offline) from an un-awaited `load()`; its
   dropzone/composer upload and composer post paths are non-button paths.
6. `<a type=...>` controls render as `<a>`, outside the framework's button-only disable.

## Correctness Properties

Property 1: SKIP not issued offline — each SKIP probe issues no RPC offline and raises
nothing.
**Validates: Requirements 1.1, 2.1, 3.1**

Property 2: SKIP re-probe on reconnect writes reactive state — a component mounted offline
fires the probe exactly once on reconnect and the dependent UI (Manage Teams, MRR) appears
with no other user action.
**Validates: Requirements 1.3, 3.3**

Property 3: DISABLE/`<a>` unreachable offline — each DISABLE control (button, non-button, or
`<a>`) issues no server call offline by click, keyboard, hotkey/accesskey, middle-click,
new-window or programmatic call, and is enabled online.
**Validates: Requirements 4.1, 5.1, 7.1, 7.2**

Property 4: chatter read-only, no raise — offline cached-lead open raises no unhandled
rejection, shows cached messages, and no write path (post, paste, drop) succeeds; reconnect
loads thread data once.
**Validates: Requirements 6.1, 6.2, 6.3**

Property 5: online unchanged — online, every probe/lookup/navigation/fetch and every write
path and every `<a>` control render behave exactly as before.
**Validates: Requirements 4.2, 5.3, 6.3**

## Fix Implementation

### 1. Team switcher (`team_switcher.js`)

`setup()`: `this.crmOffline = useCrmOffline()`. Hold the manager flag in a reactive `signal` (owl exports `signal`/`proxy`, NOT `reactive`): `this._isSaleManager = signal(false)`. Keep team_switcher.xml UNCHANGED (:21 reads `this.isSaleManager`, and that template is not in the allowed-file list): add `get isSaleManager() { return this._isSaleManager(); }` so the getter reads the reactive signal. `onWillStart`: if online, `this._isSaleManager.set(await user.hasGroup(...))`; if offline, leave false and set `this._managerProbeSkipped = true`.
`useOnChange(() => [this.crmOffline.isOffline()], (isOffline) => { if (!isOffline &&
this._managerProbeSkipped) { this._managerProbeSkipped = false; user.hasGroup(...).then(v => { if (status(this) !== "destroyed") this._isSaleManager.set(v); }); } }, { initialRun: false })`. `onClickManageTeams`: `if (this.crmOffline.isOffline()) return;` before `doAction`.
Trigger `<button>` keeps NO `data-available-offline` (framework disables the dropdown
offline; facet stays visible via crm_search_model). **AC-TS-1..4, U3.**

### 2. Lead-generation dropdown (`lead_generation_dropdown.js`)

`setup()`: `this.crmOffline = useCrmOffline()`. `toggleDropdown`: FIRST line
`if (this.crmOffline.isOffline()) return;` — before `dropdownWasAlreadyOpened` is set and
before the probes, so after reconnect the first open still probes and renders items. Guard
the three navigations with an early offline return: the install confirm body (before
`button_immediate_install`), `redirectToImport` (before import `doAction`), `requestAccess`
(before install-request `doAction`). The "Generate" `<button accesskey="c">` is
framework-disabled offline, neutralising click/keyboard/accesskey. **AC-LG-1..2.**

### 3. Recurring-revenue aggregate (`crm_column_progress.js` + template)

`setup()`: `this.crmOffline = useCrmOffline()`. Hold `showRecurringRevenue` in a reactive `signal`: `this._showRecurringRevenue = signal(false)` (owl exports `signal`/`proxy`, NOT `reactive`), exposed via `get showRecurringRevenue() { return this._showRecurringRevenue(); }` so crm_column_progress.xml references are unchanged except the single `t-if` swap below. `onWillStart`: probe only when
online AND `recurring_revenue_sum_field` set; else skip and set `_rrProbeSkipped`. Online: `this._showRecurringRevenue.set(await user.hasGroup(...))`. Add a
getter `get displayRecurringRevenue() { return !this.crmOffline.isOffline() &&
this.state.showRecurringRevenue; }`. In `crm_column_progress.xml`, change the block's
`t-if="this.showRecurringRevenue"` to `t-if="this.displayRecurringRevenue"` so BOTH the
value and the `<b>MRR</b>` label hide offline; the standard aggregate zero is untouched.
`getRecurringRevenueGroupAggregate` also returns `{}` when `!displayRecurringRevenue`.
Reconnect: `useOnChange(() => [this.crmOffline.isOffline()], (isOffline) => { if (!isOffline
&& this._rrProbeSkipped && this.props.progressBarState.progressAttributes
.recurring_revenue_sum_field) { this._rrProbeSkipped = false; user.hasGroup("crm.group_use_recurring_revenues").then(v => { if (status(this) !== "destroyed") this._showRecurringRevenue.set(v); }); } }, { initialRun: false })`.
**AC-RR-1..3.**
NOTE: `crm_column_progress.xml` is edited (existing crm file). The `t-if` swap is the only
template change; online rendering with the probe true is unchanged.

### 4. PLS tooltip button (`crm_pls_tooltip_button.js`)

`setup()`: `this.crmOffline = useCrmOffline()`. First line of `onClickPlsTooltipButton`:
`if (this.crmOffline.isOffline()) return;`. The real `<button>` is framework-disabled for
click/keyboard/hotkey; the guard covers the programmatic path. **AC-PLS-1..3.**

### 5. Activity menu CRM entry (`activity_menu_patch.js`)

Add `setup() { super.setup(); this.crmOffline = useCrmOffline(); }`. In `openActivityGroup`,
the `crm.lead` branch returns at the very top when `this.crmOffline.isOffline()` — BEFORE
`this.dropdown.close()` — so click, middle-click and new-window do nothing and raise
nothing. No template change, no affordance, no notification (JS guard only). Other models
fall through to `super`. **AC-AM-1..2, U4.**

### 6. Chatter on the lead form (`CrmFormRenderer` + `CrmChatter` in `crm_form.js`)

`CrmFormRenderer extends formView.Renderer`: `setup()` calls `super.setup()` then sets
`this.mailComponents.Chatter = CrmChatter`. Register as `Renderer` on the `crm_form` view
(currently unset, so the mail-patched base `FormRenderer` is used). `CrmChatter extends
Chatter` (from `@mail/chatter/web_portal_project/chatter`); in `setup()` call
`super.setup()` then `this.crmOffline = useCrmOffline()` and wrap the uploader (below).

Precise block points (no global patch, nothing in mail changes):

| path | where it lives | how CrmChatter blocks it offline |
| --- | --- | --- |
| thread-data fetch (unhandled rejection) | `Chatter.load()` → `fetchThreadData` (chatter.js) | override `async load(thread, requestList)`: early-return + `_loadSkipped=true` when `isOffline()`; otherwise `try { await super.load(...) } catch (e) { if (e instanceof ConnectionLostError) { _loadSkipped=true; return; } throw e }`. Sampling the signal once is not enough — during an offline reopen cache-served reads trigger `RPC:RESPONSE`, flipping the plugin briefly back online, so `load()` can run and schedule a fetch that fails once the signal settles offline; the try/catch guarantees no unhandled rejection whatever the timing, and re-arms `_loadSkipped` for the reconnect refetch. A non-`ConnectionLostError` propagates. |
| composer typing / Enter-to-send / composer paste-upload | child `<Composer>` rendered only when `state.composerType` is truthy (chatter.xml:60); paste in composer.js:649 | override `toggleComposer(mode, opts)`: `if (this.crmOffline.isOffline()) { this.state.composerType = false; return; }` else `super.toggleComposer(...)`. Also `useOnChange(() => [this.crmOffline.isOffline()], (off) => { if (off) this.state.composerType = false; }, { initialRun: true })` so a composer open when the drop happens is closed and one mounted offline never opens. Closing unmounts `<Composer>`, removing typing/Enter/paste. The draft lives on `thread.composer`, so it is preserved. |
| attachment dropzone `onDrop` upload | inline closure in mail's patched `setup()` (chatter_patch.js:120), calls `this.attachmentUploader.uploadFile` | in `CrmChatter.setup()` after `super.setup()`, wrap `this.attachmentUploader.uploadFile` to a no-op offline — stops the UPLOAD on any drop. For an UNSAVED lead the closure also calls `saveRecord()` first (form's own save, form_compiler.js:23); that cannot be blocked for the drop alone — see Known Limitation KL-2. |
| reconnect reload | — | `useOnChange(() => [this.crmOffline.isOffline()], (off) => { if (!off && this._loadSkipped) { this._loadSkipped = false; this.load(this.state.thread, this.initialRequestList); } }, { initialRun: false })`. The refetch goes through the GUARDED `this.load` (not `super.load`): if the connection drops again mid-refetch, its try/catch swallows the `ConnectionLostError` and re-arms `_loadSkipped`, so the next reconnect retries — never an unhandled rejection. |

Non-button buttons (Send message, Log note, Attach files, message actions) are real
`<button>`s, framework-disabled offline. Message-action external links are plain `<a href>`
navigations with no RPC — unchanged. **AC-CH-1..4, U5 (other-model chatter unchanged
because only the crm_form Renderer swaps the component).**

> DROPZONE (decision 4, KL-2): the uploader wrap makes an offline drop upload NOTHING. For a SAVED lead that fully satisfies AC-CH-3 (no upload, no queue entry — the drop's `saveRecord()` branch only runs when `!thread.id`). For an UNSAVED lead the drop's pre-upload `saveRecord()` is the FORM'S OWN save (`() => __comp__.save()`, form_compiler.js:23), shared with Follow and Schedule-activity, so it cannot be blocked just for the drop. Offline it queues exactly one ordinary create (identical to pressing Save) and uploads nothing. Recorded as Known Limitation KL-2.

The composer-paste upload uses the composer's OWN uploader instance, not the chatter's; it
is covered by closing the composer (so the Composer never mounts offline), NOT by the
uploader wrap. This is the one subtlety: the chatter-uploader wrap covers the DROP; the
composer-close covers PASTE + typing + Enter. Both are reachable from the subclass; neither
needs a global patch. (Confirmed with the user before coding.)

Spec 06 note: the chatter's activity controls (schedule activity, mark done, activity list)
are mail-owned and belong to PART 3b / spec 06. Spec 06 will decide QUEUE vs DISABLE per
activity control and extend this same `CrmChatter`/lead-form path, not a global mail patch.
This spec does not touch them.

### 7. `<a type=...>` CRM controls + share target — FINALIZED (approved in spec review)

The framework disables only `<button>`. `<a type=object/action>` renders as `<a>` via
`ViewButton` (`<t t-tag="this.props.tag">`, view_button.xml:5) and `ViewButton.onClick`
(view_button.js:115) runs `ev.preventDefault()` for `tag==="a"` then
`this.handleViewButton(...)`, routed by `useViewButtons` to the OWNING view controller's
`beforeExecuteActionButton`. So a control is blockable in CRM only when CRM owns the view's
`js_class`/Controller. Per-surface outcome:

| control (file:line) | view / model | arch-owning addon | click handler today | crm js_class? | decision |
| --- | --- | --- | --- | --- | --- |
| a `action_set_automated_probability` (crm_lead_views.xml:90, :140) | crm.lead form | crm | `CrmFormController.beforeExecuteActionButton` (crm_form.js) | YES (`crm_form`) | **GUARD** in crm's own controller |
| a `action_open_unassigned_opportunities` + manage-teams/report links (crm_team_views.xml:276, :286, :291, :302, :307, :318, :323, :331) | crm.team dashboard kanban | sales_team (crm extends via XML) | kanban controller `beforeExecuteActionButton` | NO | **KNOWN LIMITATION (b)** — do not add a js_class to a view crm doesn't own |
| a `action_redirect_to_leads_opportunities` (utm_campaign_views.xml:19) | utm.campaign form | utm (crm extends via XML) | form controller `beforeExecuteActionButton` | NO | **KNOWN LIMITATION (b)** |
| list row `action_open_lead` (crm_activity_report_views.xml:31) | crm.activity.report list | crm | generic list controller record-open | NO | **KNOWN LIMITATION (b)** — a js_class would need a new list view registration, which with no new files lands in an unrelated file |
| `webSearchRead("crm.team")` (crm_share_target_item.js:19) | crm share-target item (OWL component, not a view button) | crm | `CrmShareTargetItem.updateTeams` | n/a (crm JS) | **GUARD** in crm JS |

#### 7a. Lead-form automated-probability link — GUARD (AC-A-1-guard)

In `CrmFormController.beforeExecuteActionButton` (crm_form.js, the same seam spec 04 uses):
offline AND `clickParams.name === "action_set_automated_probability"` → `return false` (no
RPC, no queue entry, no navigation). No visual change (same approach as the activity menu).
Online: unchanged (falls through to `super`). Paired test offline + online.

#### 7b. Team / campaign / activity-report `<a>` controls — KNOWN LIMITATION (b) (AC-A-1-known)

These live on views CRM does not own a `js_class` for; blocking them would require adding a
`js_class` to a `sales_team`/`utm` view (forbidden) or a new list-view registration in an
unrelated file (no new files allowed). They are therefore left clickable offline, and the
REAL offline behavior is:

- **`type="object"`** (crm_team_views.xml:276 `action_open_unassigned_opportunities`,
  :318/:323/:331 reports; utm_campaign_views.xml:19): the `call_button` RPC fails with a
  `ConnectionLostError`; the framework's `lostConnectionHandler`
  (web/static/src/core/offline/offline_error.js, `lostConnectionHandler`, registered
  sequence 98) catches it on the uncaught-promise path, calls `error.event.preventDefault()`
  and `setOffline(true)` — **handled silently**: no error dialog, no notification, nothing
  queued (a bare `call_button`/`doAction` has no queue fallback).
- **`type="action"`** (crm_team_views.xml:286/:291/:302/:307 manage-teams): task 1 observed
  the `loadAction`/`doAction` RPC fail the same way — the navigation does not happen and the
  `ConnectionLostError` is handled silently by `lostConnectionHandler`; nothing is queued.
- **activity-report row click** (crm_activity_report_views.xml:31 `action_open_lead`): the
  record-open `doAction` fails and is handled silently the same way.

Row-7 deviation (recorded in Known Limitations and repeated in the PR): "web's offline pass
disables only `<button>`, so `<a type=...>` view buttons on views crm doesn't own stay
clickable offline; the click fails silently (no navigation, no error, nothing queued)."
Test (one control per surface, paired): offline click → no navigation, no error dialog/
notification, `_ormToSync()` unchanged; online → it works.

#### 7c. Share target — GUARD (AC-A-2)

`crm_share_target_item.js`: `this.crmOffline = useCrmOffline()`. In `updateTeams`, if offline,
skip the `webSearchRead` and set `_shareProbeSkipped`; render the item DISABLED (not hidden)
with no error. Reconnect: `useOnChange(() => [offline.isOffline()], ...)` runs `updateTeams`
once if it was skipped. Paired tests: offline no `webSearchRead` + item disabled; reconnect →
loads once; online → issued.

### Out-of-scope views / forecast — framework-owned mechanisms (proven, not re-implemented)

- **Uncached analytic/forecast view** → the action view fallback at
  `action_plugin.js:1308`: when `offlinePlugin.isOffline() && !isAvailableOffline(action,
  view, resId)` it swaps to an available view (and the Kanban/List controllers show
  `OfflineActionHelper`). **AC-OV-1**, one test.
- **Unavailable app/menu** → the command-palette menu provider filter at
  `menu_providers.js:39`: `isAvailable(menu) = isOffline() && !isAvailableOffline(menu.actionID)`.
  **AC-OV-2**, one test.
- **View-switcher buttons** for unavailable view types are framework `<button>`s and are
  disabled by the offline pass. **AC-OV-3**, one test.

## Coverage table (acceptance row 7)

One row per DISABLE/SKIP inventory surface. Mechanism ∈ {framework auto-disable (button),
CRM guard, framework view/menu fallback, spec 04}. Each in-scope row carries an AC ID and a
paired desktop/mobile test. For a surface the framework disables, one test with a real
control from that surface (offline disabled + no RPC; online enabled).

### Primary controls (PART 2 items 3–8)

| inventory row | class | mechanism | AC | test |
| --- | --- | --- | --- | --- |
| team_switcher.js:21 hasGroup | SKIP | CRM guard + reactive + reconnect re-probe | AC-TS-1, AC-TS-4 | T-TS-skip |
| team_switcher.js:46 doAction(manage teams) | DISABLE | framework button-disable (trigger) + CRM guard (programmatic) | AC-TS-2, AC-TS-3 | T-TS-disable |
| crm_search_model.js:142 get_team_switcher_data | SKIP | framework cached read; asserts no raise | AC-TS-2 | T-TS-facet |
| lead_generation_dropdown.js:139 searchRead(ir.module.module) | DISABLE | framework button-disable + CRM guard in toggleDropdown | AC-LG-1 | T-LG-probe |
| lead_generation_dropdown.js:165 checkAccessRight | DISABLE | same | AC-LG-1 | T-LG-probe |
| lead_generation_dropdown.js:206 button_immediate_install | DISABLE | CRM guard | AC-LG-2 | T-LG-nav |
| lead_generation_dropdown.js:241 doAction(import) | DISABLE | CRM guard | AC-LG-2 | T-LG-nav |
| lead_generation_dropdown.js:257 doAction(install request) | DISABLE | CRM guard | AC-LG-2 | T-LG-nav |
| crm_column_progress.js:14 hasGroup | SKIP | CRM guard + reactive + reconnect re-probe | AC-RR-1..3 | T-RR |
| crm_pls_tooltip_button.js:45 record.save | DISABLE | framework button-disable + CRM guard (programmatic) | AC-PLS-1..2 | T-PLS |
| crm_pls_tooltip_button.js:51 prepare_pls_tooltip_data | DISABLE | same | AC-PLS-1..2 | T-PLS |
| crm_pls_tooltip_button.js:57 record.load | DISABLE | same | AC-PLS-1..2 | T-PLS |
| crm_lead_views.xml:99 widget pls_tooltip_button | DISABLE | framework button-disable (surface) | AC-PLS-1 | T-PLS |
| crm_lead_views.xml:131 widget pls_tooltip_button (alt) | DISABLE | framework button-disable (surface) | AC-PLS-1 | T-PLS |
| activity_menu_patch.js:39 loadAction | DISABLE | CRM guard (non-button) | AC-AM-1 | T-AM |
| activity_menu_patch.js:45 doAction | DISABLE | CRM guard (non-button) | AC-AM-1..2 | T-AM |
| crm_lead_views.xml:300 chatter | DISABLE | CRM-owned CrmFormRenderer/CrmChatter | AC-CH-1..4 | T-CH |

### `<a type=...>` CRM controls and the activity-report row click

AC-A-1 splits into the GUARDED case (crm owns the js_class) and the KNOWN-LIMITATION
case (KL-1). HONESTY NOTE: the real foreign-owned controls (crm.team dashboard,
utm.campaign, the activity-report list) live on views CRM does not own a js_class for, so
they cannot be mounted-and-exercised from a crm-owned test without adding a js_class to a
foreign view. The KL-1 tests therefore run on **replica arches** (a minimal form/list
carrying an `<a type="object">`, an `<a type="action">`, and a list row-open `action=`),
which prove the FRAMEWORK behavior these controls rely on (ViewButton renders `<a>`, the
framework does not disable it, the server call fails silently via lostConnectionHandler,
nothing queued) — not the real view wiring. The table names the tests that ACTUALLY exist.

| inventory row(s) | class | mechanism | AC | test (exists) |
| --- | --- | --- | --- | --- |
| crm_lead_views.xml:90, :140 a action_set_automated_probability | DISABLE | CRM guard in CrmFormController (Fix 7a), real crm_form arch | AC-A-1-guard | T-A-lead |
| crm_team_views.xml:276 a (type=object) — represented by replica | DISABLE | KL-1 framework silent-fail, replica `<a type=object>` | AC-A-1-known | T-A-known |
| crm_team_views.xml:286/:291/:302/:307/:318/:323/:331 a (type=action) — represented by replica | DISABLE | KL-1 framework silent-fail, replica `<a type=action>` | AC-A-1-known | T-A-action |
| utm_campaign_views.xml:19 a (type=object) — represented by replica | DISABLE | KL-1 framework silent-fail (same mechanism as T-A-known) | AC-A-1-known | T-A-known |
| crm_activity_report_views.xml:31 list action=action_open_lead (row click) — represented by replica | DISABLE | KL-1 framework silent-fail, replica list row-open | AC-A-1-known | T-A-rowclick |
| crm_share_target_item.js:19 webSearchRead(crm.team) | DISABLE | CRM guard + reconnect (Fix 7c), real share-target item | AC-A-2 | T-A-share |

### `<button>` / `<a>` surfaces proven by the framework pass (one real-control test each)

| surface (inventory) | mechanism | AC/test |
| --- | --- | --- |
| Mark-won (Won button) | spec 04 (owned there) | — (spec 04) |
| Lead form other header/stat/inline `<button>`s (:12/:14/:16/:33/:42/:213/:226) | framework button-disable | T-B-leadform (one `<button>`) |
| Lead list / opportunities list `<button>`s (:323/:324/:710/:711/:760) | framework button-disable | T-B-leadlist (one) |
| Team views `<button>`s (crm_team_views.xml:144/:207) | framework button-disable | T-B-team (one) |
| Settings `<button>`s (res_config_settings_views.xml:16/:47/:64) | framework button-disable | T-B-settings (one) |
| Related-record nav `<button>`s (res_partner_views.xml:12; crm_lost_reason_views.xml:22; utm_campaign_views.xml:37) | framework button-disable | T-B-related (one) |
| Wizard apply `<button>`s (4) | framework button-disable | T-B-wizard (one) |
| Lead methods (7, button-reachable) | proven via their view buttons above | covered by T-B-leadform/leadlist/team |
| forecast_kanban per-call rows (3) | DISABLE view; forecast unreachable | AC-OV-1 (T-OV-view) |
| Out-of-scope analytic/other views (register-only, 8) | framework view/menu fallback | AC-OV-1..3 (T-OV-view, T-OV-menu, T-OV-switcher) |

> Only one inventory row is assigned to another spec: **Mark-won (Won button) → spec 04
> (merged)**. No row is deferred to a LATER spec. Confirmed with the user (Open Question 2):
> every other DISABLE/SKIP row is proven by a test here, not by the framework guarantee alone.

### QUEUE rows (not this spec)

The 2 QUEUE rows (crm_form.js:38-42; crm_lead.py:1057 action_set_won) are spec 04; not
re-tested here.

## Testing Strategy

All JS tests are appended to `addons/crm/static/tests/crm_offline.test.js`, paired
`test.tags("desktop")` / `test.tags("mobile")`, using the file's existing `setOffline(...)`
helper (drives the plugin signal) and `onRpc` spies. `mockOffline()` only where a test needs
RPCs to actually fail (chatter rejection, `<a>` click RPC). `defineMailModels()` for mounts
that resolve mail models. Tests assert what the USER sees (disabled control, hidden
value/label, visible facet/messages, reconnect appearance) plus the RPC spy, not only
internal flags. Each DISABLE test proves offline-disabled-and-no-RPC AND
online-enabled-and-working. Each SKIP test proves no-RPC-offline AND an online test that the
probe IS issued. Reconnect tests assert the dependent UI appears with no other user action.
≥80% statement coverage on new JS paths; a test per new path. No `only()`/`debug()`. No
property-based tests.

Named test groups (each desktop+mobile): T-TS-skip, T-TS-disable, T-TS-facet, T-LG-probe,
T-LG-nav, T-RR, T-PLS, T-AM, T-CH, T-A-lead, T-A-known, T-A-action, T-A-rowclick, T-A-share,
T-B-leadform, T-B-leadlist, T-B-team, T-B-settings, T-B-related, T-B-wizard, T-OV-view,
T-OV-menu, T-OV-switcher.

Chatter specifics (T-CH): open the lead ONLINE first (messages load), then set offline and
REOPEN the lead; assert the previously loaded messages are still shown (AC-CH-1), no
unhandled rejection, the composer is closed and Enter posts nothing with the draft preserved
(AC-CH-2), a dropped file is not uploaded (AC-CH-3), Send/Log disabled; then reconnect and
assert thread data/messages load (AC-CH-4); plus an online test that another model's form
chatter is unchanged.

## Open Questions

Both resolved:
1. **(a)** `CrmFormRenderer`/`CrmChatter` live in `crm_form.js`; activity-menu affordance
   dropped (JS guard only). No new files.
2. **Row 7 proven by tests** (no framework-guarantee shortcut). The `<a type=...>` controls
   get a crm-side fix proposed in Fix 7, OBSERVED in task 1 and CONFIRMED with the user before
   coding. Share target observed and guarded (or reported un-runnable) before coding.

## Known Limitations

- **KL-3 — desktop-only framework-chrome tests (acceptance row 12 deviation).** Row 12
  wants new JS tests to pass under both presets. Four tests assert desktop-only control-panel
  chrome and are therefore registered `test.tags("desktop")` only, mirroring the framework's
  own offline switcher/list tests (web/.../window_action.test.js, which are desktop-only):
  T-OV-view and T-OV-switcher (the inline `.o_switch_view` buttons and the view fallback are a
  desktop surface; mobile renders the switcher as a dropdown), T-OV-menu (the `/`-namespace
  command palette is a desktop surface), and T-B-leadlist (inline list row-selection chrome).
  The framework-disable MECHANISM they rely on is preset-independent and is additionally
  covered on mobile by the paired `<button>`-surface tests (T-B-leadform/meeting/team/settings/
  related/wizard) and by T-A-* on both presets. T-CH's mobile variant is the mounted-instance
  form (KL-4) rather than the desktop WebClient-reopen flow. These are the row-12 deviations.

- **KL-4 — T-CH mobile is the mounted-instance variant.** The desktop T-CH tests reopen the
  cached lead through a WebClient action offline (the faithful "reopen offline" flow). The
  mobile T-CH variant instead keeps the lead form mounted, toggles offline, and asserts the
  same user-visible contract (composer closes, cached message stays, a real drop uploads
  nothing, reconnect refetches once) without the desktop breadcrumb/doAction reopen chrome.
  Row-12 deviation, same reason as KL-3.

- **KL-5 — share-target offline affordance always shows.** Offline, CrmShareTargetItem renders
  the "Sales teams are unavailable offline." disabled block whenever offline, even on a
  single-team database where ONLINE the team selector is hidden (`hasMultiTeams` is false). This
  is a minor cosmetic divergence from the online single-team case; it is intentional (the item
  honestly signals the feature is unavailable offline) and recorded here for the PR.


- **KL-1 — `<a type=...>` view buttons on views crm does not own.** web's offline pass
  disables only `<button>` (offline_plugin.js:48). The team-dashboard and campaign `<a>`
  controls (crm_team_views.xml:276/:286/:291/:302/:307/:318/:323/:331;
  utm_campaign_views.xml:19) and the activity-report row click
  (crm_activity_report_views.xml:31) live on `sales_team` / `utm` / un-js_classed crm views,
  so CRM cannot guard them without adding a js_class to a view it doesn't own (forbidden) or
  a new view registration in an unrelated file (no new files). They stay clickable offline;
  the click fails SILENTLY — `type="object"` via `lostConnectionHandler` (offline_error.js,
  sequence 98: `preventDefault` + `setOffline(true)`), `type="action"` navigation simply does
  not happen (observed in task 1), with no error dialog, no notification, and nothing queued.
  This is an explicit acceptance-row-7 deviation, proven on replica arches by T-A-known
  (`<a type=object>`), T-A-action (`<a type=action>`) and T-A-rowclick (list row-open), and
  repeated in the PR description. The replica arches stand in for the real foreign-owned
  controls, which CRM cannot mount without adding a js_class to a view it does not own.

- **KL-2 — chatter file drop on an UNSAVED lead.** The dropzone `onDrop` for a lead with no
  server id calls the form's own `save` first (`saveRecord: () => __comp__.save()`,
  form_compiler.js:23), which is shared with Follow and Schedule-activity, so it cannot be
  blocked for the drop alone. Offline, dropping a file on an unsaved lead queues exactly one
  ordinary create (identical to pressing Save) and uploads nothing. For a SAVED lead the
  offline drop does nothing at all (no upload, no queue entry). Proven by the T-CH drop tests
  and repeated in the PR description.

## Verification

`check.sh quick` and `check.sh full` are run; all five test commands and all scope checks
pass; acceptance row 5 (version bump) is expected to fail until spec 08.
