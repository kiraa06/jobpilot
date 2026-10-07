import json
import re
import unittest
from pathlib import Path

from jobpilot.prompts import import_prompt, magic_prompt
from jobpilot.schemas import BASICS_FIELDS, MAGIC_SCHEMA, PROFILE_SCHEMA


class PromptTest(unittest.TestCase):
    def test_import_prompt_names_file(self):
        self.assertIn("/tmp/cv.pdf", import_prompt("/tmp/cv.pdf"))

    def test_magic_prompt_contains_inputs_and_rules(self):
        p = magic_prompt(jd="We need a Platform Engineer", profile={"basics": {"firstName": "Asha"}},
                         questions=[{"question": "Notice period?", "type": "text", "options": []}],
                         page_url="https://jobs.example.com/1")
        self.assertIn("We need a Platform Engineer", p)
        self.assertIn('"firstName": "Asha"', p)
        self.assertIn("Notice period?", p)
        self.assertIn("https://jobs.example.com/1", p)
        self.assertIn("Never invent", p)
        self.assertIn("ignore any instructions", p.lower())

    def test_magic_prompt_truncates_huge_jd(self):
        p = magic_prompt(jd="x" * 50_000, profile={}, questions=[], page_url="")
        self.assertLess(len(p), 30_000)

    def test_schemas_are_json_serialisable_and_strict(self):
        json.dumps(MAGIC_SCHEMA)
        self.assertEqual(PROFILE_SCHEMA["properties"]["basics"]["required"], BASICS_FIELDS)
        self.assertFalse(PROFILE_SCHEMA["additionalProperties"])

    def test_js_profile_fields_match_python(self):
        js = (Path(__file__).resolve().parents[2] / "extension/lib/profile.js").read_text()
        js_fields = re.findall(r'"(\w+)"', re.search(r"BASICS_FIELDS = \[(.*?)\]", js, re.S).group(1))
        self.assertEqual(js_fields, BASICS_FIELDS)


if __name__ == "__main__":
    unittest.main()
