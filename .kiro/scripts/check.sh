#!/usr/bin/env bash
# .kiro/scripts/check.sh: one entry point for scope checks and the five test commands.
# Usage: .kiro/scripts/check.sh scope|quick|full   (settings come from .kiro/scripts/check.env)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/../.."                                   # repo root
[ -f "$HERE/check.env" ] && . "$HERE/check.env"   # BASE_SHA, ODOO_DB, VENV, PG*, ODOO_ARGS, LOG_DIR
[ -n "${VENV:-}" ] && [ -f "$VENV/bin/activate" ] && . "$VENV/bin/activate"
[ -n "${PG_BIN:-}" ] && export PATH="$PG_BIN:$PATH"
MODE="${1:-scope}"
: "${BASE_SHA:?Set BASE_SHA in .kiro/scripts/check.env}"
DB="${ODOO_DB:-crm_offline_test}"
LOG_DIR="${LOG_DIR:-$HOME/kiro-evidence/logs}"     # full Odoo logs go here, outside the repo
STAMP="$(date +%Y%m%d-%H%M%S)"
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

pgargs() { echo ${PGHOST:+-h "$PGHOST"} -p "${PGPORT:-5432}"; }
db_exists() { psql $(pgargs) -d postgres -Atqc "select 1 from pg_database where datname='$DB'" 2>/dev/null | grep -q 1; }
fresh_db() { dropdb $(pgargs) --if-exists "$DB" && echo "(fresh database: $DB dropped; command 1 reinstalls it)"; }

# ODOO_ARGS is intentionally unquoted so it can hold several options
odoo() { ./odoo-bin -d "$DB" ${ODOO_ARGS:-} "$@" --test-enable --stop-after-init --log-level=test; }

# Runs one test command, saves the full log, prints only the summary,
# and fails if tests failed, errored, or none ran (unless zero is allowed).
# Usage: run_tests <log-name> <allow_zero: 0|1> <odoo args...>
run_tests() {
  local name="$1" allow_zero="$2"; shift 2
  mkdir -p "$LOG_DIR"
  local log="$LOG_DIR/$STAMP-$name.log"
  odoo "$@" > "$log" 2>&1; local rc=$?
  local summary failed errors total
  summary=$(grep -oE "[0-9]+ failed, [0-9]+ error\(s\) of [0-9]+ tests" "$log" | tail -1)
  echo "${summary:-no test summary found}"
  echo "log: $log"
  failed=$(echo "$summary" | sed -nE 's/^([0-9]+) failed.*/\1/p')
  errors=$(echo "$summary" | sed -nE 's/.* ([0-9]+) error\(s\).*/\1/p')
  total=$(echo "$summary" | sed -nE 's/.* of ([0-9]+) tests.*/\1/p')
  if [ -z "$summary" ] || [ "$rc" -ne 0 ] || [ "${failed:-1}" -gt 0 ] || [ "${errors:-1}" -gt 0 ]; then
    grep -E "(ERROR|FAIL): " "$log" | head -20
    result 1; return
  fi
  if [ "${total:-0}" -eq 0 ]; then
    if [ "$allow_zero" = 1 ]; then echo "SKIP (no tests exist yet)"; return; fi
    echo "0 tests ran, which is a failure for this command"; result 1; return
  fi
  result 0
}

# Command 2 may legitimately find no tests until test_crm_offline.py exists
offline_zero_ok() { [ -f addons/crm/tests/test_crm_offline.py ] && echo 0 || echo 1; }

cmd1() { section "Command 1: crm Python tests (fresh database)"; fresh_db; run_tests cmd1 0 -i crm --test-tags /crm; }
cmd2() { section "Command 2: TestCrmOffline"; run_tests cmd2 "$(offline_zero_ok)" -u crm --test-tags /crm:TestCrmOffline; }
# WebSuite and MobileWebSuite are CrossModule suites: web must be loaded, and the /crm: prefix scopes them to crm's JS tests
cmd3() { section "Command 3: JS unit tests, desktop"; run_tests cmd3 0 -u web,crm --test-tags /crm:WebSuite.test_unit_desktop; }
cmd4() { section "Command 4: JS unit tests, mobile"; run_tests cmd4 0 -u web,crm --test-tags /crm:MobileWebSuite.test_unit_mobile; }
cmd5() { section "Command 5: forbidden-statement guard"; run_tests cmd5 0 -u web,crm --test-tags /web:HootSuite.test_check_suite; }

ensure_db() {
  db_exists && return 0
  echo "(test database $DB missing; installing crm without tests first)"
  mkdir -p "$LOG_DIR"
  ./odoo-bin -d "$DB" ${ODOO_ARGS:-} -i crm --stop-after-init > "$LOG_DIR/$STAMP-install.log" 2>&1 \
    || { echo "Install failed; see $LOG_DIR/$STAMP-install.log"; exit 2; }
}

case "$MODE" in
  scope) scope ;;
  quick) scope; ensure_pg; ensure_db; cmd2; cmd3 ;;
  full)  scope; acceptance; ensure_pg; cmd1; cmd2; cmd3; cmd4; cmd5 ;;
  *) echo "Usage: check.sh scope|quick|full"; exit 2 ;;
esac

echo; if [ "$FAIL" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$FAIL"