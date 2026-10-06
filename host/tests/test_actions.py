import base64
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from jobpilot import actions
from tests.test_truth import ORIGINAL

FAKE = str(Path(__file__).with_name("fake_claude.py"))
SID = "f6c115bd-98ae-4b8e-8a2e-7b54b5580e52"


class ActionsTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.cfg = {"claudeBin": FAKE, "home": self.home}
        self.log = self.home / "fake.log"
        self.patcher = mock.patch.dict(os.environ)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        os.environ.update(FAKE_CLAUDE_MODE="ok", FAKE_CLAUDE_LOG=str(self.log))

    def fake_output(self, obj):
        path = self.home / "out.json"
        path.write_text(json.dumps(obj))
        os.environ["FAKE_CLAUDE_OUTPUT"] = str(path)

    def call(self, action, payload):
        return actions.handle({"action": action, "payload": payload}, self.cfg, threading.Event())

    def test_normalize_session_id(self):
        self.assertEqual(actions.normalize_session_id(f"  claude --resume {SID.upper()}\n"), SID)
        self.assertEqual(actions.normalize_session_id(SID), SID)
        self.assertIsNone(actions.normalize_session_id("my-session"))
        self.assertIsNone(actions.normalize_session_id(None))

    def test_import_cv_runs_claude_with_read_tool_and_cleans_up(self):
        self.fake_output(ORIGINAL)
        res = self.call("import_cv", {"pdfBase64": base64.b64encode(b"%PDF-1.7 fake").decode(), "fileName": "cv.pdf"})
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["data"]["profile"]["basics"]["firstName"], "Asha")
        argv = json.loads(self.log.read_text())["argv"]
        self.assertIn("Read", argv)
        self.assertIn("--json-schema", argv)
        self.assertNotIn("--resume", argv)
        self.assertEqual(list((self.home / "imports").glob("*.pdf")), [], "temp PDF must be deleted")

    def test_import_rejects_non_pdf(self):
        res = self.call("import_cv", {"pdfBase64": base64.b64encode(b"hello").decode()})
        self.assertEqual(res["error"]["code"], "BAD_REQUEST")

    def magic_payload(self, **over):
        p = {"sessionId": SID, "jd": "Platform Engineer at Initech. " * 20, "profile": ORIGINAL,
             "questions": [{"question": "Notice period?", "type": "text", "options": []}],
             "pageUrl": "https://jobs.example.com/1"}
        p.update(over)
        return p

    def test_magic_edit_forks_session_without_tools_and_checks_truth(self):
        tailored = json.loads(json.dumps(ORIGINAL))
        tailored["basics"]["email"] = "changed@x.com"
        tailored["experience"].append({"company": "Google", "title": "SRE", "start": "2014", "end": "2015",
                                       "location": "", "bullets": []})
        self.fake_output({"company": "Initech", "role": "Platform Engineer", "tailoredProfile": tailored,
                          "changeSummary": ["Summary rewritten"],
                          "answers": [{"question": "Notice period?", "answer": "30 days", "sensitive": True}],
                          "unverifiedClaims": []})
        res = self.call("magic_edit", self.magic_payload())
        self.assertTrue(res["ok"], res)
        data = res["data"]
        self.assertEqual(data["tailoredProfile"]["basics"]["email"], "asha@example.com")
        self.assertEqual(len(data["truth"]["blocking"]), 1)
        self.assertEqual(data["forkSessionId"], "fork-123")
        logged = json.loads(self.log.read_text())
        argv = logged["argv"]
        self.assertEqual(argv[argv.index("--resume") + 1], SID)
        self.assertIn("--fork-session", argv)
        self.assertEqual(argv[argv.index("--tools") + 1], "")
        self.assertEqual(os.path.realpath(logged["cwd"]), os.path.realpath(self.home))
        self.assertIn("Notice period?", logged["stdin"])

    def test_magic_edit_validates_input(self):
        self.assertEqual(self.call("magic_edit", self.magic_payload(sessionId="nope"))["error"]["code"], "BAD_REQUEST")
        self.assertEqual(self.call("magic_edit", self.magic_payload(jd="  "))["error"]["code"], "BAD_REQUEST")

    def test_magic_edit_session_not_found(self):
        os.environ["FAKE_CLAUDE_MODE"] = "nosession"
        self.assertEqual(self.call("magic_edit", self.magic_payload())["error"]["code"], "SESSION_NOT_FOUND")

    def test_unknown_action(self):
        self.assertEqual(self.call("explode", {})["error"]["code"], "UNKNOWN_ACTION")


if __name__ == "__main__":
    unittest.main()
