"""BW-006: nine ADRs with required sections, index, contract reference."""

from __future__ import annotations

import unittest

from repo import ROOT, exists, read

ADR_IDS = [f"ADR-{n:03d}" for n in range(1, 10)]
REQUIRED = ("## Context", "## Decision", "## Consequences")


class TestAdrSet(unittest.TestCase):
    def test_all_nine_present(self):
        for adr in ADR_IDS:
            self.assertTrue(exists(f"docs/adr/{adr}.md"), adr)

    def test_each_has_required_sections(self):
        for adr in ADR_IDS:
            text = read(f"docs/adr/{adr}.md")
            for heading in REQUIRED:
                self.assertIn(heading, text, f"{adr} missing {heading}")
            self.assertRegex(text, r"Status:\s+\w+")

    def test_index_lists_all(self):
        index = read("docs/adr/README.md")
        for adr in ADR_IDS:
            self.assertIn(adr, index)
            self.assertIn(f"{adr}.md", index)

    def test_contract_references_adr_set(self):
        contract = read("docs/product-contract.md")
        self.assertIn("ADR-001", contract)
        self.assertIn("ADR-009", contract)
        self.assertIn("docs/adr/", contract)

    def test_architecture_overview_links_adrs(self):
        self.assertTrue(exists("docs/architecture/overview.md"))
        text = read("docs/architecture/overview.md")
        self.assertIn("adr/README.md", text)
        self.assertIn("ADR-001", text)
        self.assertIn("ADR-009", text)
        self.assertIn("Docmost", text)

    def test_no_extra_adr_files_missing_from_index(self):
        files = sorted(p.name for p in (ROOT / "docs" / "adr").glob("ADR-*.md"))
        self.assertEqual(files, [f"{adr}.md" for adr in ADR_IDS])


if __name__ == "__main__":
    unittest.main()
