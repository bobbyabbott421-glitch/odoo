#!/bin/bash
set -eu
export XDG_CONFIG_HOME=/workspace/run-notes/browser-config XDG_CACHE_HOME=/workspace/run-notes/browser-cache
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
export RUN_ID=crm_baseline_extra_remaining
tags='*/test_event_full:TestOnlineEventPerformance.test_register_public,*/web:TestPregenerateTime,*/web:TestAssetsGenerateTime,*/web:TestMenusAdmin,*/web:TestMenusDemo'
exec python /workspace/run-notes/reap_children.py /workspace/odoo-env/venv/bin/python /workspace/run-notes/run_suite.py -c /workspace/odoo-env/odoo.conf -d crm_baseline_extra --test-tags="$tags" --http-interface=127.0.0.1 --http-port=8075 --stop-after-init --screenshots=/workspace/run-notes/screenshots
