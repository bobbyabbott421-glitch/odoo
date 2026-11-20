#!/bin/bash
set -eu
export LD_LIBRARY_PATH=/workspace/odoo-env/system/usr/lib/x86_64-linux-gnu
export PGHOST=/workspace/odoo-env/run PGUSER=odoo
pgdir=/workspace/odoo-env/system/usr/lib/postgresql/17/bin
"$pgdir/createdb" -T crm_base "$1"
cp -a --reflink=auto /workspace/odoo-env/data/filestore/crm_base "/workspace/odoo-env/data/filestore/$1"
