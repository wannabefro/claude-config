#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

input=$(cat)

model=$(printf '%s' "$input" | jq -r '.model.display_name // "Claude"')
dir=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // ""')
ctx=$(printf '%s' "$input" | jq -r '(.context_window.used_percentage // 0) | floor')
cost_raw=$(printf '%s' "$input" | jq -r '.cost.total_cost_usd // 0')
cost=$(printf '%.3f' "$cost_raw")

printf '[%s] %s | %s%% ctx | $%s\n' "$model" "${dir##*/}" "$ctx" "$cost"
