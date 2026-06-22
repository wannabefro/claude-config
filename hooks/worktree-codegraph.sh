# PostToolUse:EnterWorktree — give a new git worktree its own CodeGraph index.
#
# .codegraph/ is gitignored and lives only where `codegraph init` was run, so a
# fresh worktree has no index and the MCP server reports "not initialized".
# CodeGraph stores repo-RELATIVE paths, so the main worktree's DB is a valid
# seed for any worktree of the same repo: copy it (a self-consistent WAL
# snapshot) then `sync` to reconcile only the files that differ — far cheaper
# than a full `init --index`.
#
# Repo-agnostic: acts only when codegraph is installed AND the repo's main
# worktree already has an index (i.e. codegraph is actually used for this repo).
set -euo pipefail

command -v codegraph >/dev/null 2>&1 || exit 0

worktree_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Already indexed → nothing to do.
[ -e "$worktree_root/.codegraph/codegraph.db" ] && exit 0

# Resolve the main worktree root: parent of the shared .git common dir.
common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
case "$common_dir" in
  /*) ;;                                   # already absolute (linked worktree)
  *) common_dir="$worktree_root/$common_dir" ;;
esac
main_root=$(cd "$common_dir/.." 2>/dev/null && pwd) || exit 0

main_db="$main_root/.codegraph/codegraph.db"

# Only auto-manage codegraph for repos that already use it.
[ -f "$main_db" ] || exit 0
[ "$main_root" = "$worktree_root" ] && exit 0   # we ARE the main worktree

mkdir -p "$worktree_root/.codegraph"
[ -f "$main_root/.codegraph/.gitignore" ] &&
  cp "$main_root/.codegraph/.gitignore" "$worktree_root/.codegraph/.gitignore" 2>/dev/null || true

# Copy only the main DB file (a consistent snapshot); skip -wal/-shm and any
# stale lock/dirty marker so the copy opens cleanly in this worktree.
if cp "$main_db" "$worktree_root/.codegraph/codegraph.db" 2>/dev/null; then
  rm -f "$worktree_root/.codegraph/.dirty" "$worktree_root"/.codegraph/*.lock 2>/dev/null || true
  # Reconcile the seeded index against this worktree's actual file contents.
  if codegraph sync "$worktree_root" >/dev/null 2>&1; then
    exit 0
  fi
fi

# Seed unusable or sync failed → rebuild a fresh index from scratch.
rm -rf "$worktree_root/.codegraph" 2>/dev/null || true
codegraph init --index "$worktree_root" >/dev/null 2>&1 || true
