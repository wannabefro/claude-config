#!/usr/bin/env bash
# Is the Workflow tool actually available in this session?
#
#   workflow-available.sh [script-name.js]
#
#   exit 0  available — the caller may invoke Workflow
#   exit 1  disabled by managed policy — take the fallback path, do not retry
#   exit 2  available in principle, but the named script is missing
#
# Why this exists. `allow_workflows: {allowed: false}` in the server-delivered
# ~/.claude/policy-limits.json removes the Workflow tool from the tool set
# ENTIRELY — it is not registered, not deferred, and ToolSearch cannot find it.
# Nothing local overrides that: listing "Workflow" under settings.json
# permissions grants approval, not registration, and the workflow scripts being
# present on disk proves nothing. Measured 2026-07-30 on CLI 2.1.220, where the
# tool and its full schema are in the binary — so a missing tool is policy, and
# hunting for a bad install wastes the turn.
#
# policy-limits.json is untracked, gitignored and re-delivered by the
# administrator. Never edit it to work around this.
set -uo pipefail

POLICY="$HOME/.claude/policy-limits.json"
SCRIPT="${1:-}"

if [ -f "$POLICY" ]; then
  allowed=$(python3 -c "
import json,sys
try:
    d=json.load(open('$POLICY'))
    print(d.get('restrictions',{}).get('allow_workflows',{}).get('allowed', True))
except Exception:
    print(True)
" 2>/dev/null)
  if [ "$allowed" = "False" ]; then
    echo "workflow-available: DISABLED by managed policy (allow_workflows=false in $POLICY)." >&2
    echo "workflow-available: the Workflow tool is not registered — take the fallback path." >&2
    echo "workflow-available: only an administrator can change this. Do not edit the policy file." >&2
    exit 1
  fi
fi

if [ -n "$SCRIPT" ] && [ ! -f "$HOME/.claude/workflows/$SCRIPT" ]; then
  echo "workflow-available: policy allows workflows, but ~/.claude/workflows/$SCRIPT is missing." >&2
  exit 2
fi

echo "workflow-available: OK"
exit 0
