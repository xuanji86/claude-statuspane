"""Report a progress row to claude-statuspane from Python.

    from report_progress import report, clear
    for i, item in enumerate(items, 1):
        work(item)
        report("my-job", "my job", 100 * i / len(items), f"{i}/{len(items)}")
    clear("my-job")
"""
from __future__ import annotations

import json
import os
import tempfile

DIR = os.path.expanduser(os.environ.get("STATUSPANE_PROGRESS_DIR", "~/.claude/statuspane/progress"))


def report(id: str, label: str, percent: float | None = None, text: str = "", ttl: int = 300) -> None:
    os.makedirs(DIR, exist_ok=True)
    item = {"label": label, "text": text, "ttl": ttl}
    if percent is not None:
        item["percent"] = percent
    fd, tmp = tempfile.mkstemp(dir=DIR, prefix=f".{id}.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(item, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(DIR, f"{id}.json"))  # atomic


def clear(id: str) -> None:
    try:
        os.remove(os.path.join(DIR, f"{id}.json"))
    except FileNotFoundError:
        pass
