# Offline mode for Odoo CRM

Phase 1 established the baseline at ee8c13eaa57177845e36b2aee2d8717d013310dd and added a browser connection-cut test. Phase 2 delivers the offline read path. Later phases remain in progress.

## Current behavior

A warmed pipeline for a team with 10,000 opportunities reopened in 4,947 ms with Chromium offline and the Odoo process stopped. It displayed 320 cards. A previously visited lead reopened with its title and revenue. A note and a scheduled activity that were visible online did not both reappear offline.

To reproduce the lead result, create a demo opportunity with a note and an activity. Open it online, revisit after the service worker takes control, stop Odoo, put Chromium offline and reopen the same lead. The fixture checked for both entries for 45 seconds.

The design uses the last verified user and access context for offline reads, displays the snapshot time, and revalidates on reconnect. Access revocation while the device is disconnected cannot be detected until connectivity returns.

## Changes

The shared Odoo Chromium test driver gained an offline context for the page target. An Odoo web test runs against a dedicated HTTP listener so it can stop and restart the endpoint without terminating the test runner. The phase contains no product or database-model changes.

## Baseline and measurements

All 31 requested modules were installed with demo data. The crm_base snapshot covers persistent IDs in 434 tables, selected CRM business values and external IDs, including 45 leads. Five warm direct-navigation samples yielded medians of 3,350 ms and 14 actual server requests for the pipeline, and 1,523 ms and 15 requests for the lead form. Other suites shared the host during measurement.

The standard Python suite collected 853, passed 826, failed or errored 24, and skipped 3. Nonstandard Python suites collected 35, passed 15 and failed or errored 20. Browser tours recorded 81 passes and 12 failures across 93 invocations. Desktop HOOT passed 8,098 of 8,105. Mobile HOOT passed 4,058 of 4,059. The livechat embed suite passed all 44. The HOOT framework self-test passed all 198.

The standard commands were `bash baseline.sh python crm_baseline_python -i`, `bash baseline.sh extra crm_baseline_extra -u`, `bash baseline.sh desktop crm_baseline_desktop installed`, `bash baseline.sh mobile crm_baseline_mobile installed` and `bash embed.sh crm_baseline_embed` from the scratch directory. For the Python suites, `bash resume_python.sh` and `bash resume_extra.sh` finished the interrupted cases. A frozen test clock and orphaned Chromium children under this container's PID 1 caused the interruptions. Running under a subreaper resolved browser cleanup without changing test assertions.

The new normal-entry test, `bash target.sh crm_baseline_desktop /web:TestOfflineConnection`, passed once before review and once after the review fixes. A separate probe also verified failed fetches after the Odoo process exited and successful fetches after a new process started.

The task virtual environment gained pip 25.0.1 to install test packages and websocket-client 1.9.2 for Odoo's ChromeBrowser. Application dependencies are unchanged.

## Publication status

Draft PR #13 is open from codex/crm-offline into 20.0 in bobbyabbott421-glitch/odoo.

## Phase 2 — offline reads

The branch now includes be5e5c02fc3 (shared web client) and 94e247d9d8d (CRM and mail). GPT-6 Codex implemented and reviewed this phase. The second commit is the verified head of draft PR #13.

A rep can reopen the previously selected team and visited opportunity with the saved details, notes, history and activities. The form displays separate local times for the last details check and cached chatter. Search uses the existing saved search choices and the pipeline explains that other results require a connection. Previously unseen chatter pages show an unavailable notice. A warmed selection of the Sales team with 10,000 opportunities reopened in 3,726 ms with 320 rendered cards after the Odoo process stopped and Chromium went offline. This is a single run.

Shared web changes bind JSON RPC and menus to the signed-in account, partition caches by database, account and active companies, invalidate caches on confirmed denial and retain the authenticated shell only in memory. Warm navigation and lead-only chatter reads fall back after a five-second stall. Mail can return authorized chatter reads separately in one ordered server transaction so batch boundaries and temporary response IDs can change across visits. CRM rechecks visited leads on reconnect and drops cached reads on confirmed loss of access. No database model changed in this phase.

The draft still requires ordered write replay, cold phone launch and the final comparison. To reproduce the cold-launch limit, close all tabs, let the service worker terminate and open the CRM offline. The public page asks the rep to reconnect. The tested warm launch uses the last verified account and permissions because the device cannot learn of a revocation during a disconnection.

From /workspace/run-notes, the final checks were

| Command | Result |
| --- | --- |
| `bash target.sh crm_phase2 '/crm:TestCrmOfflineRead,/web:WebSuite.test_unit_desktop[@crm/crm_offline,@web/webclient/menu_service,@web/core/network/rpc],/web:MobileWebSuite.test_unit_mobile[@crm/crm_offline,@web/core/network/rpc]'` | All 4 Odoo methods passed. Both real CRM browser tests passed, including deletion during disconnection and sign-out. Desktop HOOT passed 14/14 and mobile HOOT passed 2/2. |
| `TEST_DATABASE=crm_flow LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python lead_offline.py` | 1/1 passed after stopping the Odoo process. |
| `TEST_DATABASE=crm_scale LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python scale_offline_phase2.py` | 1/1 passed with the team selected in the real dropdown. |

## Phase 3 — offline changes

Commits fd17836ae50 and 8b6cc7d7874 are on the draft PR. GPT-6 Codex implemented and reviewed the changes. A rep can create an opportunity, edit saved form fields, change stage on the form, log a plain internal note and schedule a personal to-do. Supported archive, restore and delete requests use the same receipt as other supported writes. The real browser tests exercised creation, editing, notes, personal activities and a deleted lead. Archive, restore and delete did not each receive a dedicated browser test in this phase.

The shared web client persists a change before its first network attempt, encrypts it for the account, serializes delivery across tabs and retains the original operation ID. A CRM receipt stores its owner, operation key, payload digest and record IDs in the same transaction as the normal business operation. This prevents a lost reply from creating a second opportunity or repeating a previous edit. Opening a failed CRM item keeps it in the queue. A rep can retry it or explicitly discard it. The shared IndexedDB helper now supports strict writes independent of registry version, and the HOOT lock mock awaits its callback like the browser API. The web bootstrap provides a separate key for pending work so password or two-factor changes can rotate read-cache keys without destroying edits.

Older unscoped work stays in the pre-upgrade database. Its stored payload lacks a trustworthy database/account binding. The queue displays a recovery notice when the browser can enumerate that database. The rep and administrator must establish the original database, account and intended change from their records before re-entering a confirmed change through CRM. Ambiguous entries stay on the device. If local storage is full, a normal live save can still reach the server. An unsaved offline form stays open with a warning when persistence fails.

Card and stage reordering require a connection because they resequence other records. Rich notes, attachments, outgoing mail and mentions require their online composer. Meetings, quotations, projects, live chat, page views, enrich/assign, conversion, reporting, lost/won wizards and blacklist management require live authorization, related records or server workflows. The CRM panel explains disabled actions. The normal server ORM and installed CRM extensions execute supported changes with the rep's account. Decoration such as the stage celebration is omitted while offline. An unsaved dirty form can prompt for an explicit save when closing the page before a durable save finishes.

Final targeted command from /workspace/run-notes

`bash target.sh crm_phase2 '/crm:TestCrmOfflineRead,/crm:TestOfflineReceipt,/web:WebSuite.test_unit_desktop[@web/core/offline/offline_plugin,@web/webclient/offline_systray,@crm/crm_offline],/web:MobileWebSuite.test_unit_mobile[@web/webclient/offline_systray,@crm/crm_offline]'`

All eight Odoo methods passed. Desktop HOOT passed 22/22 and mobile HOOT passed 8/8. One browser scenario retained a deleted lead's note with its reason while a later note and to-do reached the correct lead. A separate process-level test submitted an internal note after Odoo stopped, restarted Odoo and counted exactly one matching server message. Its command was `TEST_DATABASE=crm_flow LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python write_offline.py`, 1/1 passed.

## Phase 4 — phone launch

Commit b99f8e87589 adds **CRM offline access** to the CRM user menu. The rep enables it online with a device passphrase, and the install link uses Odoo's scoped app manifest with the pipeline as its start URL. After the service worker stops, a correct passphrase can reopen the saved pipeline or a visited lead link. Chromium also reached the unlock page from a stalled TCP connection. A wrong passphrase kept the lead hidden.

The web controller issues a session marker bound to the database, account, permissions, language and registry. Soft session rotation preserves it. Signing out, an expired marker or a verified security-context change requires online verification. The service worker stores a passphrase-encrypted copy of the backend page with a random salt and IV. Unlock requires both the current marker and the passphrase. The public offline page contains no session bootstrap. Browsers without the required secure storage and worker APIs explain that a connection is needed to reopen Odoo. Clearing browser data removes local data, including pending edits.

GPT-6 Codex implemented and reviewed this phase. The review identified routine session rotation, an obsolete saved bootstrap and unbounded waits on enrollment or navigation. The final checks cover a stalled connection to a bookmarked CRM lead as well as a pipeline launch. No database model changed. Desktop and mobile HOOT each passed their one new test. The phone check covered a 390 px mobile viewport, touch controls, the browser accessibility tree, dark mode and right-to-left layout. Physical iOS/Android installation, assistive-technology speech output and translated strings in every language were not verified.

| Command from /workspace/run-notes | Result |
| --- | --- |
| `bash target.sh crm_phase2 '/crm:TestCrmOfflinePhone,/crm:TestOfflineSession,/web:WebSuite.test_unit_desktop[@crm/crm_offline_access],/web:MobileWebSuite.test_unit_mobile[@crm/crm_offline_access]'` | 4/4 Odoo methods passed. Desktop and mobile each passed 1/1 HOOT test. |
| `bash target.sh crm_phase2 /crm:TestCrmOfflinePhone` | 1/1 passed again with the bookmarked lead and cold worker. |
| `TEST_DATABASE=crm_phase2 LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python phone_offline.py` | 1/1 passed with the Odoo process stopped for both the pipeline and lead launches. |

## Final verification in progress

A real lost-response test identified a duplicate create. Commit 3aea6c3583c fixes the original operation ID in scoped ORM callers. The corrected browser/process test confirmed the server had committed one opportunity before losing the response and still had one after replay. A two-tab test delivered 16 queued notes once in order and let another tab save while the server was blocked. A queued note survived a real module update with the old document closed. The final suite and performance comparisons are in progress.
