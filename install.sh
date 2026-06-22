#!/usr/bin/env bash
# install.sh — bootstrap this Claude Code config onto a machine.
#
# Usage:
#   git clone <repo> /tmp/claude-setup && /tmp/claude-setup/install.sh
#   install.sh --check     # prereq report only, no mutations (safe anywhere)
#   install.sh --force     # allow adopt even if the target tree is dirty
#
# macOS-first (BSD sed assumed). Idempotent. Never installs external tools —
# it only reports what's missing. See README.md.
set -euo pipefail

FORCE=0; CHECK_ONLY=0
for a in "$@"; do case "$a" in
  --force) FORCE=1 ;; --check) CHECK_ONLY=1 ;;
  *) echo "unknown arg: $a" >&2; exit 2 ;;
esac; done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HOME/.claude"
BRANCH="main"
log() { printf '\033[1m[install]\033[0m %s\n' "$1"; }

# --- prereq check (report only) ---------------------------------------------
log "Checking prerequisites (report only — nothing is installed):"
PREREQS="git gh node rg jq codex rtk cmux wt bd"
missing=""
for t in $PREREQS; do
  if command -v "$t" >/dev/null 2>&1; then printf '  ✓ %s\n' "$t"
  else printf '  ✗ %s  (missing)\n' "$t"; missing="$missing $t"; fi
done
[ -n "$missing" ] && log "Missing:$missing — install these separately (see README)."
if [ "$CHECK_ONLY" -eq 1 ]; then log "--check done."; exit 0; fi

# --- discover repo url from this checkout -----------------------------------
REPO_URL="$(git -C "$SCRIPT_DIR" config --get remote.origin.url 2>/dev/null || true)"
if [ -z "$REPO_URL" ]; then
  log "ERROR: run this script from a clone of the config repo (no origin found at $SCRIPT_DIR)."
  exit 1
fi
log "Repo: $REPO_URL"

# --- backup any existing target ---------------------------------------------
if [ -e "$TARGET" ]; then
  BAK="$TARGET.bak-$(date +%Y%m%d-%H%M%S)"
  log "Backing up existing $TARGET -> $BAK"
  cp -a "$TARGET" "$BAK"
fi

# --- adopt the repo into $TARGET --------------------------------------------
adopt_existing_repo() {
  cd "$TARGET"
  if [ -n "$(git status --porcelain)" ] && [ "$FORCE" -eq 0 ]; then
    log "ERROR: $TARGET has uncommitted changes. Review them, or re-run with --force."
    exit 1
  fi
  git fetch origin "$BRANCH"
  git merge --ff-only "origin/$BRANCH"   # never rebases/merges over local edits
}

if [ -d "$TARGET/.git" ]; then
  existing="$(git -C "$TARGET" config --get remote.origin.url 2>/dev/null || true)"
  if [ "$existing" = "$REPO_URL" ]; then
    log "Target is already this repo — fast-forwarding."
    adopt_existing_repo
  else
    log "ERROR: $TARGET is a git repo with a different origin ($existing). Resolve manually."
    exit 1
  fi
elif [ -d "$TARGET" ]; then
  # Existing non-git ~/.claude (the common new-machine case). Adopt in place:
  # reset --hard overwrites tracked paths only; untracked state (transcripts,
  # plugins/) is preserved. The backup above is the safety net for collisions.
  log "Adopting repo into existing (non-git) $TARGET (backup taken above)."
  cd "$TARGET"
  git init -q
  git remote add origin "$REPO_URL"
  git fetch -q origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
  git branch -u "origin/$BRANCH" "$BRANCH" 2>/dev/null || true
else
  log "Cloning fresh into $TARGET"
  git clone -b "$BRANCH" "$REPO_URL" "$TARGET"
  cd "$TARGET"
fi

# --- materialize home paths via the templating filter -----------------------
# settings.json is committed with a __CLAUDE_HOME__ placeholder. Configure the
# per-machine clean/smudge filter (definition lives in local .git/config, never
# committed) and re-checkout so the working copy carries this machine's real
# ~/.claude paths in hook commands.
log "Configuring path filter and materializing settings.json for $TARGET"
git -C "$TARGET" config filter.claudehome.clean  "sed \"s#$TARGET#__CLAUDE_HOME__#g\""
git -C "$TARGET" config filter.claudehome.smudge "sed \"s#__CLAUDE_HOME__#$TARGET#g\""
rm -f "$TARGET/settings.json"
git -C "$TARGET" checkout -- settings.json

log "Done. Next steps:"
cat <<'EOF'
  1. Launch Claude Code — plugins rehydrate automatically from settings.json
     (enabledPlugins + extraKnownMarketplaces). No plugin cache is committed.
  2. Install any prereqs reported missing above.
  3. Re-authenticate MCP servers (they carry no committed credentials):
     context-mode, codegraph, serena, context7, github, linear, slack,
     sentry, buildkite, chronosphere, chrome-real, playwright, plus any
     employer-internal servers from your local settings overlay.
  4. Verify rehydration: `claude` then check /plugins and the MCP server list
     against settings.json. GoogleDrive is no longer required for skills.
EOF
