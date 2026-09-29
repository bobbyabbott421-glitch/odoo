#!/usr/bin/env bash
# .kiro/scripts/check.sh: one entry point for scope checks and the five test commands.
# Usage: .kiro/scripts/check.sh scope|quick|full   (settings come from .kiro/scripts/check.env)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/../.."                                   # repo root
[ -f "$HERE/check.env" ] && . "$HERE/check.env"   # BASE_SHA, ODOO_DB, VENV, PG*, ODOO_ARGS
[ -n "${VENV:-}" ] && [ -f "$VENV/bin/activate" ] && . "$VENV/bin/activate"
[ -n "${PG_BIN:-}" ] && export PATH="$PG_BIN:$PATH"
MODE="${1:-scope}"
: "${BASE_SHA:?Set BASE_SHA in .kiro/scripts/check.env}"
DB="${ODOO_DB:-crm_offline_test}"
FAIL=0

section() { echo; echo "== $1"; }
result() { if [ "$1" -eq 0 ]; then echo "PASS"; else echo "FAIL"; FAIL=1; fi; }

scope() {
  section "Scope 1 (row 2): files changed outside addons/crm/ (excluding .kiro/)"
  out=$(git diff --name-only "$BASE_SHA"..HEAD | grep -v '^addons/crm/' | grep -v '^\.kiro/' || true)
  [ -n "$out" ] && echo "$out"; [ -z "$out" ]; result $?

  section "Scope 2 (row 3): requirements.txt or security/ changed"
  out=$(git diff --name-only "$BASE_SHA"..HEAD | grep -E 'requirements\.txt|security/' || true)
  [ -n "$out" ] && echo "$out"; [ -z "$out" ]; result $?

  section "Scope 3 (row 4): new offline machinery added in addons/crm/"
  out=$(git diff "$BASE_SHA"..HEAD -- addons/crm ':(exclude,glob)addons/crm/**/*.md' | grep '^+' | grep -iE 'indexeddb|serviceworker|navigator\.locks|caches\.open' || true)
  [ -n "$out" ] && echo "$out"; [ -z "$out" ]; result $?

  section "Scope 4 (row 13): only() or debug() in .test.js files"
  out=$(grep -rnE '(^|[^A-Za-z0-9_])(only|debug)\(' addons/crm/static/tests --include='*.test.js' || true)
  [ -n "$out" ] && echo "$out"; [ -z "$out" ]; result $?

  section "Scope 5 (row 11): existing test files modified, deleted, or renamed (only tests/__init__.py may change)"
  out=$(git diff --name-only --diff-filter=MDR "$BASE_SHA"..HEAD -- addons/crm/tests addons/crm/static/tests | grep -v '^addons/crm/tests/__init__\.py$' || true)
  [ -n "$out" ] && echo "$out"; [ -z "$out" ]; result $?
}

acceptance() {
  section "Acceptance row 1: inventory document exists and uses all three classes"
  f=addons/crm/static/src/mobile/offline_inventory.md
  if [ -f "$f" ] && grep -q QUEUE "$f" && grep -q SKIP "$f" && grep -q DISABLE "$f"; then
    echo "$f present; now read it to confirm every entry point is classified with a justification"; result 0
  else echo "$f missing or incomplete"; result 1; fi

  section "Acceptance row 5: crm manifest version changed (confirm it is one minor increment)"
  ver() { grep -oE "[\"']version[\"'] *: *[\"'][^\"']+" | grep -oE "[^\"']+$"; }
  old=$(git show "$BASE_SHA":addons/crm/__manifest__.py | ver)
  new=$(ver < addons/crm/__manifest__.py)
  echo "base: $old  now: $new"; [ -n "$new" ] && [ "$old" != "$new" ]; result $?
}

ensure_pg() {
  [ -z "${PGDATA:-}" ] && return 0
  if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    echo "Starting PostgreSQL cluster in $PGDATA on port ${PGPORT:-5432}"
    pg_ctl -D "$PGDATA" -o "-p ${PGPORT:-5432}" -l "$PGDATA.log" -w start >/dev/null \
      || { echo "Could not start PostgreSQL; see $PGDATA.log"; exit 2; }
  fi
}

# ODOO_ARGS is intentionally unquoted so it can hold several options
odoo() { ./odoo-bin -d "$DB" ${ODOO_ARGS:-} "$@" --test-enable --stop-after-init --log-level=test; }

cmd1() { section "Command 1: crm Python tests"; odoo -i crm --test-tags /crm; result $?; }
cmd2() { section "Command 2: TestCrmOffline"; odoo -u crm --test-tags /crm:TestCrmOffline; result $?; }
cmd3() { section "Command 3: JS unit tests, desktop"; odoo -u crm --test-tags /web:WebSuite.test_unit_desktop; result $?; }
cmd4() { section "Command 4: JS unit tests, mobile"; odoo -u crm --test-tags /web:MobileWebSuite.test_unit_mobile; result $?; }
cmd5() { section "Command 5: forbidden-statement guard"; odoo -u crm --test-tags /web:HootSuite.test_check_suite; result $?; }

case "$MODE" in
  scope) scope ;;
  quick) scope; ensure_pg; cmd2; cmd3 ;;
  full)  scope; acceptance; ensure_pg; cmd1; cmd2; cmd3; cmd4; cmd5 ;;
  *) echo "Usage: check.sh scope|quick|full"; exit 2 ;;
esac

echo; if [ "$FAIL" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$FAIL"