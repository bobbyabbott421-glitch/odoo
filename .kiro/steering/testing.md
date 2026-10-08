---
inclusion: always
---
# Testing

## Preconditions
- PostgreSQL runs as a project-local cluster on port 5434, not the default 5432. When you start Odoo yourself, pass --db_port=5434 (the same options as ODOO_ARGS in check.env).
- Offline features need a secure context: run everything on localhost or over HTTPS. Outside one, the framework disables offline and the queue raises.
- After asset changes, upgrade the module or restart with assets regenerated. A failure caused by stale assets isn't a real result.

## Three lanes, all required
1. Python unit tests in addons/crm/tests/test_crm_offline.py, imported explicitly in addons/crm/tests/__init__.py (test modules aren't auto-discovered).
2. JavaScript unit tests (Hoot), passing under both the desktop and mobile presets. New mobile components must be tested in the mobile preset.
3. Browser tour in addons/crm/static/tests/tours/crm_mobile_offline.js. Launch it from an HttpCase test in test_crm_offline.py (start_tour), with the browser set to a 375x667 touch viewport, so commands 1 and 2 run it in mobile mode. Confirm how existing tests in this repo set the viewport before writing it.

Never delete, skip, retag, or weaken an existing test, and don't modify existing test files: put new tests only in the new test files on the allowed list. The only existing test file you may edit is addons/crm/tests/__init__.py, to import test_crm_offline. Never use only() or debug() in a .test.js file.

Coverage: every new mobile JS file needs at least 80% statement coverage, and every new code path needs a new test that exercises it. There's no coverage tool in this repo, so the reviewer checks this by reading the tests against the source.

## How to run checks
Always use .kiro/scripts/check.sh. Don't retype the commands. It reads BASE_SHA (the base commit, ee8c13e on 20.0), ODOO_DB (the test database), VENV (the Python virtualenv), and the PostgreSQL cluster settings (PGDATA, PGPORT, PG_BIN, ODOO_ARGS) from .kiro/scripts/check.env. It starts the project's PostgreSQL cluster on port 5434 if it isn't running, and runs from the repo root wherever it is called from.
- check.sh scope: files outside addons/crm/, requirements.txt and security/ changes, new offline machinery, only()/debug() in tests, modified existing test files. Fast; run it often.
- check.sh quick: scope, plus the new offline Python test class and the desktop JS unit tests.
- check.sh full: scope, the inventory and manifest-version checks, and all five test commands. Run before every PR and for final results.
Report the script's output verbatim. If it fails for an environment reason (a path, the database), say so rather than working around it.