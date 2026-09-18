"""BW-039: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_governance import enforcement_paths  # noqa: E402


class TestEnforcement(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/governance/enforcement.md"))

    def test_policy(self):
        self.assertEqual(enforcement_paths(ROOT), ['disable-share', 'revoke', 'escalate'])


if __name__ == "__main__":
    unittest.main()
