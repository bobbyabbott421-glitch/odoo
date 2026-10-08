# Design Document

## Overview

Spec 03 delivers PART 5 of the CRM offline-mode brief: CRM PWA packaging plus the shared
Python test scaffold. The work is deliberately small and extends existing framework code
rather than adding any.

Two outcomes:

1. **CRM manifest shortcuts.** The existing CRM controller subclass
   `addons/crm/controllers/webmanifest.py` (which already subclasses
   `odoo.addons.web.controllers.webmanifest.WebManifest` and overrides `_has_share_target`
   to `True`) gains an override of `_get_shortcuts()`. The override calls `super()`, then
   appends two CRM deep-link shortcuts — **My Pipeline** then **New Lead** — using exactly
   the parent's shortcut dictionary shape. The shared service worker, manifest route,
   offline page route, colors, and share target are consumed from the web addon unchanged.

2. **Python test scaffold.** A new test module `addons/crm/tests/test_crm_offline.py`
   holding the class `TestCrmOffline`, imported from `addons/crm/tests/__init__.py`. Spec
   03 seeds this module with the packaging tests; specs 04–08 append their Python tests to
   this single file.

Exactly three files change: the controller (modify), the test module (new), and
`tests/__init__.py` (one appended import line). No manifest version bump (spec 08 owns
that), no new dependency, no change outside `addons/crm/`.

## Confirmed source facts

Read from the tree before writing this design; treated as the source of truth:

- **Parent `_get_shortcuts()`** (`addons/web/controllers/webmanifest.py`): reads
  `ir.module.module` **without** sudo (returns `[]` on `AccessError`), reads
  `ir.ui.menu.get_user_roots()`, and `ir.model.data.sudo().search(...)`. Each shortcut it
  builds is:
  ```python
  {
      'name': module.display_name,
      'url': '/odoo?menu_id=%s' % data.mapped('res_id')[0],
      'description': module.summary,
      'icons': [{
          'sizes': '100x100',
          'src': module.icon,
          'type': mimetypes.guess_type(module.icon)[0] or 'image/png'
      }]
  }
  ```
  So the parent's shortcut keys (Shortcut_Keys) are exactly `name`, `url`, `description`,
  `icons`, and each `icons` entry carries `sizes`, `src`, `type`. The parent imports
  `mimetypes` at module top and `file_open`/`file_path` from `odoo.tools`.
- **Parent `_has_share_target()`** returns `False`; the CRM subclass already overrides it
  to `True`. `_get_webmanifest()` includes `share_target` only when `_has_share_target()`
  is truthy, and leaves `background_color`/`theme_color` at `#714B67`.
- **`crm` module icon**: the `crm` manifest declares no `icon` key, so Odoo defaults the
  `ir.module.module` record's `icon` field to the module's standard
  `/crm/static/description/icon.png`. That file exists (confirmed:
  `addons/crm/static/description/icon.png`), so `file_open` on the de-slashed path
  succeeds.
- **Pipeline menu**: `crm.menu_crm_opportunities` is declared in
  `addons/crm/views/crm_menu_views.xml` (`<menuitem id="menu_crm_opportunities" name="My
  Pipeline" .../>`).
- **`_xmlid_to_res_id`**: `ir.model.data._xmlid_to_res_id(xmlid, raise_if_not_found=False)`
  exists (`odoo/addons/base/models/ir_model.py:2359`) and returns the `res_id` (or
  `False`/raises when missing, per the flag).
- **Test common**: `TestCrmCommon` is defined in `addons/crm/tests/common.py`
  (`TestCrmCommon(TestSalesCommon, MailCase)`). `test_crm_ui.py` establishes the
  convention `@tagged('post_install', '-at_install')` with
  `class TestUi(HttpCase, TestCrmCommon)` and creates a plain salesman via
  `base.group_user` + `sales_team.group_sale_salesman`.
- **MockRequest**: `odoo.addons.http_routing.tests.common.MockRequest(env, ...)` is a
  context manager that installs `request` (and `request.env`) for the duration of the
  block, so controller methods that read `request.env` work in a unit test.

## Architecture

```
Browser / installed PWA
        │  GET /web/manifest.webmanifest
        ▼
addons/web ... WebManifest.webmanifest()      (route, unchanged)
        └── _get_webmanifest()                 (unchanged: colors, icons, share_target)
                └── self._get_shortcuts()      ◄── dispatches to the CRM subclass
                             │
                             ▼
addons/crm ... WebManifest._get_shortcuts()    (NEW override)
        shortcuts = super()._get_shortcuts()   → parent entries (mail/crm/project/…)
        + Pipeline_Shortcut  ("My Pipeline" → /odoo?menu_id=<res_id>)
        + New_Lead_Shortcut  ("New Lead"    → /odoo/crm/new)
        return shortcuts
```

Because Odoo instantiates the most-derived controller for a route, `_get_webmanifest()`
(inherited, unchanged) calls `self._get_shortcuts()`, which resolves to the CRM override.
Nothing else in the manifest pipeline is touched.

## Components and Interfaces

### 1. CRM manifest controller — `addons/crm/controllers/webmanifest.py` (modify)

Add two imports and the `_get_shortcuts()` override; keep `_has_share_target()` exactly as
is.

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import mimetypes

from odoo import _
from odoo.addons.web.controllers import webmanifest
from odoo.http import request


class WebManifest(webmanifest.WebManifest):

    def _get_shortcuts(self):
        shortcuts = super()._get_shortcuts()

        # Resolve the pipeline menu id the same way the parent resolves menus:
        # sudo on ir.model.data only (no extra elevation).
        pipeline_menu_id = request.env['ir.model.data'].sudo()._xmlid_to_res_id(
            'crm.menu_crm_opportunities'
        )

        # Use the crm module's standard icon path directly. The crm manifest declares no
        # icon key, so the ir.module.module record's icon field defaults to this exact
        # path; hardcoding it avoids a second (access-controlled) module read while
        # producing the identical value. Type is derived like the parent.
        icon_src = '/crm/static/description/icon.png'
        icons = [{
            'sizes': '100x100',
            'src': icon_src,
            'type': mimetypes.guess_type(icon_src)[0] or 'image/png',
        }]

        shortcuts.append({
            'name': _("My Pipeline"),
            'url': '/odoo?menu_id=%s' % pipeline_menu_id,
            'description': _("Open your sales pipeline"),
            'icons': icons,
        })
        shortcuts.append({
            'name': _("New Lead"),
            'url': '/odoo/crm/new',
            'description': _("Create a new lead"),
            'icons': icons,
        })
        return shortcuts

    def _has_share_target(self):
        return True
```

Design decisions:

- **Icon source — hardcode the known static path, document why.** The parent reads
  `module.icon` from the `ir.module.module` record, which it has already fetched (and which
  may be `[]` under `AccessError`). The CRM override does not re-fetch that record: doing
  so would add a second `ir.module.module` read with its own access handling, and the crm
  record's `icon` field defaults to exactly `/crm/static/description/icon.png` anyway
  (the manifest declares no `icon`). Hardcoding the known path keeps the override simple
  and privilege-free, produces the identical value, and the file provably exists so
  `file_open('crm/static/description/icon.png')` succeeds. The `type` is still derived
  through `mimetypes.guess_type(...)[0] or 'image/png'`, exactly matching the parent.
- **Single sudo scope.** The only `sudo()` is the `ir.model.data` lookup for the pipeline
  menu id, matching the one sudo scope the parent already uses for its menu lookup
  (Req 5.1). No `ir.module.module` sudo, no other elevation. A plain salesman therefore
  gets both shortcuts (Req 5.2).
- **Shape parity.** Each appended dict carries exactly `name`, `url`, `description`,
  `icons`, and each `icons` entry carries exactly `sizes`/`src`/`type` — no key added or
  omitted versus the parent shape (Req 1.4, 1.5).
- **Order.** `super()` result first, then Pipeline then New Lead, by two `append` calls
  (Req 1.1–1.3, 2.x, 3.x).
- **Translatability.** Both names and both descriptions are wrapped in `_` from `odoo`;
  the two descriptions are distinct strings (Req 3.3, 4.1, 4.2).
- **Untouched framework behavior.** No route is overridden, colors are left to the parent,
  and `_has_share_target()` keeps returning `True` (Req 6.1–6.3).

### 2. Test module — `addons/crm/tests/test_crm_offline.py` (new)

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import _
from odoo.addons.crm.controllers.webmanifest import WebManifest as CrmWebManifest
from odoo.addons.web.controllers.webmanifest import WebManifest as WebWebManifest
from odoo.addons.crm.tests.common import TestCrmCommon
from odoo.addons.http_routing.tests.common import MockRequest
from odoo.tests import HttpCase
from odoo.tests.common import tagged
from odoo.tools import file_open


@tagged('post_install', '-at_install')
class TestCrmOffline(HttpCase, TestCrmCommon):
    # Spec 03 seeds this module; specs 04–08 append their Python tests here.

    def test_shortcuts_extend_parent(self):
        """Unit: CRM override returns parent shortcuts + exactly the two CRM entries."""
        ...

    def test_manifest_http_salesman(self):
        """HTTP wiring: a plain salesman gets both CRM shortcuts over the route."""
        ...
```

- **Class contract.** Name is exactly `TestCrmOffline`; decorator is
  `@tagged('post_install', '-at_install')`; base is `(HttpCase, TestCrmCommon)`, mirroring
  `test_crm_ui.py` (Req 7.1, 7.2).
- **MockRequest.** Any direct controller-method call runs inside
  `with MockRequest(self.env):` so `request`/`request.env` exist for the controller
  (Req 10.3). `MockRequest` lives at `odoo.addons.http_routing.tests.common`.

#### Test method `test_shortcuts_extend_parent` (unit)

Steps:

1. Enter `with MockRequest(self.env):`.
2. **Dynamically capture the parent result** by instantiating the web parent controller
   and calling its `_get_shortcuts()` under the same request:
   `parent_result = WebWebManifest()._get_shortcuts()`. This is captured at test time, not
   hardcoded (Req 8.1).
3. Capture the CRM result: `crm_result = CrmWebManifest()._get_shortcuts()`.
4. **Prefix equality** — assert `crm_result[:len(parent_result)] == parent_result`, i.e.
   the CRM list begins with the parent's entries in order (Req 8.2, 1.1, 1.3).
5. **Exactly two extra** — assert `len(crm_result) == len(parent_result) + 2` (Req 8.3,
   1.2).
6. Bind the two extras: `pipeline, new_lead = crm_result[-2], crm_result[-1]`.
7. **Key parity** — assert `set(pipeline) == set(new_lead) == {'name', 'url',
   'description', 'icons'}`. If `parent_result` is non-empty, additionally assert the extras'
   key set equals that of a parent entry: `set(pipeline) == set(parent_result[0])`
   (Req 9.1, 1.4). Assert each `icons` entry key set is `{'sizes', 'src', 'type'}` and
   `sizes == '100x100'` (Req 1.5).
8. **URLs** — resolve the menu id at test time:
   `menu_id = self.env['ir.model.data']._xmlid_to_res_id('crm.menu_crm_opportunities')`;
   assert `pipeline['url'] == '/odoo?menu_id=%s' % menu_id` (Req 9.3, 2.2) and
   `new_lead['url'] == '/odoo/crm/new'` (Req 9.2, 3.2).
9. **Names/descriptions** — since the test env language is `en_US`, `_()` yields the
   literal English, so assert `pipeline['name'] == _("My Pipeline")`,
   `new_lead['name'] == _("New Lead")` (Req 2.1, 3.1), both descriptions present and
   `pipeline['description'] != new_lead['description']` (Req 3.3).
10. **Icon openable** — for each extra, take `src = entry['icons'][0]['src']` and assert
    `file_open(src.removeprefix('/'))` opens without raising; close the handle (Req 9.4).
    Also assert `entry['icons'][0]['type']` is truthy.
11. **Share target** — assert `CrmWebManifest()._has_share_target() is True`, and assert
    `'share_target' in CrmWebManifest()._get_webmanifest()` to prove the manifest keeps it
    enabled (Req 9.5, 6.3).

#### Test method `test_manifest_http_salesman` (HttpCase wiring)

Steps:

1. Create a fresh non-admin user in `base.group_user` + `sales_team.group_sale_salesman`
   (the `test_crm_ui.py` pattern) with a known login/password (Req 10.1, 5.2):
   ```python
   self.env['res.users'].create({
       'name': 'Spec03 Salesman',
       'login': 'spec03_salesman',
       'password': 'spec03_salesman',
       'group_ids': [(6, 0, [
           self.ref('base.group_user'),
           self.ref('sales_team.group_sale_salesman'),
       ])],
   })
   ```
2. `self.authenticate('spec03_salesman', 'spec03_salesman')`.
3. `res = self.url_open('/web/manifest.webmanifest')`; `manifest = json.loads(res.content)`.
4. Collect `names = [s['name'] for s in manifest['shortcuts']]`.
5. Assert both CRM names are present. Because the served request runs in `en_US`, `_()`
   yields the literal English, so compare directly against `_("My Pipeline")` and
   `_("New Lead")` (equivalently the literal strings) — assert each is in `names`
   (Req 10.2). Documented language note: the test env/HTTP context is `en_US`, so `_()`
   and the literal English coincide; comparing via `_()` keeps the test correct if the
   source strings change.

### 3. Package initializer — `addons/crm/tests/__init__.py` (modify)

Append exactly one line, leaving existing imports unchanged (Req 7.3):

```python
from . import test_crm_offline
```

## Data Models

No data-model change. No new field on `crm.lead`, `crm.stage`, or `crm.team`; no new model,
view, or security rule. The only runtime data touched is the read-only
`ir.model.data` lookup resolving the pipeline menu id.

## Error Handling

- **Menu id resolution.** `_xmlid_to_res_id('crm.menu_crm_opportunities')` with the default
  `raise_if_not_found=False` returns the id; the menu is a hard CRM asset so a missing id is
  not an expected runtime state. The URL is formatted exactly as the parent formats its menu
  urls (`'/odoo?menu_id=%s'`).
- **Access errors.** The override adds no un-sudoed privileged read of its own; the single
  `ir.model.data.sudo()` lookup matches the parent's sudo scope, so a plain salesman cannot
  trigger an `AccessError` from the CRM additions. If the parent's own `ir.module.module`
  read raises `AccessError`, the parent returns `[]`; the CRM override then simply appends
  its two shortcuts to that empty list — the two CRM deep links still appear.
- **Icon path.** The hardcoded `/crm/static/description/icon.png` provably exists; the test
  asserts `file_open` succeeds, catching any future removal or rename.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid
executions of a system — essentially, a formal statement about what the system should do.*

The prework classification below shows that spec 03's acceptance criteria are concrete,
single-scenario checks over a fixed controller output and one HTTP route, not behaviors
that vary meaningfully across a large generated input space. Per the workflow's guidance
(deterministic controller output, no pure function with a wide input domain), these are
validated by example and edge-case tests. No property-based tests are generated; the
constraints forbid adding any JS/Python property-testing dependency, and the Python checks
here are deterministic.

### Prework summary (testability classification)

- Req 1.1–1.3 (parent preserved, two extras appended in order): EXAMPLE — one deterministic
  controller call; verified by prefix-equality + length in `test_shortcuts_extend_parent`.
- Req 1.4–1.5, 9.1 (key/shape parity): EXAMPLE — fixed key sets.
- Req 2.1–2.4, 9.3 (pipeline name/url/description/sudo resolver): EXAMPLE — one resolved id.
- Req 3.1–3.3, 9.2 (new-lead name/url/distinct description): EXAMPLE.
- Req 4.1–4.2 (translatable text): EXAMPLE — assert `_()`-wrapped values.
- Req 5.1 (single sudo scope): EXAMPLE/review — asserted indirectly by the salesman HTTP
  test (no admin rights) and confirmed by source review.
- Req 5.2, 10.1–10.2 (salesman gets both shortcuts over HTTP): INTEGRATION — one HTTP
  round-trip in `test_manifest_http_salesman`.
- Req 6.1–6.3 (framework routes/colors/share target preserved): EXAMPLE/review — share
  target asserted via `_get_webmanifest()`; routes/colors untouched by construction.
- Req 7.1–7.3 (scaffold module/class/import): SMOKE — the module importing and the tagged
  class running is itself the check.
- Req 8.1–8.3 (dynamic parent capture): EXAMPLE — captured at test time.
- Req 9.4 (icon openable): EDGE_CASE — `file_open` on the resolved path.
- Req 9.5 (share target enabled): EXAMPLE.
- Req 11.1–11.4 (scope/version/deps/check): SMOKE — enforced by `check.sh scope` and the
  three-file boundary, not a unit assertion.

## Testing Strategy

Two example/integration test methods in `TestCrmOffline`, plus the scaffold-registration
and scope checks. Mapping each requirement to its verification:

| Requirement | Verified by |
|---|---|
| 1.1 parent order preserved | `test_shortcuts_extend_parent` prefix-equality |
| 1.2 exactly two extras, order | `test_shortcuts_extend_parent` length + last-two binding |
| 1.3 no parent entry replaced | `test_shortcuts_extend_parent` prefix-equality |
| 1.4 exact Shortcut_Keys | `test_shortcuts_extend_parent` key-set assertions |
| 1.5 icons single dict, sizes/type | `test_shortcuts_extend_parent` icons-shape assertions |
| 2.1 pipeline name | `test_shortcuts_extend_parent` name assertion |
| 2.2 pipeline url = menu_id | `test_shortcuts_extend_parent` url vs resolved id |
| 2.3 pipeline description | `test_shortcuts_extend_parent` description present |
| 2.4 sudo resolver on ir.model.data | source (override) + resolved-id assertion |
| 3.1 new-lead name | `test_shortcuts_extend_parent` name assertion |
| 3.2 new-lead url = /odoo/crm/new | `test_shortcuts_extend_parent` url assertion |
| 3.3 distinct description | `test_shortcuts_extend_parent` inequality assertion |
| 4.1 names wrapped in `_` | `test_shortcuts_extend_parent` compares against `_()` |
| 4.2 descriptions wrapped in `_` | source (override) + description assertions |
| 5.1 single sudo scope | source review + salesman HTTP success |
| 5.2 salesman sees both | `test_manifest_http_salesman` |
| 6.1 routes not overridden | source (no route defs in subclass) |
| 6.2 colors preserved | source (parent `_get_webmanifest` untouched) |
| 6.3 share target True | `test_shortcuts_extend_parent` share-target assertions |
| 7.1 class name TestCrmOffline | module/class defined |
| 7.2 tagged + HttpCase+TestCrmCommon | class decorator/bases |
| 7.3 one import line appended | `tests/__init__.py` edit |
| 8.1 dynamic parent capture | `test_shortcuts_extend_parent` instantiates web parent |
| 8.2 begins with parent | prefix-equality |
| 8.3 exactly two more | length assertion |
| 9.1 extras match parent shape | key-set equality vs parent entry |
| 9.2 new-lead url | url assertion |
| 9.3 pipeline url resolved | url vs `_xmlid_to_res_id` |
| 9.4 icon openable | `file_open` on icon path |
| 9.5 manifest keeps share target | `_get_webmanifest()` assertion |
| 10.1 fresh salesman, authenticate, fetch route | `test_manifest_http_salesman` |
| 10.2 both shortcuts in served JSON | `test_manifest_http_salesman` |
| 10.3 direct calls inside MockRequest | `test_shortcuts_extend_parent` uses MockRequest |
| 11.1 only Allowed_Files change | three-file boundary + `check.sh scope` |
| 11.2 no version bump | manifest untouched (spec 08 owns bump) |
| 11.3 no new dependency | `requirements.txt`/`depends` untouched + `check.sh scope` |
| 11.4 verified by check.sh quick + full; all scope checks and all five test commands pass; row 5 (version) is an expected failure until spec 08 | run `check.sh quick` and `check.sh full` |

Language note (Req 10.2): the test environment and the served HTTP request both run in
`en_US`, so `_("My Pipeline")`/`_("New Lead")` evaluate to the literal English strings.
Tests compare against the `_()`-evaluated values so they stay correct if the source
literals change.

### Verification

Run through `.kiro/scripts/check.sh` only (do not retype the underlying commands):

- `check.sh quick` — scope gate (files outside `addons/crm/`, requirements/security, new
  offline machinery, `only()`/`debug()` in tests, modified existing test files) plus the
  new `TestCrmOffline` Python class and the desktop JS unit tests.
- `check.sh full` — the above plus inventory and manifest-version checks and all five test
  commands; run before the PR and for final results. All scope checks and all five test
  commands MUST pass. The acceptance row 5 check (crm manifest version bumped one minor
  increment) is an EXPECTED failure for spec 03: the version bump is deferred to spec 08,
  so `full` reports that one row as failing while every test command passes. This is not a
  regression and does not block spec 03.

Spec 03 owns no acceptance-gate rows (per `spec-plan.md`); rows 2, 3, 4, 11, 13 are
enforced on every spec by `check.sh scope` and the Stop hook. Report the script output
verbatim; if it fails for an environment reason, say so rather than working around it.
