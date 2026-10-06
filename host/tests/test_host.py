import io
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()
