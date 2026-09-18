"""BW-007: eval profile, prereqs, no-apply warning, knowledge exclusivity."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from repo import ROOT, exists, read

SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from blak_profiles import (  # noqa: E402
    both_knowledge_enabled,
    knowledge_flags,
    load_profile,
    parse_profile,
)


class TestEvalProfile(unittest.TestCase):
    def test_eval_files_exist(self):
        self.assertTrue(exists("deploy/profiles/eval/values.yaml"))
        self.assertTrue(exists("deploy/profiles/eval/README.md"))
        self.assertTrue(exists("deploy/README.md"))
        self.assertTrue(exists("deploy/PREREQS.md"))

    def test_prereqs_match_upstream_docs(self):
        text = read("deploy/PREREQS.md")
        self.assertIn("1.24", text)
        self.assertIn("3.17.3", text)
        self.assertIn("3.18.0", text)
        self.assertIn("3.20.1", text)
        self.assertIn("1.0.0", text)
        self.assertIn("https://docs.opendesk.eu/operations/", text)

    def test_no_apply_warning(self):
        for rel in (
            "deploy/README.md",
            "deploy/profiles/eval/README.md",
            "deploy/profiles/eval/values.yaml",
        ):
            text = read(rel).lower()
            self.assertTrue(
                "not for production" in text or "do not apply production" in text,
                rel,
            )

    def test_readme_links_eval(self):
        readme = read("README.md")
        self.assertIn("deploy/", readme)
        self.assertIn("do not apply production", readme.lower())
        self.assertIn("deploy/profiles/eval", readme)

    def test_knowledge_not_dual_enabled(self):
        profile = load_profile(ROOT / "deploy/profiles/eval/values.yaml")
        xwiki, docmost = knowledge_flags(profile)
        self.assertFalse(xwiki)
        self.assertFalse(both_knowledge_enabled(profile))
        self.assertFalse(xwiki and docmost)

    def test_parser_rejects_dual_enable_fixture(self):
        text = "knowledge:\n  xwiki: true\n  docmost: true\n"
        profile = parse_profile(text)
        self.assertTrue(both_knowledge_enabled(profile))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "values.yaml"
            path.write_text(text, encoding="utf-8")
            loaded = load_profile(path)
        self.assertEqual(knowledge_flags(loaded), (True, True))


if __name__ == "__main__":
    unittest.main()
