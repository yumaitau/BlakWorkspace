"""BW-054: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_pilot import fleet_isolation  # noqa: E402


class TestFleet(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/architecture/fleet-isolation.md"))

    def test_policy(self):
        self.assertEqual(fleet_isolation(ROOT), 'one-org-per-deployment')


if __name__ == "__main__":
    unittest.main()
