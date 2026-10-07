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

## Lessons from spec 04

Spec 04 fixed offline form-save / mark-won correctness. It took three PR-review passes to
land; these rules exist so later specs get the offline-write and optimistic-display details
right the first time.

- Know exactly what the framework queues offline, and what it does NOT. The web offline
  layer only falls back to the queue for the record's own `save` (`web_save`), `delete`
  (`web_unlink`), and `archive`/`unarchive`. A `type="object"` button call (and any other
  bare `orm.call`) has NO offline fallback — offline it just raises `ConnectionLostError`.
  Separately, a button WITHOUT `data-available-offline` is disabled at runtime by the
  framework's selector pass. So making a control work offline needs BOTH: the
  `data-available-offline` attribute on the interactive element AND an explicit
  `scheduleORM(model, method, args, kwargs, { extras })` in the handler (the handler also
  replaces the online server call). Neither half alone is enough.
- Never queue a call whose arguments need a server id the record does not have yet. A record
  with no `resId` (`record.isNew` — a brand-new record, OR one created offline whose
  `web_save` create is itself still queued) cannot be the target of a follow-up queued call:
  the queue replays verbatim with no id remapping, so the id would have to come from another
  queued call, which is forbidden. Check `record.isNew` BEFORE saving (not after), so the
  blocked click queues NOTHING at all — not even the offline create a `save()` would enqueue.
  Surface a clear notification instead; do not silently no-op.
- When intercepting a view button, mirror the base controller's own order: `save()` first,
  stop if it returns `false` (invalid/failed save — the button must do nothing, exactly as
  online), and only then perform the action. Capture `const saved = await record.save()` and
  branch on `saved === false`; do not assume the save succeeded.
- Optimistic ("display-only") record values: there is NO public API that updates a record
  without dirtying it. `record.update()` routes through `_update()` and sets `dirty = true`
  + populates `_changes`, which would queue a spurious extra `web_save` on the next
  save/leave. Use the framework's own cohesive helper `record._applyValues({ ... })` followed
  by `this.model.notify()` — it folds the values into `_values`, `data`, `_textValues`,
  `_initialTextValues` and the eval context together, leaving `_changes` untouched. Do NOT
  hand-write the individual private fields (`_values`/`data`/`_textValues`/`_setEvalContext`)
  separately; that is what the first implementation did and review rejected it for a
  cohesive helper.
- Test fixtures (Hoot mock models) MUST declare each field with the SAME type as production.
  Spec 04 first modelled `crm.lead.won_status` as `fields.Char` when production is
  `fields.Selection` (crm_lead.py); the mismatch hid where the eval-context value really
  comes from (`data` for a Selection) and produced a misleading rationale. The Hoot mock
  framework supports `fields.Selection({ selection: [...] })` — use it; match the real
  field types so the test exercises the real code path.
- Queue assertions must check the WHOLE queue's state, not just "my call isn't there". For a
  path that must queue nothing, assert `_ormToSync()` is empty (or unchanged in size and
  content), not merely that one method is absent — otherwise a stray `web_save` slips
  through (this was a blocking review finding). Replay tests must do a REAL reconnect
  (`mockOffline()` + `WebClient` + `setOffline(false)` + `runAllTimers()`) and assert on what
  the mock SERVER received (arrival order, last-write-wins value), not just the queued
  entries. For a rejected replay, assert the parked entry's `extras.error` INCLUDES the
  server's actual error text and that the systray surfaces that text (its `data-tooltip`),
  not merely that some error exists.
- (Carried forward, were missing from earlier lessons.) New files under `.kiro/` are ignored
  by Odoo's gitignore, so always `git add -f` them when staging or committing — do this
  automatically, never stop to ask. And never deviate from a decision already agreed with the
  user (an approved spec, a chosen approach, a named file set) without asking first; if source
  inspection shows the agreed plan is wrong, raise it and get agreement before changing course.

## Lessons from spec 05

Spec 05 made six CRM controls honest offline and fixed the lead-form chatter. It took three
PR-review passes; these rules exist so later specs get offline-control, test-wiring, and
spec-honesty details right the first time.

### Offline control-disable mechanics

- The framework's offline pass disables ONLY `<button>` (offline_plugin.js:48
  `SELECTORS_TO_DISABLE`). `<a type="object">` / `<a type="action">` view buttons render as
  `<a>` via `ViewButton` and stay clickable offline; the call then fails with a
  `ConnectionLostError` that web's `lostConnectionHandler` (offline_error.js, sequence 98)
  swallows silently — no dialog, no notification, nothing queued.
- A control on a view CRM does not own cannot be guarded without adding a `js_class` to a
  foreign view (forbidden). Record it as an explicit known limitation and prove the framework
  behavior on a REPLICA arch (a minimal `<form>`/`<list>` built in the test), labelled as a
  replica — never claim it exercises the real view.
- A disabled `<button>` blocks click, keyboard and hotkey but NOT a direct programmatic call.
  Any handler reachable in code (e.g. a tooltip/widget method) needs its own offline early
  return in addition to the framework disable.
- Non-button controls (a `<div>`/`<span>` with `t-custom-click`, a `DropdownItem`) are never
  framework-disabled; add an explicit offline guard in their handler.

### Reading the offline signal

- Do not trust a single `isOffline()` read. `setOffline(true)` is async, and any
  `RPC:RESPONSE` that is not a `ConnectionLostError` flips the signal back online
  (offline_plugin.js:96) — including mid-way through an offline reopen (cache-served reads
  trigger a response). Guard with BOTH: skip when offline AND wrap the call in a try/catch
  for `ConnectionLostError`.
- When you skip offline, mark the work skipped and refetch on reconnect through the SAME
  guarded method (e.g. `this.load`), never `super.load` directly — so a drop mid-refetch is
  caught and re-armed instead of surfacing unhandled.

### Skipped SKIP probes (reconnect re-probe)

- Hold the probe result in a reactive owl `signal` (owl exports `signal`/`proxy`, NOT
  `reactive`) so a value set on reconnect re-renders with no other user action.
- Re-run the skipped probe once with `useOnChange(() => [isOffline()], cb, { initialRun:
  false })`.
- After an `await` in the reconnect callback, check `status(this) !== "destroyed"` before
  writing state.
- Add a `.catch` that re-arms the skipped flag ONLY for `ConnectionLostError` and rethrows
  everything else.

### Tests must depend on production wiring

- A test that still passes with the production wiring removed does not count. Never register a
  component in the test with `{ force: true }`; rely on the production registry entry. Never
  set or clear a production flag (e.g. `_teamsProbeSkipped`) by hand; arm it through a real
  production method (e.g. `onCompanyChange` offline). Never patch `OfflinePlugin.setOffline`;
  drive connectivity through the `setOffline` helper.
- Run one removal check per fix: delete the production `useOnChange` / `Renderer` registration
  / `try/catch`, confirm the test fails, then restore. (In spec 05 removing `useOnChange` made
  the reconnect lookup never fire — `search:1`/`search:2` → `Received: []`.)

### Expected-error discipline

- Never declare an error as "expected" just to go green. In spec 05 the `/mail/store`
  connection error WAS the bug (an unhandled rejection from an un-awaited `load()`); the fix
  was to swallow it, not to allow it. Declare only errors the framework legitimately produces
  (e.g. the cached-record `web_read` refetch on an offline reopen), with EXACT messages via
  `expect.errors(n)` + `verifyErrors`, as web's own
  `window_action.test.js` "[Offline] navigate through window actions" does.

### Hoot harness facts

- mail's `start()` already mounts a `WebClient` — do not mount a second one (duplicated
  chatters). Seed `MockServer`/`pyEnv` data only after the server exists. The app must exist
  before calling `setOffline`.
- `location.reload()` cannot be patched; test the install path by making its RPC fail rather
  than reaching the reload.
- To reopen a cached record offline, open it online first with the SAME action + `res_id`,
  then `doAction` it again offline.
- A `check.sh quick` run takes ~20s; if one is still running near 2 minutes, stop and report
  (a page-reloading test once caused ~20-minute runs and stalled the turn).

### Honesty of comments, spec text, and task state

- A comment or spec claim must not exceed what the test does. If a test says it presses Enter
  or `alt+c`, it must send those keys (not call the handler directly). A coverage table must
  name only tests that EXIST and say "replica" wherever the arch is synthetic.
- Never write "confirmed with the user" for something that was not; use "approved in spec
  review" only when true.
- Keep a tasks.md item UNTICKED while its test is red. Draft-preservation / abort claims
  belong to the specific test that exercises them, named as such.

### Process

- When a time-box is reached (e.g. two `check.sh quick` runs per issue) and the test is still
  red, STOP and show the log — do not rewrite the test to bypass the production wiring.
- Do not use sub-agents for test-fix loops; their network errors and stalls cost two failed
  turns and ~68 credits in this spec.

## Lessons from spec 06

Spec 06 added the offline data-coverage work (3a/3b/3c) and took two PR-review rounds. These
rules capture the traps that round 2 exposed so later specs avoid them.

### Async gate values

- An `async` method returns a Promise; never compare that Promise with a number. `foo() > 0`
  where `foo` is async is `Promise > 0` === `NaN > 0` === **false** — it does NOT throw and is
  NOT "truthy". In spec 06 the C1 bug (`_hasCachedActivityTypes.set(_schedulableCachedCount() > 0)`)
  silently kept the schedule gate CLOSED, not open. `await` the count first, then compare, and
  re-check `status(this) !== "destroyed"` after the await. State the failure direction
  correctly in comments/specs (closed, not open).

### Do not read a mutated reactive array inside a `useOnChange`/`computed` dependency

- `CrmChatter` recomputes optimistic rows on `useOnChange(() => [this._queueSignature()], () =>
  this._syncOptimisticActivities())`. Making `_queueSignature()` read `thread.activities` (to
  scope mark-done entries to this lead) coupled the dependency to the very array the callback
  MUTATES, churning the reconcile and intermittently breaking unrelated schedule tests (8.7,
  FIX6) in the full-suite order while passing in isolation. Scope by stable data instead:
  resolve each queued `action_feedback` activity from the store (`this.store["mail.activity"].get(id)`)
  and match its own `res_model`/`res_id`. Lesson: a signature/computed must depend only on
  values its own effect does not write.

### A regression test must fail with the bug present — verify the DIRECTION

- A "gate stays closed" test passed with the C1 bug AND the fix, because another method
  (`_refreshCachedActivityTypes`) also set the gate and masked it. Target the method under test
  DIRECTLY (call `_prefetchActivityTypes`, stub the confounding sibling to a no-op, force the
  awaited count), assert the strict boolean, and run a real removal check: re-inject the bug,
  confirm the test goes red (it did: 125/1), then restore. If a test passes both ways, it
  proves nothing.

### Mounted-chatter reconnect fold-in is best-effort (KL-B) — assert the server, not the DOM

- For a replayed schedule/mark-done, assert the authoritative mock SERVER state
  (`MockServer.env[model].browse(id)` → fields; `.length` for existence) plus the drained
  queue and the cleared marker. Do NOT assert the live in-memory row fold-in/removal on the
  already-mounted chatter — it depends on the reconnect refetch and flakes. `browse(id)` is the
  reliable read in this harness (not `search_count`, which was not confirmed available).

### Positive super-path assertions, no blanket try/catch

- When a patched handler must fall through to `super`, prove it POSITIVELY (spy the concrete
  effect — e.g. patch the component's `markDonePopover.open` and assert it was called once) and
  assert nothing was queued. Do not wrap the call in a broad try/catch that swallows a real
  CRM-side throw just because `super`'s popover needs a DOM anchor.

### LazyTranslatedString compares

- `_t("...")` returns a `LazyTranslatedString`, not a `String`. `expect(label).toBe("Scheduled")`
  fails with `<cannot display LazyTranslatedString>`. Compare `String(label)` (or `.toString()`).

### KL-C — session-scoped schedulable allow-list (carry forward)

- The non-meeting activity-type allow-list (`_schedulableTypeIds`) is a session-scoped `WeakMap`,
  NOT persisted. After an offline page RELOAD before any online prefetch, nothing is schedulable
  and the schedule control is disabled (fail-safe — never leaks a meeting type). Persisting it
  would need a PUBLIC key/value API on `web`'s offline IndexedDB (the many2x cache drops
  `category`, `_idb` is private, and a second store is forbidden by constraints.md) — out of the
  write boundary. Recorded as KL-C and flagged for Step 10 manual validation. If a later spec
  wants reload-survival, add the public `web` API first; do not write `_idb` or add a store.

### Probe before building; stop and report when a public API is missing

- When a review asks for persistence/behaviour that may need framework support, PROBE the public
  API first (read the plugin in full), and if it is absent, STOP and report options + a
  recommendation rather than reaching into private fields or adding forbidden machinery. The user
  decides; record the outcome as a named known limitation.
