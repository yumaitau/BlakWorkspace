"""BW-049: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_pilot import pilot_status  # noqa: E402


class TestPilotStatus(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/pilot/checklist.md"))

    def test_policy(self):
        self.assertEqual(pilot_status(ROOT), 'not-run')


if __name__ == "__main__":
    unittest.main()
