"""BW-048: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_ops import threat_model_topics  # noqa: E402


class TestThreatModel(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/ops/threat-model.md"))

    def test_policy(self):
        self.assertEqual(threat_model_topics(ROOT), ['authn', 'sharing', 'backup', 'supply-chain'])


if __name__ == "__main__":
    unittest.main()
