"""BW-009: AU hosting intent without apply or credentials."""

from __future__ import annotations

import unittest

from repo import exists, read


class TestAuHostingIntent(unittest.TestCase):
    def test_doc_exists_with_options_and_gaps(self):
        self.assertTrue(exists("docs/architecture/au-hosting-intent.md"))
        text = read("docs/architecture/au-hosting-intent.md")
        self.assertIn("## Options", text)
        self.assertIn("Gaps", text)
        self.assertIn("Australia", text)

    def test_no_credentials_created(self):
        text = read("docs/architecture/au-hosting-intent.md")
        for needle in ("AKIA", "BEGIN PRIVATE KEY", "aws_secret_access_key", "password="):
            self.assertNotIn(needle, text)

    def test_explicit_non_apply(self):
        text = read("docs/architecture/au-hosting-intent.md").lower()
        self.assertIn("does not create credentials", text)
        self.assertIn("non-apply", text)
        self.assertIn("do not run terraform", text)

    def test_decisions_for_owners(self):
        text = read("docs/architecture/au-hosting-intent.md")
        self.assertIn("Decisions for owners", text)
        self.assertIn("decision-log.md", text)
        adr = read("docs/adr/ADR-008.md")
        self.assertIn("au-hosting-intent.md", adr)


if __name__ == "__main__":
    unittest.main()
