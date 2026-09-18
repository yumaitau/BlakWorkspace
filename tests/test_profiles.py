"""BW-008: eval/staging/prod stubs, matrix, human gate, no secrets, knowledge flags."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

from repo import ROOT, exists, read

sys.path.insert(0, str(ROOT / "scripts"))

from blak_profiles import (  # noqa: E402
    both_knowledge_enabled,
    knowledge_flags,
    load_profile,
    parse_profile,
    validate_profiles,
)

PROFILES = ("eval", "staging", "prod")
SECRET_HINTS = ("BEGIN PRIVATE KEY", "AKIA", "ghp_", "xoxb-", "-----BEGIN RSA")


class TestEnvironmentProfiles(unittest.TestCase):
    def test_stubs_present(self):
        for name in PROFILES:
            self.assertTrue(exists(f"deploy/profiles/{name}/values.yaml"), name)

    def test_matrix_documents_differences(self):
        text = read("docs/architecture/profile-matrix.md")
        for name in PROFILES:
            self.assertIn(name, text)
        self.assertIn("human gate", text.lower())
        self.assertIn("knowledge.xwiki", text)
        self.assertIn("knowledge.docmost", text)

    def test_promotion_requires_human_gate(self):
        text = read("docs/architecture/profile-matrix.md").lower()
        self.assertIn("human gate", text)
        self.assertIn("decision-log.md", text)
        workflow = read(".github/workflows/validate.yml")
        self.assertNotIn("helmfile apply", workflow)
        self.assertNotIn("terraform apply", workflow)

    def test_no_prod_secrets_in_repo(self):
        roots = [ROOT / "deploy", ROOT / "docs", ROOT / "brand"]
        for folder in roots:
            for path in folder.rglob("*"):
                if not path.is_file() or path.suffix in {".png", ".jpg"}:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
                for hint in SECRET_HINTS:
                    self.assertNotIn(hint, text, f"{path} contains {hint}")
        gitignore = read(".gitignore")
        self.assertIn(".env", gitignore)
        self.assertIn("*.secret", gitignore)

    def test_xwiki_false_and_not_coenabled(self):
        for name in PROFILES:
            profile = load_profile(ROOT / "deploy/profiles" / name / "values.yaml")
            xwiki, _docmost = knowledge_flags(profile)
            self.assertFalse(xwiki, name)
            self.assertFalse(both_knowledge_enabled(profile), name)
        errors = validate_profiles(ROOT)
        self.assertEqual(errors, [], errors)

    def test_validate_profiles_flags_dual_enable(self):
        bad = parse_profile("knowledge:\n  xwiki: true\n  docmost: true\n")
        self.assertTrue(both_knowledge_enabled(bad))


if __name__ == "__main__":
    unittest.main()
