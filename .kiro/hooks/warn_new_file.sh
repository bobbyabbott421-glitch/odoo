#!/usr/bin/env bash
# PostFileCreate warning: if a newly created file under addons/crm/ isn't on the
# allowed-new-files list in constraints.md, warn (non-blocking, exit 0 always).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

path="$("$HERE/lib/extract_path.sh" <<<"$(cat)")"; rc=$?
if [ "$rc" -ne 0 ] || [ -z "$path" ]; then
  # Non-blocking, but say so: a created file couldn't be checked against the list.
  echo "WARNING: could not determine the created file's path (helper rc=$rc), so it was not checked against the allowed-new-files list in constraints.md. Verify manually that no disallowed new file was added." >&2
  exit 0
fi
path="${path#OUTSIDE:}"              # a warning hook doesn't care about repo boundary

# Only police new files inside the crm source/test tree.
case "$path" in
  addons/crm/*) ;;
  *) exit 0 ;;
esac

allowed="
addons/crm/static/src/mobile/offline_inventory.md
addons/crm/static/src/mobile/crm_offline_hooks.js
addons/crm/static/src/mobile/crm_mobile_pipeline/crm_mobile_pipeline.js
addons/crm/static/src/mobile/crm_mobile_pipeline/crm_mobile_pipeline.xml
addons/crm/static/src/mobile/crm_mobile_pipeline/crm_mobile_pipeline.scss
addons/crm/static/src/mobile/crm_mobile_lead_card/crm_mobile_lead_card.js
addons/crm/static/src/mobile/crm_mobile_lead_card/crm_mobile_lead_card.xml
addons/crm/static/src/mobile/crm_mobile_lead_card/crm_mobile_lead_card.scss
addons/crm/static/src/mobile/crm_mobile_quick_create/crm_mobile_quick_create.js
addons/crm/static/src/mobile/crm_mobile_quick_create/crm_mobile_quick_create.xml
addons/crm/static/src/mobile/crm_mobile_quick_create/crm_mobile_quick_create.scss
addons/crm/tests/test_crm_offline.py
addons/crm/static/tests/crm_offline.test.js
addons/crm/static/tests/crm_mobile_pipeline.test.js
addons/crm/static/tests/tours/crm_mobile_offline.js
"

if printf '%s\n' "$allowed" | grep -qxF "$path"; then
  exit 0
fi

echo "WARNING: '$path' is a new file not on the allowed-new-files list in constraints.md. Allowed new files are the fixed set under static/src/mobile/, plus the four test/tour files. If this is a new file, it likely violates the constraint; if you meant to edit an existing file, ignore this." >&2
exit 0   # non-blocking warning
