# Implementation Plan: CRM Offline Inventory

## Overview

This spec produces exactly **one** file: `addons/crm/static/src/mobile/offline_inventory.md`. It writes **no code**, changes **no manifest**, and fixes **no defects**. The sweep findings (the actual entry points) are produced **here, during task execution** — not in requirements or design.

> **No-code note.** Every task below either creates/edits the single inventory Markdown file or runs a read-only sweep/verification. No Python, JavaScript, XML, or manifest is written or modified.
>
> **Test lanes N/A.** Per the design's Testing Strategy, the three test lanes (Python unit / JS Hoot desktop+mobile / browser tour) are **N/A for this spec** because it introduces no code. There are no property-based tests; the design's "Correctness Properties" are document invariants verified by reading plus the git-diff and counts-reconciliation checks. Those lanes apply from PART 2 onward.

## Tasks

- [x] 1. Create the inventory skeleton
  - Create the directory `addons/crm/static/src/mobile/` and the file `addons/crm/static/src/mobile/offline_inventory.md`.
  - Write the top-level title and purpose preamble: a planning inventory of offline-relevant server entry points reachable from the CRM frontend and view layer; performs no code changes and fixes no defects; sweep boundary is `addons/crm/` only.
  - Write the classification legend defining QUEUE, SKIP, DISABLE, the ordered-rule note (QUEUE → SKIP → DISABLE), and the client-resolvable gate (a QUEUE candidate carrying a server onchange, a transient wizard, or an id produced by another queued call is downgraded to DISABLE).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 2. Sweep for entry points (read-only; record file + line for every hit)
  - [x] 2.1 Sweep Category 1 — JS server interactions
    - Grep `addons/crm/static/src` — and explicitly `addons/crm/static/src/webclient` (which contains the share-target item, an expected hit to classify) — for `orm.call`, `orm.read`, `orm.write`, `orm.webReadGroup` (and related `orm.*` reads/writes), `orm.silent.call`, `searchRead`, `webSearchRead`, and the `rpc(` function-call form; `useService("orm")`, `useService("action")`, `useService("rpc")`; `user.hasGroup`, `has_group`, `checkAccessRight` (singular) and `checkAccessRights` (plural); `doAction`, `doActionButton`, `loadAction`.
    - Record file + line + call for each hit as raw sweep data for the table, including the webclient share-target item.
    - _Requirements: 2.1_

  - [x] 2.2 Sweep Category 2 — view / wizard / report buttons
    - Scan `addons/crm/views`, `addons/crm/wizard`, and `addons/crm/report` XML for buttons with `type="object"` or `type="action"` and for report actions that carry a server side effect.
    - Record file + line + call for each hit.
    - _Requirements: 2.2_

  - [x] 2.3 Sweep Category 3 — Python public methods reachable from a button
    - Scan the `crm.lead`, `crm.stage`, and `crm.team` models for public methods reachable from a button, cross-referencing the `name=` bindings found on Category 2 buttons.
    - Record file + line + method for each hit.
    - _Requirements: 2.3_

- [x] 3. Classify every swept entry point
  - Apply the ordered QUEUE → SKIP → DISABLE procedure, with the client-resolvable gate running inside the QUEUE step, to each row discovered in task 2.
  - Assign exactly one label and one one-line justification per entry point.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1_

- [x] 4. Apply the hybrid out-of-scope-view rule
  - For crm-owned JS bodies (including `forecast_kanban_model.js` and `forecast_kanban_renderer.js` calls), emit a per-call row recording file, line, call, classification, and justification, regardless of surface.
  - For each register-only surface (graph, forecast_graph, pivot, forecast_pivot, calendar, activity, forecast_list), emit exactly one DISABLE entry-point row whose file and line point to the arch record in `addons/crm/views/crm_lead_views.xml`, with a justification stating the `js_class`, the file-and-line of its `registry.category("views").add(...)` registration, a note that the body lives in `web` or `mail`, and the phrase "unreachable offline per constraints.md; needs a server round-trip".
  - Where a register-only surface has no arch record in `crm_lead_views.xml`, cite the crm-owned file that defines the surface and state that no such arch record exists.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 5. Capture the eight known PART 2 defect entry points as classified rows (no fixes)
  - Ensure each of these appears as a classified row with a justification and no proposed fix: post-save rainbowman lookup; email/phone force-save propagation; team switcher group probe and manage-teams navigation; lead-generation dropdown module and access probes; recurring-revenue progress aggregate group probe; predictive-scoring tooltip as TWO rows (the lookup call = SKIP, the tooltip button = DISABLE); CRM activity-menu entry; chatter on the lead form (classified DISABLE: not a QUEUE write and not a lead `mail.activity`, read-only offline and must not raise).
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

- [x] 6. Assemble the surface-grouped inventory table(s)
  - Write one or more Markdown tables grouped by surface, each row carrying the five-column schema `file | line | call | classification | justification`, one entry point per row, one-line justification.
  - _Requirements: 4.1, 5.1_

- [x] 7. Write the counts section
  - Report per-class counts for QUEUE, SKIP, and DISABLE, each equal to the number of rows bearing that label.
  - Report per-surface subtotals showing each surface's row count.
  - End with the verbatim closing check line `total rows = QUEUE + SKIP + DISABLE`.
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Write the boundary note
  - Name the surfaces whose internals live in `web` or `mail` and were not swept because they fall outside the `addons/crm/` boundary.
  - _Requirements: 7.1_

- [ ] 9. Verification and reconciliation
  - Verify the single-file deliverable with BOTH commands, because `git diff --name-only` alone cannot show a new untracked file:
    1. `git status --short` — surfaces the new untracked inventory file.
    2. `git diff --name-only ee8c13e -- . ':(exclude).kiro'` — confirms no other tracked path changed (BASE_SHA is `ee8c13e`; once a commit exists, diff against that commit instead).
  - Confirm the ONLY non-`.kiro` path reported by either command is `addons/crm/static/src/mobile/offline_inventory.md`.
  - Reconcile per-class counts and per-surface subtotals against the actual table rows; confirm the closing check line is present verbatim.
  - Confirm every acceptance criterion is a checkable property of the finished document (path, no-change, category coverage, one-label-per-row, five-column format, hybrid-rule rows, counts, boundary note, the eight defect rows).
  - Note: the Stop hook runs `.kiro/scripts/check.sh scope`; report its output verbatim.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 6.2, 6.3, 9.1_

## Notes

- This spec writes **no code**; the Python / JS / tour test lanes are **N/A** per the design's Testing Strategy.
- There are no `*`-marked optional test sub-tasks because no automated tests apply to a static document; verification is by reading plus the git-diff and counts-reconciliation checks (task 9).
- Tasks 2–8 all read from and write into the single inventory file; they are sequential by nature (sweep → classify → hybrid rule → defects → assemble → counts → boundary note).
- Each task references the requirement clause(s) it satisfies for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["5"] },
    { "id": 5, "tasks": ["6"] },
    { "id": 6, "tasks": ["7", "8"] },
    { "id": 7, "tasks": ["9"] }
  ]
}
```
