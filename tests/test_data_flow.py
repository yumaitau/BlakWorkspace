"""BW-041: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_governance import data_residency  # noqa: E402


class TestDataFlow(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/governance/au-data-flow.md"))

    def test_policy(self):
        self.assertEqual(data_residency(ROOT), 'AU')


if __name__ == "__main__":
    unittest.main()
