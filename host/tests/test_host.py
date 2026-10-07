import io
import json
import os
import signal
import struct
import subprocess
import sys
import tempfile
import unittest
import time
from pathlib import Path

FAKE = str(Path(__file__).with_name("fake_claude.py"))
SID = "00000000-0000-4000-8000-000000000000"


def _alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:  # a zombie still answers kill(0); ask ps for its state
        state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    except OSError:
        return True
    return bool(state) and not state.startswith("Z")


class HostTest(unittest.TestCase):
    def _run_host(self, action, temp_home=None, config_content=None):
        """Run host as subprocess with optional temp home and config."""
        with tempfile.TemporaryDirectory() as tmpdir:
            home = temp_home or tmpdir
            if config_content is not None:
                config_path = Path(home) / "config.json"
                config_path.parent.mkdir(parents=True, exist_ok=True)
                config_path.write_text(config_content)

            msg = json.dumps({"action": action}).encode()
            frame = struct.pack("=I", len(msg)) + msg

            env = {"JOBPILOT_HOME": home}
            p = subprocess.run(
                [sys.executable, "host/jobpilot_host.py"],
                input=frame,
                capture_output=True,
                env=env,
            )

            if not p.stdout or len(p.stdout) < 4:
                return None

            n = struct.unpack("=I", p.stdout[:4])[0]
            return json.loads(p.stdout[4:4+n])

    def test_ping_with_valid_home(self):
        """Ping with valid temp home should succeed with version 0.1.0."""
        res = self._run_host("ping")
        self.assertIsNotNone(res)
        self.assertTrue(res["ok"])
        self.assertEqual(res["data"]["version"], "0.1.0")

    def test_ping_with_corrupt_config(self):
        """Ping with invalid config.json should return HOST_ERROR, not crash."""
        res = self._run_host("ping", config_content="invalid json {")
        self.assertIsNotNone(res)
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"]["code"], "HOST_ERROR")
        self.assertIn("JSONDecodeError", res["error"]["message"])

    def test_sigterm_kills_running_claude(self):
        """Chromium SIGTERMs the host on port disconnect; the claude child must not outlive it."""
        with tempfile.TemporaryDirectory() as home:
            log = Path(home) / "fake.log"
            (Path(home) / "config.json").write_text(json.dumps({"claudeBin": FAKE}))
            env = dict(os.environ, JOBPILOT_HOME=home, FAKE_CLAUDE_MODE="sleep", FAKE_CLAUDE_LOG=str(log))
            host = subprocess.Popen([sys.executable, "host/jobpilot_host.py"], stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
            pid = None
            try:
                msg = json.dumps({"action": "magic_edit", "payload": {
                    "sessionId": SID, "jd": "Platform Engineer " * 20, "profile": {"basics": {}}}}).encode()
                host.stdin.write(struct.pack("=I", len(msg)) + msg)
                host.stdin.flush()
                deadline = time.monotonic() + 10
                while pid is None and time.monotonic() < deadline:
                    try:
                        pid = json.loads(log.read_text())["pid"]
                    except (OSError, ValueError, KeyError):
                        time.sleep(0.05)
                self.assertIsNotNone(pid, "fake claude never started")
                self.assertTrue(_alive(pid))
                host.send_signal(signal.SIGTERM)
                host.wait(timeout=10)
                deadline = time.monotonic() + 5
                while _alive(pid) and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertFalse(_alive(pid), "claude child outlived the host")
            finally:
                if host.poll() is None:
                    host.kill()
                if pid and _alive(pid):
                    os.kill(pid, signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
