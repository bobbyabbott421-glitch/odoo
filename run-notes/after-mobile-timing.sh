#!/bin/bash
set -eu
cd /workspace/run-notes
while ! test -f quiet-exits.txt || ! rg -q '^mobile ' quiet-exits.txt; do sleep 15; done
bash reverse-timing.sh
echo "reverse $?" >> quiet-exits.txt
