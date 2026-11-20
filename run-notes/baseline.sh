#!/bin/bash
set -eu
cd /workspace/odoo
notes=/workspace/run-notes
export XDG_CONFIG_HOME="$notes/browser-config" XDG_CACHE_HOME="$notes/browser-cache"
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu
export PATH="/workspace/odoo-env/system/usr/lib/postgresql/17/bin:$PATH"
export NO_PROXY="localhost,127.0.0.1,${NO_PROXY:-}"
export no_proxy="$NO_PROXY"
modules=$(cat "$notes/modules.txt")
case "$1" in
 python) pattern='/%s'; exclude=',-:WebSuite.test_unit_desktop,-:MobileWebSuite.test_unit_mobile'; port=8071 ;;
 extra) pattern='*/%s'; exclude=',-standard'; port=8075 ;;
 desktop) pattern='/%s:WebSuite.test_unit_desktop'; exclude=; port=8072 ;;
 mobile) pattern='/%s:MobileWebSuite.test_unit_mobile'; exclude=; port=8073 ;;
 *) exit 2 ;;
esac
tags=$(python -c 'import sys; print(",".join(sys.argv[1] % m for m in sys.argv[2].split(",")))' "$pattern" "$modules")
module_args=()
if [[ "$3" != installed ]]; then module_args=("$3" "$modules"); fi
exec /workspace/odoo-env/venv/bin/python "$notes/run_suite.py" -c /workspace/odoo-env/odoo.conf -d "$2" "${module_args[@]}" --with-demo --http-interface=127.0.0.1 --http-port="$port" --test-tags="$tags$exclude" --stop-after-init --screenshots="$notes/screenshots"
