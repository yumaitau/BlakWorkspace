"""BW-003: NOTICE, third-party inventory, gaps, README attribution, Knowledge stance."""

from __future__ import annotations

import unittest

from repo import exists, read

MAJOR_APPS = [
    "Element",
    "Nextcloud",
    "Collabora",
    "Docmost",
    "XWiki",
    "Jitsi",
    "OpenProject",
    "Nubus",
    "OX App Suite",
]


class TestLicensing(unittest.TestCase):
    def test_notice_present(self):
        self.assertTrue(exists("NOTICE"))
        text = read("NOTICE")
        self.assertIn("Blak Workspace", text)
        self.assertIn("Yuma", text)
        self.assertIn("openDesk", text)
        self.assertIn("ZenDiS", text)

    def test_third_party_lists_major_apps(self):
        self.assertTrue(exists("THIRD_PARTY_NOTICES.md"))
        text = read("THIRD_PARTY_NOTICES.md")
        for app in MAJOR_APPS:
            self.assertIn(app, text, app)

    def test_gaps_marked_tbd_not_invented(self):
        text = read("THIRD_PARTY_NOTICES.md")
        self.assertIn("TBD", text)
        self.assertIn("Gaps", text)
        self.assertIn("Do not relicense", text)
        # Docmost licence is a gap, not a fabricated SPDX id.
        self.assertRegex(text, r"Docmost.*TBD|TBD.*Docmost")

    def test_readme_attribution(self):
        readme = read("README.md")
        self.assertIn("ZenDiS", readme)
        self.assertIn("NOTICE", readme)
        self.assertIn("THIRD_PARTY_NOTICES.md", readme)
        self.assertIn("Apache License", readme)

    def test_docmost_knowledge_stance(self):
        notices = read("THIRD_PARTY_NOTICES.md")
        readme = read("README.md")
        self.assertIn("Docmost", notices)
        self.assertIn("Blak Knowledge", notices)
        self.assertIn("XWiki", notices)
        self.assertIn("Not enabled in Blak default profiles", notices)
        self.assertIn("Docmost", readme)
        self.assertIn("Blak Knowledge", readme)
        self.assertIn("Docmost (replaces openDesk XWiki", readme)


if __name__ == "__main__":
    unittest.main()
