#!/usr/bin/env python3
"""Stop pantsd daemons whose worktree nothing is using any more.

Every k-repo worktree that ever ran pants keeps its own pantsd, 200MB-3GB each,
alive until reboot. On 2026-09-23 eight ran at once on a machine at load 30+,
three of them in worktrees no process had open. A daemon counts as idle when it
is older than MIN_AGE and no other process has its working directory inside the
daemon's build root, the nearest ancestor holding pants.toml. Agent worktrees
nest inside k-repo, so a shell in one holds that worktree's daemon, not k-repo's. Pants starts a fresh daemon on the next call there, so the
only cost of a wrong guess is one cold start (about 20-40s).

Run from SessionStart, detached. Usage: pantsd-reap.py [--dry-run]
"""
import os
import re
import signal
import subprocess
import sys
import time

MIN_AGE = 30 * 60
PANTS_PROCS = {"pantsd", "pants", "scie-pants", "python3", "python3.9", "python3.11"}
LOG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "pantsd-reap.log")


def seconds(etime):
    """Parse ps etime ([[dd-]hh:]mm:ss) into seconds."""
    days, _, rest = etime.rpartition("-")
    parts = [int(p) for p in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return int(days or 0) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]


def daemons():
    out = subprocess.run(["ps", "-Ao", "pid=,etime=,command="], capture_output=True, text=True).stdout
    for line in out.splitlines():
        m = re.match(r"\s*(\d+)\s+(\S+)\s+pantsd \[([^\]]+)\]", line)
        if m:
            yield int(m.group(1)), seconds(m.group(2)), m.group(3).strip()


def cwds():
    out = subprocess.run(["lsof", "-a", "-d", "cwd", "-Fpcn"], capture_output=True, text=True).stdout
    pid = cmd = None
    for line in out.splitlines():
        if line[:1] == "p":
            pid = int(line[1:])
        elif line[:1] == "c":
            cmd = line[1:]
        elif line[:1] == "n":
            yield pid, cmd, line[1:]


def build_root(path, _cache={}):
    """The nearest ancestor holding pants.toml; a nested worktree has its own daemon, not its parent's."""
    if path not in _cache:
        d = path
        while d != "/" and not os.path.isfile(os.path.join(d, "pants.toml")):
            d = os.path.dirname(d)
        _cache[path] = d
    return _cache[path]


def main():
    dry = "--dry-run" in sys.argv
    found = [d for d in daemons() if d[1] >= MIN_AGE]
    if not found:
        return
    held = {build_root(d) for p, c, d in cwds() if c not in PANTS_PROCS}
    stopped = []
    for pid, age, root in found:
        if root in held:
            continue
        if not dry:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                continue
        stopped.append(f"{pid} up {age // 60}m {root}")
    if stopped:
        verb = "would stop" if dry else "stopped"
        lines = [f"{time.strftime('%Y-%m-%d %H:%M:%S')} {verb} {s}" for s in stopped]
        if dry:
            print("\n".join(lines))
        else:
            os.makedirs(os.path.dirname(LOG), exist_ok=True)
            with open(LOG, "a") as fh:
                fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
