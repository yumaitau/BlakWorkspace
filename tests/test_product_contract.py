"""BW-001: shipped product contract, naming map, non-goals, README link."""

from __future__ import annotations

import re
import unittest

from repo import exists, read

NAMING = {
    "Blak Workspace": "openDesk",
    "Blak Drive": "OpenCloud",
    "Blak Docs": "Collabora",
    "Blak Notes": "Notes",
    "Blak Chat": "Element",
    "Blak Meet": "Jitsi",
    "Blak Mail and Calendar": "OX App Suite",
    "Blak Knowledge": "Outline",
    "Blak Projects": "OpenProject",
    "Blak Admin": "Nubus",
    "Blak Flow": "Blak Flow engine",
    "Blak Hermes": "Hermes",
}


def _table_pairs(text: str) -> dict[str, str]:
    pairs = {}
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2 or cells[0].startswith("-") or cells[0].lower() in {
            "blak label",
            "function",
        }:
            continue
        pairs[cells[0]] = cells[1]
    return pairs


class TestProductContract(unittest.TestCase):
    def test_contract_published(self):
        self.assertTrue(exists("docs/product-contract.md"))
        text = read("docs/product-contract.md")
        self.assertIn("Maturity: seed", text)
        self.assertIn("product contract", text.lower())

    def test_readme_links_to_contract(self):
        readme = read("README.md")
        self.assertRegex(readme, r"\[.*\]\(docs/product-contract\.md\)")

    def test_naming_map_matches_brief(self):
        contract = read("docs/product-contract.md")
        readme = read("README.md")
        for label, upstream in NAMING.items():
            self.assertIn(label, contract, label)
            self.assertIn(upstream, contract, upstream)
            self.assertIn(label, readme, label)
        pairs = _table_pairs(contract)
        self.assertIn("Blak Knowledge", pairs)
        self.assertIn("Outline", pairs["Blak Knowledge"])

    def test_non_goals_include_m365_and_fake_certs(self):
        text = read("docs/product-contract.md")
        lowered = text.lower()
        self.assertIn("microsoft 365", lowered)
        self.assertIn("parity", lowered)
        self.assertTrue("irap" in lowered and "protected" in lowered)
        self.assertIn("non-goals", lowered)

    def test_no_upstream_id_renames(self):
        text = read("docs/product-contract.md")
        self.assertRegex(
            text,
            re.compile(r"do not rename upstream", re.I),
        )
        self.assertIn("OIDC", text)
        self.assertIn("Helm", text)


if __name__ == "__main__":
    unittest.main()
