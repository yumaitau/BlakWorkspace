"""BW-040: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_governance import retention_days  # noqa: E402


class TestRetention(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/governance/retention.md"))

    def test_policy(self):
        self.assertEqual(retention_days(ROOT), 365)


if __name__ == "__main__":
    unittest.main()
