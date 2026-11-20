# Status after phase 1

Commit 3a3142c3351 is pushed to codex/crm-offline. Implementation and review used GPT-6 Codex. The reviewer found a request-thread cleanup race and an ambiguous fetch assertion. Both were fixed and the target test passed again.

All commands below ran from /workspace/run-notes or reference its scripts. Counts are collected / run / passed / failed; errors are included in failed. One interrupted test in each Python suite was rerun.

| Command | Results |
| --- | --- |
| bash baseline.sh python crm_baseline_python -i | 853 / 556 / 541 / 13, plus 1 skip and 1 interrupted |
| bash resume_python.sh | 298 / 298 / 285 / 11, plus 2 skips |
| bash baseline.sh extra crm_baseline_extra -u | 35 / 31 / 14 / 16, plus 1 interrupted |
| bash resume_extra.sh | 5 / 5 / 1 / 4 |
| bash baseline.sh desktop crm_baseline_desktop installed | 8,105 / 8,105 / 8,098 / 7 |
| bash baseline.sh mobile crm_baseline_mobile installed | 4,059 / 4,059 / 4,058 / 1 |
| bash embed.sh crm_baseline_embed | 44 / 44 / 44 / 0 |
| LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu /workspace/odoo-env/venv/bin/python connection_cut.py | First 1 / 1 / 0 / 1, rerun 1 / 1 / 1 / 0 |
| LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python connection_cut_intercept.py | 1 / 1 / 1 / 0 |
| MEASUREMENT=before TEST_DATABASE=crm_measure LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu /workspace/odoo-env/venv/bin/python measure.py | First 1 / 1 / 0 / 1, rerun 1 / 1 / 1 / 0 |
| TEST_DATABASE=crm_scale LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu /workspace/odoo-env/venv/bin/python scale_offline.py | First 1 / 1 / 0 / 1, rerun 1 / 1 / 1 / 0 |
| TEST_DATABASE=crm_flow LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python lead_offline.py | 1 / 1 / 0 / 1 |
| bash target.sh crm_baseline_desktop /web:TestOfflineConnection | Before review 1 / 1 / 1 / 0, after fixes 1 / 1 / 1 / 0 |

Final standard Python totals were 853 collected, 826 passed, 24 failed and 3 skipped. Nonstandard totals were 35 collected, 15 passed and 20 failed. The 93 tour invocations in 70 methods had 81 passes and 12 failures. The standard suite also passed 198 HOOT framework tests. Per-ID evidence is in baseline-evidence.json and baseline-tours.json.

All 31 target modules have demo data in crm_base. The snapshot covers 434 persisted tables and 45 leads. Warm pipeline and form medians were 3,350 ms / 14 server requests and 1,523 ms / 15 server requests on a shared host. A warmed 10,000-opportunity pipeline reopened in 4,947 ms with Odoo stopped and Chromium offline. The visited-lead probe failed to restore both a previously visible note and a scheduled activity.

The access decision uses the rep's last verified permissions while disconnected, with revalidation on reconnect. A disconnected device cannot detect a subsequent server-side revocation. The task environment gained pip 25.0.1 for installation and websocket-client 1.9.2 for Odoo's browser driver.

Draft [PR #13](https://github.com/bobbyabbott421-glitch/odoo/pull/13) is open from codex/crm-offline into 20.0 in the authorized repository.

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

Development runs used `bash target.sh crm_baseline_desktop /crm:TestCrmOfflineRead`. The first passed 1/1, the segmented-response iteration failed 1/1 before the server allowed message reads that mark notifications as read, then passed 1/1. With the same driver's combined CRM and desktop/mobile CRM HOOT filters, the initial run passed 2/4 wrapper methods and the corrected run passed 4/4. On crm_phase2, adding @web/webclient/menu_service passed 2/4 methods initially, then 4/4 after deduplicating the mock storage event. The first UI-driven scale probe failed 1/1 on its DOM predicate, then passed 1/1 after returning a Boolean to the browser driver. Logs are p2-*.log.

## Phase 3 — offline changes

Commits fd17836ae50 and 8b6cc7d7874 are on the draft PR. GPT-6 Codex implemented and reviewed the changes. A rep can create an opportunity, edit saved form fields, change stage on the form, log a plain internal note and schedule a personal to-do. Supported archive, restore and delete requests use the same receipt as other supported writes. The real browser tests exercised creation, editing, notes, personal activities and a deleted lead. Archive, restore and delete did not each receive a dedicated browser test in this phase.

The shared web client persists a change before its first network attempt, encrypts it for the account, serializes delivery across tabs and retains the original operation ID. A CRM receipt stores its owner, operation key, payload digest and record IDs in the same transaction as the normal business operation. This prevents a lost reply from creating a second opportunity or repeating a previous edit. Opening a failed CRM item keeps it in the queue. A rep can retry it or explicitly discard it. The shared IndexedDB helper now supports strict writes independent of registry version, and the HOOT lock mock awaits its callback like the browser API. The web bootstrap provides a separate key for pending work so password or two-factor changes can rotate read-cache keys without destroying edits.

Older unscoped work stays in the pre-upgrade database. Its stored payload lacks a trustworthy database/account binding. The queue displays a recovery notice when the browser can enumerate that database. The rep and administrator must establish the original database, account and intended change from their records before re-entering a confirmed change through CRM. Ambiguous entries stay on the device. If local storage is full, a normal live save can still reach the server. An unsaved offline form stays open with a warning when persistence fails.

Card and stage reordering require a connection because they resequence other records. Rich notes, attachments, outgoing mail and mentions require their online composer. Meetings, quotations, projects, live chat, page views, enrich/assign, conversion, reporting, lost/won wizards and blacklist management require live authorization, related records or server workflows. The CRM panel explains disabled actions. The normal server ORM and installed CRM extensions execute supported changes with the rep's account. Decoration such as the stage celebration is omitted while offline. An unsaved dirty form can prompt for an explicit save when closing the page before a durable save finishes.

Final targeted command from /workspace/run-notes

`bash target.sh crm_phase2 '/crm:TestCrmOfflineRead,/crm:TestOfflineReceipt,/web:WebSuite.test_unit_desktop[@web/core/offline/offline_plugin,@web/webclient/offline_systray,@crm/crm_offline],/web:MobileWebSuite.test_unit_mobile[@web/webclient/offline_systray,@crm/crm_offline]'`

All eight Odoo methods passed. Desktop HOOT passed 22/22 and mobile HOOT passed 8/8. One browser scenario retained a deleted lead's note with its reason while a later note and to-do reached the correct lead. A separate process-level test submitted an internal note after Odoo stopped, restarted Odoo and counted exactly one matching server message. Its command was `TEST_DATABASE=crm_flow LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python write_offline.py`, 1/1 passed.

The initial targeted run (`p3-target.log`) passed one of four methods. The form selector and the asynchronous lock mock accounted for the failures. The rerun passed 4/4. Adding notes and to-dos initially passed 6/7 methods and exposed an Owl 3 template binding issue. The next run passed 5/7; both wrappers reported an unsupported HOOT assertion. The following run passed 6/7 because the fixture cut connectivity before authorization for the chatter had arrived. Waiting for the enabled online note button fixed that precondition. The expanded runs p3-reviewed2, p3-validation and p3-publish passed 7/7, 8/8 and 8/8 methods respectively. No existing behavioral assertions were removed. Full commands and test IDs are in the corresponding logs.

## Phase 4 — phone launch

Commit b99f8e87589 adds **CRM offline access** to the CRM user menu. The rep enables it online with a device passphrase, and the install link uses Odoo's scoped app manifest with the pipeline as its start URL. After the service worker stops, a correct passphrase can reopen the saved pipeline or a visited lead link. Chromium also reached the unlock page from a stalled TCP connection. A wrong passphrase kept the lead hidden.

The web controller issues a session marker bound to the database, account, permissions, language and registry. Soft session rotation preserves it. Signing out, an expired marker or a verified security-context change requires online verification. The service worker stores a passphrase-encrypted copy of the backend page with a random salt and IV. Unlock requires both the current marker and the passphrase. The public offline page contains no session bootstrap. Browsers without the required secure storage and worker APIs explain that a connection is needed to reopen Odoo. Clearing browser data removes local data, including pending edits.

GPT-6 Codex implemented and reviewed this phase. The review identified routine session rotation, an obsolete saved bootstrap and unbounded waits on enrollment or navigation. The final checks cover a stalled connection to a bookmarked CRM lead as well as a pipeline launch. No database model changed. Desktop and mobile HOOT each passed their one new test. The phone check covered a 390 px mobile viewport, touch controls, the browser accessibility tree, dark mode and right-to-left layout. Physical iOS/Android installation, assistive-technology speech output and translated strings in every language were not verified.

| Command from /workspace/run-notes | Result |
| --- | --- |
| `bash target.sh crm_phase2 '/crm:TestCrmOfflinePhone,/crm:TestOfflineSession,/web:WebSuite.test_unit_desktop[@crm/crm_offline_access],/web:MobileWebSuite.test_unit_mobile[@crm/crm_offline_access]'` | 4/4 Odoo methods passed. Desktop and mobile each passed 1/1 HOOT test. |
| `bash target.sh crm_phase2 /crm:TestCrmOfflinePhone` | 1/1 passed again with the bookmarked lead and cold worker. |
| `TEST_DATABASE=crm_phase2 LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python phone_offline.py` | 1/1 passed with the Odoo process stopped for both the pipeline and lead launches. |

## Phase 5 verification in progress

GPT-6 Codex reviewed the full branch. A process-level lost-reply probe initially created two leads. Scoped ORM instances had bypassed durable delivery, so the original request and replay used different operation IDs. Commit 3aea6c3583c retains the initial ID through the form and replay, scopes delivery locks to the rep and database, and lets other tabs enqueue behind a slow sender. The corrected real-process probe passed 1/1. A two-tab test held the first server transaction, queued 16 ordered notes, and submitted another CRM save in the other tab. The foreground call confirmed durable queuing in 0.38 seconds. The 16 notes arrived once in order, followed by the save. An independent module-upgrade test closed the old document while Odoo was stopped and applied its pending note once after a fresh launch.

The base and branch upgrades both regenerated the same five demo subscription IDs and seven metadata IDs. All 45 CRM lead business rows and their external IDs survived. The branch adds only the receipt table to the snapshot's 434 existing tables. Full suite and timing comparisons are underway.

The published follow-ups 2f01e587eb07 and e21b8020e0b enforce account changes and HTTP denials consistently across reads, menu preload and replay, and preserve cached translations when their background refresh loses the connection. GPT-6 Codex implemented and reviewed these changes. The expanded targeted run in p5-final.log passed 12/12 Odoo methods, 63/63 desktop HOOT and 30/30 mobile HOOT. The final account-switch, live HTML 403 and menu rerun in p5-shared-reviewed.log passed 3/3. The newer cached-translation checks passed on both presets. In the account switch, the original rep's pending note stayed hidden under the second account and went through once as its original author on return.

A process-stop lifecycle probe verified archive, unarchive and delete through the actual form action menu. Each action ran on a separate disposable opportunity and the test read its persisted state after reconnection. Command from scratch: `TEST_PORT=17855 TEST_DATABASE=crm_flow LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python lifecycle.py`. One run with all three actions passed. The first fixture had waited for chatter even though form actions do not use it. The corrected fixture waits for the actual offline status and action menu.

The final standard desktop preset ran in three disjoint groups after the monolithic wrapper reached its original 1,800-second timeout under load. All baseline IDs appeared with their original multiplicities. Apps passed 1,600 of 1,605, shared web core passed 3,059 of 3,060, and views passed 3,449 of 3,449. Across all groups, 8,108 of 8,114 passed. The six failures occurred at the pinned base as well. The command was `bash desktop-final.sh`. The nonstandard suite completed all 35 methods, with 15 passes and 20 failures/errors, matching the baseline at method and subtest level. The HOOT framework passed all 198 tests and 981 assertions.

The final standard Python run executed all 861 collected methods and finished with 834 passed, 24 failures/errors and 3 skips. Original IDs and subtest failures matched the pinned base. The 93 actual tour invocations also matched by declaring method, tour name and multiplicity, with 81 successes and the same 12 failures. The broadest run began before the final fixes. The final targeted browser and JavaScript reruns cover the later changes. Commands were `python reap_children.py bash baseline.sh python crm_final_python -i` and `python reap_children.py bash baseline.sh extra crm_final_extra -u`. The exact comparison is in tour-comparison.json, generated by tour-comparison.py.

Under load, each of the first two final embedded livechat runs passed 43/44, timing out on the first guest's persisted session. The same failure occurred on the unchanged base during a matched check under load. On the idle host, `TARGET_PORT=17854 bash target.sh crm_final_measure /im_livechat:ExternalTestSuite.test_external_livechat` passed 44/44 with the original five-second test budget. The final mobile run under load passed 4,058/4,065, with six calendar timeouts and the baseline P2P failure. On the idle host, all 115 calendar cases passed with 624 assertions under `TARGET_PORT=17868 bash target.sh crm_flow '/web:MobileWebSuite.test_unit_mobile[@web/views/calendar/calendar_view]'`. The full mobile preset is running again.

On the loaded host, the final 10,000-opportunity pipeline restored the selected team and rendered 320 cards in 18,815 ms. On an idle host, the unchanged implementation rendered the same 320 cards in 2,287 ms on a cloned scale database, and the final implementation restored the team selected in the dropdown in 2,357 ms. Commands are in quiet-scale.sh, with separate base and branch configurations.

The full idle-host mobile preset on the final assets passed 4,065 of 4,066. Its sole failure was the baseline `@mail/discuss/call/call_integration/Can join a call in p2p`. Every baseline case was present. The command was `RUN_ID=crm_offline_quiet_mobile python reap_children.py bash baseline.sh mobile crm_final_mobile_upgraded installed`. The earlier loaded runs had 4,064 and 4,065 total cases before the last added unit surfaced in the full bundle. No timeout or assertion was changed. Per-module counts are in module-results.md and the complete per-ID machine-readable comparison is final-evidence.json.

## Final verification

GPT-6 Codex completed implementation, review and the suite comparison. The nine commits through e21b8020e0b are on the draft PR. The comparison includes all 861 standard and 35 nonstandard Python methods, all 93 baseline tour invocations, all original desktop, mobile and embed IDs, and 198 HOOT framework tests. No new failure or skip remained. The branch, base and report body were checked against the authorized repository. The data snapshot and requirements.txt checks are recorded above.

Tested slowdowns are reported in REPORT.md. The idle timing scripts ran the five-sample batches in both orders. Base-first medians were 719/866 ms for pipeline and 736/873 ms for form (base/branch). Branch-first medians were 822/753 and 755/787 ms. A separate ten-sample comparison alternated which build went first for each navigation with both servers and browsers warm. Its medians were 1,185/1,293 ms and 1,148/1,173 ms. Median within-pair deltas were +24.5 and +69.5 ms. Business POST medians stayed at eight and seven. The sample-specific server request lists identify periodic GETs of /web/service-worker.js as the source of differences in the matched idle form runs. Commands were `bash paired-timing.sh`, `bash quiet-timing.sh`, `bash reverse-timing.sh` and `python interleaved-timing.py`. These numbers and the limitations on physical phone testing, browser storage and disconnected access revocation are in the final report.

GitHub returned the exact saved report as the description of open draft PR #13, with base 20.0, head codex/crm-offline, the expected commit and merged=false. The Codex goal tracker rejected the completion update twice with “stop_goal requires trusted goal and source-turn context from CCA.” The PR and report delivery were independently verified.
The restored goal session reverified PR #13, its commit and the exact REPORT.md body. The goal tracker confirmed completion.
