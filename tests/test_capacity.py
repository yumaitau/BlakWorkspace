"""BW-047: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_ops import pilot_user_capacity  # noqa: E402


class TestCapacity(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/ops/capacity.md"))

    def test_policy(self):
        self.assertEqual(pilot_user_capacity(ROOT), 50)


if __name__ == "__main__":
    unittest.main()
