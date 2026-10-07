import json
import os
import shutil
from pathlib import Path


def home() -> Path:
    return Path(os.environ.get("JOBPILOT_HOME", Path.home() / ".jobpilot"))


def load() -> dict:
    root = home()
    cfg = {}
    path = root / "config.json"
    if path.exists():
        cfg = json.loads(path.read_text())
    claude_bin = cfg.get("claudeBin") or shutil.which("claude")
    return {"claudeBin": claude_bin, "home": root}
