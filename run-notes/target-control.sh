#!/bin/bash
set -eu
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu
export XDG_CACHE_HOME=/workspace/run-notes/browser-cache XDG_CONFIG_HOME=/workspace/run-notes/browser-config
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
exec python /workspace/run-notes/reap_children.py /workspace/odoo-env/venv/bin/python /workspace/run-notes/base-control/odoo-bin -c /workspace/run-notes/control.conf -d "$1" --test-tags="$2" --http-interface=127.0.0.1 --http-port="${TARGET_PORT:-8078}" --stop-after-init
