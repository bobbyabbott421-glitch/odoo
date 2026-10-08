# Requirements Document

## Introduction

This feature produces a single Markdown inventory document that enumerates and classifies every offline-relevant server entry point reachable from the CRM addon's frontend and view layer. The inventory is a planning artifact: it records what each entry point is, where it lives, and whether an offline-capable mobile CRM must queue it, skip it, or disable it. It performs no code changes and fixes no defects. The sweep that discovers entry points is a downstream task; this document specifies only the rules the inventory must satisfy and the acceptance criteria that make it correct and well-formed.

## Glossary

- **Inventory**: The single deliverable Markdown document that lists and classifies CRM offline-relevant entry points. Located at `addons/crm/static/src/mobile/offline_inventory.md`.
- **Entry_Point**: A JS call to the ORM, rpc, the action service, or a user-group/access-right probe; a view, wizard, or report button with a server side effect; or a public method on `crm.lead`, `crm.stage`, or `crm.team` reachable from a button.
- **Sweep**: The act of locating entry points within the `addons/crm/` boundary for recording in the Inventory.
- **Row**: A single table entry in the Inventory describing one entry point.
- **Classification**: Exactly one of the labels QUEUE, SKIP, or DISABLE assigned to a Row.
- **QUEUE**: Classification for a client-resolvable write on `crm.lead`, `crm.stage`, or `crm.team`, or a `mail.activity` on a lead.
- **SKIP**: Classification for a decorative or advisory read.
- **DISABLE**: Classification for every entry point that is neither QUEUE nor SKIP, including wizards, module install, paid lookups, server-computed reports, access probes gating destructive UI, and navigation to offline-unavailable actions.
- **PART_1_Rules**: The ordered classification rules — evaluate QUEUE first, then SKIP, then DISABLE — with the definitions given in this Glossary.
- **Client_Resolvable**: An argument list containing no server onchange, no transient wizard, and no id produced by another queued call.
- **Surface**: A UI area (for example a view, a form widget, a systray entry, a menu) through which one or more entry points are reached.
- **Register_Only_Surface**: A Surface for which `crm` only registers the view while the JS body that implements it lives in the `web` or `mail` addon.
- **Boundary**: The `addons/crm/` directory tree; files outside it are not swept.
- **Counts_Section**: The section of the Inventory that tabulates per-class counts, per-surface subtotals, and the closing check line.

## Requirements

### Requirement 1: Single-File Deliverable

**User Story:** As a reviewer, I want the inventory delivered as a single untouched-elsewhere file, so that the planning artifact introduces no code or configuration risk.

#### Acceptance Criteria

1. THE Inventory SHALL be written to the path `addons/crm/static/src/mobile/offline_inventory.md`.
2. THE Inventory SHALL introduce no source-code change.
3. THE Inventory SHALL introduce no manifest change.
4. WHEN the working tree is inspected after the Inventory is written using BOTH `git status --short` and `git diff --name-only ee8c13e -- . ':(exclude).kiro'` (where BASE_SHA is `ee8c13e`; once a commit exists, diff against that commit instead), THE Inventory SHALL be the only non-`.kiro` path reported by either command, namely `addons/crm/static/src/mobile/offline_inventory.md`.
   - Rationale: `git diff --name-only` alone cannot show a new untracked file, so `git status --short` is required to surface the untracked inventory while the diff confirms no other tracked path changed.

### Requirement 2: Full Sweep Coverage

**User Story:** As a reviewer, I want the sweep to cover all three entry-point categories, so that no offline-relevant server interaction is omitted.

#### Acceptance Criteria

1. THE Inventory SHALL sweep every JS call in `addons/crm/` to the ORM, to rpc, to the action service, or to a user-group or access-right probe.
2. THE Inventory SHALL sweep every view button, wizard button, and report button in `addons/crm/` that carries a server side effect.
3. THE Inventory SHALL sweep every public method on `crm.lead`, `crm.stage`, and `crm.team` that is reachable from a button.

### Requirement 3: Deterministic Classification

**User Story:** As a reviewer, I want each entry point classified by one deterministic rule set, so that the classification is unambiguous and reproducible.

#### Acceptance Criteria

1. THE Inventory SHALL assign each swept Entry_Point exactly one Classification of QUEUE, SKIP, or DISABLE.
2. THE Inventory SHALL apply the PART_1_Rules in the order QUEUE, then SKIP, then DISABLE when assigning a Classification.
3. WHERE an Entry_Point is a client-resolvable write on `crm.lead`, `crm.stage`, or `crm.team`, or a `mail.activity` on a lead, THE Inventory SHALL classify that Entry_Point as QUEUE.
4. WHERE an Entry_Point is a decorative or advisory read, THE Inventory SHALL classify that Entry_Point as SKIP.
5. WHERE an Entry_Point is neither QUEUE nor SKIP, including wizards, module install, paid lookups, server-computed reports, access probes gating destructive UI, and navigation to offline-unavailable actions, THE Inventory SHALL classify that Entry_Point as DISABLE.
6. IF a QUEUE candidate's argument list is not Client_Resolvable, THEN THE Inventory SHALL classify that Entry_Point as DISABLE.

### Requirement 4: Consistent Row Format

**User Story:** As a reviewer, I want a consistent row format, so that each entry point is traceable and self-justifying.

#### Acceptance Criteria

1. THE Inventory SHALL record for each Row the file path, the line number, the call made, exactly one Classification, and a one-line justification.

### Requirement 5: Hybrid Out-of-Scope-View Representation

**User Story:** As a reviewer, I want out-of-scope views represented by a hybrid rule, so that calls inside the boundary are itemized while register-only surfaces are captured without crossing the boundary.

#### Acceptance Criteria

1. WHERE a server call's JS body lives under `addons/crm/`, THE Inventory SHALL give that call its own per-call Row recording file, line, call, Classification, and justification, regardless of Surface.
2. WHERE a Surface is a Register_Only_Surface, THE Inventory SHALL represent that Surface with one DISABLE entry-point Row whose file and line point to the arch record in `addons/crm/views/crm_lead_views.xml`.
3. WHERE a Surface is a Register_Only_Surface, THE Inventory SHALL state in that Row's justification the `js_class`, the file-and-line of its `registry.category("views").add(...)` registration, a note that the body lives in `web` or `mail`, and the phrase "unreachable offline per constraints.md; needs a server round-trip".
4. IF a Register_Only_Surface has no arch record in `addons/crm/views/crm_lead_views.xml`, THEN THE Inventory SHALL cite the crm-owned file that defines that Surface and state that no such arch record exists.

### Requirement 6: Reconcilable Counts Section

**User Story:** As a reviewer, I want a counts section that reconciles with the table, so that the inventory's totals are verifiable at a glance.

#### Acceptance Criteria

1. THE Counts_Section SHALL report per-class counts for QUEUE, SKIP, and DISABLE that each equal the number of Rows bearing that Classification.
2. THE Counts_Section SHALL report per-surface subtotals showing each Surface's Row count.
3. THE Counts_Section SHALL end with the check line "total rows = QUEUE + SKIP + DISABLE".

### Requirement 7: Explicit Boundary Note

**User Story:** As a reviewer, I want a boundary note, so that it is explicit which surface internals were intentionally not swept.

#### Acceptance Criteria

1. THE Inventory SHALL contain a note naming which Surfaces' internals live in `web` or `mail` and were not swept because they fall outside the Boundary.

### Requirement 8: Known-Defect Rows Without Fixes

**User Story:** As a reviewer, I want the known-defect entry points captured as classified rows, so that the inventory records them without attempting fixes.

#### Acceptance Criteria

1. THE Inventory SHALL capture the post-save rainbowman lookup as a classified Row.
2. THE Inventory SHALL capture the email and phone force-save propagation as a classified Row.
3. THE Inventory SHALL capture the team switcher group probe and the manage-teams navigation as classified Rows.
4. THE Inventory SHALL capture the lead-generation dropdown module and access probes as classified Rows.
5. THE Inventory SHALL capture the recurring-revenue progress aggregate group probe as a classified Row.
6. THE Inventory SHALL capture the predictive-scoring tooltip with its three server-touching calls each as a DISABLE Row — the pre-lookup `record.save()`, the `prepare_pls_tooltip_data` lookup (DISABLE because it recomputes probability server-side, a write, not an advisory read), and the post-lookup `record.load()` — plus a DISABLE Row for each `pls_tooltip_button` widget control.
7. THE Inventory SHALL capture the CRM activity-menu entry as a classified Row.
8. THE Inventory SHALL capture the chatter on the lead form as a DISABLE-classified Row (it is neither a QUEUE write on `crm.lead`, `crm.stage`, or `crm.team` nor a lead `mail.activity`, so by the ordered rule it is DISABLE: read-only offline and must not raise an uncaught error).
9. THE Inventory SHALL record each known-defect entry point as a classified Row only, containing no fix.

### Requirement 9: Brief Acceptance Gate

**User Story:** As a reviewer, I want the brief's acceptance gate satisfied, so that the inventory meets the stated completion bar.

#### Acceptance Criteria

1. THE Inventory SHALL classify every swept Entry_Point as exactly one of QUEUE, SKIP, or DISABLE, with a justification per Row and per-class counts.
