# Design Document

## Overview

This design specifies **how the CRM offline inventory document is produced and structured** — the shape of the artifact and the method used to populate it. It does not contain the sweep results; discovering and recording the actual entry points is a downstream task. The design fixes the document's sections, the sweep methodology that finds entry points, the decision procedures that classify them and handle out-of-scope views, and the verification approach that proves the artifact is well-formed.

The deliverable is a planning artifact, not software. It changes no Python, no JavaScript, no XML, and no manifest. The only new file written to the repository is the inventory itself.

## Architecture

The artifact's architecture is the fixed shape of the inventory document together with the methods that populate it: the deliverable boundary, the document's section layout, the sweep methodology that discovers entry points, the hybrid rule for out-of-scope views, and the ordered classification procedure.

### Deliverable and Boundary

- **Single output.** `addons/crm/static/src/mobile/offline_inventory.md` is the one and only file this spec creates or modifies. (Validates: Requirements 1.1, 1.2, 1.3)
- **No code or manifest change.** No source file, view, security rule, or `__manifest__.py` is touched. The directory `addons/crm/static/src/mobile/` is on the allowed-new-files list from `constraints.md`; this file is one of those allowed paths.
- **Sweep boundary.** Only `addons/crm/` is swept. Files under `addons/web/` and `addons/mail/` are out of boundary and are never edited or itemized line-by-line; they are referenced only where the hybrid rule and the boundary note require a pointer back into crm. (Validates: Requirements 2.1–2.3)

The design treats "the inventory" as a static Markdown document whose correctness is a function of its structure and content, verified by reading and by two mechanical checks (git-diff and counts reconciliation).

### Document Structure

The `.md` is organized into the following sections, in order.

#### Title and purpose preamble
A top-level title and a short preamble stating that the document is a planning inventory of offline-relevant server entry points reachable from the CRM frontend and view layer, that it performs no code changes and fixes no defects, and that the sweep boundary is `addons/crm/` only.

#### Classification legend
A legend defining the three labels and the rules that assign them:
- **QUEUE** — a client-resolvable write on `crm.lead`, `crm.stage`, or `crm.team`, or a `mail.activity` on a lead.
- **SKIP** — a decorative or advisory read.
- **DISABLE** — every entry point that is neither QUEUE nor SKIP (wizards, module install, paid lookups, server-computed reports, access probes gating destructive UI, navigation to offline-unavailable actions).
- **Ordered-rule note** — the labels are applied in the order QUEUE → SKIP → DISABLE.
- **Client-resolvable gate** — a QUEUE candidate whose argument list carries a server onchange, a transient wizard, or an id produced by another queued call is downgraded to DISABLE.

(Validates: Requirements 3.1–3.6)

#### Inventory table(s), grouped by surface
One or more Markdown tables, grouped by **Surface** (view, form widget, systray entry, menu, etc.). Each row describes exactly one entry point with five columns:

| file | line | call | classification | justification |

Each justification is one line. (Validates: Requirements 4.1, 5.1)

#### Counts section
A section that tabulates:
- **Per-class counts** — the number of QUEUE, SKIP, and DISABLE rows, each equal to the number of rows bearing that label.
- **Per-surface subtotals** — each surface's row count.
- **Closing check line** — the verbatim string `total rows = QUEUE + SKIP + DISABLE`.

(Validates: Requirements 6.1, 6.2, 6.3)

#### Boundary note
A note naming the surfaces whose internals live in `web` or `mail` and were therefore not swept, making the intentional omission explicit. (Validates: Requirement 7.1)

### Sweep Methodology

Entry points are discovered by grep/scan over the fixed `addons/crm/` corpus. Each hit's file path and line number are captured with the read/grep tooling. Three categories:

#### Category 1 — JS server interactions
Grep `addons/crm/static/src` — and explicitly `addons/crm/static/src/webclient` (which contains the share-target item, an expected hit to classify) — for:
- ORM/rpc calls: `orm.call`, `orm.read`, `orm.write`, `orm.webReadGroup` (and related `orm.*` reads/writes), `orm.silent.call`, `searchRead`, `webSearchRead`, and the `rpc(` function-call form.
- Service lookups: `useService("orm")`, `useService("action")`, `useService("rpc")`.
- Group / access-right probes: `user.hasGroup`, `has_group`, `checkAccessRight` (singular) and `checkAccessRights` (plural).
- Action dispatch: `doAction`, `doActionButton`, `loadAction`.

#### Category 2 — View / wizard / report buttons
Scan `addons/crm/views`, `addons/crm/wizard`, and `addons/crm/report` XML for:
- Buttons with `type="object"` or `type="action"`.
- Report actions.

#### Category 3 — Python public methods
Scan the `crm.lead`, `crm.stage`, and `crm.team` models for public methods reachable from a button, cross-referenced from the `name=` bindings on Category 2 buttons.

For every discovered entry point, record `file` + `line` via the grep/read tooling so each row is traceable. (Validates: Requirements 2.1, 2.2, 2.3, 4.1)

### Hybrid Out-of-Scope-View Handling

Some CRM views are **register-only surfaces**: crm registers the view in the registry, but the JS body that issues the server calls lives in `web` or `mail`. The decision procedure:

#### Decision rule
- **Body under `addons/crm/`** → the call gets its own **per-call row** (file, line, call, classification, justification), regardless of surface. (Validates: Requirement 5.1)
- **crm only registers the view (body in web/mail)** → the surface is represented by **one DISABLE entry-point row** whose file and line point to the arch record in `addons/crm/views/crm_lead_views.xml`. That row's justification states:
  - the `js_class`,
  - the file-and-line of its `registry.category("views").add(...)` registration,
  - a note that the body lives in `web` or `mail`,
  - the fixed phrase **"unreachable offline per constraints.md; needs a server round-trip"**.

  (Validates: Requirements 5.2, 5.3)
- **No-arch-record fallback** → if a register-only surface has no arch record in `crm_lead_views.xml`, the row instead cites the crm-owned file that defines the surface and states that no such arch record exists. (Validates: Requirement 5.4)

#### Known inputs (already-gathered citations)
> **HINT — re-verify, do not copy.** These citations (arch-record and registration line numbers) are *hints* the sweep task MUST re-verify against the current code during task execution: every line number must be confirmed by reading the source before it is recorded. They are not final results and MUST NOT be copied into the inventory without re-verification.

These citations are the known inputs the sweep task feeds into the decision rule above; the design records them so the procedure is reproducible, not as final findings.

Arch records in `addons/crm/views/crm_lead_views.xml`:
- calendar @384, activity @469, forecast kanban @565, forecast list @765, graph @833, forecast_graph @851, pivot @873, forecast_pivot @893.

Registrations:
- `crm_graph_view.js:12`, `crm_pivot_view.js:12`, `crm_activity_view.js:12`, `crm_calendar_view.js:11`, `forecast_graph_view.js:12`, `forecast_pivot_view.js:12`, `forecast_kanban_view.js:20`, `forecast_list_view.js:12`.

Note: **forecast_kanban has crm-owned body calls** (`forecast_kanban_model.js`, `forecast_kanban_renderer.js`). Those bodies live under `addons/crm/`, so by the decision rule they take **per-call rows**, in addition to the register-only arch-record treatment for the surface registration itself.

### Classification Decision Procedure

Each entry point is assigned exactly one label by applying the rules in order:

1. **QUEUE** if it is a client-resolvable write on `crm.lead`, `crm.stage`, or `crm.team`, or a `mail.activity` on a lead.
2. Otherwise **SKIP** if it is a decorative or advisory read.
3. Otherwise **DISABLE**.

The **client-resolvable gate** runs within step 1: a QUEUE candidate whose argument list contains a server onchange, a transient wizard, or an id produced by another queued call is not client-resolvable and is downgraded to **DISABLE**. (Validates: Requirements 3.1–3.6)

#### Expected classification of the eight known PART 2 defects
> **HINT — re-verify, do not copy.** The classifications below are *hints* that the sweep task MUST re-verify against the current source during task execution; they are not final results and MUST NOT be copied into the inventory without re-confirming each entry point's call and effect by reading the code. (Validates: Requirements 8.1–8.9)

- **Post-save rainbowman lookup** → SKIP (decorative/advisory read).
- **Email / phone force-save propagation** → part of the QUEUE write (folded into the lead write, not a separate queued call).
- **Team switcher group probe** → SKIP (advisory group read); **manage-teams navigation** → DISABLE (navigation to an offline-unavailable action).
- **Lead-generation dropdown module and access probes** → DISABLE (module install / access probes gating unavailable UI).
- **Recurring-revenue progress aggregate group probe** → SKIP (advisory aggregate read).
- **Predictive-scoring tooltip** → three server-touching rows, all DISABLE (PART 2 item 6): the pre-lookup `record.save()`, the `prepare_pls_tooltip_data` **lookup call** (DISABLE because it recomputes probability server-side — a write, not an advisory read), and the post-lookup `record.load()`; plus a DISABLE row for each `pls_tooltip_button` widget control.
- **CRM activity-menu entry** → DISABLE (navigation to an offline-unavailable action).
- **Chatter on the lead form** → DISABLE (not a QUEUE write and not a lead `mail.activity`; read-only offline, must not raise an uncaught error; PART 2 item 8).

Each defect is recorded as a classified row only, with a justification and no fix. (Validates: Requirement 8.9)

## Components and Interfaces

The "components" of this artifact are the sections of the inventory document; the "interfaces"/methods are the decision procedures that populate them. Together they define what the finished document contains and how each row is produced.

### Components — the inventory document's sections

- **Title and preamble component.** The top-level title and purpose preamble (see Architecture → Document Structure → Title and purpose preamble): states the document is a planning inventory, performs no code changes, fixes no defects, and sweeps `addons/crm/` only.
- **Classification legend component.** Defines the QUEUE / SKIP / DISABLE labels, the ordered-rule note (QUEUE → SKIP → DISABLE), and the client-resolvable gate. (Validates: Requirements 3.1–3.6)
- **Surface-grouped table component.** One or more tables grouped by surface, each row carrying the fixed five-column schema `file | line | call | classification | justification`, one entry point per row, one-line justification. (Validates: Requirements 4.1, 5.1)
- **Counts component.** Per-class counts, per-surface subtotals, and the verbatim closing check line `total rows = QUEUE + SKIP + DISABLE`. (Validates: Requirements 6.1, 6.2, 6.3)
- **Boundary-note component.** Names the surfaces whose internals live in `web` or `mail` and were not swept, making the omission explicit. (Validates: Requirement 7.1)

### Interfaces — the methods that populate the components

- **Sweep interface.** The three-category grep/scan over `addons/crm/` (JS server interactions; view/wizard/report buttons; Python public methods) that discovers entry points and records `file` + `line` for each, as specified in Architecture → Sweep Methodology. (Validates: Requirements 2.1, 2.2, 2.3, 4.1)
- **Classification interface.** The ordered QUEUE → SKIP → DISABLE procedure with the client-resolvable gate, as specified in Architecture → Classification Decision Procedure. Produces exactly one label per row. (Validates: Requirements 3.1–3.6, 8.1–8.9)
- **Hybrid out-of-scope interface.** The decision rule in Architecture → Hybrid Out-of-Scope-View Handling that routes in-boundary call bodies to per-call rows and register-only surfaces to a single DISABLE arch-record row (with the no-arch-record fallback). (Validates: Requirements 5.1, 5.2, 5.3, 5.4)

## Data Models

No data-model change. This spec adds no field to `crm.lead`, `crm.stage`, or `crm.team` and introduces no new model. The only "data structure" is the inventory table schema (five columns: `file | line | call | classification | justification`) defined under Architecture → Document Structure.

## Error Handling

Because the deliverable is a static document and not executable code, "error handling" here means the failure modes of the production method and how the design guards against them:

- **Boundary violation** — any edit outside `addons/crm/` is a hard failure; the verification git-diff check (see Testing Strategy) catches it by reporting more than the one allowed path.
- **Miscount** — if per-class counts or per-surface subtotals disagree with the table, the counts reconciliation check fails; the author corrects the counts or the table before completion.
- **Missing fixed phrase / fields** — a register-only row lacking the exact phrase or a row missing one of the five columns is caught by document inspection against Requirements 4.1 and 5.3.
- **Ambiguous classification** — a row that could carry two labels is resolved by the ordered rule (QUEUE → SKIP → DISABLE) and the client-resolvable gate; the legend documents the tie-break so the resolution is reproducible.

## Testing Strategy

**This spec changes no code, so there are no Python unit tests, no JavaScript (Hoot) unit tests, and no browser tour.** The three test lanes defined in the testing steering (Python / JS desktop+mobile / tour) are **N/A for this spec** and should be marked as such at the acceptance gate; those lanes apply from PART 2 onward, where code is actually introduced.

No property-based tests apply: the deliverable is a static artifact with no function to quantify over, and the corpus (the crm tree and the finished document) is fixed, so there is no benefit to generated iterations. The correctness properties below are stated as **document invariants** for traceability, verified by inspection and the two mechanical checks — not as PBT targets.

### Verification Approach

Verification for this spec is entirely by:

1. **Document review** — reading the inventory against each acceptance criterion. Every requirement's acceptance criterion maps to a checkable property of the finished document — path, no-change, category coverage, one-label-per-row, five-column format, hybrid-rule rows, counts, boundary note, and the eight defect rows — confirmed by reading. (Validates: Requirements 2–5, 7, 8, 9)
2. **git-diff check** — use BOTH `git status --short` (to surface the new untracked inventory file, since `git diff --name-only` alone cannot show an untracked file) AND `git diff --name-only ee8c13e -- . ':(exclude).kiro'` (BASE_SHA ee8c13e; diff against the commit once one exists, to confirm no other tracked path changed). The only non-`.kiro` path reported by either command must be `addons/crm/static/src/mobile/offline_inventory.md`. (Validates: Requirements 1.1–1.4)
3. **Counts reconciliation** — per-class sums equal the table row count; per-surface subtotals sum to the total; the closing check line `total rows = QUEUE + SKIP + DISABLE` is present verbatim. (Validates: Requirements 6.1–6.3)

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

*Note: these are document invariants over the finished inventory, verified by reading plus the git-diff and counts-reconciliation checks. They are not property-based-testing targets, because this spec produces a static document and introduces no code.*

### Property 1: Single-path change

For any state of the working tree after the inventory is written, the combination of `git status --short` and `git diff --name-only ee8c13e -- . ':(exclude).kiro'` reports exactly one non-`.kiro` path, `addons/crm/static/src/mobile/offline_inventory.md` (the status command surfaces the untracked new file; the diff confirms no other tracked path changed).

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Exactly one classification per row

For every row in the inventory, the classification column holds exactly one of the labels QUEUE, SKIP, or DISABLE.

**Validates: Requirements 3.1, 9.1**

### Property 3: Ordered rule with client-resolvable gate

For any swept entry point, its classification equals the result of applying QUEUE → SKIP → DISABLE in order, where a QUEUE candidate whose argument list is not client-resolvable is assigned DISABLE instead of QUEUE.

**Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**

### Property 4: Five-field row completeness

For every row in the inventory, all five fields — file path, line number, call, exactly one classification, and a one-line justification — are present and non-empty.

**Validates: Requirements 4.1, 9.1**

### Property 5: In-boundary call bodies are itemized per call

For any server call whose JS body lives under `addons/crm/`, the inventory contains its own per-call row recording file, line, call, classification, and justification, regardless of surface.

**Validates: Requirement 5.1**

### Property 6: Register-only surfaces take one DISABLE arch-record row

For any register-only surface, the inventory contains exactly one DISABLE row whose file and line point to the arch record in `addons/crm/views/crm_lead_views.xml` (or, when no such arch record exists, to the crm-owned defining file with a note that no arch record exists), and whose justification contains the `js_class`, the registration file-and-line, the body-in-web/mail note, and the phrase "unreachable offline per constraints.md; needs a server round-trip".

**Validates: Requirements 5.2, 5.3, 5.4**

### Property 7: Counts reconcile with the table

For each classification label, the per-class count reported in the Counts section equals the number of rows bearing that label; for each surface, the reported subtotal equals that surface's row count; the sum of per-surface subtotals equals the total row count; and the closing check line "total rows = QUEUE + SKIP + DISABLE" is present verbatim.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 8: Boundary note names unswept web/mail surfaces

For any surface whose internals live in `web` or `mail` and were not swept, the inventory's boundary note names that surface and states it falls outside the boundary.

**Validates: Requirement 7.1**

### Property 9: Known-defect entry points are classified rows with no fix

For each of the eight known-defect entry points (post-save rainbowman lookup; email/phone force-save propagation; team switcher group probe and manage-teams navigation; lead-generation dropdown module and access probes; recurring-revenue aggregate group probe; predictive-scoring tooltip button; CRM activity-menu entry; chatter on the lead form), the inventory contains a classified row that records a classification and justification and proposes no fix.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9**
