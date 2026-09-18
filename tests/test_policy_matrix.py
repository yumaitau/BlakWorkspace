"""BW-037: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_governance import policy_controls  # noqa: E402


class TestPolicyMatrix(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/governance/policy-matrix.md"))

    def test_policy(self):
        self.assertEqual(policy_controls(ROOT), ['access', 'sharing', 'retention', 'export'])


if __name__ == "__main__":
    unittest.main()
