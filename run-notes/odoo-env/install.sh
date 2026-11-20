#!/bin/bash
set -euo pipefail
cd /workspace
mkdir -p odoo-env/{debs,system,bin,run,data,apt/lists/partial,apt/cache/archives/partial}
cat > odoo-env/apt/sources.list <<'EOF'
deb https://deb.debian.org/debian trixie main
deb https://deb.debian.org/debian-security trixie-security main
EOF
apt_opts=(-o Dir::Etc::parts=- -o Dir::Etc::main=- -o Dir::Etc::sourcelist=/workspace/odoo-env/apt/sources.list -o Dir::Etc::sourceparts=- -o Dir::State::lists=/workspace/odoo-env/apt/lists -o Dir::Cache=/workspace/odoo-env/apt/cache)
apt-get "${apt_opts[@]}" update
(cd odoo-env/debs; apt-get "${apt_opts[@]}" download postgresql-17 postgresql-client-17 libpq5 libpq-dev libsasl2-dev libllvm19; for package in *.deb; do dpkg-deb -x "$package" /workspace/odoo-env/system; done)
cat > odoo-env/bin/pg_config <<'EOF'
#!/bin/sh
case "$1" in
--includedir) echo /workspace/odoo-env/system/usr/include/postgresql ;;
--libdir) echo /workspace/odoo-env/system/usr/lib/x86_64-linux-gnu ;;
*) /workspace/odoo-env/system/usr/bin/pg_config "$@" ;;
esac
EOF
chmod +x odoo-env/bin/pg_config
export UV_CACHE_DIR=/workspace/odoo-env/uv-cache
uv venv --allow-existing /workspace/odoo-env/venv --python python3
CC=gcc CXX=g++ PATH=/workspace/odoo-env/bin:$PATH CFLAGS='-I/workspace/odoo-env/system/usr/include' LDFLAGS='-L/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu' uv pip install --python /workspace/odoo-env/venv/bin/python -r /workspace/odoo/requirements.txt
uv pip check --python /workspace/odoo-env/venv/bin/python
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
if [ ! -f odoo-env/pgdata/PG_VERSION ]; then
  odoo-env/system/usr/lib/postgresql/17/bin/initdb -D /workspace/odoo-env/pgdata -U odoo --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8
fi
if [ ! -f odoo-env/odoo.conf ]; then
cat > odoo-env/odoo.conf <<'EOF'
[options]
addons_path = /workspace/odoo/odoo/addons,/workspace/odoo/addons
data_dir = /workspace/odoo-env/data
db_host = /workspace/odoo-env/run
db_port = 5432
db_user = odoo
db_name = odoo_dev
http_interface = 0.0.0.0
http_port = 8069
EOF
fi

cat > /workspace/odoo-env/start.sh <<'START_SCRIPT'
#!/bin/bash
set -euo pipefail
cd /workspace
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
pgbin=/workspace/odoo-env/system/usr/lib/postgresql/17/bin
if ! "$pgbin/pg_ctl" -D /workspace/odoo-env/pgdata status >/dev/null 2>&1; then
  "$pgbin/pg_ctl" -D /workspace/odoo-env/pgdata -l /workspace/odoo-env/postgresql.log -o '-k /workspace/odoo-env/run -h 127.0.0.1 -p 5432' start
fi
"$pgbin/pg_isready" -h /workspace/odoo-env/run -U odoo
cd /workspace/odoo
exec /workspace/odoo-env/venv/bin/python odoo-bin -c /workspace/odoo-env/odoo.conf "$@"
START_SCRIPT
chmod +x /workspace/odoo-env/start.sh

# Chromium and Python are supplied by this managed base image.
command -v chromium
python3 --version
cat > /workspace/odoo-env/start-postgresql.sh <<'PG_START_SCRIPT'
#!/bin/bash
set -euo pipefail
cd /workspace
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
pgbin=/workspace/odoo-env/system/usr/lib/postgresql/17/bin
if ! "$pgbin/pg_ctl" -D /workspace/odoo-env/pgdata status >/dev/null 2>&1; then
  "$pgbin/pg_ctl" -D /workspace/odoo-env/pgdata -l /workspace/odoo-env/postgresql.log -o '-k /workspace/odoo-env/run -h 127.0.0.1 -p 5432' start
fi
"$pgbin/pg_isready" -h /workspace/odoo-env/run -U odoo -d postgres
PG_START_SCRIPT
chmod +x /workspace/odoo-env/start-postgresql.sh
