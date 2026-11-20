#!/bin/bash
set -u
cd /workspace/run-notes
while ! test -f quiet-exits.txt || ! rg -q '^timing ' quiet-exits.txt; do sleep 20; done
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu TEST_PORT=17862
TEST_REPO=/workspace/run-notes/base-control TEST_ODOO_CONF=/workspace/run-notes/control.conf TEST_DATABASE=crm_quiet_scale_base python reap_children.py /workspace/odoo-env/venv/bin/python scale_offline.py > quiet-scale-base.log 2>&1
echo "scale-base $?" >> quiet-exits.txt
TEST_DATABASE=crm_scale python reap_children.py /workspace/odoo-env/venv/bin/python scale_offline_phase2.py > quiet-scale-head.log 2>&1
echo "scale-head $?" >> quiet-exits.txt
