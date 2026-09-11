#!/usr/bin/env bash
# Desktop notification. Never fail a caller: no notifier means no notification.
set -uo pipefail

usage() {
  echo "usage: notify.sh <title> <message> [url]" >&2
  exit 64
}

[ "$#" -ge 2 ] || usage
title="$1"
message="$2"
url="${3:-}"

if [ -n "${CLAUDE_NOTIFY_DRY_RUN:-}" ]; then
  printf 'notify: title=%s message=%s url=%s\n' "$title" "$message" "$url"
  exit 0
fi

if command -v terminal-notifier >/dev/null 2>&1; then
  args=(-title "$title" -message "$message" -sender com.apple.Terminal)
  [ -n "$url" ] && args+=(-open "$url")
  terminal-notifier "${args[@]}" >/dev/null 2>&1
  exit 0
fi

if command -v osascript >/dev/null 2>&1; then
  # osascript takes the strings as arguments, so a quote in the title cannot close the script.
  osascript -e 'on run {t, m}' -e 'display notification m with title t' -e 'end run' \
    "$title" "$message" >/dev/null 2>&1
  exit 0
fi

exit 0
