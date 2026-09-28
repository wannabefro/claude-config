#!/bin/bash
# Tags tool results with time since the user's last message; Opus 5.5 paces and parallelises on it.
# UserPromptSubmit records the start; PostToolUse reports once a minute has passed.
IFS=$'\t' read -r event sid notice < <(jq -r \
  '[.hook_event_name, .session_id // "", ((.prompt // "") | test("<task-notification>"))] | @tsv')
[ -n "$sid" ] || exit 0
stamp="$HOME/.claude/hooks/state/turn-start-$sid"

if [ "$event" = UserPromptSubmit ]; then
  # Background-task notifications arrive as prompts; keep counting from the user's request.
  [ "$notice" = true ] && exit 0
  mkdir -p "${stamp%/*}" && date +%s >"$stamp"
  exit 0
fi

[ -f "$stamp" ] || exit 0
elapsed=$(( $(date +%s) - $(cat "$stamp") ))
[ "$elapsed" -ge 60 ] || exit 0
jq -nc --arg c "elapsed ${elapsed}s since the user's last message" \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $c}}'
