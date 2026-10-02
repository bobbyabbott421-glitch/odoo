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

## Rules live elsewhere

- Hard limits (no version/dependency/build-tooling changes, the addons/crm write
  boundary, the frozen depends list) are in `constraints.md`.
- Running checks, the port-5434 cluster, and the secure-context requirement are in
  `testing.md`.
