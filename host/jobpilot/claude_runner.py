"""Runs `claude -p` with JSON output; enforces timeout and cancellation."""
import json
import os
import signal
import subprocess
import threading
import time

EXTRA_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"


class ClaudeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _kill(proc):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=3)
            return
        except subprocess.TimeoutExpired:
            continue


def run_claude(args, prompt, *, claude_bin, cwd, timeout, cancel):
    if not claude_bin or not os.path.exists(claude_bin):
        raise ClaudeError("CLAUDE_NOT_FOUND", f"claude CLI not found at {claude_bin!r}. Re-run ./install.sh.")
    env = dict(os.environ)
    env["PATH"] = f"{os.path.dirname(claude_bin)}:{EXTRA_PATH}:{env.get('PATH', '')}"
    proc = subprocess.Popen(
        [claude_bin, "-p", "--output-format", "json", *args],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=str(cwd), env=env, text=True, start_new_session=True,
    )
    box = {}

    def communicate():
        box["stdout"], box["stderr"] = proc.communicate(prompt)

    reader = threading.Thread(target=communicate, daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout
    while reader.is_alive():
        if cancel.is_set():
            _kill(proc)
            raise ClaudeError("CANCELLED", "Cancelled.")
        if time.monotonic() > deadline:
            _kill(proc)
            raise ClaudeError("TIMEOUT", f"Claude took longer than {int(timeout)} s. Try again.")
        reader.join(0.2)

    stdout, stderr = box.get("stdout") or "", box.get("stderr") or ""
    if "No conversation found" in stdout + stderr:
        raise ClaudeError("SESSION_NOT_FOUND",
                          "That Claude session isn't available. Run `claude --resume` to list your sessions.")
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        detail = (stderr or stdout).strip()[:2000] or f"claude exited with code {proc.returncode}"
        code = "CLAUDE_ERROR" if proc.returncode else "BAD_OUTPUT"
        raise ClaudeError(code, detail)
    if data.get("is_error"):
        raise ClaudeError("CLAUDE_ERROR", str(data.get("result") or data.get("subtype") or "Claude returned an error."))
    if data.get("structured_output") is None:
        raise ClaudeError("BAD_OUTPUT", "Claude did not return structured output.")
    return data
