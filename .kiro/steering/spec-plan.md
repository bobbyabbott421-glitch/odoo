---
inclusion: always
---
# Spec plan (agreed in Step 4)

The project is split into eight specs, built and merged in the order below. Each spec has
its own branch, cut from `kiro/00-setup` after the previous specs are merged into it.

## Rules

- Work only on the spec named in the user's seed prompt. If no seed prompt names a spec,
  ask which spec to start; do not pick one, and do not write a spec or code.
- "Spec N" always means the numbered spec in the table below, never PART N of
  `/crm-offline-brief`. The PART numbers and spec numbers differ.
- Do not write code until the user has approved the spec files (requirements, design,
  tasks).
- Stay inside the spec's scope. Work that belongs to another spec (for example the manifest
  version bump, which belongs to spec 08) must not be done early.

## The eight specs, in merge order

| # | Spec | Branch | Type | Covers | Owns acceptance rows |
|---|------|--------|------|--------|----------------------|
| 01 | Offline surface inventory | `kiro/01-offline-inventory` | Quick Spec | PART 1 (document only, no code) | 1 |
| 02 | Shared offline hooks | `kiro/02-offline-hooks` | Quick Spec | PART 4 item 4: `crm_offline_hooks.js`; creates `crm_offline.test.js` | none |
| 03 | CRM PWA packaging + Python test scaffold | `kiro/03-pwa-packaging` | Quick Spec | PART 5; creates `test_crm_offline.py` (class `TestCrmOffline`) and its import in `tests/__init__.py` | none |
| 04 | Form-save offline correctness | `kiro/04-form-save-correctness` | Bugfix Spec | PART 2 items 1–2; PART 3a mark-won without rainbowman; queue semantics | 8 |
| 05 | Disabled/skipped controls + chatter | `kiro/05-disabled-controls-chatter` | Bugfix Spec | PART 2 items 3–8 | 7 |
| 06 | Offline data coverage | `kiro/06-data-coverage` | Design-First Feature Spec | PART 3a, 3b, 3c | 9 |
| 07 | Mobile lead card + quick create | `kiro/07-mobile-card-quick-create` | Design-First Feature Spec | PART 4 items 2–3, wired minimally into a rendered parent | none |
| 08 | Mobile pipeline view + wiring + tour + version bump | `kiro/08-mobile-pipeline-tour` | Design-First Feature Spec | PART 4 items 1 and 5; the browser tour; manifest `1.9` → `1.10`; the row 14 coverage check across all new mobile JS files | 5, 6, 10, 12, 14 |

Rows 2, 3, 4, 11 and 13 are enforced on every spec by `check.sh scope` and the Stop hook;
their final proof is the acceptance report after spec 08.

## Status

- Spec 01: merged into `kiro/00-setup`.
- Spec 02: merged into `kiro/00-setup`.
- Spec 03: merged into `kiro/00-setup`.
- Specs 04–08: not started.
