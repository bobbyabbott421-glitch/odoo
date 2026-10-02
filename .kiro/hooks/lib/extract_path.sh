#!/usr/bin/env bash
# Reads hook JSON from stdin, prints the target file path normalized to repo-relative.
# Exit codes:
#   0  -> a path was found and printed (repo-relative, ".." collapsed)
#   3  -> no path could be determined from the payload
# The exact stdin key isn't contractually fixed across triggers, so try several.
set -uo pipefail
input="$(cat)"

path=""
if command -v jq >/dev/null 2>&1; then
  path="$(printf '%s' "$input" | jq -r '
    .tool_input.path
    // .tool_input.file_path
    // .tool_input.targetFile
    // .tool_input.target_file
    // .filePath
    // .file_path
    // .path
    // empty' 2>/dev/null | head -1)"
fi

# Fallback: regex-scrape the first path-looking value if jq found nothing.
if [ -z "$path" ]; then
  path="$(printf '%s' "$input" | grep -oE '"(path|file_path|filePath|targetFile|target_file)" *: *"[^"]+"' \
    | head -1 | sed -E 's/.*: *"([^"]+)"/\1/')"
fi

[ -z "$path" ] && exit 3   # nothing to check; caller decides whether to fail closed

# Resolve the repo root (don't depend on KIRO_WORKSPACE, which isn't set).
root="$(git rev-parse --show-toplevel 2>/dev/null)"

# Make the path absolute first, so ".." collapsing is well defined.
case "$path" in
  /*) abs="$path" ;;
  *)  abs="${root:-$PWD}/$path" ;;
esac

# Collapse "." and ".." segments without touching the filesystem (the target
# file may not exist yet, so realpath -e won't work).
normalize() {
  local p="$1" out=() seg
  local IFS='/'
  for seg in $p; do
    case "$seg" in
      ''|'.') ;;                       # skip empty and current-dir segments
      '..')   [ ${#out[@]} -gt 0 ] && unset 'out[${#out[@]}-1]' ;;
      *)      out+=("$seg") ;;
    esac
  done
  printf '/%s' "${out[@]}"
}
abs="$(normalize "$abs")"

# Strip the repo root to get a repo-relative path. If it doesn't live under the
# repo root, print it with a leading marker so the caller treats it as outside.
if [ -n "$root" ] && [ "$abs" = "$root" -o "${abs#"$root"/}" != "$abs" ]; then
  printf '%s\n' "${abs#"$root"/}"
else
  printf 'OUTSIDE:%s\n' "$abs"
fi
