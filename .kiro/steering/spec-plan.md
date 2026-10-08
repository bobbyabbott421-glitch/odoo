---
inclusion: always
---
# Spec plan (agreed in Step 4)

The project is split into eight specs, built and merged in the order below. Each spec has
its own branch, cut from `kiro/00-setup` after the previous specs are merged into it.

## Rules

- Work only on the spec named in the user's seed prompt. If no seed prompt names a spec,
  ask which spec to start; do not pick one, and do not write a spec or code.
- "Spec N" always means the numbered spec in the table below, never PART N of
  `/crm-offline-brief`. The PART numbers and spec numbers differ.
- Do not write code until the user has approved the spec files (requirements, design,
  tasks).
- Stay inside the spec's scope. Work that belongs to another spec (for example the manifest
  version bump, which belongs to spec 08) must not be done early.

## The eight specs, in merge order

| # | Spec | Branch | Type | Covers | Owns acceptance rows |
|---|------|--------|------|--------|----------------------|
| 01 | Offline surface inventory | `kiro/01-offline-inventory` | Quick Spec | PART 1 (document only, no code) | 1 |
| 02 | Shared offline hooks | `kiro/02-offline-hooks` | Quick Spec | PART 4 item 4: `crm_offline_hooks.js`; creates `crm_offline.test.js` | none |
| 03 | CRM PWA packaging + Python test scaffold | `kiro/03-pwa-packaging` | Quick Spec | PART 5; creates `test_crm_offline.py` (class `TestCrmOffline`) and its import in `tests/__init__.py` | none |
| 04 | Form-save offline correctness | `kiro/04-form-save-correctness` | Bugfix Spec | PART 2 items 1–2; PART 3a mark-won without rainbowman; queue semantics | 8 |
| 05 | Disabled/skipped controls + chatter | `kiro/05-disabled-controls-chatter` | Bugfix Spec | PART 2 items 3–8 | 7 |
| 06 | Offline data coverage | `kiro/06-data-coverage` | Design-First Feature Spec | PART 3a, 3b, 3c | 9 |
| 07 | Mobile lead card + quick create | `kiro/07-mobile-card-quick-create` | Design-First Feature Spec | PART 4 items 2–3, wired minimally into a rendered parent | none |
| 08 | Mobile pipeline view + wiring + tour + version bump | `kiro/08-mobile-pipeline-tour` | Design-First Feature Spec | PART 4 items 1 and 5; the browser tour; manifest `1.9` → `1.10`; the row 14 coverage check across all new mobile JS files | 5, 6, 10, 12, 14 |

Rows 2, 3, 4, 11 and 13 are enforced on every spec by `check.sh scope` and the Stop hook;
their final proof is the acceptance report after spec 08.

## Status

- Spec 01: merged into `kiro/00-setup`.
- Spec 02: merged into `kiro/00-setup`.
- Spec 03: merged into `kiro/00-setup`.
- Spec 04: merged into `kiro/00-setup`.
- Spec 05: merged into `kiro/00-setup`.
- Spec 06: merged into `kiro/00-setup`.
- Spec 07: merged into `kiro/00-setup` (PR #10, 294c162).
- Spec 08: implemented on `kiro/08-mobile-pipeline-tour` (cut from `kiro/00-setup` @294c162);
  PR open against `kiro/00-setup`, pending review.

## Row 9 (acceptance) — not met literally in spec 06; carried forward

Row 9's literal wording is **not** met by spec 06. Spec 06 documents the framework behaviour as
known limitation **KL-A**: when a lead's view is not cached, the offline region is **blank** —
the framework does not render `OfflineActionHelper` on a reroute to a cached view, and a
no-cache lead form shows nothing. Spec 06 adds no CRM UI for this (it cannot without a
forbidden web-level change). The explanation UI is therefore **carried forward**:

- **Spec 07** (mobile lead card): the mobile lead card SHALL show the explanation (the
  framework's `OfflineActionHelper`, or an equivalent in-card message) when a tapped lead was
  not cached online, instead of a blank region.
- **Spec 08** (mobile pipeline + tour): the pipeline/tour test SHALL assert that explanation is
  shown for an uncached lead, which is where row 9's intent is finally proven. (Spec 08 owns
  row 9 in the table above.)

## Step 10 manual-check list (carried forward from spec 06)

These behaviours cannot be fully proven by the unit/integration lanes and MUST be confirmed by
a Step 10 manual check on a real device/PWA:

- **KL-A** (row 9): with no cached view, the offline region is blank; the explanation UI is
  carried to spec 07 and asserted by spec 08 (see Row 9 above).
- **KL-B**: a rejected queued activity call (`activity_schedule`/`action_feedback`) parks with
  `extras.error`, but with the lead chatter mounted both the chatter row and the systray read
  the same in-memory `_ormToSync()` map, so the parked entry may be observable only transiently
  (it can drain from the in-memory queue). Cause **not** established. Confirm manually that after
  a rejected offline activity reconnect the user still has a retry path.
- **KL-C**: after an offline page **reload** before any online prefetch has run, the schedulable
  activity-type allow-list (`_schedulableTypeIds`, session-scoped) is empty, so scheduling is
  **disabled** (fail-safe — no meeting type leaks). Confirm the control is disabled (no crash,
  no meeting type offered) after an offline reload and re-enables once a connection returns and
  the prefetch runs; confirm the warm-session path (offline without reload) stays enabled.
- **3c real-widget partner-create checks**: the unit lane proves the no-offline-create behaviour
  only with the **generic** many2one widget, because the real `res_partner_many2one` widget is
  registered only in `web.assets_backend` and is absent from the crm unit-test bundle. On the
  real widget, offline, confirm: typing an unmatched name offers **no** "Create" / "Create and
  edit" / **"Search more"** entry; **Tab** (and Enter) on unmatched free text commits no
  quick-create value; and `partner_autocomplete`'s own company-autocomplete suggestions offer no
  offline create path either.
- **Reconnect-triggered mounted-chatter refetch** (requirement 10.4): the 8.7/T1b tests drive
  `CrmChatter.load()` BY HAND to prove the refetch+reconcile logic; the reconnect HANDLER that
  calls `load()` on its own when the connection returns (the `useOnChange(isOffline)` →
  `this.load(...)` path) is not exercised end-to-end by a unit test. Confirm manually that, with
  the lead chatter mounted, reconnecting on a real device refetches the thread once and folds in
  the replayed server activity without a duplicate or a stale pending row.

## Carry-forward from spec 07 (mobile lead card + quick create)

Spec 07 implemented the mobile lead card, the offline mobile quick-create bottom sheet, the
pending-create strip, and the KL-A in-card uncached-lead message. Two things are explicitly
left for **spec 08**:

- **Pending-create card placement in the stage column.** Spec 07 renders each queued offline
  create as a `CrmMobileLeadCard` in a flat full-width strip ABOVE the kanban columns, rendered
  from the CRM kanban Controller. Spec 08 (mobile pipeline) SHALL place each pending-create card
  inside its own stage column of the pipeline.
- **Acceptance row 9, end-to-end.** Spec 07 implements and unit-proves the in-card uncached-lead
  message (present for an uncached lead, absent for a cached one, mobile + offline; desktop
  renders neither). Spec 08 owns row 9 and SHALL assert the explanation end-to-end through the
  pipeline and the browser tour.

### Step 10 manual-check list (spec 07)

These behaviours cannot be proven by the Hoot unit/integration lanes and MUST be confirmed by a
Step 10 manual check on a real device / installed PWA:

- **Real touch drag-and-drop of a lead card.** The unit lane exercises the stage move through
  the kanban model's `moveRecords` path (which queues the expected `web_save`), not a real
  touch drag; confirm a finger drag between stages on a phone queues the move offline.
- **Real card tap opening the form.** Confirm tapping a cached lead card on a device opens its
  form (requirement 3.4 / 10.4); the unit lane asserts the additive wiring preserves the open
  path structurally.
- **Live `kanban_activity` widget on the card.** The board tests use a plain `activity_ids`
  field (the shared mock cannot drive the activity widget's RPC for a grouped board); confirm
  the real `kanban_activity` widget renders under the mobile card on a device.
- **The real offline systray row for a queued create on a device.** The unit lane proves the
  systray renders the queued-create row without crashing (extras shape); confirm it appears in
  the real navbar systray on a device.
