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

# The path filter writes this exact absolute path into the installed agent
# brief. Resolve relative targets before configuring the filter so the Luna
# runner command remains valid after Claude changes its working directory.
TARGET_PARENT=$(CDPATH= cd -- "$(dirname -- "$TARGET")" 2>/dev/null && pwd -P) || {
  log "ERROR: cannot resolve the target parent directory: $TARGET"
  exit 1
}
TARGET_BASE=$(basename -- "$TARGET")
[ -n "$TARGET_BASE" ] || { log 'ERROR: target path is empty.'; exit 1; }
TARGET="$TARGET_PARENT/$TARGET_BASE"

# --- prereq check (report only) ---------------------------------------------
log "Checking prerequisites (report only — nothing is installed):"
# Per-tool install hint (macOS/Homebrew-first), printed only when the tool is
# missing so the report is directly actionable.
prereq_hint() {
  case "$1" in
    git)   echo "xcode-select --install   # or: brew install git" ;;
    gh)    echo "brew install gh && gh auth login" ;;
    node)  echo "brew install fnm && fnm install --lts   # or: brew install node" ;;
    perl)  echo "xcode-select --install   # or: brew install perl" ;;
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
PREREQS="git gh node perl rg jq codex rtk cmux wt bd"
missing=""
PERL_RUNTIME=/usr/bin/perl
if [ ! -x "$PERL_RUNTIME" ]; then PERL_RUNTIME=$(command -v perl 2>/dev/null || true); fi
for t in $PREREQS; do
  if ! command -v "$t" >/dev/null 2>&1; then
    printf '  ✗ %s  (missing) — install: %s\n' "$t" "$(prereq_hint "$t")"
    missing="$missing $t"
    continue
  fi
  if [ "$t" = node ]; then
    node_version="$(node --version 2>/dev/null || true)"
    node_major="${node_version#v}"
    node_major="${node_major%%.*}"
    if ! case "$node_major" in ''|*[!0-9]*) false ;; *) [ "$node_major" -ge 20 ] && [ "$node_major" -le 24 ] ;; esac \
      || ! node -e 'process.exit(0)' >/dev/null 2>&1; then
      printf '  ✗ node  (unsupported or failed runtime; use Node 20–24 LTS, preferably 24)\n'
      missing="$missing node-runtime"
    else
      printf '  ✓ node %s (supported runtime)\n' "$node_version"
    fi
  elif [ "$t" = codex ]; then
    if [ -z "$PERL_RUNTIME" ] || ! "$PERL_RUNTIME" -e 'alarm shift; exec @ARGV' 10 codex --version >/dev/null 2>&1; then
      printf '  ✗ codex  (CLI runtime probe failed)\n'
      missing="$missing codex-runtime"
    else
      printf '  ✓ codex (CLI runtime probe passed)\n'
    fi
  else
    printf '  ✓ %s\n' "$t"
  fi
done
# The wrappers use the BSD/POSIX tools present on macOS and a Perl alarm for
# deadlines. Check them explicitly so a partial install cannot fail only after
# a review or Luna dispatch has started. GNU `timeout` is not required.
for t in awk grep id mktemp openssl pgrep ps realpath sed shasum stat tr; do
  if ! command -v "$t" >/dev/null 2>&1; then
    printf '  ✗ %s  (required by the bounded wrappers)\n' "$t"
    missing="$missing runtime-$t"
  fi
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
# settings.json and implementer instructions are committed with a
# __CLAUDE_HOME__ placeholder. Configure the
# per-machine clean/smudge filter (definition lives in local .git/config, never
# committed) and re-checkout so the working copy carries this machine's real
# ~/.claude paths in hook commands.
log "Configuring path filter and materializing home paths for $TARGET"
git -C "$TARGET" config filter.claudehome.clean  "sed \"s#$TARGET#__CLAUDE_HOME__#g\""
git -C "$TARGET" config filter.claudehome.smudge "sed \"s#__CLAUDE_HOME__#$TARGET#g\""
rm -f "$TARGET/settings.json" "$TARGET/agents/implementer.md"
git -C "$TARGET" checkout -- settings.json agents/implementer.md

# A successful checkout is not enough: a missing smudge expansion leaves the
# dispatcher with a literal placeholder and it cannot invoke Luna. Fail during
# installation while the target and its backup are still obvious to the user.
if grep -Fq '__CLAUDE_HOME__' "$TARGET/agents/implementer.md" "$TARGET/settings.json"; then
  log "ERROR: the Claude home path did not materialize in the installed routing files."
  exit 1
fi
[ -x "$TARGET/scripts/luna-run.sh" ] || {
  log "ERROR: the installed Luna runner is missing or not executable."
  exit 1
}

log "Done. Next steps:"
cat <<'EOF'
  1. Install any prerequisites reported missing above. This config never installs tools.
  2. Start a NEW Claude Code session. Model, plugin, permission, and MCP discovery are session-scoped.
  3. Confirm the policy: Opus xhigh plans, reviews, integrates, and verifies; Codex gpt-5.6-luna xhigh writes.
     `/implement` handles one coherent unit. `/build` handles structured work and allows at most three Luna implementers.
     `/review` selects mechanical, normal, or guardrail review; explicit `/council` always uses full seating.
  4. Re-authenticate only the MCP servers required on this Mac. Credentials and OAuth state are not synced.
     GitHub connector authentication is separate from terminal Git and gh authentication.
  5. Check Remote Control and required macOS permissions on this Mac.
  6. Open Design is optional. If present, verify the signed manifest artifact and configure MCP only from
     the exact signed-app-generated snippet. Do not assume bare `od` is Open Design; /usr/bin/od is Apple octal dump.
  7. Verify `/plugins`, the MCP list, `/implement`, `/build`, and `/review` after the new session starts. See docs/design-workflow.md.
EOF
