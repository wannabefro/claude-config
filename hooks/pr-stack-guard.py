#!/usr/bin/env python3
"""PreToolUse (Bash) — route dependent PRs through gh stack.

CLAUDE.md says multi-part work lands as a stack of dependent PRs. In the three
weeks to 2026-09-23, 34 sessions opened PRs with `gh pr create` while only 7
used gh stack. The PRs came from repo workflows (app's publish,
implement, and review skills) that call `gh pr create` themselves, so the prose
rule never got a say. This hook sits on the command every one of them runs.

It denies `gh pr create` when the branch builds on another unmerged branch and
is not in a gh stack: either `--base` names a branch other than the default, or
a local branch that is not yet in the default branch is an ancestor of HEAD.
That PR is one layer of a stack, so the stack should own it. Once the branch is
in a stack the command is allowed, which keeps CLAUDE.md's fallback for
repositories that reject `gh stack submit`. Membership is read from gh stack's
own record, `<git-common-dir>/gh-stack`, so it works for a `--head` branch that
is not checked out.

A PR straight onto the default branch is allowed. When it is wide, the hook
adds a non-blocking note suggesting a split. Anything it cannot judge (no git
repo, `--repo` pointing elsewhere, a git error) is allowed.
"""
import json
import os
import re
import shlex
import subprocess
import sys

GUARD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rm-guard.py")
PR_CREATE = re.compile(r"(?:^|[\s;&|(`])gh\s+pr\s+create\b")
CD_PREFIX = re.compile(r"^\s*cd\s+(\"[^\"]+\"|'[^']+'|\S+)\s*&&")
WIDE_FILES, WIDE_LINES = 25, 800


def git(cwd, *args):
    p = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=10)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip())
    return p.stdout.strip()


def pr_args(cmd):
    """Tokens after `gh pr create`; punctuation_chars splits `url=$(gh` so a captured call matches."""
    lex = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    try:
        toks = list(lex)
    except ValueError:
        return None
    for i in range(len(toks) - 2):
        if toks[i] == "gh" and toks[i + 1] == "pr" and toks[i + 2] == "create":
            out = []
            for t in toks[i + 3:]:
                if set(t) <= set("();<>|&`"):
                    break
                out.append(t)
            return out
    return None


def stacked_branches(cwd):
    """Every branch gh stack tracks in this repository, from its own record."""
    path = os.path.join(git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"), "gh-stack")
    try:
        data = json.load(open(path))
    except FileNotFoundError:
        return set()
    return {b["branch"] for st in data.get("stacks", []) for b in st.get("branches", [])}


def by_ancestry(cwd, default, branches):
    """Order branches from the one nearest the default branch outwards."""
    return sorted(branches, key=lambda b: int(git(cwd, "rev-list", "--count", f"{default}..{b}")))


def option(args, *names):
    for i, a in enumerate(args):
        for n in names:
            if a == n and i + 1 < len(args):
                return args[i + 1]
            if a.startswith(n + "="):
                return a.split("=", 1)[1]
    return None


def stripped(cmd):
    """The command without inert heredoc bodies, so a PR body mentioning the command does not match."""
    try:
        p = subprocess.run([sys.executable, GUARD, "--strip-heredocs", cmd],
                           capture_output=True, text=True, timeout=5)
        return p.stdout or cmd
    except Exception:
        return cmd


def verdict(cmd, cwd):
    """Return ("deny", reason), ("note", text), or None to stay silent."""
    if "gh" not in cmd:
        return None
    cmd = stripped(cmd)
    if not PR_CREATE.search(cmd):
        return None
    args = pr_args(cmd)
    if args is None or option(args, "--repo", "-R"):
        return None
    m = CD_PREFIX.match(cmd)
    if m:
        cwd = os.path.join(cwd, os.path.expanduser(m.group(1).strip("'\"")))
    if not os.path.isdir(cwd):
        return None
    head = option(args, "--head", "-H")
    branch = head.split(":", 1)[-1] if head else git(cwd, "branch", "--show-current")
    default = git(cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    default_name = default.split("/", 1)[1]
    base = option(args, "--base", "-B")
    parents = [b for b in git(cwd, "branch", "--format=%(refname:short)", "--merged", branch,
                              "--no-merged", default).splitlines() if b and b != branch]
    if base and base != default_name and base not in parents:
        parents.append(base)
    if parents:
        if branch in stacked_branches(cwd):
            return None
        parents = by_ancestry(cwd, default, parents)
        chain = " ".join(parents + [branch])
        return ("deny",
                f"`{branch}` builds on unmerged `{parents[-1]}`, so this PR is one layer of a stack, "
                f"and CLAUDE.md lands stacks with gh stack. Put the branches in a stack and submit it:\n"
                f"  gh stack init {chain}\n  gh stack submit\n"
                f"If the repository rejects `gh stack submit`, rerun this `gh pr create --base <parent>`; "
                f"it is allowed once the branches are in a stack. Assert each layer with "
                f"`git merge-base --is-ancestor <parent-tip> <child>`.")
    stat = git(cwd, "diff", "--shortstat", f"{default}...{branch}")
    nums = [int(n) for n in re.findall(r"(\d+) (?:files? changed|insertions?|deletions?)", stat)]
    files, lines = (nums[0], sum(nums[1:])) if nums else (0, 0)
    if files > WIDE_FILES or lines > WIDE_LINES:
        return ("note",
                f"This PR is wide ({files} files, {lines} lines against {default_name}). If it holds "
                f"more than one reviewable unit, CLAUDE.md prefers a stack: split the commits onto "
                f"branches and run `gh stack init <branches...>` then `gh stack submit`.")
    return None


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    try:
        v = verdict(cmd, data.get("cwd") or os.getcwd())
    except Exception:
        sys.exit(0)
    if not v:
        sys.exit(0)
    kind, text = v
    out = {"hookEventName": "PreToolUse"}
    if kind == "deny":
        out.update(permissionDecision="deny", permissionDecisionReason=text)
    else:
        out["additionalContext"] = text
    json.dump({"hookSpecificOutput": out}, sys.stdout)
    sys.exit(0)


if __name__ == "__main__":
    main()
