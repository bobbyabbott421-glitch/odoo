#!/bin/bash
set -eu
cd /workspace/run-notes
while ! test -s final-upgrade-snapshot.log; do sleep 10; done
bash clone_base.sh crm_final_mobile_upgraded
RUN_ID=crm_final_mobile python reap_children.py bash baseline.sh mobile crm_final_mobile_upgraded installed > final-mobile.log 2>&1
