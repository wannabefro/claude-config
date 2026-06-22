#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

input=$(cat)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

if [ -z "$cwd" ] || [ -z "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  /*) ;;
  *) file_path="$cwd/$file_path" ;;
esac

case "$file_path" in
  *"/.git/"*|\
  *"/node_modules/"*|\
  *"/dist/"*|\
  *"/build/"*|\
  *"/target/"*|\
  *"/coverage/"*|\
  *".env"|\
  *".env."*)
    exit 0
    ;;
esac

stamp_root="/tmp/claude-verify-on-edit"
mkdir -p "$stamp_root"
stamp_key=$(printf '%s' "$cwd:$file_path" | shasum | awk '{print $1}')
stamp_file="$stamp_root/$stamp_key"

now=$(date +%s)
if [ -f "$stamp_file" ]; then
  last_run=$(stat -f %m "$stamp_file" 2>/dev/null || printf '0')
  if [ $((now - last_run)) -lt 8 ]; then
    exit 0
  fi
fi
touch "$stamp_file"

trim_output() {
  printf '%s' "$1" | awk 'NR<=40 { print }' | cut -c1-3000
}

emit_message() {
  jq -n --arg msg "$1" '{systemMessage: $msg}'
}

find_upward() {
  local start_dir="$1"
  local target_name="$2"
  local dir="$start_dir"

  while [ "$dir" != "/" ] && [ -n "$dir" ]; do
    if [ -e "$dir/$target_name" ]; then
      printf '%s\n' "$dir/$target_name"
      return 0
    fi
    dir=$(dirname "$dir")
  done

  return 1
}

run_project_override() {
  local hook=""

  if [ -x "$cwd/.claude/verify-on-edit" ]; then
    hook="$cwd/.claude/verify-on-edit"
  elif [ -f "$cwd/.claude/verify-on-edit.sh" ]; then
    hook="bash $cwd/.claude/verify-on-edit.sh"
  else
    return 1
  fi

  local output=""
  local status=0

  set +e
  output=$(CLAUDE_HOOK_FILE_PATH="$file_path" CLAUDE_HOOK_CWD="$cwd" sh -c "$hook \"\$1\"" sh "$file_path" 2>&1)
  status=$?
  set -e

  if [ $status -eq 0 ]; then
    return 0
  fi

  output=$(trim_output "$output")
  emit_message "Project verify-on-edit failed for $file_path. Fix the issue before finishing this task. Output:\n$output"
  return 0
}

run_generic_check() {
  local output=""
  local status=0
  local checker=""
  local file_dir=""
  local config_path=""
  local config_dir=""
  local tsc_cmd=""

  file_dir=$(dirname "$file_path")

  case "$file_path" in
    *.sh|*.bash)
      checker="bash -n \"$file_path\""
      ;;
    *.zsh)
      if command -v zsh >/dev/null 2>&1; then
        checker="zsh -n \"$file_path\""
      else
        return 0
      fi
      ;;
    *.py)
      if command -v python3 >/dev/null 2>&1; then
        checker="python3 -m py_compile \"$file_path\""
      else
        return 0
      fi
      ;;
    *.json)
      checker="jq empty \"$file_path\""
      ;;
    *.toml)
      if command -v python3 >/dev/null 2>&1; then
        checker="python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], \"rb\"))' \"$file_path\""
      else
        return 0
      fi
      ;;
    *.go)
      if ! command -v go >/dev/null 2>&1; then
        return 0
      fi
      if ! find_upward "$file_dir" "go.mod" >/dev/null 2>&1; then
        return 0
      fi
      checker="mkdir -p /tmp/claude-go-build-cache && cd \"$file_dir\" && GOCACHE=/tmp/claude-go-build-cache go test -run '^$' -vet=off ."
      ;;
    *.ts|*.tsx|*.mts|*.cts)
      config_path=$(find_upward "$file_dir" "tsconfig.json" || true)
      if [ -z "$config_path" ]; then
        config_path=$(find_upward "$file_dir" "jsconfig.json" || true)
      fi
      if [ -z "$config_path" ]; then
        return 0
      fi

      config_dir=$(dirname "$config_path")
      if [ -x "$config_dir/node_modules/.bin/tsc" ]; then
        tsc_cmd="$config_dir/node_modules/.bin/tsc"
      elif command -v tsc >/dev/null 2>&1; then
        tsc_cmd="tsc"
      else
        return 0
      fi

      checker="cd \"$config_dir\" && \"$tsc_cmd\" --noEmit --pretty false -p \"$config_path\""
      ;;
    *)
      return 0
      ;;
  esac

  set +e
  output=$(sh -c "$checker" 2>&1)
  status=$?
  set -e

  if [ $status -eq 0 ]; then
    return 0
  fi

  output=$(trim_output "$output")
  emit_message "A fast syntax/parse check failed for $file_path after the last edit. Fix this before moving on. Output:\n$output"
  return 0
}

run_project_override || run_generic_check
