#!/usr/bin/env bash
# PreToolUse guard: block writes outside addons/crm/ and .kiro/, and protect
# the check script and the two frozen steering files. Exit 2 blocks; stderr -> agent.
# Fails CLOSED: if the target path can't be determined, block rather than allow.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

path="$("$HERE/lib/extract_path.sh" <<<"$(cat)")"; rc=$?

if [ "$rc" -ne 0 ] || [ -z "$path" ]; then
  echo "BLOCKED: could not determine the target file path for this write (helper rc=$rc). Failing closed per constraints.md so an unparseable write can't bypass the scope guard." >&2
  exit 2
fi

# Paths the helper marked as resolving outside the repo are, by definition,
# outside addons/crm/.
case "$path" in
  OUTSIDE:*)
    echo "BLOCKED: '${path#OUTSIDE:}' resolves outside the repository, so it is outside addons/crm/. constraints.md: 'Modify no file outside addons/crm/.'" >&2
    exit 2 ;;
esac

# 1. Frozen files: never writable by the agent. This includes the enforcement
#    machinery itself (this guard + the hook configs), so an agent can't disable
#    the guards by editing them. The user edits these out-of-band.
case "$path" in
  .kiro/scripts/check.sh|\
  .kiro/steering/constraints.md|\
  .kiro/steering/testing.md|\
  .kiro/hooks/guard_write_scope.sh|\
  .kiro/hooks/lib/extract_path.sh|\
  .kiro/hooks/stop_scope_check.sh|\
  .kiro/hooks/enforce-write-scope.json|\
  .kiro/hooks/warn-new-file.json|\
  .kiro/hooks/stop-scope-check.json)

    echo "BLOCKED: '$path' is frozen. It is either a check definition or part of the write-guard enforcement; neither may be changed by the agent to make a run pass. The user edits these manually." >&2
    exit 2 ;;
esac

# 2. Scope: only addons/crm/ and .kiro/ are writable.
case "$path" in
  addons/crm/*|.kiro/*) exit 0 ;;
  *)
    echo "BLOCKED: '$path' is outside addons/crm/. constraints.md: 'Modify no file outside addons/crm/.' Extend other addons from inside crm (_inherit, patch(), XML inheritance) instead." >&2
    exit 2 ;;
esac
