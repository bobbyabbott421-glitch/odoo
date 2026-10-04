---
inclusion: always
---
# Lessons

Concrete rules distilled from completed specs. Apply them to every later spec so the same
mistakes do not recur. These supplement, and never override, `constraints.md` and
`testing.md`.

## Lessons from spec 01

Spec 01 produced the offline surface inventory. PR review surfaced classification and
bookkeeping mistakes that these rules exist to prevent in every inventory or sweep:

- A row classifies the **actual call named in that row**, not a replacement call that a
  later implementation might introduce. If a control currently calls a method that cannot be
  queued verbatim, classify that control's current call DISABLE and list any intended QUEUE
  replacement as a separate row.
- Record one server-touching call per row, with that call's own file and line. Do not combine
  sequential calls such as `loadAction()` and `doAction()`, or `record.save()`, `orm.call()`,
  and `record.load()`, into one row or a parenthetical reference.
- A control row cites the interactive element (the XML `button`, `a`, `DropdownItem`, or
  `widget`), not its component class or registry registration. A registration line may be
  supporting evidence in the justification, but it is not the control itself.
- Sweep both direct service calls and CRM-owned wrappers that initiate server work, including
  `record.save()`, `record.load()`, `list.load()`, `loadAction()`, `doAction()`,
  `searchRead()`, `webSearchRead()`, and inherited model-loading calls. Exclude service
  acquisition and client-only helpers (`useService(...)`, date/domain preparation, local
  state changes) when they issue no server request.
- Determine classification from the method's real side effects, not its name or UI purpose.
  Example: the predictive-scoring tooltip's `prepare_pls_tooltip_data` call recomputes
  probability and writes server state, so it is DISABLE, not an advisory SKIP. The tooltip's
  pre-lookup `record.save()` and post-lookup `record.load()` are each their own server-touching
  rows.
- To determine whether a public method on `crm.lead`, `crm.stage`, or `crm.team` is
  button-reachable, search button/action declarations across the repository, including
  inherited views in dependency addons (for example `action_primary_channel_button`, reached
  from the `sales_team` kanban). The method body remains in scope when it lives in
  `addons/crm/`, even if the button declaration is outside the write boundary.
- Re-read every cited source region before finalizing. Line numbers from a design, a prior
  review, or an earlier sweep are hints only.
- After adding, removing, splitting, reclassifying, or replacing any row, recount from the
  table itself. Per-class counts and per-surface subtotals MUST independently sum to the same
  total before review.

## Lessons from spec 02

Spec 02 added the shared CRM offline hook. Spec generation, implementation, validation, and
PR review exposed API and testing pitfalls that later specs must avoid:

- Every `.kiro/specs/<name>/.config.kiro` MUST have a unique `specId`. Before creating a new
  spec, compare its id with every existing spec config; generate a new UUID instead of copying
  one from an earlier spec. Duplicate ids collide in Kiro's spec and task tracking.
- This tree uses OWL 3. A test component that accepts no props omits a props declaration; a
  component that accepts props uses `useProps(...)`. Do not add OWL 2-style `static props` or
  `static defaultProps`, which OWL 3 rejects.
- Desktop/mobile presets and online/offline connectivity are independent test dimensions.
  When a requirement says a predicate works online and offline under both presets, pair the
  desktop and mobile tests and assert both connectivity states inside each preset.
- Use `mockOffline()` only when the behavior under test needs RPCs to fail. It installs a
  catch-all RPC response that returns 502 while offline and can turn unrelated background
  calls such as `/mail/store` into timing-dependent failures. For signal-only tests, drive
  `OfflinePlugin.setOffline(...)` directly and restore the online state before the test ends.
- Mounting even a small probe component can start framework services that resolve mail models.
  If the mock server reports a missing model such as `discuss.channel`, register the existing
  mail test models with `defineMailModels()` rather than mocking individual RPC responses.
- Test `isAvailableOffline` in the framework's real order: call `setAvailableOffline(...)`
  while online, switch the plugin offline, await `getVisitedStatus()`, and then assert cached
  availability. The plugin's `_visited` map is populated only during the offline transition;
  an online form lookup may legitimately return `undefined`.
- Review coverage branch by branch, not only statement by statement. Predicate tests must
  exercise empty and non-empty state, matching and non-matching model/id, parked
  `extras.error` entries, the no-argument form, and defensive branches such as a non-array
  `args[0]`.
- A thin pass-through wrapper test must prove the complete contract: every positional
  argument, kwargs, options metadata, return value, and expected thrown error. For
  `scheduleORM`, patch `window.isSecureContext` with `patchWithCleanup(...)` to verify that
  `NonSecureContextError` propagates unchanged.
- Do not generate optional property-based-test tasks unless the repository already provides
  an approved property-testing facility. Adding a JavaScript property-testing package would
  violate the no-new-dependencies constraint; express the properties as deterministic
  example and edge-case tests instead.
- Run `check.sh scope` after changing comments as well as executable code. Its prohibited
  offline-machinery scan examines source text, including comments, so comments in CRM files
  must not introduce forbidden primitive names merely to describe framework internals.
- Later mobile CRM components consume `useCrmOffline()` instead of resolving
  `OfflinePlugin` or `UIPlugin` independently. The shared hook is the only CRM code that reads
  the private `_ormToSync()` signal; parked entries remain queued, and pending creates without
  a server `resId` remain deferred to spec 07's create-flow handling.

## Lessons from spec 03

Spec 03 added the CRM PWA manifest shortcuts and seeded the shared `test_crm_offline.py`
(class `TestCrmOffline`). Generation and PR review surfaced a spec-contract wording trap
and a few extension/parity habits later specs must keep:

- Until spec 08 bumps the manifest version, `check.sh full` is EXPECTED to fail exactly one
  thing: acceptance row 5 (crm manifest version bumped one minor increment). Every spec
  before 08 therefore MUST phrase its verification as "`check.sh quick` and `check.sh full`
  are run; all five test commands and all scope checks pass; acceptance row 5 (version bump)
  is expected to fail until spec 08." NEVER write "check.sh full passes" (or "all acceptance
  rows pass") as an acceptance criterion in requirements, design, or tasks before spec 08 —
  that is self-contradictory with the frozen `1.9` version and was the one blocking review
  finding on PR #5. Report the row-5 failure as an explicit, expected deviation, not a
  regression.
- When extending a framework method, call `super()` first and only append; assert the
  parent's result is preserved by capturing it DYNAMICALLY at test time (instantiate the
  parent controller / call `super()`), never by hardcoding the expected parent list. A
  hardcoded baseline passes even when the parent silently changes.
- When you reproduce a parent's data shape (dict keys, nested sub-dict keys, literal values
  such as the icon `sizes`), assert the shape EXACTLY: the full key set at each level, plus
  the concrete `src` value and the derived field (`type` via `mimetypes.guess_type(src)[0]
  or 'image/png'`), not just "a value is present". The first review pass under-asserted the
  icon `src`/`type`; add those equality checks up front.
- Keep `sudo()` to the exact scope the parent uses and no wider — here, only the
  `ir.model.data` xmlid lookup. Prove the privilege boundary with a fresh non-admin user
  (a `sales_team.group_sale_salesman`), never `admin`, which masks access-rights gaps. An
  over-elevated or admin-only path passes as admin and breaks for the real user.
- `test_crm_offline.py` is the single shared Python test module for specs 04–08. Append new
  classes/methods to it; it is already imported in `addons/crm/tests/__init__.py`. Do not
  create a second CRM offline Python test module, and do not re-add the import.
- The only existing test file any spec may edit is `addons/crm/tests/__init__.py` (to add an
  import). End it with a trailing newline when appending, so the next spec's import diff
  stays a clean one-line addition.
