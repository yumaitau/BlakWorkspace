"""BW-044: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_ops import observability_signals  # noqa: E402


class TestObservability(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/ops/observability.md"))

    def test_policy(self):
        self.assertEqual(observability_signals(ROOT), ['metrics', 'logs', 'traces'])


if __name__ == "__main__":
    unittest.main()
