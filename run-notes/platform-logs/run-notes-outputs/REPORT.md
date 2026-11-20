# Offline mode for Odoo CRM

**Draft PR #13 is open and unmerged.** Its nine commits run from `ee8c13eaa57` to `e21b8020e0b`, on `codex/crm-offline` into `20.0` in `bobbyabbott421-glitch/odoo`. Every baseline test ID was accounted for. No new failing IDs or skips remained. [Draft pull request](https://github.com/bobbyabbott421-glitch/odoo/pull/13) · [Saved report](/workspace/run-notes/REPORT.md) · [Phase plan](/workspace/run-notes/PLAN.md)

## What works offline

| Task | Behavior and reason |
| --- | --- |
| Reopen CRM | The pipeline restores the last selected sales team. Previously opened leads show saved details, history, notes and activities, with the time each was checked. Saved searches can reopen. Uncached results and history are labeled as requiring a connection. |
| Work on a lead | Create an opportunity, edit saved fields, change stage from the form, archive, restore or delete. Reconnect runs the normal Odoo methods and installed extensions. If someone else edited the lead, the rep’s queued fields win. |
| Follow up | Log a plain internal note or schedule a personal to-do with a due date. Rich messages, mentions, outgoing mail and attachments require the online composer and its recipient or file handling. |
| Use other workflows | Meetings, conversion, assignment, enrichment, lost/won wizards, quotations, linked apps, reports and blacklist management require live records, permissions or server workflows. Dragging cards or stages requires a connection because it resequences other records. The UI explains disabled actions. Offline stage celebrations are omitted. |
| Recover pending work | The queue saves a change before its first send, shows what is waiting and replays it automatically in order across tabs. A failed item retains its reason and offers retry or explicit discard. Unrelated work continues. |

**Shared-device decision.** A disconnected device uses the last verified rep, database and company selection. It cannot learn of a later revocation until reconnect. CRM displays snapshot times, rechecks visited leads on reconnect and clears cached reads after confirmed denial. The server checks the actor on every queued write. In the shared-device test, the second rep could neither see nor send the first rep’s note. Signing back in as its owner delivered it once.

**Phone launch.** A rep can enable *CRM offline access* online with a passphrase of at least 12 characters. Odoo’s installation manifest opens the pipeline. After the service worker stops, the passphrase can reopen the pipeline or a visited lead link. A wrong passphrase, expired marker or changed account keeps it locked.

## Shared code and database changes

- **Web and HTTP.** RPC, menu and IndexedDB caches bind reads to the verified account, companies and access generation. Warm CRM navigation and lead chatter fall back after a five-second stall. The worker, bootstrap and offline page support an expiring session marker and encrypted cold launch. Cached translations survive a failed background refresh.
- **Editing and replay.** The shared ORM, record and list models keep one operation ID through the first send and every retry. Encrypted pending work survives registry updates. Cross-tab locks serialize delivery while another tab can save locally. The sync menu exposes pending and failed changes.
- **Mail and testing.** Mail’s store controller and client return individually cacheable, authorized chatter results in one transaction. Odoo’s Chromium test driver can disconnect a page, and the HTTP test can stop and restart its endpoint. The HOOT lock mock now waits for its callback as the browser does.
- **Data model.** The only new table, `crm_offline_receipt`, records the user, operation key, request digest and resulting record IDs in the business transaction. A retained receipt lets the server recognize a late retry, including one whose first response was lost.

## Verification

All 31 selected modules were installed. Counts are **passed / failed or errored / skipped**. Tours also count within their enclosing Python methods.

| Suite | Pinned base | Branch |
| --- | ---: | ---: |
| Standard Python | 826 / 24 / 3 of 853 | 834 / 24 / 3 of 861 |
| Nonstandard Python | 15 / 20 / 0 of 35 | 15 / 20 / 0 of 35 |
| Browser tour invocations | 81 / 12 / 0 of 93 | 81 / 12 / 0 of 93 |
| Desktop JavaScript | 8,098 / 7 / 0 of 8,105 | 8,108 / 6 / 0 of 8,114 |
| Mobile JavaScript | 4,058 / 1 / 0 of 4,059 | 4,065 / 1 / 0 of 4,066 |
| Embedded livechat | 44 / 0 / 0 of 44 | 44 / 0 / 0 of 44 |
| HOOT framework | 198 / 0 / 0 of 198 | 198 / 0 / 0 of 198 |

The long Python run began before the final fixes. Focused runs covered those changes, including a 12/12 Odoo run with 63/63 desktop and 30/30 mobile unit tests, followed by account-switch, HTTP-denial, menu and translation checks. The desktop wrapper reached its original 30-minute limit under load. Three disjoint groups then ran every baseline ID. Mobile calendar and embedded livechat tests also timed out under load. On the idle host, all 115 calendar cases and all 44 embed cases passed. The full mobile rerun’s sole failure was the baseline peer-to-peer call test. Existing assertions, skips and timeouts were preserved. [Counts by module](/workspace/run-notes/module-results.md) · [Results by test ID](/workspace/run-notes/final-evidence.json)

**Real connection loss.** Tests disconnected Chromium and stopped Odoo. They restored a visited lead’s note and activity, reopened a cold phone session, and verified archive, restore and delete through the form menu. A pending note survived a CRM upgrade with the old browser document closed. A lost-response test caught a duplicate create during development. After the fix, the server had one opportunity before the successful response was dropped and one after replay. Two tabs delivered 16 notes once, in order. With the first server transaction blocked, the second tab saved locally in 0.38 seconds.

**Upgrade.** Upgrading `web,mail,crm` on the demo `crm_base` preserved all 45 CRM leads’ business values and external IDs. The snapshot grew from 434 to 435 persistent tables. Five demo mailing memberships and seven metadata rows received new numeric IDs. The unchanged base reproduced those same replacements, with the memberships and XML IDs preserved.

## Performance

Times are median milliseconds to visible content. Arrows run from base to branch.

| Warm online navigation | Pipeline | Lead form |
| --- | ---: | ---: |
| Concurrent suites, five samples each | 3,425 → 5,107 | 3,371 → 3,483 |
| Idle host, base first, five each | 719 → 866 | 736 → 873 |
| Idle host, branch first, five each | 822 → 753 | 755 → 787 |
| Alternating builds, ten each | 1,185 → 1,293 | 1,148 → 1,173 |
| Median HTTP requests, alternating run | 14 → 14 | 16.5 → 16 |
| Median business POSTs, alternating run | 8 → 8 | 7 → 7 |

The original pre-change baseline was 3,350 ms and 14 requests for the pipeline, and 1,523 ms and 15 requests for the form. Across the alternating pairs, the median branch-minus-base difference was +25 ms for the pipeline and +70 ms for the form. Chromium’s service-worker update checks varied between samples. Business POST counts stayed steady. Identical online load times were not established.

With **10,000 opportunities** on the server, the disconnected pipeline restored its saved 320 cards in 2,287 ms on the idle base and 2,357 ms on the idle branch. The branch also restored the selected team. Under concurrent load, the final branch took 18,815 ms. Earlier single runs measured 4,947 ms at baseline and 3,726 ms in phase 2.

## Reproduction and limits

- From `/workspace/run-notes`, the suite commands are `bash baseline.sh python <db> -i`, `bash baseline.sh extra <db> -u`, `bash baseline.sh desktop <db> installed`, `bash baseline.sh mobile <db> installed` and `bash embed.sh <db>` on the prepared databases. `bash desktop-final.sh` runs the desktop groups. `bash target.sh <db> '<test tags>'` reruns individual Odoo tests. Run `bash quiet-timing.sh`, `bash reverse-timing.sh` and `python interleaved-timing.py` for the timing comparisons. Exact stopped-process commands, fixtures and earlier attempts are in the [phase log](/workspace/run-notes/STATUS.md).
- Reproduce the upgrade with `odoo-bin -c /workspace/odoo-env/odoo.conf -d crm_base -u web,mail,crm --no-http --stop-after-init`. Test tooling installed in the task virtual environment was `pip 25.0.1` for installation and `websocket-client 1.9.2` for Odoo’s Chromium driver. The repository gained no dependency and `requirements.txt` is unchanged.
- Upgrade a browser containing old, unscoped pending work to see the recovery notice. Those entries lack a trustworthy owner and database, so they remain on the device for manual reconciliation. Clearing site data removes unsent local work. If storage fills during an offline save, the form stays open with a warning.
- Stop the worker and reopen offline on a browser without the required secure-storage or cookie APIs to see the connection-required page. Phone verification used Chromium at 390 pixels with touch, dark mode, right-to-left layout and an accessibility-tree label check. Physical iOS/Android installation, spoken screen-reader output and every translated locale remain unverified.
