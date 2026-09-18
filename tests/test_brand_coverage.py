"""BW-016: branding coverage audit drives shipped blak_brand.branding_coverage."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_brand import branding_coverage, coverage_gaps  # noqa: E402


class TestBrandCoverage(unittest.TestCase):
    def test_audit_doc_present(self):
        self.assertTrue(exists("docs/brand/app-coverage.md"))

    def test_named_products_have_no_tile_gaps(self):
        rows = branding_coverage(ROOT)
        labels = {row["label"] for row in rows}
        for required in (
            "Blak Drive",
            "Blak Docs",
            "Blak Knowledge",
            "Blak Hermes",
            "Blak Sites",
            "Blak Admin",
        ):
            self.assertIn(required, labels)
        self.assertEqual(coverage_gaps(ROOT), [])
        knowledge = next(r for r in rows if r["label"] == "Blak Knowledge")
        self.assertEqual(knowledge["tile_id"], "docmost")
        self.assertNotEqual(knowledge["tile_id"], "xwiki")

    def test_reserved_flow_is_not_a_gap(self):
        flow = next(r for r in branding_coverage(ROOT) if r["label"] == "Blak Flow")
        self.assertEqual(flow["status"], "suite-or-reserved")


if __name__ == "__main__":
    unittest.main()
