#!/bin/bash
set -eu
cd /workspace/run-notes
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu TEST_PORT=17861
for build in head base; do
    if [[ "$build" == base ]]; then
        export TEST_REPO=/workspace/run-notes/base-control TEST_ODOO_CONF=/workspace/run-notes/control.conf TEST_DATABASE=crm_upgrade_control
    else
        export TEST_REPO=/workspace/odoo TEST_ODOO_CONF=/workspace/odoo-env/odoo.conf TEST_DATABASE=crm_final_measure
    fi
    MEASUREMENT="reverse-$build" python reap_children.py /workspace/odoo-env/venv/bin/python measure.py > "reverse-$build.log" 2>&1
done
