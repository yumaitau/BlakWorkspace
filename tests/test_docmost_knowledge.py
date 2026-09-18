"""BW-055: Docmost Knowledge, default-deny, capability matrix, ADR-010."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from repo import ROOT, exists, read

sys.path.insert(0, str(ROOT / "scripts"))

from blak_profiles import (  # noqa: E402
    both_knowledge_enabled,
    knowledge_flags,
    load_profile,
    parse_profile,
    public_unauthenticated_knowledge,
    validate_profiles,
)


class TestDocmostKnowledge(unittest.TestCase):
    def test_supported_knowledge_profile_is_docmost_not_xwiki(self):
        path = ROOT / "deploy/profiles/eval/knowledge-docmost.example.yaml"
        self.assertTrue(path.is_file())
        profile = load_profile(path)
        xwiki, docmost = knowledge_flags(profile)
        self.assertFalse(xwiki)
        self.assertTrue(docmost)
        self.assertFalse(public_unauthenticated_knowledge(profile))
        self.assertFalse(both_knowledge_enabled(profile))

    def test_default_profiles_default_deny(self):
        for name in ("eval", "staging", "prod"):
            profile = load_profile(ROOT / "deploy/profiles" / name / "values.yaml")
            xwiki, _docmost = knowledge_flags(profile)
            self.assertFalse(xwiki, name)
            self.assertFalse(public_unauthenticated_knowledge(profile), name)
            self.assertIn("allowPublicUnauthenticated", profile["knowledge"])
            self.assertFalse(profile["knowledge"]["allowPublicUnauthenticated"], name)
        self.assertEqual(validate_profiles(ROOT), [])

    def test_public_unauth_fails_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("eval", "staging", "prod"):
                folder = root / "deploy/profiles" / name
                folder.mkdir(parents=True)
                folder.joinpath("values.yaml").write_text(
                    "knowledge:\n  xwiki: false\n  docmost: false\n"
                    "  allowPublicUnauthenticated: true\n",
                    encoding="utf-8",
                )
            errors = validate_profiles(root)
        self.assertTrue(any("public unauthenticated" in e for e in errors), errors)

    def test_dual_enable_fails_validation(self):
        profile = parse_profile("knowledge:\n  xwiki: true\n  docmost: true\n")
        self.assertTrue(both_knowledge_enabled(profile))

    def test_adr_licence_pin_sso(self):
        self.assertTrue(exists("docs/adr/ADR-010.md"))
        text = read("docs/adr/ADR-010.md")
        self.assertIn("Status: Accepted", text)
        self.assertIn("Docmost", text)
        self.assertIn("XWiki", text)
        self.assertIn("licence", text.lower())
        self.assertIn("digest", text.lower())
        self.assertIn("OIDC", text)
        self.assertIn("Nubus", text)

    def test_capability_matrix_not_xwiki_backend(self):
        text = read("docs/architecture/capability-matrix.md")
        self.assertIn("Docmost", text)
        self.assertIn("XWiki is **not** an enabled Blak Knowledge backend", text)
        knowledge_lines = [ln for ln in text.splitlines() if "| Knowledge" in ln]
        self.assertTrue(any("Docmost" in ln for ln in knowledge_lines))
        self.assertTrue(any("XWiki" in ln and "migration" in ln.lower() for ln in knowledge_lines))

    def test_portal_label_blak_knowledge(self):
        portal = read("deploy/overlays/blak/portal-labels.example.yaml")
        self.assertIn("Blak Knowledge", portal)
        self.assertIn("id: docmost", portal)
        notices = read("THIRD_PARTY_NOTICES.md")
        self.assertIn("Docmost", notices)
        self.assertIn("TBD", notices)

    def test_docs_say_docmost_not_xwiki(self):
        for rel in (
            "README.md",
            "docs/assumptions.md",
            "docs/runbooks/docmost.md",
            "docs/backlog/issues/BW-034.md",
        ):
            text = read(rel)
            self.assertIn("Docmost", text, rel)


if __name__ == "__main__":
    unittest.main()
