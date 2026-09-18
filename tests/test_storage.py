"""BW-011: production storage mapping, eval vs prod, ADR-005, gaps."""

from __future__ import annotations

import unittest

from repo import exists, read

PILOT_APPS = (
    "Nubus",
    "Nextcloud",
    "Collabora",
    "Element",
    "Jitsi",
    "OpenProject",
    "Notes",
    "Docmost",
    "Hermes",
)


class TestStorageDesign(unittest.TestCase):
    def test_mapping_complete_for_pilot_apps(self):
        self.assertTrue(exists("docs/architecture/storage.md"))
        text = read("docs/architecture/storage.md")
        for app in PILOT_APPS:
            self.assertIn(app, text, app)

    def test_eval_vs_prod_called_out(self):
        text = read("docs/architecture/storage.md")
        self.assertIn("Eval", text)
        self.assertIn("Prod", text)
        self.assertIn("Bundled", text)
        self.assertIn("Operator", text)

    def test_adr_005_references_design(self):
        adr = read("docs/adr/ADR-005.md")
        self.assertIn("storage.md", adr)
        self.assertIn("## Decision", adr)

    def test_gaps_listed(self):
        text = read("docs/architecture/storage.md")
        self.assertIn("## Gaps", text)
        self.assertIn("BW-055", text)
        self.assertIn("Cassandra", text)


if __name__ == "__main__":
    unittest.main()
