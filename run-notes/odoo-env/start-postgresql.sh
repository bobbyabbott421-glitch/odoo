#!/bin/bash
set -euo pipefail
cd /workspace
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
pgbin=/workspace/odoo-env/system/usr/lib/postgresql/17/bin
if ! "$pgbin/pg_ctl" -D /workspace/odoo-env/pgdata status >/dev/null 2>&1; then
  "$pgbin/pg_ctl" -D /workspace/odoo-env/pgdata -l /workspace/odoo-env/postgresql.log -o '-k /workspace/odoo-env/run -h 127.0.0.1 -p 5432' start
fi
"$pgbin/pg_isready" -h /workspace/odoo-env/run -U odoo -d postgres
