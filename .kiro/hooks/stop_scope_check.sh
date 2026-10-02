#!/usr/bin/env bash
# Stop hook: run the scope checks. On failure, return a block decision so the
# failure goes back to the agent as a new message.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cat >/dev/null   # drain stdin

out="$("$HERE/../scripts/check.sh" scope 2>&1)"; rc=$?

if [ "$rc" -ne 0 ]; then
  reason="check.sh scope FAILED. Fix these before finishing:

$out"
  # Emit a Stop block decision; reason is delivered to the agent.
  jq -cn --arg r "$reason" '{decision:"block", reason:$r}'
  exit 0
fi
exit 0
