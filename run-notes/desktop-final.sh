#!/bin/bash
set -u
cd /workspace/run-notes
for group in apps core views; do
    case "$group" in
      apps) names=$(cat modules.txt | tr ',' '\n' | sed '/^web$/d;s/^/@/' | paste -sd, -) ;;
      core) names='@web,-@web/views' ;;
      views) names='@web/views' ;;
    esac
    TARGET_PORT=17870 bash target.sh crm_final_desktop "/web:WebSuite.test_unit_desktop[$names]" > "head-desktop-$group.log" 2>&1
    echo "$group $?" >> head-desktop-exits.txt
done
