#!/usr/bin/env bash
# Refresh marketplace catalogues and installed plugins, at most once per interval.
#
# Marketplace refresh is a catalogue fetch, so it runs unattended. Plugin
# updates deliberately omit -y: a marketplace-declared install command is
# arbitrary code execution and must be seen by a person, so such a plugin
# refuses here and is named in the log instead.
set -uo pipefail

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
STATE_DIR="$CLAUDE_HOME/state"
STAMP="$STATE_DIR/plugin-refresh.stamp"
LOG="$STATE_DIR/plugin-refresh.log"
INTERVAL="${CLAUDE_PLUGIN_REFRESH_INTERVAL:-86400}"
LOCK="$STATE_DIR/plugin-refresh.lock"

usage() { echo "usage: plugin-refresh.sh [--force] [--check]" >&2; exit 64; }

force=0
check=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --check) check=1 ;;
    *) usage ;;
  esac
done

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

now=$(date +%s)
last=0
[ -f "$STAMP" ] && last=$(cat "$STAMP" 2>/dev/null || echo 0)
case "$last" in ''|*[!0-9]*) last=0 ;; esac
age=$((now - last))

if [ "$check" -eq 1 ]; then
  if [ "$last" -eq 0 ]; then
    when=never
  else
    # BSD date takes -r <epoch>; GNU date reads -r as a reference file and needs -d.
    when="$(date -r "$last" '+%Y-%m-%d %H:%M' 2>/dev/null \
      || date -d "@$last" '+%Y-%m-%d %H:%M' 2>/dev/null \
      || echo "epoch $last")"
  fi
  echo "last refresh: $when"
  echo "age: ${age}s  interval: ${INTERVAL}s  due: $([ "$age" -ge "$INTERVAL" ] && echo yes || echo no)"
  exit 0
fi

if [ "$force" -eq 0 ] && [ "$age" -lt "$INTERVAL" ]; then
  exit 0
fi

# One refresh at a time; a stale lock from a killed run must not block forever.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

claude_bin="$(command -v claude 2>/dev/null)" || exit 0
[ -x "$claude_bin" ] || exit 0

# Write the stamp before the work: a failing network must not retry every session.
printf '%s\n' "$now" > "$STAMP"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') refresh ==="
  echo "--- marketplaces"
  "$claude_bin" plugin marketplace update 2>&1 | tail -20

  echo "--- plugins (enabled only)"
  # Pair each id with the status line that follows it, so disabled plugins are skipped.
  "$claude_bin" plugin list 2>/dev/null \
    | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' \
    | awk '
        /^[^A-Za-z0-9]*[A-Za-z0-9_.@-]+@[A-Za-z0-9_.-]+[^A-Za-z0-9]*$/ {
          match($0, /[A-Za-z0-9_.@-]+@[A-Za-z0-9_.-]+/); id = substr($0, RSTART, RLENGTH); next }
        /Status:/ && id != "" { if ($0 ~ /enabled/) print id; id = "" }' \
    | sort -u \
    | while IFS= read -r id; do
        # Ids come from config, so accept only the id charset and pass each as one argument.
        case "$id" in
          ''|*[!A-Za-z0-9_.@-]*) echo "  skipped suspicious id"; continue ;;
        esac
        # Drop the "Checking for updates…" preamble so the log records the outcome, not the prompt.
        out="$("$claude_bin" plugin update "$id" 2>&1 \
          | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | tr -d '\r' | tail -2 | tr '\n' ' ' \
          | sed 's/Checking for updates for plugin "[^"]*" at [a-z]* scope[^A-Za-z0-9]*//')"
        [ -n "${out// /}" ] || out="(no output)"
        case "$out" in
          *"declared command"*|*"--accept-command"*|*"confirm"*)
            echo "  NEEDS REVIEW  $id — declares an install command; run it by hand" ;;
          *)
            printf '  %-46s %s\n' "$id" "$(printf '%s' "$out" | cut -c1-70)" ;;
        esac
      done
  echo
} >> "$LOG" 2>&1

# Keep the log from growing without bound.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
  tail -500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null
fi
exit 0
