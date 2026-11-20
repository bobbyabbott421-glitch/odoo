
## Phase 4 — phone launch

Commit b99f8e87589 adds **CRM offline access** to the CRM user menu. The rep enables it online with a device passphrase, and the install link uses Odoo's scoped app manifest with the pipeline as its start URL. After the service worker stops, a correct passphrase can reopen the saved pipeline or a visited lead link. Chromium also reached the unlock page from a stalled TCP connection. A wrong passphrase kept the lead hidden.

The web controller issues a session marker bound to the database, account, permissions, language and registry. Soft session rotation preserves it. Signing out, an expired marker or a verified security-context change requires online verification. The service worker stores a passphrase-encrypted copy of the backend page with a random salt and IV. Unlock requires both the current marker and the passphrase. The public offline page contains no session bootstrap. Browsers without the required secure storage and worker APIs explain that a connection is needed to reopen Odoo. Clearing browser data removes local data, including pending edits.

GPT-6 Codex implemented and reviewed this phase. The review identified routine session rotation, an obsolete saved bootstrap and unbounded waits on enrollment or navigation. The final checks cover a stalled connection to a bookmarked CRM lead as well as a pipeline launch. No database model changed. Desktop and mobile HOOT each passed their one new test. The phone check covered a 390 px mobile viewport, touch controls, the browser accessibility tree, dark mode and right-to-left layout. Physical iOS/Android installation, assistive-technology speech output and translated strings in every language were not verified.

| Command from /workspace/run-notes | Result |
| --- | --- |
| `bash target.sh crm_phase2 '/crm:TestCrmOfflinePhone,/crm:TestOfflineSession,/web:WebSuite.test_unit_desktop[@crm/crm_offline_access],/web:MobileWebSuite.test_unit_mobile[@crm/crm_offline_access]'` | 4/4 Odoo methods passed. Desktop and mobile each passed 1/1 HOOT test. |
| `bash target.sh crm_phase2 /crm:TestCrmOfflinePhone` | 1/1 passed again with the bookmarked lead and cold worker. |
| `TEST_DATABASE=crm_phase2 LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu python reap_children.py /workspace/odoo-env/venv/bin/python phone_offline.py` | 1/1 passed with the Odoo process stopped for both the pipeline and lead launches. |
