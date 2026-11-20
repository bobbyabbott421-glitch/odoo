#!/bin/bash
set -u
cd /workspace/run-notes
# Wait for the unmodified timed suites to finish before measuring other time-sensitive cases.
while ! { test -f head-desktop-exits.txt && [ "$(wc -l < head-desktop-exits.txt)" -ge 3 ] && rg -q 'Closed [0-9]+ connections' final-extra.log && rg -q 'Closed [0-9]+ connections' final-python.log && rg -q 'Closed [0-9]+ connections' final-mobile.log; }; do
    sleep 30
done
TARGET_PORT=17854 bash target.sh crm_final_measure /im_livechat:ExternalTestSuite.test_external_livechat > quiet-embed.log 2>&1
echo "embed $?" >> quiet-exits.txt
TARGET_PORT=17868 bash target.sh crm_flow '/web:MobileWebSuite.test_unit_mobile[@web/views/calendar/calendar_view]' > quiet-calendar.log 2>&1
echo "calendar $?" >> quiet-exits.txt
bash quiet-timing.sh
echo "timing $?" >> quiet-exits.txt
