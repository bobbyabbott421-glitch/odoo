---
inclusion: always
---
# Structure

## Repository

A single Odoo 20.0 tree. Business features are addons under `addons/`. For this effort,
`addons/web/` and `addons/mail/` are consumed; see `constraints.md` for the write
boundary and the fixed list of files this effort may create.

## addons/crm layout

```
addons/crm/
  __manifest__.py          # version, depends, data, asset bundles
  __init__.py
  controllers/             # webmanifest.py (PWA manifest, subclasses web)
  models/                  # crm_lead.py, crm_stage.py, crm_team.py,
                           #   mail_activity.py (_inherit of mail.activity)
  views/                   # XML arch + templates (crm_lead_views.xml, ...)
  wizard/                  # transient models (mark lost, mass convert, merge, pls update)
  security/                # access rules
  static/src/              # OWL components, JS, SCSS
    views/                 # crm_form/, crm kanban, etc.
    webclient/
    core/
  static/tests/            # Hoot unit tests (*.test.js), tours/, mock_server/
  tests/                   # Python tests; __init__.py imports each module explicitly
```

## Where new work goes

Mobile and offline source lives under a new `static/src/mobile/` tree, one directory
per component, matching the addon's existing convention. The exact set of new files
and directories allowed is fixed by `constraints.md`.

## Consumed from other addons (read-only)

- `addons/web/static/src/core/offline/` — offline plugin and sync queue.
- `addons/web/static/src/webclient/offline_systray/` — queued-change / error UI.
- `addons/web/static/src/core/ui/ui_plugin.js` — the small-screen signal.
- `addons/web/static/src/core/bottom_sheet/` — bottom-sheet overlay.
- `addons/web/static/src/views/offline_action_helper.js` — uncached-view fallback.
- `addons/web/static/src/core/pwa/pwa_service.js` — service worker / PWA.
- `addons/mail/` — `mail.activity`, chatter (`mail.message`), extended via crm-side
  inherit only.

See `offline-framework.md` for how these pieces work and their exact entry points.
