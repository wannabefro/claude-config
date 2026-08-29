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

# Resolve one absolute, working Python 3 executable before any install
# mutation. The clean filter calls this exact path from Git.
PYTHON3_RUNTIME=""
for candidate in /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if [ -x "$candidate" ] && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then
    PYTHON3_RUNTIME="$candidate"
    break
  fi
done
if [ -z "$PYTHON3_RUNTIME" ]; then
  candidate="$(command -v python3 2>/dev/null || true)"
  if [ -n "$candidate" ] && [ "${candidate#/}" != "$candidate" ] && [ -x "$candidate" ] && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then
    PYTHON3_RUNTIME="$candidate"
  fi
fi

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
if [ -n "$PYTHON3_RUNTIME" ]; then
  printf '  ✓ python3 %s (clean-filter runtime passed)\n' "$PYTHON3_RUNTIME"
else
  printf '  ✗ python3  (absolute Python 3 runtime required by the settings clean filter)\n'
  missing="$missing python3-runtime"
fi
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

# Open Design is deliberately optional. Report the manual action without
# adding it to the core prerequisite set or attempting to install a signed GUI
# application from this configuration repository.
open_design_app=""
for candidate in "/Applications/Open Design.app" "$HOME/Applications/Open Design.app"; do
  if [ -d "$candidate" ]; then
    open_design_app="$candidate"
    break
  fi
done
if [ -n "$open_design_app" ]; then
  printf '  ✓ Open Design app present (optional) — verify its signed 0.21.0 release before use\n'

  # Read only the known Claude MCP config locations. Redirect jq output so a
  # malformed file or a config value never reaches the installer report.
  # The probe never calls `od`, `claude`, or any MCP server. A server entry
  # proves nothing unless it has a real command. Bare `od` and `/usr/bin/od`
  # are rejected because they identify Apple's octal-dump utility, not the
  # signed Open Design app.
  if ! command -v claude >/dev/null 2>&1; then
    printf '  ○ Claude CLI not found (optional) — after app setup, run: od mcp install claude\n'
  elif ! command -v jq >/dev/null 2>&1; then
    printf '  ○ Claude Open Design MCP not checked (optional) — jq is unavailable; run: od mcp install claude\n'
  else
    open_design_mcp_found=0
    open_design_mcp_unreadable=0
    for mcp_config in "$HOME/.claude.json" "$HOME/.claude/.mcp.json"; do
      [ -e "$mcp_config" ] || continue
      if [ -L "$mcp_config" ] || [ ! -f "$mcp_config" ]; then
        open_design_mcp_unreadable=1
        continue
      fi
      if jq -e '([.mcpServers? // {}, ((.projects? // {}) | to_entries[]?.value.mcpServers? // {})] | any(.[]; (."open-design" | if type != "object" then false elif (.command? | type) != "string" then false elif (.command | length) == 0 then false elif (.command | test("^[[:space:]]*$")) then false elif .command == "/usr/bin/od" or .command == "od" then false else true end)))' "$mcp_config" >/dev/null 2>&1; then
        open_design_mcp_found=1
        break
      fi
      if ! jq -e '.' "$mcp_config" >/dev/null 2>&1; then
        open_design_mcp_unreadable=1
      fi
    done
    if [ "$open_design_mcp_found" -eq 1 ]; then
      printf '  ✓ Claude Open Design MCP present (optional)\n'
    elif [ "$open_design_mcp_unreadable" -eq 1 ]; then
      printf '  ○ Claude Open Design MCP not confirmed (optional) — local config could not be read safely; run: od mcp install claude\n'
    else
      printf '  ○ Claude Open Design MCP not configured (optional) — after app setup, run: od mcp install claude\n'
    fi
  fi
else
  printf '  ○ Open Design app not found (optional) — install the signed 0.21.0 app manually, then run: od mcp install claude\n'
fi

if [ "$CHECK_ONLY" -eq 1 ]; then log "--check done."; exit 0; fi

if [ -z "$PYTHON3_RUNTIME" ]; then
  log "ERROR: an absolute working Python 3 executable is required before installation can continue."
  exit 1
fi

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
# __CLAUDE_HOME__ placeholder. Configure separate per-machine clean/smudge
# filters (definitions live in local .git/config, never committed): strict JSON
# validation and private-marketplace removal for settings, and path-only
# substitution for Markdown instructions. Clean also drops any marketplace
# that settings.local.json already defines, because the CLI can re-add private
# ones to settings.json and this repo is public.
log "Configuring path filter and materializing home paths for $TARGET"
shell_quote() {
  # Git executes filter commands through a shell. Bash's %q emits a token
  # that keeps spaces, apostrophes, and other shell metacharacters literal.
  printf '%q' "$1"
}
settings_clean_filter="$(shell_quote "$PYTHON3_RUNTIME") $(shell_quote "$TARGET/scripts/settings-clean.py") $(shell_quote "$TARGET")"
path_clean_filter="$(shell_quote "$PYTHON3_RUNTIME") $(shell_quote "$TARGET/scripts/path-clean.py") $(shell_quote "$TARGET")"
path_smudge_filter="$(shell_quote "$PYTHON3_RUNTIME") $(shell_quote "$TARGET/scripts/path-clean.py") --smudge $(shell_quote "$TARGET")"
git -C "$TARGET" config filter.claudesettings.clean "$settings_clean_filter"
git -C "$TARGET" config filter.claudesettings.smudge "$path_smudge_filter"
git -C "$TARGET" config filter.claudesettings.required true
git -C "$TARGET" config filter.claudehome.clean "$path_clean_filter"
git -C "$TARGET" config filter.claudehome.smudge "$path_smudge_filter"
git -C "$TARGET" config filter.claudehome.required true

# Exercise the configured clean filter through Git before touching tracked
# files. This catches missing executables, bad quoting, malformed tracked
# settings, and any absolute home path that could enter the public repository.
filter_probe="$(mktemp "${TMPDIR:-/tmp}/claude-settings-filter.XXXXXXXX")"
filter_probe_expected="$(mktemp "${TMPDIR:-/tmp}/claude-settings-filter-expected.XXXXXXXX")"
materialization_tx=""
materialization_committed=0
install_cleanup() {
  local saved_status=$?
  set +e
  if [ -n "${materialization_tx:-}" ] && [ "$materialization_committed" -eq 0 ]; then
    materialization_restore
  fi
  rm -f "$filter_probe" "$filter_probe_expected"
  [ -z "${materialization_tx:-}" ] || rm -rf "$materialization_tx"
  return "$saved_status"
}
trap install_cleanup EXIT
printf '{"hooks":{"probe":"%s/hooks/verify"},"extraKnownMarketplaces":{"probe-public":{"source":"github","repo":"example/public"}}}\n' "$TARGET" > "$filter_probe"
if ! "$PYTHON3_RUNTIME" "$TARGET/scripts/settings-clean.py" "$TARGET" < "$filter_probe" > "$filter_probe_expected"; then
  log "ERROR: the settings clean filter rejected its valid probe input."
  exit 1
fi
if ! actual_filter_oid="$(git -C "$TARGET" hash-object --path=settings.json --stdin < "$filter_probe")"; then
  log "ERROR: Git could not run the required settings clean filter."
  exit 1
fi
if ! expected_filter_oid="$(git -C "$TARGET" hash-object --no-filters "$filter_probe_expected")"; then
  log "ERROR: Git could not hash the expected cleaned settings probe."
  exit 1
fi
if [ "$actual_filter_oid" != "$expected_filter_oid" ]; then
  log "ERROR: Git clean filtering does not match the validated public settings output."
  exit 1
fi
if grep -Fq "$TARGET" "$filter_probe_expected" || ! grep -Fq '__CLAUDE_HOME__' "$filter_probe_expected"; then
  log "ERROR: the settings clean filter did not strip the machine path."
  exit 1
fi

# Back up the exact pair before checkout. A failed filter, checkout, or
# materialization must restore both files as a pair, including their prior
# absence; no partially materialized routing files may survive an install.
materialization_tx="$(mktemp -d "${TMPDIR:-/tmp}/claude-materialize.XXXXXXXX")"
materialization_restore() {
  local relative target_file state_file backup_file state
  for relative in settings.json agents/implementer.md; do
    target_file="$TARGET/$relative"
    state_file="$materialization_tx/${relative//\//_}.state"
    backup_file="$materialization_tx/${relative//\//_}.backup"
    [ -f "$state_file" ] || continue
    state="$(cat "$state_file")"
    rm -f "$target_file"
    if [ "$state" = present ]; then
      cp -p "$backup_file" "$target_file"
    fi
  done
}
for relative in settings.json agents/implementer.md; do
  target_file="$TARGET/$relative"
  state_file="$materialization_tx/${relative//\//_}.state"
  backup_file="$materialization_tx/${relative//\//_}.backup"
  if [ -f "$target_file" ]; then
    printf 'present\n' > "$state_file"
    cp -p "$target_file" "$backup_file"
  elif [ -e "$target_file" ] || [ -L "$target_file" ]; then
    log "ERROR: expected installed routing path is not a regular file: $relative"
    exit 1
  else
    printf 'absent\n' > "$state_file"
  fi
done

rm -f "$TARGET/settings.json" "$TARGET/agents/implementer.md"
if ! git -C "$TARGET" checkout -- settings.json agents/implementer.md; then
  log "ERROR: the Claude routing files could not be materialized; prior files were restored."
  exit 1
fi

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
if ! routing_status="$(git -C "$TARGET" status --porcelain -- settings.json agents/implementer.md)"; then
  log "ERROR: could not verify that materialized routing files are clean."
  exit 1
elif [ -n "$routing_status" ]; then
  log "ERROR: materialized routing files left the target repository dirty."
  exit 1
fi
materialization_committed=1

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
  6. Open Design is optional. Install its signed 0.21.0 app manually, then run `od mcp install claude` from
     the Open Design CLI. Do not assume bare `od` is Open Design; /usr/bin/od is Apple octal dump.
  7. Verify `/plugins`, the MCP list, `/implement`, `/build`, and `/review` after the new session starts. See docs/design-workflow.md.
EOF
