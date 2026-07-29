#!/usr/bin/env bash
# install.sh — bootstrap this Claude Code config onto a machine.
#
# Usage:
#   git clone <repo> /tmp/claude-setup && /tmp/claude-setup/install.sh
#   install.sh --check       # prereq report only, no mutations (safe anywhere)
#   install.sh --force       # allow adopt even if the target tree is dirty
#   install.sh --target DIR  # install into DIR instead of ~/.claude
#                            # (also honors CLAUDE_HOME env; default ~/.claude)
#
# macOS-first (BSD sed assumed). Idempotent. Never installs external tools —
# it only reports what's missing. See README.md.
set -euo pipefail

FORCE=0; CHECK_ONLY=0; TARGET="${CLAUDE_HOME:-$HOME/.claude}"
while [ $# -gt 0 ]; do case "$1" in
  --force) FORCE=1 ;; --check) CHECK_ONLY=1 ;;
  --target) shift; TARGET="$1" ;;
  --target=*) TARGET="${1#*=}" ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac; shift; done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="main"
log() { printf '\033[1m[install]\033[0m %s\n' "$1"; }

# --- prereq check (report only) ---------------------------------------------
log "Checking prerequisites (report only — nothing is installed):"
# Per-tool install hint (macOS/Homebrew-first), printed only when the tool is
# missing so the report is directly actionable.
prereq_hint() {
  case "$1" in
    git)   echo "xcode-select --install   # or: brew install git" ;;
    gh)    echo "brew install gh && gh auth login" ;;
    node)  echo "brew install fnm && fnm install --lts   # or: brew install node" ;;
    rg)    echo "brew install ripgrep" ;;
    jq)    echo "brew install jq" ;;
    codex) echo "npm install -g @openai/codex" ;;
    rtk)   echo "brew install rtk   # homebrew-core; not 'cargo install rtk' (name clash)" ;;
    cmux)  echo "download the cmux desktop app (not in a package manager)" ;;
    wt)    echo "brew install worktrunk   # provides the wt shell function" ;;
    bd)    echo "see github.com/steveyegge/beads (install script) — optional" ;;
    *)     echo "see README" ;;
  esac
}
PREREQS="git gh node rg jq codex rtk cmux wt bd"
missing=""
for t in $PREREQS; do
  if command -v "$t" >/dev/null 2>&1; then printf '  ✓ %s\n' "$t"
  else printf '  ✗ %s  (missing) — install: %s\n' "$t" "$(prereq_hint "$t")"; missing="$missing $t"; fi
done
[ -n "$missing" ] && log "Missing:$missing — run the install hints shown above."
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
     sentry, chrome-real, playwright, plus any CI/observability or
     employer-internal servers configured in your local settings overlay.
  4. Verify rehydration: `claude` then check /plugins and the MCP server list
     against settings.json. GoogleDrive is no longer required for skills.
EOF
