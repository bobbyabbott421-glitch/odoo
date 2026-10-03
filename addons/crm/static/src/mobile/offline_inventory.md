# CRM Offline Inventory

## Purpose

This document is a **planning inventory** of offline-relevant server entry points
reachable from the CRM frontend and view layer. It enumerates each entry point,
records where it lives (file + line), and classifies it as QUEUE, SKIP, or DISABLE
for an offline-capable, mobile-first CRM.

- It performs **no code changes** and fixes **no defects**. It is a static planning
  artifact only.
- The sweep boundary is **`addons/crm/` only**. Files under `addons/web/` and
  `addons/mail/` are out of boundary: they are never edited or itemized line-by-line,
  and are referenced only where the hybrid out-of-scope-view rule and the boundary
  note require a pointer back into `crm`.

## Classification legend

Each swept entry point is assigned **exactly one** of three labels:

- **QUEUE** — a *client-resolvable* write on `crm.lead`, `crm.stage`, or `crm.team`,
  or a `mail.activity` on a lead. Queued and shown optimistically offline; replayed
  automatically when the connection returns.
- **SKIP** — a decorative or advisory read (tooltip, visual effect, promo hint,
  display-only group probe). Skipped silently offline: no queued call, no error, no
  notification.
- **DISABLE** — everything else: transient-model wizards, module install, paid
  external lookups, server-computed reports, access probes gating destructive UI, and
  navigation to an offline-unavailable action. The control is disabled offline and is
  unreachable by click, keyboard, hotkey, or programmatic call.

### Ordered rule

Apply the labels in order: **QUEUE first, then SKIP, then DISABLE.** The first rule
that matches wins; an entry point that is neither a QUEUE write nor an advisory read
falls through to DISABLE.

### Client-resolvable gate

The gate runs inside the QUEUE step. A QUEUE candidate whose argument list carries a
**server onchange**, a **transient wizard**, or an **id produced by another queued
call** is **not** client-resolvable, and is downgraded from QUEUE to **DISABLE**. The
queue replays `model`, `method`, `args`, and `kwargs` verbatim with no id remapping,
so anything that needs a server round-trip to resolve its arguments cannot be queued.

## Inventory table(s), grouped by surface

### Lead form — save & stage change

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/views/crm_form/crm_form.js | 51 | checkRainbowmanMessage(orm, effect, resId) on save when stage changed | SKIP | PART 2 item 1: advisory rainbowman congratulation; skipped silently offline, never queued; save still completes. |
| addons/crm/static/src/views/check_rainbowman_message.js | 2 | orm.call("crm.lead","get_rainbowman_message",[[recordId]]) | SKIP | PART 2 item 1: advisory message read; skipped offline, not queued. |
| addons/crm/static/src/views/crm_form/crm_form.js | 38-42 | force-copy email_from/phone into _changes before super._save | QUEUE | PART 2 item 2: client-resolvable; the copied email_from/phone ride in the queued lead write so offline partner propagation matches the online path. |

*Note: the lead write itself is queued by the framework and is not itemized as its own row here.*

### Pipeline kanban — stage drag

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/views/crm_kanban/crm_kanban_model.js | 29 | checkRainbowmanMessage(orm, effect, movedLeads[0].resId) after drag-move | SKIP | PART 2 item 1: advisory rainbowman after kanban stage move; skipped offline, not queued. |

### Mark-won (lead form button + method)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/views/crm_lead_views.xml | 10 | button name="action_set_won_rainbowman" type="object" (Won) | QUEUE | Offline mark-won queues action_set_won (crm_lead.py:1057) to optimistically show the lead won; it must NOT queue action_set_won_rainbowman, because replaying that would run the rainbowman lookup PART 3a forbids. |

*Note: action_set_won:1057 = QUEUE (the offline path); action_set_won_rainbowman:1089 = DISABLE (queuing it would replay the forbidden rainbowman lookup). Both py methods are itemized once, in the Lead methods surface below, to avoid double-counting.*

### Lead methods (crm.lead, button-reachable)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/models/crm_lead.py | 1042 | action_restore() | DISABLE | Reactivates and sets probability=automated_probability (server-computed); not client-resolvable. |
| addons/crm/models/crm_lead.py | 1057 | action_set_won() writes stage_id + probability=100 | QUEUE | Client-resolvable won stage move; this is the call queued offline for mark-won. |
| addons/crm/models/crm_lead.py | 1083 | action_set_automated_probability() | DISABLE | Writes probability from the server recompute _compute_probabilities; not client-resolvable. |
| addons/crm/models/crm_lead.py | 1089 | action_set_won_rainbowman() bundles action_set_won + _get_rainbowman_message | DISABLE | Queuing this method would run the rainbowman lookup on replay, which PART 3a forbids; it is NOT the offline mark-won path (that is action_set_won:1057). |
| addons/crm/models/crm_lead.py | 1197 | action_schedule_meeting() | DISABLE | Opens calendar.event; meeting scheduling is out of scope offline. |
| addons/crm/models/crm_lead.py | 1307 | action_show_potential_duplicates() | DISABLE | Opens a server action/navigation; unavailable offline. |
| addons/crm/models/crm_lead.py | 1320 | action_convert_to_opportunity() | DISABLE | Server-side partner create/find + onchange; not client-resolvable. |

*Note: action_set_lost (crm_lead.py:1051) and action_unarchive (crm_lead.py:1031) are NOT button-reachable — action_set_lost is invoked only via the lost-reason wizard (and demo-data `<function>` calls), and action_unarchive is called internally by action_set_won/action_restore — so neither is itemized as a Category-3 button-reachable row (mirrors the existing crm.stage "no button-reachable method" note).*

### Lead form — other header/stat/inline buttons

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/views/crm_lead_views.xml | 12 | button action_convert_to_opportunity type="object" | DISABLE | Convert needs server-side partner create/find + onchange; not client-resolvable. |
| addons/crm/views/crm_lead_views.xml | 14 | button action_restore type="object" | DISABLE | Sets probability=automated_probability (server-computed); gate fails. |
| addons/crm/views/crm_lead_views.xml | 16 | button %(crm.crm_lead_lost_action)d type="action" (Lost) | DISABLE | Opens the mark-lost transient wizard; unreachable offline. |
| addons/crm/views/crm_lead_views.xml | 33 | button action_schedule_meeting type="object" | DISABLE | Opens calendar.event; meeting scheduling is out of scope offline. |
| addons/crm/views/crm_lead_views.xml | 42 | button action_show_potential_duplicates type="object" | DISABLE | Server action/navigation; unavailable offline. |
| addons/crm/views/crm_lead_views.xml | 90 | a name="action_set_automated_probability" type="object" | DISABLE | Value from server recompute _compute_probabilities; not client-resolvable. |
| addons/crm/views/crm_lead_views.xml | 140 | a name="action_set_automated_probability" type="object" (alt layout) | DISABLE | Same server recompute; not client-resolvable. |
| addons/crm/views/crm_lead_views.xml | 213 | button mail_action_blacklist_remove type="object" | DISABLE | Needs server context/onchange (blacklist); not client-resolvable. |
| addons/crm/views/crm_lead_views.xml | 226 | button phone_action_blacklist_remove type="object" | DISABLE | Needs server context/onchange (blacklist); not client-resolvable. |

### Lead list / opportunities list — header & row buttons

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/views/crm_lead_views.xml | 323 | button %(action_crm_send_mass_convert)d type="action" | DISABLE | Mass-convert transient wizard; unreachable offline. |
| addons/crm/views/crm_lead_views.xml | 324 | button %(crm.crm_lead_lost_action)d type="action" | DISABLE | Mark-lost wizard; unreachable offline. |
| addons/crm/views/crm_lead_views.xml | 710 | button %(crm.crm_lead_lost_action)d type="action" | DISABLE | Mark-lost wizard; unreachable offline. |
| addons/crm/views/crm_lead_views.xml | 711 | button %(crm.action_lead_mass_mail)d type="action" | DISABLE | Opens mass-mail composer action; unavailable offline. |
| addons/crm/views/crm_lead_views.xml | 760 | button %(crm.action_lead_mail_compose)d type="action" | DISABLE | Opens mail composer action; unavailable offline. |

### Predictive-scoring tooltip (lead form widget)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/views/crm_form/crm_pls_tooltip_button.js | 45 | await this.props.record.save() | DISABLE | PART 2 item 6: saves pending changes to the server before the recompute; needs a server round-trip. |
| addons/crm/static/src/views/crm_form/crm_pls_tooltip_button.js | 51 | orm.call("crm.lead","prepare_pls_tooltip_data",[resId]) | DISABLE | PART 2 item 6: recomputes probability server-side (comment at :50), a server write — not advisory; unavailable offline. |
| addons/crm/static/src/views/crm_form/crm_pls_tooltip_button.js | 57 | await this.props.record.load() | DISABLE | PART 2 item 6: reloads the record from the server after the recompute; needs a server round-trip. |
| addons/crm/views/crm_lead_views.xml | 99 | &lt;widget name="pls_tooltip_button"&gt; (AI-switch block) | DISABLE | PART 2 item 6: the tooltip button control; its interactive element must be disabled offline (widget registered at crm_pls_tooltip_button.js:78). |
| addons/crm/views/crm_lead_views.xml | 131 | &lt;widget name="pls_tooltip_button"&gt; (alt layout block) | DISABLE | PART 2 item 6: the tooltip button control; its interactive element must be disabled offline (widget registered at crm_pls_tooltip_button.js:78). |

### Team switcher (control panel)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/components/team_switcher/team_switcher.js | 21 | user.hasGroup("sales_team.group_sale_manager") | SKIP | PART 2 item 3: advisory group probe; treated as false offline. |
| addons/crm/static/src/components/team_switcher/team_switcher.js | 46 | actionService.doAction("sales_team.crm_team_action_config") | DISABLE | PART 2 item 3: manage-teams navigation; unreachable offline. |
| addons/crm/static/src/views/crm_search_model.js | 142 | orm.cache(...).call("crm.team","get_team_switcher_data") | SKIP | PART 2 item 3: cached display read; selected team stays visible as a search facet. |

### Lead-generation dropdown (control panel)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/components/lead_generation_dropdown/lead_generation_dropdown.js | 139 | orm.cache().searchRead("ir.module.module",...) | DISABLE | PART 2 item 4: module-install state probe gating unavailable UI. |
| addons/crm/static/src/components/lead_generation_dropdown/lead_generation_dropdown.js | 165 | user.checkAccessRight(model,"create") | DISABLE | PART 2 item 4: access probe gating unavailable UI. |
| addons/crm/static/src/components/lead_generation_dropdown/lead_generation_dropdown.js | 206 | orm.silent.call("ir.module.module","button_immediate_install",[id]) | DISABLE | PART 2 item 4: module install; unavailable offline. |
| addons/crm/static/src/components/lead_generation_dropdown/lead_generation_dropdown.js | 241 | action.doAction({tag:"import"}) | DISABLE | PART 2 item 4: navigation to import action; unavailable offline. |
| addons/crm/static/src/components/lead_generation_dropdown/lead_generation_dropdown.js | 257 | action.doAction({res_model:"base.module.install.request",...}) | DISABLE | PART 2 item 4: navigation to install/access-request wizard; unavailable offline. |

### Recurring-revenue progress aggregate (kanban column)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/views/crm_kanban/crm_column_progress.js | 14 | user.hasGroup("crm.group_use_recurring_revenues") | SKIP | PART 2 item 5: probe skipped offline; aggregate hidden (not zeroed — a displayed zero reads as data). |

### Activity menu (systray)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/activity_menu_patch.js | 39 | action.loadAction("crm.crm_lead_action_my_activities") | DISABLE | PART 2 item 7: loads the my-activities action definition from the server; unreachable offline. |
| addons/crm/static/src/activity_menu_patch.js | 45 | action.doAction(action, {...}) | DISABLE | PART 2 item 7: navigates to the my-activities action; unreachable offline. |

### Chatter (lead form)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/views/crm_lead_views.xml | 300 | &lt;chatter reload_on_post="True"/&gt; | DISABLE | PART 2 item 8: read-only offline, must not raise; not a QUEUE write and not a lead mail.activity; wired via XML/mail inheritance (body in mail). |

### Share target (webclient)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/webclient/share_target/crm_share_target_item.js | 19 | orm.webSearchRead("crm.team",...) | DISABLE | Needs a server round-trip to list teams for the OS share-target selector; not client-resolvable, not merely decorative. |

### Team views & dashboard (crm.team buttons + manage-teams nav)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/models/crm_team.py | 211 | action_assign_leads() | DISABLE | Server-side lead-assignment engine; unavailable offline. |
| addons/crm/models/crm_team.py | 762 | action_open_opportunities() | DISABLE | Navigation to an action; unavailable offline. |
| addons/crm/models/crm_team.py | 770 | action_open_unassigned_opportunities() | DISABLE | Navigation to an action; unavailable offline. |
| addons/crm/models/crm_team.py | 783 | action_primary_channel_button() | DISABLE | Reached from the sales_team kanban (addons/sales_team/views/crm_team_views.xml:132, type="object"); returns action_open_opportunities() — navigation unavailable offline. |
| addons/crm/views/crm_team_views.xml | 144 | button action_assign_leads type="object" | DISABLE | Server-side assignment; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 207 | button action_open_opportunities type="object" | DISABLE | Navigation; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 276 | a action_open_unassigned_opportunities type="object" | DISABLE | Navigation; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 286 | a %(crm_case_form_view_salesteams_lead)d type="action" | DISABLE | Manage-teams navigation; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 291 | a %(crm_case_form_view_salesteams_opportunity)d type="action" | DISABLE | Manage-teams navigation; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 302 | a %(crm_lead_action_open_lead_form)d type="action" | DISABLE | Manage-teams navigation; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 307 | a %(action_opportunity_form)d type="action" | DISABLE | Manage-teams navigation; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 318 | a %(action_report_crm_lead_salesteam)d type="action" | DISABLE | Server-computed report navigation; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 323 | a %(action_report_crm_opportunity_salesteam)d type="action" | DISABLE | Server-computed report navigation; unavailable offline. |
| addons/crm/views/crm_team_views.xml | 331 | a %(crm.crm_activity_report_action_team)d type="action" | DISABLE | Server-computed activity report navigation; unavailable offline. |

### Settings (res.config.settings)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/views/res_config_settings_views.xml | 16 | button crm.crm_recurring_plan_action type="action" | DISABLE | Settings navigation; unavailable offline. |
| addons/crm/views/res_config_settings_views.xml | 47 | button %(crm_lead_pls_update_action)d type="action" | DISABLE | PLS/predictive-scoring update wizard; unreachable offline. |
| addons/crm/views/res_config_settings_views.xml | 64 | button action_crm_assign_leads type="object" | DISABLE | Server-side assignment refresh; unavailable offline. |

### Related-record navigation (partner / lost reason / campaign)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/views/res_partner_views.xml | 12 | button action_view_opportunity type="object" | DISABLE | Navigation to partner opportunities; unavailable offline. |
| addons/crm/views/crm_lost_reason_views.xml | 22 | button action_lost_leads type="object" | DISABLE | Navigation to lost leads; unavailable offline. |
| addons/crm/views/utm_campaign_views.xml | 19 | a action_redirect_to_leads_opportunities type="object" | DISABLE | Navigation; unavailable offline. |
| addons/crm/views/utm_campaign_views.xml | 37 | button action_redirect_to_leads_opportunities type="object" | DISABLE | Navigation; unavailable offline. |

### Wizards (transient-model apply buttons)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/wizard/crm_lead_to_opportunity_mass_views.xml | 55 | button action_apply type="object" (mass convert) | DISABLE | Transient wizard apply; unreachable offline. |
| addons/crm/wizard/crm_merge_opportunities_views.xml | 34 | button action_merge type="object" | DISABLE | Transient wizard + id-dependent server merge; unreachable offline. |
| addons/crm/wizard/crm_lead_lost_views.xml | 15 | button action_lost_reason_apply type="object" | DISABLE | Transient wizard apply; unreachable offline. |
| addons/crm/wizard/crm_lead_pls_update_views.xml | 18 | button action_update_crm_lead_probabilities type="object" | DISABLE | Transient wizard (PLS recompute); unreachable offline. |

### Activity report (list action)

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/report/crm_activity_report_views.xml | 31 | list action="action_open_lead" type="object" | DISABLE | Opens a lead from a server-computed activity report view; unavailable offline. |

### Out-of-scope analytic/other views (hybrid rule)

Register-only surfaces — one DISABLE arch-record row each:

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/views/crm_lead_views.xml | 833 | &lt;record crm_lead_view_graph&gt; arch js_class="crm_graph" | DISABLE | js_class crm_graph registered at addons/crm/static/src/views/crm_graph/crm_graph_view.js:12; body lives in web (@web graph view); unreachable offline per constraints.md; needs a server round-trip. |
| addons/crm/views/crm_lead_views.xml | 851 | &lt;record crm_lead_view_graph_forecast&gt; arch js_class="forecast_graph" | DISABLE | js_class forecast_graph registered at addons/crm/static/src/views/forecast_graph/forecast_graph_view.js:12; body lives in web (@web graph view); unreachable offline per constraints.md; needs a server round-trip. |
| addons/crm/views/crm_lead_views.xml | 873 | &lt;record crm_lead_view_pivot&gt; arch js_class="crm_pivot" | DISABLE | js_class crm_pivot registered at addons/crm/static/src/views/crm_pivot/crm_pivot_view.js:12; body lives in web (@web pivot view); unreachable offline per constraints.md; needs a server round-trip. |
| addons/crm/views/crm_lead_views.xml | 893 | &lt;record crm_lead_view_pivot_forecast&gt; arch js_class="forecast_pivot" | DISABLE | js_class forecast_pivot registered at addons/crm/static/src/views/forecast_pivot/forecast_pivot_view.js:12; body lives in web (@web pivot view); unreachable offline per constraints.md; needs a server round-trip. |
| addons/crm/views/crm_lead_views.xml | 384 | &lt;record crm_case_calendar_view_leads&gt; arch js_class="crm_calendar" | DISABLE | js_class crm_calendar registered at addons/crm/static/src/views/crm_calendar/crm_calendar_view.js:11; body lives in web (@web calendar view); unreachable offline per constraints.md; needs a server round-trip. |
| addons/crm/views/crm_lead_views.xml | 469 | &lt;record crm_lead_view_activity&gt; arch js_class="crm_activity" | DISABLE | js_class crm_activity registered at addons/crm/static/src/views/crm_activity/crm_activity_view.js:12; body lives in mail (@mail activity view); unreachable offline per constraints.md; needs a server round-trip. |
| addons/crm/views/crm_lead_views.xml | 765 | &lt;record crm_lead_view_tree_forecast&gt; arch js_class="forecast_list" (xpath attr) | DISABLE | js_class forecast_list registered at addons/crm/static/src/views/forecast_list/forecast_list_view.js:12; body lives in web (@web list view); unreachable offline per constraints.md; needs a server round-trip. |
| addons/crm/views/crm_lead_views.xml | 565 | &lt;record crm_lead_view_kanban_forecast&gt; arch js_class="forecast_kanban" (xpath attr) | DISABLE | js_class forecast_kanban registered at addons/crm/static/src/views/forecast_kanban/forecast_kanban_view.js:20; body lives in web (@web kanban view); unreachable offline per constraints.md; needs a server round-trip. |

forecast_kanban crm-owned per-call rows:

| file | line | call | classification | justification |
| --- | --- | --- | --- | --- |
| addons/crm/static/src/views/forecast_kanban/forecast_kanban_model.js | 32 | super._webReadGroup(...arguments) | DISABLE | Inherited server read grouping for the forecast kanban; forecast out of scope offline; needs a server round-trip. |
| addons/crm/static/src/views/forecast_kanban/forecast_kanban_model.js | 36 | super._loadGroupedList(...arguments) | DISABLE | Inherited server read loading the grouped forecast list; forecast out of scope offline; needs a server round-trip. |
| addons/crm/static/src/views/forecast_kanban/forecast_kanban_renderer.js | 48 | await this.props.list.load() | DISABLE | Reloads the forecast grouped list — inherited server read; forecast out of scope offline; needs a server round-trip. |

*Note: `crm.stage` has NO Category-3 button-reachable public method (only a `write` override), so the sweep itemizes no `crm.stage` method row — stated here so the completeness of the sweep is explicit.*

## Counts

Counts are derived by counting the data rows of the surface tables above (the tables
are the source of truth). Every data row carries exactly one classification.

### Per-class counts

| classification | count |
| --- | --- |
| QUEUE | 3 |
| SKIP | 6 |
| DISABLE | 72 |

Per-class total: 3 + 6 + 72 = **81**.

### Per-surface subtotals

| surface | rows |
| --- | --- |
| Lead form — save & stage change | 3 |
| Pipeline kanban — stage drag | 1 |
| Mark-won (lead form button + method) | 1 |
| Lead methods (crm.lead, button-reachable) | 7 |
| Lead form — other header/stat/inline buttons | 9 |
| Lead list / opportunities list — header & row buttons | 5 |
| Predictive-scoring tooltip (lead form widget) | 5 |
| Team switcher (control panel) | 3 |
| Lead-generation dropdown (control panel) | 5 |
| Recurring-revenue progress aggregate (kanban column) | 1 |
| Activity menu (systray) | 2 |
| Chatter (lead form) | 1 |
| Share target (webclient) | 1 |
| Team views & dashboard (crm.team buttons + manage-teams nav) | 14 |
| Settings (res.config.settings) | 3 |
| Related-record navigation (partner / lost reason / campaign) | 4 |
| Wizards (transient-model apply buttons) | 4 |
| Activity report (list action) | 1 |
| Out-of-scope analytic/other views (register-only) | 8 |
| forecast_kanban crm-owned per-call rows | 3 |

Per-surface total: 3 + 1 + 1 + 7 + 9 + 5 + 5 + 3 + 5 + 1 + 2 + 1 + 1 + 14 + 3 + 4 + 4 + 1 + 8 + 3 = **81**.

The two "Out-of-scope analytic/other views (hybrid rule)" sub-groups are reported
separately above: the register-only arch-record rows (8) and the forecast_kanban
crm-owned per-call rows (3), 11 together.

### Closing check

total rows = QUEUE + SKIP + DISABLE

81 = 3 + 6 + 72

## Boundary note

Per `constraints.md`, the sweep boundary is **`addons/crm/` only**. Several surfaces
itemized above reach behavior whose implementation body lives in another addon
(`web` or `mail`). Out-of-addon behavior is always extended from inside `crm` —
by Python `_inherit`, controller subclassing, JS `patch()`, or XML/registry
registration — so the inventory itemizes **only the crm-side entry point** (the mount
point, button, arch record, or registration) and classifies it there. The bodies those
entry points reach were **not** swept and are **not** itemized line-by-line; that is
intentional, not an omission. The out-of-boundary surfaces, and the addon each body
lives in, are:

- **Register-only analytic/other view bodies** — crm only registers these js_classes;
  the inventory represents each by one DISABLE arch-record row (and, for
  `forecast_kanban`, additional per-call rows for the crm-owned model/renderer bodies
  only). The view bodies themselves live outside crm:
  - `crm_graph`, `forecast_graph` → graph view body in **web**
    (`@web/views/graph/graph_view`).
  - `crm_pivot`, `forecast_pivot` → pivot view body in **web**
    (`@web/views/pivot/pivot_view`).
  - `crm_calendar` → calendar view body in **web** (`@web/views/calendar/calendar_view`).
  - `forecast_list` → list view body in **web** (`@web/views/list/list_view`).
  - `forecast_kanban` → kanban view body in **web** (`@web/views/kanban/kanban_view`).
  - `crm_activity` → activity view body in **mail**
    (`@mail/views/web/activity/activity_view`).
- **Chatter** — crm only mounts `<chatter/>` on the lead form
  (`crm_lead_views.xml:300`), recorded as the single DISABLE row for that mount point.
  The chatter widget body and all `mail.message` handling live in **mail**; those
  mail-side internals were not swept.
- **Blacklist-remove methods** — the inventory records only the crm-side buttons that
  invoke them (`crm_lead_views.xml:213`, `:226`), classified DISABLE. The
  `mail_action_blacklist_remove` / `phone_action_blacklist_remove` method bodies are
  defined in the **mail** / **phone** addons, not crm, and were not swept.
- **Mass-mail / mail-composer actions and wizard models** — the crm-side buttons
  (mass-mail, mail compose, mass convert, merge, lost, PLS update) and the crm wizard
  apply-buttons are itemized above. Any logic those actions reach in **mail**, or in
  transient-model base behavior outside crm, was not swept.
- **Lead-view activity widgets** — the lead views' activity widgets (the
  `kanban_activity` / `list_activity` widgets and the `activity_ids` field rendering on
  the lead kanban/list/form in `crm_lead_views.xml`) have their body in **mail**
  (`mail.activity` widgets). This is **why no `mail.activity` QUEUE row appears in this
  inventory**: the crm side only renders the mail-owned activity widgets; offline
  `mail.activity` scheduling/creation is delivered in a later PART (3b), not swept here
  as a crm entry point.
- **Consumed offline/PWA framework** — the offline/sync plugin and sync queue, the PWA
  service worker, the relational-field (many2x) cache, the bottom-sheet overlay, the
  offline action helper, the small-screen signal, and the offline systray all live in
  **web** (`addons/web/static/src/...`). The CRM work consumes these read-only; they are
  framework, not CRM entry points, so they were not swept or itemized here.
