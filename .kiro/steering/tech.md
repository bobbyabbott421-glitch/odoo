---
inclusion: always
---
# Tech

## Stack

- **Backend:** Python, the Odoo 20.0 ORM and addon framework. Models, controllers,
  and views live in `addons/<addon>/`.
- **Frontend:** OWL components in ES modules under `addons/<addon>/static/src`,
  imported through the `@web/...` and `@odoo/owl` aliases. Templates are XML
  (`t-` directives); styles are SCSS. Assets are bundled by Odoo itself.

## OWL plugin API (use this, not the legacy bridges)

New frontend code uses the plugin API:

- A plugin is a class `extends Plugin`; consume one with `usePlugin(SomePlugin)`.
- Reactive state is a `signal(...)`; read it by **calling** it, e.g.
  `offline.isOffline()`, `ui.isSmall()`. Derive with `computed(() => ...)`.
- Several framework capabilities still expose a legacy `useService("...")` bridge
  (offline, ui, bottom_sheet). Those bridges are marked for removal — prefer the
  plugin directly in new code.

## Cross-addon changes

Behavior in another addon is changed by extending it from within `crm`:

- Python: `_inherit` on a model, or subclass a controller.
- JS: `patch(...)` an existing component or object.
- XML: view or template inheritance (`xpath`, `position`).

## Conventions

- One component per directory: `foo/foo.js`, `foo/foo.xml`, `foo/foo.scss`.
- Python model/controller files are imported in their package `__init__.py`; XML
  data files are listed in the manifest `data` block in dependency order.
- Frontend assets are picked up by the manifest's existing `assets` globs under
  `web.assets_backend`, `web.assets_unit_tests`, and `web.assets_tests`.

## Spec lifecycle discipline

- Create and check out the numbered feature branch from its declared parent before any
  task writes files.
- Treat requirements, design, tasks, and implementation as one synchronized contract.
  When source inspection or review changes a classification, path, line number, count,
  or expected behavior, update every affected spec document before marking the work done.
  A completed task list must not preserve assumptions contradicted by the final artifact.
- Spec files under `.kiro/specs/` are ignored by Odoo's gitignore. Re-stage every spec
  artifact with `git add -f` after task execution and again immediately before committing.
- Before committing, inspect both tracked and untracked changes against the feature's parent.
  Do not rely on `git diff` alone to find new files; pair it with `git status --short`.
- Before opening a PR, review the final artifact from scratch against the parent branch and
  the current spec. Re-run counts and source-line checks rather than relying on task reports.
- PR descriptions must distinguish expected staged-program failures from regressions. For
  example, an acceptance check intentionally deferred to a later numbered spec is reported
  as an explicit deviation, not presented as a passing check.

## Rules live elsewhere

- Hard limits (no version/dependency/build-tooling changes, the addons/crm write
  boundary, the frozen depends list) are in `constraints.md`.
- Running checks, the port-5434 cluster, and the secure-context requirement are in
  `testing.md`.
