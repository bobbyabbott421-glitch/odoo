#!/bin/bash
set -u
cd /workspace/run-notes
while ! test -f quiet-exits.txt || ! rg -q '^scale-head ' quiet-exits.txt; do sleep 20; done
RUN_ID=crm_offline_quiet_mobile python reap_children.py bash baseline.sh mobile crm_final_mobile_upgraded installed > quiet-mobile.log 2>&1
echo "mobile $?" >> quiet-exits.txt
