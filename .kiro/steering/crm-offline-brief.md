---
inclusion: manual
---
# CRM offline mode: full brief

Load this file with the /crm-offline-brief slash command when writing or reviewing a spec. Hard rules are in constraints.md; commands are in testing.md.

## PART 1 — OFFLINE SURFACE INVENTORY

**PART 1 makes NO code changes.** Its only output is
`addons/crm/static/src/mobile/offline_inventory.md`. Implement PART 2 onward against it.

Sweep `addons/crm/` for every entry point that requires a live server connection:

1. Every JS call to the ORM, to `rpc`, to the action service, or to a user
   group/access-right probe.
2. Every view, wizard, and report button with a server side effect.
3. Every public method on `crm.lead`, `crm.stage`, and `crm.team` reachable from a button.

For each, record the file path, line number, the call made, and exactly one classification,
assigned by these rules in order:

- **QUEUE** — a write on `crm.lead`, `crm.stage`, `crm.team`, or a `mail.activity` on
  a lead, whose full argument list is resolvable on the client with no server round-trip.
  Offline it MUST be queued and the UI MUST reflect the change optimistically.
- **SKIP** — a read whose only effect is decorative or advisory: a tooltip, a visual effect,
  a promotional hint, a group probe that only toggles display. Offline it MUST be skipped
  silently — no queued call, no error, no notification. It MUST NOT be queued, because
  replaying it later fires an effect detached from the action that caused it.
- **DISABLE** — everything else: transient-model wizards, module installation, paid external
  lookups, server-computed reports, access probes gating destructive UI, and navigation to
  an action unavailable offline. Offline the control MUST be disabled and MUST NOT be
  reachable by click, keyboard, hotkey, or programmatic call.

The queue stores a model, method, arguments, and kwargs and replays them verbatim, so
anything classified QUEUE MUST have a complete, client-resolvable argument list. A call
needing a server `onchange`, a transient-model wizard, or an id produced by another
call MUST be DISABLE, never QUEUE.

The document MUST contain one row per entry point with its classification and a one-line
justification, plus a count per classification.

---

## PART 2 — OFFLINE CORRECTNESS FOR EXISTING CRM CODE PATHS

Apply the PART 1 classifications. The following defects are already confirmed present and
MUST be fixed:

1. **Post-save rainbowman lookup.** On a stage change, the CRM form record's save calls a
   server method to fetch a rainbowman message. Offline, the save itself is queued
   successfully and then that lookup raises a connection-lost error, so the salesperson sees
   a failure immediately after a successful offline save. Offline, the lookup MUST be skipped
   entirely, the save MUST still complete, and the lookup MUST NOT be queued. Online
   behavior MUST be unchanged.

2. **Email and phone force-save propagation.** The same save method copies the lead email
   and phone into the change set when the partner-sync flags are set, so the server-side
   inverse methods run. Those copied values MUST be included in the queued offline write.
   Rationale: dropping them makes offline lead-to-partner propagation silently inconsistent
   with the online path, which an existing test asserts.

3. **Team switcher.** Offline: the sales-manager group probe MUST be skipped and treated as
   false, the dropdown MUST render disabled, and the manage-teams navigation MUST be
   unreachable. The currently selected team MUST remain visible as a search facet — the
   search model already does this and MUST NOT be regressed.

4. **Lead generation dropdown.** MUST render disabled offline, and MUST NOT issue its module
   lookup or access-right probes while offline.

5. **Recurring-revenue progress aggregate.** Its group probe MUST be skipped offline and the
   aggregate hidden, NOT rendered as zero. Rationale: a displayed zero is indistinguishable
   from a real zero and will be read as data.

6. **Predictive-scoring tooltip button.** MUST be disabled offline and MUST NOT issue its
   lookup.

7. **CRM entry in the activity menu.** MUST be disabled offline.

8. **Chatter on the lead form.** MUST be read-only offline and MUST NOT raise an uncaught
   error. Achieve this from inside `addons/crm/` only.

Every control that remains usable offline MUST carry the framework's offline-availability
attribute on the interactive element itself. The framework disables interactive elements by
CSS selector and re-applies that on DOM mutation, so a control without the attribute is
disabled at runtime regardless of what its JS does. This attribute is the only mechanism
that keeps a control usable offline.

---

## PART 3 — OFFLINE DATA COVERAGE

### 3a. Leads, stages, teams

Already covered by the framework. Verify and prove it; do NOT reimplement it. Offline
creates, edits, stage moves, and mark-won MUST queue and replay. Mark-won MUST optimistically
show the lead as won and MUST NOT attempt the rainbowman lookup. A lead never visited online
MUST NOT be openable offline — the mobile UI MUST use the framework's offline action helper
to explain the state rather than render an empty form.

### 3b. Activities on a lead

A salesperson MUST be able to log a call, schedule a follow-up, and mark an activity done
offline, for any lead visited online.

- `mail.activity` is owned by another addon; extend it from the existing CRM-side inherit.
- Scheduling offline MUST queue a create whose full argument list is resolved on the client:
  related model, record id, activity type, summary, deadline, and assignee. Activity types
  MUST come from the offline cache; if none is cached, the control MUST be disabled
  rather than presenting an empty selector.
- Marking done offline MUST queue the state change only. Creating a calendar event
  activity MUST be unreachable offline, because it needs a server round-trip.
- Activities queued offline MUST appear in the lead's activity list immediately, visibly
  marked as pending sync.

### 3c. Contact lookup

Offline partner search and name resolution are served by the framework's existing
relational-field cache, populated automatically for visible relational fields on cached
records. The lead's partner field MUST resolve names and search offline through that cache,
and you MUST NOT add a second partner cache.

The partner field MUST NOT permit creating a new contact offline. Rationale: the queue
replays independent calls with no id remapping between them, so a queued contact create
would get a server-assigned id that the queued lead write cannot reference.

---

## PART 4 — MOBILE-FIRST CRM UI

Every mobile component activates on the small-screen signal and MUST NOT alter desktop
rendering.

1. **Mobile pipeline.** One stage at a time filling the viewport width, horizontal
   navigation between adjacent stages, and stage name plus lead count and revenue sum in a
   fixed header. It MUST reuse the existing CRM kanban model, arch parser, and search model
   — it MUST NOT define a second kanban model. It MUST work offline for every cached stage.

2. **Mobile lead card.** Touch targets of at least 44x44 CSS pixels. Shows lead name,
   partner name, expected revenue, and a pending-sync indicator when the record has a queued
   write. The queued state MUST be read from the framework — the card MUST NOT keep its own
   dirty flag.

3. **Mobile quick create.** Presented as a bottom sheet on small screens, using the
   framework's existing bottom-sheet option. Captures exactly: lead name, contact name,
   phone, email, expected revenue, and stage. MUST function offline and queue a create.
   Every field MUST carry the offline-availability attribute.

4. **Shared offline hooks.** One module exposing the offline predicates the mobile components
   share. Every mobile component MUST consume these hooks rather than resolving the offline
   plugin independently.

5. **Mobile view arch.** Extend the addon's existing mobile kanban arch. Do NOT add a
   parallel view record.

### Wiring requirements (all mandatory)

A component that exists but is never reached is the dominant failure mode for this kind of
change. Each item MUST hold, and each MUST be demonstrated by a test:

- Every new view MUST be registered in the view registry AND referenced by a `js_class` on
  the addon's lead views.
- Every new component MUST be reachable from a rendered parent template, not only from its
  own unit test.
- New source, test, and tour files are already covered by the manifest's existing asset
  globs. Verify that rather than adding new globs; add a bundle entry only to exclude or
  lazily load a file, mirroring the manifest's existing exclusion style.
- The new Python test module MUST be imported explicitly in the tests package `__init__`.
  Test modules are NOT auto-discovered; one missing from `__init__` never runs.
- Any new Python model or controller file MUST be imported in its package `__init__`, and any
  new XML data file MUST be added to the manifest `data` list in dependency order.

---

## PART 5 — CRM PWA PACKAGING

Extend the addon's existing web-manifest controller only.

- Append two CRM shortcuts to the parent's result — "My Pipeline" and "New Lead" —
  the same shape the parent builds. The parent's own shortcuts MUST NOT be removed. The
  parent already lists CRM as an app; this override adds deep links, it does not register a second
  app.
- Point the manifest icon at the addon's existing icon asset.
- MUST NOT override the service worker, the manifest route, or the offline page route. The
  shared service worker already caches the backend entry point and serves the offline page.
- MUST NOT change the manifest's background or theme color.
- The share target MUST stay enabled.

---

## ACCEPTANCE GATE:

Every row MUST hold and MUST be demonstrated by the stated verification. A requirement that
cannot be demonstrated by a command or a test is not met. The lane references point to
TESTING REQUIREMENTS, which owns the scenario detail. Run every command from the repository
root.

| # | Requirement | Verification |
|---|---|---|
| 1 | The inventory classifies every swept entry point as exactly one of QUEUE / SKIP / DISABLE, with a justification per row and per-class counts | Read the document |
| 2 | The diff touches only paths under `addons/crm/` | `git diff --name-only <base>..HEAD \| grep -v '^addons/crm/'` is empty |
| 3 | `requirements.txt` and the addon's security files are unchanged | `git diff --name-only <base>..HEAD \| grep -E 'requirements.txt\|security/'` is empty |
| 4 | No parallel offline stack was built | `grep -rn "indexedDB\|new IndexedDB\|serviceWorker\|navigator.locks\|caches.open" addons/crm/` shows no new occurrences |
| 5 | The `crm` manifest version is bumped one minor increment | Read the manifest |
| 6 | The full offline write-and-replay cycle reaches the server on reconnect with the lead edit, mobile quick create, activity schedule, mark-won | Lane 3 |
| 7 | Every DISABLE control is disabled offline and re-enabled online; every SKIP call is not issued offline and raises nothing | Lane 2 |
| 8 | Queue semantics are unchanged: ordered replay, later write wins, a rejected replay is parked in the existing systray, no conflict dialog, no CRM-specific error UI | Lane 2 |
| 9 | An uncached lead opened offline shows the offline action helper — no empty form, no error | Lane 2 |
| 10 | Desktop, online: CRM behaves exactly as before this change | Existing suites (commands 1 and 3) |
| 11 | Every existing CRM test passes unchanged — none deleted, skipped, retagged, or weakened | Commands 1-5, with no test file modified other than the tests package `__init__` |
| 12 | New JS unit tests pass under both the desktop and mobile presets | Commands 3 and 4 |
| 13 | No `.test.js` file in the diff contains `only(` or `debug(` | Command 5 |
| 14 | Statement coverage of each new mobile JS file is at least 80%, and every new code path is exercised by a new test | Review the new tests against the new source |

**There is no CI in this repository** — no workflows exist, so no external check will report a
failure after the pull request opens. Every command below MUST be executed, MUST pass, and
its result MUST be reported.

---

## TESTING REQUIREMENTS:

Three lanes, all mandatory. Follow the addon's existing test conventions in each lane. Every
row of the ACCEPTANCE GATE maps to one of these.

**1. Python unit tests.** The CRM manifest override returns the parent's shortcuts plus the
two CRM shortcuts with a valid shape, and an openable icon path. Applying the exact call that a
queued offline edit produces yields the same lead state as the equivalent online write,
including the email and phone partner propagation from PART 2 item 2. Replaying the queued mark-won
call leaves the lead won. Replaying an offline activity create produces an activity linked to
the lead.

**2. JS unit tests.** Offline, the CRM form save completes, issues no rainbowman lookup, and
surfaces no error. Online, the rainbowman lookup IS issued on a stage change — this guards
against fixing the offline path by deleting the feature. Each DISABLE control is disabled
offline and re-enabled online; each SKIP call is not issued offline and raises nothing. Mobile
quick create queues a create offline and shows the pending-sync indicator. The mobile pipeline
renders a cached stage offline and renders the offline action helper for an uncached stage. Two
offline writes to one lead replay in order with no conflict dialog. A rejected replay is parked in the systray
with its error and no CRM-specific error UI appears.

**3. Browser tour.** In one run: load the pipeline online, open a lead, go offline, edit that
lead, create a new lead through the mobile quick create, schedule an activity, mark the lead won,
reconnect, and assert every change reached the server.

New mobile components MUST be tested in the mobile lane, not only the desktop one.