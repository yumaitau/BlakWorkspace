"""BW-042: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_governance import cultural_review_required  # noqa: E402


class TestCulturalJourneys(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/governance/cultural-journeys.md"))

    def test_policy(self):
        self.assertTrue(cultural_review_required(ROOT))


if __name__ == "__main__":
    unittest.main()
