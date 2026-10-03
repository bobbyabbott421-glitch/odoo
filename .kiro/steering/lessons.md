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
