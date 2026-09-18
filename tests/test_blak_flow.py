"""BW-052: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_pilot import blak_flow_status  # noqa: E402


class TestBlakFlow(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/architecture/blak-flow.md"))

    def test_policy(self):
        self.assertEqual(blak_flow_status(ROOT), 'reserved')


if __name__ == "__main__":
    unittest.main()
