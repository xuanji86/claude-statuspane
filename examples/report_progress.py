"""Report a progress row to claude-statuspane from Python.

    from report_progress import report, clear
    for i, item in enumerate(items, 1):
        work(item)
        report("my-job", "my job", 100 * i / len(items), f"{i}/{len(items)}")
    clear("my-job")

Or from a shell:  python3 report_progress.py <id> <label> [percent] [text] [ttl-seconds] [state]
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile

DEFAULT_DIR = "~/.claude/statuspane/progress"
ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
STATES = ("running", "ok", "error")  # Claude's accent, green, red


def progress_dir() -> str:
    """STATUSPANE_PROGRESS_DIR when it is set to an absolute (or ~) path, else the default; read on each call."""
    custom = os.path.expanduser(os.environ.get("STATUSPANE_PROGRESS_DIR") or "")
    return custom if os.path.isabs(custom) else os.path.expanduser(DEFAULT_DIR)


def report(id: str, label: str, percent: float | None = None, text: str = "", ttl: int = 300, state: str | None = None) -> None:
    if not ID.match(id):
        raise ValueError(f"progress id must be 1-64 of letters, digits, '.', '_' or '-': {id!r}")
    if state is not None and state not in STATES:
        raise ValueError(f"state must be one of {', '.join(STATES)}: {state!r}")
    folder = progress_dir()
    os.makedirs(folder, exist_ok=True)
    item = {"label": label[:24], "text": text[:60], "ttl": int(ttl)}
    if percent is not None:
        item["percent"] = float(percent)
    if state:
        item["state"] = state
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=f".{id}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(item, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(folder, f"{id}.json"))  # atomic: the card never reads half a file
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def clear(id: str) -> None:
    if not ID.match(id):
        return
    try:
        os.remove(os.path.join(progress_dir(), f"{id}.json"))
    except FileNotFoundError:
        pass


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: report_progress.py <id> <label> [percent] [text] [ttl-seconds] [state]")
    args = sys.argv[1:] + [""] * 4
    try:
        report(args[0], args[1], float(args[2]) if args[2] else None, args[3], int(args[4]) if args[4] else 300, args[5] or None)
    except ValueError as e:
        sys.exit(f"report_progress: {e}")
