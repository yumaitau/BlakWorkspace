"""BW-015: Blak names, internal IDs unchanged, portal plan, upgrade re-test."""

from __future__ import annotations

import unittest

from repo import exists, read

LABELS = [
    "Blak Workspace",
    "Blak Drive",
    "Blak Docs",
    "Blak Notes",
    "Blak Chat",
    "Blak Meet",
    "Blak Mail and Calendar",
    "Blak Knowledge",
    "Blak Projects",
    "Blak Admin",
    "Blak Flow",
    "Blak Hermes",
]


class TestNamingMap(unittest.TestCase):
    def test_map_covers_named_products_including_knowledge(self):
        self.assertTrue(exists("docs/brand/naming-map.md"))
        text = read("docs/brand/naming-map.md")
        for label in LABELS:
            self.assertIn(label, text, label)
        self.assertIn("Docmost", text)
        self.assertIn("not XWiki", text)
        portal = read("deploy/overlays/blak/portal-labels.example.yaml")
        self.assertIn("Blak Knowledge", portal)
        self.assertIn("id: docmost", portal)
        self.assertNotIn("id: xwiki", portal.lower())
        self.assertIn("xwiki tile is omitted", portal.lower())

    def test_internal_ids_unchanged(self):
        text = read("docs/brand/naming-map.md")
        self.assertIn("do not rename", text.lower())
        self.assertIn("OIDC", text)
        self.assertIn("Helm", text)
        for internal in ("nextcloud", "collabora", "docmost", "openproject", "nubus", "hermes"):
            self.assertIn(internal, text)

    def test_portal_plan_documented(self):
        text = read("docs/brand/naming-map.md")
        self.assertIn("Portal tile plan", text)
        self.assertIn("portal-labels.example.yaml", text)
        self.assertIn("en-AU", text)

    def test_upgrade_retest_checklist(self):
        text = read("docs/brand/naming-map.md")
        self.assertIn("Upgrade re-test", text)
        self.assertIn("OIDC client IDs unchanged", text)
        self.assertIn("Helm release names unchanged", text)


if __name__ == "__main__":
    unittest.main()
