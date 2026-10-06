import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

from jobpilot.claude_runner import ClaudeError, run_claude

FAKE = str(Path(__file__).with_name("fake_claude.py"))


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.log = self.tmp / "log.json"
        os.environ["FAKE_CLAUDE_LOG"] = str(self.log)
        os.environ["FAKE_CLAUDE_MODE"] = "ok"
        out = self.tmp / "out.json"
        out.write_text(json.dumps({"word": "banana"}))
        os.environ["FAKE_CLAUDE_OUTPUT"] = str(out)

    def run_fake(self, timeout=10, cancel=None):
        return run_claude(["--tools", ""], "the prompt", claude_bin=FAKE, cwd=self.tmp,
                          timeout=timeout, cancel=cancel or threading.Event())

    def test_success_returns_structured_output_and_passes_args(self):
        data = self.run_fake()
        self.assertEqual(data["structured_output"], {"word": "banana"})
        self.assertEqual(data["session_id"], "fork-123")
        logged = json.loads(self.log.read_text())
        self.assertEqual(logged["argv"], ["-p", "--output-format", "json", "--tools", ""])
        self.assertEqual(logged["stdin"], "the prompt")
        self.assertEqual(os.path.realpath(logged["cwd"]), os.path.realpath(self.tmp))

    def assertCode(self, code, **kw):
        with self.assertRaises(ClaudeError) as ctx:
            self.run_fake(**kw)
        self.assertEqual(ctx.exception.code, code)
        return ctx.exception

    def test_missing_binary(self):
        with self.assertRaises(ClaudeError) as ctx:
            run_claude([], "", claude_bin="/nope/claude", cwd=self.tmp, timeout=5, cancel=threading.Event())
        self.assertEqual(ctx.exception.code, "CLAUDE_NOT_FOUND")

    def test_unknown_session(self):
        os.environ["FAKE_CLAUDE_MODE"] = "nosession"
        self.assertCode("SESSION_NOT_FOUND")

    def test_is_error_message_passed_through(self):
        os.environ["FAKE_CLAUDE_MODE"] = "is_error"
        exc = self.assertCode("CLAUDE_ERROR")
        self.assertIn("usage limit", exc.message)

    def test_garbage_output(self):
        os.environ["FAKE_CLAUDE_MODE"] = "garbage"
        self.assertCode("BAD_OUTPUT")

    def test_missing_structured_output(self):
        os.environ["FAKE_CLAUDE_MODE"] = "no_structured"
        self.assertCode("BAD_OUTPUT")

    def test_timeout_kills_process(self):
        os.environ["FAKE_CLAUDE_MODE"] = "sleep"
        start = time.monotonic()
        self.assertCode("TIMEOUT", timeout=1)
        self.assertLess(time.monotonic() - start, 8)

    def test_cancel_kills_process(self):
        os.environ["FAKE_CLAUDE_MODE"] = "sleep"
        cancel = threading.Event()
        threading.Timer(0.5, cancel.set).start()
        start = time.monotonic()
        self.assertCode("CANCELLED", cancel=cancel)
        self.assertLess(time.monotonic() - start, 8)


if __name__ == "__main__":
    unittest.main()
