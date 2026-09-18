"""BW-032: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_collab import meet_backend  # noqa: E402


class TestMeet(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/collab/meet.md"))

    def test_policy(self):
        self.assertEqual(meet_backend(ROOT), 'jitsi')


if __name__ == "__main__":
    unittest.main()
