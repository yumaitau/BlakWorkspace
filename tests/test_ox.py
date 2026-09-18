"""BW-033: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_collab import ox_enabled  # noqa: E402


class TestOx(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/collab/ox.md"))

    def test_policy(self):
        self.assertFalse(ox_enabled(ROOT))


if __name__ == "__main__":
    unittest.main()
