#!/bin/bash
set -eu
export REMAINING_IDS=/workspace/run-notes/python-remaining-ids.txt
export RUN_ID=crm_baseline_python_remaining
exec python /workspace/run-notes/reap_children.py bash /workspace/run-notes/baseline.sh python crm_baseline_python installed
