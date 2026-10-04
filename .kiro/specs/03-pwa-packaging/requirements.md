# Requirements Document

## Introduction

Spec 03 (CRM PWA packaging + Python test scaffold) covers PART 5 of the CRM offline-mode
brief. It delivers two outcomes inside the `crm` addon:

1. The existing CRM web-manifest controller subclass
   (`addons/crm/controllers/webmanifest.py`, which subclasses
   `odoo.addons.web.controllers.webmanifest.WebManifest`) is extended so the backend PWA
   manifest exposes two CRM deep-link shortcuts — "My Pipeline" and "New Lead" — appended
   after the shortcuts the parent controller already produces. The framework's PWA
   machinery (service worker route, manifest route, offline page route, share target,
   colors) is consumed unchanged.
2. A shared Python test module `addons/crm/tests/test_crm_offline.py`, holding the test
   class `TestCrmOffline`, is created and imported from `addons/crm/tests/__init__.py`.
   This module is the single home that specs 04–08 append their Python tests to; spec 03
   seeds it with the packaging tests described below.

Spec 03 owns no acceptance-gate rows (per `spec-plan.md`). It changes exactly three
files, bumps no manifest version (spec 08 owns the version bump), and adds no dependency.
Correctness is verified through `.kiro/scripts/check.sh` (quick and full).

## Glossary

- **CRM_Manifest_Controller**: The controller class `WebManifest` defined in
  `addons/crm/controllers/webmanifest.py`, subclassing
  `odoo.addons.web.controllers.webmanifest.WebManifest`.
- **Parent_Manifest_Controller**: The base class
  `odoo.addons.web.controllers.webmanifest.WebManifest` in `addons/web`.
- **Shortcuts_Method**: The method `_get_shortcuts()` on CRM_Manifest_Controller that
  overrides the parent method of the same name.
- **Parent_Shortcuts**: The list returned by
  `super()._get_shortcuts()` when invoked from Shortcuts_Method.
- **CRM_Shortcut**: A single shortcut dictionary appended by Shortcuts_Method, one of
  Pipeline_Shortcut or New_Lead_Shortcut.
- **Pipeline_Shortcut**: The CRM_Shortcut whose `name` is the translatable string
  "My Pipeline".
- **New_Lead_Shortcut**: The CRM_Shortcut whose `name` is the translatable string
  "New Lead".
- **Shortcut_Keys**: The exact set of dictionary keys the Parent_Manifest_Controller uses
  for each shortcut: `name`, `url`, `description`, `icons`, where `icons` is a list of
  dictionaries each carrying `sizes`, `src`, `type`.
- **Pipeline_Menu_Xmlid**: The external identifier `crm.menu_crm_opportunities`, declared
  in `addons/crm/views/crm_menu_views.xml`.
- **Pipeline_Menu_Resolver**: The lookup via `request.env['ir.model.data'].sudo()` that
  resolves Pipeline_Menu_Xmlid to its `res_id`, matching the sudo usage the parent already
  performs for its menu lookup.
- **CRM_Icon_Path**: The `crm` module's standard icon path
  `/crm/static/description/icon.png`, hardcoded in the override (not read from the
  `ir.module.module` `icon` field), with its MIME type derived from
  `mimetypes.guess_type`. The hardcoded value equals the record's default because the
  `crm` manifest declares no `icon` key; see the design's icon-source decision.
- **Share_Target_Flag**: The boolean returned by `_has_share_target()`, which
  CRM_Manifest_Controller already overrides to `True`.
- **Manifest_Route**: The HTTP route `/web/manifest.webmanifest` served by
  Parent_Manifest_Controller.
- **Service_Worker_Route**: The HTTP route `/web/service-worker.js` served by
  Parent_Manifest_Controller.
- **Offline_Page_Route**: The HTTP route `/odoo/offline` served by
  Parent_Manifest_Controller.
- **Test_Module**: The new Python test file `addons/crm/tests/test_crm_offline.py`.
- **Test_Class**: The test class `TestCrmOffline` defined in Test_Module.
- **Tests_Init**: The package initializer `addons/crm/tests/__init__.py`.
- **Salesman_User**: A `res.users` record whose groups are `base.group_user` and
  `sales_team.group_sale_salesman`, holding no administration rights.
- **Mock_Request**: The context manager
  `odoo.addons.http_routing.tests.common.MockRequest`, used to invoke controller methods
  with a request environment in tests.
- **Allowed_Files**: The three files spec 03 may change —
  `addons/crm/controllers/webmanifest.py` (modify), `addons/crm/tests/test_crm_offline.py`
  (new), and `addons/crm/tests/__init__.py` (import line only).
- **Check_Script**: The verification entry point `.kiro/scripts/check.sh`.

## Requirements

### Requirement 1: CRM manifest shortcuts override appends two deep links

**User Story:** As a field salesperson installing the CRM PWA, I want "My Pipeline" and
"New Lead" shortcuts on the installed app, so that I can jump straight to my pipeline or a
new lead from the home-screen icon.

#### Acceptance Criteria

1. THE Shortcuts_Method SHALL invoke `super()._get_shortcuts()` and return a list that
   begins with Parent_Shortcuts in the parent's original order.
2. THE Shortcuts_Method SHALL append exactly two CRM_Shortcut entries after
   Parent_Shortcuts, with Pipeline_Shortcut first and New_Lead_Shortcut second.
3. THE Shortcuts_Method SHALL preserve every entry of Parent_Shortcuts unchanged, adding
   no entry that duplicates or replaces a Parent_Shortcuts entry.
4. THE Shortcuts_Method SHALL set each CRM_Shortcut dictionary to carry exactly
   Shortcut_Keys, with no key added and no key omitted relative to the parent's shortcut
   shape.
5. THE Shortcuts_Method SHALL set the `icons` list of each CRM_Shortcut to a single
   dictionary whose `src` is CRM_Icon_Path, whose `type` is
   `mimetypes.guess_type(CRM_Icon_Path)[0]` (falling back to `image/png` as the parent
   does), and whose `sizes` equals the parent's literal `100x100`.

### Requirement 2: Pipeline shortcut targets the pipeline menu

**User Story:** As a field salesperson, I want the "My Pipeline" shortcut to open my
pipeline menu, so that I land on the stages I work in.

#### Acceptance Criteria

1. THE Pipeline_Shortcut SHALL set `name` to the translatable string "My Pipeline".
2. THE Pipeline_Shortcut SHALL set `url` to the value
   `"/odoo?menu_id=<res_id>"`, where `<res_id>` is the `res_id` resolved by
   Pipeline_Menu_Resolver for Pipeline_Menu_Xmlid.
3. THE Pipeline_Shortcut SHALL set `description` to a short translatable string that
   describes the pipeline shortcut.
4. THE Pipeline_Menu_Resolver SHALL resolve Pipeline_Menu_Xmlid through
   `request.env['ir.model.data'].sudo()`, matching the sudo scope the parent uses for its
   menu lookup.

### Requirement 3: New Lead shortcut targets the lead-creation path

**User Story:** As a field salesperson, I want the "New Lead" shortcut to open a fresh
lead form, so that I can capture a lead in one tap.

#### Acceptance Criteria

1. THE New_Lead_Shortcut SHALL set `name` to the translatable string "New Lead".
2. THE New_Lead_Shortcut SHALL set `url` to the literal value `"/odoo/crm/new"`.
3. THE New_Lead_Shortcut SHALL set `description` to a short translatable string that is
   distinct from the Pipeline_Shortcut description.

### Requirement 4: Translatable shortcut names

**User Story:** As a user of a localized Odoo installation, I want the CRM shortcut names
to be translatable, so that the installed app matches my language.

#### Acceptance Criteria

1. THE Shortcuts_Method SHALL wrap the "My Pipeline" and "New Lead" names in the
   translation function `_` imported from `odoo`, matching how the parent exposes
   translatable text such as `module.display_name`.
2. THE Shortcuts_Method SHALL wrap each CRM_Shortcut `description` in the translation
   function `_`.

### Requirement 5: Minimal privilege, no extra sudo

**User Story:** As a plain sales user, I want the CRM shortcuts to appear without
administration rights, so that every salesperson sees them on their installed app.

#### Acceptance Criteria

1. THE Shortcuts_Method SHALL use `sudo()` only for the Pipeline_Menu_Resolver lookup on
   `ir.model.data`, matching the single sudo scope the parent uses, and SHALL use no
   additional sudo elevation.
2. WHEN Salesman_User requests the manifest, THE CRM_Manifest_Controller SHALL return both
   Pipeline_Shortcut and New_Lead_Shortcut without requiring administration rights.

### Requirement 6: Preserved framework PWA behavior

**User Story:** As a maintainer, I want CRM to extend only the shortcut list, so that the
shared service worker, manifest route, offline page, and PWA styling stay owned by the web
addon.

#### Acceptance Criteria

1. THE CRM_Manifest_Controller SHALL leave Service_Worker_Route, Manifest_Route, and
   Offline_Page_Route served by Parent_Manifest_Controller without overriding any of them.
2. THE CRM_Manifest_Controller SHALL leave the manifest `background_color` and
   `theme_color` as the parent produces them.
3. THE CRM_Manifest_Controller SHALL keep Share_Target_Flag returning `True` so the
   manifest continues to advertise the share target.

### Requirement 7: Python test scaffold module and import

**User Story:** As a spec author for specs 04–08, I want a single shared CRM offline test
module registered with the test runner, so that later specs append their Python tests to
one known file.

#### Acceptance Criteria

1. THE Test_Module SHALL define Test_Class with the exact name `TestCrmOffline`.
2. THE Test_Class SHALL carry the decorator `@tagged('post_install', '-at_install')` and
   SHALL follow the `test_crm_ui.py` convention of combining `HttpCase` with
   `TestCrmCommon`.
3. THE Tests_Init SHALL import Test_Module through exactly one appended
   `from . import test_crm_offline` line, leaving the existing import lines unchanged.

### Requirement 8: Parent-shortcut preservation is proven dynamically

**User Story:** As a reviewer, I want the test to prove the override keeps the parent's
shortcuts, so that a future parent change cannot silently drop shortcuts.

#### Acceptance Criteria

1. THE Test_Class SHALL capture Parent_Shortcuts by invoking
   `super()._get_shortcuts()` behavior dynamically at test time rather than comparing
   against a hardcoded list.
2. THE Test_Class SHALL assert that the list returned by Shortcuts_Method begins with the
   dynamically captured Parent_Shortcuts in order.
3. THE Test_Class SHALL assert that Shortcuts_Method returns exactly two more entries than
   the dynamically captured Parent_Shortcuts.

### Requirement 9: New shortcuts match the parent shape and target paths

**User Story:** As a reviewer, I want the test to verify both new shortcuts' shape and
URLs, so that the deep links stay correct.

#### Acceptance Criteria

1. THE Test_Class SHALL assert that Pipeline_Shortcut and New_Lead_Shortcut each carry
   exactly Shortcut_Keys with the same key structure as a Parent_Shortcuts entry.
2. THE Test_Class SHALL assert that New_Lead_Shortcut `url` equals `"/odoo/crm/new"`.
3. THE Test_Class SHALL assert that Pipeline_Shortcut `url` equals
   `"/odoo?menu_id=<id>"`, where `<id>` is the `res_id` of Pipeline_Menu_Xmlid resolved at
   test time through `ir.model.data`.
4. THE Test_Class SHALL assert that the CRM_Icon_Path referenced by each CRM_Shortcut
   `icons` entry is openable through `odoo.tools.file_open`.
5. THE Test_Class SHALL assert that the manifest produced by CRM_Manifest_Controller keeps
   the share target enabled.

### Requirement 10: HTTP wiring test with a fresh salesman user

**User Story:** As a reviewer, I want an end-to-end check that a plain salesman gets both
CRM shortcuts over HTTP, so that privilege and route wiring are proven together.

#### Acceptance Criteria

1. THE Test_Class SHALL include one `HttpCase` test that creates a fresh Salesman_User,
   authenticates as that user, and fetches Manifest_Route
   (`/web/manifest.webmanifest`).
2. THE Test_Class SHALL assert that the served manifest JSON contains both
   Pipeline_Shortcut and New_Lead_Shortcut.
3. WHERE a test invokes CRM_Manifest_Controller methods directly rather than over HTTP,
   THE Test_Class SHALL invoke those methods inside Mock_Request.

### Requirement 11: Scope and verification constraints

**User Story:** As a maintainer enforcing the spec plan, I want spec 03 to stay within its
file and dependency boundaries, so that it does not take on work owned by other specs.

#### Acceptance Criteria

1. THE spec 03 implementation SHALL change only the Allowed_Files.
2. THE spec 03 implementation SHALL leave the `crm` manifest version unchanged, deferring
   the version bump to spec 08.
3. THE spec 03 implementation SHALL add no Python or JavaScript dependency and SHALL leave
   `requirements.txt` and the addon `depends` list unchanged.
4. THE spec 03 implementation SHALL be verified by running Check_Script in both `quick`
   and `full` modes, with all scope checks and all five test commands passing. The
   acceptance row 5 check in `full` mode (crm manifest version bumped one minor increment)
   is an EXPECTED failure for spec 03, because the version bump is deferred to spec 08; it
   is not a regression and does not block this spec.
