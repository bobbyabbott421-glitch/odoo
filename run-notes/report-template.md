# Offline mode for Odoo CRM

Draft PR [#13](https://github.com/bobbyabbott421-glitch/odoo/pull/13) targets `bobbyabbott421-glitch/odoo:20.0` from `codex/crm-offline`. The branch starts at `ee8c13eaa57`. HEAD is `HEADSHA`, and the PR is open and unmerged.

## What reps can do

| When disconnected | Behavior and reason |
| --- | --- |
| Open CRM | The saved pipeline reopens on the last selected sales team. Previously visited leads show saved form details, history, notes and scheduled activities, with timestamps. Saved searches can reopen. Other results and uncached history are labeled as requiring a connection. The browser only has the portion previously loaded. |
| Create and edit | Reps can create an opportunity, edit saved form fields and change its stage from the form. Supported archive, restore and delete actions are queued. The normal Odoo methods run on reconnect, including installed CRM extensions. A rep's saved fields win when another person edits the same lead. |
| Follow up | Reps can log a plain internal note or schedule a personal to-do with a due date. Rich messages, mentions, attachments and outgoing mail require the live composer and recipient or file handling. |
| Use other CRM workflows | Meetings, conversion, assignment, enrichment, lost/won wizards, quotations, linked apps, blacklist management and reporting need server-side workflows, related records or fresh results. Reordering cards or stages affects other records and requires a connection. The offline notice explains the disabled actions. Decorative stage celebrations are omitted. |
| See what is pending | The queue saves work before its first send, lists pending items and replays them automatically in order across tabs. Failed items retain their reason and can be retried or explicitly discarded. A failure on one lead lets unrelated work continue. |

**Shared devices.** Offline access follows the last verified rep, database and company selection. A server-side revocation during a disconnection is unknowable until reconnect. The app shows the snapshot age, rechecks visited leads on reconnect, clears cached reads after confirmed denial and verifies the actor on each write. A warm, signed-in browser uses that rep's existing session. Switching accounts hides the previous rep's work. Signing back in as its owner resumes delivery.

**Phone launch.** A rep can enable *CRM offline access* online with a device passphrase and install Odoo with the pipeline as its start page. The passphrase unlocks a saved pipeline or visited lead after the service worker stops. A wrong passphrase, expired session marker or changed account keeps it locked. The cold-launch test exercised a 390-pixel touch viewport, a slow TCP connection, dark mode, right-to-left layout and a screen-reader-accessible label. Physical iOS and Android installation, spoken output and every translated locale remain unverified.

## Changes to shared Odoo code and data

- **Web client and HTTP.** Existing RPC, menu and IndexedDB caches bind reads to the verified account, active companies and access generation. Saved CRM navigation and lead chatter fall back after five seconds on a stalled connection. A failed background translation refresh can use the current cached language. Bootstrap and service-worker changes support an expiring session marker and passphrase-encrypted cold launch. The public offline page supplies the unlock form.
- **Shared editing and pending work.** The ORM, record and list models preserve the original operation ID from the first request through replay. The account's encrypted queue survives registry updates. Cross-tab locks serialize server delivery while leaving the other tab free to save locally. The systray exposes failures and recovery. The HOOT lock mock now waits for its callback, matching the browser API.
- **Mail and test infrastructure.** The mail store controller and client can return separately cacheable authorized chatter results from a single ordered transaction. Odoo's Chromium driver gained a real offline context. The web HTTP test can stop and restart a dedicated endpoint.
- **Database.** The only new table is `crm_offline_receipt`. Its unique user/operation key, request digest and resulting record IDs let Odoo acknowledge retries after a lost reply. The receipt commits with the normal business operation under the rep's permissions. Receipts are retained so a late retry remains recognizable.

## Verification

SUITES

**Stopped-server tests.** Chromium lost connectivity and the Odoo process stopped. The tests restored the selected team and a visited lead's note and activity, saved a new note, reopened a bookmarked lead with a cold service worker, and delivered a pending note once after the old document closed and CRM was upgraded. A lost-create-reply test initially exposed a duplicate. The fix preserved the first request's operation ID. The server held one lead before the successful response was dropped and still held one after replay. Two real tabs delivered 16 distinct notes once, in order. With the first server transaction blocked, the other tab confirmed its local save in 0.38 seconds. Account-switch, HTML access-denial, deleted-lead and mixed-success tests checked both the UI and the resulting server state. A further stopped-server test archived, restored and deleted disposable leads through the form menu and verified each result on the server.

**Database upgrade.** Upgrading `web,mail,crm` on the demo `crm_base` database preserved the business values and external IDs of all 45 CRM leads. The snapshot grew from 434 to 435 persistent tables. Five demo mailing memberships and seven metadata rows received new numeric IDs. The unchanged base reproduced exactly those replacements. The same memberships and XML IDs remained present after both upgrades.

PERF

**Reproduction.** From `/workspace/run-notes`, run `bash baseline.sh python <db> -i`, `bash baseline.sh extra <db> -u`, `bash baseline.sh desktop <db> installed`, `bash baseline.sh mobile <db> installed` and `bash embed.sh <db>` on the prepared baseline databases. The module list is in `modules.txt`. On the branch, `bash desktop-final.sh` runs the desktop preset in three groups with the original timeouts. Use `bash target.sh <db> '<Odoo test tags>'` for focused runs. With the task virtual environment and its library path, `python reap_children.py /workspace/odoo-env/venv/bin/python <probe>.py` runs the process probes, including `lead_offline`, `write_offline`, `phone_offline`, `lost_ack`, `tab_backlog`, `pending_upgrade` `lifecycle` and `scale_offline_phase2`. Upgrade with `odoo-bin -c /workspace/odoo-env/odoo.conf -d crm_base -u web,mail,crm --no-http --stop-after-init`. Exact commands, presets, fixture names and earlier attempts are in the [phase log](/workspace/run-notes/STATUS.md).

**Recovery limits.** To reproduce the legacy-queue case, upgrade a browser with pending entries from the old unscoped store. Those entries lack a trustworthy owner and database. The recovery notice leaves them available for manual reconciliation. To reproduce unsupported cold launch, terminate the worker on a browser without the required secure-storage or cookie APIs and reopen CRM offline. It requests a connection. Clearing site data removes unsent local work. A full local store leaves an offline form open with a warning when it cannot be saved.

Test tooling installed in the task virtual environment was `pip 25.0.1` for installation and `websocket-client 1.9.2` for Odoo's Chromium driver. The repository gained no dependencies. Its `requirements.txt` is unchanged.
