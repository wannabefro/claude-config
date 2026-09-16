#!/usr/bin/env bash
# Print the validated absolute path to the Codex CLI, or fail.
#
# A planted `codex` earlier on PATH runs as the user with their credentials, so
# resolve it and refuse a copy inside the current checkout or a temp root.
set -uo pipefail

found="$(command -v codex 2>/dev/null)" || { echo "codex: not on PATH" >&2; exit 3; }
bin="$(/bin/realpath -- "$found" 2>/dev/null)" || { echo "codex: cannot resolve $found" >&2; exit 3; }
[ -f "$bin" ] && [ -x "$bin" ] || { echo "codex: not an executable file: $bin" >&2; exit 3; }

repo="$(/bin/realpath -- "$PWD" 2>/dev/null || echo "$PWD")"
case "$bin" in
  "$repo"/*|/tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
    echo "codex: refusing an executable inside the checkout or a temp root: $bin" >&2
    exit 3
    ;;
esac

printf '%s\n' "$bin"
