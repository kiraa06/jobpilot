#!/usr/bin/env python3
"""Stand-in for the claude CLI. Behaviour is chosen by FAKE_CLAUDE_MODE."""
import json
import os
import sys
import time

log = os.environ.get("FAKE_CLAUDE_LOG")
if log:  # pid first, so tests can watch the process before stdin is consumed
    with open(log, "w") as fh:
        json.dump({"pid": os.getpid()}, fh)
prompt = sys.stdin.read()
if log:
    with open(log, "w") as fh:
        json.dump({"pid": os.getpid(), "argv": sys.argv[1:], "stdin": prompt, "cwd": os.getcwd()}, fh)

mode = os.environ.get("FAKE_CLAUDE_MODE", "ok")
if mode == "ok":
    out = json.load(open(os.environ["FAKE_CLAUDE_OUTPUT"]))
    print(json.dumps({"type": "result", "is_error": False, "session_id": "fork-123",
                      "result": json.dumps(out), "structured_output": out}))
elif mode == "nosession":
    print("No conversation found with session ID: deadbeef", file=sys.stderr)
    sys.exit(1)
elif mode == "is_error":
    print(json.dumps({"type": "result", "is_error": True, "result": "Claude usage limit reached. Resets 5pm."}))
    sys.exit(1)
elif mode == "garbage":
    print("not json at all")
elif mode == "no_structured":
    print(json.dumps({"type": "result", "is_error": False, "result": "hello"}))
elif mode == "ok_mentions_phrase":
    out = json.load(open(os.environ["FAKE_CLAUDE_OUTPUT"]))
    print(json.dumps({"type": "result", "is_error": False, "session_id": "fork-123",
                      "result": json.dumps(out), "structured_output": out}))
elif mode == "sleep":
    time.sleep(30)
