# Design Document: Mobile Lead Card + Quick Create (spec 07)

## Overview

Spec 07 adds the two mobile presentation pieces of PART 4 and wires them minimally into
an already-rendered parent, the CRM kanban renderer. It covers **only**:

- **PART 4 item 2** — a mobile lead card (`CrmMobileLeadCard`).
- **PART 4 item 3** — a mobile quick create (`CrmMobileQuickCreate`), offered as a
  bottom sheet while offline on a small screen.

It also discharges the KL-A carry-forward from spec 06: a lead whose form was never
cached online, when tapped offline, must show an **in-card explanation** instead of a
blank region.

Spec 07 does **not** build the mobile pipeline (PART 4 item 1), the mobile kanban arch
(item 5), the browser tour, or the manifest version bump — all of those belong to
**spec 08**. Specifically, spec 08 re-wires the pending-create card into its stage column
of the pipeline, adds the tour that asserts the uncached-lead explanation (owning
acceptance row 9), and bumps the manifest version. In spec 07 the pending-create card is
rendered **from the Controller** as a full-width element **above** the renderer (above the
kanban columns), not inside a pipeline column; spec 08 moves each card into its pipeline
stage column.

Everything new is gated on the framework's small-screen signal (`ui.isSmall()` via
`useCrmOffline()`); desktop CRM rendering is unchanged. The offline sheet opens only on
`isSmall() && isOffline()`. No new offline machinery, no second cache, no change to queue
semantics, no data-model change, nothing outside `addons/crm/`, no new dependency. New
OWL code uses the plugin API (`useCrmOffline`, `usePlugin`, `signal`) only — never the
legacy offline service bridge.

### Allowed new files (exactly these; no others, no new globs)

- `addons/crm/static/src/mobile/crm_mobile_lead_card/crm_mobile_lead_card.js`, `.xml`, `.scss`
- `addons/crm/static/src/mobile/crm_mobile_quick_create/crm_mobile_quick_create.js`, `.xml`, `.scss`

Tests go in existing files: JS in `addons/crm/static/tests/crm_offline.test.js` (paired
desktop/mobile via `test.tags("desktop")` / `test.tags("mobile")`); Python appended to
class `TestCrmOffline` in `addons/crm/tests/test_crm_offline.py`. Wiring edits three
existing files: `addons/crm/static/src/mobile/crm_offline_hooks.js` (the shared hook: a new
read accessor `queuedWrites(resModel)` — Fact 15 / Fix 1; this is an **edited existing
file**, not a new file, so no new file or glob is introduced),
`addons/crm/static/src/views/crm_kanban/crm_kanban_renderer.js` (the
renderer: the per-card additive registration only) and the Controller subclass in
`addons/crm/static/src/views/crm_kanban/crm_kanban_view.js` (the Controller:
`isNewButtonAvailableOffline`/`createRecord` overrides **and** the pending-create strip
template). The hook's **existing** tests stay unchanged; a **new** test in
`crm_offline.test.js` covers the `queuedWrites` accessor (Fact 15 / Fix 1). The two new crm templates — the kanban-record inherit (card host) and the
kanban-**view** inherit (strip host) — live inside the component `.xml` files via
`t-inherit`, **not** new standalone template files. The manifest asset globs
(`web.assets_backend: 'crm/static/src/**'`; `web.assets_unit_tests:
'crm/static/tests/**/*.test.js'`) already pick these up — no glob is added or changed.
If design or implementation concludes any other new file is needed, that is an open
question to raise with the user, not an assumption to make.

## Architecture

### Facts established from code

These were established from code and approved. File:line references are hints; re-read
before relying on them during implementation.

**Fact 1 — Lead rendering on small screens / host parent.**
The pipeline kanban is `crm_case_kanban_view_leads` in
`addons/crm/views/crm_lead_views.xml` (lines 499–565), `js_class="crm_kanban"`. The card
arch `<t t-name="card">` (lines 524–561; verified this turn) shows, in order:
`<field class="fw-bold fs-5" name="name"/>` (line 525); a revenue block
`.o_kanban_card_crm_lead_revenue` (lines 526–537) holding `expected_revenue` (monetary,
`options="{'currency_field': 'company_currency'}"`) **plus** `recurring_revenue` +
`recurring_plan` (both `groups="crm.group_use_recurring_revenues"`); a partner block
`<div class="d-flex" invisible="not partner_id">` (lines 538–540) holding **two**
`partner_id` fields **only** (the `many2one_avatar` and the text one); and then
`contact_name` (line 541) and `partner_name` (line 542) as **separate top-level fields**,
**not** inside the partner div. There is no mobile-specific
card today; the same arch renders desktop and mobile. Rendering is driven by
`CrmKanbanRenderer` → `RottingKanbanRenderer` → web `KanbanRenderer`; `CrmKanbanView`
wires Model/Renderer/ArchParser/SearchModel (`crm_kanban_view.js`). Tapping a card offline
goes through web `KanbanRecord.getCardClasses`
(`addons/web/static/src/views/kanban/kanban_record.js:163`), which adds
`o_disabled_offline` to a card whose form is not cached:
`isOffline() && !isAvailableOffline(actionId, "form", resId)`. So an uncached lead's card
is visually disabled (tap target not clickable) offline; a cached lead's card taps through
to the form normally. There is no per-card reroute to a helper, and once an uncached form
opens it is a blank region (KL-A).

**Fact 2 — Bottom sheet.**
`BottomSheetPlugin.add(target, Component, props, options)` mounts a sheet and returns a
`remove()`. Spec 06 precedent: `CrmChatter.scheduleActivity()` (`crm_form.js:649`) calls
`this._bottomSheet.add(target, CrmActivityScheduleSheet, {...props, close: () =>
removeSheet()}, { class: "..." })`, with `_bottomSheet = usePlugin(BottomSheetPlugin)`.
The sheet component is a plain `Component` with `useProps`. The framework offline pass
disables `button:not([data-available-offline]):not([disabled])`. Spec 06's sheet carries
`data-available-offline` on both its Schedule and Discard buttons. `<select>`/`<input>`
are not `<button>`, so the selector pass does not disable them; but the brief requires
every quick-create field to carry the attribute, so `data-available-offline` goes on every
input/select **and** both sheet buttons (Create and Cancel). Tests assert the attribute is
present **and** the element is not `[disabled]` / `.o_disabled_offline` before interacting.

**Fact 3 — Reading a lead's queued state.**
`useCrmOffline().hasQueuedWrite(resModel, resId)` reads the framework `_ormToSync()` signal
(the same signal the systray reads); it matches any entry whose `value.model === resModel`
and whose `value.args[0]` (an array) includes `resId`. Called in render, so it re-renders
reactively. There is no second store and no local dirty flag. The queued calls that key on
`args[0]` = ids array on `crm.lead` are: `web_save` (edit), `web_unlink`/`unlink`,
`action_archive`, `action_set_won` (spec 04), the stage-move `web_save`, and
`activity_schedule`. `hasQueuedWrite("crm.lead", id)` catches them all. `action_feedback`
is on `mail.activity` (not the lead), so it does **not** flip the lead card — correct.
The framework kanban has no pending-sync visual; its only offline class is
`o_disabled_offline` for uncached cards. So the pending indicator introduced here is new
and duplicates nothing.

**Fact 4 — Quick-create queued call (corrected shape).**
Quick create queues a `crm.lead` CREATE via `web_save`, matching the framework's own
form-create offline enqueue (`record.js:1390–1400`, `_offlineSave`). That path calls:

```
scheduleORM(
  resModel,                                        // "crm.lead"
  "web_save",
  [[], offlineChanges],                            // args: EMPTY id list + the values dict
  { context: <root.context>, specification: {} },  // kwargs: context + specification:{}
  { id, extras: {...} }                            // options (extras — see Fact 13)
)
```

So the quick create queues exactly:
`scheduleORM("crm.lead", "web_save", [[], VALUES], { context: root.context, specification: {} }, { extras: EXTRAS })`,
where `VALUES` is **built from only the fields the user actually entered**: `name` is
**trimmed** and always present; `contact_name`, `phone`, and `email_from` are each trimmed
and **omitted when blank**; `expected_revenue` is **omitted when untouched** (empty / null /
undefined) and otherwise coerced to a Number; `stage_id` is included only when the stage
selector is enabled and a stage is chosen (omitted when the selector is disabled). A minimal
confirm (just a name) therefore queues `VALUES = { name }`. `EXTRAS.displayName` uses the
**trimmed** name (or `_t("New lead")` if somehow empty), and `EXTRAS.changes` is a shallow
copy of the same `VALUES`. No `create()`, no onchange.

**`specification` is mandatory.** `web_save`'s signature is
`web_save(self, vals, specification, next_id=None)` (`models.py:192`), so `specification`
MUST be present as a kwarg (`specification: {}`); an empty kwargs `{}` would raise
`TypeError` on replay (missing required positional argument). The kwargs therefore carry
both `context` and `specification: {}`.

**Context carries the pipeline defaults (Fix 3).** The queued create carries the kanban's
`root.context` verbatim in `kwargs.context`, exactly as `_offlineSave` passes `this.context`.
The pipeline actions set `default_type` (`crm_lead_views.xml` ~line 1027: the lead pipeline
sets `default_type: 'lead'`; the opportunity pipelines set `default_type: 'opportunity'`),
and some pipelines set `default_team_id`. The inline quick create already passes
`root.context`; passing it verbatim is the mechanism by which the replayed lead gets the
correct `type` (and team). The keys that matter are `default_type` and, where present,
`default_team_id`.

Fields the sheet captures: `name`, `contact_name` (free-text Char), `phone`, `email_from`,
`expected_revenue`, `stage_id` — but only the entered ones reach `VALUES` (empty optionals
are omitted, per the trim/omit rule above). `contact_name` is a plain Char, **not**
`partner_id` — so no partner is created offline and the quick create has no partner field at
all (satisfies the
"partner field must not create a contact offline" rule). Server defaults on create
(`user_id`, `team_id`, `type`) are server-applied defaults resolved on replay (seeded by the
context), not client onchanges — so the queued args contain only client-resolvable literals
and nothing needs a server onchange.

**Python replay must match the framework shape (corrected).** The earlier form
`web_save([], VALUES, specification={})` as a method call on a recordset is **wrong**: in a
`call_kw`, `args[0]` (the id list) becomes the recordset `self`, it is **not** a positional
argument. `web_save`'s signature is `web_save(self, vals, specification, next_id=None)`
(`models.py:192`), so `vals = args[1]`. The queued args `[[], VALUES]` therefore mean
"empty recordset `self`, `vals = VALUES`". The new spec-07 Python test in `TestCrmOffline`
replays the way the framework replays — one of:

- **Recordset form:**
  `self.env['crm.lead'].browse([]).with_context(**ctx).web_save(VALUES, specification={})`
  — note `VALUES` is the FIRST positional argument (`vals`), on an empty recordset.
- **Preferred — `call_kw` with the exact queued args/kwargs** (`call_kw` is
  `call_kw(model, name, args, kwargs)` at `odoo/service/model.py:31`):
  `odoo.service.model.call_kw(self.env['crm.lead'], "web_save", [[], VALUES], {"context": ctx, "specification": {}})`.

The preferred form is `call_kw` with args `[[], VALUES]` and kwargs
`{context, specification: {}}` — **identical** to what the JS test asserts is queued (Fact 4
shape), so the Python and JS lanes prove the same payload. The test runs it for **both** a
lead pipeline (context `default_type='lead'`) with a **full** payload (name + the optional
fields + stage) **and** an opportunity pipeline (context `default_type='opportunity'`) with a
**minimal** payload — name + stage_id only, mirroring the sheet's omit-empty behaviour when
the optional fields are left blank — and asserts the created `crm.lead` carries the entered
values, the chosen stage, and the correct `type` in each case. The minimal payload proves the
omit-empty create replays just as cleanly as the full one. Note: the existing seed test
`test_offline_websave_create_replay` is a different, pre-existing test and MUST NOT be
modified; the spec-07 test is a **new** method using the corrected shape above.

**Fact 13 — Systray extras on the queued create (Blocker 2).**
The offline systray reads, for **every** entry (`offline_systray.js:31–61`):
`value.extras.timeStamp`, `value.extras.actionName`, `value.extras.displayName`, and — for a
`web_save` CREATE (`args[0].length === 0`, `STATUS.CREATED`) — `Object.entries(value.extras.changes)`.
`isClickable` (`offline_systray.js:81`) reads `value.extras.viewType` and
`value.extras.actionId`. A queued create with **no** extras throws when the systray renders
(the same class of crash as spec 06's `status.color`). So the queued create MUST carry
`extras`:

```
extras: {
  actionId,                                 // from extrasBase (see below)
  actionName,                               // from extrasBase
  viewType,                                 // from extrasBase (kanban) — create is NOT clickable (fine, no crash)
  displayName: <entered name, or _t("New lead")>,
  changes:    <plain object {field: displayValue}, same shape as the framework's `changes`>,
  timeStamp:  Date.now(),
}
```

**Where `actionId`/`actionName`/`viewType` come from (the sheet has no `env.config`).** A
bottom-sheet `Component` has **no** model and **no** `env.config` of its own, so it cannot
read `model.env.config.actionId` itself. The Controller — which **does** have
`this.env.config` and `this.model` — builds an **extras base**
`{ actionId, actionName, viewType }` from `this.env.config` (exactly the three fields
`getScheduleORMExtras` reads from `model.env.config`) and passes it to the sheet as the
`extrasBase` prop (along with `context` = `root.context`). The sheet fills `displayName`
(the entered name), `changes`, and `timeStamp` at Create time, then spreads `extrasBase`
into the final `EXTRAS`. CRM does **not** call the public helper
`getScheduleORMExtras(model, records)` (web model `utils.js:868`, exported) with `[]`: that
helper computes `displayName` via `getOfflineDisplayName(records[0])`, which throws when
`records` is `[]`. So the Controller pulls the three base fields from `env.config` the same
way `getScheduleORMExtras` does, and the sheet adds `displayName`/`changes`/`timeStamp`. `originalValues` is read by the systray only
for an EDIT (`args[0].length` truthy), so a create does **not** need `originalValues`.
Because `viewType` is the kanban view type, the create row renders in the systray but is not
clickable — which is correct and avoids a reroute.

**Fact 14 — Client-side quick-create validation (Fix 5).**
`crm.lead.name` is required (`crm_lead.py:104`; `name` is the `_rec_name` and required). The
sheet validates on the client before queuing anything:
- **Empty `name`:** Create does NOTHING; it marks the name field invalid (`is-invalid`
  styling / required marker) and queues NOTHING (the queue is unchanged/empty).
- **Non-numeric `expected_revenue` or malformed `email_from`:** Create does nothing; it marks
  the offending field invalid and queues nothing.

Validation is client-side only — no server round-trip. Create and Cancel keep
`data-available-offline` throughout; an invalid/disabled state must NOT remove the attribute
(the button stays offline-usable, it just refuses to queue an invalid payload). A guard
reachable only programmatically (confirm handler called directly with an empty name) returns
without queuing.

**Fact 15 — Hook read accessor `queuedWrites(resModel)` for the strip (Fix 1; verified
`crm_offline_hooks.js:29–43` this turn).**
`useCrmOffline()` today exposes a **boolean** predicate `hasQueuedWrite(resModel, resId)` and
**no** list accessor. The strip (Fact 11) needs the queue **entries** for `crm.lead`, not a
boolean, and PART 4 item 4 requires every mobile component — including the Controller — to
consume the shared hook; the Controller MUST NOT resolve `OfflinePlugin` itself. DECISION:
add **one** read accessor to the hook, `queuedWrites(resModel)`, built on the **same**
`offline._ormToSync()` signal the hook already reads — **no second store, no new machinery.**
Signature: `queuedWrites(resModel)` reads the signal **at call time** (so it stays reactive,
exactly like `hasQueuedWrite`), filters `Object.values(offline._ormToSync())` to entries
whose `value.model === resModel`, and returns an **array of those entries' `value` objects**
(each `{ model, method, args, kwargs, extras }`). This edit to `crm_offline_hooks.js` is
**allowed** — it is an existing file, not a new file (so no new file/glob is introduced).
The hook's **existing** tests stay unchanged; a **new** test covers the accessor: it returns
only the requested model's entries, updates when the queue changes, and is empty when there
are none — with a removal check (remove the production `queuedWrites` read in the strip
derivation → the strip test goes red). The strip derivation in the Controller calls
`this.crmOffline.queuedWrites("crm.lead")` and filters to empty-id `web_save` entries
(`args[0]` empty), reading each entry's `value` (`args`/`kwargs`/`extras`) directly — it
never resolves `OfflinePlugin`.

**Fact 16 — Pipeline-board gate (every spec-07 mobile addition is restricted to the
stage_id board).**
Every new spec-07 mobile addition — the offline New-button override
(`isNewButtonAvailableOffline`), the quick-create sheet (`createRecord`), the pending-create
strip (`pendingCreateCards`), and the injected mobile card — is restricted to the board
**grouped by `stage_id`**. The Controller exposes a single getter
`get _crmMobileStageBoard() { return this.model.root.groupByField?.name === "stage_id"; }`,
and all three Controller entry points guard on it (`_crmMobileStageBoard && isSmall() &&
isOffline()` for the New-button/sheet overrides; `_crmMobileStageBoard && isSmall()` for the
strip). The injected mobile card is gated by the **same** check inline in the card-host
template's `t-if`
(`this.props.record.model.root.groupByField && ... .groupByField.name === 'stage_id'`), so the
`CrmMobileLeadCard` is not injected on a non-stage board either.

**Why the gate exists.** The forecast kanban (`crm_lead_view_kanban_forecast`,
`js_class="forecast_kanban"`, `crm_lead_views.xml`) extends the **same** stack:
`ForecastKanbanController extends crmKanbanView.Controller`, and the forecast renderer extends
`CrmKanbanRenderer`. But the forecast board is **grouped by `date_deadline`** and is a
DISABLE-offline surface. Without the gate it would **inherit** every spec-07 mobile addition:
offline on a phone its New button would be force-enabled, the quick-create sheet would open,
the strip/selector would treat **date** groups as stages, and the mobile card would inject.
The `_crmMobileStageBoard` gate (and the matching template `t-if`) keep all of it off the
forecast board.

**Proof.** A mobile test mounts the **real** `forecast_kanban` view grouped by
`date_deadline` offline and asserts **none** of the spec-07 behaviour appears: tapping New
opens **no** sheet, there is **no** pending-create strip, and **no** `CrmMobileLeadCard` is
injected. A removal check (force `_crmMobileStageBoard` to return `true` unconditionally) turns
the forecast test red (New opens the sheet, the strip appears, the card injects).

**Fact 5 — Stage list offline (do not use the many2x cache; read groups correctly).**
The many2x cache (`relational_model.js:281–315`) is filled only from many2one values on
loaded records, needs a secure context, and never caches a stage that has no leads — so it
must **not** be the stage source for the selector (missing stages would be wrong). Instead
the stage list is read from the kanban model's loaded groups (`root.groups`), served offline
by the framework's cached grouped read.

**How a group exposes its stage (corrected).** A kanban `Group` (`group.js:8–30`) has **no**
`name` and **no** `order`; its `id` is a datapoint id, not the server stage id. Read:
- the **stage id** from `group.serverValue` (the raw server id; `group.value` is the
  formatted value, not the id),
- the **label** from `group.displayName`,
- the **order** from the ARRAY ORDER of `root.groups` (first group = default stage).

Folded groups are present in `root.groups` too (`group.isFolded` is a getter), so a folded
stage is still listed.

`crm.lead.stage_id` carries `group_expand='_read_group_stage_ids'` (`crm_lead.py:136` —
verified), so empty stages appear as groups too, and the framework caches the grouped read
for offline. This is no second cache and no prefetch. A test proves that an offline-loaded
grouped kanban still carries its groups — including an EMPTY one and a FOLDED one — and that
the empty stage is selectable in the sheet offline.

**Active search filter.** When a search filter is active, the grouped read reflects the
active search domain, so the selector lists exactly the stages present in the
filtered/cached groups (`group_expand` still includes empty in-scope stages). This is
acceptable **behavior**, not a bug: the user sees the stages in scope for the current
filtered board.

**The "no stage" group is not an option.** A grouped kanban can carry a group whose
`serverValue` is falsy (the "None" / no-`stage_id` group). That group MUST NOT become a
stage option: an option with a falsy value cannot name a real stage. The selector filters
out any group whose `serverValue` is falsy, and a test asserts the "None" group yields no
option while real empty/folded stages do.

If nothing is available (no groups, or every group filtered out) the selector is disabled.
There is no stage-cache known limitation here. Default stage: the first **non-falsy-value**
group in array order; if the selector is disabled the create carries no `stage_id` and the
server assigns the default stage on replay.

**Fact 6 — Uncached-lead explanation (KL-A); user decision Q1 = in-card message.**
The explanation is an in-card message, not the real `OfflineActionHelper`.
`OfflineActionHelper` reads `env.config` + `env.searchModel` and its text / Reset-Filters
are about search filters, which do not fit a single card. The uncached state is detected
via the public `isAvailableOffline(actionId, "form", resId)` already wrapped by
`useCrmOffline()` — no web change, nothing outside `addons/crm/`. Because the framework
disables the card tap target for an uncached lead offline (`o_disabled_offline`), the
message must **not** depend on a click: it renders as part of the card's own state whenever
`isSmall() && isOffline() && !isAvailableOffline(actionId, "form", resId)`. A cached lead
renders no message and keeps normal tap behavior. The message is translatable (`_t`) and
states plainly that this lead was not opened online so it is not available offline. It is a
non-button element; if any part of it is interactive it carries `data-available-offline`.
A test asserts the message element exists for an uncached lead **and** is absent for a
cached one (both assertions), on mobile + offline; desktop renders neither card nor
message. Spec 08 asserts the same through the pipeline and owns acceptance row 9.

**Fact 7 — 44×44 touch targets (clarified; where each is measured — Fix 4).**
One `.scss` per component dir (`crm_mobile_lead_card.scss`,
`crm_mobile_quick_create.scss`), picked up by the `web.assets_backend` glob
`crm/static/src/**`. The mobile lead card has **no button** of its own: the card's touch
target is the kanban **article / card tap area** (the whole card is the tap surface that
opens the form). So 44×44 applies as a `min-height` on the card root/article tap surface,
not on an in-card button. The in-card uncached-lead message is **not interactive** (it is
text) — it carries **no** 44px requirement. On the **sheet**, 44×44 applies to the inputs,
the stage `<select>`, and the Create/Cancel buttons.

**The article belongs to the real board, not the standalone card (Fix 4).** The `<article>`
tap surface is rendered by `web.KanbanRecord`/`web.CardRenderer`, **not** by
`CrmMobileLeadCard`; a standalone-mounted `CrmMobileLeadCard` has **no** article wrapper. So
the 44px card tap-surface height can only be measured on the **real** `crm_kanban` board. A
test therefore measures the `>= 44px` card tap-surface height on the **real board** (in the
real-board test, reading `getBoundingClientRect()` / computed `min-height` on the article),
and keeps only the render/format checks (name/partner/revenue, `formatMonetary`) on the
standalone-mounted card. The sheet's `44×44` controls are measured on the **mounted sheet**
(DOM geometry, not a private field). (Requirements 1.4/1.5 should read as "the card tap
surface is `>= 44px` tall, measured on the real board; the sheet's interactive controls are
`>= 44×44`.")

**Fact 8 — Where code lives.**
As in the "Allowed new files" list above. Manifest globs already cover the new paths; no
glob is added.

**Fact 9 — Quick-create entry point; user decision Q2 = the New button, offline only.**
The kanban New button is not unconditionally available offline:
`isNewButtonAvailableOffline` (`kanban_controller.js:477`) returns
`isAvailableOffline(actionId, "kanban_quick_create", false)`, so offline the button is
disabled unless the framework cached the inline quick-create view. `createRecord()`
(`kanban_controller.js`) with `onCreate === "quick_create"` opens the inline kanban
quick-create in the first group. CRM already has a Controller subclass in
`crm_kanban_view.js` and its own button template `crm.Kanban.Buttons`. On a small screen,
offline, the subclass overrides `isNewButtonAvailableOffline` (return `true`) **and**
`createRecord()` (open the `CrmMobileQuickCreate` sheet instead of the inline
quick-create). Online or desktop, both fall through to `super` unchanged (the existing
inline kanban quick-create). Reported replacement target: offline today, the inline
quick-create is the view the framework may or may not have cached; when uncached the New
button is disabled, so there is no offline create path at all — that is what spec 07
replaces on small screens.

**Fact 10 — User decision Q3 = quick create is offline-only.**
Online on a small screen keeps the existing inline quick create, unchanged (spec 06
followed the same pattern: online keeps the wizard). This is an explicit decision. The
sheet opens only on `isSmall() && isOffline()`.

**Fact 11 — User decision Q4 = pending indicator for a queued create is owned by spec 07
(strip anchor RESOLVED; strip scope + stage-label resolution).**
Lane 2 requires "mobile quick create queues a create offline and shows the pending-sync
indicator." The pending CREATE rows are derived from the queue (`crm.lead` `web_save`
entries with an **empty** id list), read from the framework the same way spec 06 derived
optimistic activity rows (from `_ormToSync` via the hook) — no second store. The Controller
reads them through the hook accessor `this.crmOffline.queuedWrites("crm.lead")` (Fact 15 /
Fix 1), filtering to entries with an empty `args[0]`; it does **not** resolve `OfflinePlugin`
itself. Each queued create is rendered **from the Controller** as a `CrmMobileLeadCard` with
a pending indicator in a full-width element **above** the renderer (above the kanban columns;
Fix 6), showing `name`, `contact_name`, revenue and stage from the queued values. Spec 08
moves each card into its pipeline stage column.

**Parked vs pending marker on a strip card (Fix 5).** A strip card's queue entry may be
**parked** by the framework with `extras.error` (a rejected replay). Following spec 06's
activity choice, a parked entry's strip card shows a translatable **"needs retry"** marker
derived from `extras.error` (read via the hook accessor's returned `value.extras.error`),
with **no** CRM-specific error UI and **no** dialog — the systray remains the only error
surface. A **non-parked** queued create (no `extras.error`) shows the normal **"pending
sync"** indicator. Every field read is guarded so a parked card does not crash.

**Strip anchor — RESOLVED (verified this turn), strip is a CONTROLLER sibling, not a
renderer child.** `web.KanbanRenderer`'s root (`kanban_renderer.xml:4–9`) is
`<div class="o_kanban_renderer o_renderer d-flex user-select-none" ...>` — a **horizontal
flex** container whose direct children are `.o_kanban_group` columns. A strip inserted at
the start of the renderer root would become another **column**, not a full-width row. So the
strip does **not** live in the renderer. Instead it renders **outside** the renderer root,
as a full-width sibling **above** the Renderer, in the **controller** template.
`web.KanbanView` (`kanban_controller.xml`) places `<t t-component="this.props.Renderer" ...>`
inside `<Layout>`, with an existing sibling `<t t-elif="this.model.couldNotLoadRootOffline">
<OfflineActionHelper/></t>`. CRM adds a **primary** inherit of `web.KanbanView`
(`t-inherit-mode="primary"`, authored in the allowed `crm_mobile_lead_card.xml` — no new
standalone template file), inserting the strip element with `position="before"` the
`<t t-component="this.props.Renderer">` node, gated on `isSmall()`. The strip is a
full-width block (e.g. `<div class="o_crm_mobile_pending_strip w-100">`) above the
renderer's flex row. `crmKanbanView.Controller` (`crm_kanban_view.js`) sets its
`static template` to that crm template; the Controller therefore **owns** the strip template
**and** the `createRecord` / `isNewButtonAvailableOffline` overrides (Fact 9) — one coherent
owner. The renderer still only hosts the per-card additive wiring (Fact 12). A test asserts
the strip DOM node is **before** the columns container, spans **full width**, and the columns
still lay out normally.

**Strip scope — show every empty-id `crm.lead` `web_save`, regardless of origin.** The queue
also holds `crm.lead` creates made via the **form** view offline (spec 04 path), and from
other actions. DECISION: the strip shows **every** `crm.lead` `web_save`-with-empty-id entry
in the queue regardless of origin (quick-create or form) and regardless of `actionId` — any
offline-created lead is pending and worth showing. It is **not** filtered by `actionId`. A
test asserts a create queued from another path still shows in the strip.

**Stage label resolution for a queued create.** The queued `stage_id` is an **id**. Resolve
its label **only** from the loaded groups: the Controller reduces `root.groups` to a
`stageGroups` prop (`{ serverValue, displayName }` per group) and passes it to the strip
card; the card matches `group.serverValue === stage_id` → uses `group.displayName`. If no
group matches (or the queued create carries no `stage_id`), the card shows **no** stage —
there is **no** `extras.changes` / `_stageLabel` fallback (that dead code was removed). A
test exercises the label resolution.

What is deferred to spec 08 is only placing that card inside its stage column of the
pipeline. If a queued create is rejected on replay, the framework systray surfaces it; the
strip card must not break — every field read is guarded so a missing field does not crash.

**Fact 12 — Card wiring is additive, not a swap (critical).**
web `KanbanRecord` carries `onGlobalClick` (open/select), `onTouchStart`/`End` (long-touch
selection + drag threshold), `triggerAction` (menu open/archive/delete/set_cover),
`getCardClasses` (`o_disabled_offline`, `o_draggable`, color, selection), the dropdown
menu, and the arch-compiled card body (`web.KanbanRecord` `t-inherit="web.CardRenderer"`)
including the `kanban_activity` and priority widgets. Replacing the card/template would
lose all of this.

**Card position inside the article (Fix 2; verified `card_renderer.xml` + `kanban_record.xml`
this turn).** `web.CardRenderer` is `<article ...>` whose **first** child is the compiled card
arch body (`<t t-call="{{ this.templates[...CARD_ATTRIBUTE] }}"/>`); `web.KanbanRecord`
(`t-inherit="web.CardRenderer"`) then APPENDS the selection span and the menu template with
`<xpath expr="article" position="inside">`. So `position="inside"` would place the mobile card
**after** the arch body (and below the footer widgets). To render the mobile card **above** the
arch body, CRM's **primary** inherit of `web.KanbanRecord` (`t-name="crm.MobileKanbanRecord"`)
inserts `<CrmMobileLeadCard .../>` as the **first** child of the article using
`<xpath expr="article/*[1]" position="before">` (before the first node inside the article),
gated on `isSmall()`. **DOM order is therefore:** the `CrmMobileLeadCard` comes **first** in
the article, then the (partially hidden) arch body with its footer `priority`/`activity`
widgets. A `CrmKanbanRecord` subclass sets its `static template` to that crm template and
registers `CrmMobileLeadCard` as a component. Because content is only **added** to the article
(the arch body is untouched), drag/drop, the card menu, selection, and the activity/priority
widgets all keep working offline — nothing is swapped, so nothing breaks. `CrmKanbanRenderer`
registers `CrmKanbanRecord` as its `KanbanRecord` component (static components override). The
SCSS hide rules and a DOM-order test must agree with this order: the mobile-card node precedes
the kept footer `priority`/`activity` widgets in document order; a test asserts the
`CrmMobileLeadCard` node appears **before** the footer `priority`/`activity` widgets in the
DOM.

**Avoiding duplicated text on screen (Fix 6; corrected hide rule — verified arch
`crm_lead_views.xml:525–542`).** The additive `CrmMobileLeadCard` renders `name`, the
partner/contact name and `expected_revenue` again, next to the arch's own card body — so
without a hide rule the lead text would appear twice. SCSS hides **only the specific
duplicated nodes**, scoped by `.o_kanban_record:has(.o_crm_mobile_lead_card)` (true only when
the mobile card is injected — i.e. only on small screens, since the template gates the card on
`isSmall()`; on desktop the card is absent and the arch renders untouched), so the lead text
appears **once** while nothing else is lost. The hide rule uses `display: none !important`:
the `!important` is required to beat the Bootstrap display utilities the arch nodes carry (the
partner block is `<div class="d-flex ...">`, so a plain `display: none` would lose to
`.d-flex`'s own `display`). Because a rendered **widget-less** `<field>` drops its `name`
attribute (the card compiler strips it), the rule cannot target `[name=...]`; it instead
targets **marker CLASSES added to the arch** in `crm_lead_views.xml` — `o_crm_card_name`,
`o_crm_card_expected_revenue`, `o_crm_card_partner`, `o_crm_card_contact_name`,
`o_crm_card_partner_name`. The verified arch structure is:
- `name`: `<field class="fw-bold fs-5" name="name"/>` (line 525).
- revenue block `.o_kanban_card_crm_lead_revenue` (526–537): holds `expected_revenue`
  (monetary) **and** `recurring_revenue` + `recurring_plan` (both
  `groups="crm.group_use_recurring_revenues"`).
- partner block `<div class="d-flex" invisible="not partner_id">` (538–540): holds **two**
  `partner_id` fields **only**.
- `contact_name` (541) and `partner_name` (542): **separate top-level** fields, **not** in
  the partner div.

So the hide rule, scoped under `.o_kanban_record:has(.o_crm_mobile_lead_card)` and using
`display: none !important`, hides exactly these marker-class nodes:
- the arch name node (`.o_crm_card_name` — the `fw-bold fs-5` `name` field),
- the `expected_revenue` field element (`.o_crm_card_expected_revenue`) **inside**
  `.o_kanban_card_crm_lead_revenue` (NOT the whole block — hiding the block would also hide
  recurring revenue + plan),
- the partner block `<div class="d-flex o_crm_card_partner">` (the `!important` beats its
  `.d-flex` display utility),
- the `contact_name` field element (`.o_crm_card_contact_name`), and the `partner_name` field
  element (`.o_crm_card_partner_name`).

The recurring-revenue part (`<span> + </span>` + `recurring_revenue` + `recurring_plan`)
inside `.o_kanban_card_crm_lead_revenue` stays **visible** — the mobile card does not
reproduce it, so hiding it would lose data. Kept visible too: the footer widgets `priority`
and `activity_ids`/`kanban_activity` (plus rotting / team / `user_id`), which live in the
arch card's `<footer>` subtree the hide rules never touch. The arch body stays fully mounted
for behavior; only the duplicated text nodes are visually hidden on small screens. A test
asserts the visible lead name appears **once**, and that for a lead **with** recurring
revenue the recurring part is still shown **once** (no data lost).

**Monetary formatting of `expected_revenue` on the card.** The mobile card formats
`expected_revenue` as **monetary** with the record's currency, using the framework formatter
`formatMonetary` imported from `@web/views/fields/formatters`, applied with the record's
`company_currency` (the same `currency_field` the arch's monetary widget uses). It is NOT a
bare number. In queued-create mode the raw entered amount is formatted the same way when a
currency is resolvable, else shown plainly.

### Behavior

#### Current behavior

- The pipeline kanban renders the same card arch on desktop and mobile; there is no
  mobile-specific card (Fact 1).
- Offline, an uncached lead's card is visually disabled (`o_disabled_offline`) and not
  tappable; a cached lead taps through to its form. An uncached form, once opened, is a
  blank region (KL-A; Fact 1).
- Offline, the kanban New button is disabled unless the framework cached the inline
  quick-create view; when enabled it opens the inline kanban quick-create in the first
  group (Fact 9). There is no mobile quick-create sheet.
- The kanban has no pending-sync visual; its only offline class is `o_disabled_offline`
  (Fact 3).

#### Expected behavior (new, mobile + the stated offline gates)

- On a small screen, each lead card additively renders a `CrmMobileLeadCard` inside the
  kanban article, preserving all existing card behavior (Fact 12).
- Offline on a small screen, a lead with a queued write shows a pending-sync indicator
  (Fact 3); an uncached lead shows the translatable in-card explanation instead of being a
  silent disabled card (Fact 6).
- Offline on a small screen, the New button stays enabled and opens the
  `CrmMobileQuickCreate` bottom sheet; filling it and pressing Create queues a self-
  contained `web_save` create with an empty id list (Fact 4) and renders a pending-create
  strip card (Fact 11).
- The stage selector in the sheet is populated from the cached grouped read (`root.groups`),
  including empty stages, and is disabled only when no groups are available (Fact 5).

#### Unchanged behavior

- Desktop CRM: no mobile card, no sheet, no strip, no in-card message — everything new is
  gated on `isSmall()`.
- Online on any screen: the New button and quick create behave exactly as before (the
  inline kanban quick-create); the sheet never opens online (Fact 10).
- Queue conflict semantics (timestamp-ordered replay, last-write-wins, parked failures in
  the existing systray) are unchanged; no second cache, no data-model change, nothing
  outside `addons/crm/`, no new dependency.
- All preserved web `KanbanRecord` behavior (click/touch/menu/drag/selection, activity and
  priority widgets, `o_disabled_offline`) because wiring is additive, not a swap (Fact 12).

### Offline-sync flows

#### Offline-sync flow for the card

1. A lead is edited (or moved/archived/won/scheduled) offline. The framework queues the
   corresponding `crm.lead` call keyed on `args[0]` = `[resId]` (Fact 3).
2. `CrmMobileLeadCard` reads `hasQueuedWrite("crm.lead", resId)` in render; it is now true,
   so the pending-sync indicator shows. This is reactive (reads the `_ormToSync()` signal
   via the hook) — no manual refresh, no second store.
3. On reconnect, the framework drains the queue (timestamp-ordered, last-write-wins). As the
   entry leaves `_ormToSync()`, `hasQueuedWrite(...)` returns false and the indicator
   clears on the next render.
4. `action_feedback` entries are on `mail.activity`, so they never flip the lead card's
   indicator (Fact 3) — correct.

#### Offline-sync flow for the quick create

1. Offline on a small screen, the user taps New; the Controller subclass opens the
   `CrmMobileQuickCreate` bottom sheet (Fact 9). Every field, Create, and Cancel carry
   `data-available-offline` and are not disabled (Fact 2).
2. The user fills `name`, `contact_name`, `phone`, `email_from`, `expected_revenue`, and
   picks a stage from `root.groups` (or leaves it unset if the selector is disabled; Fact 5).
3. On Create (only when `name` and the other fields pass client-side validation, Fact 14),
   the component queues
   `scheduleORM("crm.lead", "web_save", [[], VALUES], { context: root.context, specification: {} }, { extras: EXTRAS })`
   — a self-contained create with an empty id list, mandatory `specification: {}`, the
   pipeline `context`, and systray `extras`, needing no server onchange and no id produced
   by another queued call (Facts 4 and 13). The sheet closes via `close()`.
4. The strip host (the `crmKanbanView.Controller` template, a full-width sibling above the
   renderer) derives the new queued create via `this.crmOffline.queuedWrites("crm.lead")`
   (Fact 15 / Fix 1) — not by resolving `OfflinePlugin` — and renders an optimistic strip
   card (`CrmMobileLeadCard` in queued-create mode) showing the entered values and the
   chosen stage (label resolved only from the loaded groups via the `stageGroups` prop). A
   non-parked entry shows the
   "pending sync" indicator; a parked entry (`extras.error`) shows the "needs retry" marker
   (Fact 11 / Fix 5).
5. On reconnect, the framework replays the `web_save` create; the server applies its own
   defaults (`user_id`, `team_id`, `type`) and the chosen stage (Fact 4). As the entry
   drains, the strip card's queued row disappears on the next render.
6. If the replay is rejected, the framework systray surfaces the parked entry for manual
   retry (unchanged queue semantics); the strip card does not crash — every field read is
   guarded (Fact 11).

## Components and Interfaces

### `CrmMobileLeadCard` (`crm_mobile_lead_card.js` / `.xml` / `.scss`)

**Purpose.** The mobile presentation of a lead. Used in two modes:
1. **Record mode** — rendered inside the kanban article (additive, Fact 12) for a real
   `crm.lead` record on the board.
2. **Queued-create mode** — rendered in the host's pending-create strip for a queued
   offline create (Fact 11).

**Props** (OWL 3 `useProps`):
- `record` (optional) — the kanban record, present in record mode.
- `queuedValues` (optional) — `{name, contact_name, phone, email_from, expected_revenue,
  stage_id}` read from the queue, present in queued-create mode.
- `parkedError` (optional) — the queued create entry's `extras.error`, if the entry is
  parked; present (truthy) only in queued-create mode for a rejected replay (Fact 11 / Fix 5).
- `actionId` (optional) — the current action id, used for the uncached check.
- `stageGroups` (optional) — the loaded groups reduced to `{ serverValue, displayName }`
  (the Controller's `pendingStageGroups`), present in queued-create mode; the card resolves
  the queued `stage_id`'s label **only** from this (`serverValue` match → `displayName`), with
  no `extras.changes` fallback (Fact 11).

Exactly one of `record` / `queuedValues` is set. Every field read is guarded (Fact 11), so
a missing field renders empty rather than throwing.

**Reads.** `useCrmOffline()` for `isSmall()`, `isOffline()`, `hasQueuedWrite(model, id)`,
and `isAvailableOffline(actionId, "form", resId)`. No other plugin is resolved directly
(constraint: plugin API only).

**Imports.** `formatMonetary` from `@web/views/fields/formatters` (Fact 12 / Item 3), used
to format `expected_revenue` with the record's `company_currency`.

**Renders.**
- `name`, the partner/contact name (`partner_id` display name, falling back to
  `contact_name`/`partner_name`), and `expected_revenue` — the latter formatted via
  `formatMonetary` with the record's `company_currency` (not a bare number) — from `record`
  in record mode or from `queuedValues` in queued-create mode.
- **Pending / needs-retry indicator:** in record mode, the "pending sync" indicator is
  shown when `hasQueuedWrite("crm.lead", record.resId)` is true (Fact 3). In queued-create
  mode the card always shows a marker: **"pending sync"** when `parkedError` is falsy, or a
  translatable **"needs retry"** marker (derived from `parkedError` = `extras.error`) when
  the entry is parked — no CRM-specific error UI or dialog; the systray stays the only error
  surface (Fact 11 / Fix 5).
- **Uncached-lead message:** in record mode, shown when `isSmall() && isOffline() &&
  !isAvailableOffline(actionId, "form", resId)` (Fact 6); translatable via `_t`;
  **non-interactive text** (no 44px requirement, Fact 7). Not shown in queued-create mode.
- The card's touch target is the **kanban article / card tap area** (the whole card is the
  tap surface that opens the form); `.scss` sets `min-height: 44px` on that card
  root/article tap surface (Fact 7). The card has no button of its own.

**Template.** Lives in `crm_mobile_lead_card.xml` as the component template.

### `CrmMobileQuickCreate` (`crm_mobile_quick_create.js` / `.xml` / `.scss`)

**Purpose.** The offline mobile quick-create, mounted as a bottom sheet (Fact 2).

**Props** (`useProps`): `close` (callback to remove the sheet), `groups` (`root.groups` for
the stage selector), `context` (`root.context`, carried into the queued create's kwargs,
Fact 4 / Fix 3), and `extrasBase` (`{ actionId, actionName, viewType }` built by the
Controller from its `env.config`, Fact 13 / Item 6). The sheet has **no** model and no
`env.config` of its own, so it does **not** read `model.env.config`; it receives `context`
and `extrasBase` as props and fills `displayName`/`changes`/`timeStamp` at Create time.

**Fields:** `name`, `contact_name` (free-text Char), `phone`, `email_from`,
`expected_revenue`, `stage_id`. No partner field (Fact 4). The stage selector is a
`<select>` populated from `props.groups`; each option's **value** is `group.serverValue` (the
raw server stage id) and its **label** is `group.displayName`, in the array order of
`props.groups`, including empty and folded groups (Fact 5). **A group whose `serverValue` is
falsy (the "None" / no-stage group) is filtered out and does not become an option** (Fact 5
/ Item 8). The default stage is the first **non-falsy-value** group in array order. If no
usable groups remain, the stage selector is disabled and the create carries no `stage_id`
(the server assigns the default on replay, Fact 5).

**Offline-availability.** Every input/select **and** both buttons (Create and Cancel) carry
`data-available-offline` (Fact 2 / constraints). Create and Cancel are `<button>`; without
the attribute the framework offline pass would disable them. The attribute stays on Create
and Cancel **throughout** — a disabled/invalid state does NOT remove it (the button stays
offline-usable; it simply refuses to queue an invalid payload, Fact 14).

**Create action.** On Create, after client-side validation passes (Fact 14): queue
`scheduleORM("crm.lead", "web_save", [[], VALUES], { context: props.context, specification: {} }, { extras: EXTRAS })`
via `useCrmOffline()` (empty id list, mandatory `specification: {}`, pipeline `context`, and
systray `extras`; Facts 4 and 13), then call `close()` to remove the sheet. The host picks up
the new queued entry reactively and renders the strip card (Fact 11). `VALUES` carries only
the fields the user actually entered: `name` is **trimmed**; `contact_name`/`phone`/
`email_from` are trimmed and **omitted when blank**; `expected_revenue` is **omitted when
untouched** (empty/null/undefined) and otherwise coerced to a Number; `stage_id` is omitted
when the selector is disabled or no stage is chosen. `EXTRAS` is assembled by spreading
`props.extrasBase` (`{ actionId, actionName, viewType }` the Controller built from
`env.config`) and adding `displayName` (the **trimmed** name, or `_t("New lead")`), `changes`
(a shallow copy of `VALUES`), and `timeStamp: Date.now()` (Fact 13 / Item 6). It is
**not** obtained from `getScheduleORMExtras([])` (which would throw on `records[0]`), and the
sheet does **not** read `model.env.config` itself.

**Client-side validation (Fix 5, Fact 14).**
- **Empty name.** `crm.lead.name` is required (`crm_lead.py:104`). On Create with an empty
  name the sheet does NOTHING: it marks the name field invalid (`is-invalid` styling /
  required marker) and queues NOTHING (the queue is unchanged/empty). No server round-trip.
- **Invalid `expected_revenue` (non-numeric) or malformed `email_from`.** On Create the sheet
  does nothing and marks the offending field invalid; it queues nothing. Client-side only.
- A guard reachable only programmatically (e.g. calling the confirm handler directly with an
  empty name) returns without queuing and is tested by calling it directly.

### `CrmKanbanRecord` + crm kanban-record template (additive host, Fact 12)

A `CrmKanbanRecord` extends web `KanbanRecord` and sets its `static template` to a crm
template authored as a **primary** inherit:
`t-name="crm.MobileKanbanRecord" t-inherit="web.KanbanRecord" t-inherit-mode="primary"`.
A **primary** inherit (not an extension) is required so the inherit does **not** mutate
`web.KanbanRecord` for every other view; only `CrmKanbanRecord` (whose `static template =
"crm.MobileKanbanRecord"`) uses it. The inherit inserts the mobile card as the **first**
child of the article with `<xpath expr="article/*[1]" position="before">` (Fix 2 — verified
`card_renderer.xml`/`kanban_record.xml` this turn: `position="inside"` would land the card
**after** the arch body and its footer widgets, so `before` the first node is required to put
the card **above** the arch body), adding `<CrmMobileLeadCard record="props.record"
actionId="env.config.actionId"/>` gated on `isSmall()` **and** on the pipeline board (the same
stage_id check as Fact 16, inline in the `t-if`:
`record.model.root.groupByField && record.model.root.groupByField.name === 'stage_id'`, so the
card is not injected on the forecast `date_deadline` board), and the subclass registers
`CrmMobileLeadCard` in `static components`. **DOM order:** the `CrmMobileLeadCard` is first in
the article, then the (partially hidden) arch body with its footer `priority`/`activity`
widgets. The arch body is untouched, so all web
`KanbanRecord` behavior (click, touch, menu, drag, selection, activity/priority widgets,
`o_disabled_offline`) is preserved offline. The template lives inside the component `.xml`
(`crm_mobile_lead_card.xml`), **not** a new standalone template file. A DOM-order test
asserts the mobile card node appears **before** the footer `priority`/`activity` widgets, and
the SCSS hide rules agree with that order.

### Shared hook addition (`crm_offline_hooks.js`) — `queuedWrites(resModel)` (Fix 1 / Fact 15)

`crm_offline_hooks.js` is an **existing** file (not a new file), so this edit introduces no
new file or glob. `useCrmOffline()` gains **one** read accessor alongside the existing
`hasQueuedWrite`:

```
queuedWrites: (resModel) =>
    Object.values(offline._ormToSync())
        .map(({ value }) => value)
        .filter((value) => value.model === resModel),
```

It reads `offline._ormToSync()` **at call time** (reactive, like `hasQueuedWrite`), on the
**same** signal the hook already reads — no second store, no new machinery. It returns an
**array of the entries' `value` objects** (`{ model, method, args, kwargs, extras }`) for the
requested model. The Controller consumes this (never `OfflinePlugin` directly) to build the
strip. The hook's existing tests are unchanged; a **new** test covers the accessor (returns
only that model's entries; updates when the queue changes; empty when none), with a removal
check.

### (a) `CrmKanbanRenderer` wiring (`crm_kanban_renderer.js`) — per-card registration only

The renderer hosts **only** the per-card additive wiring (Fact 12). It does **not** host the
strip.
- Register `CrmKanbanRecord` as the renderer's `KanbanRecord` component via a `static
  components` override (`KanbanRecord: CrmKanbanRecord`), so the whole `crm_kanban` view uses
  it with **no** change to any other view.
- No strip markup is added to the renderer: the renderer root is a horizontal flex container
  of `.o_kanban_group` columns (verified, Fact 11), so a strip there would become a column.

### (b) CRM kanban Controller subclass (`crm_kanban_view.js`) — strip template + New-button overrides

`crmKanbanView.Controller` **owns** both the strip template and the create overrides (one
coherent owner; Fact 11).

**Strip template (primary inherit of `web.KanbanView`).** The Controller sets its `static
template` to a crm template authored as a **primary** inherit of `web.KanbanView`
(`t-inherit-mode="primary"`), in the allowed `crm_mobile_lead_card.xml` (no new standalone
template file). The `<xpath>` inserts the strip element with `position="before"` the
`<t t-component="this.props.Renderer">` node (verified sibling location,
`kanban_controller.xml`), gated on `isSmall()` and on at least one pending card (the
`pendingCreateCards` getter returns `[]` unless `_crmMobileStageBoard && isSmall()`, Fact 16).
The strip is a full-width block
(e.g. `<div class="o_crm_mobile_pending_strip w-100">`) **above** the renderer's flex row, so
it is a full-width sibling, not a column. The strip derives its entries via the hook accessor
`this.crmOffline.queuedWrites("crm.lead")` (Fact 15 / Fix 1) — it does **not** resolve
`OfflinePlugin` — keeping **every** queued `crm.lead` `web_save` entry with an empty `args[0]`
id list — regardless of origin or `actionId` (Fact 11 / Item 8) — and renders one
`CrmMobileLeadCard` in queued-create mode per entry. It passes a `stageGroups` prop derived
from `root.groups` (reduced to `{ serverValue, displayName }` by the Controller's
`pendingStageGroups` getter); the strip card resolves each entry's stage label **only** from
that (`serverValue` match → `displayName`), showing no stage if unresolved — **no**
`extras.changes` fallback. It passes `parkedError` = `value.extras.error` so a parked entry
shows the "needs retry" marker and a non-parked one shows "pending sync" (Fact 11 / Fix 5). A test asserts the
strip DOM node is **before** the columns container, spans full width, and the columns still
lay out normally. Deferred to spec 08: moving each such card from this full-width
above-the-renderer strip into its pipeline stage column.

All three Controller entry points below are additionally gated on the pipeline-board getter
`get _crmMobileStageBoard() { return this.model.root.groupByField?.name === "stage_id"; }`
(Fact 16), so none of them fire on the forecast (`date_deadline`-grouped) board that extends
this Controller.

**New-button overrides**, for `_crmMobileStageBoard && isSmall() && isOffline()` only:
- `get isNewButtonAvailableOffline` — return `true` (so the New button stays enabled offline
  on small screens; Fact 9).
- `createRecord()` — open the `CrmMobileQuickCreate` bottom sheet, passing `close`,
  `root.groups` (stage selector), `root.context` (carried verbatim into the queued create's
  `kwargs.context` so the replayed lead gets the pipeline `default_type` and, where present,
  `default_team_id`; Fact 4 / Fix 3), and `extrasBase` = `{ actionId, actionName, viewType }`
  built from `this.env.config` (so the sheet can assemble systray `extras` without reading
  `env.config` itself; Fact 13 / Item 6), instead of the inline kanban quick-create.

Online, or on desktop, both overrides fall through to `super` unchanged (Fact 9 / Fact 10).

## Data Models

Spec 07 introduces **no data-model change**: no new fields on `crm.lead`, `crm.stage`, or
`crm.team` (constraint). The shapes below are **client-side only** — they describe data
already present in the facts above, reorganized for reference, not new model definitions.

- **Queued quick-create call** (Facts 4 and 13) — the full `scheduleORM` shape:

  ```
  scheduleORM(
    "crm.lead",
    "web_save",
    [[], VALUES],                                   // empty id list + values dict
    { context: root.context, specification: {} },   // specification MANDATORY; context carries default_type
    { extras: EXTRAS }                               // systray extras (see below)
  )
  ```

  where

  ```
  VALUES = {
    name,               // trimmed; always present
    contact_name,       // Char, free text — not partner_id; trimmed, OMITTED when blank
    phone,              // trimmed, OMITTED when blank
    email_from,         // trimmed, OMITTED when blank
    expected_revenue,   // Number; OMITTED when untouched (empty/null/undefined)
    stage_id            // omitted when the stage selector is disabled / no stage chosen
  }
  // A minimal confirm (name only) queues VALUES = { name }.

  EXTRAS = {
    ...extrasBase,      // { actionId, actionName, viewType } built by the Controller from env.config
    displayName,        // the TRIMMED name, or _t("New lead")
    changes,            // shallow copy of VALUES
    timeStamp,          // Date.now()
  }
  ```

  `viewType` is the kanban view type, so the create row renders in the systray but is not
  clickable (correct — avoids a reroute). `contact_name` is a plain Char, not `partner_id`,
  so no partner is created offline. `specification: {}` is required by
  `web_save(self, vals, specification, next_id=None)` (`models.py:192`); because `args[0]`
  (the empty id list) becomes `self` in a `call_kw`, `vals = args[1] = VALUES` — so Python
  replay is `call_kw(env['crm.lead'], "web_save", [[], VALUES], {context, specification: {}})`
  (or `env['crm.lead'].browse([]).with_context(**ctx).web_save(VALUES, specification={})`),
  **not** `web_save(VALUES, {})` on a populated recordset and **not** `web_save([], VALUES,
  specification={})` as positionals. An empty kwargs `{}` would raise `TypeError` on replay
  (missing `specification`). `EXTRAS` spreads `extrasBase` (the Controller's three
  `env.config` fields) and the sheet adds `displayName`/`changes`/`timeStamp`; it is **not**
  built from `getScheduleORMExtras([])` (which throws on `records[0]`). The create needs no
  `originalValues`.

- **Hook accessor `queuedWrites(resModel)`** (Fact 15 / Fix 1) — a read accessor added to
  `useCrmOffline()` returning the queue entries' `value` objects for one model:

  ```
  queuedWrites("crm.lead") -> [ { model, method, args, kwargs, extras }, ... ]
  ```

  Built on the same `offline._ormToSync()` signal `hasQueuedWrite` reads (read at call time,
  reactive); no second store. The Controller filters the result to empty-`args[0]` `web_save`
  entries to build the strip, reading each entry's `args`/`kwargs`/`extras` (including
  `extras.error` for the parked "needs retry" marker) directly.

- **Stage-selector source** (`root.groups`, Fact 5) — each group entry exposes:

  ```
  { serverValue, displayName, isFolded }   // serverValue = raw server stage id; order = array order
  ```

  A kanban `Group` has no `name` and no `order`: read the stage id from `group.serverValue`,
  the label from `group.displayName`, and the order from the array position in `root.groups`
  (first non-falsy = default). Read from the kanban model's loaded groups (served offline by
  the framework's cached grouped read), including empty stages via `group_expand` and folded
  groups (`group.isFolded`). A group whose `serverValue` is **falsy** (the "None" / no-stage
  group) is filtered out and yields no option (Item 8). The same `serverValue`→`displayName`
  map (passed to the strip card as the `stageGroups` prop) resolves the stage **label** for a
  queued create's `stage_id` on the strip card; an unresolved stage shows no stage, with
  **no** `extras.changes` fallback (Fact 11).

- **`CrmMobileLeadCard` props** (section Components and Interfaces) — exactly one of
  `record` / `queuedValues` is set:

  ```
  { record?, queuedValues?, parkedError?, actionId? }
  ```

  where `queuedValues` is the queued quick-create payload shape above, `parkedError` is the
  entry's `extras.error` (truthy only for a parked queued create → "needs retry" marker;
  Fix 5), and `actionId` is the current action id used for the uncached check.

## Correctness Properties

Expressed as testable invariants, derived only from the facts above:

### Property 1: Mobile-only rendering

Everything new (card, sheet, strip, in-card message) renders only when `isSmall()` is true;
on desktop, no card, sheet, strip, or message is rendered.

**Validates: Requirements 1.6, 10.8**

### Property 2: Sheet gate

The quick-create bottom sheet opens only when `isSmall() && isOffline()`.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 3: Self-contained create

A quick-create queues exactly one `web_save` with an empty id list
(`[[], VALUES]`, kwargs `{ context: root.context, specification: {} }`) and no other queue
entry.

**Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.7**

### Property 4: Pending indicator correctness

In record mode the pending-sync indicator is true iff `hasQueuedWrite("crm.lead", resId)`,
and it clears when the queue drains. The indicator is a **boolean** state, not a per-entry
badge: a lead with **two** queued edits (e.g. a stage-move `web_save` and another `web_save`)
shows **exactly one** indicator. (A lead cannot have both a queued create and a queued edit:
a queued create has no server id, so no later queued call can target it — that combination is
impossible, Fact 3 / Item 4.)

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

### Property 5: Uncached message gate

The uncached-lead message shows iff `isSmall() && isOffline() &&
!isAvailableOffline(actionId, "form", resId)`.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5**

### Property 6: Additive wiring

Card wiring is additive, so all web `KanbanRecord` behavior (click/touch/menu/drag/selection,
activity/priority widgets, `o_disabled_offline`) is preserved.

**Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7**

### Property 7: No offline partner

No partner is created offline — the quick create has no partner field.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 8: Queued create has a valid shape

The queued `web_save` CREATE carries `kwargs.specification` (`{}`), `kwargs.context`
(`root.context`, including `default_type`), and `extras` (`timeStamp`, `actionName`,
`displayName`, `changes`), so replay does not raise `TypeError` and the systray renders the
entry without error. Validated by the Blocker-1 replay test, the Blocker-2 systray test, and
the Fix-3 context/type test (Facts 4 and 13).

**Validates: Requirements 6.3, 6.5, 7.1, 7.2**

## Error Handling

- **Systray renders the queued create without crashing (Blocker 2 / Fact 13).** The queued
  CREATE carries `extras` (`timeStamp`, `actionName`, `displayName`, `changes`, plus
  `viewType`/`actionId` for `isClickable`), so the systray renders its row without throwing
  (the same class of crash as spec 06's `status.color`). A create with no extras would throw
  on render; the directly-built `EXTRAS` object prevents that.
- **Rejected queued-create replay (parked marker, Fix 5).** A rejected `web_save` create
  replay is parked by the framework with `extras.error` and surfaced in the framework systray
  for manual retry (unchanged queue semantics — timestamp-ordered replay, last-write-wins,
  parked failures in the existing systray). On the strip, following spec 06's activity choice,
  a parked entry's card shows a translatable **"needs retry"** marker derived from
  `extras.error` (read via the hook accessor's returned `value.extras.error`), while a
  non-parked queued create shows the normal **"pending sync"** indicator. There is **no**
  CRM-specific error UI or dialog — the systray remains the only error surface — and the strip
  card does not crash.
- **Invalid quick-create payload (Fix 5 / Fact 14).** On Create with an empty `name`, or a
  non-numeric `expected_revenue`, or a malformed `email_from`, the sheet does nothing but
  mark the offending field invalid and queues NOTHING — no server round-trip. Create and
  Cancel keep `data-available-offline` throughout; the invalid state refuses to queue, it
  does not strip the offline attribute.
- **Guarded field reads.** The strip card guards every field read, so a missing field
  renders empty rather than throwing (Fact 11). A rejected replay surfaced in the systray
  must not break the strip card.
- **Programmatic-only guards.** Offline guards reachable only programmatically return
  without queuing.
- **Expected-error discipline.** No error is declared "expected" merely to go green; only
  errors the framework legitimately produces are declared expected, with exact messages via
  `expect.errors(n)` + `verifyErrors`.

## Testing Strategy

Tests go only in the existing files (JS: `crm_offline.test.js`; Python: appended to
`TestCrmOffline` in `test_crm_offline.py`). No existing test is deleted, skipped, retagged
or weakened; no `only()`/`debug()` in any `.test.js`.

**JS unit tests (Hoot), paired desktop/mobile.** Each behavior is tested under both presets
via `test.tags("desktop")` and `test.tags("mobile")`; new mobile components are tested in
the mobile preset. Mock models declare each field with the same type as production.

The real-board tests mount the **PRODUCTION card arch verbatim** —
`spec07VerbatimKanbanArch` mirrors `crm_lead_views.xml:524–562` (including the marker classes
`o_crm_card_name` / `o_crm_card_expected_revenue` / `o_crm_card_partner` /
`o_crm_card_contact_name` / `o_crm_card_partner_name` the SCSS hide rule targets) — against
the shared `crm.lead` mock, which is **extended** with every field that arch reads
(`contact_name`, `partner_name`, `recurring_revenue`, `recurring_plan`, `tag_ids`, `priority`,
`date_deadline`, `is_rotting`, `rotting_days`, `color`, …) at production field types. Two
production card lines are not mountable in the Hoot mock and are the honest deviations below
(the `lead_properties` properties widget, and the live `kanban_activity` RPC on a grouped mock
board); everything else is mounted verbatim.
- **Real-board render — "spec07 board renders the card" (5a)** (mobile): mount the **real**
  `crm_kanban` view (`mountView` / the view registry) with seeded leads and assert a
  `CrmMobileLeadCard` exists inside a **real rendered kanban card** (not a directly-mounted
  component). The **task-4 removal checks refer to THIS test** (remove the production
  `CrmKanbanRecord`/`CrmMobileLeadCard` registration → this test goes red).
- **Mobile card render (standalone)** (mobile): a lead renders `CrmMobileLeadCard` with name,
  partner/contact name, and revenue (`expected_revenue` formatted via `formatMonetary` with
  `company_currency`, not a bare number). May mount the card directly; its real removal check
  is the 5a real-board test (no single production line to remove for a plain render).
- **No duplicated text + recurring kept (Item 3)** (mobile): on the real board, the visible
  lead name appears **exactly once**, and for a lead **with** recurring revenue the recurring
  part (`recurring_revenue` + `recurring_plan`) is still shown **once** (no data lost). The
  arch name node is hidden (`offsetParent` null / not visible) while the mobile-card name is
  visible. Removal check: remove the SCSS hide rule → the name shows twice → test red.
- **Pending-sync indicator** (mobile + offline): with a queued `web_save` on the lead, the
  indicator shows; with the queue drained it is absent. The absent assertion also asserts
  the card element exists (never "absent" alone). **Removal check (5b):** make
  `hasQueuedWrite` return the real queue state and remove the production call that reads it →
  the test goes red.
- **Uncached-lead message** (mobile + offline): the message element **exists** for an
  uncached lead and is **absent** for a cached one (both assertions). Desktop renders
  neither card nor message. **Removal check (5b):** remove the `!isAvailableOffline(...)`
  guard → the message wrongly shows for a cached lead → the "absent for cached" assertion
  goes red.
- **Quick-create sheet** (mobile + offline): the New button is enabled; opening the sheet
  renders every field, Create, and Cancel with `data-available-offline` present and the
  element not `[disabled]` / `.o_disabled_offline` before interacting; filling and pressing
  Create queues exactly one entry on `crm.lead` and nothing else (assert the whole queue):
  `web_save` with args `[[], VALUES]` and kwargs `{ context, specification: {} }` — assert
  `specification` is present (`{}`) and `context` carries the pipeline keys (`default_type`).
  A test also asserts the **trim/omit** behaviour: a confirm with a padded name and blank
  optionals queues `VALUES` with the **trimmed** name and the empty optionals
  (`contact_name`/`phone`/`email_from`/`expected_revenue`) **omitted**, while a confirm with
  filled optionals **includes** them (verbatim trimmed values); `EXTRAS.displayName` is the
  trimmed name.
- **Stage selector from mocked groups (5.2)** (mobile + offline): the selector lists stages
  from `groups` by `group.serverValue` / `group.displayName` in array order; a group with a
  **falsy** `serverValue` (the "None" group) yields **no** option; with no usable groups the
  selector is disabled.
- **Stage selector through the REAL grouped kanban (5d / 5.9 / task 6.1)** (mobile + offline):
  the selector is exercised through the **real** offline-loaded grouped `crm_kanban` (not only
  mocked groups) — on an offline-loaded **grouped** board, open the sheet and assert the
  selector lists the real groups: an **empty** stage AND a **folded** stage are both present
  and **selectable** in the sheet, the "None"/falsy-`serverValue` group is **not** offered,
  and — with an active search filter — the selector lists **only** the in-scope stages
  (requirement 5.9). **Removal check:** read the groups from a hardcoded list instead of
  `root.groups` → this test fails. (This is primarily a tasks-level fix; it is stated here so
  the design's Testing Strategy records the real-board source and its removal check.)
- **Systray renders the queued create (Blocker 2 / Fact 13; real create path, 5e)**
  (mobile + offline): drive the **real** Create path (open the sheet, fill, Create), then open
  the offline systray and assert its row renders with its label (`STATUS.CREATED` /
  `displayName`) and NO error (`expect.errors(0)`) — the spec-06-style systray-crash guard.
  **Removal check (5e):** remove `changes` from the PRODUCTION `EXTRAS` builder (not a
  controlled fixture) → the systray test goes red.
- **Validation (Fix 5 / Fact 14)** (mobile + offline): Create with an empty `name` queues
  NOTHING (assert the queue is unchanged/empty) and marks the name field invalid; Create with
  a valid payload queues exactly one entry. A guard reachable only programmatically (confirm
  handler called directly with an empty name) is tested by calling it directly and asserting
  nothing is queued. Create and Cancel keep `data-available-offline` in the invalid state.
- **Hook accessor `queuedWrites` (Fix 1 / Fact 15)** (mobile + offline): the accessor returns
  only the requested model's entries (seed a `crm.lead` entry and another model's entry →
  only the `crm.lead` entry is returned), updates when the queue changes (empty → one entry →
  drained), and is empty when there are none. **Removal check:** remove the production
  `queuedWrites` read in the strip derivation → the pending-create strip test goes red.
- **Pending-create strip (Fix 5)** (mobile + offline): after a queued create, a strip card
  renders the queued values with the **"pending sync"** indicator for a non-parked entry. For
  a **parked** entry (`extras.error` set), the strip card shows the translatable **"needs
  retry"** marker and does **not** crash (no CRM-specific error UI; the systray stays the
  error surface). A rejected replay surfaces in the systray and the strip card does not break.
- **Card DOM order (Fix 2)** (mobile): on the real board, the `CrmMobileLeadCard` node appears
  **before** the footer `priority`/`activity` widgets in document order (so the mobile card
  renders above the arch body and the hide rules agree with that order).
- **No duplicated lead text (Fix 6)** (mobile): the lead name appears exactly ONCE on screen
  (use a visibility-aware query / assert a single visible match), not twice. A dedicated test
  asserts the arch name node is hidden (`offsetParent` null / not visible) while the
  mobile-card name is visible, on mobile.
- **One pending indicator for two edits (Fix 8 / Item 4)** (mobile + offline): a card for a
  lead with TWO queued edits (a stage-move `web_save` and another `web_save`) shows ONE
  pending indicator, not two — the indicator is a boolean state, not a per-entry badge. (A
  queued create + queued edit on the same lead is impossible — a queued create has no server
  id — so that combination is not tested; **requirement 2.4 and task 2.1 must change to the
  two-edits case.**)
- **44px — the card tap surface (on the real board) and the sheet controls (Fix 4 / Fix 6)**
  (mobile): read `getBoundingClientRect()` (or computed `min-height`/`min-width`). The card
  tap surface is the `<article>`, which exists only on the **real** `crm_kanban` board (a
  standalone-mounted `CrmMobileLeadCard` has no article wrapper), so measure its `>= 44px`
  height on the **real board**; measure the sheet's buttons/inputs `>= 44` in both dimensions
  on the mounted sheet. The standalone-mounted card keeps only the render/format checks
  (name/partner/revenue, `formatMonetary`).
- **Forecast-board gate (Fact 16)** (mobile + offline): mount the **real** `forecast_kanban`
  view grouped by `date_deadline` offline and assert **none** of the spec-07 mobile behaviour
  appears — tapping New opens **no** quick-create sheet, there is **no** pending-create strip,
  and **no** `CrmMobileLeadCard` is injected into a card. **Removal check:** force
  `_crmMobileStageBoard` to return `true` unconditionally → this forecast test goes red (New
  opens the sheet, the strip appears, and the card injects).
- **Desktop negative** (desktop): the mobile card, sheet, strip and in-card message are
  **not** rendered; online keeps the existing inline quick create.
- **Guards reached programmatically** are tested by calling the handler directly (e.g. the
  Controller's `createRecord` under small+offline opens the sheet; the field-read guards on
  a queued-create card with missing fields do not throw).
- **Real-board card behavior (task 4.2 / 5c)** (mobile + offline): "present" is not behavior.
  On the **real** `crm_kanban` board, assert REAL behavior: (i) the card dropdown menu
  **opens**; (ii) a stage move queues the expected `web_save` on the lead — driven through
  the kanban **model move path** (reuse the existing `crm_offline.test.js` helpers —
  `mountCrmKanbanCapturingModel` / `selectStageInStatusbar` / the `moveRecords` pattern —
  **not** raw drag-and-drop, which is desktop-only); (iii) tapping a **cached** card opens its
  form (requirement 3.4) — driven via a `WebClient` `doAction` on the real board; (iv) the
  `priority` widget **renders** in the footer (the kanban priority widget is **readonly** — a
  `<span>`, not a button — so an offline priority WRITE cannot be driven in the harness and is
  a Step 10 check, not asserted here); (v) the `kanban_activity` widget's live render is a
  Step 10 check (its activity RPC is not answerable for a grouped mock board), so the tests use
  a plain `activity_ids` field. Real **touch** drag-and-drop of a card cannot be exercised in
  the Hoot harness — it is **not** claimed here and goes on the Step 10 manual list. The task-4
  removal check uses the 5a real-board test.
- **Removal checks (one per strengthened path; 5b/5e).** For each wiring, run a REAL removal
  check — remove the production line, confirm exactly the matching test goes red, then
  restore — and record it in the PR:
  - `CrmKanbanRecord`/`CrmMobileLeadCard` registration → the 5a real-board render test red.
  - SCSS hide rule → the no-duplicated-text test red.
  - `hasQueuedWrite` production read → the pending-indicator test red.
  - `!isAvailableOffline(...)` guard → the uncached-message "absent for cached" test red.
  - production `EXTRAS` `changes` → the systray test red (5e, real create path).
  - Controller `isNewButtonAvailableOffline` / `createRecord` overrides → the sheet-opens
    test red.
  - production `queuedWrites` read in the strip derivation → the pending-create strip test
    red (Fix 1).
  - real grouped-kanban stage source (`root.groups` → a hardcoded list) → the real
    grouped-kanban stage-selector test red (Fix 3).
  A standalone test with **no** production line to remove must be backed by the 5a
  real-board test; state that explicitly rather than writing "n/a". A test that still passes
  with the production wiring removed does not count. No `{ force: true }` registration, no
  hand-set production flags, no patching of `setOffline`; connectivity is driven through the
  real helper. A stub never replaces the code under test.
- **Expected errors** are declared only for errors the framework legitimately produces
  (via `expect.errors(n)` + `verifyErrors` with exact messages); no error is declared
  "expected" merely to go green.

**Python unit test (`TestCrmOffline`, appended).** A **new** method replays the queued
create the way the framework does, with the exact queued args/kwargs. Preferred form —
`call_kw` with the queued args and kwargs (`call_kw` is `call_kw(model, name, args, kwargs)`
at `odoo/service/model.py:31`):
`odoo.service.model.call_kw(self.env['crm.lead'], "web_save", [[], VALUES], {"context": ctx, "specification": {}})`
— identical args/kwargs to what the JS asserts is queued. Equivalent recordset form:
`self.env['crm.lead'].browse([]).with_context(**ctx).web_save(VALUES, specification={})` —
note `VALUES` is the FIRST positional argument (`vals`) on an **empty** recordset, because in
a `call_kw` `args[0]` (the id list) becomes the recordset `self`, **not** a positional
argument (Fact 4). It is therefore **not** `web_save([], VALUES, specification={})` as
positionals and **not** `web_save({...}, {})`. The method runs for BOTH a lead pipeline
(context `default_type='lead'`) with a **full** payload (name + optional fields + stage) AND
an opportunity pipeline (context `default_type='opportunity'`) with a **minimal** payload
(name + `stage_id` only, mirroring the sheet's omit-empty behaviour when the optional fields
are blank), asserting in each case that the created `crm.lead` carries the entered values,
the chosen stage, AND the correct `type` from the pipeline context (Facts 4 and 13 / Fix 3).
The minimal payload proves the omit-empty create replays as cleanly as the full one. The pre-existing seed test `test_offline_websave_create_replay` is a
different test and is NOT modified. The new method appends to the shared module (do not create
a second module and do not re-add the import).

**Coverage.** Each new mobile JS file (`crm_mobile_lead_card.js`,
`crm_mobile_quick_create.js`) needs `>= 80%` statement coverage, and every new code path
needs a test that exercises it. There is no coverage tool in the repo; the reviewer checks
coverage by reading the tests against the source. Spec 08 owns acceptance row 14 (the
coverage check across all new mobile JS files).

**Running checks.** Always via `.kiro/scripts/check.sh` (`quick` during development, `full`
before PR); report its output verbatim. If it fails for an environment reason, say so
rather than working around it.

**Size guard (Item 9).** The ~300-line size guard applies to **production source files**
only — `crm_kanban_renderer.js`, `crm_kanban_view.js`, and the new component `.js` files —
measured as ~300 **added** lines per existing production file. If any such file would grow
by more than ~300 lines, the tasks phase stops and asks the user before proceeding. The
guard does **not** apply to `crm_offline.test.js`, which must carry every new test: report
that file's growth in the PR, but do **not** stop for it. (The tasks must be worded to match
this scope.)

## Known limitations / carry-forward

- **KL-A (acceptance row 9).** The in-card uncached-lead explanation is implemented and
  proven here by a both-sided mobile+offline JS test (message present for an uncached lead,
  absent for a cached one). Acceptance row 9 is **owned by spec 08**, which asserts the same
  explanation **end-to-end through the pipeline and the browser tour**. Spec 07 renders the
  strip **from the Controller as a full-width element above the renderer** and unit-proves the
  in-card message; the end-to-end uncached-explanation assertion is spec 08's.
- **Pending-create card placement — deferred to spec 08 (spec-plan.md carry-forward).** Spec
  07 renders queued creates in a **full-width strip above the renderer** (a Controller sibling
  above the kanban columns). Placing each card **inside its pipeline stage column** is spec
  08's. This is recorded for the spec-plan carry-forward and is a prerequisite note for spec
  08's Step 8.
- **No stage-cache known limitation.** Per Fact 5, the stage selector reads `root.groups`
  (the framework's cached grouped read, including empty stages via `group_expand`), so there
  is no stage-cache KL; the earlier stage-cache concern is dropped.
- **spec-plan.md carry-forward is a real edit (Fix 7).** Task 11 (carry-forward) **edits**
  `.kiro/steering/spec-plan.md` (force-added with `git add -f`) to record: (a) pending-create
  card placement in the pipeline **stage column** is spec 08's; (b) the end-to-end
  uncached-explanation assertion (acceptance row 9) is spec 08's; (c) the Step 10 manual-check
  list for spec 07 (below). Spec 07 is **NOT** marked merged in that edit. This is **in
  addition to** the PR description, not a substitute for it.

### Step 10 manual-check list (what the unit lane cannot prove)

These behaviors cannot be fully proven by the Hoot unit lane and MUST be confirmed by a
Step 10 manual check on a real device / installed PWA:

- **Live `kanban_activity` widget render on the card.** The widget's activity RPC is not
  answerable for a grouped mock board in the Hoot harness, so the real-board tests use a plain
  `activity_ids` field in place of the live widget. Confirm the real `kanban_activity` widget
  renders under the mobile card on a device.
- **Offline priority WRITE from the kanban card.** The kanban `priority` widget is **readonly**
  on the card (it renders a `<span>`, not a button), so an offline priority write cannot be
  driven in the Hoot harness. The real-board tests assert only that the priority widget
  **renders** in the footer. Confirm an offline priority change from the card queues the write
  on a device.
- **Empty-stage-in-selector (real `group_expand`).** The mock server has no `group_expand`, so
  an empty stage never forms a group in the unit harness. The literal stage-selector test
  asserts the **populated** stages and that a lead-less stage is **absent** in the mock; the
  real empty-stage-selectable case (an empty stage still offered because of production
  `group_expand`) is a Step 10 check.
- **Real touch drag-and-drop of a card** on a phone (the Hoot harness drives the kanban model
  move path, not real touch DnD, which is desktop-only in the harness; see task 4.2 / 5c).
- **Real card tap opening the form** on a device for a cached lead (requirement 3.4). (The
  cached-card tap **is** now unit-tested via a `WebClient` `doAction` on the real board; the
  on-device tap-to-form is still confirmed here.)
- **The real systray row for a queued create** on a device (the unit lane asserts the row
  renders without error; the on-device appearance is manual).

## Verification

`check.sh quick` and `check.sh full` are run; all five test commands and all scope checks
pass; **acceptance row 5 (crm manifest version bumped one minor increment) is EXPECTED to
fail until spec 08.** Row 5 is reported as an explicit, expected deviation, not a
regression — spec 07 does not bump the manifest version (that is spec 08). This design does
not claim "check.sh full passes" or "all acceptance rows pass."

The scope checks (`check.sh scope`) must stay green: no file is touched outside
`addons/crm/`; `requirements.txt` and `security/` are unchanged; no new offline machinery
or forbidden primitive names appear in CRM source or comments; no existing test file is
modified except (if needed) `addons/crm/tests/__init__.py`; no `only()`/`debug()` in any
`.test.js`.
