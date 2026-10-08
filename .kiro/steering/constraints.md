---
inclusion: always
---
# CRM offline mode: hard constraints

Goal: an offline-capable, mobile-first CRM experience in the crm addon. A salesperson on a phone with no connection can open the pipeline, read and edit leads they visited online, create leads, log and complete activities, and look up contacts. Every offline write is queued and replayed automatically when the connection returns.

## Never
- Build new offline machinery. The web addon already has a complete offline and PWA framework, active for CRM list, kanban, and form views. Consume it. No new sync queue, IndexedDB wrapper, service worker, cache layer, encryption helper, connectivity detector, offline state store, or conflict resolver. Read the existing offline plugin and PWA service in full before planning.
- Modify any file outside addons/crm/. To change behavior in another addon, extend it from inside crm with Python _inherit, controller subclassing, JS patch(), or XML view/template inheritance. (.kiro/ holds Kiro's own files and is exempt.)
- Change the sync queue's conflict semantics: timestamp-ordered replay, last write wins against the server, failed calls parked in the existing offline systray for manual retry. No conflict detection, write_date comparison, field-level merge, or conflict dialog.
- Add any dependency: no Python or JavaScript package, no new addon in the manifest's depends. requirements.txt stays unchanged.
- Add npm, a bundler, or any JavaScript build tooling to the project.
- Use only() or debug() in any .test.js file.
- Create a native app project (React Native, Flutter, Swift, Kotlin, Gradle, Xcode, Capacitor). "Native mobile" means the installable, offline-capable PWA the fork already supports.
- Add or change any access rule, record rule, or group.
- Change desktop behavior. Gate every new mobile behavior on the framework's existing small-screen signal.
- Refactor, optimize, or modify existing code unless the feature requires it.

## The only two values that change
- The crm manifest version is bumped by one minor increment.
- New OWL code uses the plugin API (Plugin, usePlugin, signal), not the legacy offline service bridge, which is marked for removal.
Language and framework versions, asset bundling, the test framework, and the addon's depends list stay unchanged.

## Out of scope
Must degrade or be unreachable offline:
- Chatter (mail.message): read-only offline, with no uncaught error.
- calendar.event: scheduling a meeting is disabled offline.
- Wizards (mark lost, mass convert to opportunity, merge opportunities, predictive-scoring update): unreachable offline.
- Predictive lead scoring, forecast views, graph and pivot views, activity view: unreachable offline.
- Lead generation and in-app module installation: unreachable offline.
Not built at all: push notifications, background sync, geolocation; any data-model change (no new fields on crm.lead, crm.stage, or crm.team); multi-company or multi-currency changes.

## Allowed new files (create these and no others, and no other new directories)
- addons/crm/static/src/mobile/offline_inventory.md
- addons/crm/static/src/mobile/crm_offline_hooks.js
- addons/crm/static/src/mobile/crm_mobile_pipeline/crm_mobile_pipeline.js, .xml, .scss
- addons/crm/static/src/mobile/crm_mobile_lead_card/crm_mobile_lead_card.js, .xml, .scss
- addons/crm/static/src/mobile/crm_mobile_quick_create/crm_mobile_quick_create.js, .xml, .scss
- addons/crm/tests/test_crm_offline.py
- addons/crm/static/tests/crm_offline.test.js
- addons/crm/static/tests/crm_mobile_pipeline.test.js
- addons/crm/static/tests/tours/crm_mobile_offline.js
One directory per component, matching the addon's existing convention. All other changes modify files already under addons/crm/.

## Rules the offline framework imposes
- A control stays usable offline only if its interactive element carries the framework's offline-availability attribute; otherwise the framework disables it at runtime.
- The queue replays model, method, args, and kwargs verbatim, with no id remapping between calls. Anything needing a server onchange, a transient wizard, or an id produced by another queued call must be disabled offline, never queued.
- The lead's partner field must not allow creating a contact offline.
- Offline contact search uses the framework's existing relational-field cache; don't add a second one.