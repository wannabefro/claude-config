#!/usr/bin/env python3
"""PreToolUse hook — block tool calls that cross the session's git worktree boundary.

Exit 2 = block (message surfaced to the model via stderr).
Exit 0 = allow.
"""
import json
import os
import re
import subprocess
import sys


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input", {}) or {}

    session_dir = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    try:
        root = subprocess.check_output(
            ["git", "-C", session_dir, "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2,
        ).strip()
    except Exception:
        sys.exit(0)

    root = os.path.realpath(root)
    home = os.path.expanduser("~")
    safelist_prefixes = (
        "/tmp/",
        "/var/folders/",
        "/private/tmp/",
        "/private/var/",
        "/dev/",
        "/proc/",
        f"{home}/.claude/",
        f"{home}/.codex/",
        f"{home}/.config/",
        f"{home}/.cache/",
        f"{home}/Library/LaunchAgents/",
        f"{home}/Library/Logs/",
        # docs/plans is a symlink into iCloud, and resolve() calls realpath(), so a
        # plan read lands here rather than under the repo root. Without this every
        # Read/Edit of a plan is blocked in every repo. Deliberately shared: the
        # plan store is per-repo inside, so this is not a cross-worktree crossing.
        f"{home}/Library/Mobile Documents/com~apple~CloudDocs/claude-plans/",
    )

    def is_safe(p: str) -> bool:
        return any(p.startswith(pref) for pref in safelist_prefixes) or p == root

    def resolve(p: str) -> str:
        if not os.path.isabs(p):
            p = os.path.join(session_dir, p)
        try:
            real = os.path.realpath(p)
        except Exception:
            real = os.path.abspath(p)
        return os.path.normpath(real)

    def in_root(p: str) -> bool:
        return p == root or p.startswith(root + os.sep)

    def block(msg: str) -> None:
        sys.stderr.write(f"worktree-boundary: {msg}\n")
        sys.exit(2)

    if tool in ("Edit", "Write", "Read", "NotebookEdit", "MultiEdit"):
        fp = (
            tool_input.get("file_path")
            or tool_input.get("notebook_path")
            or tool_input.get("path")
        )
        if not fp:
            sys.exit(0)
        abs_p = resolve(fp)
        if in_root(abs_p) or is_safe(abs_p):
            sys.exit(0)
        block(
            f"{tool} target is outside session worktree.\n"
            f"  session root: {root}\n"
            f"  target:       {abs_p}\n"
            f"Another Claude session or the user may be editing there. "
            f"Ask the user before crossing worktree boundaries."
        )

    if tool == "Bash":
        cmd = tool_input.get("command", "") or ""
        # `prune` was blocked alongside `remove` and `move` until 2026-07-28. It
        # does not belong with them: prune deletes no directory and no branch. It
        # removes administrative records under .git/worktrees for directories that
        # are ALREADY gone, and it skips locked entries — verified in a scratch
        # repo, where prune kept both a live worktree and a locked one whose
        # directory had been deleted. Blocking it made /cleanup impossible to
        # finish: the script removes a worktree, then cannot tidy the record.
        #
        # `--expire` stays blocked. It reaps records whose directory merely failed
        # to stat, so an unmounted volume turns a live worktree into a pruned one.
        if re.search(r"\bgit\s+worktree\s+prune\b", cmd) and re.search(r"--expire\b", cmd):
            block(
                "git worktree prune --expire can reap a live worktree whose directory "
                "is momentarily unreachable. Use plain `git worktree prune`."
            )
        if re.search(r"\bgit\s+worktree\s+(remove|move)\b", cmd):
            block(
                "git worktree remove/move can destroy another session's state.\n"
                "Use ~/.claude/scripts/clean-build-worktrees.sh (or /cleanup), which "
                "compares file content against the main tree and keeps anything that "
                "still differs. Agents leave work uncommitted, so branch ancestry "
                "calls an entire unmerged unit 'already merged'."
            )

        # A target the shell expands at runtime ($d, a glob, a backtick) cannot be
        # resolved here. Until 2026-07-28 resolve() joined it onto the session dir,
        # so the SAME command was allowed from ~/.claude — the join landed under a
        # safelisted prefix — and blocked from any project repo. /cleanup documents
        # a `for d in ~/dev/*/ ... git -C "$d" worktree list` loop, which therefore
        # worked or failed purely by where the session happened to start.
        #
        # An unresolvable target now decides on the verb, not on the path: a read
        # is allowed, a mutation is blocked. A read cannot damage another session,
        # which is the whole thing this hook exists to prevent.
        mutating = re.compile(
            r"\b(commit|push|reset|checkout|restore|clean|rm|merge|rebase|stash|apply|"
            r"cherry-pick|revert|worktree|branch|tag|switch|gc|filter-branch)\b"
        )
        for m in re.finditer(r"\bgit\s+-C\s+(\S+)((?:\s+\S+)*)", cmd):
            target = m.group(1).strip("'\"")
            rest = m.group(2) or ""
            if re.search(r"[$*?`]", target):
                if mutating.search(rest) and not re.search(r"\bworktree\s+(list|lock)\b", rest):
                    block(
                        f"git -C targets a path this hook cannot resolve, and the command "
                        f"mutates state.\n"
                        f"  target:  {target}\n"
                        f"Expand the path yourself, or read first and act on a literal path."
                    )
                continue
            abs_p = resolve(target)
            if not in_root(abs_p) and not is_safe(abs_p):
                block(
                    f"git -C targets path outside session worktree.\n"
                    f"  session root: {root}\n"
                    f"  target:       {abs_p}"
                )

    sys.exit(0)


if __name__ == "__main__":
    main()
