"""BW-022: join/move/leave lifecycle from identity overlay."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_identity import REQUIRED_LIFECYCLE, lifecycle_failures  # noqa: E402


class TestJoinMoveLeave(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/identity/join-move-leave.md"))

    def test_lifecycle_complete(self):
        self.assertEqual(lifecycle_failures(ROOT), [])
        for step in REQUIRED_LIFECYCLE:
            self.assertIn(step, ("join", "move", "leave"))


if __name__ == "__main__":
    unittest.main()
