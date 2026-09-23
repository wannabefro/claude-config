#!/usr/bin/env python3
"""Decide whether an `rm` in a shell command targets something unrecoverable.

Replaces a substring match over the raw command string, which was backwards: it
blocked `cd <config-dir> && rm one-note.md` (recoverable, tracked) while allowing
`rm -rf .` from that same directory and the `$HOME/...` spelling of it (both
fatal), because the dangerous forms never spell the protected path literally.

This resolves each rm target to an absolute path and asks a different question:
would deleting it remove something we cannot get back?

A heredoc body is stripped before parsing only when it is provably inert text:
the delimiter is quoted (so `$(...)` does not expand), the reader is a data sink
(cat, tee, git, gh, jq, wc) that does not execute input, and nothing on the
opening line pipes the text onward. A commit message passed
via `git commit -F - <<'EOF'` would otherwise tokenise as shell: prose containing
`rm something` reads as a deletion and a later `$HOME` reads as its target. That
false positive blocked the commit introducing this guard.

Any other heredoc keeps its body: one fed to a shell, ssh, python, node or an
unknown command is code, as is `cat <<'EOF' | bash`. Stripping every body, as this once did, let a shell
heredoc hide an rm; an unterminated heredoc also swallowed the rest of the
command. bash-safety.sh calls `rm-guard.py --strip-heredocs CMD` so its own
pattern checks share this one definition.

This is a lexical guard for accidents, not a sandbox: `bash -c '...'` and eval
still hide their contents.

Usage: rm-guard.py <command> [cwd]
Exit 0 = allow. Exit 1 = block, reason on stdout. Exit 2 = could not decide.
"""
import os
import posixpath
import re
import shlex
import sys

HOME = os.path.expanduser("~")

# Guard the root, not the tree: these are tracked, so one lost file is recoverable.
ROOT_ONLY = [HOME, f"{HOME}/.claude", f"{HOME}/.codex", f"{HOME}/.config"]

# No recovery story for anything in here — guard the whole subtree.
SUBTREE = ["/etc", "/usr", "/System", "/bin", "/sbin", "/var", "/Library",
           f"{HOME}/.ssh", f"{HOME}/.gnupg", f"{HOME}/.aws", f"{HOME}/Library"]

BREAKS = {"&&", "||", ";", "|", "&"}

# These precede a command without consuming it, so `rm` after one stays in command position.
WRAPPERS = {"sudo", "env", "time", "nohup", "xargs", "command", "builtin", "exec"}


def expand(tok, cwd):
    """Expand ~ and common env forms, then resolve against cwd."""
    for var in ("$HOME", "${HOME}"):
        if tok.startswith(var):
            tok = HOME + tok[len(var):]
    tok = os.path.expanduser(tok)
    if not os.path.isabs(tok):
        tok = os.path.join(cwd, tok)
    # normpath, not realpath: realpath would resolve a symlink past the guard.
    return posixpath.normpath(tok)


HEREDOC = re.compile(r"(?<!<)<<(?!<)-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
DATA_SINKS = {"cat", "tee", "git", "gh", "jq", "wc"}
PIPE = re.compile(r"(?<!\|)\|(?!\|)")
ASSIGN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=.*")
SEGMENT = re.compile(r"\|\||&&|\$\(|[|;&(`]")


def heredoc_consumer(line, start):
    """Name the command reading the heredoc that opens at `start`, or None."""
    try:
        toks = shlex.split(SEGMENT.split(line[:start])[-1], posix=True)
    except ValueError:
        return None
    for t in toks:
        if t not in WRAPPERS and not ASSIGN.fullmatch(t):
            return os.path.basename(t)
    return None


def strip_heredocs(cmd):
    """Drop inert heredoc bodies; see the module docstring for what counts as inert."""
    lines = cmd.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        i += 1
        m = HEREDOC.search(line)
        if not m or not m.group(1) or PIPE.search(line[m.end():]):
            continue
        if heredoc_consumer(line, m.start()) not in DATA_SINKS:
            continue
        j = i
        while j < len(lines) and lines[j].strip() != m.group(2):
            j += 1
        if j < len(lines):
            i = j + 1
    return "\n".join(out)


def rm_targets(cmd, cwd):
    """Yield (raw, resolved) for each path argument of each rm invocation."""

    # A newline ends a command like ';', else an rm after a heredoc slips past.
    text = strip_heredocs(cmd).replace("\n", " ; ")
    try:
        tokens = shlex.split(text, posix=True)
    except ValueError:
        raise RuntimeError("unparseable command")
    out, i, cmd_pos = [], 0, True
    while i < len(tokens):
        t = tokens[i]
        if t in BREAKS:
            cmd_pos = True
            i += 1
            continue
        if not cmd_pos:
            # An argument, not a command — `grep -r rm .` must not look like rm.
            i += 1
            continue
        if t in WRAPPERS or t.endswith("="):
            i += 1
            continue
        if os.path.basename(t) != "rm":
            cmd_pos = False
            i += 1
            continue
        i += 1
        while i < len(tokens) and tokens[i] not in BREAKS:
            a = tokens[i]
            if not a.startswith("-"):
                out.append((a, expand(a, cwd)))
            i += 1
    return out


def verdict(path, raw):
    if path == "/":
        return "targets the filesystem root"
    base = os.path.basename(path)
    if base.startswith(".env"):
        return f"targets an env file ({raw}) - may hold secrets and is untracked"
    # A glob directly under a guarded root sweeps that root's contents.
    if any(c in raw for c in "*?["):
        parent = os.path.dirname(path)
        if parent in ROOT_ONLY or parent in SUBTREE:
            return f"glob would sweep the contents of {parent}"
    for root in ROOT_ONLY:
        if path == root:
            return f"targets {root} itself, not something inside it"
        if root.startswith(path + "/"):
            return f"targets {path}, an ancestor of {root}"
    for root in SUBTREE:
        if path == root or path.startswith(root + "/") or root.startswith(path + "/"):
            return f"targets {path}, inside or above {root} (no recovery)"
    return None


def main():
    if len(sys.argv) < 2:
        sys.exit(2)
    if sys.argv[1] == "--strip-heredocs":
        print(strip_heredocs(sys.argv[2]) if len(sys.argv) > 2 else "", end="")
        sys.exit(0)
    cmd = sys.argv[1]
    cwd = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else os.getcwd()
    try:
        targets = rm_targets(cmd, cwd)
    except RuntimeError:
        sys.exit(2)
    for raw, path in targets:
        why = verdict(path, raw)
        if why:
            shown = f"  target:  {raw}" + (f" -> {path}" if raw != path else "")
            print(f"Blocked rm: {why}.\n"
                  f"  command: {cmd}\n"
                  f"{shown}\n"
                  f"This guard protects roots and unrecoverable paths, not their "
                  f"contents — deleting files inside a tracked config repo is "
                  f"allowed. Ask the user if this deletion is really intended.")
            sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
