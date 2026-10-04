# Implementation Plan: CRM PWA packaging + Python test scaffold

## Overview

Spec 03 delivers PART 5: two CRM deep-link shortcuts in the backend PWA manifest, plus the
shared `TestCrmOffline` Python test module that specs 04–08 will append to. The work touches
exactly three files and adds no framework, dependency, or manifest-version change.

- `addons/crm/controllers/webmanifest.py` (modify) — add the `_get_shortcuts()` override.
- `addons/crm/tests/test_crm_offline.py` (new) — seed `TestCrmOffline` with two test methods.
- `addons/crm/tests/__init__.py` (modify) — append one import line.

Spec 03 owns no acceptance-gate rows (per `spec-plan.md`); rows 2, 3, 4, 11, 13 are enforced
on every spec by `check.sh scope` and the Stop hook. The manifest version bump stays with
spec 08.

## Tasks

- [x] 1. Add the `_get_shortcuts()` override to the CRM manifest controller
  - Modify `addons/crm/controllers/webmanifest.py` (design section "Components and Interfaces → 1. CRM manifest controller").
  - Add `import mimetypes`, `from odoo import _`, and `from odoo.http import request` to the module imports; keep the existing `_has_share_target()` returning `True` unchanged.
  - Implement `_get_shortcuts()` to call `super()._get_shortcuts()` first, then append exactly two shortcuts in order: Pipeline ("My Pipeline") then New Lead ("New Lead").
  - Resolve the pipeline menu id with `request.env['ir.model.data'].sudo()._xmlid_to_res_id('crm.menu_crm_opportunities')` — the only `sudo()` in the override; add no other elevation.
  - Build each shortcut dict with exactly the parent's keys `name`, `url`, `description`, `icons`; set `url` to `'/odoo?menu_id=%s' % pipeline_menu_id` and `'/odoo/crm/new'` respectively.
  - Set `icons` to a single dict `{sizes: '100x100', src: '/crm/static/description/icon.png', type: mimetypes.guess_type(src)[0] or 'image/png'}`, matching the parent shape.
  - Wrap both names and both (distinct) descriptions in `_`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.2, 5.1, 6.1, 6.2, 6.3_

- [x] 2. Create the `TestCrmOffline` scaffold module with the two packaging tests
  - Create `addons/crm/tests/test_crm_offline.py` (design section "Components and Interfaces → 2. Test module").
  - Define `class TestCrmOffline(HttpCase, TestCrmCommon)` decorated with `@tagged('post_install', '-at_install')`; add the comment noting specs 04–08 append here.
  - Implement `test_shortcuts_extend_parent` (unit): inside `with MockRequest(self.env):`, dynamically capture `WebWebManifest()._get_shortcuts()` as the parent result (not hardcoded); capture `CrmWebManifest()._get_shortcuts()`; assert prefix-equality against the parent, exactly two extra entries, key-set parity (`{'name','url','description','icons'}` and vs a parent entry when non-empty), icons shape (`{'sizes','src','type'}`, `sizes == '100x100'`, truthy `type`), pipeline url vs test-time `_xmlid_to_res_id('crm.menu_crm_opportunities')`, new-lead url `'/odoo/crm/new'`, names via `_()`, distinct descriptions, each icon `src` openable via `file_open(src.removeprefix('/'))`, `_has_share_target() is True`, and `'share_target' in CrmWebManifest()._get_webmanifest()`.
  - Implement `test_manifest_http_salesman` (HttpCase wiring): create a fresh non-admin user in `base.group_user` + `sales_team.group_sale_salesman`, `authenticate`, `url_open('/web/manifest.webmanifest')`, `json.loads` the content, and assert both `_("My Pipeline")` and `_("New Lead")` are in the served `shortcuts` names.
  - _Requirements: 5.2, 7.1, 7.2, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3_

- [x] 3. Register the test module in the tests package initializer
  - Modify `addons/crm/tests/__init__.py` (design section "Components and Interfaces → 3. Package initializer").
  - Append exactly one line `from . import test_crm_offline`, leaving every existing import line unchanged.
  - _Requirements: 7.3_

- [x] 4. Verify through `.kiro/scripts/check.sh`
  - Run checks ONLY through `.kiro/scripts/check.sh`; do not retype the underlying commands. Run `.kiro/scripts/check.sh quick` first (scope gate + the new `TestCrmOffline` Python class + desktop JS unit tests), then `.kiro/scripts/check.sh full` (adds inventory and manifest-version checks and all five test commands) before the PR and for final results.
  - New files under `.kiro/` are gitignored by Odoo, so `git add -f` the spec artifacts; the Stop hook runs `check.sh scope`.
  - All scope checks and all five test commands MUST pass. The acceptance row 5 check in `full` mode (crm manifest version bumped one minor increment) is an EXPECTED failure for spec 03 — the version bump is deferred to spec 08 — so `full` reports that one row as failing while every test command passes; this is not a regression and does not block the spec.
  - Report the script output verbatim. If it fails for an environment reason (a path, the database), say so rather than working around it. Do not bump the manifest version (spec 08 owns it) and do not claim any acceptance-gate rows (spec 03 owns none).
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

## Notes

- This spec has no property-based test tasks: the design's prework classifies every criterion as EXAMPLE/EDGE_CASE/INTEGRATION/SMOKE, and adding a property-testing dependency is forbidden by the constraints. Tests are deterministic example/integration checks.
- Each task references the specific requirement clauses it satisfies for traceability.
- Spec 03 changes exactly three files and owns no acceptance-gate rows; the version bump is deferred to spec 08.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4"] }
  ]
}
```
